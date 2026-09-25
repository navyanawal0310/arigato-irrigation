# ARIGATO Kisan Edge Node Firmware (`arigato-hardware`)

ARIGATO is an ESP32-powered smart irrigation prototype engineered for smallholder farmers. The firmware combines real-time subterranean soil stress sensing, raindrop detection, ultrasonic reservoir telemetry, local agricultural disease forecasting, and Open-Meteo FAO-56 evapotranspiration models to deliver autonomous, fail-safe volumetric irrigation.

---

## 1. Hardware Architecture & Component List

1. **ESP32 Dev Module (ESP-WROOM-32)**: Main microcontroller handling sensor acquisition, closed-loop decision arbitration, Wi-Fi connectivity, HTTP server, and OTA updates.
2. **Capacitive Soil Moisture Sensor (HW-390 / v1.2)**: Measures rootzone volumetric water content via analog voltage output (ADC1).
3. **Raindrop Detector Module**: Combined analog wetness plate (ADC1) and digital comparator board (digital rain interrupt).
4. **JSN-SR04T Waterproof Ultrasonic Sensor**: Measures water depth/volume in the reservoir (20cm to 450cm operating range with blind-zone filtering).
5. **Active-LOW Relay Module**: Controls the 12V DC / AC irrigation pump (Relay ON when pin is driven LOW).
6. **Diagnostic Status LED**: Indicates Wi-Fi connection and station status.

---

## 2. Pin Mapping Table

| Component | Pin Function | ESP32 GPIO Pin | Pin Type | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Soil Moisture Sensor** | Analog VOUT | `GPIO 34` | ADC1 Channel 6 | Input only; requires ADC1 for Wi-Fi co-existence |
| **Raindrop Sensor (Analog)** | Analog VOUT | `GPIO 35` | ADC1 Channel 7 | Surface wetness depth measurement |
| **Raindrop Sensor (Digital)** | Digital OUT | `GPIO 19` | GPIO In (Internal Pullup) | Active-LOW precipitation interrupt |
| **JSN-SR04T Ultrasonic** | Trigger (TRIG) | `GPIO 5` | GPIO Output | Requires >= 10-15µs pulse |
| **JSN-SR04T Ultrasonic** | Echo (ECHO) | `GPIO 18` | GPIO Input | Pulse duration measurement (20cm-400cm) |
| **Pump Relay** | Control Signal | `GPIO 23` | GPIO Output | **Active-LOW**: `HIGH` = Pump OFF, `LOW` = Pump ON |
| **Status LED** | Diagnostic LED | `GPIO 2` | GPIO Output | Onboard LED indicator |

---

## 3. Required Libraries & Platform IO Environment

The firmware is built using **PlatformIO** with the **Espressif 32 (v7.1.3+)** framework.

Dependencies (managed automatically via `platformio.ini`):
- `bblanchon/ArduinoJson @ ^7.4.3`
- `WiFi @ ^2.0.0`
- `HTTPClient @ ^2.0.0`
- `WebServer @ ^2.0.0`
- `DNSServer @ ^2.0.0`
- `ArduinoOTA @ ^2.0.0`

---

## 4. Configuration & Credential Setup (`secrets.h`)

Wi-Fi credentials are kept private and must never be committed to repository history.

1. Copy `include/secrets.example.h` to `include/secrets.h`:
   ```bash
   cp include/secrets.example.h include/secrets.h
   ```
2. Edit `include/secrets.h` to enter your local Wi-Fi SSID and Password:
   ```cpp
   #pragma once
   const char* WIFI_SSID = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   ```
3. `secrets.h` is strictly ignored by `.gitignore`.

---

## 5. PlatformIO Commands

### Build Firmware
```bash
pio run
# Or using explicit executable path:
& "$HOME\.platformio\penv\Scripts\pio.exe" run
```

### Upload Firmware to ESP32
```bash
pio run --target upload
```

### Launch Serial Monitor (115200 Baud)
```bash
pio device monitor --baud 115200
```

---

## 6. Advanced Features & Agronomic Models

### 1. EEPROM / NVS Non-Volatile Persistence
The ESP32 `Preferences` API automatically persists cumulative field statistics into flash NVS memory:
- **`daily_water_litres`**: Total water dispensed today ($L$).
- **`total_water_litres`**: Lifetime water volume pumped ($L$).
- **`pump_cycles_count`**: Total pump activation cycles.
- **`water_saved_litres`**: Estimated water saved compared to a traditional un-calibrated 50L fixed timer schedule.
- **`crop_profile_id`**: Active crop configuration index.

