"""
KRISHI SETU Schema Definitions & Telemetry Validation
=====================================================
Defines strict physical data models, units, feature lists, and validation rules
for raw observations and processed ML feature vectors.
"""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd


# --- STRICT UNITS & BOUNDS DICTIONARY ---
SCHEMA_SPECIFICATION: Dict[str, Dict[str, Any]] = {
    "timestamp": {
        "type": "datetime64[ns]",
        "unit": "ISO-8601 UTC/IST",
        "description": "Hourly timestamp of the telemetry observation."
    },
    "device_id": {
        "type": "string",
        "unit": "id",
        "description": "Unique identifier of the field node (e.g. esp32-mandya-01)."
    },
    # SOIL SUBSYSTEM
    "soil_adc": {
        "type": "int",
        "unit": "12-bit ADC [0-4095]",
        "min": 0,
        "max": 4095,
        "description": "Raw 12-bit analog-to-digital converter reading from capacitive soil probe."
    },
    "soil_moisture_pct": {
        "type": "float",
        "unit": "% volumetric / index",
        "min": 0.0,
        "max": 100.0,
        "description": "Observed root-zone soil moisture percentage (0=air dry, 100=saturation/calibrated max)."
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
        "unit": "degrees Celsius (°C)",
        "min": -10.0,
        "max": 60.0,
        "description": "Ambient dry-bulb air temperature at 1.5m canopy height."
    },
    "humidity_pct": {
        "type": "float",
        "unit": "% relative humidity",
        "min": 0.0,
        "max": 100.0,
        "description": "Ambient relative humidity."
    },
    # WEATHER
    "rainfall_mm": {
        "type": "float",
        "unit": "mm/hour",
        "min": 0.0,
        "max": 300.0,
        "description": "Measured or grid precipitation accumulated over the preceding hour."
    },
    "forecast_rain_mm": {
        "type": "float",
        "unit": "mm/24h",
        "min": 0.0,
        "max": 500.0,
        "description": "Locality NWP forecasted rainfall for the next 24 hours."
    },
    "et0_mm_day": {
        "type": "float",
        "unit": "mm/day",
        "min": 0.0,
        "max": 20.0,
        "description": "FAO-56 Penman-Monteith reference evapotranspiration rate."
    },
    # RAIN SENSOR
    "surface_wetness_pct": {
        "type": "float",
        "unit": "% surface conductivity",
        "min": 0.0,
        "max": 100.0,
        "description": "Optical/conductive rain plate leaf-wetness percentage."
    },
    "is_raining": {
        "type": "int",
        "unit": "binary flag {0, 1}",
        "min": 0,
        "max": 1,
        "description": "Boolean flag indicating active droplet deposition."
    },
    # CROP PHENOLOGY
    "crop_profile": {
        "type": "string",
        "unit": "text identifier",
        "description": "Active crop cultivar profile (e.g. Tomato Vegetative)."
    },
    "kc_factor": {
        "type": "float",
        "unit": "dimensionless ratio",
        "min": 0.1,
        "max": 2.5,
        "description": "FAO-56 single crop coefficient relating ET0 to actual crop water demand ETc."
    },
    "mad_threshold_pct": {
        "type": "float",
        "unit": "% allowable depletion",
        "min": 10.0,
        "max": 90.0,
        "description": "Management Allowed Depletion threshold before irrigation must initiate."
    },
    # RESERVOIR
    "reservoir_level_pct": {
        "type": "float",
        "unit": "% capacity",
        "min": -1.0,
        "max": 100.0,
        "description": "On-farm storage tank level percentage (-1 indicates ultrasonic out of range)."
    },
    "reservoir_status": {
        "type": "string",
        "unit": "category",
        "allowed": ["HEALTHY", "OUT_OF_RANGE", "FAULT", "UNKNOWN"],
        "description": "Hardware diagnostic validity indicator for the water reservoir sensor."
    },
    # IRRIGATION ACTION
    "pump_active": {
        "type": "int",
        "unit": "binary flag {0, 1}",
        "min": 0,
        "max": 1,
        "description": "Pump engagement state during the observation hour."
    },
    "irrigation_litres": {
        "type": "float",
        "unit": "Litres applied",
        "min": 0.0,
        "max": 10000.0,
        "description": "Volumetric water dosage discharged via emitters during the hour."
    },
}

