"""
KRISHI SETU Soil-Water Balance Physical Baseline Engine
======================================================
Implements a 1D physically constrained root-zone bucket model based on the
FAO-56 Irrigation and Drainage Paper (Allen et al., 1998).

Water Balance Equation:
    W_{t+1} = W_t + P_{eff} + I_{eff} - ET_a - D

Where:
    W_t      = Root-zone stored water depth (mm)
    P_{eff}  = Effective precipitation infiltrating the soil profile (mm)
    I_{eff}  = Effective irrigation reaching the active root-zone (mm)
    ET_a     = Actual crop evapotranspiration (mm) adjusted for water stress Ks
    D        = Deep percolation / gravitational drainage (mm)

Assumptions:
    1. Single uniform root zone layer of depth Z_r (default 400 mm).
    2. Zero lateral sub-surface flow (1D vertical hydraulic assumption).
    3. Runoff occurs when instantaneous precipitation exceeds infiltration capacity or saturation.
    4. Model parameters represent synthetic baseline physics and require in-situ calibration for real field use.
"""

from typing import Dict, Any, Optional
import numpy as np

from ml.config import (
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    ROOT_ZONE_DEPTH_MM,
    FIELD_AREA_M2,
    INFILTRATION_EFFICIENCY,
    IRRIGATION_EFFICIENCY,
    DRAINAGE_RATE_HOURLY,
)


