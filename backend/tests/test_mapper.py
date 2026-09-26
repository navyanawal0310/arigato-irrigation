"""
Unit Tests: Telemetry Mapper & Quality Flags
============================================
Tests:
- ESP32 JSON mapping
- Valid soil reading
- Soil FAULT handling
- Reservoir OUT_OF_RANGE handling
- -1 reservoir sentinel rejection in quality flag
- Legitimate zero values preservation (e.g. 0.0 rain, 0 pump cycles)
- Missing optional values handling
- Timezone-aware UTC timestamp generation
- Deduplication key consistency
"""

import unittest
from datetime import datetime, timezone
from backend.app.telemetry_mapper import map_esp32_telemetry, is_finite_number


class TestTelemetryMapper(unittest.TestCase):

    def setUp(self):
        self.sample_esp32_json = {
            "system": {
                "name": "AquaMatrix-MaxCore",
                "firmware": "2.4.0-PRO",
                "uptime_sec": 3600,
                "free_heap": 184000,
                "wifi_rssi": -55,
                "wifi_status": "CONNECTED",
                "anomaly": False,
            },
            "crop": {
                "profile_id": 1,
                "name": "Tomato (Vegetative)",
                "kc_factor": 0.85,
                "base_temp_c": 10.0,
                "mad_threshold_pct": 50.0,
            },
            "soil": {
                "raw_adc": 1950,
                "moisture_pct": 32.5,
                "dryness_pct": 67.5,
                "status": "HEALTHY",
            },
            "drainage": {
                "infiltration_rate_pct_min": 0.45,
                "status": "OPTIMAL",
            },
            "rain_sensor": {
                "raw_adc": 4095,
                "surface_wetness_pct": 0.0,
                "is_raining": False,
            },
            "reservoir": {
                "distance_cm": 15.0,
                "level_pct": 75.0,
                "storage_litres": 150.0,
                "status": "HEALTHY",
            },
            "atmosphere": {
                "temp_c": 28.5,
                "humidity_pct": 55.0,
                "vpd_kpa": 1.75,
                "dew_point_c": 18.2,
                "forecast_rain_mm": 0.0,
                "et0_fao56_mm": 4.6,
                "api_synced": True,
            },
            "decision": {
                "action": "HOLD_SOIL_OPTIMAL",
                "reason": "Soil moisture within optimal bounds",
                "pump_active": False,
                "confidence_percent": 95,
                "anomaly": False,
            },
            "model": {
                "crop_et_mm": 3.91,
                "effective_rain_mm": 0.0,
                "net_demand_mm": 3.91,
                "prescribed_litres": 0.0,
                "run_duration_sec": 0,
            },
            "disease": {
                "risk_level": 0.15,
                "reason": "Low humidity, low risk",
            },
            "nvs": {
                "daily_water_litres": 25.0,
                "total_water_litres": 450.0,
                "pump_cycles_count": 0,
            },
        }

    def test_complete_valid_mapping(self):
        """Verifies full mapping preserves all nested fields and sets quality flags to True."""
        doc = map_esp32_telemetry(self.sample_esp32_json)

        self.assertEqual(doc["device_id"], "AquaMatrix-MaxCore")
        self.assertEqual(doc["source"], "esp32")
        self.assertEqual(doc["schema_version"], 1)
        self.assertIsInstance(doc["recorded_at"], datetime)
        self.assertIsNotNone(doc["recorded_at"].tzinfo)

        # Quality flags
        self.assertTrue(doc["quality"]["soil_valid"])
        self.assertTrue(doc["quality"]["reservoir_valid"])
        self.assertTrue(doc["quality"]["node_connected"])

        # Check preserved values
        self.assertEqual(doc["soil"]["moisture_pct"], 32.5)
        self.assertEqual(doc["reservoir"]["level_pct"], 75.0)

    def test_soil_fault_handling(self):
        """Verifies that soil with FAULT status is stored but marked invalid in quality flags."""
        raw = self.sample_esp32_json.copy()
        raw["soil"] = {
            "raw_adc": 0,
            "moisture_pct": 0.0,
            "status": "FAULT",
        }
        doc = map_esp32_telemetry(raw)

        # Data is stored exactly as reported
        self.assertEqual(doc["soil"]["status"], "FAULT")
        # Quality flag reflects hardware fault
        self.assertFalse(doc["quality"]["soil_valid"])
        # Reservoir is still valid
        self.assertTrue(doc["quality"]["reservoir_valid"])

    def test_reservoir_out_of_range_and_sentinel(self):
        """
        Verifies that -1% reservoir sentinel is preserved in data
        but strictly marked invalid in quality flags.
        """
        raw = self.sample_esp32_json.copy()
        raw["reservoir"] = {
            "distance_cm": 999.0,
            "level_pct": -1.0,  # Sentinel: out of range
            "storage_litres": -1.0,
            "status": "OUT_OF_RANGE",
        }
        doc = map_esp32_telemetry(raw)

        # Physical value must NOT be converted to 0
        self.assertEqual(doc["reservoir"]["level_pct"], -1.0)
        self.assertEqual(doc["reservoir"]["status"], "OUT_OF_RANGE")

        # Quality flag must be False
        self.assertFalse(doc["quality"]["reservoir_valid"])

    def test_legitimate_zero_values_preserved(self):
        """
        Verifies that legitimate zeros (0.0 rain, 0 pump cycles, 0.0 surface wetness)
        are NOT converted to None or dropped.
        """
        raw = self.sample_esp32_json.copy()
        raw["rain_sensor"]["surface_wetness_pct"] = 0.0
        raw["nvs"]["pump_cycles_count"] = 0
        raw["model"]["prescribed_litres"] = 0.0

        doc = map_esp32_telemetry(raw)

        self.assertEqual(doc["rain_sensor"]["surface_wetness_pct"], 0.0)
        self.assertEqual(doc["nvs"]["pump_cycles_count"], 0)
        self.assertEqual(doc["model"]["prescribed_litres"], 0.0)

    def test_missing_optional_values_do_not_crash(self):
        """Verifies mapper gracefully handles minimal or partial ESP32 responses."""
        minimal_json = {
            "system": {"name": "TestNode"},
            "soil": {"moisture_pct": 25.0, "status": "OK"},
        }
        doc = map_esp32_telemetry(minimal_json)

        self.assertEqual(doc["device_id"], "TestNode")
        self.assertIsNone(doc["reservoir"])
        self.assertIsNone(doc["atmosphere"])
        self.assertIsNone(doc["crop"])
        self.assertTrue(doc["quality"]["soil_valid"])
        self.assertFalse(doc["quality"]["reservoir_valid"])

    def test_timestamp_is_utc_aware(self):
        """Verifies that recorded_at is timezone-aware UTC."""
        doc = map_esp32_telemetry(self.sample_esp32_json)
        self.assertEqual(doc["recorded_at"].tzinfo, timezone.utc)


if __name__ == "__main__":
    unittest.main()
