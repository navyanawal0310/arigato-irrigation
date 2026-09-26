"""
KRISHI SETU ML — Comprehensive Model Evaluation & Diagnostic Engine (V2)
========================================================================
Evaluates candidate against:
- BASELINE A: Persistence (theta_t)
- BASELINE B: Physics Water Balance (predict_physics_water_balance_3h)

Evaluates performance across 8 distinct agronomic slices with strict N/A handling.
Produces 6 publication-ready diagnostic charts:
1. residual_vs_moisture.png
2. residual_vs_rain.png
3. residual_vs_et0.png
4. rain_event_zoom.png
5. irrigation_event_zoom.png
6. drydown_event_zoom.png

Performs systematic bias diagnosis:
- underpredicts recharge after rain
- overpredicts drying
- fails near field capacity
- lags irrigation response
"""

import json
from pathlib import Path
from typing import Dict, Any, Union, Optional
import numpy as np
import pandas as pd
import joblib
import matplotlib.pyplot as plt

from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

from ml.config import (
    PROCESSED_DATA_DIR,
    MODELS_DIR,
    RESULTS_DIR,
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    CURRENT_MOISTURE_COLUMN,
    TARGET_COLUMN,
)
from ml.src.schema_v2 import (
    MODEL_FEATURE_COLUMNS_V2,
    PHYSICS_PREDICTION_COLUMN,
    RESIDUAL_TARGET_COLUMN,
)
from ml.src.train_v2 import HybridPhysicsMLModel


def compute_metrics_slice(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, Union[float, str]]:
    """Computes MAE, RMSE, R2 with strict N/A handling for zero-sample slices."""
    n = len(y_true)
    if n == 0:
        return {
            "sample_count": 0,
            "mae": "N/A — no samples",
            "rmse": "N/A — no samples",
            "r2": "N/A — no samples",
        }
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    # R2 can be undefined/meaningless if variance is 0
    if n > 1 and np.var(y_true) > 1e-6:
        r2 = float(r2_score(y_true, y_pred))
    else:
        r2 = 0.0

    return {
        "sample_count": n,
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2": round(r2, 4),
    }


