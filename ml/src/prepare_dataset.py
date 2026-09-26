"""
KRISHI SETU Dataset Preparation & Chronological Split Pipeline
==============================================================
Loads raw telemetry, computes leakage-free features, and applies strict
time-series chronological train/validation/test splitting.

CHRONOLOGICAL TIME-SERIES SPLIT:
    Train set:      First 70% of chronological observations
    Validation set: Middle 15% of chronological observations (used for model tuning & selection)
    Test set:       Final 15% of chronological observations (UNTOUCHED out-of-time evaluation)
"""

import json
from pathlib import Path
from typing import Tuple, Dict, Any, Optional, Union
import pandas as pd

from ml.config import (
    RAW_DATA_DIR,
    PROCESSED_DATA_DIR,
    TRAIN_RATIO,
    VAL_RATIO,
    TEST_RATIO,
    TARGET_COLUMN,
)
from ml.src.synthetic_generator import generate_synthetic_dataset
from ml.src.feature_engineering import build_derived_features, clean_feature_dataset
from ml.src.schema import validate_dataframe


def prepare_and_split_data(
    raw_csv_path: Optional[Union[str, Path]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, Dict[str, Any]]:
    """
    Loads raw telemetry data, engineers derived features, cleans boundary conditions,
    and partitions the dataset into chronological train, validation, and test splits.
    """
    raw_path = Path(raw_csv_path) if raw_csv_path else (RAW_DATA_DIR / "synthetic_telemetry.csv")

    if not raw_path.exists():
        print(f"Raw data not found at {raw_path}. Generating fresh synthetic telemetry...")
        df_raw = generate_synthetic_dataset(n_hours=5000)
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        df_raw.to_csv(raw_path, index=False)
    else:
        df_raw = pd.read_csv(raw_path)

    print(f"Loaded raw dataset with {len(df_raw)} observations.")

    # Feature transformation
    df_feat = build_derived_features(df_raw)
    df_clean = clean_feature_dataset(df_feat)
    print(f"Engineered features. Retained {len(df_clean)} complete observations after cleaning boundary rows.")

    # Validation check
    is_valid, errors = validate_dataframe(df_clean, require_target=True)
    if not is_valid:
        raise ValueError(f"Feature dataset validation failed: {errors}")

    # Strict Chronological Splitting
    n_total = len(df_clean)
    n_train = int(n_total * TRAIN_RATIO)
    n_val = int(n_total * VAL_RATIO)

    train_df = df_clean.iloc[:n_train].copy().reset_index(drop=True)
    val_df = df_clean.iloc[n_train : n_train + n_val].copy().reset_index(drop=True)
    test_df = df_clean.iloc[n_train + n_val :].copy().reset_index(drop=True)

    split_info = {
        "dataset_type": "SIMULATED / DEVELOPMENT DATA",
        "split_methodology": "Strict chronological time-series split (no shuffling, zero leakage)",
        "total_valid_rows": n_total,
        "train_rows": len(train_df),
        "train_ratio": round(len(train_df) / n_total, 4),
        "train_time_start": str(train_df["timestamp"].iloc[0]) if "timestamp" in train_df else "index_0",
        "train_time_end": str(train_df["timestamp"].iloc[-1]) if "timestamp" in train_df else f"index_{len(train_df)-1}",
        "val_rows": len(val_df),
        "val_ratio": round(len(val_df) / n_total, 4),
        "val_time_start": str(val_df["timestamp"].iloc[0]) if "timestamp" in val_df else "",
        "val_time_end": str(val_df["timestamp"].iloc[-1]) if "timestamp" in val_df else "",
        "test_rows": len(test_df),
        "test_ratio": round(len(test_df) / n_total, 4),
        "test_time_start": str(test_df["timestamp"].iloc[0]) if "timestamp" in test_df else "",
        "test_time_end": str(test_df["timestamp"].iloc[-1]) if "timestamp" in test_df else "",
        "target": TARGET_COLUMN,
    }

    return train_df, val_df, test_df, split_info



def main():
    print("=" * 70)
    print("KRISHI SETU - Telemetry Feature Preparation & Time-Series Splitting")
    print("=" * 70)

    train_df, val_df, test_df, split_info = prepare_and_split_data()

    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
    train_path = PROCESSED_DATA_DIR / "train.csv"
    val_path = PROCESSED_DATA_DIR / "val.csv"
    test_path = PROCESSED_DATA_DIR / "test.csv"
    meta_path = PROCESSED_DATA_DIR / "split_metadata.json"

    train_df.to_csv(train_path, index=False)
    val_df.to_csv(val_path, index=False)
    test_df.to_csv(test_path, index=False)

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(split_info, f, indent=2)

    print(f"Processed splits saved to {PROCESSED_DATA_DIR}:")
    print(f"  - Train      : {len(train_df)} rows [{split_info['train_time_start']} -> {split_info['train_time_end']}]")
    print(f"  - Validation : {len(val_df)} rows [{split_info['val_time_start']} -> {split_info['val_time_end']}]")
    print(f"  - Test       : {len(test_df)} rows [{split_info['test_time_start']} -> {split_info['test_time_end']}]")
    print("Done.\n")


if __name__ == "__main__":
    main()
