# KRISHI SETU: Predictive Soil-Water Balance Modeling System (v1)

> ### **CRITICAL SCIENTIFIC & REGULATORY DISCLAIMER**
> **"Results obtained from simulated development data do not constitute field validation."**
> All telemetry currently utilized by this pipeline is **SIMULATED / DEVELOPMENT DATA**, generated to establish a methodologically sound, leakage-free time-series regression workflow prior to multi-week field deployment. The model parameters and simulation constants must be calibrated against in-situ gravimetric soil cores and continuous field sensor logging before production deployment.

---

## 1. Problem Statement & Agronomic Rationale

In precision irrigation management, reacting solely to real-time instantaneous soil moisture leads to **oscillatory pumping** and **delayed hydraulic response**. Soil-water dynamics exhibit significant physical hysteresis:
- Surface water takes 30–90 minutes to infiltrate through the topsoil into the active root zone (0–40 cm).
- Solar irradiance and ambient vapor pressure deficit (VPD) cause peak evapotranspiration ($ET_c$) during mid-day hours.
- A sudden precipitation event after an automated irrigation cycle causes root-zone waterlogging, nutrient leaching, and energy waste.

### Why a 3-Hour Prediction Horizon?
A **3-hour forecast horizon** ($t+3\text{h}$) matches the physical time constant of soil moisture redistribution in sandy clay loam soils and aligns with the typical supervisory arbitration cycle of on-farm drip irrigation:
1. It provides sufficient lead time to withhold irrigation if rainfall is imminent or if root-zone moisture remains adequate.
2. It prevents premature pump activation during temporary mid-day evaporative dips.
3. It allows farm managers or autonomous controllers to pre-irrigate during off-peak power hours before severe root-zone moisture deficits occur.

---

## 2. System Architecture & Safety Invariants

```
+-------------------------------------------------------------------------+
|                          PHYSICAL & WEATHER INPUTS                      |
|  Capacitive Soil Probe  +  Rain Gauge/Leaf Plate  +  Open-Meteo Weather |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                       FEATURE ENGINEERING PIPELINE                      |
|     Lags (1h, 3h, 6h) | Rolling Windows | Circular Time Harmonics       |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                  PREDICTIVE ML REGRESSION ENGINE (v1)                   |
|        Predicts: Root-zone Soil Moisture at t+3h (Percentage %)         |
+-------------------------------------------------------------------------+
                                     |
                                     v
                 Predicted Soil Moisture at t + 3 Hours
                                     |
                                     v
+-------------------------------------------------------------------------+
|                     EXISTING AGRONOMIC & SAFETY LOGIC                   |
|   MAD Thresholds | Safety Lockouts | Tank Float | Relay Dwell Intervals |
+-------------------------------------------------------------------------+
                                     |
                                     v
                            Irrigation Directive
                         (Pump ON / STANDBY / LOCKOUT)
```

### Safety Invariant
The machine learning model **never directly controls the pump relay**. The ML output is strictly an advisory forecast of field state ($\hat{\theta}_{t+3h}$). All physical safety rules, including:
- `SAFETY_LOCKOUT` (soil sensor fault or reservoir out of range)
- Reservoir critical low-water thresholds ($< 15\%$)
- Minimum pump dwell rest hysteresis ($15\text{ minutes}$)
- Maximum continuous run time ($180\text{ seconds}$)

**can NEVER be bypassed or overridden by ML predictions.**

---

## 3. Physical Soil-Water Balance Engine

To generate realistic development data without introducing random fake numbers, we implemented an agronomic water-balance bucket model grounded in the **FAO-56 Irrigation and Drainage Paper** (Allen et al., 1998):

$$\theta_{t+1} = \theta_t + \frac{P_{eff} + I_{eff} - ET_a - D}{Z_r} \times 100$$

Where:
- $\theta_t$: Root-zone volumetric soil moisture percentage at hour $t$.
- $Z_r$: Effective active root-zone depth ($400\text{ mm}$ for tomato).
- $P_{eff}$: Effective precipitation entering the soil profile ($P \times \eta_{inf}$, $\eta_{inf} = 0.85$).
- $I_{eff}$: Effective emitter discharge reaching root zone ($I \times \eta_{irr}$, $\eta_{irr} = 0.90$).
- $ET_a$: Actual crop evapotranspiration ($ET_0 \times K_c \times K_s$).
  - $K_s$: Water stress coefficient based on Management Allowed Depletion (MAD).
