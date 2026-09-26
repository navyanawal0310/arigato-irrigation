"""
KRISHI SETU Telemetry Schema & Feature Definitions (V2)
======================================================
Defines strict physical data models, units, and feature lists for V2.
Explicitly distinguishes between:
- observed_rain_mm: Precipitation measured at/before time t.
- forecast_rain_next_3h_mm: Short-term NWP/radar rainfall forecast for the 3-hour horizon (t to t+3).
"""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd


# --- STRICT UNITS & BOUNDS DICTIONARY (V2) ---
SCHEMA_SPECIFICATION_V2: Dict[str, Dict[str, Any]] = {
    "timestamp": {
        "type": "datetime64[ns]",
        "unit": "ISO-8601 UTC/IST",
        "description": "Hourly timestamp of the telemetry observation."
    },
    "device_id": {
        "type": "string",
        "unit": "id",
        "description": "Unique identifier of the field node."
    },
    "scenario": {
        "type": "string",
        "unit": "category",
        "description": "Active meteorological & agronomic regime."
    },
    # SOIL SUBSYSTEM
    "soil_adc": {
        "type": "int",
        "unit": "12-bit ADC [0-4095]",
        "min": 0,
        "max": 4095,
        "description": "Raw 12-bit analog reading from capacitive probe."
    },
    "soil_moisture_pct": {
        "type": "float",
        "unit": "% volumetric / index",
        "min": 0.0,
        "max": 100.0,
        "description": "Observed root-zone soil moisture percentage at time t."
    },
    "soil_dryness_pct": {
        "type": "float",
        "unit": "% deficit",
        "min": 0.0,
        "max": 100.0,
        "description": "Root-zone depletion index (100 - soil_moisture_pct)."
    },
    "soil_status": {
        "type": "string",
        "unit": "category",
        "allowed": ["HEALTHY", "FAULT", "DISCONNECTED", "INVALID"],
        "description": "Hardware diagnostic validity indicator."
    },
    # ATMOSPHERE
    "temperature_c": {
        "type": "float",
        "unit": "°C",
        "min": -10.0,
        "max": 60.0,
        "description": "Canopy dry-bulb air temperature."
    },
    "humidity_pct": {
        "type": "float",
        "unit": "% RH",
        "min": 0.0,
        "max": 100.0,
        "description": "Relative humidity."
    },
    # WEATHER (OBSERVED & FORECAST)
    "observed_rain_mm": {
        "type": "float",
        "unit": "mm/hour",
        "min": 0.0,
        "max": 300.0,
        "description": "Precipitation accumulated during preceding hour (at time t)."
    },
    "forecast_rain_next_3h_mm": {
        "type": "float",
        "unit": "mm/3h",
        "min": 0.0,
        "max": 300.0,
        "description": "Short-term NWP/radar precipitation forecasted for the upcoming 3 hours (t to t+3)."
    },
    "forecast_rain_24h_mm": {
        "type": "float",
        "unit": "mm/24h",
        "min": 0.0,
        "max": 500.0,
        "description": "24-hour NWP daily precipitation forecast."
    },
    "et0_mm_day": {
        "type": "float",
        "unit": "mm/day",
        "min": 0.0,
        "max": 20.0,
        "description": "FAO-56 reference evapotranspiration rate."
    },
    # RAIN SENSOR
    "surface_wetness_pct": {
        "type": "float",
        "unit": "% wetness",
        "min": 0.0,
        "max": 100.0,
        "description": "Leaf/plate wetness conductivity."
    },
    "is_raining": {
        "type": "int",
        "unit": "binary flag {0, 1}",
        "min": 0,
        "max": 1,
        "description": "Active droplet detection flag."
    },
    # CROP
    "crop_profile": {
        "type": "string",
        "unit": "text",
        "description": "Crop cultivar profile."
    },
    "kc_factor": {
        "type": "float",
        "unit": "dimensionless ratio",
        "min": 0.1,
        "max": 2.5,
        "description": "FAO-56 single crop coefficient."
    },
    "mad_threshold_pct": {
        "type": "float",
        "unit": "% allowable depletion",
        "min": 10.0,
        "max": 90.0,
        "description": "Management Allowed Depletion threshold."
    },
    # RESERVOIR
    "reservoir_level_pct": {
        "type": "float",
        "unit": "% capacity",
        "min": -1.0,
        "max": 100.0,
        "description": "Reservoir water level."
    },
    "reservoir_status": {
        "type": "string",
        "unit": "category",
        "allowed": ["HEALTHY", "OUT_OF_RANGE", "FAULT", "UNKNOWN"],
        "description": "Reservoir sensor status."
    },
    # IRRIGATION ACTION
    "pump_active": {
        "type": "int",
        "unit": "binary flag {0, 1}",
        "min": 0,
        "max": 1,
        "description": "Pump active state."
    },
    "irrigation_litres": {
        "type": "float",
        "unit": "Litres",
        "min": 0.0,
        "max": 10000.0,
        "description": "Irrigation volume discharged during hour."
    },
}

