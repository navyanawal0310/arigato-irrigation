#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include <math.h>
#include "secrets.h"

// ============================================================
// SYSTEM & PIN DEFINITIONS
// ============================================================

#define FW_VERSION           "6.5.0-NIRMAAN-MAX"
#define SYSTEM_NAME          "AquaMatrix-MaxCore"

// Hardware Pinout
const int SOIL_PIN           = 34; // Capacitive Soil Sensor HW-390 (ADC1)
const int RAIN_ANALOG_PIN    = 35; // Raindrop Plate Analog (ADC1 - Wetness depth)
const int RAIN_DIGITAL_PIN   = 19; // Raindrop Plate Digital (Instant interrupt/detect)
const int TRIG_PIN           = 5;  // JSN-SR04T Trigger
const int ECHO_PIN           = 18; // JSN-SR04T Echo
const int RELAY_PIN          = 23; // Pump Relay (Active-LOW: LOW=ON, HIGH=OFF)
const int STATUS_LED_PIN     = 2;  // Diagnostic LED

// Location (Default: Bengaluru, Karnataka)
const float FIELD_LATITUDE   = 12.9716f;
const float FIELD_LONGITUDE  = 77.5946f;

// Agronomic Calibration Values & Range Validation
const int   DRY_ADC              = 2850;
const int   WET_ADC              = 1150;
const int   SOIL_MIN_VALID_ADC   = 300;  // Below this is short-circuited
const int   SOIL_MAX_VALID_ADC   = 3800; // Above this is disconnected/open
const int   RAIN_DRY_ADC         = 4095; // Dry raindrop sensor ADC
const int   RAIN_WET_ADC         = 1200; // Fully submerged raindrop sensor ADC

// JSN-SR04T / Tank Geometry
const float EMPTY_DIST_CM        = 150.0f; // Sensor to tank bottom
const float FULL_DIST_CM         = 25.0f;  // Sensor to maximum safe water line
const float TANK_CAPACITY_L      = 2000.0f; 
const float FIELD_AREA_M2        = 100.0f; // Field size (100m²)
const float ROOF_CATCHMENT_M2    = 25.0f;  // Rain harvesting roof catchment area

// Volumetric Pumping Parameters & Hard Safety Limits
const float PUMP_FLOW_LPM              = 15.0f;    // 15 Liters / Minute pump rating
const unsigned long MAX_PUMP_RUN_MS    = 180000UL; // 3-minute continuous thermal run limit
const unsigned long MIN_PUMP_DWELL_MS  = 60000UL;  // 1-minute safety cooldown between cycles
const float CRITICAL_TANK_PCT          = 15.0f;    // 15% run-dry protection lockout

// Task Scheduler Interval Timers
unsigned long lastSensorSample   = 0;
const unsigned long INTERVAL_SENSORS = 2000UL;     // Sample sensors & run decision logic every 2s

unsigned long lastWeatherFetch   = 0;
const unsigned long INTERVAL_WEATHER = 1800000UL;  // Weather API sync every 30 mins

unsigned long lastTelemetryPrint = 0;
const unsigned long INTERVAL_PRINT   = 4000UL;     // Serial telemetry log every 4s

WebServer server(80);
DNSServer dnsServer;
Preferences preferences;
const byte DNS_PORT = 53;

// ============================================================
// AGRONOMIC CROP PHENOLOGY PRESETS
// ============================================================

struct CropProfile {
    const char* id;
    const char* displayName;
    float kc;
    float baseTempC;
    float madThresholdPct;
};

const CropProfile CROP_PROFILES[] = {
    {"TOMATO_VEG",   "Tomato (Vegetative)",   0.85f, 10.0f, 50.0f},
    {"TOMATO_FRUIT", "Tomato (Fruiting)",     1.15f, 10.0f, 40.0f},
    {"POTATO",       "Potato (Tuber Growth)", 1.05f,  7.0f, 45.0f},
    {"CHILI_PEPPER", "Chili Pepper",          0.95f, 12.0f, 45.0f},
    {"LEAFY_GREENS", "Leafy Greens / Spinach", 0.70f,  5.0f, 35.0f}
};
const int NUM_CROP_PROFILES = sizeof(CROP_PROFILES) / sizeof(CROP_PROFILES[0]);
int currentCropIndex = 0;

// ============================================================
// SYSTEM TELEMETRY STATE MATRIX
// ============================================================

struct SystemState {
    // Soil Subsystem
    int   rawSoilADC = 0;
    float moistureIdx = 0.0f;
    float drynessScore = 0.0f;
    bool  soilOK = false;

    // Rain Subsystem (Physical Hardware)
    int   rawRainADC = 4095;
    int   rawRainDigitalState = HIGH;
    bool  isRaining = false;
    float surfaceWetnessPct = 0.0f;

