"""
Unit & Integration Tests: Prediction-to-Actual Field Validation Pipeline (Phase 6)
==================================================================================
Tests:
1. Valid prediction candidate stored in predictions collection
2. Invalid prediction (FAULT/model_error/NaN) NOT stored
3. Duplicate prediction prevented within cadence window (1 per device per hour)
4. Target time is exactly +3 hours from prediction creation time
5. Valid actual observation correctly matched
6. Nearest observation selected when multiple observations exist
7. Sensor FAULT observation rejected as ground truth
8. Alternate valid observation selected within tolerance when closest has FAULT
9. No observation in tolerance window -> NO_MATCH
10. Only FAULT observations in tolerance window -> INVALID_TARGET_DATA (no error metrics)
11. Absolute error calculation (|predicted - actual|)
12. Signed error calculation (predicted - actual)
13. Summary with zero validations returns null metrics and status='collecting_data'
14. Summary metrics strictly use only VALIDATED records
15. Simulated development metrics remain separate from field validation summary
16. Section 21 Acceptance Scenario: 10:00 -> 13:00, pred 43.8%, actual 44.6% -> signed -0.8 pp, abs 0.8 pp
"""

import unittest
from datetime import datetime, timezone, timedelta
import uuid

from backend.app.prediction_validation import (
    PredictionValidationService,
    is_valid_actual_soil,
    VALIDATION_HORIZON_HOURS,
    PREDICTION_CADENCE_MINUTES,
    TARGET_MATCH_TOLERANCE_MINUTES,
)


class MockCursor:
    """In-memory cursor supporting limit and list conversions."""
    def __init__(self, items):
        self.items = list(items)

    def limit(self, n):
        return MockCursor(self.items[:n])

    def __iter__(self):
        return iter(self.items)

    def __len__(self):
        return len(self.items)


class MockCollection:
    """In-memory PyMongo collection mock for fast, isolated test execution."""

    def __init__(self):
        self.docs = []

    def insert_one(self, doc):
        d = dict(doc)
        if "_id" not in d:
            d["_id"] = str(uuid.uuid4())
        self.docs.append(d)

        class InsertResult:
            inserted_id = d["_id"]
        return InsertResult()

    def find_one(self, query=None, sort=None):
        results = self._match(query)
        if not results:
            return None
        if sort:
            key, direction = sort[0]
            reverse = (direction == -1 or str(direction).lower() == "descending")
            results.sort(key=lambda x: x.get(key, datetime.min if isinstance(x.get(key), datetime) else 0), reverse=reverse)
        return dict(results[0])

    def find(self, query=None, sort=None):
        results = self._match(query)
        if sort:
            key, direction = sort[0]
            reverse = (direction == -1 or str(direction).lower() == "descending")
            results.sort(key=lambda x: x.get(key, datetime.min if isinstance(x.get(key), datetime) else 0), reverse=reverse)
        return MockCursor([dict(r) for r in results])

    def update_one(self, filter_query, update_dict):
        docs = self._match(filter_query)
        if not docs:
            return
        target = docs[0]
        if "$set" in update_dict:
            for k, v in update_dict["$set"].items():
                parts = k.split(".")
                curr = target
                for p in parts[:-1]:
                    if p not in curr:
                        curr[p] = {}
                    curr = curr[p]
                curr[parts[-1]] = v

    def _match(self, query):
        if not query:
            return list(self.docs)
        matched = []
        for d in self.docs:
            match = True
            for k, v in query.items():
                val = d
                for p in k.split("."):
                    if isinstance(val, dict):
                        val = val.get(p)
                    else:
                        val = None
                        break

                if isinstance(v, dict):
                    # Operators $gte, $lte
                    if "$gte" in v and not (val is not None and val >= v["$gte"]):
                        match = False
                        break
                    if "$lte" in v and not (val is not None and val <= v["$lte"]):
                        match = False
                        break
                else:
                    if val != v:
                        match = False
                        break
            if match:
                matched.append(d)
        return matched