### 2. Multi-Crop Phenology Selector
The firmware supports 5 pre-calibrated crop phenology profiles with specific $K_c$ crop factors and Management Allowed Depletion (MAD) stress thresholds:
1. `TOMATO_VEG`: Tomato (Vegetative) — $K_c = 0.85$, $MAD = 50\%$
2. `TOMATO_FRUIT`: Tomato (Fruiting) — $K_c = 1.15$, $MAD = 40\%$
3. `POTATO`: Potato (Tuber Growth) — $K_c = 1.05$, $MAD = 45\%$
4. `CHILI_PEPPER`: Chili Pepper — $K_c = 0.95$, $MAD = 45\%$
5. `LEAFY_GREENS`: Leafy Greens — $K_c = 0.70$, $MAD = 35\%$

### 3. Soil Infiltration & Hydraulic Drainage Analysis
Following an irrigation cycle, the system tracks rootzone water percolation rate ($\% \text{ VWC}/min$) over a 2-minute window:
- `EXCELLENT_PERCOLATION`: Moisture increase $\ge 4.0\%$.
- `NORMAL_PERCOLATION`: Moisture increase $\ge 1.0\%$.
- `SLOW_DRAINAGE_COMPACTION`: Minimal moisture movement ($< 1.0\%$).
- `STAGNANT_WATERLOGGING`: Negative moisture delta / pooling.

---

## 7. REST API Endpoints & Control

### Status Endpoint (`GET /api/status`)
Returns complete telemetry, NVS statistics, crop state, drainage analysis, atmospheric indices, and decision matrix.

### Config Endpoint (`POST /api/config?crop=1`)
Allows dynamic crop profile selection at runtime without reflashing firmware (e.g. `crop=0` for Tomato Veg, `crop=1` for Tomato Fruiting, `crop=2` for Potato).

### Manual Override Endpoint (`POST /api/pump/override?state=on&duration=30`)
Allows remote manual pump test bursts (up to 180s) or emergency manual pump stops via HTTP. All physical safety lockouts remain active.

### Example JSON Response
```json
{
  "system": {
    "name": "AquaMatrix-MaxCore",
    "firmware": "6.0.0-MAX-AGRI",
    "uptime_sec": 124,
    "free_heap": 184520,
    "wifi_rssi": -62,
    "wifi_status": "CONNECTED"
  },
  "soil": {
    "raw_adc": 2100,
    "adc_raw": 2100,
    "moisture_pct": 44.1,
    "moisture_index": 44.1,
    "dryness_pct": 55.9,
    "dryness": 55.9,
    "status": "HEALTHY"
  },
  "rain_sensor": {
    "raw_adc": 4095,
    "surface_wetness_pct": 0.0,
    "is_raining": false
  },
  "reservoir": {
    "distance_cm": 65.4,
    "level_pct": 67.7,
    "level_percent": 67.7,
    "storage_litres": 1354.0,
    "water_ml": 1354000.0,
    "inflow_rate_lph": 0.0,
    "status": "HEALTHY"
  },
  "atmosphere": {
    "temp_c": 26.5,
    "humidity_pct": 62.0,
    "vpd_kpa": 1.31,
    "dew_point_c": 18.4,
    "gdd_step": 16.5,
    "forecast_rain_mm": 0.0,
    "et0_fao56_mm": 4.5,
    "api_synced": true,
    "weather_source": "LIVE_OPEN_METEO"
  },
  "weather": {
    "temp_c": 26.5,
    "humidity_pct": 62.0,
    "rain_forecast_mm": 0.0,
    "et0_fao56_mm": 4.5,
    "api_synced": true,
    "source": "LIVE_OPEN_METEO"
  },
  "pathology": {
    "risk_index": "LOW",
    "reasoning": "Optimal transpiration bracket & dry foliage"
  },
  "disease": {
    "risk_level": "LOW",
    "reason": "Optimal transpiration bracket & dry foliage"
  },
  "model": {
    "crop_et_mm": 3.83,
    "effective_rain_mm": 0.0,
    "net_demand_mm": 3.83,
    "prescribed_litres": 24.5,
    "run_duration_sec": 98.0,
    "harvest_potential_l": 0.0
  },
  "controller": {
    "action": "STANDBY",
    "reason": "Rootzone moisture optimal or atmospheric demand satisfied.",
    "pump_active": false,
    "prescribed_l": 24.5,
    "est_runtime_sec": 98.0,
    "automation_ready": true
  },
  "decision": {
    "action": "STANDBY",
    "reason": "Rootzone moisture optimal or atmospheric demand satisfied.",
    "pump_active": false,
    "confidence_percent": 100
  }
}
```

---

## 7. Calibration Constants & Agronomic Models