    // Reservoir Subsystem (JSN-SR04T)
    float rawDistanceCM = 0.0f;
    float tankPercentage = 0.0f;
    float waterVolumeL = 0.0f;
    float deltaVolumeL = 0.0f;
    float rechargeRateLPH = 0.0f; // Liters per hour inflow (+) or drawdown (-)
    bool  tankOK = false;
    unsigned long lastTankSampleMillis = 0;
    float lastWaterVolumeL = 0.0f;

    // Weather Subsystem (API Data & Fallback Tracking)
    float tempC = 25.0f;
    float humidityPct = 60.0f;
    float forecastRainMM = 0.0f;
    float et0Fao56 = 4.5f;
    bool  weatherValid = false;
    String weatherSource = "FALLBACK_OFFLINE";

    // Derived Agronomic Indices
    float vpdKPa = 0.0f;          // Vapor Pressure Deficit
    float dewPointC = 0.0f;       // Condensation point
    float gdd = 0.0f;             // Growing Degree Day accumulation step
    String diseaseRisk = "LOW";
    String diseaseReason = "Nominal microclimate";

    // Soil Infiltration & Hydraulic Drainage Analysis
    float moistureAtStop = 0.0f;
    unsigned long postPumpStopMillis = 0;
    float infiltrationRatePctPerMin = 0.0f;
    String drainageStatus = "STABLE";

    // NVS Cumulative Metrics
    float dailyWaterL = 0.0f;
    float totalWaterL = 0.0f;
    uint32_t pumpCycles = 0;
    float waterSavedL = 0.0f;

    // Irrigation Modeling & Auto Control
    float cropET_MM = 0.0f;
    float effectiveRainMM = 0.0f;
    float netDemandMM = 0.0f;
    float prescribedWaterL = 0.0f;
    float runDurationSec = 0.0f;
    float harvestPotentialL = 0.0f;
    int   confidencePercent = 100;
    String anomaly = "NONE";

    // Pump Actuator Management & Manual Override
    bool  pumpActive = false;
    bool  manualOverride = false;
    unsigned long pumpStartMillis = 0;
    unsigned long targetPumpDurationMs = 0;
    unsigned long lastPumpStopMillis = 0;
    String action = "STANDBY";
    String reason = "System initializing engine";
} state;

// ============================================================
// NVS NON-VOLATILE STORAGE MANAGEMENT
// ============================================================

void loadNVSSettings() {
    preferences.begin("aquamatrix", false);
    currentCropIndex = preferences.getInt("cropIdx", 0);
    if (currentCropIndex < 0 || currentCropIndex >= NUM_CROP_PROFILES) currentCropIndex = 0;
    state.dailyWaterL = preferences.getFloat("dayWater", 0.0f);
    state.totalWaterL = preferences.getFloat("totalWater", 0.0f);
    state.pumpCycles  = preferences.getUInt("pumpCycles", 0);
    state.waterSavedL = preferences.getFloat("waterSaved", 0.0f);
    preferences.end();
}

void recordPumpCycleCompleted(float litresDispensed) {
    state.dailyWaterL += litresDispensed;
    state.totalWaterL += litresDispensed;
    state.pumpCycles++;
    float saved = max(0.0f, 50.0f - litresDispensed); // Savings vs fixed 50L schedule
    state.waterSavedL += saved;

    preferences.begin("aquamatrix", false);
    preferences.putFloat("dayWater", state.dailyWaterL);
    preferences.putFloat("totalWater", state.totalWaterL);
    preferences.putUInt("pumpCycles", state.pumpCycles);
    preferences.putFloat("waterSaved", state.waterSavedL);
    preferences.end();
}

void saveCropPreference(int cropIndex) {
    if (cropIndex >= 0 && cropIndex < NUM_CROP_PROFILES) {
        currentCropIndex = cropIndex;
        preferences.begin("aquamatrix", false);
        preferences.putInt("cropIdx", currentCropIndex);
        preferences.end();
    }
}

// ============================================================
// HARDWARE DRIVERS & SENSORS
// ============================================================

float clampVal(float val, float minVal, float maxVal) {
    if (val < minVal) return minVal;
    if (val > maxVal) return maxVal;
    return val;
}

int readFilteredADC(int pin, int samples = 16) {
    long sum = 0;
    for (int i = 0; i < samples; i++) {
        sum += analogRead(pin);
        delayMicroseconds(50);
    }
    return (int)(sum / samples);
}

