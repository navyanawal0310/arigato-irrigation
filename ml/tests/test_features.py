"""
Unit Tests for Feature Engineering & Time-Series Methodology
============================================================
Verifies:
1. Target leakage prevention: Lag features strictly reference past observations (shift > 0).
2. Target integrity: Target column matches observation at index t + 3 hours.
3. Chronological split integrity: Time ordering is strictly non-overlapping (Train < Val < Test).
4. Prediction safety: Invalid sensor data, hardware faults, and NaNs are refused.
"""

import unittest
from datetime import datetime, timedelta
import numpy as np
import pandas as pd

from ml.config import TARGET_COLUMN
from ml.src.feature_engineering import build_derived_features, clean_feature_dataset
from ml.src.prepare_dataset import prepare_and_split_data
from ml.src.predict import predict_soil_moisture_3h


class TestFeatureEngineeringAndSafety(unittest.TestCase):
    def setUp(self):
        # Build synthetic 30-hour sequence with predictable monotonic values for exact index tracing
        base_time = datetime(2026, 4, 1, 0, 0, 0)
        n = 30
        self.mock_df = pd.DataFrame({
            "timestamp": [base_time + timedelta(hours=i) for i in range(n)],
            "device_id": "test-device-01",
            "soil_adc": [2000 + i * 10 for i in range(n)],
            "soil_moisture_pct": [30.0 + i * 0.5 for i in range(n)],  # i=0 -> 30.0, i=1 -> 30.5, etc.
            "soil_dryness_pct": [70.0 - i * 0.5 for i in range(n)],
            "soil_status": ["HEALTHY"] * n,
            "temperature_c": [25.0 + (i % 5) for i in range(n)],
            "humidity_pct": [60.0 - (i % 5) for i in range(n)],
            "rainfall_mm": [0.0] * n,
            "forecast_rain_mm": [0.0] * n,
            "et0_mm_day": [4.0] * n,
            "surface_wetness_pct": [0.0] * n,
            "is_raining": [0] * n,
            "crop_profile": "Tomato",
            "kc_factor": [0.85] * n,
            "mad_threshold_pct": [50.0] * n,
            "reservoir_level_pct": [80.0] * n,
            "reservoir_status": ["HEALTHY"] * n,
            "pump_active": [0] * n,
            "irrigation_litres": [0.0] * n,
        })

    def test_target_is_t_plus_3h(self):
        """Verifies target column at index t strictly equals soil_moisture_pct at index t + 3."""
        df_feat = build_derived_features(self.mock_df, prediction_horizon=3)

        # Check interior row (e.g. index 10)
        # Row 10 moisture = 30.0 + 10 * 0.5 = 35.0
        # Row 13 moisture = 30.0 + 13 * 0.5 = 36.5
        row_10_target = df_feat.loc[10, TARGET_COLUMN]
        row_13_moisture = df_feat.loc[13, "soil_moisture_pct"]
        self.assertEqual(
            row_10_target,
            row_13_moisture,
            f"Target at index 10 ({row_10_target}) must exactly equal soil_moisture_pct at index 13 ({row_13_moisture})."
        )

        # Verify last 3 rows receive NaN target before cleaning
        self.assertTrue(pd.isna(df_feat.loc[len(df_feat) - 1, TARGET_COLUMN]))
        self.assertTrue(pd.isna(df_feat.loc[len(df_feat) - 2, TARGET_COLUMN]))
        self.assertTrue(pd.isna(df_feat.loc[len(df_feat) - 3, TARGET_COLUMN]))

    def test_lag_features_never_use_future_observations(self):
        """Verifies lag features at row t strictly equal observations from t-1, t-3, t-6."""
        df_feat = build_derived_features(self.mock_df, prediction_horizon=3)

        idx = 10
        # Row 10 lag_1h must equal Row 9 moisture
        self.assertEqual(df_feat.loc[idx, "soil_moisture_lag_1h"], df_feat.loc[idx - 1, "soil_moisture_pct"])
        # Row 10 lag_3h must equal Row 7 moisture
        self.assertEqual(df_feat.loc[idx, "soil_moisture_lag_3h"], df_feat.loc[idx - 3, "soil_moisture_pct"])
        # Row 10 lag_6h must equal Row 4 moisture
        self.assertEqual(df_feat.loc[idx, "soil_moisture_lag_6h"], df_feat.loc[idx - 6, "soil_moisture_pct"])

        # First row must have NaNs for all lags (no prior history)
        self.assertTrue(pd.isna(df_feat.loc[0, "soil_moisture_lag_1h"]))
        self.assertTrue(pd.isna(df_feat.loc[0, "soil_moisture_lag_3h"]))
        self.assertTrue(pd.isna(df_feat.loc[0, "soil_moisture_lag_6h"]))

    def test_chronological_split_preserves_time_order(self):
        """Verifies train, val, and test splits preserve strict forward chronological ordering."""
        train_df, val_df, test_df, split_info = prepare_and_split_data()

        train_max_time = pd.to_datetime(train_df["timestamp"]).max()
        val_min_time = pd.to_datetime(val_df["timestamp"]).min()
        val_max_time = pd.to_datetime(val_df["timestamp"]).max()
        test_min_time = pd.to_datetime(test_df["timestamp"]).min()

        self.assertLess(
            train_max_time,
            val_min_time,
            f"Train maximum time ({train_max_time}) must precede validation minimum time ({val_min_time})."
        )
        self.assertLess(
            val_max_time,
            test_min_time,
            f"Validation maximum time ({val_max_time}) must precede test minimum time ({test_min_time})."
        )

    def test_invalid_critical_sensor_rejected(self):
        """Verifies prediction interface refuses prediction on sensor faults or physically impossible inputs."""
        # 1. Hardware FAULT status
        fault_sample = {
            "soil_status": "FAULT",
            "soil_adc": 0,
            "soil_moisture_pct": 0.0,
            "temperature_c": 25.0,
        }
        res_fault = predict_soil_moisture_3h(fault_sample)
        self.assertEqual(res_fault["data_quality"], "REJECTED_SENSOR_FAULT")
        self.assertIsNone(res_fault["predicted_soil_moisture_pct"])

        # 2. Out-of-range ADC reading
        adc_err_sample = {
            "soil_status": "HEALTHY",
            "soil_adc": 4090,  # Valid range is [300, 3800]
            "soil_moisture_pct": 10.0,
        }
        res_adc = predict_soil_moisture_3h(adc_err_sample)
        self.assertEqual(res_adc["data_quality"], "REJECTED_SENSOR_FAULT")

        # 3. Physically impossible moisture (> 100% or < 0%)
        impossible_sample = {
            "soil_status": "HEALTHY",
            "soil_adc": 1500,
            "soil_moisture_pct": 140.0,  # Impossible
        }
        res_imp = predict_soil_moisture_3h(impossible_sample)
        self.assertEqual(res_imp["data_quality"], "REJECTED_SENSOR_FAULT")

        # 4. Exception mode when raise_on_error=True
        with self.assertRaises(ValueError):
            predict_soil_moisture_3h(fault_sample, raise_on_error=True)


if __name__ == "__main__":
    unittest.main()
