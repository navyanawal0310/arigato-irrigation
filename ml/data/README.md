# KRISHI SETU ML Data Directory

> **IMPORTANT DISCLAIMER:**
> All telemetry currently contained in this directory is **SIMULATED / DEVELOPMENT DATA**.
> Results obtained from this data do **NOT** constitute validated real-world agricultural accuracy.
> This data was generated to build and verify a reproducible ML pipeline prior to multi-week field deployment.

---

## Directory Organization

```
ml/data/
├── raw/
│   ├── synthetic_telemetry.csv  # Continuous 5,000-hour multi-scenario simulation
│   └── metadata.json            # Generation parameters and summary statistics
├── processed/
│   ├── train.csv                # Chronological 70% training split
│   ├── val.csv                  # Chronological 15% validation split (model selection)
│   ├── test.csv                 # Chronological 15% test split (untouched evaluation)
│   └── split_metadata.json      # Exact timestamp boundaries and observation counts
└── README.md
```

## Schema & Physical Units

| Column | Unit | Description |
| :--- | :--- | :--- |
| `timestamp` | ISO-8601 | Hourly timestamp of telemetry observation |
| `device_id` | String | Unique field node identifier |
| `soil_adc` | 12-bit ADC | Raw electrical reading from capacitive soil sensor |
| `soil_moisture_pct` | % Volumetric | Measured root-zone moisture percentage |
| `soil_dryness_pct` | % Deficit | 100 - `soil_moisture_pct` |
| `soil_status` | Category | `HEALTHY` or `FAULT` |
| `temperature_c` | °C | Dry-bulb ambient air temperature |
| `humidity_pct` | % RH | Relative humidity |
| `rainfall_mm` | mm/hour | Precipitation accumulated during observation hour |
| `forecast_rain_mm` | mm/24h | NWP forecasted precipitation for next 24 hours |
| `et0_mm_day` | mm/day | FAO-56 Penman-Monteith reference evapotranspiration |
| `surface_wetness_pct`| % | Conductive leaf/plate wetness |
| `is_raining` | Binary {0, 1}| Active rainfall indicator |
| `crop_profile` | String | Cultivar identifier (e.g. Tomato Vegetative) |
| `kc_factor` | Dimensionless | FAO-56 single crop coefficient relating ET0 to ETc |
| `mad_threshold_pct` | % | Management Allowed Depletion threshold |
| `reservoir_level_pct`| % | On-farm storage tank level |
| `reservoir_status` | Category | `HEALTHY` or `OUT_OF_RANGE` |
| `pump_active` | Binary {0, 1}| Pump relay state during hour |
| `irrigation_litres` | Litres | Water volume discharged during hour |

### Target Variable
- **`soil_moisture_t_plus_3h`**: Root-zone volumetric soil moisture percentage exactly 3 hours into the future.
