# KRISHI SETU — Real ESP32 Telemetry Persistence Service

Backend telemetry ingestion service for the **KRISHI SETU** autonomous irrigation system. Periodically samples real field telemetry from the local ESP32 node (`/api/status`), validates measurements, evaluates data quality flags, and persists schema-versioned observations into **MongoDB Atlas**.

---

## 1. System Architecture

```
ESP32 Field Node (http://10.110.8.97/api/status)
       │
       ▼ (every 30s)
Telemetry Collector (FastAPI / PyMongo)
       │
       ├── Hardware Diagnostics & Sensor Fault Preservation
       ├── Quality Flags Validation (soil_valid, reservoir_valid)
       ├── UTC-Aware Timestamping
       └── Deduplication Key Generation (device_id + uptime_sec)
       │
       ▼
MongoDB Atlas (krishi_setu.telemetry)
       │
       ▼
REST API Endpoints (/api/telemetry/latest, /api/telemetry/history)
```

---

## 2. Directory Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI application & lifecycle manager
│   ├── config.py               # Centralized configuration & credential masking
│   ├── database.py             # PyMongo connection pooling & automatic indexing
│   ├── schemas.py              # Pydantic schemas & BSON serializers
│   ├── telemetry_mapper.py     # ESP32 JSON to MongoDB schema transformation
│   ├── collector.py            # Resilient background polling loop
│   └── routes/
│       ├── __init__.py
│       └── telemetry.py        # REST API endpoints
├── tests/
│   ├── test_mapper.py          # Quality flag & mapping tests
│   ├── test_collector.py       # Timeout & resilience tests
│   └── test_api.py             # FastAPI route tests
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

---

## 3. Configuration & Security

Real secrets reside **only** in `backend/.env`, which is strictly ignored by Git.

```env
# MongoDB Atlas Connection String
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=krishi_setu

# Hardware Endpoint
ESP32_BASE_URL=http://10.110.8.97

# Telemetry Polling Rate
TELEMETRY_INTERVAL_SECONDS=30

# API Server Port
PORT=8000
```

> [!CAUTION]
> Credentials must NEVER be committed to Git, printed in logs, or exposed to the React frontend.

---

## 4. Deduplication Strategy

To prevent accidental multiple collector processes from creating duplicate telemetry entries:
1. Each observation generates a deterministic `dedup_key`:
   - When ESP32 uptime is present: `f"{device_id}_up{uptime_sec}"`
   - Fallback: `f"{device_id}_epoch{15s_window}"`
2. MongoDB Atlas maintains a **unique index** on `dedup_key`.
3. If a duplicate polling attempt occurs, the collector catches the `DuplicateKeyError`, logs the event, and skips duplicate writes without failing.

---

## 5. MongoDB Indexes

The following indexes are automatically verified and created on startup:
1. `{"device_id": 1, "recorded_at": -1}` (Compound: fast device history queries)
2. `{"recorded_at": -1}` (Fast global latest & time series queries)
3. `{"dedup_key": 1}` (Unique: prevents duplicate observations)

---

## 6. How to Run

### Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### Run Unit Tests
```bash
python -m unittest discover backend/tests -p "test_*.py"
```

### Start API Server & Automatic Background Collector
```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

### Interactive API Documentation
Open `http://localhost:8000/docs` in your browser.

---

## 7. ML Inference Service (`/api/prediction/soil-moisture`)

Exposes the trained V2 model (`Direct_ExtraTrees`, 36 features) for 3-hour root-zone soil moisture forecasts.

### Multi-Stage Hardware Safety Gates:
1. **Critical Sensor Validity Gate**:
   - If `soil.status != "HEALTHY"` or `quality.soil_valid == False` (e.g. real ADC=187/65/FAULT), prediction is **refused**.
   - Returns `{"status": "unavailable", "prediction": null, "reason": "SOIL_SENSOR_FAULT"}`.
   - Never silently replaces fault readings with 0%.
2. **History Gate**:
   - Requires $\ge 6$ hours of continuous timestamped historical telemetry to construct 1h, 2h, 3h, 6h lags and slopes.
   - If insufficient history exists: returns `{"status": "warming_up", "prediction": null, "reason": "INSUFFICIENT_HISTORY"}`.
   - Never fabricates lag values.
3. **Weather Gate**:
   - Validates presence of `temperature_c`, `humidity_pct`, `et0_mm_day`, `forecast_rain_next_3h_mm`.
   - If missing: returns `{"status": "missing_features", "reason": "MISSING_WEATHER_DATA"}`.
4. **Output Boundary Gate**:
   - Validates that model output is finite and physically plausible within $[0.0, 60.0\%]$.
5. **Strict Pump Isolation**:
   - Prediction is informational only. ML never directly triggers, commands, or overrides pump hardware or `LOCKOUT_TANK_FAULT`.


---

## 8. Hardware + API Weather Merge (`app/api_weather.py`)

Each telemetry record combines the ESP32 reading with an AccuWeather snapshot for the field:

- `api_weather` — the snapshot (current conditions, rain in the last 3 h, rain forecast for the next 3 h / 12 h), cached for `API_WEATHER_REFRESH_MINUTES` (default 60) to protect the AccuWeather quota.
- Missing `atmosphere` features are filled from the snapshot — mainly `forecast_rain_next_3h_mm`, which the firmware only approximates with a whole-day total. **Hardware values are never overwritten** (a real `0.0` stays `0.0`).
- `atmosphere_sources` records every filled field (e.g. `{"forecast_rain_next_3h_mm": "accuweather"}`) and `quality.api_weather_merged` flags enrichment.
- If AccuWeather is unreachable the record is stored unenriched — collection never blocks on the API.

Configure in `backend/.env`: `ACCUWEATHER_API_KEY`, `FIELD_LATITUDE`, `FIELD_LONGITUDE` (defaults match the firmware). Status appears under `api_weather` in `/api/telemetry/collector/status`.

User accounts, farm profiles and activity are **not** stored here — they live in Supabase (see `arigato-dashboard/supabase/schema.sql`).
