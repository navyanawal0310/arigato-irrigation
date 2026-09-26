"""
KRISHI SETU Multi-Model Training & Benchmark Engine
===================================================
Trains multiple regression models alongside persistence and physical baselines.
Performs model selection based strictly on validation set performance.
Evaluates the winning model on the untouched test set.
Saves the production candidate artifact and comprehensive metadata.
"""

import json
from datetime import datetime
from typing import Dict, Any, Tuple
import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from ml.config import (
    PROCESSED_DATA_DIR,
    MODELS_DIR,
    RANDOM_SEED,
    MODEL_VERSION,
    PREDICTION_HORIZON_HOURS,
    TARGET_COLUMN,
    ROOT_ZONE_DEPTH_MM,
    WILTING_POINT_PCT,
)
from ml.src.schema import MODEL_FEATURE_COLUMNS
from ml.src.prepare_dataset import prepare_and_split_data


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Computes MAE, RMSE, and R2 regression metrics."""
    mae = float(mean_absolute_error(y_true, y_pred))
    mse = float(mean_squared_error(y_true, y_pred))
    rmse = float(np.sqrt(mse))
    r2 = float(r2_score(y_true, y_pred))
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2": round(r2, 4),
    }


class PersistenceBaseline:
    """
    Baseline A: Persistence Model.
    Predicts that future moisture at t+3 equals current moisture at time t.
    """
    def __init__(self, current_moisture_col: str = "soil_moisture_pct"):
        self.col = current_moisture_col

    def fit(self, X: pd.DataFrame, y: pd.Series = None):
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return X[self.col].to_numpy()


class PhysicalWaterBalanceBaseline:
    """
    Baseline B: Simple Agronomic Water Balance Estimator.
    Estimates 3-hour moisture depletion using ETc = Kc * (ET0/24) * 3h and effective rainfall.
    """
    def __init__(
        self,
        current_moisture_col: str = "soil_moisture_pct",
        et0_col: str = "et0_mm_day",
        kc_col: str = "kc_factor",
        rain_col: str = "rainfall_mm",
        irrigation_col: str = "irrigation_litres",
        root_zone_depth_mm: float = ROOT_ZONE_DEPTH_MM,
    ):
        self.moist_col = current_moisture_col
        self.et0_col = et0_col
        self.kc_col = kc_col
        self.rain_col = rain_col
        self.irr_col = irrigation_col
        self.zr = root_zone_depth_mm

    def fit(self, X: pd.DataFrame, y: pd.Series = None):
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        current_m = X[self.moist_col].to_numpy()
        current_depth = (current_m / 100.0) * self.zr

        # 3 hours of ET loss based on current ET0 rate and crop coefficient Kc
        etc_hourly = (X[self.et0_col].to_numpy() / 24.0) * X[self.kc_col].to_numpy()
        et_3h_mm = etc_hourly * 3.0

        # Estimated water depth at t+3
        predicted_depth = current_depth - et_3h_mm
        predicted_m = (predicted_depth / self.zr) * 100.0
        # Physical boundary clamp
        return np.clip(predicted_m, WILTING_POINT_PCT * 0.7, 50.0)


def train_and_benchmark_models() -> Tuple[Any, Dict[str, Any], pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Trains multiple models, benchmarks them against baselines on the validation set,
    selects the superior model, evaluates on the test set, and exports artifacts.
    """
    train_path = PROCESSED_DATA_DIR / "train.csv"
    val_path = PROCESSED_DATA_DIR / "val.csv"
    test_path = PROCESSED_DATA_DIR / "test.csv"

    if not (train_path.exists() and val_path.exists() and test_path.exists()):
        print("Processed splits not found. Preparing dataset...")
        train_df, val_df, test_df, _ = prepare_and_split_data()
    else:
        train_df = pd.read_csv(train_path)
        val_df = pd.read_csv(val_path)
        test_df = pd.read_csv(test_path)

    X_train = train_df[MODEL_FEATURE_COLUMNS]
    y_train = train_df[TARGET_COLUMN]

    X_val = val_df[MODEL_FEATURE_COLUMNS]
    y_val = val_df[TARGET_COLUMN]

    X_test = test_df[MODEL_FEATURE_COLUMNS]
    y_test = test_df[TARGET_COLUMN]

    print(f"\nDataset Dimensions:")
    print(f"  Training features   : {X_train.shape}")
    print(f"  Validation features : {X_val.shape}")
    print(f"  Test features       : {X_test.shape}")
    print(f"  Feature Count       : {len(MODEL_FEATURE_COLUMNS)}")

    # Models dictionary
    models: Dict[str, Any] = {
        "Baseline_Persistence": PersistenceBaseline(),
        "Baseline_PhysicalET": PhysicalWaterBalanceBaseline(),
        "LinearRegression": LinearRegression(),
        "RidgeRegression": Ridge(alpha=1.0, random_state=RANDOM_SEED),
        "RandomForestRegressor": RandomForestRegressor(
            n_estimators=100,
            max_depth=12,
            min_samples_split=4,
            random_state=RANDOM_SEED,
            n_jobs=-1,
        ),
        "HistGradientBoostingRegressor": HistGradientBoostingRegressor(
            max_iter=150,
            max_depth=6,
            min_samples_leaf=15,
            learning_rate=0.08,
            random_state=RANDOM_SEED,
        ),
    }

    validation_results: Dict[str, Dict[str, float]] = {}
    trained_models: Dict[str, Any] = {}

    print("\n" + "=" * 78)
    print(f"{'MODEL':<32} | {'VAL MAE':<10} | {'VAL RMSE':<10} | {'VAL R2':<10}")
    print("=" * 78)

    for name, model in models.items():
        # Fit model on training set
        model.fit(X_train, y_train)
        trained_models[name] = model

        # Evaluate on validation set
        val_preds = model.predict(X_val)
        metrics = compute_metrics(y_val.to_numpy(), val_preds)
        validation_results[name] = metrics

        print(f"{name:<32} | {metrics['mae']:<10.4f} | {metrics['rmse']:<10.4f} | {metrics['r2']:<10.4f}")

    print("=" * 78)

    # Model Selection: Exclude baselines from selection pool and choose lowest validation RMSE
    ml_candidates = {k: v for k, v in validation_results.items() if not k.startswith("Baseline")}
    best_model_name = min(ml_candidates, key=lambda k: ml_candidates[k]["rmse"])
    best_model = trained_models[best_model_name]

    print(f"\nSelected Candidate Model based on Validation RMSE: '{best_model_name}'")

    # Evaluate best candidate on untouched TEST set
    test_preds = best_model.predict(X_test)
    test_metrics = compute_metrics(y_test.to_numpy(), test_preds)

    # Evaluate persistence baseline on untouched TEST set for direct scientific comparison
    persistence_baseline = trained_models["Baseline_Persistence"]
    pers_test_preds = persistence_baseline.predict(X_test)
    pers_test_metrics = compute_metrics(y_test.to_numpy(), pers_test_preds)

    print("\nFINAL EVALUATION ON UNTOUCHED TEST SET:")
    print(f"  Persistence Baseline : MAE = {pers_test_metrics['mae']:.4f} | RMSE = {pers_test_metrics['rmse']:.4f} | R2 = {pers_test_metrics['r2']:.4f}")
    print(f"  Candidate ({best_model_name:<10}): MAE = {test_metrics['mae']:.4f} | RMSE = {test_metrics['rmse']:.4f} | R2 = {test_metrics['r2']:.4f}")

    rmse_improvement = ((pers_test_metrics['rmse'] - test_metrics['rmse']) / pers_test_metrics['rmse']) * 100.0
    print(f"  Error Reduction over Persistence: {rmse_improvement:.2f}%")

    # Save Best Model Artifact
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_save_path = MODELS_DIR / "soil_moisture_3h.joblib"
    joblib.dump(best_model, model_save_path)
    print(f"\nSaved trained model to {model_save_path}")

    # Build Metadata
    metadata = {
        "model_name": "soil_moisture_3h",
        "model_version": MODEL_VERSION,
        "selected_model_type": best_model_name,
        "training_timestamp": datetime.now().isoformat(),
        "random_seed": RANDOM_SEED,
        "dataset_type": "SIMULATED / DEVELOPMENT DATA",
        "notice": "Never describe model performance on synthetic data as validated real-world agricultural accuracy.",
        "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
        "target_column": TARGET_COLUMN,
        "n_training_samples": len(X_train),
        "n_validation_samples": len(X_val),
        "n_test_samples": len(X_test),
        "feature_names": MODEL_FEATURE_COLUMNS,
        "validation_benchmark_all_models": validation_results,
        "final_test_metrics": {
            "selected_model": {
                "name": best_model_name,
                **test_metrics,
            },
            "persistence_baseline": {
                "name": "Baseline_Persistence",
                **pers_test_metrics,
            },
            "rmse_reduction_pct_vs_persistence": round(rmse_improvement, 2),
        },
    }

    meta_save_path = MODELS_DIR / "soil_moisture_3h_metadata.json"
    with open(meta_save_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved model metadata to {meta_save_path}")

    return best_model, metadata, train_df, val_df, test_df


def main():
    print("=" * 78)
    print("KRISHI SETU - Predictive Soil-Water Model Training Pipeline")
    print("=" * 78)
    train_and_benchmark_models()
    print("\nTraining completed successfully.")


if __name__ == "__main__":
    main()