class TestPredictionValidationPipeline(unittest.TestCase):

    def setUp(self):
        self.service = PredictionValidationService(
            horizon_hours=3,
            cadence_minutes=60,
            tolerance_minutes=15,
        )
        self.mock_pred_coll = MockCollection()
        self.mock_telem_coll = MockCollection()
        self.base_time = datetime(2026, 9, 26, 10, 0, 0, tzinfo=timezone.utc)

        # Baseline healthy telemetry document at t=0 (10:00)
        self.healthy_telemetry = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "HEALTHY", "raw_adc": 2100, "moisture_pct": 43.8},
            "quality": {"soil_valid": True},
            "atmosphere": {"temp_c": 26.0, "humidity_pct": 55.0, "et0_fao56_mm": 4.5},
            "crop": {"profile_id": "TOMATO_VEG", "kc_factor": 0.85},
        }

        # Baseline successful inference result
        self.valid_inference = {
            "status": "ok",
            "device_id": "AquaMatrix-MaxCore",
            "current_soil_moisture_pct": 43.8,
            "predicted_soil_moisture_pct": 41.5,
            "change_pct_points": -2.3,
            "prediction_horizon_hours": 3,
            "model_version": "v2",
        }

    # -------------------------------------------------------------
    # 1. Valid prediction candidate stored
    # -------------------------------------------------------------
    def test_valid_prediction_stored(self):
        record = self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )
        self.assertIsNotNone(record)
        self.assertEqual(len(self.mock_pred_coll.docs), 1)
        stored = self.mock_pred_coll.docs[0]
        self.assertEqual(stored["device_id"], "AquaMatrix-MaxCore")
        self.assertEqual(stored["prediction"]["soil_moisture_pct"], 41.5)
        self.assertEqual(stored["validation"]["status"], "PENDING")

    # -------------------------------------------------------------
    # 2. Invalid prediction (FAULT/model_error/NaN) NOT stored
    # -------------------------------------------------------------
    def test_invalid_prediction_not_stored(self):
        fault_inference = {
            "status": "unavailable",
            "reason": "SOIL_SENSOR_FAULT",
            "predicted_soil_moisture_pct": None,
        }
        res = self.service.record_prediction_candidate(
            self.healthy_telemetry,
            fault_inference,
            predictions_coll=self.mock_pred_coll,
        )
        self.assertIsNone(res)
        self.assertEqual(len(self.mock_pred_coll.docs), 0)

        nan_inference = {
            "status": "ok",
            "predicted_soil_moisture_pct": float("nan"),
            "current_soil_moisture_pct": 30.0,
        }
        res2 = self.service.record_prediction_candidate(
            self.healthy_telemetry,
            nan_inference,
            predictions_coll=self.mock_pred_coll,
        )
        self.assertIsNone(res2)
        self.assertEqual(len(self.mock_pred_coll.docs), 0)

    # -------------------------------------------------------------
    # 3. Duplicate prediction prevented within cadence window (1/hr)
    # -------------------------------------------------------------
    def test_duplicate_prediction_prevented_within_cadence(self):
        # First prediction at 10:00
        first = self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )
        self.assertIsNotNone(first)
        self.assertEqual(len(self.mock_pred_coll.docs), 1)

        # Rapid poll 3 seconds later (10:00:03)
        poll_3s_later = dict(self.healthy_telemetry)
        poll_3s_later["recorded_at"] = self.base_time + timedelta(seconds=3)
        duplicate = self.service.record_prediction_candidate(
            poll_3s_later,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )
        self.assertIsNone(duplicate)
        self.assertEqual(len(self.mock_pred_coll.docs), 1)

        # Rapid poll 25 minutes later (10:25:00) - still in 60-min window
        poll_25m_later = dict(self.healthy_telemetry)
        poll_25m_later["recorded_at"] = self.base_time + timedelta(minutes=25)
        duplicate2 = self.service.record_prediction_candidate(
            poll_25m_later,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )
        self.assertIsNone(duplicate2)
        self.assertEqual(len(self.mock_pred_coll.docs), 1)

        # New window 65 minutes later (11:05:00) -> allowed
        poll_65m_later = dict(self.healthy_telemetry)
        poll_65m_later["recorded_at"] = self.base_time + timedelta(minutes=65)
        next_candidate = self.service.record_prediction_candidate(
            poll_65m_later,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )
        self.assertIsNotNone(next_candidate)
        self.assertEqual(len(self.mock_pred_coll.docs), 2)

    # -------------------------------------------------------------
    # 4. Target time is exactly +3 hours from prediction creation time
    # -------------------------------------------------------------
    def test_target_time_is_plus_3_hours(self):
        record = self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )
        created_at = record["created_at"]
        target_at = record["target_at"]
        delta = target_at - created_at
        self.assertEqual(delta, timedelta(hours=3))

    # -------------------------------------------------------------
    # 5. Valid actual matched within tolerance
    # -------------------------------------------------------------
    def test_valid_actual_matched(self):
        # Prediction at 10:00, target 13:00, predicted 41.5%
        self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )

        # Telemetry arrives at 13:02 (target + 2m) with actual moisture 42.0%
        target_time = self.base_time + timedelta(hours=3)
        actual_doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": target_time + timedelta(minutes=2),
            "soil": {"status": "HEALTHY", "raw_adc": 2150, "moisture_pct": 42.0},
            "quality": {"soil_valid": True},
        }
        self.mock_telem_coll.insert_one(actual_doc)

        # Run validation worker at 13:05
        worker_res = self.service.validate_matured_predictions(
            predictions_coll=self.mock_pred_coll,
            telemetry_coll=self.mock_telem_coll,
            now_utc=target_time + timedelta(minutes=5),
        )
        self.assertEqual(worker_res["validated_count"], 1)

        val = self.mock_pred_coll.docs[0]["validation"]
        self.assertEqual(val["status"], "VALIDATED")
        self.assertEqual(val["actual_soil_moisture_pct"], 42.0)
        self.assertEqual(val["signed_error_pp"], -0.5)
        self.assertEqual(val["absolute_error_pp"], 0.5)

    # -------------------------------------------------------------
    # 6. Nearest observation selected when multiple exist
    # -------------------------------------------------------------
    def test_nearest_observation_selected(self):
        self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )

        target_time = self.base_time + timedelta(hours=3)
        # Sample A at target - 8 min (moisture 39.0)
        self.mock_telem_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": target_time - timedelta(minutes=8),
            "soil": {"status": "HEALTHY", "raw_adc": 2200, "moisture_pct": 39.0},
            "quality": {"soil_valid": True},
        })
        # Sample B at target + 1 min (moisture 41.0) -> NEAREST
        self.mock_telem_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": target_time + timedelta(minutes=1),
            "soil": {"status": "HEALTHY", "raw_adc": 2180, "moisture_pct": 41.0},
            "quality": {"soil_valid": True},
        })

        self.service.validate_matured_predictions(
            predictions_coll=self.mock_pred_coll,
            telemetry_coll=self.mock_telem_coll,
            now_utc=target_time + timedelta(minutes=10),
        )
        val = self.mock_pred_coll.docs[0]["validation"]
        self.assertEqual(val["actual_soil_moisture_pct"], 41.0)

    # -------------------------------------------------------------
    # 7. Sensor FAULT observation rejected as ground truth
    # -------------------------------------------------------------
    def test_fault_observation_rejected(self):
        self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )

        target_time = self.base_time + timedelta(hours=3)
        # Closest telemetry has sensor FAULT (ADC 254, 0% moisture)
        self.mock_telem_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": target_time + timedelta(seconds=30),
            "soil": {"status": "FAULT", "raw_adc": 254, "moisture_pct": 0.0},
            "quality": {"soil_valid": False},
        })

        self.service.validate_matured_predictions(
            predictions_coll=self.mock_pred_coll,
            telemetry_coll=self.mock_telem_coll,
            now_utc=target_time + timedelta(minutes=10),
        )
        val = self.mock_pred_coll.docs[0]["validation"]
        # Must NOT be VALIDATED with 0.0%
        self.assertEqual(val["status"], "INVALID_TARGET_DATA")
        self.assertIsNone(val["actual_soil_moisture_pct"])
        self.assertIsNone(val["absolute_error_pp"])

    # -------------------------------------------------------------
    # 8. Alternate valid observation selected when closest has FAULT
    # -------------------------------------------------------------
    def test_alternate_valid_observation_selected(self):
        self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )

        target_time = self.base_time + timedelta(hours=3)
        # Sample A at +30s has FAULT
        self.mock_telem_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": target_time + timedelta(seconds=30),
            "soil": {"status": "FAULT", "raw_adc": 254, "moisture_pct": 0.0},
            "quality": {"soil_valid": False},
        })
        # Sample B at -3m is VALID (moisture 41.2%)
        self.mock_telem_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": target_time - timedelta(minutes=3),
            "soil": {"status": "HEALTHY", "raw_adc": 2100, "moisture_pct": 41.2},
            "quality": {"soil_valid": True},
        })

        self.service.validate_matured_predictions(
            predictions_coll=self.mock_pred_coll,
            telemetry_coll=self.mock_telem_coll,
            now_utc=target_time + timedelta(minutes=10),
        )
        val = self.mock_pred_coll.docs[0]["validation"]
        self.assertEqual(val["status"], "VALIDATED")
        self.assertEqual(val["actual_soil_moisture_pct"], 41.2)

    # -------------------------------------------------------------
    # 9. No observation in tolerance window -> NO_MATCH
    # -------------------------------------------------------------
    def test_no_observation_in_tolerance_no_match(self):
        self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )

        target_time = self.base_time + timedelta(hours=3)
        # Telemetry is at +45m (outside ±15m tolerance)
        self.mock_telem_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": target_time + timedelta(minutes=45),
            "soil": {"status": "HEALTHY", "raw_adc": 2100, "moisture_pct": 41.2},
            "quality": {"soil_valid": True},
        })

        self.service.validate_matured_predictions(
            predictions_coll=self.mock_pred_coll,
            telemetry_coll=self.mock_telem_coll,
            now_utc=target_time + timedelta(hours=1),
        )
        val = self.mock_pred_coll.docs[0]["validation"]
        self.assertEqual(val["status"], "NO_MATCH")
        self.assertIsNone(val["actual_soil_moisture_pct"])

    # -------------------------------------------------------------
    # 10. Summary with zero validations returns null metrics
    # -------------------------------------------------------------
    def test_summary_zero_validations_returns_null(self):
        # 1 pending prediction in DB
        self.service.record_prediction_candidate(
            self.healthy_telemetry,
            self.valid_inference,
            predictions_coll=self.mock_pred_coll,
        )
        summary = self.service.get_validation_summary(predictions_coll=self.mock_pred_coll)
        self.assertEqual(summary["status"], "collecting_data")
        self.assertEqual(summary["validated_predictions"], 0)
        self.assertEqual(summary["pending_predictions"], 1)
        self.assertIsNone(summary["mae_pp"])
        self.assertIsNone(summary["rmse_pp"])
        self.assertIsNone(summary["mean_bias_pp"])

    # -------------------------------------------------------------
    # 11. Summary metrics use only VALIDATED records
    # -------------------------------------------------------------
    def test_summary_metrics_use_only_validated(self):
        # Insert 1 VALIDATED (+1.0 pp error), 1 NO_MATCH, 1 INVALID_TARGET_DATA
        self.mock_pred_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "prediction": {"soil_moisture_pct": 40.0},
            "validation": {
                "status": "VALIDATED",
                "actual_soil_moisture_pct": 39.0,
                "absolute_error_pp": 1.0,
                "signed_error_pp": 1.0,
                "squared_error": 1.0,
                "actual_observed_at": self.base_time,
            },
        })
        self.mock_pred_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "prediction": {"soil_moisture_pct": 40.0},
            "validation": {
                "status": "NO_MATCH",
                "actual_soil_moisture_pct": None,
                "absolute_error_pp": None,
            },
        })
        self.mock_pred_coll.insert_one({
            "device_id": "AquaMatrix-MaxCore",
            "prediction": {"soil_moisture_pct": 40.0},
            "validation": {
                "status": "INVALID_TARGET_DATA",
                "actual_soil_moisture_pct": None,
                "absolute_error_pp": None,
            },
        })

        summary = self.service.get_validation_summary(predictions_coll=self.mock_pred_coll)
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["validated_predictions"], 1)
        self.assertEqual(summary["no_match"], 1)
        self.assertEqual(summary["invalid_target_data"], 1)
        self.assertEqual(summary["mae_pp"], 1.0)
        self.assertEqual(summary["rmse_pp"], 1.0)

    # -------------------------------------------------------------
    # 12. Simulated development metrics remain separate from field summary
    # -------------------------------------------------------------
    def test_simulated_metrics_separate_from_field_summary(self):
        summary = self.service.get_validation_summary(predictions_coll=self.mock_pred_coll)
        self.assertEqual(summary["scope"], "REAL_FIELD_VALIDATION")
        self.assertIn("development_benchmark", summary)
        self.assertEqual(summary["development_benchmark"]["simulated_test_rmse_pp"], 0.9586)
        # Verify note explicitly warning against combining
        self.assertIn("NEVER COMBINE", summary["development_benchmark"]["note"].upper())

    # -------------------------------------------------------------
    # 13. SECTION 21 ACCEPTANCE SCENARIO
    # -------------------------------------------------------------
    def test_acceptance_scenario_exact_numbers(self):
        """
        Acceptance Test (Section 21):
        Prediction created at: 10:00
        Prediction target: 13:00
        Predicted: 43.8%
        Real valid telemetry at: 13:02
        Actual: 44.6%
        Expected:
        status = VALIDATED
        signed error = -0.8 pp
        absolute error = 0.8 pp
        """
        pred_time = datetime(2026, 9, 26, 10, 0, 0, tzinfo=timezone.utc)
        target_time = datetime(2026, 9, 26, 13, 0, 0, tzinfo=timezone.utc)
        actual_time = datetime(2026, 9, 26, 13, 2, 0, tzinfo=timezone.utc)

        # 1. Create prediction candidate
        telem = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": pred_time,
            "soil": {"status": "HEALTHY", "raw_adc": 2100, "moisture_pct": 45.0},
            "quality": {"soil_valid": True},
        }
        inf = {
            "status": "ok",
            "current_soil_moisture_pct": 45.0,
            "predicted_soil_moisture_pct": 43.8,
            "change_pct_points": -1.2,
        }
        self.service.record_prediction_candidate(telem, inf, predictions_coll=self.mock_pred_coll)

        # 2. Insert actual observation at 13:02
        actual_doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": actual_time,
            "soil": {"status": "HEALTHY", "raw_adc": 2050, "moisture_pct": 44.6},
            "quality": {"soil_valid": True},
        }
        self.mock_telem_coll.insert_one(actual_doc)

        # 3. Run validation worker at 13:05
        worker_res = self.service.validate_matured_predictions(
            predictions_coll=self.mock_pred_coll,
            telemetry_coll=self.mock_telem_coll,
            now_utc=datetime(2026, 9, 26, 13, 5, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(worker_res["validated_count"], 1)

        val = self.mock_pred_coll.docs[0]["validation"]
        self.assertEqual(val["status"], "VALIDATED")
        self.assertEqual(val["actual_soil_moisture_pct"], 44.6)
        self.assertAlmostEqual(val["signed_error_pp"], -0.8, places=4)
        self.assertAlmostEqual(val["absolute_error_pp"], 0.8, places=4)


if __name__ == "__main__":
    unittest.main()
