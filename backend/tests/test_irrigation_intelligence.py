"""
Unit & Integration Tests: Irrigation Intelligence Engine (Phase 5)
==================================================================
Tests:
1. Scenario 1: Dry soil + predicted dry-down + no rain + safety OK -> IRRIGATE
2. Scenario 2: Dry soil + predicted dry-down + useful rain expected -> HOLD
3. Scenario 3: Adequate soil moisture + safety OK -> HOLD
4. Scenario 4: Irrigation needed + reservoir fault -> LOCKOUT (Safety override)
5. ML predicts dry-down + no rain strengthens irrigation recommendation
6. ML unavailable fallback -> deterministic agronomic MAD logic active (ml.used=False)
7. Soil sensor fault -> safe handling (LOCKOUT, safety override)
8. Reservoir sensor fault -> LOCKOUT (safety override)
9. Critical reservoir depletion (<= 15%) -> LOCKOUT
10. Simulated frontend reservoir (64%) isolation -> backend uses raw telemetry (OUT_OF_RANGE -> LOCKOUT)
11. Rain forecast cannot be treated as observed rainfall (forecast rain does not trigger active rain hold)
12. Safety override always wins over favorable ML prediction
13. Decision trace and audit record validation
"""

import unittest
from datetime import datetime, timezone
from backend.app.irrigation_intelligence import (
    IrrigationIntelligenceService,
    calculate_stress_threshold,
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    DEFAULT_MAD_PCT,
    USEFUL_RAIN_THRESHOLD_MM,
    CRITICAL_TANK_PCT,
)


