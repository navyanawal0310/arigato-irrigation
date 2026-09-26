"""
KRISHI SETU Feature Engineering Pipeline
========================================
Constructs temporal, causal, and lag-transformed features for time-series regression.

STRICT TARGET LEAKAGE PREVENTION:
    All features computed for observation index t rely EXCLUSIVELY on data available at
    or prior to time t (<= t).
    Target 'soil_moisture_t_plus_3h' is explicitly defined as observation at index t + 3.
    Boundary rows with incomplete history or missing future targets are dropped cleanly.
"""

from typing import Tuple, List
import numpy as np
import pandas as pd

from ml.config import PREDICTION_HORIZON_HOURS, TARGET_COLUMN
from ml.src.schema import MODEL_FEATURE_COLUMNS


def build_derived_features(df: pd.DataFrame, prediction_horizon: int = PREDICTION_HORIZON_HOURS) -> pd.DataFrame:
    """
    Transforms sequential hourly telemetry DataFrame into a feature matrix with
    lags, rates of change, rolling windows, and cyclical time features.

    Parameters:
        df: DataFrame containing sequential hourly telemetry sorted chronologically.
        prediction_horizon: Forecast horizon in hours (default 3).

    Returns:
        Processed DataFrame with all feature columns and target column.
    """
    # Ensure DataFrame is sorted chronologically
    df_feat = df.copy()
    if "timestamp" in df_feat.columns:
        df_feat["timestamp"] = pd.to_datetime(df_feat["timestamp"])
        df_feat = df_feat.sort_values("timestamp").reset_index(drop=True)

    # 1. Cyclical & Calendar Time Features
    if "timestamp" in df_feat.columns:
        df_feat["hour"] = df_feat["timestamp"].dt.hour
        df_feat["day_of_year"] = df_feat["timestamp"].dt.dayofyear
    else:
        if "hour" not in df_feat.columns:
            raise ValueError("DataFrame must contain 'timestamp' or 'hour' column.")
        if "day_of_year" not in df_feat.columns:
            df_feat["day_of_year"] = 1

    # Continuous circular harmonic time representation (smooths 23:00 -> 00:00 transition)
    df_feat["hour_sin"] = np.sin(2.0 * np.pi * df_feat["hour"] / 24.0)
    df_feat["hour_cos"] = np.cos(2.0 * np.pi * df_feat["hour"] / 24.0)

    # 2. Historical Lag Features (Strictly past values: shift > 0)
    # Target leakage guard: shift(1) means observation from 1 hour ago
    df_feat["soil_moisture_lag_1h"] = df_feat["soil_moisture_pct"].shift(1)
    df_feat["soil_moisture_lag_3h"] = df_feat["soil_moisture_pct"].shift(3)
    df_feat["soil_moisture_lag_6h"] = df_feat["soil_moisture_pct"].shift(6)

    # 3. Dynamic Rates of Change (Delta)
    df_feat["moisture_change_1h"] = df_feat["soil_moisture_pct"] - df_feat["soil_moisture_lag_1h"]
    df_feat["moisture_change_3h"] = df_feat["soil_moisture_pct"] - df_feat["soil_moisture_lag_3h"]

    # 4. Rolling Window Aggregations (Past observations up to time t)
    # min_periods=window ensures no partial-history leakage
    df_feat["rolling_temperature_3h"] = df_feat["temperature_c"].rolling(window=3, min_periods=3).mean()
    df_feat["rolling_et0_3h"] = df_feat["et0_mm_day"].rolling(window=3, min_periods=3).mean()
    df_feat["rolling_rain_6h"] = df_feat["rainfall_mm"].rolling(window=6, min_periods=6).sum()
    df_feat["irrigation_last_6h"] = df_feat["irrigation_litres"].rolling(window=6, min_periods=6).sum()

    # 5. Future Target Column (Strictly future observation: shift < 0)
    # soil_moisture_t_plus_3h at row t comes from soil_moisture_pct at row t + 3
    df_feat[TARGET_COLUMN] = df_feat["soil_moisture_pct"].shift(-prediction_horizon)

    # Future hardware fault indicator: if probe faults at t+3, that observation cannot serve as ground truth
    if "soil_status" in df_feat.columns:
        df_feat["future_soil_status"] = df_feat["soil_status"].shift(-prediction_horizon)

    return df_feat


def clean_feature_dataset(df_feat: pd.DataFrame) -> pd.DataFrame:
    """
    Cleans the feature dataset by:
    1. Dropping initial rows lacking historical lag/rolling buffer (first 6 rows).
    2. Dropping terminal rows lacking future prediction targets (last 3 rows).
    3. Filtering out rows where current or future soil status is FAULT.
    """
    clean_df = df_feat.copy()

    # Hardware fault filtration
    if "soil_status" in clean_df.columns:
        clean_df = clean_df[clean_df["soil_status"] == "HEALTHY"]

    if "future_soil_status" in clean_df.columns:
        clean_df = clean_df[clean_df["future_soil_status"] == "HEALTHY"]
        clean_df = clean_df.drop(columns=["future_soil_status"])

    # Drop any remaining NaNs in features or target
    required_cols = MODEL_FEATURE_COLUMNS + [TARGET_COLUMN]
    clean_df = clean_df.dropna(subset=required_cols).reset_index(drop=True)

    return clean_df


def extract_features_and_target(
    df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.Series, List[str]]:
    """
    Separates a processed DataFrame into feature matrix X, target vector y, and feature names.
    """
    X = df[MODEL_FEATURE_COLUMNS].copy()
    y = df[TARGET_COLUMN].copy()
    return X, y, MODEL_FEATURE_COLUMNS
