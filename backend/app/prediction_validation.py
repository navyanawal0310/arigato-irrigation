"""
KRISHI SETU: Prediction-to-Actual Field Validation Pipeline (Phase 6)
====================================================================
Measures real-world predictive performance of the Soil-Water V2 model
against verified ground truth telemetry observations.

SCIENTIFIC PRINCIPLES:
1. Strict Separation:
   Simulated development metrics (RMSE: 0.9586 pp on 900h synthetic data)
   must NEVER be combined with or claimed as real field validation metrics.
2. Verified Ground Truth Only:
   Only physical observations with verified healthy sensor status and
   valid moisture readings are admissible as ground truth.
   Sensor FAULTs (e.g. ADC 254 / 0%) are NEVER used as actuals.
3. Server-Side Cadence:
   Limits prediction candidates to 1 per device per hour (configurable),
   preventing rapid polling from creating duplicate records.
4. Deterministic Error Units:
   All errors expressed in percentage points (pp), signed and absolute:
   - signed_error_pp   = predicted - actual
   - absolute_error_pp = abs(predicted - actual)
   - squared_error     = (predicted - actual)^2
"""

from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone, timedelta
import math
import uuid
import logging
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from backend.app.database import get_database, get_telemetry_collection
from backend.app.schemas import serialize_mongo_document

logger = logging.getLogger("krishi_setu.prediction_validation")

# Configurable Operational Parameters
VALIDATION_HORIZON_HOURS = 3          # Prediction lookahead (+3 hours)
PREDICTION_CADENCE_MINUTES = 60       # Maximum 1 validation candidate per device per hour
TARGET_MATCH_TOLERANCE_MINUTES = 15   # Window around target_at to select closest observation (±15 min)
MIN_STATISTICAL_SAMPLE_SIZE = 30      # Minimum N before designating metrics as statistically significant

# Physical Soil Bounds (Sandy Clay Loam Solanaceae Benchmark)
MIN_PHYSICAL_MOISTURE = 5.0           # Below hygroscopic limit
MAX_PHYSICAL_MOISTURE = 55.0          # Total pore saturation limit


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


def is_valid_actual_soil(doc: Dict[str, Any]) -> bool:
    """
    Validates whether a telemetry document contains legitimate ground truth soil moisture.
    Rejects hardware faults, disconnected probes, and out-of-bounds readings.
    """
    if not isinstance(doc, dict):
        return False

    soil = doc.get("soil", {})
    quality = doc.get("quality", {})
    status = str(soil.get("status", "")).upper()
    raw_adc = soil.get("raw_adc") if "raw_adc" in soil else soil.get("adc_raw")
    moisture = soil.get("moisture_pct") if "moisture_pct" in soil else soil.get("moisture_index")

    # Critical health checks
    if status not in ["HEALTHY", "OK"]:
        return False
    if quality.get("soil_valid") is False:
        return False
    if not is_finite_number(moisture):
        return False

    moist_val = float(moisture)
    if moist_val <= 0.0 or moist_val > 60.0:
        return False

    # Hardware ADC sanity (300 - 3800 represents calibrated active capacitive probe)
    if raw_adc is not None and is_finite_number(raw_adc):
        raw_val = float(raw_adc)
        if raw_val < 300.0 or raw_val > 3800.0:
            return False

    return True


def get_doc_datetime(doc: Dict[str, Any], key: str = "recorded_at") -> datetime:
    """Safely extracts a timezone-aware UTC datetime from a document field."""
    dt = doc.get(key)
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    if isinstance(dt, str):
        try:
            parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            pass
    return datetime.now(timezone.utc)