// JSN-SR04T Driver with median filtering, timeout handling, and valid bracket validation
float readWaterproofUltrasonicCM() {
    float samples[5];
    int valid = 0;

    for (int i = 0; i < 5; i++) {
        digitalWrite(TRIG_PIN, LOW);
        delayMicroseconds(5);
        digitalWrite(TRIG_PIN, HIGH);
        delayMicroseconds(15);
        digitalWrite(TRIG_PIN, LOW);

        unsigned long duration = pulseIn(ECHO_PIN, HIGH, 26000UL);
        if (duration >= 1166UL && duration <= 26000UL) {
            float dist = (duration * 0.03432f) / 2.0f;
            if (dist >= (FULL_DIST_CM - 5.0f) && dist <= (EMPTY_DIST_CM + 15.0f)) {
                samples[valid++] = dist;
            }
        }
        delay(10);
    }

    if (valid == 0) return -1.0f;

    for (int i = 0; i < valid - 1; i++) {
        for (int j = i + 1; j < valid; j++) {
            if (samples[i] > samples[j]) {
                float tmp = samples[i];
                samples[i] = samples[j];
                samples[j] = tmp;
            }
        }
    }
    return samples[valid / 2];
}

// ============================================================
// DERIVED METEOROLOGY & AGRONOMY MATH
// ============================================================

void calculateDerivedAtmospherics() {
    CropProfile crop = CROP_PROFILES[currentCropIndex];

    float es = 0.61078f * expf((17.27f * state.tempC) / (state.tempC + 237.3f));
    float ea = es * (state.humidityPct / 100.0f);
    
    state.vpdKPa = max(0.0f, es - ea);

    float a = 17.27f;
    float b = 237.7f;
    float alpha = ((a * state.tempC) / (b + state.tempC)) + logf(max(0.01f, state.humidityPct / 100.0f));
    state.dewPointC = (b * alpha) / (a - alpha);

    state.gdd = max(0.0f, state.tempC - crop.baseTempC);

    bool surfaceWet = state.isRaining || (state.surfaceWetnessPct > 40.0f);
    if ((state.vpdKPa < 0.4f || surfaceWet) && (state.tempC >= 16.0f && state.tempC <= 27.0f)) {
        state.diseaseRisk = "HIGH";
        state.diseaseReason = "Low VPD & Wet Surface: High spore germination risk (Early/Late Blight)";
    } else if (state.vpdKPa < 0.8f || state.humidityPct > 75.0f) {
        state.diseaseRisk = "MODERATE";
        state.diseaseReason = "Elevated humidity: Restricted transpiration & fungal vulnerability";
    } else if (state.vpdKPa > 2.2f) {
        state.diseaseRisk = "STOMATAL_SHUTDOWN";
        state.diseaseReason = "High VPD: Crop under extreme atmospheric evaporative stress";
    } else {
        state.diseaseRisk = "LOW";
        state.diseaseReason = "Optimal transpiration bracket & dry foliage";
    }
}

// Soil Infiltration & Hydraulic Drainage Analysis
void evaluateSoilInfiltration(unsigned long now) {
    if (state.postPumpStopMillis > 0) {
        unsigned long elapsed = now - state.postPumpStopMillis;
        if (elapsed >= 120000UL) { // Evaluate 2 minutes after pump stops
            float dt_min = elapsed / 60000.0f;
            float deltaMoisture = state.moistureIdx - state.moistureAtStop;
            state.infiltrationRatePctPerMin = deltaMoisture / dt_min;

            if (deltaMoisture >= 4.0f) {
                state.drainageStatus = "EXCELLENT_PERCOLATION";
            } else if (deltaMoisture >= 1.0f) {
                state.drainageStatus = "NORMAL_PERCOLATION";
            } else if (deltaMoisture >= -1.0f) {
                state.drainageStatus = "SLOW_DRAINAGE_COMPACTION";
            } else {
                state.drainageStatus = "STAGNANT_WATERLOGGING";
            }
        }
    }
}

// ============================================================
// WEATHER SYNC (OPEN-METEO API WITH NON-BLOCKING FALLBACK)
// ============================================================

bool fetchWeatherSync() {
    if (WiFi.status() != WL_CONNECTED) {
        state.weatherValid = false;
        state.weatherSource = "FALLBACK_OFFLINE";
        return false;
    }

    HTTPClient http;
    http.setConnectTimeout(2500);
    http.setTimeout(2500);

    String url = "https://api.open-meteo.com/v1/forecast?latitude=" + String(FIELD_LATITUDE, 4) +
                 "&longitude=" + String(FIELD_LONGITUDE, 4) +
                 "&current=temperature_2m,relative_humidity_2m" +
                 "&daily=et0_fao_evapotranspiration,precipitation_sum&timezone=auto&forecast_days=1";

    http.begin(url);
    int httpCode = http.GET();

    if (httpCode == 200) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload);

        if (!error) {
            state.tempC = doc["current"]["temperature_2m"] | state.tempC;
            state.humidityPct = doc["current"]["relative_humidity_2m"] | state.humidityPct;
            state.forecastRainMM = doc["daily"]["precipitation_sum"][0] | 0.0f;
            state.et0Fao56 = doc["daily"]["et0_fao_evapotranspiration"][0] | 4.5f;
            state.weatherValid = true;
            state.weatherSource = "LIVE_OPEN_METEO";
            http.end();
            return true;
        }
    }
    http.end();
    state.weatherValid = false;
    state.weatherSource = "FALLBACK_OFFLINE";
    return false;
}