def evaluate_v2_pipeline():
    print("=" * 80)
    print("KRISHI SETU ML — EXPERIMENT V2: INDEPENDENT TEST SET EVALUATION")
    print("=" * 80)

    # 1. Load Model and Untouched Test Set
    model_path = MODELS_DIR / "v2" / "soil_moisture_3h_v2.joblib"
    test_path = PROCESSED_DATA_DIR / "test_v2.csv"
    results_dir = RESULTS_DIR / "v2"
    results_dir.mkdir(parents=True, exist_ok=True)

    if not model_path.exists():
        raise FileNotFoundError(f"Model artifact not found at {model_path}. Run train_v2.py first.")
    if not test_path.exists():
        raise FileNotFoundError(f"Test set not found at {test_path}. Run prepare_dataset_v2.py first.")

    bundle = joblib.load(model_path)
    model = bundle["model"]
    model_name = bundle["model_name"]
    model_type = bundle["model_type"]

    test_df = pd.read_csv(test_path)
    print(f"Loaded Winning Candidate: {model_name} (Type: {model_type})")
    print(f"Loaded Untouched Test Observations: {len(test_df)}")

    # 2. Generate Predictions
    X_test = test_df[MODEL_FEATURE_COLUMNS_V2].to_numpy(dtype=np.float64)
    y_true = test_df[TARGET_COLUMN].to_numpy(dtype=np.float64)
    y_pers = test_df[CURRENT_MOISTURE_COLUMN].to_numpy(dtype=np.float64)
    y_phys = test_df[PHYSICS_PREDICTION_COLUMN].to_numpy(dtype=np.float64)

    if model_type == "hybrid":
        y_pred = model.predict(X_test, y_phys)
    else:
        y_pred = np.clip(model.predict(X_test), WILTING_POINT_PCT * 0.7, SATURATION_PCT)

    # 3. Evaluate Slices Across Agronomic Regimes
    masks = {
        "overall_test_set": np.ones(len(test_df), dtype=bool),
        "dry_periods": (test_df["observed_rain_mm"] == 0) & (test_df["irrigation_litres"] == 0),
        "rain_events": (test_df["observed_rain_mm"] > 0) | (test_df["rolling_rain_6h"] > 1.0),
        "irrigation_events": (test_df["irrigation_litres"] > 0) | (test_df["irrigation_last_6h"] > 5.0),
        "high_et0_periods": test_df["et0_mm_day"] >= 5.0,
        "low_moisture_near_wilting": test_df["soil_moisture_pct"] <= (WILTING_POINT_PCT + 5.0),
        "optimal_moisture_bracket": (test_df["soil_moisture_pct"] > (WILTING_POINT_PCT + 5.0)) & (test_df["soil_moisture_pct"] <= FIELD_CAPACITY_PCT),
        "near_saturation_wet": test_df["soil_moisture_pct"] > FIELD_CAPACITY_PCT,
    }

    slice_results: Dict[str, Any] = {}
    print("\n" + "-" * 95)
    print(f"{'Agronomic Regime':28s} | {'Samples':7s} | {'Model RMSE':10s} | {'Pers RMSE':10s} | {'Phys RMSE':10s} | {'vs Pers %':10s} | {'vs Phys %':10s}")
    print("-" * 95)

    for regime_name, mask in masks.items():
        sub_y_true = y_true[mask]
        sub_y_pred = y_pred[mask]
        sub_y_pers = y_pers[mask]
        sub_y_phys = y_phys[mask]

        m_model = compute_metrics_slice(sub_y_true, sub_y_pred)
        m_pers = compute_metrics_slice(sub_y_true, sub_y_pers)
        m_phys = compute_metrics_slice(sub_y_true, sub_y_phys)

        count = m_model["sample_count"]

        if count == 0:
            imp_pers = "N/A — no samples"
            imp_phys = "N/A — no samples"
            m_rmse_str = "N/A"
            pers_rmse_str = "N/A"
            phys_rmse_str = "N/A"
            imp_pers_str = "N/A"
            imp_phys_str = "N/A"
        else:
            m_rmse = float(m_model["rmse"])
            p_rmse = float(m_pers["rmse"])
            ph_rmse = float(m_phys["rmse"])

            imp_pers = round(((p_rmse - m_rmse) / p_rmse) * 100.0, 2) if p_rmse > 0 else 0.0
            imp_phys = round(((ph_rmse - m_rmse) / ph_rmse) * 100.0, 2) if ph_rmse > 0 else 0.0

            m_rmse_str = f"{m_rmse:.4f}"
            pers_rmse_str = f"{p_rmse:.4f}"
            phys_rmse_str = f"{ph_rmse:.4f}"
            imp_pers_str = f"{imp_pers:+6.2f}%"
            imp_phys_str = f"{imp_phys:+6.2f}%"

        slice_results[regime_name] = {
            "sample_count": count,
            "model_mae": m_model["mae"],
            "model_rmse": m_model["rmse"],
            "model_r2": m_model["r2"],
            "persistence_mae": m_pers["mae"],
            "persistence_rmse": m_pers["rmse"],
            "persistence_r2": m_pers["r2"],
            "physics_mae": m_phys["mae"],
            "physics_rmse": m_phys["rmse"],
            "physics_r2": m_phys["r2"],
            "improvement_vs_persistence_pct": imp_pers,
            "improvement_vs_physics_pct": imp_phys,
        }

        print(f"{regime_name:28s} | {str(count):7s} | {m_rmse_str:10s} | {pers_rmse_str:10s} | {phys_rmse_str:10s} | {imp_pers_str:10s} | {imp_phys_str:10s}")

    print("-" * 95)

    # 4. Systematic Bias Diagnostics
    residuals = y_pred - y_true
    rain_mask = masks["rain_events"]
    dry_mask = masks["dry_periods"]
    fc_mask = np.abs(test_df["soil_moisture_pct"] - FIELD_CAPACITY_PCT) <= 2.0
    irr_mask = masks["irrigation_events"]

    bias_rain = float(np.mean(residuals[rain_mask])) if rain_mask.sum() > 0 else 0.0
    bias_dry = float(np.mean(residuals[dry_mask])) if dry_mask.sum() > 0 else 0.0
    bias_fc = float(np.mean(residuals[fc_mask])) if fc_mask.sum() > 0 else 0.0
    bias_irr = float(np.mean(residuals[irr_mask])) if irr_mask.sum() > 0 else 0.0

    print("\n--- SYSTEMATIC BIAS DIAGNOSTICS ---")
    print(f"Mean Residual across Rain Events (underprediction check): {bias_rain:+.4f}% (negative = underpredicts recharge)")
    print(f"Mean Residual across Dry-Down Periods (overprediction check): {bias_dry:+.4f}% (positive = underpredicts drying)")
    print(f"Mean Residual near Field Capacity (35% boundary):          {bias_fc:+.4f}%")
    print(f"Mean Residual during Irrigation Events (lag check):        {bias_irr:+.4f}%")

    bias_diagnostics = {
        "mean_residual_rain_events": round(bias_rain, 4),
        "mean_residual_dry_periods": round(bias_dry, 4),
        "mean_residual_near_field_capacity": round(bias_fc, 4),
        "mean_residual_irrigation_events": round(bias_irr, 4),
        "underpredicts_recharge": bool(bias_rain < -0.3),
        "overpredicts_drying": bool(bias_dry < -0.3),
        "fails_near_field_capacity": bool(abs(bias_fc) > 1.0),
        "lags_irrigation_response": bool(bias_irr < -0.5),
    }

    # 5. Success Criteria Evaluation
    overall_m = slice_results["overall_test_set"]
    primary_pass = (overall_m["improvement_vs_persistence_pct"] > 0)
    dry_pass = (slice_results["dry_periods"]["improvement_vs_persistence_pct"] > 0)
    rain_pass = (slice_results["rain_events"]["improvement_vs_persistence_pct"] > 0)
    irr_pass = (slice_results["irrigation_events"]["improvement_vs_persistence_pct"] > 0)

    secondary_pass = dry_pass and rain_pass and irr_pass

    if primary_pass and secondary_pass:
        integration_readiness = "READY FOR DEVELOPMENT INTEGRATION"
    else:
        integration_readiness = "MODEL NOT READY FOR INTEGRATION"

    print("\n" + "=" * 80)
    print(f"PRIMARY SUCCESS CRITERION (Beat Persistence Overall): {'PASSED' if primary_pass else 'FAILED'}")
    print(f"  Overall Improvement vs Persistence: {overall_m['improvement_vs_persistence_pct']:+6.2f}%")
    print(f"SECONDARY SUCCESS CRITERIA:")
    print(f"  Dry-down vs Persistence:    {slice_results['dry_periods']['improvement_vs_persistence_pct']:+6.2f}% ({'PASSED' if dry_pass else 'FAILED'})")
    print(f"  Rain-event vs Persistence:  {slice_results['rain_events']['improvement_vs_persistence_pct']:+6.2f}% ({'PASSED' if rain_pass else 'FAILED'})")
    print(f"  Irrigation vs Persistence:  {slice_results['irrigation_events']['improvement_vs_persistence_pct']:+6.2f}% ({'PASSED' if irr_pass else 'FAILED'})")
    print(f"PHYSICS BASELINE COMPARISON:")
    print(f"  Overall Improvement vs Physics: {overall_m['improvement_vs_physics_pct']:+6.2f}%")
    print(f"INTEGRATION READINESS: {integration_readiness}")
    print("=" * 80)

    # 6. Generate Publication-Quality Visualizations
    generate_v2_plots(test_df, y_true, y_pred, y_pers, y_phys, residuals, results_dir)

    # 7. Write Evaluation Report JSON
    report = {
        "experiment_version": "V2",
        "selected_candidate": model_name,
        "model_type": model_type,
        "integration_readiness": integration_readiness,
        "primary_criterion_passed": bool(primary_pass),
        "secondary_criteria_passed": bool(secondary_pass),
        "overall_test_samples": len(test_df),
        "slice_metrics": slice_results,
        "systematic_bias_diagnostics": bias_diagnostics,
    }

    report_path = results_dir / "evaluation_report_v2.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\nEvaluation report preserved -> {report_path}")
    return report


