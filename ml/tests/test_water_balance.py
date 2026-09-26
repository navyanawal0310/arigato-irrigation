"""
Unit Tests for Soil-Water Balance Physical Baseline Engine
=========================================================
Verifies adherence to hydrological and thermodynamic conservation laws:
1. Rain non-negativity: Rainfall cannot reduce soil water depth.
2. Irrigation positivity: Applied water increases soil water when below saturation.
3. Evapotranspiration depletion: In absence of recharge, ET monotonically decreases soil water.
4. Physical boundary adherence: Moisture is strictly bounded [WP_min, SAT].
5. Gravitational drainage: Excess water above field capacity percolates.
"""

import unittest
from ml.config import (
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
)
from ml.src.soil_water_balance import SoilWaterBalance


class TestSoilWaterBalancePhysics(unittest.TestCase):
    def setUp(self):
        self.model = SoilWaterBalance()

    def test_rain_cannot_decrease_water(self):
        """Rainfall must never decrease soil water depth compared to zero rain under identical conditions."""
        initial_m = 25.0
        # Step with zero rain
        res_no_rain = self.model.step(
            current_moisture_pct=initial_m,
            rainfall_mm=0.0,
            irrigation_litres=0.0,
            et0_mm_day=4.0,
            kc_factor=1.0,
            hour=12,
        )
        # Step with 15 mm rain
        res_with_rain = self.model.step(
            current_moisture_pct=initial_m,
            rainfall_mm=15.0,
            irrigation_litres=0.0,
            et0_mm_day=4.0,
            kc_factor=1.0,
            hour=12,
        )
        self.assertGreater(
            res_with_rain["next_moisture_pct"],
            res_no_rain["next_moisture_pct"],
            "Rainfall must strictly increase soil moisture compared to a dry step."
        )

    def test_irrigation_increases_available_water(self):
        """Irrigation must increase soil moisture when below field capacity."""
        initial_m = 22.0
        res_no_irr = self.model.step(
            current_moisture_pct=initial_m,
            rainfall_mm=0.0,
            irrigation_litres=0.0,
            et0_mm_day=4.0,
            kc_factor=0.85,
            hour=12,
        )
        res_with_irr = self.model.step(
            current_moisture_pct=initial_m,
            rainfall_mm=0.0,
            irrigation_litres=50.0,
            et0_mm_day=4.0,
            kc_factor=0.85,
            hour=12,
        )
        self.assertGreater(
            res_with_irr["next_moisture_pct"],
            res_no_irr["next_moisture_pct"],
            "Applied irrigation must increase root-zone moisture."
        )

    def test_et_reduces_water_without_recharge(self):
        """Evapotranspiration demand must monotonically reduce water when no rain or irrigation occurs."""
        initial_m = 30.0
        res = self.model.step(
            current_moisture_pct=initial_m,
            rainfall_mm=0.0,
            irrigation_litres=0.0,
            et0_mm_day=5.0,
            kc_factor=1.0,
            hour=13,  # Mid-day peak solar ET
        )
        self.assertLess(
            res["next_moisture_pct"],
            initial_m,
            "Atmospheric ET demand must reduce root-zone moisture in the absence of recharge."
        )
        self.assertGreater(
            res["actual_et_mm"],
            0.0,
            "Actual ET must be strictly positive under mid-day solar conditions."
        )

    def test_physical_boundaries(self):
        """Soil moisture must never exceed saturation or drop below minimum physical hygroscopic limit."""
        # 1. Extreme inundation test (100 mm rain)
        res_flood = self.model.step(
            current_moisture_pct=45.0,
            rainfall_mm=100.0,
            irrigation_litres=500.0,
            et0_mm_day=0.0,
            kc_factor=0.5,
            hour=12,
        )
        self.assertLessEqual(
            res_flood["next_moisture_pct"],
            SATURATION_PCT,
            f"Soil moisture cannot exceed saturation ({SATURATION_PCT}%)."
        )
        self.assertGreater(
            res_flood["runoff_mm"],
            0.0,
            "Excess flood water beyond pore capacity must be converted to surface runoff."
        )

        # 2. Extreme desiccation test (no rain, high ET)
        m = 15.0
        for _ in range(50):
            res_dry = self.model.step(
                current_moisture_pct=m,
                rainfall_mm=0.0,
                irrigation_litres=0.0,
                et0_mm_day=9.0,
                kc_factor=1.2,
                hour=14,
            )
            m = res_dry["next_moisture_pct"]

        min_limit = WILTING_POINT_PCT * 0.7
        self.assertGreaterEqual(
            m,
            min_limit,
            f"Soil moisture cannot desiccate below minimum physical hygroscopic limit ({min_limit}%)."
        )

    def test_drainage_occurs_above_field_capacity(self):
        """Gravitational drainage must trigger when water content exceeds field capacity."""
        # Above field capacity
        res_wet = self.model.step(
            current_moisture_pct=FIELD_CAPACITY_PCT + 5.0,
            rainfall_mm=0.0,
            irrigation_litres=0.0,
            et0_mm_day=1.0,
            kc_factor=0.5,
            hour=2,  # Night step to minimize ET influence
        )
        self.assertGreater(
            res_wet["drainage_mm"],
            0.0,
            "Deep percolation drainage must occur when moisture exceeds field capacity."
        )

        # Below field capacity
        res_dry = self.model.step(
            current_moisture_pct=FIELD_CAPACITY_PCT - 5.0,
            rainfall_mm=0.0,
            irrigation_litres=0.0,
            et0_mm_day=1.0,
            kc_factor=0.5,
            hour=2,
        )
        self.assertEqual(
            res_dry["drainage_mm"],
            0.0,
            "Deep percolation drainage should be zero when moisture is below field capacity."
        )


if __name__ == "__main__":
    unittest.main()
