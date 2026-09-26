"""
Unit Tests: FastAPI Telemetry Endpoints
=======================================
Tests:
- GET /api/health
- GET /api/telemetry/collector/status
- GET /api/telemetry/latest
- GET /api/telemetry/history
- GET /api/telemetry/device/{device_id}
"""

import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from datetime import datetime, timezone
from bson import ObjectId

from backend.app.main import app


class TestTelemetryAPI(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    @patch("backend.app.routes.telemetry.check_connection")
    def test_health_endpoint(self, mock_check_conn):
        mock_check_conn.return_value = {
            "status": "CONNECTED",
            "ping": True,
            "database": "krishi_setu",
            "error": None,
        }

        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "HEALTHY")
        self.assertEqual(data["database"]["database"], "krishi_setu")
        self.assertIn("esp32_target", data)

    def test_collector_status_endpoint(self):
        resp = self.client.get("/api/telemetry/collector/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("is_running", data)
        self.assertIn("interval_seconds", data)
        self.assertIn("records_inserted_count", data)

    @patch("backend.app.routes.telemetry.get_telemetry_collection")
    def test_latest_telemetry_found(self, mock_get_coll):
        mock_coll = MagicMock()
        mock_coll.find_one.return_value = {
            "_id": ObjectId(),
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": datetime.now(timezone.utc),
            "soil": {"moisture_pct": 28.5, "status": "HEALTHY"},
        }
        mock_get_coll.return_value = mock_coll

        resp = self.client.get("/api/telemetry/latest")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["device_id"], "AquaMatrix-MaxCore")
        self.assertEqual(data["soil"]["moisture_pct"], 28.5)

    @patch("backend.app.routes.telemetry.get_telemetry_collection")
    def test_latest_telemetry_not_found_returns_404(self, mock_get_coll):
        mock_coll = MagicMock()
        mock_coll.find_one.return_value = None
        mock_get_coll.return_value = mock_coll

        resp = self.client.get("/api/telemetry/latest")
        self.assertEqual(resp.status_code, 404)

    @patch("backend.app.routes.telemetry.get_telemetry_collection")
    def test_prediction_endpoint_refuses_soil_fault(self, mock_get_coll):
        """Verifies GET /api/prediction/soil-moisture refuses prediction on soil sensor FAULT."""
        mock_coll = MagicMock()
        mock_coll.find_one.return_value = {
            "_id": ObjectId(),
            "device_id": "AquaMatrix-MaxCore",
            "recorded_at": datetime.now(timezone.utc),
            "soil": {"raw_adc": 187, "moisture_pct": 0.0, "status": "FAULT"},
            "quality": {"soil_valid": False},
        }
        mock_get_coll.return_value = mock_coll

        resp = self.client.get("/api/prediction/soil-moisture")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "unavailable")
        self.assertIsNone(data["prediction"])
        self.assertEqual(data["reason"], "SOIL_SENSOR_FAULT")


if __name__ == "__main__":
    unittest.main()

