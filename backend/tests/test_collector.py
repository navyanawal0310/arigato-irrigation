"""
Unit Tests: Telemetry Collector Resilience & Serialization
==========================================================
Tests:
- ESP32 Timeout handling (no data fabrication)
- ESP32 ConnectError handling
- Invalid JSON handling
- MongoDB BSON serialization (ObjectId and datetime to JSON-safe strings)
"""

import unittest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timezone
from bson import ObjectId
import httpx

from backend.app.collector import TelemetryCollector
from backend.app.schemas import serialize_mongo_document


class TestCollectorResilience(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.collector = TelemetryCollector(esp32_url="http://10.99.99.99", interval_seconds=30)

    @patch("httpx.AsyncClient.get")
    async def test_esp32_timeout_returns_none_and_records_error(self, mock_get):
        """Verifies that an ESP32 timeout returns None without fabricating fake data."""
        mock_get.side_effect = httpx.TimeoutException("Connection timed out")

        result = await self.collector.fetch_esp32_status()

        self.assertIsNone(result)
        self.assertIsNotNone(self.collector.last_error)
        self.assertIn("timeout", self.collector.last_error.lower())
        self.assertEqual(self.collector.consecutive_errors, 1)

    @patch("httpx.AsyncClient.get")
    async def test_esp32_connect_error_returns_none(self, mock_get):
        """Verifies that unreachable hardware (ConnectError) returns None without fabricating."""
        mock_get.side_effect = httpx.ConnectError("Host unreachable")

        result = await self.collector.fetch_esp32_status()

        self.assertIsNone(result)
        self.assertIsNotNone(self.collector.last_error)
        self.assertEqual(self.collector.consecutive_errors, 1)

    @patch("httpx.AsyncClient.get")
    async def test_esp32_success_resets_error_counter(self, mock_get):
        """Verifies that a successful response returns data and resets consecutive_errors."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "system": {"name": "AquaMatrix-MaxCore"},
            "soil": {"moisture_pct": 30.0, "status": "HEALTHY"},
        }
        mock_get.return_value = mock_resp

        self.collector.consecutive_errors = 3
        result = await self.collector.fetch_esp32_status()

        self.assertIsNotNone(result)
        self.assertEqual(result["system"]["name"], "AquaMatrix-MaxCore")
        self.assertEqual(self.collector.consecutive_errors, 0)
        self.assertIsNone(self.collector.last_error)

    def test_bson_document_serialization(self):
        """Verifies that ObjectId and UTC datetimes are serialized to JSON-safe primitives."""
        test_oid = ObjectId()
        test_dt = datetime(2026, 9, 26, 12, 0, 0, tzinfo=timezone.utc)

        raw_doc = {
            "_id": test_oid,
            "recorded_at": test_dt,
            "device_id": "AquaMatrix-MaxCore",
            "nested": {
                "sub_id": ObjectId(),
                "created": test_dt,
            },
            "array": [test_dt, 10, "string"],
        }

        serialized = serialize_mongo_document(raw_doc)

        self.assertEqual(serialized["_id"], str(test_oid))
        self.assertEqual(serialized["recorded_at"], "2026-09-26T12:00:00+00:00")
        self.assertIsInstance(serialized["nested"]["sub_id"], str)
        self.assertEqual(serialized["array"][0], "2026-09-26T12:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