class TestIrrigationIntelligence(unittest.TestCase):

    def setUp(self):
        self.service = IrrigationIntelligenceService()
        self.base_time = datetime(2026, 9, 26, 12, 0, 0, tzinfo=timezone.utc)

    # -------------------------------------------------------------
    # 1. ACCEPTANCE SCENARIO 1: Dry soil + Dry-down + No Rain -> IRRIGATE
    # -------------------------------------------------------------
    def test_scenario_1_dry_soil_no_rain_irrigate(self):
        """Scenario 1: Dry soil, predicted dry-down, no rain, safety OK -> IRRIGATE"""
        res = self.service.get_recommendation(scenario="dry_no_rain")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["directive"], "IRRIGATE")
        self.assertFalse(res["safety"]["override"])
        self.assertTrue(res["ml"]["used"])
        self.assertLessEqual(res["ml"]["predicted_soil_moisture_pct"], 23.5)
        self.assertIn("IRRIGATE", res["directive"])
        self.assertTrue(any(f["name"] == "Current Soil Moisture" and f["effect"] == "supports_irrigation" for f in res["factors"]))
        self.assertTrue(len(res["decision_trace"]) >= 6)

    # -------------------------------------------------------------
    # 2. ACCEPTANCE SCENARIO 2: Dry soil + Dry-down + Rain Expected -> HOLD
    # -------------------------------------------------------------
    def test_scenario_2_dry_soil_rain_expected_hold(self):
        """Scenario 2: Dry soil, predicted dry-down, useful rain expected -> HOLD"""
        res = self.service.get_recommendation(scenario="dry_rain_expected")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["directive"], "HOLD")
        self.assertFalse(res["safety"]["override"])
        self.assertIn("Rain Expected", res["headline"])
        self.assertGreaterEqual(res["weather"]["forecast_rain_next_3h_mm"], USEFUL_RAIN_THRESHOLD_MM)
        # Verify factor for forecast rain
        forecast_factors = [f for f in res["factors"] if "Forecast Rainfall" in f["name"]]
        self.assertEqual(len(forecast_factors), 1)
        self.assertEqual(forecast_factors[0]["effect"], "supports_holding")
        self.assertEqual(forecast_factors[0]["provenance"], "WEATHER FORECAST")

    # -------------------------------------------------------------
    # 3. ACCEPTANCE SCENARIO 3: Adequate moisture -> HOLD
    # -------------------------------------------------------------
    def test_scenario_3_adequate_moisture_hold(self):
        """Scenario 3: Adequate soil moisture, safety OK -> HOLD"""
        res = self.service.get_recommendation(scenario="adequate_moisture")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["directive"], "HOLD")
        self.assertFalse(res["safety"]["override"])
        self.assertIn("Soil Moisture Optimal", res["headline"])
        # Current moisture is 32.0% > 23.5%
        self.assertGreater(res["ml"]["current_soil_moisture_pct"], 23.5)

    # -------------------------------------------------------------
    # 4. ACCEPTANCE SCENARIO 4: Irrigation needed + Reservoir Fault -> LOCKOUT
    # -------------------------------------------------------------
    def test_scenario_4_reservoir_fault_lockout(self):
        """Scenario 4: Irrigation otherwise needed, but reservoir sensor invalid -> LOCKOUT"""
        res = self.service.get_recommendation(scenario="safety_lockout")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["directive"], "LOCKOUT")
        self.assertTrue(res["safety"]["override"])
        self.assertEqual(res["safety"]["reason"], "RESERVOIR_SENSOR_FAULT")
        self.assertIn("Safety Lockout", res["headline"])
        # Safety factor must be present with effect safety_override
        safety_factors = [f for f in res["factors"] if f["effect"] == "safety_override"]
        self.assertTrue(len(safety_factors) >= 1)

    # -------------------------------------------------------------
    # 5. ML predicts dry-down + no rain strengthens irrigation recommendation
    # -------------------------------------------------------------
    def test_ml_drydown_strengthens_recommendation(self):
        """When current soil is borderline (23.4%) and ML predicts dry-down to 20.0%, IRRIGATE is triggered."""
        doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "HEALTHY", "raw_adc": 2300, "moisture_pct": 23.4},
            "reservoir": {"status": "HEALTHY", "level_pct": 60.0},
            "rain_sensor": {"is_raining": False, "surface_wetness_pct": 0.0},
            "atmosphere": {"temp_c": 30.0, "humidity_pct": 40.0, "et0_fao56_mm": 5.0, "forecast_rain_next_3h_mm": 0.0},
            "crop": {"profile_id": "TOMATO_VEG", "kc_factor": 0.85, "mad_threshold_pct": 50},
            "quality": {"soil_valid": True, "reservoir_valid": True},
        }
        ml_pred = {
            "status": "ok",
            "current_soil_moisture_pct": 23.4,
            "predicted_soil_moisture_pct": 20.0,
            "change_pct_points": -3.4,
        }
        res = self.service._evaluate(doc, ml_pred=ml_pred, scenario_name="test")
        self.assertEqual(res["directive"], "IRRIGATE")
        self.assertIn("Active Deficit & Dry-Down", res["headline"])
        self.assertTrue(res["ml"]["used"])

    # -------------------------------------------------------------
    # 6. ML unavailable -> deterministic fallback
    # -------------------------------------------------------------
    def test_ml_unavailable_deterministic_fallback(self):
        """When ML prediction fails (e.g. warming_up / INSUFFICIENT_HISTORY), fallback to deterministic MAD logic."""
        doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "HEALTHY", "raw_adc": 2600, "moisture_pct": 18.0},
            "reservoir": {"status": "HEALTHY", "level_pct": 60.0},
            "rain_sensor": {"is_raining": False, "surface_wetness_pct": 0.0},
            "atmosphere": {"temp_c": 28.0, "humidity_pct": 50.0, "et0_fao56_mm": 4.5, "forecast_rain_next_3h_mm": 0.0},
            "crop": {"profile_id": "TOMATO_VEG", "kc_factor": 0.85, "mad_threshold_pct": 50},
            "quality": {"soil_valid": True, "reservoir_valid": True},
        }
        ml_pred = {
            "status": "warming_up",
            "reason": "INSUFFICIENT_HISTORY",
            "message": "Only 2.5 hours of telemetry available; 6.0h required.",
        }
        res = self.service._evaluate(doc, ml_pred=ml_pred, scenario_name="test")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["directive"], "IRRIGATE")
        self.assertFalse(res["ml"]["used"])
        self.assertEqual(res["ml"]["reason"], "INSUFFICIENT_HISTORY")
        self.assertIn("Deterministic agronomic fallback active", res["decision_trace"][1])

    # -------------------------------------------------------------
    # 7. Soil sensor fault -> safe handling (LOCKOUT)
    # -------------------------------------------------------------
    def test_soil_sensor_fault_triggers_lockout(self):
        """If soil probe is in FAULT, directive must be LOCKOUT regardless of weather or ML."""
        doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "FAULT", "raw_adc": 254, "moisture_pct": 0.0},
            "reservoir": {"status": "HEALTHY", "level_pct": 60.0},
            "rain_sensor": {"is_raining": False, "surface_wetness_pct": 0.0},
            "atmosphere": {"temp_c": 28.0, "humidity_pct": 50.0, "et0_fao56_mm": 4.5, "forecast_rain_next_3h_mm": 0.0},
            "crop": {"profile_id": "TOMATO_VEG", "kc_factor": 0.85, "mad_threshold_pct": 50},
            "quality": {"soil_valid": False, "reservoir_valid": True},
        }
        res = self.service._evaluate(doc, ml_pred=None, scenario_name="test")
        self.assertEqual(res["directive"], "LOCKOUT")
        self.assertTrue(res["safety"]["override"])
        self.assertEqual(res["safety"]["reason"], "SOIL_SENSOR_FAULT")

    # -------------------------------------------------------------
    # 8. Critical reservoir depletion (<= 15%) -> LOCKOUT
    # -------------------------------------------------------------
    def test_reservoir_depleted_lockout(self):
        """Reservoir level at 12% (< 15% critical threshold) must trigger LOCKOUT."""
        doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "HEALTHY", "raw_adc": 2700, "moisture_pct": 16.0},
            "reservoir": {"status": "HEALTHY", "level_pct": 12.0},
            "rain_sensor": {"is_raining": False, "surface_wetness_pct": 0.0},
            "atmosphere": {"temp_c": 28.0, "humidity_pct": 50.0, "et0_fao56_mm": 4.5, "forecast_rain_next_3h_mm": 0.0},
            "crop": {"profile_id": "TOMATO_VEG", "kc_factor": 0.85, "mad_threshold_pct": 50},
            "quality": {"soil_valid": True, "reservoir_valid": True},
        }
        res = self.service._evaluate(doc, ml_pred=None, scenario_name="test")
        self.assertEqual(res["directive"], "LOCKOUT")
        self.assertTrue(res["safety"]["override"])
        self.assertEqual(res["safety"]["reason"], "RESERVOIR_DEPLETED")

    # -------------------------------------------------------------
    # 9. Simulated frontend reservoir 64% isolation
    # -------------------------------------------------------------
    def test_frontend_simulated_64_percent_cannot_enter_backend(self):
        """
        The real hardware currently returns reservoir level -1 with status OUT_OF_RANGE.
        The backend engine must evaluate this as OUT_OF_RANGE -> LOCKOUT, and NEVER adopt 64%.
        """
        # Exact real hardware document format from MongoDB
        real_hw_doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "FAULT", "raw_adc": 254, "moisture_pct": 0.0},
            "reservoir": {"status": "OUT_OF_RANGE", "level_pct": -1.0, "storage_litres": 0.0},
            "rain_sensor": {"is_raining": False, "surface_wetness_pct": 0.0},
            "atmosphere": {"temp_c": 24.5, "humidity_pct": 65.0, "et0_fao56_mm": 4.1, "forecast_rain_next_3h_mm": 0.0},
            "quality": {"soil_valid": False, "reservoir_valid": False},
        }
        res = self.service._evaluate(real_hw_doc, ml_pred=None, scenario_name="live")
        self.assertEqual(res["directive"], "LOCKOUT")
        self.assertTrue(res["safety"]["override"])
        self.assertFalse(res["safety"]["reservoir_valid"])
        # Ensure level in audit is -1.0 or not 64.0
        self.assertEqual(res["audit"]["inputs_used"]["reservoir_level_pct"], -1.0)

    # -------------------------------------------------------------
    # 10. Rain forecast cannot be treated as observed rainfall
    # -------------------------------------------------------------
    def test_rain_forecast_distinguished_from_observed_rain(self):
        """
        Forecast rain (e.g. 5.0 mm) influences recommendation (HOLD for rain avoidance),
        but is NOT represented as active rain or observed rain.
        """
        doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "HEALTHY", "raw_adc": 2500, "moisture_pct": 19.0},
            "reservoir": {"status": "HEALTHY", "level_pct": 75.0},
            "rain_sensor": {"is_raining": False, "surface_wetness_pct": 0.0},  # Dry sensor plate
            "atmosphere": {"temp_c": 25.0, "humidity_pct": 70.0, "et0_fao56_mm": 4.0, "forecast_rain_next_3h_mm": 5.0},
            "crop": {"profile_id": "TOMATO_VEG", "kc_factor": 0.85, "mad_threshold_pct": 50},
            "quality": {"soil_valid": True, "reservoir_valid": True},
        }
        res = self.service._evaluate(doc, ml_pred=None, scenario_name="test")
        self.assertEqual(res["directive"], "HOLD")
        self.assertIn("Rain Expected — Irrigation Deferred", res["headline"])
        # Verify trace distinguishes forecast from active sensor
        self.assertIn("Weather avoidance evaluated", res["decision_trace"][4])
        self.assertNotIn("Active Precipitation Detected", res["headline"])

    # -------------------------------------------------------------
    # 11. Safety override always wins over favorable ML prediction
    # -------------------------------------------------------------
    def test_safety_override_always_wins_over_ml(self):
        """Even if ML predicts severe dry-down (e.g. 10.0%), a safety fault MUST cause LOCKOUT."""
        doc = {
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": self.base_time,
            "soil": {"status": "FAULT", "raw_adc": 254, "moisture_pct": 0.0},
            "reservoir": {"status": "HEALTHY", "level_pct": 80.0},
            "rain_sensor": {"is_raining": False, "surface_wetness_pct": 0.0},
            "atmosphere": {"temp_c": 35.0, "humidity_pct": 20.0, "et0_fao56_mm": 7.5, "forecast_rain_next_3h_mm": 0.0},
            "crop": {"profile_id": "TOMATO_VEG", "kc_factor": 0.85, "mad_threshold_pct": 50},
            "quality": {"soil_valid": False, "reservoir_valid": True},
        }
        favorable_ml = {
            "status": "ok",
            "current_soil_moisture_pct": 12.0,
            "predicted_soil_moisture_pct": 8.5,
            "change_pct_points": -3.5,
        }
        res = self.service._evaluate(doc, ml_pred=favorable_ml, scenario_name="test")
        self.assertEqual(res["directive"], "LOCKOUT")
        self.assertTrue(res["safety"]["override"])
        self.assertEqual(res["safety"]["reason"], "SOIL_SENSOR_FAULT")

    # -------------------------------------------------------------
    # 12. Audit record schema completeness (Phase 6 readiness)
    # -------------------------------------------------------------
    def test_audit_record_completeness(self):
        """Verifies that audit dictionary contains all required fields for Phase 6 persistence."""
        res = self.service.get_recommendation(scenario="dry_no_rain")
        audit = res.get("audit")
        self.assertIsNotNone(audit)
        for key in ["timestamp", "device_id", "scenario", "directive", "safety_override", "model_version", "inputs_used"]:
            self.assertIn(key, audit)


if __name__ == "__main__":
    unittest.main()
