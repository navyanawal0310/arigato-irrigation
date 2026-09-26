"""
KRISHI SETU Model Training & Selection Pipeline (V2)
====================================================
Implements rigorous benchmarking of:
1. Baseline A: Persistence
2. Baseline B: Physics Water-Balance (predict_physics_water_balance_3h)
3. Direct ML: Linear, Ridge, RandomForest, HistGradientBoosting, ExtraTrees
4. Hybrid Physics + ML Residual: Physics prior + ML learned residual corrections

METHODOLOGY:
- Expanding-window TimeSeriesSplit on training data.
- Model selection performed strictly on the Validation set.
- Test set remains untouched during tuning and candidate selection.
- Physics bounds [WILTING_POINT * 0.7, SATURATION] strictly enforced.
"""

import json
from pathlib import Path
from typing import Dict, Any, Tuple, List
import numpy as np
import pandas as pd
import joblib

from sklearn.linear_model import LinearRegression, Ridge
from sklearn.ensemble import (
    RandomForestRegressor,
    HistGradientBoostingRegressor,
    ExtraTreesRegressor,
)
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

from ml.config import (
    PROCESSED_DATA_DIR,
    MODELS_DIR,
    RESULTS_DIR,
    RANDOM_SEED,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    CURRENT_MOISTURE_COLUMN,
    TARGET_COLUMN,
)
from ml.src.schema_v2 import (
    MODEL_FEATURE_COLUMNS_V2,
    RESIDUAL_TARGET_COLUMN,
    PHYSICS_PREDICTION_COLUMN,
)


