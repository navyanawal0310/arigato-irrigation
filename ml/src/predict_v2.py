"""
KRISHI SETU Soil Moisture Prediction Engine (V2)
================================================
Production inference interface for the V2 model.
Loads the validated model bundle from ml/models/v2/soil_moisture_3h_v2.joblib.

STRICT SAFETY CONSTRAINTS:
1. ML NEVER directly commands the pump.
2. Hardware safety rules, lockouts, fault detection, and reservoir thresholds
   are enforced deterministically outside ML.
3. If sensor hardware is in FAULT, out-of-range, or disconnected, prediction is gated.
"""

from pathlib import Path
from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
import joblib

from ml.config import (
    MODELS_DIR,
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    ADC_MIN_VALID,
    ADC_MAX_VALID,
)
from ml.src.schema_v2 import (
    MODEL_FEATURE_COLUMNS_V2,
    validate_raw_record_v2,
)
from ml.src.physics_baseline import predict_physics_water_balance_3h
from ml.src.train_v2 import HybridPhysicsMLModel  # Needed for unpickling if hybrid was selected


class PredictorV2:
    """
    Inference interface for KRISHI SETU V2 Soil Moisture Predictor.
    """

    def __init__(self, model_path: Optional[Path] = None):
        if model_path is None:
            model_path = MODELS_DIR / "v2" / "soil_moisture_3h_v2.joblib"
        if not model_path.exists():
            raise FileNotFoundError(f"V2 model artifact not found at {model_path}. Train model first.")

        bundle = joblib.load(model_path)
        self.model = bundle["model"]
        self.model_name = bundle["model_name"]
        self.model_type = bundle["model_type"]
        self.features = bundle["features"]
        self.val_metrics = bundle.get("val_metrics", {})

    def predict_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validates record, enforces hardware safety gating, computes features,
        and returns 3-hour forward prediction.
        """
        # 1. Hardware Diagnostic & Safety Gating
        is_valid, error_msg = validate_raw_record_v2(record)
        if not is_valid:
            return {
                "status": "HARDWARE_FAULT",
                "predicted_soil_moisture_3h": None,
                "predicted_soil_dryness_3h": None,
                "physics_prior_3h": None,
                "model_name": self.model_name,
                "model_version": "2.0.0",
                "error": error_msg,
                "pump_control_allowed": False,
            }

        # 2. Extract state variables
        m_t = float(record["soil_moisture_pct"])
        forecast_rain_3h = float(record.get("forecast_rain_next_3h_mm", 0.0))
        et0 = float(record.get("et0_mm_day", 4.0))
        kc = float(record.get("kc_factor", 0.85))
        mad = float(record.get("mad_threshold_pct", 50.0))
        hour = int(record.get("hour", 12))

        # 3. Compute Physics Prior
        y_phys = float(predict_physics_water_balance_3h(
            moisture_pct=m_t,
            forecast_rain_next_3h_mm=forecast_rain_3h,
            et0_mm_day=et0,
            kc_factor=kc,
            mad_threshold_pct=mad,
            hour=hour,
        )[0])

        # 4. Construct Feature Vector for Model
        feature_dict: Dict[str, float] = {}

        # Core state
        feature_dict["soil_moisture_pct"] = m_t
        feature_dict["soil_dryness_pct"] = float(record.get("soil_dryness_pct", 100.0 - m_t))
        feature_dict["temperature_c"] = float(record.get("temperature_c", 25.0))
        feature_dict["humidity_pct"] = float(record.get("humidity_pct", 60.0))
        feature_dict["observed_rain_mm"] = float(record.get("observed_rain_mm", 0.0))
        feature_dict["forecast_rain_next_3h_mm"] = forecast_rain_3h
        feature_dict["forecast_rain_24h_mm"] = float(record.get("forecast_rain_24h_mm", forecast_rain_3h * 2.0))
        feature_dict["et0_mm_day"] = et0
        feature_dict["surface_wetness_pct"] = float(record.get("surface_wetness_pct", 0.0))
        feature_dict["is_raining"] = int(record.get("is_raining", 1 if feature_dict["observed_rain_mm"] > 0.1 else 0))
        feature_dict["kc_factor"] = kc
        feature_dict["mad_threshold_pct"] = mad
        feature_dict["pump_active"] = int(record.get("pump_active", 0))
        feature_dict["irrigation_litres"] = float(record.get("irrigation_litres", 0.0))

        # Soil hydraulic capacity
        feature_dict["soil_storage_capacity_pct"] = max(0.0, FIELD_CAPACITY_PCT - m_t)

        # Temporal harmonics
        day_of_year = int(record.get("day_of_year", 180))
        feature_dict["hour"] = hour
        feature_dict["day_of_year"] = day_of_year
        feature_dict["hour_sin"] = np.sin(2.0 * np.pi * hour / 24.0)
        feature_dict["hour_cos"] = np.cos(2.0 * np.pi * hour / 24.0)
        feature_dict["day_sin"] = np.sin(2.0 * np.pi * day_of_year / 365.25)
        feature_dict["day_cos"] = np.cos(2.0 * np.pi * day_of_year / 365.25)

        # Lags (fallback to current moisture if historical buffer not supplied)
        feature_dict["soil_moisture_lag_1h"] = float(record.get("soil_moisture_lag_1h", m_t))
        feature_dict["soil_moisture_lag_2h"] = float(record.get("soil_moisture_lag_2h", m_t))
        feature_dict["soil_moisture_lag_3h"] = float(record.get("soil_moisture_lag_3h", m_t))
        feature_dict["soil_moisture_lag_6h"] = float(record.get("soil_moisture_lag_6h", m_t))

        # Slopes
        feature_dict["moisture_slope_1h"] = m_t - feature_dict["soil_moisture_lag_1h"]
        feature_dict["moisture_slope_3h"] = (m_t - feature_dict["soil_moisture_lag_3h"]) / 3.0
        feature_dict["moisture_slope_6h"] = (m_t - feature_dict["soil_moisture_lag_6h"]) / 6.0

        # Rolling
        feature_dict["rolling_temperature_3h"] = float(record.get("rolling_temperature_3h", feature_dict["temperature_c"]))
        feature_dict["rolling_et0_3h"] = float(record.get("rolling_et0_3h", et0))
        feature_dict["rolling_et0_6h"] = float(record.get("rolling_et0_6h", et0))
        feature_dict["rolling_rain_3h"] = float(record.get("rolling_rain_3h", feature_dict["observed_rain_mm"]))
        feature_dict["rolling_rain_6h"] = float(record.get("rolling_rain_6h", feature_dict["observed_rain_mm"]))
        feature_dict["irrigation_last_1h"] = float(record.get("irrigation_last_1h", 0.0))
        feature_dict["irrigation_last_3h"] = float(record.get("irrigation_last_3h", feature_dict["irrigation_litres"]))
        feature_dict["irrigation_last_6h"] = float(record.get("irrigation_last_6h", feature_dict["irrigation_litres"]))

        # Build ordered vector
        X_vec = np.array([[feature_dict[col] for col in self.features]], dtype=np.float64)

        # 5. Run Inference
        if self.model_type == "hybrid":
            y_pred_arr = self.model.predict(X_vec, np.array([y_phys]))
            y_pred = float(y_pred_arr[0])
        else:
            raw_pred = self.model.predict(X_vec)
            y_pred = float(np.clip(raw_pred[0], WILTING_POINT_PCT * 0.7, SATURATION_PCT))

        y_pred = round(y_pred, 2)
        dryness_pred = round(max(0.0, 100.0 - y_pred), 2)
        delta = round(y_pred - m_t, 2)

        return {
            "status": "SUCCESS",
            "current_soil_moisture_pct": m_t,
            "predicted_soil_moisture_3h": y_pred,
            "predicted_soil_dryness_3h": dryness_pred,
            "physics_prior_3h": round(y_phys, 2),
            "expected_moisture_change_3h": delta,
            "model_name": self.model_name,
            "model_type": self.model_type,
            "model_version": "2.0.0",
            "pump_control_allowed": False,  # Strict: ML NEVER directly controls pump
        }
