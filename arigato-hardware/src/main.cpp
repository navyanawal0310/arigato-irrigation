#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include "secrets.h"
// ============================================================
// ARIGATO ALGORITHMS
// QUANTITATIVE IRRIGATION DECISION ENGINE - V2
// ============================================================
//
// Inputs:
//   1. HW-390 moisture response sensor
//   2. JSN-SR04T reservoir level sensor
//
// Outputs:
//   - Moisture Response Index (0-100)
//   - Dryness Score (0-100)
//   - Tank Level (0-100%)
//   - Estimated Water Volume
//   - Irrigation Need Score (0-100)
//   - Confidence Score (0-100)
//   - Explainable irrigation recommendation
//
// IMPORTANT:
// Soil calibration values are PROTOTYPE values.
// Replace DRY_ADC and WET_ADC after real soil calibration.
//
// ============================================================
// ============================================================
// LOCAL WEB API - V3.5
// ============================================================

WebServer server(80);

// Latest calculated values exposed to dashboard

float apiMoistureIndex = 0;
float apiDryness = 0;

float apiTankLevel = 0;
float apiTankDistance = 0;
float apiWaterAvailableML = 0;

float apiTemperature = 0;
float apiHumidity = 0;
float apiRain = 0;
float apiEffectiveRain = 0;
float apiET0 = 0;

float apiCropET = 0;
float apiNetDemand = 0;
float apiRecommendedWater = 0;
float apiConfidence = 0;

String apiReservoirState = "UNKNOWN";
String apiAction = "STARTING";
String apiPriority = "UNKNOWN";
String apiReason = "System starting";
String apiWeatherSource = "UNKNOWN";

bool apiAutomationReady = false;
bool apiSoilOK = false;
bool apiTankOK = false;

// ------------------------------------------------------------
// PIN CONFIGURATION
// ------------------------------------------------------------

const int SOIL_PIN = 34;

const int TRIG_PIN = 5;
const int ECHO_PIN = 18;



// ============================================================
// FIELD LOCATION - PROTOTYPE
// ============================================================

const float FIELD_LATITUDE  = 12.9716;
const float FIELD_LONGITUDE = 77.5946;

// ============================================================
// RAINFALL MODEL
// ============================================================

// Prototype assumption:
// 80% of forecast rainfall is treated as effectively
// available to the crop root zone.

const float RAIN_EFFECTIVENESS = 0.80;

// ============================================================
// LIVE WEATHER DATA
// ============================================================

struct WeatherData
{
    float temperature = 0;
    float humidity = 0;
    float precipitation = 0;
    float et0 = 0;

    bool valid = false;
};

WeatherData weather;

// ------------------------------------------------------------
// PROTOTYPE SOIL CALIBRATION
// ------------------------------------------------------------
//
// ESP32 ADC range is approximately 0-4095.
//
// These are provisional demonstration endpoints.
// They are NOT being claimed as calibrated soil moisture values.
//

// ============================================================
// EMPIRICAL SOIL CALIBRATION
// ============================================================
//
// Calibrated using the current HW-390 + soil test setup.
//
// Dry soil observed ≈ 1790-1870 ADC
// Wet soil observed ≈ 180 ADC
//
// These values represent a prototype Moisture Response Index,
// not laboratory volumetric water content.
//

const int DRY_ADC = 1800;
const int WET_ADC = 180;


// ------------------------------------------------------------
// RESERVOIR CALIBRATION
// ------------------------------------------------------------

const float EMPTY_DISTANCE = 22.7;
const float FULL_DISTANCE  = 20.9;

const float TANK_CAPACITY_ML = 150.0;

// ============================================================
// FARM PROFILE - V3
// ============================================================

// Demonstration field configuration
const char* CROP_NAME = "Tomato";
const char* GROWTH_STAGE = "Vegetative";
const char* SOIL_TYPE = "Loamy";

// Demonstration field area
const float FIELD_AREA_M2 = 100.0;


// ------------------------------------------------------------
// CROP COEFFICIENT
// ------------------------------------------------------------
//
// Kc represents crop water demand relative to reference
// evapotranspiration.
//
// IMPORTANT:
// This is a configurable prototype parameter.
// Later it can come from a crop-profile database.
//