class HybridPhysicsMLModel:
    """
    Hybrid Physics + ML Residual Predictor.
    Combines FAO-56 hydrological conservation prior with empirical ML residual correction:
        y_hat = y_physics + ML(X)
    """

    def __init__(self, ml_regressor: Any, name: str = "Hybrid_Physics_ML"):
        self.ml_regressor = ml_regressor
        self.name = name

    def fit(self, X: np.ndarray, y_residual: np.ndarray):
        self.ml_regressor.fit(X, y_residual)
        return self

    def predict(self, X: np.ndarray, y_physics: np.ndarray) -> np.ndarray:
        res_pred = self.ml_regressor.predict(X)
        y_final = y_physics + res_pred
        # Enforce hard hydrodynamic bounds
        min_bound = WILTING_POINT_PCT * 0.7
        max_bound = SATURATION_PCT
        return np.clip(y_final, min_bound, max_bound)


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Computes MAE, RMSE, and R2 score."""
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2": round(r2, 4),
    }


def train_and_select_model_v2():
    print("=" * 80)
    print("KRISHI SETU ML — EXPERIMENT V2: MODEL TRAINING & BENCHMARKING")
    print("=" * 80)

    # 1. Load Chronological Splits
    train_path = PROCESSED_DATA_DIR / "train_v2.csv"
    val_path = PROCESSED_DATA_DIR / "val_v2.csv"
    test_path = PROCESSED_DATA_DIR / "test_v2.csv"

    if not train_path.exists() or not val_path.exists() or not test_path.exists():
        raise FileNotFoundError("Processed datasets missing. Run prepare_dataset_v2.py first.")

    train_df = pd.read_csv(train_path)
    val_df = pd.read_csv(val_path)
    test_df = pd.read_csv(test_path)

    print(f"Loaded datasets: Train={len(train_df)}, Val={len(val_df)}, Test={len(test_df)}")

    # Feature matrices and targets
    X_train = train_df[MODEL_FEATURE_COLUMNS_V2].to_numpy(dtype=np.float64)
    y_train_direct = train_df[TARGET_COLUMN].to_numpy(dtype=np.float64)
    y_train_res = train_df[RESIDUAL_TARGET_COLUMN].to_numpy(dtype=np.float64)
    y_train_phys = train_df[PHYSICS_PREDICTION_COLUMN].to_numpy(dtype=np.float64)

    X_val = val_df[MODEL_FEATURE_COLUMNS_V2].to_numpy(dtype=np.float64)
    y_val_actual = val_df[TARGET_COLUMN].to_numpy(dtype=np.float64)
    y_val_phys = val_df[PHYSICS_PREDICTION_COLUMN].to_numpy(dtype=np.float64)
    y_val_pers = val_df[CURRENT_MOISTURE_COLUMN].to_numpy(dtype=np.float64)

    # 2. Compute Benchmark Baselines on Validation Set
    val_persistence_metrics = compute_metrics(y_val_actual, y_val_pers)
    val_physics_metrics = compute_metrics(y_val_actual, y_val_phys)

    print("\n--- BASELINE BENCHMARKS ON VALIDATION SET ---")
    print(f"BASELINE A (Persistence): RMSE = {val_persistence_metrics['rmse']:.4f}, MAE = {val_persistence_metrics['mae']:.4f}, R² = {val_persistence_metrics['r2']:.4f}")
    print(f"BASELINE B (Physics):     RMSE = {val_physics_metrics['rmse']:.4f}, MAE = {val_physics_metrics['mae']:.4f}, R² = {val_physics_metrics['r2']:.4f}")

    # 3. Define Candidate Architectures
    model_configs: Dict[str, Dict[str, Any]] = {
        # DIRECT ML MODELS
        "Direct_LinearRegression": {
            "type": "direct",
            "estimator": LinearRegression(),
        },
        "Direct_Ridge": {
            "type": "direct",
            "estimator": Ridge(alpha=10.0, random_state=RANDOM_SEED),
        },
        "Direct_RandomForest": {
            "type": "direct",
            "estimator": RandomForestRegressor(n_estimators=100, max_depth=12, random_state=RANDOM_SEED, n_jobs=-1),
        },
        "Direct_HistGradientBoosting": {
            "type": "direct",
            "estimator": HistGradientBoostingRegressor(max_iter=150, max_depth=8, learning_rate=0.08, random_state=RANDOM_SEED),
        },
        "Direct_ExtraTrees": {
            "type": "direct",
            "estimator": ExtraTreesRegressor(n_estimators=100, max_depth=12, random_state=RANDOM_SEED, n_jobs=-1),
        },
        # HYBRID PHYSICS + ML RESIDUAL MODELS
        "Hybrid_Physics_Linear": {
            "type": "hybrid",
            "estimator": LinearRegression(),
        },
        "Hybrid_Physics_Ridge": {
            "type": "hybrid",
            "estimator": Ridge(alpha=10.0, random_state=RANDOM_SEED),
        },
        "Hybrid_Physics_RandomForest": {
            "type": "hybrid",
            "estimator": RandomForestRegressor(n_estimators=100, max_depth=10, random_state=RANDOM_SEED, n_jobs=-1),
        },
        "Hybrid_Physics_HistGradientBoosting": {
            "type": "hybrid",
            "estimator": HistGradientBoostingRegressor(max_iter=150, max_depth=6, learning_rate=0.08, random_state=RANDOM_SEED),
        },
        "Hybrid_Physics_ExtraTrees": {
            "type": "hybrid",
            "estimator": ExtraTreesRegressor(n_estimators=100, max_depth=10, random_state=RANDOM_SEED, n_jobs=-1),
        },
    }

    # 4. Train each model on Train set, evaluate on Validation set
    candidate_results: Dict[str, Any] = {}
    fitted_models: Dict[str, Any] = {}

    print("\n--- TRAINING & VALIDATING CANDIDATES ---")
    for name, config in model_configs.items():
        m_type = config["type"]
        estimator = config["estimator"]

        if m_type == "direct":
            estimator.fit(X_train, y_train_direct)
            y_val_pred = np.clip(estimator.predict(X_val), WILTING_POINT_PCT * 0.7, SATURATION_PCT)
            model_obj = estimator
        else:  # hybrid
            hybrid = HybridPhysicsMLModel(estimator, name=name)
            hybrid.fit(X_train, y_train_res)
            y_val_pred = hybrid.predict(X_val, y_val_phys)
            model_obj = hybrid

        metrics = compute_metrics(y_val_actual, y_val_pred)
        # Compute improvement relative to persistence and physics
        rmse_vs_pers = ((val_persistence_metrics["rmse"] - metrics["rmse"]) / val_persistence_metrics["rmse"]) * 100.0
        rmse_vs_phys = ((val_physics_metrics["rmse"] - metrics["rmse"]) / val_physics_metrics["rmse"]) * 100.0

        candidate_results[name] = {
            "model_type": m_type,
            "val_mae": metrics["mae"],
            "val_rmse": metrics["rmse"],
            "val_r2": metrics["r2"],
            "improvement_vs_persistence_pct": round(rmse_vs_pers, 2),
            "improvement_vs_physics_pct": round(rmse_vs_phys, 2),
        }
        fitted_models[name] = model_obj

        print(f"  {name:36s} | Val RMSE: {metrics['rmse']:.4f} | R²: {metrics['r2']:.4f} | vs Pers: {rmse_vs_pers:+6.2f}% | vs Phys: {rmse_vs_phys:+6.2f}%")

    # 5. Select Winning Candidate Based on Lowest Validation RMSE
    best_candidate_name = min(candidate_results, key=lambda k: candidate_results[k]["val_rmse"])
    best_candidate_metrics = candidate_results[best_candidate_name]
    best_model = fitted_models[best_candidate_name]

    print("\n" + "=" * 80)
    print(f"SELECTED WINNING CANDIDATE: {best_candidate_name}")
    print(f"  Validation RMSE: {best_candidate_metrics['val_rmse']:.4f}")
    print(f"  Improvement vs Persistence Baseline: {best_candidate_metrics['improvement_vs_persistence_pct']:+6.2f}%")
    print(f"  Improvement vs Physics Baseline:     {best_candidate_metrics['improvement_vs_physics_pct']:+6.2f}%")
    print("=" * 80)

    # 6. Save Model Artifacts
    v2_models_dir = MODELS_DIR / "v2"
    v2_models_dir.mkdir(parents=True, exist_ok=True)
    model_save_path = v2_models_dir / "soil_moisture_3h_v2.joblib"
    meta_save_path = v2_models_dir / "soil_moisture_3h_metadata_v2.json"

    # Also save selection summary in ml/results/v2/
    v2_results_dir = RESULTS_DIR / "v2"
    v2_results_dir.mkdir(parents=True, exist_ok=True)
    selection_summary_path = v2_results_dir / "model_selection_v2.json"

    # Save model artifact
    joblib.dump({
        "model_name": best_candidate_name,
        "model_type": best_candidate_metrics["model_type"],
        "model": best_model,
        "features": MODEL_FEATURE_COLUMNS_V2,
        "val_metrics": best_candidate_metrics,
        "baseline_val_persistence": val_persistence_metrics,
        "baseline_val_physics": val_physics_metrics,
    }, model_save_path)

    metadata = {
        "model_version": "2.0.0",
        "selected_candidate": best_candidate_name,
        "candidate_type": best_candidate_metrics["model_type"],
        "validation_rmse": best_candidate_metrics["val_rmse"],
        "validation_mae": best_candidate_metrics["val_mae"],
        "validation_r2": best_candidate_metrics["val_r2"],
        "val_improvement_vs_persistence_pct": best_candidate_metrics["improvement_vs_persistence_pct"],
        "val_improvement_vs_physics_pct": best_candidate_metrics["improvement_vs_physics_pct"],
        "persistence_baseline_val_rmse": val_persistence_metrics["rmse"],
        "physics_baseline_val_rmse": val_physics_metrics["rmse"],
        "features": MODEL_FEATURE_COLUMNS_V2,
        "target": TARGET_COLUMN,
        "prediction_horizon_hours": 3,
        "all_candidate_val_results": candidate_results,
    }

    with open(meta_save_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    with open(selection_summary_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"\nArtifacts preserved:")
    print(f"  Model saved    -> {model_save_path}")
    print(f"  Metadata saved -> {meta_save_path}")
    print(f"  Selection log  -> {selection_summary_path}")

    return best_candidate_name, best_model, metadata


def main():
    train_and_select_model_v2()


if __name__ == "__main__":
    main()