# --- MODEL FEATURE SET (V2) ---
MODEL_FEATURE_COLUMNS_V2: List[str] = [
    # 1. State at time t
    "soil_moisture_pct",
    "soil_dryness_pct",
    "temperature_c",
    "humidity_pct",
    "observed_rain_mm",
    "forecast_rain_next_3h_mm",
    "forecast_rain_24h_mm",
    "et0_mm_day",
    "surface_wetness_pct",
    "is_raining",
    "kc_factor",
    "mad_threshold_pct",
    "pump_active",
    "irrigation_litres",
    # 2. Soil Hydraulic Capacity (Non-linear infiltration & drainage constraint)
    "soil_storage_capacity_pct",  # max(0, FIELD_CAPACITY_PCT - soil_moisture_pct)
    # 3. Temporal & Cyclical
    "hour",
    "day_of_year",
    "hour_sin",
    "hour_cos",
    "day_sin",
    "day_cos",
    # 4. Historical Lags (Strictly past observations: shift > 0)
    "soil_moisture_lag_1h",
    "soil_moisture_lag_2h",
    "soil_moisture_lag_3h",
    "soil_moisture_lag_6h",
    # 5. Dynamics (Empirical rates of change / slope)
    "moisture_slope_1h",  # theta_t - theta_{t-1}
    "moisture_slope_3h",  # (theta_t - theta_{t-3}) / 3
    "moisture_slope_6h",  # (theta_t - theta_{t-6}) / 6
    # 6. Rolling Windows (Past observations up to time t)
    "rolling_temperature_3h",
    "rolling_et0_3h",
    "rolling_et0_6h",
    "rolling_rain_3h",
    "rolling_rain_6h",
    "irrigation_last_1h",
    "irrigation_last_3h",
    "irrigation_last_6h",
]

TARGET_COLUMN = "soil_moisture_t_plus_3h"
RESIDUAL_TARGET_COLUMN = "soil_moisture_residual_t_plus_3h"
PHYSICS_PREDICTION_COLUMN = "physics_prediction_t_plus_3h"


def validate_raw_record_v2(record: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validates an incoming telemetry record for physical bounds and hardware faults."""
    if record.get("soil_status") == "FAULT":
        return False, "Hardware error: soil sensor status is FAULT"

    if record.get("soil_adc") is not None:
        adc = record["soil_adc"]
        if adc < 300 or adc > 3800:
            return False, f"Hardware error: soil_adc {adc} outside valid bracket [300, 3800]"

    moisture = record.get("soil_moisture_pct")
    if moisture is None or not np.isfinite(moisture) or moisture < 0.0 or moisture > 100.0:
        return False, f"Invalid soil_moisture_pct: {moisture}"

    temp = record.get("temperature_c")
    if temp is not None and (temp < -10.0 or temp > 60.0 or not np.isfinite(temp)):
        return False, f"Physically impossible temperature_c: {temp}"

    humidity = record.get("humidity_pct")
    if humidity is not None and (humidity < 0.0 or humidity > 100.0 or not np.isfinite(humidity)):
        return False, f"Physically impossible humidity_pct: {humidity}"

    return True, None