const float CROP_COEFFICIENT_KC = 0.75;

// ============================================================
// RAINFALL MODEL
// ============================================================

// ------------------------------------------------------------
// WEATHER INPUT - V3.0
// ------------------------------------------------------------
//
// Initially entered as demonstration inputs.
// Later these will come from a weather API.
//

// ============================================================
// WEATHER FALLBACK VALUES
// Used only if live weather cannot be retrieved
// ============================================================

const float FALLBACK_ET0_MM = 4.5;
const float FALLBACK_RAIN_MM = 0.0;


// ------------------------------------------------------------
// THRESHOLDS
// ------------------------------------------------------------

const float CRITICAL_TANK = 15.0;
const float LOW_TANK      = 30.0;


// ============================================================
// UTILITY
// ============================================================

float clampFloat(float value, float minimum, float maximum)
{
    if (value < minimum)
        return minimum;

    if (value > maximum)
        return maximum;

    return value;
}


// ============================================================
// HW-390 FILTERED ADC
// ============================================================

int readFilteredSoilADC()
{
    const int SAMPLE_COUNT = 20;

    long total = 0;

    for (int i = 0; i < SAMPLE_COUNT; i++)
    {
        total += analogRead(SOIL_PIN);

        delay(10);
    }

    return total / SAMPLE_COUNT;
}


// ============================================================
// MOISTURE RESPONSE INDEX
// ============================================================
//
// MRI = 0   -> prototype dry endpoint
// MRI = 100 -> prototype wet endpoint
//
// This is NOT yet agronomic volumetric water content.
//

float calculateMoistureIndex(int adc)
{
    float moisture =
        ((float)(DRY_ADC - adc) /
        (float)(DRY_ADC - WET_ADC))
        * 100.0;

    return clampFloat(moisture, 0, 100);
}


// ============================================================
// DRYNESS SCORE
// ============================================================

float calculateDryness(float moistureIndex)
{
    return 100.0 - moistureIndex;
}


// ============================================================
// SINGLE JSN READING
// ============================================================

float readDistanceOnce()
{
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(5);

    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);

    digitalWrite(TRIG_PIN, LOW);

    unsigned long duration =
        pulseIn(ECHO_PIN, HIGH, 100000UL);

    if (duration == 0)
        return -1;

    return (duration * 0.0343f) / 2.0f;
}

float calculateEffectiveRain(float forecastRain)
{
    return forecastRain * RAIN_EFFECTIVENESS;
}

// ============================================================
// FILTERED JSN READING
// ============================================================

float readFilteredDistance()
{
    const int SAMPLE_COUNT = 7;

    float total = 0;
    int validSamples = 0;

    for (int i = 0; i < SAMPLE_COUNT; i++)
    {
        float distance = readDistanceOnce();

        if (distance > 0)
        {
            total += distance;
            validSamples++;
        }

        delay(70);
    }

    if (validSamples == 0)
        return -1;

    return total / validSamples;
}


// ============================================================
// TANK LEVEL
// ============================================================

float calculateTankPercentage(float distance)
{
    float percentage =
        ((EMPTY_DISTANCE - distance) /
        (EMPTY_DISTANCE - FULL_DISTANCE))
        * 100.0;

    return clampFloat(percentage, 0, 100);
}


// ============================================================
// WATER VOLUME
// ============================================================

float calculateWaterVolume(float tankPercentage)
{
    return
        (tankPercentage / 100.0)
        * TANK_CAPACITY_ML;
}


// ============================================================
// IRRIGATION NEED SCORE
// ============================================================
//
// V2:
//
// INS is currently driven by dryness.
//
// This is intentionally kept separate from reservoir level.
//
// Tank level answers:
// "CAN we irrigate?"
//
// Dryness answers:
// "DO we need irrigation?"
//
// Future V3:
// INS will also include crop demand, weather and rain forecast.
//

