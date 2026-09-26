"""
KRISHI SETU Single-Observation Prediction Interface
===================================================
Provides a safe, validated prediction entry point for future root-zone moisture.
Enforces strict hardware quality checks: refuses inference when inputs are invalid,
faulty, or out of physical bounds.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
import joblib

from ml.config import (
    MODELS_DIR,
    MODEL_VERSION,
    PREDICTION_HORIZON_HOURS,
    WILTING_POINT_PCT,
    SATURATION_PCT,
)
from ml.src.schema import MODEL_FEATURE_COLUMNS, validate_raw_record


_LOADED_MODEL: Optional[Any] = None


def get_prediction_model(model_path: Optional[str] = None) -> Any:
    """Loads and caches the trained joblib model."""
    global _LOADED_MODEL
    if _LOADED_MODEL is not None and model_path is None:
        return _LOADED_MODEL

    path = model_path or (MODELS_DIR / "soil_moisture_3h.joblib")
    if not Path(path).exists():
        raise FileNotFoundError(f"Model artifact not found at {path}. Run 'python -m ml.src.train' first.")

    _LOADED_MODEL = joblib.load(path)
    return _LOADED_MODEL


def predict_soil_moisture_3h(
    features: Dict[str, Any],
    raise_on_error: bool = False,
    model_override: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Validates input telemetry and computes predicted root-zone soil moisture 3 hours ahead.

    Parameters:
        features: Dictionary containing current telemetry and engineered lag features.
        raise_on_error: If True, raises ValueError on invalid inputs; otherwise returns refusal payload.
        model_override: Optional pre-loaded model instance.

    Returns:
        Structured prediction dictionary including safety and data quality flags.
    """
    # 1. HARDWARE QUALITY & SENSOR HEALTH VALIDATION
    is_valid, error_msg = validate_raw_record(features)
    if not is_valid:
        if raise_on_error:
            raise ValueError(f"Input validation rejected: {error_msg}")
        return {
            "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
            "predicted_soil_moisture_pct": None,
            "model_version": MODEL_VERSION,
            "data_quality": "REJECTED_SENSOR_FAULT",
            "error": error_msg,
            "model_scope": "development-simulated",
        }

    # 2. FEATURE PRESENCE & COMPLETENESS CHECK
    missing_features = [col for col in MODEL_FEATURE_COLUMNS if col not in features]
    if missing_features:
        err = f"Missing required model features: {missing_features}"
        if raise_on_error:
            raise ValueError(err)
        return {
            "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
            "predicted_soil_moisture_pct": None,
            "model_version": MODEL_VERSION,
            "data_quality": "REJECTED_MISSING_FEATURES",
            "error": err,
            "model_scope": "development-simulated",
        }

    # 3. NUMERICAL INTEGRITY (NO NaN, NO INFINITY)
    for col in MODEL_FEATURE_COLUMNS:
        val = features[col]
        if val is None or not np.isfinite(val):
            err = f"Feature '{col}' contains non-finite value: {val}"
            if raise_on_error:
                raise ValueError(err)
            return {
                "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
                "predicted_soil_moisture_pct": None,
                "model_version": MODEL_VERSION,
                "data_quality": "REJECTED_NON_FINITE_INPUT",
                "error": err,
                "model_scope": "development-simulated",
            }

    # 4. MODEL INFERENCE
    model = model_override or get_prediction_model()
    input_row = pd.DataFrame([{col: features[col] for col in MODEL_FEATURE_COLUMNS}])

    raw_prediction = float(model.predict(input_row)[0])

    # 5. PHYSICAL BOUNDS ENFORCEMENT
    # Soil moisture cannot drop below residual hygroscopic water or exceed full saturation
    clamped_prediction = float(np.clip(raw_prediction, WILTING_POINT_PCT * 0.7, SATURATION_PCT + 2.0))

    current_moisture = float(features["soil_moisture_pct"])
    delta_moisture = round(clamped_prediction - current_moisture, 2)

    return {
        "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
        "predicted_soil_moisture_pct": round(clamped_prediction, 2),
        "current_soil_moisture_pct": round(current_moisture, 2),
        "predicted_delta_pct": delta_moisture,
        "model_version": MODEL_VERSION,
        "model_type": type(model).__name__,
        "data_quality": "VALID",
        "model_scope": "development-simulated",
        "notice": "Results obtained from simulated development data do not constitute field validation.",
    }


def main():
    """Quick interactive demonstration of valid vs. faulty prediction calls."""
    print("=" * 70)
    print("KRISHI SETU - Real-Time Prediction Interface Demo")
    print("=" * 70)

    # Example 1: Valid Nominal Telemetry
    valid_sample = {
        "soil_adc": 2100,
        "soil_moisture_pct": 34.5,
        "soil_dryness_pct": 65.5,
        "soil_status": "HEALTHY",
        "temperature_c": 28.5,
        "humidity_pct": 55.0,
        "rainfall_mm": 0.0,
        "forecast_rain_mm": 0.0,
        "et0_mm_day": 4.8,
        "surface_wetness_pct": 5.0,
        "is_raining": 0,
        "kc_factor": 0.85,
        "mad_threshold_pct": 50.0,
        "pump_active": 0,
        "irrigation_litres": 0.0,
        "hour": 14,
        "day_of_year": 120,
        "hour_sin": np.sin(2 * np.pi * 14 / 24),
        "hour_cos": np.cos(2 * np.pi * 14 / 24),
        "soil_moisture_lag_1h": 35.1,
        "soil_moisture_lag_3h": 36.2,
        "soil_moisture_lag_6h": 37.5,
        "moisture_change_1h": -0.6,
        "moisture_change_3h": -1.7,
        "rolling_temperature_3h": 28.0,
        "rolling_et0_3h": 4.7,
        "rolling_rain_6h": 0.0,
        "irrigation_last_6h": 0.0,
    }

    res_valid = predict_soil_moisture_3h(valid_sample)
    print("1. VALID SAMPLE INFERENCE:")
    print(json.dumps(res_valid, indent=2))

    # Example 2: Hardware Sensor Fault Rejection
    faulty_sample = dict(valid_sample)
    faulty_sample["soil_status"] = "FAULT"
    faulty_sample["soil_adc"] = 0

    res_faulty = predict_soil_moisture_3h(faulty_sample)
    print("\n2. SENSOR FAULT REJECTION:")
    print(json.dumps(res_faulty, indent=2))
    print("\nDone.")


if __name__ == "__main__":
    main()