# --- RAW INPUT TELEMETRY COLUMNS ---
RAW_TELEMETRY_COLUMNS: List[str] = list(SCHEMA_SPECIFICATION.keys())

# --- ML FEATURE SET ---
MODEL_FEATURE_COLUMNS: List[str] = [
    # Baseline state at time t
    "soil_moisture_pct",
    "soil_dryness_pct",
    "temperature_c",
    "humidity_pct",
    "rainfall_mm",
    "forecast_rain_mm",
    "et0_mm_day",
    "surface_wetness_pct",
    "is_raining",
    "kc_factor",
    "mad_threshold_pct",
    "pump_active",
    "irrigation_litres",
    # Temporal & Cyclical
    "hour",
    "day_of_year",
    "hour_sin",
    "hour_cos",
    # Derived Lag Features
    "soil_moisture_lag_1h",
    "soil_moisture_lag_3h",
    "soil_moisture_lag_6h",
    # Dynamics (Rate of Change)
    "moisture_change_1h",
    "moisture_change_3h",
    # Rolling Windows
    "rolling_temperature_3h",
    "rolling_et0_3h",
    "rolling_rain_6h",
    "irrigation_last_6h",
]

TARGET_COLUMN = "soil_moisture_t_plus_3h"


def validate_raw_record(record: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """
    Validates a single telemetry record against the physical schema and hardware health checks.
    Returns (is_valid, error_reason).
    """
    # 1. Hardware Fault Checks
    if record.get("soil_status") == "FAULT":
        return False, "Hardware error: soil sensor status is FAULT"

    if record.get("soil_adc") is not None:
        adc = record["soil_adc"]
        if adc < 300 or adc > 3800:
            return False, f"Hardware error: soil_adc {adc} outside valid electrical bracket [300, 3800]"

    # 2. Critical Moisture Range
    moisture = record.get("soil_moisture_pct")
    if moisture is None or not np.isfinite(moisture) or moisture < 0.0 or moisture > 100.0:
        return False, f"Invalid soil_moisture_pct: {moisture}"

    # 3. Atmospheric Bounds
    temp = record.get("temperature_c")
    if temp is not None and (temp < -10.0 or temp > 60.0 or not np.isfinite(temp)):
        return False, f"Physically impossible temperature_c: {temp}"

    humidity = record.get("humidity_pct")
    if humidity is not None and (humidity < 0.0 or humidity > 100.0 or not np.isfinite(humidity)):
        return False, f"Physically impossible humidity_pct: {humidity}"

    # 4. Precipitation & ET0
    rain = record.get("rainfall_mm")
    if rain is not None and (rain < 0.0 or not np.isfinite(rain)):
        return False, f"Negative rainfall_mm: {rain}"

    et0 = record.get("et0_mm_day")
    if et0 is not None and (et0 < 0.0 or not np.isfinite(et0)):
        return False, f"Negative et0_mm_day: {et0}"

    return True, None


def validate_dataframe(df: pd.DataFrame, require_target: bool = False) -> Tuple[bool, List[str]]:
    """
    Validates a DataFrame for missing columns, NaN values, and out-of-bound variables.
    Returns (is_valid, list_of_errors).
    """
    errors: List[str] = []

    # Check required feature columns
    missing_cols = [col for col in MODEL_FEATURE_COLUMNS if col not in df.columns]
    if missing_cols:
        errors.append(f"Missing required feature columns: {missing_cols}")

    if require_target and TARGET_COLUMN not in df.columns:
        errors.append(f"Missing target column: '{TARGET_COLUMN}'")

    # Check for NaNs in feature columns
    for col in MODEL_FEATURE_COLUMNS:
        if col in df.columns:
            nan_count = df[col].isna().sum()
            if nan_count > 0:
                errors.append(f"Column '{col}' contains {nan_count} NaN values.")

    # Target NaN check
    if require_target and TARGET_COLUMN in df.columns:
        nan_target = df[TARGET_COLUMN].isna().sum()
        if nan_target > 0:
            errors.append(f"Target column '{TARGET_COLUMN}' contains {nan_target} NaN values.")

    return len(errors) == 0, errors