float calculateIrrigationNeed(float dryness)
{
    // Non-linear response:
    //
    // Dryness < 30:
    // Little/no irrigation requirement
    //
    // Dryness 30-70:
    // Increasing requirement
    //
    // Dryness > 70:
    // Strong irrigation requirement

    float score;

    if (dryness < 30)
    {
        score = dryness * 0.5;
    }

    else if (dryness < 70)
    {
        score =
            15.0 +
            ((dryness - 30.0) * 1.5);
    }

    else
    {
        score =
            75.0 +
            ((dryness - 70.0) * 0.8333);
    }

    return clampFloat(score, 0, 100);
}


// ============================================================
// CONFIDENCE SCORE
// ============================================================

float calculateConfidence(
    bool soilOK,
    bool tankOK,
    int validTankCondition
)
{
    float confidence = 100.0;

    if (!soilOK)
        confidence -= 50;

    if (!tankOK)
        confidence -= 40;

    if (!validTankCondition)
        confidence -= 10;

    // Soil is prototype calibrated,
    // therefore cap confidence for V2.

    if (confidence > 85)
        confidence = 85;

    return clampFloat(confidence, 0, 100);
}


// ============================================================
// RESERVOIR CLASSIFICATION
// ============================================================

String getTankState(float tankPercentage)
{
    if (tankPercentage < CRITICAL_TANK)
        return "CRITICAL";

    if (tankPercentage < LOW_TANK)
        return "LOW";

    if (tankPercentage < 70)
        return "AVAILABLE";

    return "GOOD";
}


// ============================================================
// IRRIGATION CLASSIFICATION
// ============================================================

String getNeedState(float score)
{
    if (score < 25)
        return "LOW";

    if (score < 50)
        return "MODERATE";

    if (score < 75)
        return "HIGH";

    return "CRITICAL";
}


// ============================================================
// FINAL DECISION ENGINE
// ============================================================

String calculateDecision(
    float irrigationNeed,
    float tankPercentage,
    bool soilOK,
    bool tankOK
)
{
    // Sensor safety comes first

    if (!soilOK || !tankOK)
    {
        return "CHECK SENSORS";
    }


    // Reservoir safety gate

    if (tankPercentage < CRITICAL_TANK)
    {
        return "HOLD - WATER CRITICAL";
    }


    // Low irrigation requirement

    if (irrigationNeed < 25)
    {
        return "NO IRRIGATION";
    }


    // Moderate requirement

    if (irrigationNeed < 50)
    {
        return "MONITOR";
    }


    // Irrigation required but reservoir low

    if (tankPercentage < LOW_TANK)
    {
        return "DELAY - LOW WATER";
    }


    // High irrigation requirement

    if (irrigationNeed < 75)
    {
        return "IRRIGATE SOON";
    }


    // Critical irrigation requirement

    return "IRRIGATE NOW";
}


// ============================================================
// EXPLANATION ENGINE
// ============================================================

String generateReason(
    float irrigationNeed,
    float tankPercentage,
    bool soilOK,
    bool tankOK
)
{
    if (!soilOK)
        return "Moisture sensor reading invalid";

    if (!tankOK)
        return "Reservoir sensor unavailable";

    if (tankPercentage < CRITICAL_TANK)
        return "Insufficient reservoir water";

    if (irrigationNeed < 25)
        return "Moisture response indicates low water demand";

    if (irrigationNeed < 50)
        return "Moderate dryness; continue monitoring";

    if (tankPercentage < LOW_TANK)
        return "Irrigation demand exists but reservoir is low";

    if (irrigationNeed < 75)
        return "High dryness with sufficient reservoir water";

    return "Severe dryness with sufficient reservoir water";
}

// ============================================================
// CROP EVAPOTRANSPIRATION
// ============================================================

float calculateCropET(
    float referenceET,
    float cropCoefficient
)
{
    return referenceET * cropCoefficient;
}


// ============================================================
// NET IRRIGATION DEPTH
// ============================================================

float calculateNetIrrigationDepth(
    float cropET,
    float effectiveRain
)
{
    float requirement =
        cropET - effectiveRain;

    if (requirement < 0)
    {
        requirement = 0;
    }

    return requirement;
}


// ============================================================
// WATER REQUIREMENT
// ============================================================
//
// 1 mm water over 1 m² = 1 litre
//