- $D$: Gravitational deep percolation / drainage when $\theta > \theta_{fc}$ (Field Capacity $= 35\%$).
- Runoff: Excess precipitation exceeding total soil saturation ($\theta_{sat} = 48\%$) converts to surface runoff.

### Sensor Noise Model
To prevent models from learning a trivial deterministic simulator, we separate the **true physical state** from the **observed telemetry**:
- Gaussian measurement noise: $\mathcal{N}(0, \sigma=0.8\%)$.
- Hardware 12-bit ADC mapping: $ADC = ADC_{dry} - \left(\frac{\theta}{100}\right) \times (ADC_{dry} - ADC_{wet}) + \epsilon$.
- Rare hardware fault injection: $< 0.2\%$ probability of sensor failure (`status = "FAULT"`).

---

## 4. Telemetry Schema & Features

### Feature Matrix ($X \in \mathbb{R}^{26}$)
| Category | Feature Name | Unit | Formula / Description |
| :--- | :--- | :--- | :--- |
| **Instantaneous** | `soil_moisture_pct` | % | Observed root-zone moisture at time $t$ |
| | `soil_dryness_pct` | % | $100 - \text{soil\_moisture\_pct}$ |
| | `temperature_c` | °C | Canopy air temperature |
| | `humidity_pct` | % | Relative humidity |
| | `rainfall_mm` | mm | Precipitation in preceding hour |
| | `forecast_rain_mm`| mm | 24-hour NWP precipitation forecast |
| | `et0_mm_day` | mm/day | Reference evapotranspiration |
| | `surface_wetness_pct`| % | Conductive leaf-wetness sensor |
| | `is_raining` | {0, 1} | Binary rain droplet detection |
| | `kc_factor` | Ratio | Single crop coefficient |
| | `mad_threshold_pct`| % | Management Allowed Depletion |
| | `pump_active` | {0, 1} | Pump engagement flag |
| | `irrigation_litres`| Litres | Applied irrigation volume |
| **Temporal** | `hour` | [0, 23] | Observation hour |
| | `day_of_year` | [1, 366] | Day of year |
| | `hour_sin`, `hour_cos`| Radians | $\sin(2\pi h/24)$, $\cos(2\pi h/24)$ circular clock |
| **Lags (Past Only)**| `soil_moisture_lag_1h` | % | $\theta_{t-1}$ (observation 1 hour ago) |
| | `soil_moisture_lag_3h` | % | $\theta_{t-3}$ (observation 3 hours ago) |
| | `soil_moisture_lag_6h` | % | $\theta_{t-6}$ (observation 6 hours ago) |
| **Rate of Change** | `moisture_change_1h` | % | $\theta_t - \theta_{t-1}$ |
| | `moisture_change_3h` | % | $\theta_t - \theta_{t-3}$ |
| **Rolling Windows** | `rolling_temperature_3h`| °C | Mean temperature over past 3 hours |
| | `rolling_et0_3h` | mm/day | Mean ET0 over past 3 hours |
| | `rolling_rain_6h` | mm | Accumulated rainfall over past 6 hours |
| | `irrigation_last_6h` | Litres | Accumulated irrigation over past 6 hours |

### Target ($y$)
- **`soil_moisture_t_plus_3h`**: Observed root-zone moisture percentage at index $t + 3$.

---

## 5. Chronological Splitting (Zero Target Leakage)

Because agricultural telemetry is auto-correlated time series data, **random train-test splits are strictly forbidden**. The data is split chronologically:
- **Training Set (70%)**: $3,485\text{ hours}$ (`2026-01-01 06:00` $\rightarrow$ `2026-05-26 16:00`)
- **Validation Set (15%)**: $746\text{ hours}$ (`2026-05-26 17:00` $\rightarrow$ `2026-06-26 18:00`) — used for model selection
- **Test Set (15%)**: $748\text{ hours}$ (`2026-06-26 19:00` $\rightarrow$ `2026-07-28 04:00`) — untouched out-of-time evaluation

---

## 6. Benchmarking & Model Evaluation