// ============================================================
// AGRONOMIC INFERENCE & HYDRAULIC ARBITRATION ENGINE
// ============================================================

void evaluateSystemIntelligence() {
    unsigned long now = millis();
    CropProfile crop = CROP_PROFILES[currentCropIndex];

    // 1. Process Soil Moisture Subsystem & Sensor Health
    if (state.rawSoilADC > SOIL_MIN_VALID_ADC && state.rawSoilADC < SOIL_MAX_VALID_ADC) {
        state.soilOK = true;
        float moisture = ((float)(DRY_ADC - state.rawSoilADC) / (float)(DRY_ADC - WET_ADC)) * 100.0f;
        state.moistureIdx = clampVal(moisture, 0.0f, 100.0f);
        state.drynessScore = 100.0f - state.moistureIdx;
    } else {
        state.soilOK = false;
        state.moistureIdx = 0.0f;
        state.drynessScore = 0.0f;
    }

    // 2. Process Rain Surface Subsystem
    state.rawRainDigitalState = digitalRead(RAIN_DIGITAL_PIN);
    float rainRaw = (float)state.rawRainADC;
    float wetness = ((RAIN_DRY_ADC - rainRaw) / (float)(RAIN_DRY_ADC - RAIN_WET_ADC)) * 100.0f;
    state.surfaceWetnessPct = clampVal(wetness, 0.0f, 100.0f);
    state.isRaining = (state.rawRainDigitalState == LOW) || (state.surfaceWetnessPct > 65.0f);

    // 3. Process Reservoir Subsystem (JSN-SR04T)
    if (state.rawDistanceCM >= FULL_DIST_CM && state.rawDistanceCM <= EMPTY_DIST_CM) {
        state.tankOK = true;
        float pct = ((EMPTY_DIST_CM - state.rawDistanceCM) / (EMPTY_DIST_CM - FULL_DIST_CM)) * 100.0f;
        state.tankPercentage = clampVal(pct, 0.0f, 100.0f);
        state.waterVolumeL = (state.tankPercentage / 100.0f) * TANK_CAPACITY_L;

        if (state.lastTankSampleMillis == 0) {
            state.lastTankSampleMillis = now;
            state.lastWaterVolumeL = state.waterVolumeL;
        } else if (now - state.lastTankSampleMillis >= 30000UL) {
            float dt_hours = (now - state.lastTankSampleMillis) / 3600000.0f;
            if (dt_hours > 0.0001f) {
                state.deltaVolumeL = state.waterVolumeL - state.lastWaterVolumeL;
                state.rechargeRateLPH = state.deltaVolumeL / dt_hours;
            }
            state.lastWaterVolumeL = state.waterVolumeL;
            state.lastTankSampleMillis = now;
        }
    } else {
        state.tankOK = false; // Out of range, unmounted, or no valid echo
        state.tankPercentage = -1.0f;
        state.waterVolumeL = 0.0f;
        state.rechargeRateLPH = 0.0f;
    }

    // 4. Update Microclimate & Atmospheric Indices
    calculateDerivedAtmospherics();
    evaluateSoilInfiltration(now);

    // 5. Irrigation Demand Calculation (FAO-56 Irrigation Engineering Model)
    float et0 = state.weatherValid ? state.et0Fao56 : 4.5f;
    float rainForecast = state.weatherValid ? state.forecastRainMM : 0.0f;

    state.cropET_MM = et0 * crop.kc;
    state.effectiveRainMM = (state.isRaining || state.surfaceWetnessPct > 50.0f) ? 
                             max(rainForecast * 0.8f, 5.0f) : (rainForecast * 0.8f);

    state.netDemandMM = max(0.0f, state.cropET_MM - state.effectiveRainMM);
    float theoreticalWaterL = state.netDemandMM * FIELD_AREA_M2;

    // Soil Stress Factor using Crop MAD Threshold
    float soilStressFactor = 0.0f;
    float madStart = 100.0f - crop.madThresholdPct; // e.g. 50% dryness
    if (state.soilOK && state.drynessScore > madStart) {
        soilStressFactor = clampVal((state.drynessScore - madStart) / (100.0f - madStart), 0.0f, 1.0f);
    }

    state.prescribedWaterL = theoreticalWaterL * soilStressFactor;
    state.runDurationSec = (state.prescribedWaterL / PUMP_FLOW_LPM) * 60.0f;
    state.harvestPotentialL = rainForecast * ROOF_CATCHMENT_M2 * 0.85f;

    // System Confidence Assessment & Anomaly Engine
    if (!state.soilOK || !state.tankOK) {
        state.confidencePercent = 0;
    } else if (!state.weatherValid) {
        state.confidencePercent = 80;
    } else {
        state.confidencePercent = 100;
    }

    if (!state.soilOK) {
        state.anomaly = "SOIL_SENSOR_FAULT";
    } else if (!state.tankOK) {
        state.anomaly = "RESERVOIR_SENSOR_FAULT";
    } else if (state.tankPercentage <= CRITICAL_TANK_PCT) {
        state.anomaly = "RESERVOIR_DEPLETED";
    } else if (!state.pumpActive && state.rechargeRateLPH < -250.0f) {
        state.anomaly = "UNEXPLAINED_TANK_DRAIN";
    } else if (state.isRaining) {
        state.anomaly = "PRECIPITATION_EVENT";
    } else {
        state.anomaly = "NONE";
    }

    // ========================================================
    // HYDRAULIC ARBITRATION & CLOSED-LOOP ACTUATOR LOGIC
    // ========================================================

    // Case 1: Pump is currently running -> Evaluate safety cutoffs & trip conditions
    if (state.pumpActive) {
        unsigned long elapsed = now - state.pumpStartMillis;

        if (elapsed >= state.targetPumpDurationMs) {
            digitalWrite(RELAY_PIN, HIGH); // Pump OFF (Active-LOW)
            state.pumpActive = false;
            state.manualOverride = false;
            state.lastPumpStopMillis = now;
            state.moistureAtStop = state.moistureIdx;
            state.postPumpStopMillis = now;
            state.action = "CYCLE_COMPLETE";
            state.reason = "Prescribed irrigation volume delivered successfully.";

            float litresDispensed = (elapsed / 1000.0f) * (PUMP_FLOW_LPM / 60.0f);
            recordPumpCycleCompleted(litresDispensed);
        } else if (elapsed >= MAX_PUMP_RUN_MS) {
            digitalWrite(RELAY_PIN, HIGH);
            state.pumpActive = false;
            state.manualOverride = false;
            state.lastPumpStopMillis = now;
            state.action = "TRIP_MAX_RUNTIME";
            state.reason = "Thermal safety: maximum continuous pump run-time exceeded (3 min limit).";
        } else if (!state.tankOK) {
            digitalWrite(RELAY_PIN, HIGH);
            state.pumpActive = false;
            state.manualOverride = false;
            state.lastPumpStopMillis = now;
            state.action = "TRIP_RESERVOIR_FAULT";
            state.reason = "Reservoir level sensor reading became invalid during pumping.";
        } else if (state.tankPercentage <= CRITICAL_TANK_PCT) {
            digitalWrite(RELAY_PIN, HIGH);
            state.pumpActive = false;
            state.manualOverride = false;
            state.lastPumpStopMillis = now;
            state.action = "TRIP_DRY_RUN";
            state.reason = "Reservoir depleted below 15% critical threshold during pumping.";
        } else if (!state.soilOK) {
            digitalWrite(RELAY_PIN, HIGH);
            state.pumpActive = false;
            state.manualOverride = false;
            state.lastPumpStopMillis = now;
            state.action = "TRIP_SOIL_FAULT";
            state.reason = "Soil moisture sensor disconnected or invalid during pumping.";
        } else if (state.isRaining || state.surfaceWetnessPct > 50.0f) {
            digitalWrite(RELAY_PIN, HIGH);
            state.pumpActive = false;
            state.manualOverride = false;
            state.lastPumpStopMillis = now;
            state.action = "TRIP_RAIN_DETECTED";
            state.reason = "Rainfall detected during active pumping cycle. Irrigation aborted.";
        } else {
            state.action = "IRRIGATING";
            state.reason = "Dispensing water: " + String((elapsed / 1000.0f) * (PUMP_FLOW_LPM / 60.0f), 1) + 
                           "L of " + String(state.prescribedWaterL, 1) + "L target";
        }
        return;
    }

    // Case 2: Pump is currently OFF -> Evaluate start eligibility & safety lockouts

    if (!state.soilOK) {
        state.action = "LOCKOUT_SOIL_FAULT";
        state.reason = "Soil sensor invalid or disconnected (ADC: " + String(state.rawSoilADC) + "). Pump locked out.";
        return;
    }

    if (!state.tankOK) {
        state.action = "LOCKOUT_TANK_FAULT";
        state.reason = "Reservoir sensor invalid or out of range. Pump locked out.";
        return;
    }

    if (state.isRaining || state.surfaceWetnessPct > 65.0f) {
        state.action = "SUSPEND_RAIN";
        state.reason = "Precipitation detected by physical raindrop sensor. Irrigation suspended.";
        return;
    }

    if (state.tankPercentage <= CRITICAL_TANK_PCT) {
        state.action = "LOCKOUT_WATER_DEPLETED";
        state.reason = "Reservoir level critically low (" + String(state.tankPercentage, 1) + "% <= 15%). Anti-cavitation lockout active.";
        return;
    }

    if (now - state.lastPumpStopMillis < MIN_PUMP_DWELL_MS) {
        state.action = "DWELL_REST";
        state.reason = "Pump in safety hysteresis cooldown interval (" + String((MIN_PUMP_DWELL_MS - (now - state.lastPumpStopMillis)) / 1000) + "s remaining).";
        return;
    }

    // Trigger Threshold: Soil Dryness >= MAD Start AND Net Prescribed Volume >= 15 Liters
    if (state.drynessScore >= madStart && state.prescribedWaterL >= 15.0f) {
        state.pumpActive = true;
        state.pumpStartMillis = now;
        unsigned long calculatedMs = (unsigned long)(state.runDurationSec * 1000.0f);
        state.targetPumpDurationMs = min(calculatedMs, MAX_PUMP_RUN_MS);
        digitalWrite(RELAY_PIN, LOW); // Engage Pump Relay (Active-LOW)

        state.action = "PUMP_START";
        state.reason = "High rootzone moisture deficit (" + String(state.drynessScore, 1) + "% >= " + String(madStart, 0) + "% MAD). Initiating calibrated irrigation.";
    } else {
        state.action = "STANDBY";
        state.reason = "Rootzone moisture optimal (" + String(state.moistureIdx, 1) + "%) or atmospheric demand satisfied.";
    }
}

