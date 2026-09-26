"""
KRISHI SETU Scientific Evaluation & Visualization Engine
========================================================
Conducts rigorous multi-scenario model evaluation, computes stratified error
breakdowns across agronomic regimes, and generates publication-quality plots.
"""

import json
from pathlib import Path
from typing import Dict, Any
import joblib
import matplotlib
matplotlib.use("Agg")  # Non-interactive headless backend
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.inspection import permutation_importance

from ml.config import (
    PROCESSED_DATA_DIR,
    MODELS_DIR,
    RESULTS_DIR,
    RANDOM_SEED,
    TARGET_COLUMN,
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
)
from ml.src.schema import MODEL_FEATURE_COLUMNS


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Computes MAE, RMSE, and R2."""
    if len(y_true) == 0:
        return {"mae": 0.0, "rmse": 0.0, "r2": 0.0, "count": 0}
    mae = float(mean_absolute_error(y_true, y_pred))
    mse = float(mean_squared_error(y_true, y_pred))
    rmse = float(np.sqrt(mse))
    # If standard deviation is 0, R2 is undefined/0
    r2 = float(r2_score(y_true, y_pred)) if np.std(y_true) > 1e-6 else 0.0
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2": round(r2, 4),
        "count": int(len(y_true)),
    }


def evaluate_agronomic_scenarios(test_df: pd.DataFrame, y_pred: np.ndarray) -> Dict[str, Any]:
    """
    Evaluates model and persistence baseline errors across critical agronomic regimes:
    dry periods, rain events, irrigation events, high ET0, and moisture brackets.
    """
    y_true = test_df[TARGET_COLUMN].to_numpy()
    y_pers = test_df["soil_moisture_pct"].to_numpy()

    # Define slice masks
    masks = {
        "overall_test_set": np.ones(len(test_df), dtype=bool),
        "dry_periods": (test_df["rainfall_mm"] == 0) & (test_df["irrigation_litres"] == 0),
        "rain_events": (test_df["rainfall_mm"] > 0) | (test_df["rolling_rain_6h"] > 1.0),
        "irrigation_events": (test_df["irrigation_litres"] > 0) | (test_df["irrigation_last_6h"] > 5.0),
        "high_et0_periods": test_df["et0_mm_day"] >= 5.0,
        "low_moisture_near_wilting": test_df["soil_moisture_pct"] <= (WILTING_POINT_PCT + 5.0),
        "optimal_moisture_bracket": (test_df["soil_moisture_pct"] > (WILTING_POINT_PCT + 5.0)) & (test_df["soil_moisture_pct"] <= FIELD_CAPACITY_PCT),
        "near_saturation_wet": test_df["soil_moisture_pct"] > FIELD_CAPACITY_PCT,
    }

    scenario_metrics: Dict[str, Any] = {}

    for name, mask in masks.items():
        sub_y_true = y_true[mask]
        sub_y_pred = y_pred[mask]
        sub_y_pers = y_pers[mask]

        model_m = compute_metrics(sub_y_true, sub_y_pred)
        pers_m = compute_metrics(sub_y_true, sub_y_pers)

        rmse_diff = pers_m["rmse"] - model_m["rmse"]
        improvement_pct = round((rmse_diff / pers_m["rmse"]) * 100.0, 2) if pers_m["rmse"] > 0 else 0.0

        scenario_metrics[name] = {
            "sample_count": model_m["count"],
            "model_mae": model_m["mae"],
            "model_rmse": model_m["rmse"],
            "model_r2": model_m["r2"],
            "persistence_mae": pers_m["mae"],
            "persistence_rmse": pers_m["rmse"],
            "persistence_r2": pers_m["r2"],
            "rmse_improvement_pct": improvement_pct,
        }

    return scenario_metrics


def generate_evaluation_plots(
    test_df: pd.DataFrame,
    y_true: np.ndarray,
    y_pred: np.ndarray,
    model: Any,
    results_dir: Path,
):
    """
    Generates 5 publication-ready diagnostic charts:
    1. actual_vs_predicted.png
    2. time_series_prediction.png
    3. residual_distribution.png
    4. feature_importance.png
    5. event_zoom.png (rain & irrigation event zoom)
    """
    results_dir.mkdir(parents=True, exist_ok=True)
    residuals = y_pred - y_true
    overall_r2 = r2_score(y_true, y_pred)
    overall_rmse = np.sqrt(mean_squared_error(y_true, y_pred))

    # --- PLOT 1: ACTUAL VS PREDICTED SCATTER ---
    fig, ax = plt.subplots(figsize=(7, 6), dpi=300)
    ax.scatter(y_true, y_pred, alpha=0.35, edgecolors="none", color="#10b981", s=18, label="Test Observations")
    min_val = min(y_true.min(), y_pred.min()) - 1
    max_val = max(y_true.max(), y_pred.max()) + 1
    ax.plot([min_val, max_val], [min_val, max_val], color="#dc2626", linestyle="--", linewidth=1.5, label="1:1 Perfect Agreement")
    ax.set_xlabel("Actual Soil Moisture t+3h (%)", fontsize=11, fontweight="bold")
    ax.set_ylabel("Predicted Soil Moisture t+3h (%)", fontsize=11, fontweight="bold")
    ax.set_title("KRISHI SETU: Actual vs Predicted Soil Moisture (t+3h)", fontsize=12, fontweight="bold", pad=10)
    ax.annotate(f"R² = {overall_r2:.4f}\nRMSE = {overall_rmse:.3f}%\nMAE = {mean_absolute_error(y_true, y_pred):.3f}%",
                xy=(0.05, 0.82), xycoords="axes fraction",
                bbox=dict(boxstyle="round,pad=0.5", fc="#f8fafc", ec="#cbd5e1", alpha=0.9),
                fontsize=10)
    ax.grid(True, linestyle=":", alpha=0.6)
    ax.legend(loc="lower right")
    plt.tight_layout()
    scatter_path = results_dir / "actual_vs_predicted.png"
    plt.savefig(scatter_path)
    plt.close()

    # --- PLOT 2: TIME SERIES PREDICTION OVERLAY ---
    # Show first 240 hours (10 days) of test set for clear visual resolution
    window_len = min(240, len(test_df))
    time_indices = np.arange(window_len)
    fig, ax = plt.subplots(figsize=(12, 4.5), dpi=300)
    ax.plot(time_indices, y_true[:window_len], label="Actual Soil Moisture (%)", color="#0284c7", linewidth=2.0)
    ax.plot(time_indices, y_pred[:window_len], label="Predicted Moisture t+3h (%)", color="#16a34a", linestyle="--", linewidth=1.8)
    ax.plot(time_indices, test_df["soil_moisture_pct"].iloc[:window_len], label="Persistence (Current t)", color="#94a3b8", linestyle=":", linewidth=1.2, alpha=0.8)
    ax.set_xlabel("Time (Sequential Test Hours)", fontsize=11, fontweight="bold")
    ax.set_ylabel("Soil Moisture (%)", fontsize=11, fontweight="bold")
    ax.set_title("KRISHI SETU: Sequential Time-Series Trajectory (10-Day Test Window)", fontsize=12, fontweight="bold", pad=10)
    ax.grid(True, linestyle=":", alpha=0.6)
    ax.legend(loc="upper right")
    plt.tight_layout()
    ts_path = results_dir / "time_series_prediction.png"
    plt.savefig(ts_path)
    plt.close()

    # --- PLOT 3: RESIDUAL DISTRIBUTION ---
    fig, (ax_hist, ax_box) = plt.subplots(2, 1, figsize=(8, 6), sharex=True, gridspec_kw={"height_ratios": [3, 1]}, dpi=300)
    ax_hist.hist(residuals, bins=45, color="#0ea5e9", edgecolor="#0284c7", alpha=0.7, density=True)
    ax_hist.axvline(0, color="#dc2626", linestyle="--", linewidth=1.5, label="Zero Error (Residual = 0)")
    ax_hist.axvline(np.mean(residuals), color="#f59e0b", linestyle="-", linewidth=1.5, label=f"Mean Error = {np.mean(residuals):.3f}%")
    ax_hist.set_ylabel("Probability Density", fontsize=10, fontweight="bold")
    ax_hist.set_title("KRISHI SETU: Residual Distribution (Predicted - Actual)", fontsize=12, fontweight="bold", pad=10)
    ax_hist.grid(True, linestyle=":", alpha=0.6)
    ax_hist.legend(loc="upper left")

    ax_box.boxplot(residuals, vert=False, patch_artist=True, boxprops=dict(facecolor="#bae6fd", color="#0284c7"), medianprops=dict(color="#dc2626", linewidth=1.5))
    ax_box.set_xlabel("Residual Error (Predicted - Actual %)", fontsize=11, fontweight="bold")
    ax_box.set_yticks([])
    ax_box.grid(True, linestyle=":", alpha=0.6)
    plt.tight_layout()
    res_path = results_dir / "residual_distribution.png"
    plt.savefig(res_path)
    plt.close()

    # --- PLOT 4: FEATURE IMPORTANCE ---
    fig, ax = plt.subplots(figsize=(9, 7), dpi=300)
    feature_names = MODEL_FEATURE_COLUMNS

    if hasattr(model, "feature_importances_"):
        importances = model.feature_importances_
    else:
        # Use Permutation Importance on a 300-sample test slice for models without tree feature_importances_
        sample_slice = test_df.iloc[:300]
        perm = permutation_importance(model, sample_slice[MODEL_FEATURE_COLUMNS], sample_slice[TARGET_COLUMN], n_repeats=5, random_state=RANDOM_SEED)
        importances = perm.importances_mean

    feat_df = pd.DataFrame({"feature": feature_names, "importance": importances}).sort_values("importance", ascending=True)
    ax.barh(feat_df["feature"], feat_df["importance"], color="#3b82f6", edgecolor="#1d4ed8", alpha=0.85)
    ax.set_xlabel("Feature Importance Score", fontsize=11, fontweight="bold")
    ax.set_title("KRISHI SETU: Model Feature Importance Ranking", fontsize=12, fontweight="bold", pad=10)
    ax.grid(True, linestyle=":", alpha=0.6, axis="x")
    plt.tight_layout()
    fi_path = results_dir / "feature_importance.png"
    plt.savefig(fi_path)
    plt.close()

    # --- PLOT 5: RAIN & IRRIGATION EVENT ZOOM ---
    # Find an event window in test_df that contains both rain and irrigation
    rainy_indices = test_df.index[test_df["rainfall_mm"] > 3.0].tolist()
    if len(rainy_indices) > 0:
        center_idx = rainy_indices[0]
        start_idx = max(0, center_idx - 20)
        end_idx = min(len(test_df), center_idx + 40)
    else:
        start_idx, end_idx = 0, min(60, len(test_df))

    event_sub = test_df.iloc[start_idx:end_idx].reset_index(drop=True)
    event_true = y_true[start_idx:end_idx]
    event_pred = y_pred[start_idx:end_idx]
    event_time = np.arange(len(event_sub))

    fig, (ax_m, ax_f) = plt.subplots(2, 1, figsize=(11, 6.5), sharex=True, gridspec_kw={"height_ratios": [2.5, 1.2]}, dpi=300)

    # Top: Soil Moisture Response
    ax_m.plot(event_time, event_true, label="Actual Soil Moisture (%)", color="#0369a1", linewidth=2.2)
    ax_m.plot(event_time, event_pred, label="Predicted Soil Moisture t+3h (%)", color="#15803d", linestyle="--", linewidth=2.0)
    ax_m.set_ylabel("Soil Moisture (%)", fontsize=11, fontweight="bold")
    ax_m.set_title("KRISHI SETU: Hydrodynamic Response during Rain & Irrigation Events", fontsize=12, fontweight="bold", pad=10)
    ax_m.grid(True, linestyle=":", alpha=0.6)
    ax_m.legend(loc="upper left")

    # Bottom: Hydrological Inputs (Rainfall & Irrigation)
    ax_f.bar(event_time - 0.15, event_sub["rainfall_mm"], width=0.3, color="#38bdf8", label="Precipitation (mm)", alpha=0.85)
    ax_f.bar(event_time + 0.15, event_sub["irrigation_litres"], width=0.3, color="#a855f7", label="Irrigation (Litres)", alpha=0.85)
    ax_f.set_xlabel("Time Relative to Event Window (Hours)", fontsize=11, fontweight="bold")
    ax_f.set_ylabel("Inputs (mm / L)", fontsize=11, fontweight="bold")
    ax_f.grid(True, linestyle=":", alpha=0.6)
    ax_f.legend(loc="upper right")

    plt.tight_layout()
    event_path = results_dir / "event_zoom.png"
    plt.savefig(event_path)
    plt.close()

    print(f"Generated 5 diagnostic figures in {results_dir}:")
    print(f"  1. {scatter_path.name}")
    print(f"  2. {ts_path.name}")
    print(f"  3. {res_path.name}")
    print(f"  4. {fi_path.name}")
    print(f"  5. {event_path.name}")


def run_full_evaluation():
    """Executes the full evaluation pipeline and outputs summary table and charts."""
    test_path = PROCESSED_DATA_DIR / "test.csv"
    model_path = MODELS_DIR / "soil_moisture_3h.joblib"

    if not model_path.exists() or not test_path.exists():
        raise FileNotFoundError(f"Model or test dataset missing. Please run train.py first. Looking for {model_path} and {test_path}")

    model = joblib.load(model_path)
    test_df = pd.read_csv(test_path)

    X_test = test_df[MODEL_FEATURE_COLUMNS]
    y_test = test_df[TARGET_COLUMN].to_numpy()

    y_pred = model.predict(X_test)
    scenario_metrics = evaluate_agronomic_scenarios(test_df, y_pred)

    # Print Formatted Evaluation Table
    print("\n" + "=" * 90)
    print(f"{'AGRONOMIC REGIME / SCENARIO':<30} | {'SAMPLES':<8} | {'MODEL RMSE':<11} | {'PERS RMSE':<11} | {'IMPROVEMENT':<12}")
    print("=" * 90)

    for regime, metrics in scenario_metrics.items():
        imp_str = f"{metrics['rmse_improvement_pct']:+.1f}%"
        print(f"{regime:<30} | {metrics['sample_count']:<8} | {metrics['model_rmse']:<11.4f} | {metrics['persistence_rmse']:<11.4f} | {imp_str:<12}")

    print("=" * 90)

    # Generate publication figures
    generate_evaluation_plots(test_df, y_test, y_pred, model, RESULTS_DIR)

    # Save detailed evaluation report
    report_path = RESULTS_DIR / "evaluation_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(scenario_metrics, f, indent=2)
    print(f"\nSaved evaluation report -> {report_path}\n")

    return scenario_metrics


def main():
    print("=" * 90)
    print("KRISHI SETU - Predictive Soil-Water Evaluation & Visualization Pipeline")
    print("=" * 90)
    run_full_evaluation()


if __name__ == "__main__":
    main()
