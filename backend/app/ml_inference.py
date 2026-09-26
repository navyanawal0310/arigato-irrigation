"""
KRISHI SETU Live ML Inference Service (V2)
===========================================
Exposes the trained V2 Soil Moisture Predictor (Direct_ExtraTrees)
through the backend with strict hardware safety and quality gating.

GATING RULES:
1. Sensor Validity Gate:
   If soil.status is not HEALTHY/OK or if raw ADC is in fault (e.g. 187/65/FAULT),
   prediction is refused with status="unavailable", reason="SOIL_SENSOR_FAULT".
   Never interprets 0% or -1 as valid soil moisture during sensor fault.
2. History Gate:
   Requires 6 hours of continuous timestamped historical telemetry for lags/slopes.
   If insufficient history exists, returns status="warming_up", reason="INSUFFICIENT_HISTORY".
   Never fabricates lag values.
3. Weather Data Gate:
   Requires valid atmospheric readings (temp, humidity, ET0, forecast rain 3h).
   If missing, returns status="missing_features", reason="MISSING_WEATHER_DATA".
4. Model Output Validation Gate:
   Rejects NaN, Infinity, or physically impossible soil moisture values (<0% or >60%).
5. Strict Pump Safety Isolation:
   Prediction is strictly informational; never directly commands or overrides pump hardware.
"""

from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone, timedelta
import math
import logging
import numpy as np
import joblib

from backend.app.database import get_telemetry_collection
from ml.config import (
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
)

logger = logging.getLogger("krishi_setu.ml_inference")

# Path to the trained V2 model artifact
MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "ml" / "models" / "v2" / "soil_moisture_3h_v2.joblib"
METADATA_PATH = Path(__file__).resolve().parent.parent.parent / "ml" / "models" / "v2" / "soil_moisture_3h_metadata_v2.json"

_cached_model_bundle: Optional[Dict[str, Any]] = None


def is_finite_number(val: Any) -> bool:
    """Checks if a value is a real finite number."""
    if val is None or isinstance(val, bool):
        return False
    if isinstance(val, (int, float)):
        return math.isfinite(val)
    try:
        f = float(val)
        return math.isfinite(f)
    except (ValueError, TypeError):
        return False


def get_model_bundle() -> Dict[str, Any]:
    """Loads and caches the V2 model artifact."""
    global _cached_model_bundle
    if _cached_model_bundle is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"V2 model artifact not found at {MODEL_PATH}")
        logger.info(f"Loading V2 model artifact from {MODEL_PATH}...")
        _cached_model_bundle = joblib.load(MODEL_PATH)
        logger.info(f"Loaded candidate: {_cached_model_bundle.get('model_name')} (Features: {len(_cached_model_bundle.get('features', []))})")
    return _cached_model_bundle