def generate_v2_plots(
    test_df: pd.DataFrame,
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_pers: np.ndarray,
    y_phys: np.ndarray,
    residuals: np.ndarray,
    results_dir: Path,
):
    """Generates the 6 required error analysis figures."""
    print("Generating diagnostic figures...")

    # Plot 1: residual_vs_moisture.png
    fig, ax = plt.subplots(figsize=(8, 5), dpi=300)
    sc = ax.scatter(test_df["soil_moisture_pct"], residuals, alpha=0.4, color="#0284c7", s=20, label="Test Residuals")
    ax.axhline(0, color="#ef4444", linestyle="--", linewidth=1.5, label="Zero Error Line")
    ax.axvline(WILTING_POINT_PCT, color="#d97706", linestyle=":", label="Wilting Point (12%)")
    ax.axvline(FIELD_CAPACITY_PCT, color="#10b981", linestyle=":", label="Field Capacity (35%)")
    ax.axvline(SATURATION_PCT, color="#6366f1", linestyle=":", label="Saturation (48%)")
    ax.set_xlabel("Observed Soil Moisture (%) at time t", fontsize=11, fontweight="bold")
    ax.set_ylabel("Prediction Residual: (y_pred - y_true) (%)", fontsize=11, fontweight="bold")
    ax.set_title("KRISHI SETU V2: Residual vs Soil Moisture", fontsize=12, fontweight="bold")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="upper right", framealpha=0.9)
    fig.tight_layout()
    fig.savefig(results_dir / "residual_vs_moisture.png")
    plt.close(fig)

    # Plot 2: residual_vs_rain.png
    fig, ax = plt.subplots(figsize=(8, 5), dpi=300)
    ax.scatter(test_df["forecast_rain_next_3h_mm"], residuals, alpha=0.5, color="#10b981", s=22, label="Residual vs 3h Forecast Rain")
    ax.axhline(0, color="#ef4444", linestyle="--", linewidth=1.5, label="Zero Error Line")
    ax.set_xlabel("Forecast Rain Next 3h (mm)", fontsize=11, fontweight="bold")
    ax.set_ylabel("Prediction Residual: (y_pred - y_true) (%)", fontsize=11, fontweight="bold")
    ax.set_title("KRISHI SETU V2: Residual vs Forecast Rain", fontsize=12, fontweight="bold")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="upper right", framealpha=0.9)
    fig.tight_layout()
    fig.savefig(results_dir / "residual_vs_rain.png")
    plt.close(fig)

    # Plot 3: residual_vs_et0.png
    fig, ax = plt.subplots(figsize=(8, 5), dpi=300)
    ax.scatter(test_df["et0_mm_day"], residuals, alpha=0.45, color="#f59e0b", s=20, label="Residual vs Daily ET0")
    ax.axhline(0, color="#ef4444", linestyle="--", linewidth=1.5, label="Zero Error Line")
    ax.axvline(5.0, color="#b45309", linestyle=":", label="High ET0 Threshold (5 mm/d)")
    ax.set_xlabel("FAO-56 Reference Evapotranspiration ET0 (mm/day)", fontsize=11, fontweight="bold")
    ax.set_ylabel("Prediction Residual: (y_pred - y_true) (%)", fontsize=11, fontweight="bold")
    ax.set_title("KRISHI SETU V2: Residual vs Atmospheric Evaporative Demand (ET0)", fontsize=12, fontweight="bold")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="upper right", framealpha=0.9)
    fig.tight_layout()
    fig.savefig(results_dir / "residual_vs_et0.png")
    plt.close(fig)

    # Plot 4: rain_event_zoom.png (Zoom in on a 72-hour period containing heavy rain)
    rainy_indices = test_df.index[test_df["observed_rain_mm"] > 5.0].tolist()
    center_idx = rainy_indices[len(rainy_indices) // 2] if rainy_indices else 100
    start_idx = max(0, center_idx - 36)
    end_idx = min(len(test_df), start_idx + 72)
    zoom_rain = test_df.iloc[start_idx:end_idx].copy().reset_index(drop=True)

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), sharex=True, gridspec_kw={"height_ratios": [2.5, 1]}, dpi=300)
    ax1.plot(zoom_rain.index, zoom_rain[TARGET_COLUMN], label="Actual Moisture (t+3h)", color="#0f172a", linewidth=2.0)
    ax1.plot(zoom_rain.index, y_pred[start_idx:end_idx], label="Model Prediction", color="#10b981", linewidth=2.0, linestyle="--")
    ax1.plot(zoom_rain.index, y_pers[start_idx:end_idx], label="Persistence Baseline", color="#94a3b8", linewidth=1.5, linestyle=":")
    ax1.plot(zoom_rain.index, y_phys[start_idx:end_idx], label="Physics Baseline", color="#3b82f6", linewidth=1.5, linestyle="-.")
    ax1.set_ylabel("Soil Moisture (%)", fontsize=10, fontweight="bold")
    ax1.set_title("KRISHI SETU V2: 72-Hour Rain Event Diagnostic Zoom", fontsize=12, fontweight="bold")
    ax1.grid(True, alpha=0.3)
    ax1.legend(loc="upper right", fontsize=9, framealpha=0.9)

    ax2.bar(zoom_rain.index, zoom_rain["observed_rain_mm"], color="#0284c7", width=0.8, label="Observed Rain (mm/h)")
    ax2.plot(zoom_rain.index, zoom_rain["forecast_rain_next_3h_mm"] / 3.0, color="#f59e0b", linewidth=1.5, label="Forecast Rate (mm/h)")
    ax2.set_xlabel("Relative Timeline (Hours)", fontsize=10, fontweight="bold")
    ax2.set_ylabel("Precip (mm)", fontsize=10, fontweight="bold")
    ax2.grid(True, alpha=0.3)
    ax2.legend(loc="upper right", fontsize=8, framealpha=0.9)
    fig.tight_layout()
    fig.savefig(results_dir / "rain_event_zoom.png")
    plt.close(fig)

    # Plot 5: irrigation_event_zoom.png (Zoom in on a 72-hour period containing irrigation events)
    irr_indices = test_df.index[test_df["irrigation_litres"] > 0].tolist()
    center_irr = irr_indices[len(irr_indices) // 2] if irr_indices else 50
    start_irr = max(0, center_irr - 24)
    end_irr = min(len(test_df), start_irr + 72)
    zoom_irr = test_df.iloc[start_irr:end_irr].copy().reset_index(drop=True)

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), sharex=True, gridspec_kw={"height_ratios": [2.5, 1]}, dpi=300)
    ax1.plot(zoom_irr.index, zoom_irr[TARGET_COLUMN], label="Actual Moisture (t+3h)", color="#0f172a", linewidth=2.0)
    ax1.plot(zoom_irr.index, y_pred[start_irr:end_irr], label="Model Prediction", color="#10b981", linewidth=2.0, linestyle="--")
    ax1.plot(zoom_irr.index, y_pers[start_irr:end_irr], label="Persistence Baseline", color="#94a3b8", linewidth=1.5, linestyle=":")
    ax1.plot(zoom_irr.index, y_phys[start_irr:end_irr], label="Physics Baseline", color="#3b82f6", linewidth=1.5, linestyle="-.")
    ax1.set_ylabel("Soil Moisture (%)", fontsize=10, fontweight="bold")
    ax1.set_title("KRISHI SETU V2: 72-Hour Irrigation Event Diagnostic Zoom", fontsize=12, fontweight="bold")
    ax1.grid(True, alpha=0.3)
    ax1.legend(loc="lower right", fontsize=9, framealpha=0.9)

    ax2.bar(zoom_irr.index, zoom_irr["irrigation_litres"], color="#16a34a", width=0.8, label="Irrigation (Litres)")
    ax2.set_xlabel("Relative Timeline (Hours)", fontsize=10, fontweight="bold")
    ax2.set_ylabel("Volume (L)", fontsize=10, fontweight="bold")
    ax2.grid(True, alpha=0.3)
    ax2.legend(loc="upper right", fontsize=8, framealpha=0.9)
    fig.tight_layout()
    fig.savefig(results_dir / "irrigation_event_zoom.png")
    plt.close(fig)

    # Plot 6: drydown_event_zoom.png (Zoom in on a 120-hour extended dry-down event)
    # Find a 120-hour window with zero rain
    rolling_rain = test_df["observed_rain_mm"].rolling(120).sum()
    zero_rain_windows = test_df.index[rolling_rain == 0].tolist()
    if zero_rain_windows:
        end_dry = zero_rain_windows[len(zero_rain_windows) // 2]
        start_dry = end_dry - 120
    else:
        start_dry, end_dry = 0, 120
    zoom_dry = test_df.iloc[start_dry:end_dry].copy().reset_index(drop=True)

    fig, ax = plt.subplots(figsize=(10, 5), dpi=300)
    ax.plot(zoom_dry.index, zoom_dry[TARGET_COLUMN], label="Actual Moisture (t+3h)", color="#0f172a", linewidth=2.0)
    ax.plot(zoom_dry.index, y_pred[start_dry:end_dry], label="Model Prediction", color="#10b981", linewidth=2.0, linestyle="--")
    ax.plot(zoom_dry.index, y_pers[start_dry:end_dry], label="Persistence Baseline", color="#94a3b8", linewidth=1.5, linestyle=":")
    ax.plot(zoom_dry.index, y_phys[start_dry:end_dry], label="Physics Baseline", color="#3b82f6", linewidth=1.5, linestyle="-.")
    ax.axhline(FIELD_CAPACITY_PCT, color="#10b981", linestyle=":", label="Field Capacity (35%)")
    ax.axhline(WILTING_POINT_PCT, color="#ef4444", linestyle=":", label="Wilting Point (12%)")
    ax.set_xlabel("Timeline (Hours of Continuous Dry-Down)", fontsize=10, fontweight="bold")
    ax.set_ylabel("Soil Moisture (%)", fontsize=10, fontweight="bold")
    ax.set_title("KRISHI SETU V2: 120-Hour Continuous Dry-Down Diagnostic Zoom", fontsize=12, fontweight="bold")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="upper right", fontsize=9, framealpha=0.9)
    fig.tight_layout()
    fig.savefig(results_dir / "drydown_event_zoom.png")
    plt.close(fig)

    print("All 6 diagnostic figures successfully generated in ml/results/v2/.")


def main():
    evaluate_v2_pipeline()


if __name__ == "__main__":
    main()
