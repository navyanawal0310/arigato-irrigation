"""
KRISHI SETU Feature Engineering Pipeline (V2)
=============================================
Transforms raw chronological telemetry into causal feature representations for:
1. Baseline A: Persistence (theta_t)
2. Baseline B: Physics Water Balance (predict_physics_water_balance_3h)
3. Direct ML: Predicts theta_{t+3} directly from X
4. Hybrid Physics + ML Residual: Predicts residual correction delta_{t+3} = theta_{t+3} - theta_{phys}

CAUSALITY & NO-LEAKAGE ASSURANCES:
- All sensor values (moisture, temp, humidity, wetness) are observed at or before time t.
- Historical lags (1h, 2h, 3h, 6h) use positive backward shifts.
- Rolling features (rain, ET0, temp, irrigation) only aggregate windows ending at time t.
- Precipitation for the horizon (t to t+3) is represented EXCLUSIVELY by forecast_rain_next_3h_mm,
  which models a realistic operational weather forecast available at decision time t.
- Actual future observed rainfall is NEVER used as a feature.
"""

from typing import Tuple, List
import numpy as np
import pandas as pd

from ml.config import (
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    PREDICTION_HORIZON_HOURS,
)
from ml.src.schema_v2 import (
    MODEL_FEATURE_COLUMNS_V2,
    TARGET_COLUMN,
    RESIDUAL_TARGET_COLUMN,
    PHYSICS_PREDICTION_COLUMN,
)
from ml.src.physics_baseline import predict_physics_water_balance_3h


def engineer_features_v2(df_raw: pd.DataFrame) -> pd.DataFrame:
    """
    Transforms raw telemetry into the complete V2 model feature set,
    including physics baseline projections and residual regression targets.
    """
    df = df_raw.copy()

    # Parse and sort timestamp
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values("timestamp").reset_index(drop=True)

    # 1. Clean hardware faults: exclude rows where soil probe is in fault state
    if "soil_status" in df.columns:
        valid_mask = df["soil_status"] == "HEALTHY"
        df.loc[~valid_mask, "soil_moisture_pct"] = np.nan
        df["soil_moisture_pct"] = df["soil_moisture_pct"].ffill().bfill()
        df["soil_dryness_pct"] = 100.0 - df["soil_moisture_pct"]

    # 2. Hydraulic storage capacity constraint
    # Quantifies available pore storage before gravitational saturation occurs
    df["soil_storage_capacity_pct"] = np.maximum(0.0, FIELD_CAPACITY_PCT - df["soil_moisture_pct"])

    # 3. Cyclical Temporal Harmonics
    if "timestamp" in df.columns:
        df["hour"] = df["timestamp"].dt.hour
        df["day_of_year"] = df["timestamp"].dt.dayofyear
    else:
        df["hour"] = (df.index % 24).astype(int)
        df["day_of_year"] = ((df.index // 24) % 365 + 1).astype(int)

    df["hour_sin"] = np.sin(2.0 * np.pi * df["hour"] / 24.0)
    df["hour_cos"] = np.cos(2.0 * np.pi * df["hour"] / 24.0)
    df["day_sin"] = np.sin(2.0 * np.pi * df["day_of_year"] / 365.25)
    df["day_cos"] = np.cos(2.0 * np.pi * df["day_of_year"] / 365.25)

    # 4. Strictly Backward Historical Lags
    df["soil_moisture_lag_1h"] = df["soil_moisture_pct"].shift(1)
    df["soil_moisture_lag_2h"] = df["soil_moisture_pct"].shift(2)
    df["soil_moisture_lag_3h"] = df["soil_moisture_pct"].shift(3)
    df["soil_moisture_lag_6h"] = df["soil_moisture_pct"].shift(6)

    # 5. Dynamics & Empirical Rates of Change (Slopes)
    df["moisture_slope_1h"] = df["soil_moisture_pct"] - df["soil_moisture_lag_1h"]
    df["moisture_slope_3h"] = (df["soil_moisture_pct"] - df["soil_moisture_lag_3h"]) / 3.0
    df["moisture_slope_6h"] = (df["soil_moisture_pct"] - df["soil_moisture_lag_6h"]) / 6.0

    # 6. Backward Rolling Windows (Past history up to time t)
    df["rolling_temperature_3h"] = df["temperature_c"].rolling(window=3, min_periods=1).mean()
    df["rolling_et0_3h"] = df["et0_mm_day"].rolling(window=3, min_periods=1).mean()
    df["rolling_et0_6h"] = df["et0_mm_day"].rolling(window=6, min_periods=1).mean()
    df["rolling_rain_3h"] = df["observed_rain_mm"].rolling(window=3, min_periods=1).sum()
    df["rolling_rain_6h"] = df["observed_rain_mm"].rolling(window=6, min_periods=1).sum()
    df["irrigation_last_1h"] = df["irrigation_litres"].shift(1).fillna(0.0)
    df["irrigation_last_3h"] = df["irrigation_litres"].rolling(window=3, min_periods=1).sum()
    df["irrigation_last_6h"] = df["irrigation_litres"].rolling(window=6, min_periods=1).sum()

    # 7. Compute Physics Baseline Projection at t+3
    df[PHYSICS_PREDICTION_COLUMN] = predict_physics_water_balance_3h(
        moisture_pct=df["soil_moisture_pct"],
        forecast_rain_next_3h_mm=df["forecast_rain_next_3h_mm"],
        et0_mm_day=df["et0_mm_day"],
        kc_factor=df["kc_factor"],
        mad_threshold_pct=df["mad_threshold_pct"],
        hour=df["hour"],
    )

    # 8. Regression Targets (Shift -3 to look exactly 3 hours ahead)
    df[TARGET_COLUMN] = df["soil_moisture_pct"].shift(-PREDICTION_HORIZON_HOURS)

    # Residual target for Hybrid ML (difference between actual future moisture and physics projection)
    df[RESIDUAL_TARGET_COLUMN] = df[TARGET_COLUMN] - df[PHYSICS_PREDICTION_COLUMN]

    # 9. Clean Warmup & Horizon NaN Boundaries
    valid_rows = df[MODEL_FEATURE_COLUMNS_V2].notna().all(axis=1) & df[TARGET_COLUMN].notna()
    df_clean = df[valid_rows].copy().reset_index(drop=True)

    return df_clean


def get_feature_target_arrays_v2(
    df: pd.DataFrame,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Extracts feature matrix X, direct target y, residual target y_res, and physics prior y_phys.

    Returns:
        X: (N, n_features) feature matrix
        y: (N,) actual future soil moisture at t+3h
        y_res: (N,) residual target (y - y_phys)
        y_phys: (N,) physics baseline predictions
    """
    X = df[MODEL_FEATURE_COLUMNS_V2].to_numpy(dtype=np.float64)
    y = df[TARGET_COLUMN].to_numpy(dtype=np.float64)
    y_res = df[RESIDUAL_TARGET_COLUMN].to_numpy(dtype=np.float64)
    y_phys = df[PHYSICS_PREDICTION_COLUMN].to_numpy(dtype=np.float64)

    return X, y, y_res, y_phys