class PredictionValidationService:
    """
    Manages the lifecycle of prediction candidates and ground truth matching.
    """

    def __init__(
        self,
        horizon_hours: int = VALIDATION_HORIZON_HOURS,
        cadence_minutes: int = PREDICTION_CADENCE_MINUTES,
        tolerance_minutes: int = TARGET_MATCH_TOLERANCE_MINUTES,
    ):
        self.horizon_hours = horizon_hours
        self.cadence_minutes = cadence_minutes
        self.tolerance_minutes = tolerance_minutes
        self.model_name = "Soil-Water V2"
        self.model_version = "v2"
        self.training_scope = "simulated-development"
        self.dev_rmse_pp = 0.9586

    def get_predictions_collection(self, coll=None):
        """Returns the predictions collection or the provided mock."""
        if coll is not None:
            return coll
        db = get_database()
        return db["predictions"]

    # =========================================================================
    # 1. RECORD VALID PREDICTION CANDIDATE
    # =========================================================================
    def record_prediction_candidate(
        self,
        telemetry_doc: Dict[str, Any],
        inference_result: Dict[str, Any],
        predictions_coll=None,
    ) -> Optional[Dict[str, Any]]:
        """
        Creates a validation candidate record for a valid live prediction.
        Applies strict gating and server-side cadence deduplication.
        Returns the inserted record or None if skipped.
        """
        # Gate 1: Only store when prediction status is 'ok'
        if not inference_result or inference_result.get("status") != "ok":
            return None

        # Gate 2: Verify prediction value is finite and physically plausible
        pred_val = inference_result.get("predicted_soil_moisture_pct")
        current_val = inference_result.get("current_soil_moisture_pct")
        if not is_finite_number(pred_val) or not is_finite_number(current_val):
            return None

        pred_float = float(pred_val)
        current_float = float(current_val)
        if pred_float < 0.0 or pred_float > 60.0:
            return None

        device_id = telemetry_doc.get("device_id", "AquaMatrix-MaxCore")
        created_at = get_doc_datetime(telemetry_doc, "recorded_at")
        target_at = created_at + timedelta(hours=self.horizon_hours)

        coll = self.get_predictions_collection(predictions_coll)

        # Gate 3: Deduplication & Cadence Check
        # Generate an hourly deduplication bucket key (e.g. 'AquaMatrix-MaxCore_20260926_10')
        dedup_key = f"{device_id}_{created_at.strftime('%Y%m%d_%H')}"

        # Check if an observation was already recorded within the cadence window
        min_allowed_time = created_at - timedelta(minutes=self.cadence_minutes)
        existing = coll.find_one({
            "device_id": device_id,
            "created_at": {"$gte": min_allowed_time},
        })
        if existing:
            logger.debug(
                f"[VALIDATION PIPELINE] Cadence limit: Prediction already recorded for {device_id} "
                f"at {existing.get('created_at')}. Skipping duplicate candidate."
            )
            return None

        # Extract features for audit trail
        soil = telemetry_doc.get("soil", {})
        atmosphere = telemetry_doc.get("atmosphere") or telemetry_doc.get("weather") or {}
        crop = telemetry_doc.get("crop", {})

        prediction_id = str(uuid.uuid4())
        record = {
            "prediction_id": prediction_id,
            "device_id": device_id,
            "created_at": created_at,
            "target_at": target_at,
            "horizon_hours": self.horizon_hours,
            "dedup_key": dedup_key,
            "model": {
                "name": self.model_name,
                "version": inference_result.get("model_version", self.model_version),
                "training_scope": self.training_scope,
            },
            "input": {
                "current_soil_moisture_pct": current_float,
                "soil_status": soil.get("status", "HEALTHY"),
                "weather_features": {
                    "temp_c": atmosphere.get("temp_c"),
                    "humidity_pct": atmosphere.get("humidity_pct"),
                    "et0_fao56_mm": atmosphere.get("et0_fao56_mm") or atmosphere.get("et0_mm_day"),
                    "forecast_rain_3h_mm": atmosphere.get("forecast_rain_next_3h_mm") or atmosphere.get("forecast_rain_mm", 0.0),
                },
                "crop_features": {
                    "profile_id": crop.get("profile_id", "TOMATO_VEG"),
                    "kc_factor": crop.get("kc_factor", 0.85),
                },
            },
            "prediction": {
                "soil_moisture_pct": pred_float,
                "change_pct_points": float(inference_result.get("change_pct_points", 0.0)),
            },
            "validation": {
                "status": "PENDING",
                "actual_soil_moisture_pct": None,
                "actual_observed_at": None,
                "matched_telemetry_id": None,
                "time_difference_sec": None,
                "absolute_error_pp": None,
                "signed_error_pp": None,
                "squared_error": None,
                "validated_at": None,
                "notes": None,
            },
        }

        try:
            coll.insert_one(record)
            logger.info(
                f"[VALIDATION PIPELINE] Registered prediction candidate {prediction_id} "
                f"for device {device_id}: Predicted {pred_float}% at target {target_at.isoformat()}"
            )
            return record
        except DuplicateKeyError:
            logger.info(f"[VALIDATION PIPELINE] DuplicateKeyError for dedup_key {dedup_key}. Skipped.")
            return None
        except Exception as e:
            logger.error(f"[VALIDATION PIPELINE] Failed to store prediction candidate: {e}", exc_info=True)
            return None

    # =========================================================================
    # 2. VALIDATION WORKER: MATCH MATURED PREDICTIONS
    # =========================================================================
    def validate_matured_predictions(
        self,
        predictions_coll=None,
        telemetry_coll=None,
        now_utc: Optional[datetime] = None,
        tolerance_minutes: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Scans for predictions with status='PENDING' and target_at <= now_utc.
        Matches against legitimate ground truth observations in telemetry_coll.
        Returns a summary of processed candidates.
        """
        p_coll = self.get_predictions_collection(predictions_coll)
        t_coll = telemetry_coll if telemetry_coll is not None else get_telemetry_collection()
        now = now_utc if now_utc is not None else datetime.now(timezone.utc)
        tol_mins = tolerance_minutes if tolerance_minutes is not None else self.tolerance_minutes

        # Query pending matured predictions
        query = {
            "validation.status": "PENDING",
            "target_at": {"$lte": now},
        }
        cursor = p_coll.find(query)
        pending_list = list(cursor)

        processed = 0
        validated = 0
        no_match = 0
        invalid_target = 0

        for pred in pending_list:
            processed += 1
            device_id = pred.get("device_id")
            target_at = get_doc_datetime(pred, "target_at")
            pred_id = pred.get("prediction_id") or str(pred.get("_id"))
            predicted_val = float(pred.get("prediction", {}).get("soil_moisture_pct", 0.0))

            window_start = target_at - timedelta(minutes=tol_mins)
            window_end = target_at + timedelta(minutes=tol_mins)

            # Query real telemetry observations within tolerance window
            t_query = {
                "device_id": device_id,
                "recorded_at": {"$gte": window_start, "$lte": window_end},
            }
            candidate_docs = list(t_coll.find(t_query))

            if not candidate_docs:
                # No telemetry recorded around this target window
                update_fields = {
                    "validation.status": "NO_MATCH",
                    "validation.validated_at": now,
                    "validation.notes": f"No telemetry observations found within ±{tol_mins}m window.",
                }
                p_coll.update_one({"_id": pred["_id"]}, {"$set": update_fields})
                no_match += 1
                logger.info(f"[VALIDATION PIPELINE] Prediction {pred_id}: NO_MATCH (no observations in ±{tol_mins}m).")
                continue

            # Sort candidate observations by absolute time distance to target_at
            candidate_docs.sort(
                key=lambda doc: abs((get_doc_datetime(doc, "recorded_at") - target_at).total_seconds())
            )

            # Look for the closest VALID telemetry observation
            valid_doc = None
            for doc in candidate_docs:
                if is_valid_actual_soil(doc):
                    valid_doc = doc
                    break

            if valid_doc is None:
                # Observations were found, but ALL had sensor faults / out-of-bounds
                update_fields = {
                    "validation.status": "INVALID_TARGET_DATA",
                    "validation.validated_at": now,
                    "validation.notes": (
                        f"All {len(candidate_docs)} observations in ±{tol_mins}m window "
                        f"contained hardware sensor faults (e.g. soil.status=FAULT/ADC out of range)."
                    ),
                }
                p_coll.update_one({"_id": pred["_id"]}, {"$set": update_fields})
                invalid_target += 1
                logger.info(f"[VALIDATION PIPELINE] Prediction {pred_id}: INVALID_TARGET_DATA (sensor faults at target).")
                continue

            # Successful valid ground truth match
            actual_moist = float(valid_doc["soil"]["moisture_pct"])
            actual_time = get_doc_datetime(valid_doc, "recorded_at")
            time_diff_sec = round(abs((actual_time - target_at).total_seconds()), 1)

            # Error metrics calculation (in percentage points 'pp')
            signed_error = round(predicted_val - actual_moist, 4)
            abs_error = round(abs(predicted_val - actual_moist), 4)
            sq_error = round((predicted_val - actual_moist) ** 2, 4)

            update_fields = {
                "validation.status": "VALIDATED",
                "validation.actual_soil_moisture_pct": actual_moist,
                "validation.actual_observed_at": actual_time,
                "validation.matched_telemetry_id": str(valid_doc.get("_id", "")),
                "validation.time_difference_sec": time_diff_sec,
                "validation.signed_error_pp": signed_error,
                "validation.absolute_error_pp": abs_error,
                "validation.squared_error": sq_error,
                "validation.validated_at": now,
                "validation.notes": f"Matched valid telemetry {valid_doc.get('device_id')} within {time_diff_sec:.1f}s of target.",
            }
            p_coll.update_one({"_id": pred["_id"]}, {"$set": update_fields})
            validated += 1
            logger.info(
                f"[VALIDATION PIPELINE] Prediction {pred_id}: VALIDATED -> "
                f"Pred: {predicted_val}%, Actual: {actual_moist}%, "
                f"Error: {signed_error:+.2f} pp (Abs: {abs_error:.2f} pp)"
            )

        return {
            "processed_count": processed,
            "validated_count": validated,
            "no_match_count": no_match,
            "invalid_target_count": invalid_target,
        }

    # =========================================================================
    # 3. FIELD VALIDATION SUMMARY
    # =========================================================================
    def get_validation_summary(
        self,
        predictions_coll=None,
        device_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Computes real-world evaluation statistics strictly from matured, validated field records.
        Never combines simulated metrics with real field metrics.
        """
        p_coll = self.get_predictions_collection(predictions_coll)

        query = {"device_id": device_id} if device_id else {}
        all_preds = list(p_coll.find(query))

        total_count = len(all_preds)
        pending_count = sum(1 for p in all_preds if p.get("validation", {}).get("status") == "PENDING")
        no_match_count = sum(1 for p in all_preds if p.get("validation", {}).get("status") == "NO_MATCH")
        invalid_target_count = sum(1 for p in all_preds if p.get("validation", {}).get("status") == "INVALID_TARGET_DATA")

        validated_list = [p for p in all_preds if p.get("validation", {}).get("status") == "VALIDATED"]
        validated_count = len(validated_list)

        base_summary = {
            "model": self.model_name,
            "model_version": self.model_version,
            "scope": "REAL_FIELD_VALIDATION",
            "training_scope": self.training_scope,
            "development_benchmark": {
                "model_name": "Direct_ExtraTrees",
                "training_dataset_scope": "physically-constrained-simulated-dev",
                "simulated_test_rmse_pp": self.dev_rmse_pp,
                "note": "Benchmark derived from simulated development data. Stored for baseline comparison only. NEVER combine with real field validation.",
            },
            "horizon_hours": self.horizon_hours,
            "tolerance_minutes": self.tolerance_minutes,
            "total_predictions": total_count,
            "pending_predictions": pending_count,
            "no_match": no_match_count,
            "invalid_target_data": invalid_target_count,
            "validated_predictions": validated_count,
        }

        # If zero predictions have been validated, return null metrics and collecting_data status
        if validated_count == 0:
            return {
                **base_summary,
                "status": "collecting_data",
                "mae_pp": None,
                "rmse_pp": None,
                "mean_bias_pp": None,
                "first_validation_at": None,
                "last_validation_at": None,
                "message": (
                    "Collecting field validation data. Real predictions require a 3-hour maturation window "
                    "before verified ground truth telemetry can be matched."
                ),
            }

        # Calculate field validation metrics
        abs_errors = [p["validation"]["absolute_error_pp"] for p in validated_list if is_finite_number(p["validation"].get("absolute_error_pp"))]
        sq_errors = [p["validation"]["squared_error"] for p in validated_list if is_finite_number(p["validation"].get("squared_error"))]
        signed_errors = [p["validation"]["signed_error_pp"] for p in validated_list if is_finite_number(p["validation"].get("signed_error_pp"))]

        mae = round(sum(abs_errors) / len(abs_errors), 4) if abs_errors else None
        rmse = round(math.sqrt(sum(sq_errors) / len(sq_errors)), 4) if sq_errors else None
        mean_bias = round(sum(signed_errors) / len(signed_errors), 4) if signed_errors else None

        valid_times = [
            get_doc_datetime(p["validation"], "actual_observed_at")
            for p in validated_list
            if p.get("validation", {}).get("actual_observed_at")
        ]
        first_val_at = min(valid_times).isoformat() if valid_times else None
        last_val_at = max(valid_times).isoformat() if valid_times else None

        sample_status = (
            f"STATISTICALLY_SIGNIFICANT (N={validated_count} >= {MIN_STATISTICAL_SAMPLE_SIZE})"
            if validated_count >= MIN_STATISTICAL_SAMPLE_SIZE
            else f"PRELIMINARY_EVALUATION (N={validated_count} < {MIN_STATISTICAL_SAMPLE_SIZE})"
        )

        return {
            **base_summary,
            "status": "ok",
            "mae_pp": mae,
            "rmse_pp": rmse,
            "mean_bias_pp": mean_bias,
            "first_validation_at": first_val_at,
            "last_validation_at": last_val_at,
            "sample_status": sample_status,
        }

    # =========================================================================
    # 4. VALIDATION HISTORY
    # =========================================================================
    def get_validation_history(
        self,
        predictions_coll=None,
        device_id: Optional[str] = None,
        limit: int = 50,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Returns recent prediction/actual pairs sorted chronologically descending.
        """
        p_coll = self.get_predictions_collection(predictions_coll)

        query: Dict[str, Any] = {}
        if device_id:
            query["device_id"] = device_id
        if status:
            query["validation.status"] = status.upper()

        cursor = p_coll.find(query, sort=[("created_at", DESCENDING)]).limit(min(limit, 200))
        results = []
        for doc in cursor:
            s_doc = serialize_mongo_document(doc)
            val = s_doc.get("validation", {})
            pred = s_doc.get("prediction", {})
            inp = s_doc.get("input", {})

            results.append({
                "prediction_id": s_doc.get("prediction_id"),
                "device_id": s_doc.get("device_id"),
                "created_at": s_doc.get("created_at"),
                "target_at": s_doc.get("target_at"),
                "horizon_hours": s_doc.get("horizon_hours", 3),
                "current_moisture_pct": inp.get("current_soil_moisture_pct"),
                "predicted_moisture_pct": pred.get("soil_moisture_pct"),
                "change_pct_points": pred.get("change_pct_points"),
                "actual_moisture_pct": val.get("actual_soil_moisture_pct"),
                "actual_observed_at": val.get("actual_observed_at"),
                "time_difference_sec": val.get("time_difference_sec"),
                "absolute_error_pp": val.get("absolute_error_pp"),
                "signed_error_pp": val.get("signed_error_pp"),
                "squared_error": val.get("squared_error"),
                "validation_status": val.get("status"),
                "model_version": s_doc.get("model", {}).get("version", "v2"),
                "notes": val.get("notes"),
            })
        return results


# Global singleton service
validation_service = PredictionValidationService()