### Soil Moisture Calibration
- **Air / Dry Calibration (`DRY_ADC`)**: `2850`
- **Submerged / Wet Calibration (`WET_ADC`)**: `1150`
- **Valid ADC Bracket**: `300` to `3800` (Readings outside indicate short circuit or disconnected sensor wire).
- **Formula**:
  $$\text{Moisture \%} = \text{Clamp}\left(\frac{\text{DRY\_ADC} - \text{RawADC}}{\text{DRY\_ADC} - \text{WET\_ADC}} \times 100, 0, 100\right)$$
  $$\text{Dryness \%} = 100 - \text{Moisture \%}$$

### Reservoir Hydrodynamics (JSN-SR04T)
- **Empty Tank Distance (`EMPTY_DIST_CM`)**: `150.0 cm`
- **Full Tank Distance (`FULL_DIST_CM`)**: `25.0 cm` (incorporating 20cm ultrasonic horn offset)
- **Tank Volume**: `2000.0 Liters`
- **Inflow Rate (L/h)**: Calculated via rolling 30-second volume delta derivative.

### FAO-56 Agronomic Irrigation Model
- **Crop Transpiration ($ET_c$)**: $ET_c = ET_0 \times K_c$ ($K_c = 0.85$ for Tomato)
- **Effective Rainfall ($P_{eff}$)**: $0.8 \times \text{Rain Forecast (mm)}$ (or $\max(5.0, P_{forecast})$ if local rain sensor triggers)
- **Net Crop Water Demand**: $\text{NetDemand (mm)} = \max(0, ET_c - P_{eff})$
- **Prescribed Water Volume**: $\text{PrescribedL} = \text{NetDemand (mm)} \times \text{Field Area } (100\text{m}^2) \times \text{SoilStressFactor}$
- **Volumetric Pump Runtime**: $\text{Runtime (sec)} = \frac{\text{PrescribedL}}{\text{PUMP\_FLOW\_LPM } (15\text{L/min})} \times 60$

---

## 8. Fail-Safe Pump Behavior & Safety Interlocks

The relay control is **Active-LOW**. In all fault and reset conditions, the relay defaults to **HIGH (Pump OFF)**.

### Boot Safety
- `digitalWrite(RELAY_PIN, HIGH)` is called **BEFORE** `pinMode(RELAY_PIN, OUTPUT)` to eliminate startup pulse glitches.

### Hard Safety Lockouts & Trips
The pump will **NOT START** and will **IMMEDIATELY TRIP OFF** if:
1. **Soil Sensor Fault**: `rawSoilADC < 300` or `> 3800` (`soilOK = false`).
2. **Reservoir Sensor Fault**: JSN-SR04T distance out of bounds or timeout (`tankOK = false`).
3. **Critical Reservoir Depletion**: Water level $\le 15\%$ (`CRITICAL_TANK_PCT`).
4. **Rainfall Protection**: Rain detected by physical rain plate or digital rain pin (`isRaining = true`).
5. **Continuous Runtime Cutoff**: Pumping exceeds `180,000 ms` (3 minutes hard continuous run limit).
6. **Safety Cooldown Dwell**: Pumping requested within `60,000 ms` (1 minute rest period after previous cycle).

---

## 9. Data Provenance Matrix

| Data Metric | Origin / Source | Validation / Processing | Fallback Behavior |
| :--- | :--- | :--- | :--- |
| **Soil Moisture & Dryness** | Real Hardware (Capacitive HW-390) | 16-sample ADC averaging, bracket validation (300-3800) | Exposes `status: "FAULT"`, locks out pump |
| **Rain Surface Wetness** | Real Hardware (Raindrop Plate) | 16-sample ADC averaging + Digital comparator pin | Defaults to dry if disconnected |
| **Reservoir Level & Volume** | Real Hardware (JSN-SR04T Ultrasonic) | 5-sample pulse filter, 20cm blind zone check, median filter | Exposes `status: "OUT_OF_RANGE"`, locks out pump |
| **Air Temperature & Humidity** | Open-Meteo REST API | Synced every 30 mins over Wi-Fi station connection | Fallback: Temp 25°C, Humidity 60%, marked `weather_source: "FALLBACK_OFFLINE"` |
| **$ET_0$ & Rain Forecast** | Open-Meteo REST API | FAO-56 evapotranspiration daily forecast | Fallback: $ET_0 = 4.5\text{mm}$, Rain = $0\text{mm}$ |
| **VPD, Dew Point, GDD** | Agronomic Derived Math | Tetens formula & Magnus-Tetens approximation | Calculated continuously from active atmospheric metrics |
| **Disease Risk Index** | Agronomic Engine | Leaf wetness + VPD + Temp incubation envelope | Updated continuously |
| **Prescribed Dosing & Runtime** | Closed-Loop Arbitration | FAO-56 water balance + soil stress scaling | Strict multi-tier safety checks before actuator enable |