float calculateWaterRequirementLitres(
    float irrigationDepthMM,
    float fieldAreaM2
)
{
    return irrigationDepthMM * fieldAreaM2;
}
// ============================================================
// SOIL WATER STRESS FACTOR
// ============================================================
//
// Converts the prototype dryness index into a continuous
// irrigation-demand multiplier.
//
// 0.0 = soil response does not justify irrigation
// 1.0 = full calculated crop demand may be required
//

float calculateSoilStressFactor(float dryness)
{
    if (dryness <= 25.0)
    {
        return 0.0;
    }

    if (dryness >= 75.0)
    {
        return 1.0;
    }

    return (dryness - 25.0) / 50.0;
}
void connectWiFi()
{
    Serial.println();
    Serial.println("Connecting to WiFi...");

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;

    while (
        WiFi.status() != WL_CONNECTED &&
        attempts < 20
    )
    {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED)
    {
        Serial.println("WiFi Status : CONNECTED");

        Serial.print("IP Address  : ");
        Serial.println(WiFi.localIP());

        Serial.print("Signal RSSI : ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
    }
    else
    {
        Serial.println("WiFi Status : FAILED");
        Serial.println("Running in offline mode.");
    }
}
// ============================================================
// FETCH LIVE WEATHER
// ============================================================

bool fetchWeather()
{
    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println("WEATHER : WiFi unavailable");
        return false;
    }

    HTTPClient http;

    String url =
        "https://api.open-meteo.com/v1/forecast?"
        "latitude=" + String(FIELD_LATITUDE, 4) +
        "&longitude=" + String(FIELD_LONGITUDE, 4) +
        "&current=temperature_2m,relative_humidity_2m,precipitation"
        "&daily=et0_fao_evapotranspiration,precipitation_sum"
        "&forecast_days=1"
        "&timezone=auto";

    Serial.println();
    Serial.println("Fetching live weather...");

    http.begin(url);

    int httpCode = http.GET();

    if (httpCode != 200)
    {
        Serial.print("WEATHER HTTP ERROR : ");
        Serial.println(httpCode);

        http.end();
        return false;
    }

    String payload = http.getString();

    JsonDocument doc;

    DeserializationError error =
        deserializeJson(doc, payload);

    if (error)
    {
        Serial.print("WEATHER JSON ERROR : ");
        Serial.println(error.c_str());

        http.end();
        return false;
    }

    // Current observations
    weather.temperature =
        doc["current"]["temperature_2m"] | 0.0;

    weather.humidity =
        doc["current"]["relative_humidity_2m"] | 0.0;

    weather.precipitation =
        doc["daily"]["precipitation_sum"][0] | 0.0;

    weather.et0 =
        doc["daily"]["et0_fao_evapotranspiration"][0] | 0.0;

    weather.valid = true;

    http.end();

    return true;
}
// ============================================================
// UNIFIED DECISION RESULT - V3.4
// ============================================================

struct DecisionResult
{
    String action;
    String reason;
    String priority;

    float recommendedLitres;
    float confidence;

    bool irrigationRequired;
};


// ============================================================
// UNIFIED DECISION ENGINE - V3.4
// ============================================================

