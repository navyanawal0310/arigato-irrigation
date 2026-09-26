"""
KRISHI SETU Dataset Preparation Pipeline (V2)
=============================================
Processes synthetic telemetry into chronological, leakage-free training,
validation, and test splits with complete feature engineering for V2.
"""

import json
from pathlib import Path
from typing import Dict, Any
import numpy as np
import pandas as pd

from ml.config import (
    RAW_DATA_DIR,
    PROCESSED_DATA_DIR,
    TRAIN_RATIO,
    VAL_RATIO,
    TEST_RATIO,
    TARGET_COLUMN,
    PREDICTION_HORIZON_HOURS,
    RANDOM_SEED,
)
from ml.src.synthetic_generator_v2 import generate_synthetic_dataset_v2
from ml.src.feature_engineering_v2 import engineer_features_v2
from ml.src.schema_v2 import MODEL_FEATURE_COLUMNS_V2, RESIDUAL_TARGET_COLUMN, PHYSICS_PREDICTION_COLUMN


def prepare_dataset_v2(force_regenerate_raw: bool = False) -> Dict[str, Any]:
    """
    Orchestrates raw telemetry ingestion, feature engineering, and chronological splitting.
    """
    raw_csv = RAW_DATA_DIR / "synthetic_telemetry_v2.csv"
    if force_regenerate_raw or not raw_csv.exists():
        print("Generating fresh V2 synthetic telemetry...")
        df_raw = generate_synthetic_dataset_v2(n_hours=6000, random_seed=RANDOM_SEED)
        raw_csv.parent.mkdir(parents=True, exist_ok=True)
        df_raw.to_csv(raw_csv, index=False)
    else:
        print(f"Loading existing raw telemetry from {raw_csv}...")
        df_raw = pd.read_csv(raw_csv)

    print(f"Raw telemetry records: {len(df_raw)}")

    # Apply V2 Feature Engineering
    print("Engineering causal features, physics baseline predictions, and residual targets...")
    df_features = engineer_features_v2(df_raw)
    print(f"Valid feature-engineered records: {len(df_features)} (warmup/horizon boundaries dropped)")

    # Chronological Splitting (Strict temporal order - No random shuffling)
    n_total = len(df_features)
    n_train = int(n_total * TRAIN_RATIO)
    n_val = int(n_total * VAL_RATIO)

    train_df = df_features.iloc[:n_train].copy().reset_index(drop=True)
    val_df = df_features.iloc[n_train:n_train + n_val].copy().reset_index(drop=True)
    test_df = df_features.iloc[n_train + n_val:].copy().reset_index(drop=True)

    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
    train_path = PROCESSED_DATA_DIR / "train_v2.csv"
    val_path = PROCESSED_DATA_DIR / "val_v2.csv"
    test_path = PROCESSED_DATA_DIR / "test_v2.csv"
    meta_path = PROCESSED_DATA_DIR / "split_metadata_v2.json"

    train_df.to_csv(train_path, index=False)
    val_df.to_csv(val_path, index=False)
    test_df.to_csv(test_path, index=False)

    metadata = {
        "dataset_version": "2.0.0",
        "split_method": "Strict Chronological Split (No Shuffling)",
        "train_samples": len(train_df),
        "val_samples": len(val_df),
        "test_samples": len(test_df),
        "total_valid_samples": n_total,
        "n_features": len(MODEL_FEATURE_COLUMNS_V2),
        "features": MODEL_FEATURE_COLUMNS_V2,
        "direct_target": TARGET_COLUMN,
        "residual_target": RESIDUAL_TARGET_COLUMN,
        "physics_baseline_col": PHYSICS_PREDICTION_COLUMN,
        "train_time_range": [str(train_df["timestamp"].iloc[0]), str(train_df["timestamp"].iloc[-1])],
        "val_time_range": [str(val_df["timestamp"].iloc[0]), str(val_df["timestamp"].iloc[-1])],
        "test_time_range": [str(test_df["timestamp"].iloc[0]), str(test_df["timestamp"].iloc[-1])],
        "regime_distribution": {
            "train": train_df["scenario"].value_counts().to_dict(),
            "val": val_df["scenario"].value_counts().to_dict(),
            "test": test_df["scenario"].value_counts().to_dict(),
        },
        "irrigation_event_counts": {
            "train": int((train_df["irrigation_litres"] > 0).sum()),
            "val": int((val_df["irrigation_litres"] > 0).sum()),
            "test": int((test_df["irrigation_litres"] > 0).sum()),
        },
        "rain_event_counts": {
            "train": int((train_df["observed_rain_mm"] > 0).sum()),
            "val": int((val_df["observed_rain_mm"] > 0).sum()),
            "test": int((test_df["observed_rain_mm"] > 0).sum()),
        },
        "near_wilting_counts": {
            "train": int((train_df["soil_moisture_pct"] <= 17.0).sum()),
            "val": int((val_df["soil_moisture_pct"] <= 17.0).sum()),
            "test": int((test_df["soil_moisture_pct"] <= 17.0).sum()),
        }
    }

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print("\nDataset V2 successfully prepared:")
    print(f"  Train: {len(train_df)} rows | Rain: {metadata['rain_event_counts']['train']} | Irr: {metadata['irrigation_event_counts']['train']} | Near-Wilting: {metadata['near_wilting_counts']['train']}")
    print(f"  Val:   {len(val_df)} rows | Rain: {metadata['rain_event_counts']['val']} | Irr: {metadata['irrigation_event_counts']['val']} | Near-Wilting: {metadata['near_wilting_counts']['val']}")
    print(f"  Test:  {len(test_df)} rows | Rain: {metadata['rain_event_counts']['test']} | Irr: {metadata['irrigation_event_counts']['test']} | Near-Wilting: {metadata['near_wilting_counts']['test']}")

    return metadata


def main():
    prepare_dataset_v2(force_regenerate_raw=False)


if __name__ == "__main__":
    main()