// ============================================================
// REST API FOR DASHBOARDS, MOBILE APPS & FIELD CONFIG
// ============================================================

void handleStatusAPI() {
    CropProfile crop = CROP_PROFILES[currentCropIndex];
    JsonDocument doc;

    // 1. Node & System Diagnostics
    JsonObject sys = doc["system"].to<JsonObject>();
    sys["name"] = SYSTEM_NAME;
    sys["firmware"] = FW_VERSION;
    sys["uptime_sec"] = millis() / 1000;
    sys["free_heap"] = ESP.getFreeHeap();
    sys["wifi_rssi"] = WiFi.RSSI();
    sys["wifi_status"] = (WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "HOTSPOT_AP";
    sys["anomaly"] = state.anomaly;

    // 2. Agronomic Crop Phenology
    JsonObject cropObj = doc["crop"].to<JsonObject>();
    cropObj["profile_id"] = crop.id;
    cropObj["name"] = crop.displayName;
    cropObj["kc_factor"] = crop.kc;
    cropObj["base_temp_c"] = crop.baseTempC;
    cropObj["mad_threshold_pct"] = crop.madThresholdPct;

    // 3. Soil Subsystem (Includes Dashboard Aliases)
    JsonObject soil = doc["soil"].to<JsonObject>();
    soil["raw_adc"] = state.rawSoilADC;
    soil["adc_raw"] = state.rawSoilADC;
    soil["moisture_pct"] = state.moistureIdx;
    soil["moisture_index"] = state.moistureIdx;
    soil["dryness_pct"] = state.drynessScore;
    soil["dryness"] = state.drynessScore;
    soil["status"] = state.soilOK ? "HEALTHY" : "FAULT";

    // 4. Hydraulic Drainage & Soil Infiltration Analysis
    JsonObject drainage = doc["drainage"].to<JsonObject>();
    drainage["infiltration_rate_pct_min"] = state.infiltrationRatePctPerMin;
    drainage["status"] = state.drainageStatus;

    // 5. Rain Subsystem
    JsonObject rain = doc["rain_sensor"].to<JsonObject>();
    rain["raw_adc"] = state.rawRainADC;
    rain["surface_wetness_pct"] = state.surfaceWetnessPct;
    rain["is_raining"] = state.isRaining;

    // 6. Reservoir Hydraulics (Includes Dashboard Aliases)
    JsonObject tank = doc["reservoir"].to<JsonObject>();
    tank["distance_cm"] = state.rawDistanceCM;
    tank["level_pct"] = state.tankPercentage;
    tank["level_percent"] = state.tankPercentage;
    tank["storage_litres"] = state.waterVolumeL;
    tank["water_ml"] = state.waterVolumeL * 1000.0f;
    tank["inflow_rate_lph"] = state.rechargeRateLPH;
    tank["status"] = state.tankOK ? "HEALTHY" : "OUT_OF_RANGE";

    // 7. Atmosphere Subsystem & Weather Alias
    JsonObject atmosphere = doc["atmosphere"].to<JsonObject>();
    atmosphere["temp_c"] = state.tempC;
    atmosphere["humidity_pct"] = state.humidityPct;
    atmosphere["vpd_kpa"] = state.vpdKPa;
    atmosphere["dew_point_c"] = state.dewPointC;
    atmosphere["gdd_step"] = state.gdd;
    atmosphere["forecast_rain_mm"] = state.forecastRainMM;
    atmosphere["et0_fao56_mm"] = state.et0Fao56;
    atmosphere["api_synced"] = state.weatherValid;
    atmosphere["weather_source"] = state.weatherSource;

    JsonObject weather = doc["weather"].to<JsonObject>();
    weather["temp_c"] = state.tempC;
    weather["humidity_pct"] = state.humidityPct;
    weather["rain_forecast_mm"] = state.forecastRainMM;
    weather["et0_fao56_mm"] = state.et0Fao56;
    weather["api_synced"] = state.weatherValid;
    weather["source"] = state.weatherSource;

    // 8. Pathology Subsystem & Disease Alias
    JsonObject pathology = doc["pathology"].to<JsonObject>();
    pathology["risk_index"] = state.diseaseRisk;
    pathology["reasoning"] = state.diseaseReason;

    JsonObject disease = doc["disease"].to<JsonObject>();
    disease["risk_level"] = state.diseaseRisk;
    disease["reason"] = state.diseaseReason;

    // 9. NVS Non-Volatile Storage Telemetry
    JsonObject nvs = doc["nvs"].to<JsonObject>();
    nvs["daily_water_litres"] = state.dailyWaterL;
    nvs["total_water_litres"] = state.totalWaterL;
    nvs["pump_cycles_count"] = state.pumpCycles;
    nvs["water_saved_litres"] = state.waterSavedL;

    // 10. Agronomic Model & Dosing Calculations
    JsonObject model = doc["model"].to<JsonObject>();
    model["crop_et_mm"] = state.cropET_MM;
    model["effective_rain_mm"] = state.effectiveRainMM;
    model["net_demand_mm"] = state.netDemandMM;
    model["prescribed_litres"] = state.prescribedWaterL;
    model["run_duration_sec"] = state.runDurationSec;
    model["harvest_potential_l"] = state.harvestPotentialL;

    // 11. Controller & Decision Aliases
    JsonObject control = doc["controller"].to<JsonObject>();
    control["action"] = state.action;
    control["reason"] = state.reason;
    control["pump_active"] = state.pumpActive;
    control["prescribed_l"] = state.prescribedWaterL;
    control["est_runtime_sec"] = state.runDurationSec;
    control["automation_ready"] = (state.soilOK && state.tankOK && state.tankPercentage > CRITICAL_TANK_PCT);
    control["anomaly"] = state.anomaly;

    JsonObject decision = doc["decision"].to<JsonObject>();
    decision["action"] = state.action;
    decision["reason"] = state.reason;
    decision["pump_active"] = state.pumpActive;
    decision["confidence_percent"] = state.confidencePercent;
    decision["anomaly"] = state.anomaly;

    String jsonStr;
    serializeJson(doc, jsonStr);
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", jsonStr);
}

// POST /api/config?crop=1
void handleConfigAPI() {
    if (server.hasArg("crop")) {
        int idx = server.arg("crop").toInt();
        saveCropPreference(idx);
        evaluateSystemIntelligence();
    }
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", "{\"status\":\"OK\",\"crop\":" + String(currentCropIndex) + "}");
}

// POST /api/pump/override?state=on&duration=30
void handlePumpOverrideAPI() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    if (server.hasArg("state")) {
        String stateArg = server.arg("state");
        if (stateArg.equalsIgnoreCase("on")) {
            if (!state.soilOK || !state.tankOK || state.tankPercentage <= CRITICAL_TANK_PCT) {
                server.send(400, "application/json", "{\"status\":\"ERROR\",\"message\":\"Safety lockout prevents pump start\"}");
                return;
            }
            int durationSec = server.hasArg("duration") ? server.arg("duration").toInt() : 30;
            durationSec = min(durationSec, 180);

            state.pumpActive = true;
            state.manualOverride = true;
            state.pumpStartMillis = millis();
            state.targetPumpDurationMs = (unsigned long)durationSec * 1000UL;
            digitalWrite(RELAY_PIN, LOW); // Engage Pump Relay (Active-LOW)

            state.action = "MANUAL_OVERRIDE_ACTIVE";
            state.reason = "Manual override initiated via API for " + String(durationSec) + "s burst";
            server.send(200, "application/json", "{\"status\":\"OK\",\"pump\":\"ON\",\"duration_sec\":" + String(durationSec) + "}");
            return;
        } else if (stateArg.equalsIgnoreCase("off")) {
            digitalWrite(RELAY_PIN, HIGH); // Pump OFF
            state.pumpActive = false;
            state.manualOverride = false;
            state.lastPumpStopMillis = millis();
            state.action = "MANUAL_STOP";
            state.reason = "Pump stopped manually via API command.";
            server.send(200, "application/json", "{\"status\":\"OK\",\"pump\":\"OFF\"}");
            return;
        }
    }
    server.send(400, "application/json", "{\"status\":\"ERROR\",\"message\":\"Invalid state parameter. Use ?state=on or ?state=off\"}");
}