class SoilWaterBalance:
    """
    Physically constrained root-zone water balance model.
    Tracks water state and updates root-zone moisture hourly.
    """

    def __init__(
        self,
        field_capacity_pct: float = FIELD_CAPACITY_PCT,
        wilting_point_pct: float = WILTING_POINT_PCT,
        saturation_pct: float = SATURATION_PCT,
        root_zone_depth_mm: float = ROOT_ZONE_DEPTH_MM,
        field_area_m2: float = FIELD_AREA_M2,
        infiltration_efficiency: float = INFILTRATION_EFFICIENCY,
        irrigation_efficiency: float = IRRIGATION_EFFICIENCY,
        drainage_rate: float = DRAINAGE_RATE_HOURLY,
    ):
        self.fc = float(field_capacity_pct)
        self.wp = float(wilting_point_pct)
        self.sat = float(saturation_pct)
        self.z_r = float(root_zone_depth_mm)
        self.area_m2 = float(field_area_m2)
        self.inf_eff = float(infiltration_efficiency)
        self.irr_eff = float(irrigation_efficiency)
        self.drainage_rate = float(drainage_rate)

        # Equivalent water depths (mm) in the root zone
        self.depth_wp = (self.wp / 100.0) * self.z_r
        self.depth_fc = (self.fc / 100.0) * self.z_r
        self.depth_sat = (self.sat / 100.0) * self.z_r

        # Total Available Water (TAW in mm)
        self.taw = self.depth_fc - self.depth_wp

    def moisture_to_depth(self, moisture_pct: float) -> float:
        """Converts volumetric moisture percentage to water depth in mm."""
        return (moisture_pct / 100.0) * self.z_r

    def depth_to_moisture(self, depth_mm: float) -> float:
        """Converts water depth in mm to volumetric moisture percentage."""
        return (depth_mm / self.z_r) * 100.0

    def compute_hourly_et0_fraction(self, hour: int) -> float:
        """
        Diurnal distribution of daily ET0.
        Solar radiation drives ~90% of evapotranspiration between 07:00 and 19:00.
        Returns the fraction of daily ET0 occurring in the specified hour.
        """
        if 7 <= hour <= 18:
            # Solar bell curve peaking at 13:00
            t = (hour - 6) / 12.0
            weight = np.sin(np.pi * t)
            # Normalize so 12 daytime hours sum to ~0.90
            return float(weight * (0.90 / 7.639))
        else:
            # Minor nocturnal evaporative demand (~10% across 12 hours)
            return float(0.10 / 12.0)

    def compute_water_stress_coefficient(self, moisture_pct: float, mad_threshold_pct: float) -> float:
        """
        Calculates FAO-56 water stress coefficient Ks (0.0 to 1.0).
        If soil water depletion is within MAD (Management Allowed Depletion), Ks = 1.0 (no stress).
        When moisture drops below the MAD threshold towards wilting point, Ks drops linearly to 0.0.
        """
        moisture_threshold = self.fc - (mad_threshold_pct / 100.0) * (self.fc - self.wp)
        if moisture_pct >= moisture_threshold:
            return 1.0
        elif moisture_pct <= self.wp:
            return 0.0
        else:
            return float((moisture_pct - self.wp) / max(0.001, (moisture_threshold - self.wp)))

    def step(
        self,
        current_moisture_pct: float,
        rainfall_mm: float,
        irrigation_litres: float,
        et0_mm_day: float,
        kc_factor: float,
        mad_threshold_pct: float = 50.0,
        hour: int = 12,
    ) -> Dict[str, Any]:
        """
        Advances the soil water balance by one hourly time step.

        Parameters:
            current_moisture_pct: Current root-zone moisture percentage at time t
            rainfall_mm: Precipitation during the hour (mm)
            irrigation_litres: Volume of irrigation water delivered during the hour (L)
            et0_mm_day: Daily reference evapotranspiration rate (mm/day)
            kc_factor: Crop coefficient (dimensionless)
            mad_threshold_pct: Maximum allowable depletion threshold (%)
            hour: Current hour of day [0, 23]

        Returns:
            Dictionary containing updated moisture and component hydraulic fluxes.
        """
        # Ensure input stays above minimum hygroscopic water
        current_depth = max(self.depth_wp * 0.7, self.moisture_to_depth(current_moisture_pct))

        # 1. Effective Precipitation (Infiltration)
        eff_rain_mm = max(0.0, rainfall_mm) * self.inf_eff

        # 2. Effective Irrigation
        # 1 Litre over 1 m^2 = 1.0 mm depth
        depth_irrigation_gross = (max(0.0, irrigation_litres) / self.area_m2)
        eff_irrigation_mm = depth_irrigation_gross * self.irr_eff

        # 3. Crop Evapotranspiration
        hourly_et0 = max(0.0, et0_mm_day) * self.compute_hourly_et0_fraction(hour)
        etc_potential = hourly_et0 * max(0.1, kc_factor)
        ks = self.compute_water_stress_coefficient(current_moisture_pct, mad_threshold_pct)
        eta = etc_potential * ks

        # Prevent ET from withdrawing more water than is physically available above wilting point
        available_above_min = max(0.0, current_depth - (self.depth_wp * 0.7))
        eta = min(eta, available_above_min)

        # 4. Preliminary Water Balance before Drainage
        water_depth_unbounded = current_depth + eff_rain_mm + eff_irrigation_mm - eta

        # 5. Drainage / Deep Percolation
        # Gravity drainage occurs primarily when soil water exceeds field capacity
        drainage_mm = 0.0
        if water_depth_unbounded > self.depth_fc:
            excess = water_depth_unbounded - self.depth_fc
            drainage_mm = excess * self.drainage_rate

        final_depth = water_depth_unbounded - drainage_mm

        # 6. Physical Bounds Clamping
        # Runoff: Any water exceeding saturation cannot be held in pore space
        runoff_mm = 0.0
        if final_depth > self.depth_sat:
            runoff_mm = final_depth - self.depth_sat
            final_depth = self.depth_sat

        # Lower bound: Soil does not dry below ~70% of permanent wilting point purely through atmospheric ET
        min_depth = self.depth_wp * 0.7
        final_depth = max(min_depth, final_depth)

        # Convert back to percentage
        next_moisture_pct = float(self.depth_to_moisture(final_depth))

        return {
            "next_moisture_pct": next_moisture_pct,
            "effective_rain_mm": float(eff_rain_mm),
            "effective_irrigation_mm": float(eff_irrigation_mm),
            "actual_et_mm": float(eta),
            "potential_et_mm": float(etc_potential),
            "drainage_mm": float(drainage_mm),
            "runoff_mm": float(runoff_mm),
            "stress_factor_ks": float(ks),
        }