DecisionResult makeUnifiedDecision(
    float dryness,
    float soilStress,
    float cropET,
    float effectiveRain,
    float tankPercentage,
    float recommendedLitres,
    bool soilOK,
    bool tankOK,
    bool weatherOK
)
{
    DecisionResult result;

    result.recommendedLitres = recommendedLitres;
    result.irrigationRequired = false;

    // --------------------------------------------------------
    // CONFIDENCE
    // --------------------------------------------------------

    float confidence = 100.0;

    // Soil calibration is still prototype-grade
    confidence -= 15.0;

    if (!weatherOK)
        confidence -= 20.0;

    if (!soilOK)
        confidence -= 45.0;

    if (!tankOK)
        confidence -= 35.0;

    result.confidence =
        clampFloat(confidence, 0, 100);


    // --------------------------------------------------------
    // SAFETY GATE 1 - SENSOR FAILURE
    // --------------------------------------------------------

    if (!soilOK || !tankOK)
    {
        result.action = "SAFE HOLD";
        result.priority = "FAULT";
        result.reason =
            "Required field sensor unavailable";

        result.recommendedLitres = 0;

        return result;
    }


    // --------------------------------------------------------
    // SAFETY GATE 2 - NO AGRONOMIC DEMAND
    // --------------------------------------------------------

    if (recommendedLitres <= 0.1)
    {
        result.action = "NO IRRIGATION";
        result.priority = "LOW";

        if (effectiveRain >= cropET)
        {
            result.reason =
                "Effective rainfall covers crop water demand";
        }
        else
        {
            result.reason =
                "Current soil response does not justify irrigation";
        }

        result.recommendedLitres = 0;

        return result;
    }


    // --------------------------------------------------------
    // SAFETY GATE 3 - RESERVOIR CRITICAL
    // --------------------------------------------------------

    if (tankPercentage < 15.0)
    {
        result.action = "HOLD - REFILL RESERVOIR";
        result.priority = "CRITICAL";

        result.reason =
            "Irrigation required but reservoir is critically low";

        result.recommendedLitres = 0;

        return result;
    }


    // --------------------------------------------------------
    // LOW RESERVOIR
    // --------------------------------------------------------

    if (tankPercentage < 30.0)
    {
        result.action = "DELAY - LOW WATER";
        result.priority = "HIGH";

        result.reason =
            "Crop requires water but reservoir availability is low";

        return result;
    }


    // --------------------------------------------------------
    // LOW SOIL STRESS
    // --------------------------------------------------------

    if (soilStress < 0.25)
    {
        result.action = "MONITOR";
        result.priority = "LOW";

        result.reason =
            "Low soil stress; irrigation demand remains limited";

        return result;
    }


    // --------------------------------------------------------
    // MODERATE REQUIREMENT
    // --------------------------------------------------------

    if (soilStress < 0.60)
    {
        result.action = "IRRIGATE SOON";
        result.priority = "MODERATE";

        result.reason =
            "Moderate soil stress and positive net crop water demand";

        result.irrigationRequired = true;

        return result;
    }


    // --------------------------------------------------------
    // HIGH REQUIREMENT
    // --------------------------------------------------------

    result.action = "IRRIGATE NOW";
    result.priority = "HIGH";

    result.reason =
        "High soil stress, positive crop demand and sufficient water";

    result.irrigationRequired = true;

    return result;
}
void handleStatusAPI()
{
    JsonDocument doc;

    // --------------------------------------------------------
    // SYSTEM
    // --------------------------------------------------------

    doc["system"]["name"] = "ARIGATO";
    doc["system"]["version"] = "3.5";
    doc["system"]["online"] = true;
    doc["system"]["uptime_seconds"] = millis() / 1000;

    // --------------------------------------------------------
    // FIELD
    // --------------------------------------------------------

    doc["field"]["crop"] = CROP_NAME;
    doc["field"]["growth_stage"] = GROWTH_STAGE;
    doc["field"]["soil_type"] = SOIL_TYPE;
    doc["field"]["area_m2"] = FIELD_AREA_M2;

    // --------------------------------------------------------
    // SOIL
    // --------------------------------------------------------

    doc["soil"]["sensor_ok"] = apiSoilOK;
    doc["soil"]["moisture_index"] = apiMoistureIndex;
    doc["soil"]["dryness_score"] = apiDryness;

    // --------------------------------------------------------
    // RESERVOIR
    // --------------------------------------------------------

    doc["reservoir"]["sensor_ok"] = apiTankOK;
    doc["reservoir"]["distance_cm"] = apiTankDistance;
    doc["reservoir"]["level_percent"] = apiTankLevel;
    doc["reservoir"]["water_ml"] = apiWaterAvailableML;
    doc["reservoir"]["state"] = apiReservoirState;

    // --------------------------------------------------------
    // WEATHER
    // --------------------------------------------------------

    doc["weather"]["source"] = apiWeatherSource;
    doc["weather"]["temperature_c"] = apiTemperature;
    doc["weather"]["humidity_percent"] = apiHumidity;
    doc["weather"]["forecast_rain_mm"] = apiRain;
    doc["weather"]["effective_rain_mm"] = apiEffectiveRain;
    doc["weather"]["et0_mm_day"] = apiET0;

    // --------------------------------------------------------
    // AGRONOMIC MODEL
    // --------------------------------------------------------

    doc["model"]["crop_et_mm_day"] = apiCropET;
    doc["model"]["net_demand_mm"] = apiNetDemand;
    doc["model"]["recommended_water_l"] =
        apiRecommendedWater;

    // --------------------------------------------------------
    // DECISION
    // --------------------------------------------------------

    doc["decision"]["action"] = apiAction;
    doc["decision"]["priority"] = apiPriority;
    doc["decision"]["confidence_percent"] =
        apiConfidence;

    doc["decision"]["reason"] = apiReason;
    doc["decision"]["automation_ready"] =
        apiAutomationReady;

    String json;

    serializeJson(doc, json);

    // Allow React development server to access ESP32
    server.sendHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    server.send(
        200,
        "application/json",
        json
    );
}
// ============================================================
// SETUP
// ============================================================