// ============================================================
// SYSTEM SETUP & INITIALIZATION
// ============================================================

void setup() {
    Serial.begin(115200);
    delay(300);

    Serial.println("\n========================================================");
    Serial.println("  ARIGATO KISAN MAX-CORE - SMART IRRIGATION SYSTEM      ");
    Serial.println("========================================================");

    // CRITICAL RELAY INITIALIZATION SAFETY:
    // Set output level HIGH *BEFORE* declaring pin as OUTPUT to prevent initial pulse on active-LOW relay!
    digitalWrite(RELAY_PIN, HIGH); // Pump OFF (Active-LOW: HIGH=OFF, LOW=ON)
    pinMode(RELAY_PIN, OUTPUT);

    digitalWrite(STATUS_LED_PIN, LOW);
    pinMode(STATUS_LED_PIN, OUTPUT);

    // Sensor Pin Modes & Explicit 12-Bit ADC Configuration
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);
    pinMode(SOIL_PIN, INPUT);
    pinMode(RAIN_ANALOG_PIN, INPUT);
    pinMode(RAIN_DIGITAL_PIN, INPUT_PULLUP);
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);


    // Load NVS Settings
    loadNVSSettings();

    // Initial Sensor Warm-Up Readings
    state.rawSoilADC = readFilteredADC(SOIL_PIN);
    state.rawRainADC = readFilteredADC(RAIN_ANALOG_PIN);
    state.isRaining = (digitalRead(RAIN_DIGITAL_PIN) == LOW);
    state.rawDistanceCM = readWaterproofUltrasonicCM();

    // Wi-Fi Connection Setup
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("[NETWORK] Connecting to Wi-Fi Station");
    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt < 6000)) {
        delay(250);
        Serial.print(".");
        digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[NETWORK] Station Online. IP Address: %s | RSSI: %d dBm\n", 
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
        digitalWrite(STATUS_LED_PIN, HIGH);
    } else {
        Serial.println("[NETWORK] Wi-Fi station connection timed out. Activating Access Point...");
        WiFi.mode(WIFI_AP);
        WiFi.softAP("AquaMatrix-Autonomous", "kisan1234");
        dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());
        Serial.printf("[NETWORK] Hotspot active at: http://%s/\n", WiFi.softAPIP().toString().c_str());
    }

    // OTA Configuration
    ArduinoOTA.setHostname("aquamatrix-maxcore");
    ArduinoOTA.setPassword("kisanota2026");
    ArduinoOTA.begin();

    // REST Endpoints
    server.on("/api/status", HTTP_GET, handleStatusAPI);
    server.on("/api/config", HTTP_POST, handleConfigAPI);
    server.on("/api/config", HTTP_GET, handleConfigAPI);
    server.on("/api/pump/override", HTTP_POST, handlePumpOverrideAPI);
    server.begin();

    // Initial Meteorology & Inference Execution
    fetchWeatherSync();
    evaluateSystemIntelligence();

    Serial.println("[ENGINE] Fail-Safe Autonomous Engine Initialized Successfully.\n");
}