### Validation Set Comparison ($N = 746$)
| Model | Val MAE (%) | Val RMSE (%) | Val $R^2$ |
| :--- | :--- | :--- | :--- |
| **Baseline: Persistence** ($\hat{y}_{t+3} = y_t$) | 1.0174 | 1.2957 | -0.0335 |
| **Baseline: Physical ET** | 1.0201 | 1.3005 | -0.0412 |
| **Linear Regression** | **0.8683** | **1.0989** | **0.2566** |
| **Ridge Regression** | 0.8686 | 1.0992 | 0.2561 |
| **HistGradientBoostingRegressor** | 0.9008 | 1.1369 | 0.2043 |
| **RandomForestRegressor** | 0.9192 | 1.1743 | 0.1511 |

**Selected Model**: `LinearRegression` (Lowest validation RMSE of $1.0989\%$, an error reduction of **$15.2\%$** over the persistence baseline).

### Untouched Test Set Evaluation ($N = 748$)
| Regime / Scenario | Observations | Model RMSE (%) | Persistence RMSE (%) | Relative Improvement |
| :--- | :--- | :--- | :--- | :--- |
| **Overall Test Set** | 748 | 1.1991 | 1.1558 | -3.8% |
| **Dry Periods** | 710 | 1.1752 | 1.1444 | -2.7% |
| **Rain Events** | 169 | 1.4981 | 1.1665 | -28.4% |
| **High ET0 Periods** | 9 | 1.3802 | 1.4384 | **+4.0%** |
| **Optimal Moisture (20-35%)** | 727 | 1.1979 | 1.1341 | -5.6% |
| **Near Saturation (>35%)** | 21 | 1.2412 | 1.7472 | **+29.0%** |

---

## 7. Diagnostic Plots

The evaluation engine automatically generates 5 high-resolution diagnostic charts in `ml/results/`:
1. **`actual_vs_predicted.png`**: Scatter plot showing correlation, 1:1 parity line, and dispersion.
2. **`time_series_prediction.png`**: Multi-day time-series overlay of actual vs. predicted moisture.
3. **`residual_distribution.png`**: Error distribution histogram, zero-bias check, and box plot.
4. **`feature_importance.png`**: Relative feature ranking highlighting dominant lag and atmospheric drivers.
5. **`event_zoom.png`**: Detailed multi-panel zoom during rain/irrigation transitions showing hydrologic response.

---

## 8. Prediction Safety & Data Quality Checks

The prediction interface (`predict.py`) enforces strict validation and **refuses inference** upon hardware faults:
```python
from ml.src.predict import predict_soil_moisture_3h

# If a sensor faults:
faulty_telemetry = {
    "soil_status": "FAULT",
    "soil_adc": 0,
    "soil_moisture_pct": 0.0,
    ...
}

result = predict_soil_moisture_3h(faulty_telemetry)
# Returns:
# {
#   "prediction_horizon_hours": 3,
#   "predicted_soil_moisture_pct": None,
#   "data_quality": "REJECTED_SENSOR_FAULT",
#   "error": "Hardware error: soil sensor status is FAULT"
# }
```

---

## 9. How to Reproduce

Execute the pipeline sequentially from the repository root:

```bash
# 1. Generate 5,000 hours of simulated physical telemetry
python -m ml.src.synthetic_generator

# 2. Engineer leakage-free features and create chronological splits
python -m ml.src.prepare_dataset

# 3. Train all models, benchmark against baselines, and save best candidate
python -m ml.src.train

# 4. Run stratified agronomic evaluation and export diagnostic figures
python -m ml.src.evaluate

# 5. Run physical conservation and methodology test suite
python -m unittest discover ml/tests
```

---

## 10. Methodological Limitations & Future Field Calibration

1. **Unforecasted Precipitation Lag**: When sudden rain begins between $t$ and $t+3$ that was not forecasted in `forecast_rain_mm`, regression error temporarily increases. Future iterations should incorporate short-term radar nowcasting (0–2h).
2. **Spatial Root Heterogeneity**: The 1D single-layer model assumes uniform moisture in the top 40 cm. Dual-depth sensing (e.g. 15 cm and 35 cm probes) will be necessary in real soil to capture wetting fronts.
3. **Field Calibration Protocol**: Before deploying ML in production:
   - Perform gravimetric oven-drying core sampling at the field site to determine true $\theta_{fc}$ and $\theta_{wp}$.
   - Log 4–6 weeks of continuous in-situ field telemetry across dry-down and irrigation cycles.
   - Retrain the model on real field observations and verify performance against the persistence baseline.