void setup()
{
    Serial.begin(115200);
    connectWiFi();
    if (fetchWeather())
{
    Serial.println();
    Serial.println("========= LIVE WEATHER =========");

    Serial.print("Temperature : ");
    Serial.print(weather.temperature, 1);
    Serial.println(" C");

    Serial.print("Humidity    : ");
    Serial.print(weather.humidity, 0);
    Serial.println(" %");

    Serial.print("Rain Today  : ");
    Serial.print(weather.precipitation, 2);
    Serial.println(" mm");

    Serial.print("FAO ET0     : ");
    Serial.print(weather.et0, 2);
    Serial.println(" mm/day");

    Serial.println("===============================");
}
else
{
    Serial.println();
    Serial.println("Weather unavailable - using fallback data.");
}
if (WiFi.status() == WL_CONNECTED)
{
    server.on(
        "/api/status",
        HTTP_GET,
        handleStatusAPI
    );

    server.begin();

    Serial.println();
    Serial.println("ARIGATO API SERVER STARTED");

    Serial.print("Dashboard API : http://");
    Serial.print(WiFi.localIP());
    Serial.println("/api/status");
}
    pinMode(SOIL_PIN, INPUT);

    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);

    digitalWrite(TRIG_PIN, LOW);

    delay(1500);

    Serial.println();
    Serial.println("==========================================");
    Serial.println("       ARIGATO DECISION ENGINE V3.3");
    Serial.println("==========================================");
    Serial.println("Quantitative Irrigation Intelligence");
    Serial.println("Prototype Calibration Mode");
    Serial.println("==========================================");
}


// ============================================================
// MAIN LOOP
// ============================================================