// ============================================================
// MAIN SUPERVISOR LOOP
// ============================================================

void loop() {
    ArduinoOTA.handle();
    if (WiFi.getMode() == WIFI_AP) {
        dnsServer.processNextRequest();
    }
    server.handleClient();

    unsigned long currentMillis = millis();

    // Task 1: Non-Blocking Sensor Sampling & Decision Engine (Every 2s)
    if (currentMillis - lastSensorSample >= INTERVAL_SENSORS) {
        lastSensorSample = currentMillis;

        state.rawSoilADC = readFilteredADC(SOIL_PIN);
        state.rawRainADC = readFilteredADC(RAIN_ANALOG_PIN);
        state.rawRainDigitalState = digitalRead(RAIN_DIGITAL_PIN);
        state.rawDistanceCM = readWaterproofUltrasonicCM();

        evaluateSystemIntelligence();
    }

    // Task 2: Weather Model Sync (Every 30 mins)
    if (currentMillis - lastWeatherFetch >= INTERVAL_WEATHER) {
        lastWeatherFetch = currentMillis;
        fetchWeatherSync();
    }

    // Task 3: Serial Debug Output (Every 4s)
    if (currentMillis - lastTelemetryPrint >= INTERVAL_PRINT) {
        lastTelemetryPrint = currentMillis;

        Serial.printf("[FARM TELEMETRY] Action: %s | Pump: %s | Soil ADC: %d (%s) | Tank: %.1f%% | Conf: %d%%\n",
                      state.action.c_str(),
                      state.pumpActive ? "ON" : "OFF",
                      state.rawSoilADC,
                      state.soilOK ? "OK" : "FAULT",
                      state.tankPercentage,
                      state.confidencePercent);
    }
}

