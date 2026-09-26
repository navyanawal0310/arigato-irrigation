"""
Unit Tests: Hardware + API Weather Merge
========================================
Tests:
- AccuWeather responses normalise into a snapshot (next-3h rain summed from hourly)
- Missing hardware features are filled from the API, with provenance recorded
- Hardware values (including legitimate zeros) are never overwritten
- No snapshot → document stored unenriched, flagged as not merged
- Documents without an atmosphere block still gain API features
"""

import unittest

from backend.app.api_weather import build_snapshot, merge_api_weather


def hourly(mm_values, probability=40):
    return [{"TotalLiquid": {"Value": mm}, "PrecipitationProbability": probability} for mm in mm_values]


class TestApiWeatherMerge(unittest.TestCase):

    def setUp(self):
        self.place = {"Key": "2862392", "LocalizedName": "Avalahalli"}
        self.current = {
            "WeatherText": "Cloudy",
            "Temperature": {"Metric": {"Value": 20.5}},
            "RelativeHumidity": 89,
            "Wind": {"Speed": {"Metric": {"Value": 18.1}}},
            "PrecipitationSummary": {
                "Past3Hours": {"Metric": {"Value": 0.4}},
                "Past24Hours": {"Metric": {"Value": 1.3}},
            },
        }
        self.snapshot = build_snapshot(self.place, self.current, hourly([0.5, 1.0, 0.0, 2.0] + [0.0] * 8))

    def test_snapshot_sums_next_three_hours(self):
        self.assertEqual(self.snapshot["forecast_rain_next_3h_mm"], 1.5)
        self.assertEqual(self.snapshot["forecast_rain_12h_mm"], 3.5)
        self.assertEqual(self.snapshot["observed_rain_mm"], 0.4)
        self.assertEqual(self.snapshot["temp_c"], 20.5)
        self.assertEqual(self.snapshot["source"], "ACCUWEATHER")

    def test_fills_only_missing_features(self):
        doc = {"atmosphere": {"temp_c": 27.3, "humidity_pct": 61.0, "forecast_rain_mm": 5.0}, "quality": {}}
        merge_api_weather(doc, self.snapshot)

        self.assertEqual(doc["atmosphere"]["temp_c"], 27.3)  # hardware kept
        self.assertEqual(doc["atmosphere"]["humidity_pct"], 61.0)
        self.assertEqual(doc["atmosphere"]["forecast_rain_next_3h_mm"], 1.5)  # filled from API
        self.assertEqual(doc["atmosphere"]["observed_rain_mm"], 0.4)
        self.assertEqual(
            doc["atmosphere_sources"],
            {"forecast_rain_next_3h_mm": "accuweather", "observed_rain_mm": "accuweather"},
        )
        self.assertTrue(doc["quality"]["api_weather_merged"])
        self.assertIs(doc["api_weather"], self.snapshot)

    def test_legitimate_zero_is_not_overwritten(self):
        doc = {"atmosphere": {"forecast_rain_next_3h_mm": 0.0, "observed_rain_mm": 0.0}}
        merge_api_weather(doc, self.snapshot)
        self.assertEqual(doc["atmosphere"]["forecast_rain_next_3h_mm"], 0.0)
        self.assertEqual(doc["atmosphere"]["observed_rain_mm"], 0.0)

    def test_no_snapshot_leaves_document_unenriched(self):
        doc = {"atmosphere": {"temp_c": 25.0}, "quality": {"soil_valid": True}}
        merge_api_weather(doc, None)
        self.assertIsNone(doc["api_weather"])
        self.assertFalse(doc["quality"]["api_weather_merged"])
        self.assertTrue(doc["quality"]["soil_valid"])
        self.assertNotIn("forecast_rain_next_3h_mm", doc["atmosphere"])

    def test_missing_atmosphere_block_is_created(self):
        doc = {"atmosphere": None}
        merge_api_weather(doc, self.snapshot)
        self.assertEqual(doc["atmosphere"]["temp_c"], 20.5)
        self.assertEqual(doc["atmosphere_sources"]["temp_c"], "accuweather")


if __name__ == "__main__":
    unittest.main()
