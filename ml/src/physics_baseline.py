"""
KRISHI SETU Physics-Informed Baseline & Hybrid Forecast Engine (V2)
==================================================================
Implements a 3-hour forward hydrological projection based on FAO-56 conservation of mass.
Used both as:
1. Baseline B (Physics-informed benchmark to beat).
2. The foundational prior for the Hybrid Physics + ML Residual model.
"""

from typing import Union
import numpy as np
import pandas as pd

from ml.config import (
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    ROOT_ZONE_DEPTH_MM,
    INFILTRATION_EFFICIENCY,
    DRAINAGE_RATE_HOURLY,
)


def compute_diurnal_et0_weight(hour: int) -> float:
    """Returns the expected fraction of daily ET0 for a single hour."""
    h = hour % 24
    if 7 <= h <= 18:
        t = (h - 6) / 12.0
        return float(np.sin(np.pi * t) * (0.90 / 7.639))
    else:
        return float(0.10 / 12.0)


def predict_physics_water_balance_3h(
    moisture_pct: Union[float, np.ndarray, pd.Series],
    forecast_rain_next_3h_mm: Union[float, np.ndarray, pd.Series],
    et0_mm_day: Union[float, np.ndarray, pd.Series],
    kc_factor: Union[float, np.ndarray, pd.Series],
    mad_threshold_pct: Union[float, np.ndarray, pd.Series] = 50.0,
    hour: Union[int, np.ndarray, pd.Series] = 12,
    root_zone_depth_mm: float = ROOT_ZONE_DEPTH_MM,
    field_capacity_pct: float = FIELD_CAPACITY_PCT,
    wilting_point_pct: float = WILTING_POINT_PCT,
    saturation_pct: float = SATURATION_PCT,
    infiltration_efficiency: float = INFILTRATION_EFFICIENCY,
    drainage_rate_hourly: float = DRAINAGE_RATE_HOURLY,
) -> np.ndarray:
    """
    Computes a 3-hour forward projection of root-zone soil moisture using FAO-56
    mass balance physics.

    Returns:
        Predicted soil moisture percentage at t+3 hours (numpy array).
    """
    is_scalar = (np.ndim(moisture_pct) == 0)
    m = np.atleast_1d(np.asarray(moisture_pct, dtype=float))
    rain = np.atleast_1d(np.asarray(forecast_rain_next_3h_mm, dtype=float))
    et0 = np.atleast_1d(np.asarray(et0_mm_day, dtype=float))
    kc = np.atleast_1d(np.asarray(kc_factor, dtype=float))
    mad = np.atleast_1d(np.asarray(mad_threshold_pct, dtype=float))
    h = np.atleast_1d(np.asarray(hour, dtype=int))

    # Convert initial moisture to water depth (mm)
    z_r = root_zone_depth_mm
    depth_wp = (wilting_point_pct / 100.0) * z_r
    depth_fc = (field_capacity_pct / 100.0) * z_r
    depth_sat = (saturation_pct / 100.0) * z_r
    min_depth = depth_wp * 0.7

    current_depth = np.maximum(min_depth, (m / 100.0) * z_r)

    # 1. Effective Precipitation over the next 3 hours
    eff_rain = np.maximum(0.0, rain) * infiltration_efficiency

    # 2. Cumulative 3-hour ET0 weight
    # Sum diurnal weights for hour h, h+1, h+2
    w_sum = np.zeros_like(h, dtype=float)
    for offset in range(3):
        # Vectorized lookup across hours
        h_offset = (h + offset) % 24
        weights = np.array([compute_diurnal_et0_weight(val) for val in h_offset])
        w_sum += weights

    # 3. Crop Evapotranspiration over 3 hours
    # Stress coefficient Ks
    thresh_moist = field_capacity_pct - (mad / 100.0) * (field_capacity_pct - wilting_point_pct)
    ks = np.where(
        m >= thresh_moist,
        1.0,
        np.where(
            m <= wilting_point_pct,
            0.0,
            np.clip((m - wilting_point_pct) / np.maximum(0.001, thresh_moist - wilting_point_pct), 0.0, 1.0)
        )
    )

    etc_3h = np.maximum(0.0, et0) * w_sum * np.maximum(0.1, kc) * ks

    # Limit ET to water available above hygroscopic minimum
    avail = np.maximum(0.0, current_depth - min_depth)
    actual_et_3h = np.minimum(etc_3h, avail)

    # 4. Preliminary depth before drainage
    intermediate_depth = current_depth + eff_rain - actual_et_3h

    # 5. Drainage over 3 hours (fraction draining per hour compounded over 3 hours)
    # Drain factor over 3 hours: 1 - (1 - rate)^3
    drain_factor_3h = 1.0 - ((1.0 - drainage_rate_hourly) ** 3)
    excess = np.maximum(0.0, intermediate_depth - depth_fc)
    drainage_3h = excess * drain_factor_3h

    final_depth = intermediate_depth - drainage_3h

    # 6. Physical boundaries (saturation runoff & minimum hygroscopic limit)
    final_depth = np.clip(final_depth, min_depth, depth_sat)

    pred_moist = (final_depth / z_r) * 100.0
    return np.asarray(np.round(pred_moist, 3))