void loop()
{
    server.handleClient();
    // --------------------------------------------------------
    // READ SENSORS
    // --------------------------------------------------------
    
    int soilADC =
        readFilteredSoilADC();

    float distance =
        readFilteredDistance();


    // --------------------------------------------------------
    // SENSOR HEALTH
    // --------------------------------------------------------

        bool soilOK =
        soilADC > 20 &&
        soilADC < 4090;

    bool tankOK =
        distance > 0;


    // --------------------------------------------------------
    // SOIL CALCULATIONS
    // --------------------------------------------------------

    float moistureIndex = 0.0;
    float dryness = 0.0;

    if (soilOK)
    {
        moistureIndex =
            calculateMoistureIndex(soilADC);

        dryness =
            calculateDryness(moistureIndex);
    }

    // --------------------------------------------------------
    // TANK CALCULATIONS
    // --------------------------------------------------------

    float tankPercentage = 0;

    float waterVolume = 0;


    if (tankOK)
    {
        tankPercentage =
            calculateTankPercentage(distance);

        waterVolume =
            calculateWaterVolume(tankPercentage);
    }


    // --------------------------------------------------------
    // IRRIGATION ENGINE
    // --------------------------------------------------------

    float irrigationNeed =
        calculateIrrigationNeed(dryness);


    String needState =
        getNeedState(irrigationNeed);


    String tankState =
        tankOK
        ? getTankState(tankPercentage)
        : "ERROR";


    int tankCalibrationValid =
        tankOK ? 1 : 0;


    float confidence =
        calculateConfidence(
            soilOK,
            tankOK,
            tankCalibrationValid
        );


    String decision =
        calculateDecision(
            irrigationNeed,
            tankPercentage,
            soilOK,
            tankOK
        );


    String reason =
        generateReason(
            irrigationNeed,
            tankPercentage,
            soilOK,
            tankOK
        );
// ============================================================
// WEATHER INPUT SELECTION
// ============================================================

float activeET0;
float activeRain;
String weatherSource;

if (weather.valid)
{
    activeET0 = weather.et0;
    activeRain = weather.precipitation;
    weatherSource = "LIVE";
}
else
{
    activeET0 = FALLBACK_ET0_MM;
    activeRain = FALLBACK_RAIN_MM;
    weatherSource = "FALLBACK";
}
// ============================================================
// AGRONOMIC WATER DEMAND - V3.3
// ============================================================

float cropET =
    calculateCropET(
        activeET0,
        CROP_COEFFICIENT_KC
    );

// Convert forecast rainfall into estimated effective rainfall
float effectiveRain =
    calculateEffectiveRain(activeRain);

// Crop demand remaining after effective rainfall
float netIrrigationDepth =
    calculateNetIrrigationDepth(
        cropET,
        effectiveRain
    );

// Convert mm of irrigation requirement into litres
float theoreticalWaterRequirement =
    calculateWaterRequirementLitres(
        netIrrigationDepth,
        FIELD_AREA_M2
    );

// Soil response modifies the theoretical crop demand
float soilStressFactor =
    calculateSoilStressFactor(dryness);

float recommendedWaterLitres =
    theoreticalWaterRequirement
    * soilStressFactor;

float waterSavingLitres =
    theoreticalWaterRequirement
    - recommendedWaterLitres;

float waterSavingPercent = 0.0;

if (theoreticalWaterRequirement > 0)
{
    waterSavingPercent =
        (waterSavingLitres /
        theoreticalWaterRequirement)
        * 100.0;
}
DecisionResult finalDecision =
    makeUnifiedDecision(
        dryness,
        soilStressFactor,
        cropET,
        effectiveRain,
        tankPercentage,
        recommendedWaterLitres,
        soilOK,
        tankOK,
        weather.valid
    );

    // ========================================================
    // OUTPUT
    // ========================================================

    Serial.println();
    Serial.println(
        "=============== FIELD DATA ==============="
    );


    Serial.println();
    Serial.println("SOIL / MOISTURE RESPONSE");

Serial.print("Raw ADC             : ");
Serial.println(soilADC);

Serial.print("Sensor Status       : ");
Serial.println(soilOK ? "OK" : "FAULT");

if (soilOK)
{
    Serial.print("Moisture Index      : ");
    Serial.print(moistureIndex, 1);
    Serial.println(" / 100");

    Serial.print("Dryness Score       : ");
    Serial.print(dryness, 1);
    Serial.println(" / 100");
}
else
{
    Serial.println("Moisture Index      : UNAVAILABLE");
    Serial.println("Dryness Score       : UNAVAILABLE");
}
    Serial.println();
    Serial.println(
        "RESERVOIR"
    );


    if (tankOK)
    {
        Serial.print(
            "Distance            : "
        );

        Serial.print(distance, 2);

        Serial.println(" cm");


        Serial.print(
            "Tank Level          : "
        );

        Serial.print(tankPercentage, 1);

        Serial.println(" %");


        Serial.print(
            "Estimated Water     : "
        );

        Serial.print(waterVolume, 0);

        Serial.println(" mL");


        Serial.print(
            "Reservoir State     : "
        );

        Serial.println(tankState);
    }

    else
    {
        Serial.println(
            "JSN Sensor          : ERROR"
        );
    }


    Serial.println();
    Serial.println(
        "============= INTELLIGENCE ==============="
    );


    Serial.print(
        "Irrigation Need     : "
    );

    Serial.print(irrigationNeed, 1);

    Serial.println(" / 100");


    Serial.print(
        "Need Classification : "
    );

    Serial.println(needState);


    Serial.print(
        "Confidence          : "
    );

    Serial.print(confidence, 0);

    Serial.println(" %");


    Serial.println();
    Serial.println();
Serial.println(
    "============== CROP MODEL ================"
);

Serial.print(
    "Crop                : "
);
Serial.println(CROP_NAME);

Serial.print(
    "Growth Stage        : "
);
Serial.println(GROWTH_STAGE);

Serial.print(
    "Soil Type           : "
);
Serial.println(SOIL_TYPE);

Serial.print(
    "Field Area          : "
);
Serial.print(FIELD_AREA_M2, 0);
Serial.println(" m2");

Serial.print(
    "Crop Coefficient Kc : "
);
Serial.println(CROP_COEFFICIENT_KC, 2);

Serial.print(
    "Reference ET0       : "
);
Serial.print(activeET0, 2);
Serial.println(" mm/day");

Serial.print(
    "Crop ET             : "
);
Serial.print(cropET, 2);
Serial.println(" mm/day");

Serial.print(
    "Expected Rain       : "
);
Serial.print(activeRain, 2);
Serial.println(" mm");
Serial.print(
    "Effective Rain      : "
);
Serial.print(effectiveRain, 2);
Serial.println(" mm");
Serial.print(
    "Net Water Demand    : "
);
Serial.print(netIrrigationDepth, 2);
Serial.println(" mm");

Serial.print(
    "Theoretical Water   : "
);
Serial.print(theoreticalWaterRequirement, 1);
Serial.println(" L/day");

Serial.println();
Serial.print("Weather Source      : ");
Serial.println(weatherSource);
Serial.println(
    "=========== SMART PRESCRIPTION ==========="
);

Serial.print(
    "Soil Stress Factor  : "
);
Serial.println(soilStressFactor, 2);


Serial.print(
    "Maximum Crop Demand : "
);
Serial.print(theoreticalWaterRequirement, 1);
Serial.println(" L/day");


Serial.print(
    "Recommended Water   : "
);
Serial.print(recommendedWaterLitres, 1);
Serial.println(" L");


Serial.print(
    "Water Avoided       : "
);
Serial.print(waterSavingLitres, 1);
Serial.println(" L");


Serial.print(
    "Potential Saving    : "
);
Serial.print(waterSavingPercent, 1);
Serial.println(" %");
Serial.println();
Serial.println(
    "========== UNIFIED DECISION V3.4 ========="
);

Serial.print("ACTION              : ");
Serial.println(finalDecision.action);

Serial.print("PRIORITY            : ");
Serial.println(finalDecision.priority);

Serial.print("RECOMMENDED WATER   : ");
Serial.print(finalDecision.recommendedLitres, 1);
Serial.println(" L");

Serial.print("CONFIDENCE          : ");
Serial.print(finalDecision.confidence, 0);
Serial.println(" %");

Serial.print("WHY                 : ");
Serial.println(finalDecision.reason);

Serial.print("AUTOMATION READY    : ");

if (finalDecision.irrigationRequired)
{
    Serial.println("YES");
}
else
{
    Serial.println("NO");
}

// ============================================================
// UPDATE DASHBOARD DATA
// ============================================================

apiMoistureIndex = moistureIndex;
apiDryness = dryness;

apiTankDistance = distance;
apiTankLevel = tankPercentage;
apiWaterAvailableML = waterVolume;

apiReservoirState = tankState;

apiTemperature = weather.temperature;
apiHumidity = weather.humidity;

apiRain = activeRain;
apiEffectiveRain = effectiveRain;
apiET0 = activeET0;

apiCropET = cropET;
apiNetDemand = netIrrigationDepth;

apiRecommendedWater =
    finalDecision.recommendedLitres;

apiConfidence =
    finalDecision.confidence;

apiAction =
    finalDecision.action;

apiPriority =
    finalDecision.priority;

apiReason =
    finalDecision.reason;

apiAutomationReady =
    finalDecision.irrigationRequired;

apiWeatherSource =
    weatherSource;

apiSoilOK = soilOK;
apiTankOK = tankOK;
Serial.println(
    "=========================================="
);
    Serial.println(
        "=========================================="
    );


    delay(2500);
}