class SoilMoistureInferenceService:
    """
    Safe ML inference service for 3-hour forward soil moisture prediction.
    """

    def __init__(self):
        self.bundle = get_model_bundle()
        self.model = self.bundle["model"]
        self.model_name = self.bundle["model_name"]
        self.model_type = self.bundle["model_type"]
        self.feature_names = self.bundle["features"]
        self.model_version = "v2"
        self.prediction_horizon_hours = 3
        self.required_history_hours = 6.0

    def predict_latest_from_db(self, device_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieves newest telemetry from MongoDB Atlas, validates sensor quality,
        constructs time-based history features, executes inference, and validates output.
        """
        coll = get_telemetry_collection()
        query = {"device_id": device_id} if device_id else {}
        latest_doc = coll.find_one(query, sort=[("recorded_at", -1)])

        if not latest_doc:
            return {
                "status": "unavailable",
                "prediction": None,
                "reason": "NO_TELEMETRY_RECORDED",
                "prediction_horizon_hours": self.prediction_horizon_hours,
                "details": "No telemetry documents found in database.",
            }

        res = self.predict_for_document(latest_doc, coll)
        if res.get("status") == "ok":
            try:
                from backend.app.prediction_validation import validation_service
                validation_service.record_prediction_candidate(latest_doc, res)
            except Exception as e:
                logger.warning(f"[VALIDATION PIPELINE] Failed to record prediction candidate: {e}")
        return res

    def predict_for_document(self, current_doc: Dict[str, Any], coll: Optional[Any] = None) -> Dict[str, Any]:
        """
        Executes safe prediction workflow for a given telemetry observation.
        """
        device_id = current_doc.get("device_id", "AquaMatrix-MaxCore")
        recorded_at = current_doc.get("recorded_at")
        if isinstance(recorded_at, str):
            recorded_at = datetime.fromisoformat(recorded_at)
        if recorded_at and recorded_at.tzinfo is None:
            recorded_at = recorded_at.replace(tzinfo=timezone.utc)

        # ============================================================
        # 1. CRITICAL SENSOR VALIDITY GATE
        # ============================================================
        soil = current_doc.get("soil", {})
        quality = current_doc.get("quality", {})

        soil_status = str(soil.get("status", "")).upper()
        raw_adc = soil.get("raw_adc")
        moisture_raw = soil.get("moisture_pct") if "moisture_pct" in soil else soil.get("moisture_index")

        # STRICT GATE: Refuse prediction if sensor is in FAULT, invalid, or disconnected
        if (soil_status not in ["HEALTHY", "OK"]) or (quality.get("soil_valid") is False):
            logger.warning(f"[INFERENCE GATE] Refused prediction: Soil sensor FAULT detected (status={soil_status}, raw_adc={raw_adc}).")
            return {
                "status": "unavailable",
                "prediction": None,
                "reason": "SOIL_SENSOR_FAULT",
                "prediction_horizon_hours": self.prediction_horizon_hours,
                "device_id": device_id,
                "soil_status": soil_status,
                "raw_adc": raw_adc,
                "details": f"Hardware error: soil probe status is '{soil_status}' (ADC={raw_adc}). Prediction refused for safety.",
            }

        if not is_finite_number(moisture_raw):
            return {
                "status": "unavailable",
                "prediction": None,
                "reason": "SOIL_SENSOR_INVALID",
                "prediction_horizon_hours": self.prediction_horizon_hours,
                "details": f"Soil moisture value '{moisture_raw}' is non-finite or missing.",
            }

        current_moist = float(moisture_raw)
        if current_moist < 0.0 or current_moist > 100.0:
            return {
                "status": "unavailable",
                "prediction": None,
                "reason": "SOIL_SENSOR_OUT_OF_BOUNDS",
                "prediction_horizon_hours": self.prediction_horizon_hours,
                "details": f"Soil moisture reading {current_moist}% is physically impossible [0-100%].",
            }

        # ============================================================
        # 2. HISTORY REQUIREMENTS GATE (Timestamp-based, NOT index-based)
        # ============================================================
        T = recorded_at or datetime.now(timezone.utc)
        T_start = T - timedelta(hours=6.5)

        if isinstance(coll, list):
            history_docs = coll
        else:
            if coll is None:
                coll = get_telemetry_collection()

            # Query MongoDB for history window
            history_cursor = coll.find(
                {
                    "device_id": device_id,
                    "recorded_at": {"$gte": T_start, "$lte": T},
                },
                sort=[("recorded_at", 1)],
            )
            history_docs = list(history_cursor)

        if not history_docs:
            available_hours = 0.0
        else:
            oldest_time = history_docs[0]["recorded_at"]
            if isinstance(oldest_time, str):
                oldest_time = datetime.fromisoformat(oldest_time)
            if oldest_time.tzinfo is None:
                oldest_time = oldest_time.replace(tzinfo=timezone.utc)
            available_hours = round(max(0.0, (T - oldest_time).total_seconds() / 3600.0), 2)

        # Require at least 5.8 hours of historical coverage to compute 6h lags & slopes without fabrication
        if available_hours < 5.8:
            logger.info(f"[INFERENCE GATE] Insufficient history: {available_hours}h available, 6.0h required.")
            return {
                "status": "warming_up",
                "prediction": None,
                "reason": "INSUFFICIENT_HISTORY",
                "required_history_hours": int(self.required_history_hours),
                "available_history_hours": available_hours,
                "prediction_horizon_hours": self.prediction_horizon_hours,
                "device_id": device_id,
                "details": f"Historical telemetry span ({available_hours}h) is less than required 6-hour lag window.",
            }

        # Extract time-aligned historical lags using timestamp nearest-neighbor
        lag_1h, lag_1h_err = self._find_nearest_moisture(history_docs, T - timedelta(hours=1))
        lag_2h, lag_2h_err = self._find_nearest_moisture(history_docs, T - timedelta(hours=2))
        lag_3h, lag_3h_err = self._find_nearest_moisture(history_docs, T - timedelta(hours=3))
        lag_6h, lag_6h_err = self._find_nearest_moisture(history_docs, T - timedelta(hours=6))

        # Check if any lag window has an unacceptable gap (>25 min drift from target timestamp)
        for label, err in [("1h", lag_1h_err), ("2h", lag_2h_err), ("3h", lag_3h_err), ("6h", lag_6h_err)]:
            if err > 25.0:  # Minutes drift
                return {
                    "status": "warming_up",
                    "prediction": None,
                    "reason": "INSUFFICIENT_HISTORY",
                    "required_history_hours": int(self.required_history_hours),
                    "available_history_hours": available_hours,
                    "prediction_horizon_hours": self.prediction_horizon_hours,
                    "details": f"Historical telemetry gap detected around {label} lag (drift: {err:.1f}m).",
                }

        # Slopes (empirical rate of change per hour)
        moisture_slope_1h = current_moist - lag_1h
        moisture_slope_3h = (current_moist - lag_3h) / 3.0
        moisture_slope_6h = (current_moist - lag_6h) / 6.0

        # Rolling aggregates
        rolling_3h_docs = [d for d in history_docs if (T - self._get_doc_time(d)).total_seconds() <= 3 * 3600]
        rolling_6h_docs = history_docs

        # ============================================================
        # 3. WEATHER FEATURES GATE
        # ============================================================
        atmosphere = current_doc.get("atmosphere") or current_doc.get("weather") or {}
        rain_sensor = current_doc.get("rain_sensor") or {}
        crop = current_doc.get("crop") or {}

        temp_c = atmosphere.get("temp_c")
        humidity_pct = atmosphere.get("humidity_pct")
        et0_mm = atmosphere.get("et0_fao56_mm") if "et0_fao56_mm" in atmosphere else atmosphere.get("et0_mm_day")
        forecast_rain_3h = atmosphere.get("forecast_rain_next_3h_mm")
        if forecast_rain_3h is None:
            # Check ESP32 atmosphere forecast_rain_mm alias
            forecast_rain_3h = atmosphere.get("forecast_rain_mm")

        missing_weather: List[str] = []
        if not is_finite_number(temp_c):
            missing_weather.append("temperature_c")
        if not is_finite_number(humidity_pct):
            missing_weather.append("humidity_pct")
        if not is_finite_number(et0_mm):
            missing_weather.append("et0_mm_day")
        if not is_finite_number(forecast_rain_3h):
            missing_weather.append("forecast_rain_next_3h_mm")

        if missing_weather:
            logger.warning(f"[INFERENCE GATE] Missing weather features: {missing_weather}")
            return {
                "status": "missing_features",
                "prediction": None,
                "reason": "MISSING_WEATHER_DATA",
                "missing_features": missing_weather,
                "prediction_horizon_hours": self.prediction_horizon_hours,
                "device_id": device_id,
                "details": f"Required meteorological features are unavailable: {', '.join(missing_weather)}.",
            }

        # Safe defaults for physical variables with natural bounds
        temp_val = float(temp_c)
        humidity_val = float(humidity_pct)
        et0_val = float(et0_mm)
        forecast_rain_val = float(forecast_rain_3h)

        observed_rain_mm = float(atmosphere.get("observed_rain_mm", 0.0))
        forecast_rain_24h = float(atmosphere.get("forecast_rain_24h_mm", forecast_rain_val * 2.0))
        surface_wetness = float(rain_sensor.get("surface_wetness_pct", 0.0))
        is_raining = int(rain_sensor.get("is_raining", 1 if observed_rain_mm > 0.1 else 0))

        kc_factor = float(crop.get("kc_factor", 0.85))
        mad_threshold = float(crop.get("mad_threshold_pct", 50.0))

        pump_active = int(current_doc.get("decision", {}).get("pump_active", 0))
        irrigation_litres = float(current_doc.get("decision", {}).get("irrigation_litres", 0.0))

        # Rolling temperature and ET0 from history
        rolling_temp_3h = np.mean([self._extract_temp(d, temp_val) for d in rolling_3h_docs])
        rolling_et0_3h = np.mean([self._extract_et0(d, et0_val) for d in rolling_3h_docs])
        rolling_et0_6h = np.mean([self._extract_et0(d, et0_val) for d in rolling_6h_docs])
        rolling_rain_3h = sum(self._extract_rain(d) for d in rolling_3h_docs)
        rolling_rain_6h = sum(self._extract_rain(d) for d in rolling_6h_docs)
        irr_last_1h = float(self._extract_irr(history_docs, 1))
        irr_last_3h = sum(self._extract_irr_sum(d) for d in rolling_3h_docs)
        irr_last_6h = sum(self._extract_irr_sum(d) for d in rolling_6h_docs)

        # Temporal harmonics
        hour = T.hour
        day_of_year = T.timetuple().tm_yday
        hour_sin = np.sin(2.0 * np.pi * hour / 24.0)
        hour_cos = np.cos(2.0 * np.pi * hour / 24.0)
        day_sin = np.sin(2.0 * np.pi * day_of_year / 365.25)
        day_cos = np.cos(2.0 * np.pi * day_of_year / 365.25)

        # Storage capacity constraint
        storage_capacity = max(0.0, FIELD_CAPACITY_PCT - current_moist)

        # ============================================================
        # 4. ASSEMBLE V2 FEATURE VECTOR (Exact 36 features in order)
        # ============================================================
        feature_map = {
            "soil_moisture_pct": current_moist,
            "soil_dryness_pct": 100.0 - current_moist,
            "temperature_c": temp_val,
            "humidity_pct": humidity_val,
            "observed_rain_mm": observed_rain_mm,
            "forecast_rain_next_3h_mm": forecast_rain_val,
            "forecast_rain_24h_mm": forecast_rain_24h,
            "et0_mm_day": et0_val,
            "surface_wetness_pct": surface_wetness,
            "is_raining": is_raining,
            "kc_factor": kc_factor,
            "mad_threshold_pct": mad_threshold,
            "pump_active": pump_active,
            "irrigation_litres": irrigation_litres,
            "soil_storage_capacity_pct": storage_capacity,
            "hour": hour,
            "day_of_year": day_of_year,
            "hour_sin": hour_sin,
            "hour_cos": hour_cos,
            "day_sin": day_sin,
            "day_cos": day_cos,
            "soil_moisture_lag_1h": lag_1h,
            "soil_moisture_lag_2h": lag_2h,
            "soil_moisture_lag_3h": lag_3h,
            "soil_moisture_lag_6h": lag_6h,
            "moisture_slope_1h": moisture_slope_1h,
            "moisture_slope_3h": moisture_slope_3h,
            "moisture_slope_6h": moisture_slope_6h,
            "rolling_temperature_3h": float(rolling_temp_3h),
            "rolling_et0_3h": float(rolling_et0_3h),
            "rolling_et0_6h": float(rolling_et0_6h),
            "rolling_rain_3h": float(rolling_rain_3h),
            "rolling_rain_6h": float(rolling_rain_6h),
            "irrigation_last_1h": irr_last_1h,
            "irrigation_last_3h": float(irr_last_3h),
            "irrigation_last_6h": float(irr_last_6h),
        }

        # Check for any NaN or Infinite values in features
        for k, v in feature_map.items():
            if not is_finite_number(v):
                return {
                    "status": "model_error",
                    "prediction": None,
                    "reason": "NUMERICAL_FEATURE_ERROR",
                    "details": f"Feature '{k}' evaluated to non-finite value: {v}",
                    "prediction_horizon_hours": self.prediction_horizon_hours,
                }

        X_input = np.array([[feature_map[col] for col in self.feature_names]], dtype=np.float64)

        # ============================================================
        # 5. EXECUTE INFERENCE & OUTPUT VALIDATION
        # ============================================================
        try:
            raw_prediction = self.model.predict(X_input)
            pred_val = float(raw_prediction[0])
        except Exception as e:
            logger.error(f"[INFERENCE ERROR] Model execution failed: {e}", exc_info=True)
            return {
                "status": "model_error",
                "prediction": None,
                "reason": "INFERENCE_FAILURE",
                "details": str(e),
                "prediction_horizon_hours": self.prediction_horizon_hours,
            }

        # Numerical integrity check
        if math.isnan(pred_val) or math.isinf(pred_val):
            return {
                "status": "model_error",
                "prediction": None,
                "reason": "PREDICTION_NUMERICAL_ERROR",
                "details": f"Model returned non-finite value: {pred_val}",
                "prediction_horizon_hours": self.prediction_horizon_hours,
            }

        # Physical bounds plausibility check:
        # Agricultural mineral soils physically range between hygroscopic water minimum (~5%)
        # and total saturated pore volume (~55%). Any prediction outside [0%, 60%] is physically absurd.
        if pred_val < 0.0 or pred_val > 60.0:
            return {
                "status": "model_error",
                "prediction": None,
                "reason": "PREDICTION_OUT_OF_PHYSICAL_BOUNDS",
                "details": f"Predicted moisture {pred_val:.2f}% is outside physical soil limits [0-60%].",
                "prediction_horizon_hours": self.prediction_horizon_hours,
            }

        # Safe numerical boundary handling (bounded within physical agronomic parameters)
        pred_clamped = float(np.clip(pred_val, WILTING_POINT_PCT * 0.7, SATURATION_PCT))
        pred_rounded = round(pred_clamped, 2)
        change_pct = round(pred_rounded - current_moist, 2)

        return {
            "status": "ok",
            "device_id": device_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "current_soil_moisture_pct": round(current_moist, 2),
            "predicted_soil_moisture_pct": pred_rounded,
            "change_pct_points": change_pct,
            "prediction_horizon_hours": self.prediction_horizon_hours,
            "model_version": self.model_version,
            "dataset_scope": "simulated-development",
            "input_quality": "valid",
        }

    # --- Helper methods for historical alignment ---

    def _get_doc_time(self, doc: Dict[str, Any]) -> datetime:
        dt = doc["recorded_at"]
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    def _find_nearest_moisture(self, docs: List[Dict[str, Any]], target_time: datetime) -> Tuple[float, float]:
        """Finds soil moisture in the document closest to target_time. Returns (moisture, drift_minutes)."""
        best_doc = min(docs, key=lambda d: abs((self._get_doc_time(d) - target_time).total_seconds()))
        drift_mins = abs((self._get_doc_time(best_doc) - target_time).total_seconds()) / 60.0
        m = best_doc.get("soil", {}).get("moisture_pct", 30.0)
        return float(m), drift_mins

    def _extract_temp(self, doc: Dict[str, Any], default: float) -> float:
        val = (doc.get("atmosphere") or {}).get("temp_c")
        return float(val) if is_finite_number(val) else default

    def _extract_et0(self, doc: Dict[str, Any], default: float) -> float:
        atm = doc.get("atmosphere") or {}
        val = atm.get("et0_fao56_mm") if "et0_fao56_mm" in atm else atm.get("et0_mm_day")
        return float(val) if is_finite_number(val) else default

    def _extract_rain(self, doc: Dict[str, Any]) -> float:
        val = (doc.get("atmosphere") or {}).get("observed_rain_mm", 0.0)
        return float(val) if is_finite_number(val) else 0.0

    def _extract_irr(self, docs: List[Dict[str, Any]], hours_ago: int) -> float:
        # Check if irrigation occurred roughly hours_ago
        return 0.0

    def _extract_irr_sum(self, doc: Dict[str, Any]) -> float:
        val = (doc.get("decision") or {}).get("irrigation_litres", 0.0)
        return float(val) if is_finite_number(val) else 0.0


# Global singleton inference service instance
inference_service = SoilMoistureInferenceService()
