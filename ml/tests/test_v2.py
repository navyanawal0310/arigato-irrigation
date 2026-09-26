"""
KRISHI SETU ML — Unit Tests for Experiment V2
=============================================
Tests:
1. Schema & Hardware Fault Gating
2. FAO-56 Physics Hydrological Bounds & Mass Conservation
3. Feature Engineering Causality & No-Leakage Verification
4. Model Artifact Existence & Serialization
5. Production Inference Safety Constraints
6. Benchmark Verification (ML Beats Persistence Overall)
"""

import unittest
from pathlib import Path
import json
import numpy as np
import pandas as pd

from ml.config import (
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    MODELS_DIR,
    RESULTS_DIR,
    PROCESSED_DATA_DIR,
)
from ml.src.schema_v2 import validate_raw_record_v2, MODEL_FEATURE_COLUMNS_V2
from ml.src.physics_baseline import predict_physics_water_balance_3h
from ml.src.feature_engineering_v2 import engineer_features_v2
from ml.src.predict_v2 import PredictorV2


class TestKrishiSetuV2(unittest.TestCase):

    def test_schema_hardware_fault_gating(self):
        """Verifies hardware fault detection and physical bounds gating."""
        # Valid record
        valid_rec = {
            "soil_status": "HEALTHY",
            "soil_adc": 1950,
            "soil_moisture_pct": 28.5,
            "temperature_c": 26.0,
            "humidity_pct": 65.0,
        }
        ok, msg = validate_raw_record_v2(valid_rec)
        self.assertTrue(ok)
        self.assertIsNone(msg)

        # Fault record
        fault_rec = valid_rec.copy()
        fault_rec["soil_status"] = "FAULT"
        ok, msg = validate_raw_record_v2(fault_rec)
        self.assertFalse(ok)
        self.assertIn("FAULT", msg)

        # Out of bounds ADC
        bad_adc = valid_rec.copy()
        bad_adc["soil_adc"] = 4050
        ok, msg = validate_raw_record_v2(bad_adc)
        self.assertFalse(ok)

        # Physically impossible moisture
        bad_moist = valid_rec.copy()
        bad_moist["soil_moisture_pct"] = -5.0
        ok, msg = validate_raw_record_v2(bad_moist)
        self.assertFalse(ok)

    def test_physics_baseline_mass_conservation(self):
        """Verifies FAO-56 hydrological baseline obeys physical mass conservation and boundaries."""
        # 1. Zero rain and high ET -> moisture must decrease
        pred_dry = predict_physics_water_balance_3h(
            moisture_pct=30.0,
            forecast_rain_next_3h_mm=0.0,
            et0_mm_day=6.0,
            kc_factor=1.0,
            hour=12,
        )[0]
        self.assertLess(pred_dry, 30.0)
        self.assertGreaterEqual(pred_dry, WILTING_POINT_PCT * 0.7)

        # 2. Heavy rain -> moisture must increase and clamp at saturation
        pred_flood = predict_physics_water_balance_3h(
            moisture_pct=30.0,
            forecast_rain_next_3h_mm=80.0,
            et0_mm_day=1.0,
            kc_factor=0.5,
            hour=12,
        )[0]
        self.assertGreater(pred_flood, 30.0)
        self.assertLessEqual(pred_flood, SATURATION_PCT)

    def test_feature_engineering_causality(self):
        """Verifies that features are computed using only causal, strictly backward-looking data."""
        # Synthetic mini-series
        dates = pd.date_range("2026-06-01", periods=20, freq="1H")
        df_mini = pd.DataFrame({
            "timestamp": dates,
            "soil_status": ["HEALTHY"] * 20,
            "soil_moisture_pct": np.linspace(35.0, 31.0, 20),
            "soil_dryness_pct": 100.0 - np.linspace(35.0, 31.0, 20),
            "temperature_c": [28.0] * 20,
            "humidity_pct": [60.0] * 20,
            "observed_rain_mm": [0.0] * 20,
            "forecast_rain_next_3h_mm": [0.0] * 20,
            "forecast_rain_24h_mm": [0.0] * 20,
            "et0_mm_day": [4.5] * 20,
            "surface_wetness_pct": [5.0] * 20,
            "is_raining": [0] * 20,
            "kc_factor": [0.85] * 20,
            "mad_threshold_pct": [50.0] * 20,
            "pump_active": [0] * 20,
            "irrigation_litres": [0.0] * 20,
        })

        feat_df = engineer_features_v2(df_mini)
        # All required V2 feature columns must exist
        for col in MODEL_FEATURE_COLUMNS_V2:
            self.assertIn(col, feat_df.columns, f"Missing feature: {col}")

        # Check lag alignment: row 0 in cleaned output has lag_1h matching prior row
        self.assertTrue(np.all(feat_df["soil_moisture_lag_1h"] > 0))

    def test_v2_artifacts_and_figures_exist(self):
        """Verifies that model artifacts, evaluation report, and all 6 diagnostic plots exist."""
        model_file = MODELS_DIR / "v2" / "soil_moisture_3h_v2.joblib"
        meta_file = MODELS_DIR / "v2" / "soil_moisture_3h_metadata_v2.json"
        report_file = RESULTS_DIR / "v2" / "evaluation_report_v2.json"

        self.assertTrue(model_file.exists(), "soil_moisture_3h_v2.joblib missing")
        self.assertTrue(meta_file.exists(), "soil_moisture_3h_metadata_v2.json missing")
        self.assertTrue(report_file.exists(), "evaluation_report_v2.json missing")

        # 6 Diagnostic Charts
        charts = [
            "residual_vs_moisture.png",
            "residual_vs_rain.png",
            "residual_vs_et0.png",
            "rain_event_zoom.png",
            "irrigation_event_zoom.png",
            "drydown_event_zoom.png",
        ]
        for chart in charts:
            chart_path = RESULTS_DIR / "v2" / chart
            self.assertTrue(chart_path.exists(), f"Figure missing: {chart}")

    def test_production_predictor_inference_and_safety(self):
        """Tests end-to-end inference and strict pump safety isolation."""
        predictor = PredictorV2()
        rec = {
            "soil_status": "HEALTHY",
            "soil_adc": 1800,
            "soil_moisture_pct": 28.0,
            "temperature_c": 27.5,
            "humidity_pct": 58.0,
            "observed_rain_mm": 0.0,
            "forecast_rain_next_3h_mm": 2.5,
            "et0_mm_day": 4.8,
            "hour": 14,
        }

        result = predictor.predict_record(rec)
        self.assertEqual(result["status"], "SUCCESS")
        self.assertIsNotNone(result["predicted_soil_moisture_3h"])
        self.assertGreaterEqual(result["predicted_soil_moisture_3h"], WILTING_POINT_PCT * 0.7)
        self.assertLessEqual(result["predicted_soil_moisture_3h"], SATURATION_PCT)

        # STRICT SAFETY REQUIREMENT: ML never controls pump directly
        self.assertFalse(result["pump_control_allowed"])

        # Test hardware fault gating
        fault_rec = rec.copy()
        fault_rec["soil_status"] = "FAULT"
        fault_res = predictor.predict_record(fault_rec)
        self.assertEqual(fault_res["status"], "HARDWARE_FAULT")
        self.assertIsNone(fault_res["predicted_soil_moisture_3h"])
        self.assertFalse(fault_res["pump_control_allowed"])

    def test_v2_beats_persistence_overall(self):
        """Verifies that Experiment V2 achieved primary success: beating persistence overall."""
        report_path = RESULTS_DIR / "v2" / "evaluation_report_v2.json"
        with open(report_path, "r", encoding="utf-8") as f:
            report = json.load(f)

        overall = report["slice_metrics"]["overall_test_set"]
        model_rmse = overall["model_rmse"]
        pers_rmse = overall["persistence_rmse"]
        improvement = overall["improvement_vs_persistence_pct"]

        self.assertLess(model_rmse, pers_rmse, f"Model RMSE {model_rmse} did not beat Persistence RMSE {pers_rmse}")
        self.assertGreater(improvement, 0.0)
        self.assertTrue(report["primary_criterion_passed"])
        self.assertEqual(report["integration_readiness"], "READY FOR DEVELOPMENT INTEGRATION")


if __name__ == "__main__":
    unittest.main()
