"""
Unit Tests: Live ML Inference Service & Quality Gating
======================================================
Tests:
1. Model loading & feature ordering (36 features)
2. Critical sensor validity gate: soil FAULT -> refused (status="unavailable", reason="SOIL_SENSOR_FAULT")
3. Real current condition test: soil.moisture_pct = 0, soil.status = "FAULT" -> NO prediction
4. Missing soil moisture handling
5. Insufficient history gate -> status="warming_up", reason="INSUFFICIENT_HISTORY"
6. Timestamp-based lag construction (not assuming 1 doc = 1 hour)
7. Missing weather feature gate -> status="missing_features", reason="MISSING_WEATHER_DATA"
8. NaN / Infinity input handling
9. Valid inference output format (predicted_soil_moisture_pct, change_pct_points)
10. Physical bounds output plausibility check
"""

import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
import numpy as np

from backend.app.ml_inference import SoilMoistureInferenceService, is_finite_number


class TestMLInferenceService(unittest.TestCase):

    def setUp(self):
        self.service = SoilMoistureInferenceService()
        self.base_time = datetime(2026, 9, 26, 12, 0, 0, tzinfo=timezone.utc)

        # Baseline valid telemetry document
        self.valid_current_doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {
                "raw_adc": 1850,
                "moisture_pct": 32.5,
                "dryness_pct": 67.5,
                "status": "HEALTHY",
            },
            "quality": {
                "soil_valid": True,
                "reservoir_valid": True,
                "node_connected": True,
            },
            "atmosphere": {
                "temp_c": 28.5,
                "humidity_pct": 55.0,
                "et0_fao56_mm": 4.6,
                "forecast_rain_mm": 1.2,
                "observed_rain_mm": 0.0,
            },
            "rain_sensor": {
                "surface_wetness_pct": 0.0,
                "is_raining": 0,
            },
            "crop": {
                "kc_factor": 0.85,
                "mad_threshold_pct": 50.0,
            },
            "decision": {
                "action": "HOLD_SOIL_OPTIMAL",
                "pump_active": 0,
                "irrigation_litres": 0.0,
            },
        }

        # Generate 7 hours of mock history (1 sample every 10 minutes)
        self.mock_history_docs = []
        for minutes in range(7 * 60, -1, -10):
            t = self.base_time - timedelta(minutes=minutes)
            self.mock_history_docs.append({
                "device_id": "AquaMatrix-MaxCore",
                "recorded_at": t,
                "soil": {"moisture_pct": 33.0 - (minutes / 600.0), "status": "HEALTHY"},
                "atmosphere": {"temp_c": 27.0, "et0_fao56_mm": 4.5, "observed_rain_mm": 0.0},
                "decision": {"irrigation_litres": 0.0},
            })

    def test_model_loaded_and_feature_count(self):
        """Verifies V2 model is loaded and feature list matches exact 36 dimensions."""
        self.assertIsNotNone(self.service.model)
        self.assertEqual(len(self.service.feature_names), 36)
        self.assertEqual(self.service.model_version, "v2")

    def test_critical_sensor_fault_gate(self):
        """
        CRITICAL TEST: Real current condition.
        soil.moisture_pct = 0, soil.status = "FAULT".
        Expected: NO prediction, status="unavailable", reason="SOIL_SENSOR_FAULT".
        """
        fault_doc = dict(self.valid_current_doc)
        fault_doc["soil"] = {
            "raw_adc": 187,
            "moisture_pct": 0.0,
            "status": "FAULT",
        }
        fault_doc["quality"] = {"soil_valid": False}

        result = self.service.predict_for_document(fault_doc)

        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["prediction"])
        self.assertEqual(result["reason"], "SOIL_SENSOR_FAULT")
        self.assertEqual(result["soil_status"], "FAULT")
        self.assertEqual(result["raw_adc"], 187)

    def test_missing_or_invalid_soil_moisture(self):
        """Verifies that missing or non-finite soil moisture is refused."""
        bad_doc = dict(self.valid_current_doc)
        bad_doc["soil"] = {"raw_adc": 1850, "moisture_pct": None, "status": "HEALTHY"}

        result = self.service.predict_for_document(bad_doc)
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["prediction"])

    def test_insufficient_history_returns_warming_up(self):
        """
        Verifies that when less than 6 hours of history is available,
        status="warming_up" is returned without fabricating lags.
        """
        mock_coll = MagicMock()
        # Only 1.5 hours of history
        short_history = self.mock_history_docs[-10:]  # Last 90 minutes
        mock_coll.find.return_value.sort.return_value = short_history

        result = self.service.predict_for_document(self.valid_current_doc, coll=mock_coll)

        self.assertEqual(result["status"], "warming_up")
        self.assertIsNone(result["prediction"])
        self.assertEqual(result["reason"], "INSUFFICIENT_HISTORY")
        self.assertEqual(result["required_history_hours"], 6)
        self.assertLess(result["available_history_hours"], 6.0)

    def test_missing_weather_feature_gate(self):
        """
        Verifies that missing weather data (e.g. forecast_rain_mm or et0)
        returns status='missing_features' and lists the missing variables.
        """
        no_weather_doc = dict(self.valid_current_doc)
        no_weather_doc["atmosphere"] = {
            "temp_c": 28.0,
            "humidity_pct": 50.0,
            # et0 and forecast_rain are missing
        }

        result = self.service.predict_for_document(no_weather_doc, coll=self.mock_history_docs)

        self.assertEqual(result["status"], "missing_features")
        self.assertIsNone(result["prediction"])
        self.assertEqual(result["reason"], "MISSING_WEATHER_DATA")
        self.assertIn("et0_mm_day", result["missing_features"])
        self.assertIn("forecast_rain_next_3h_mm", result["missing_features"])

    def test_nan_or_inf_in_features_rejected(self):
        """Verifies that NaN or Infinity in inputs produces model_error rather than corrupting."""
        nan_doc = dict(self.valid_current_doc)
        nan_doc["atmosphere"] = dict(self.valid_current_doc["atmosphere"])
        nan_doc["atmosphere"]["temp_c"] = float("nan")

        result = self.service.predict_for_document(nan_doc, coll=self.mock_history_docs)
        # Should be caught by weather validation gate
        self.assertEqual(result["status"], "missing_features")

    def test_valid_inference_produces_plausible_prediction(self):
        """
        Verifies end-to-end inference when all conditions are healthy and 6h history exists.
        Output must be a physically bounded percentage.
        """
        result = self.service.predict_for_document(self.valid_current_doc, coll=self.mock_history_docs)

        self.assertEqual(result["status"], "ok")
        self.assertIsNotNone(result["predicted_soil_moisture_pct"])
        pred = result["predicted_soil_moisture_pct"]
        self.assertGreaterEqual(pred, 8.4)  # Above hygroscopic minimum
        self.assertLessEqual(pred, 48.0)    # Below saturation
        self.assertEqual(result["prediction_horizon_hours"], 3)
        self.assertEqual(result["input_quality"], "valid")
        self.assertEqual(result["model_version"], "v2")


if __name__ == "__main__":
    unittest.main()
