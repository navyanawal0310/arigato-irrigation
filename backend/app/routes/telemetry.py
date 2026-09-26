"""
KRISHI SETU Telemetry API Routes
================================
Provides read-only endpoints for live cockpit inspection and historical retrieval.
- GET /api/health
- GET /api/telemetry/latest
- GET /api/telemetry/history
- GET /api/telemetry/device/{device_id}
- GET /api/telemetry/collector/status
- POST /api/telemetry/collect
"""

from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Query
from pymongo import DESCENDING

from backend.app.config import ESP32_BASE_URL, MONGODB_DATABASE
from backend.app.database import get_telemetry_collection, check_connection
from backend.app.schemas import serialize_mongo_document
from backend.app.collector import collector

router = APIRouter()


@router.get("/health", summary="Service & MongoDB Health Check")
def health_check():
    """Returns backend server health and MongoDB Atlas connectivity status."""
    db_status = check_connection()
    return {
        "status": "HEALTHY" if db_status["ping"] else "DEGRADED",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_status,
        "esp32_target": f"{ESP32_BASE_URL}/api/status",
        "collector_running": collector.is_running,
    }


@router.get("/telemetry/latest", summary="Get Newest Telemetry Record")
def get_latest_telemetry(
    scenario: Optional[str] = Query(default=None, description="Optional what-if demonstration scenario ('dry_no_rain', 'dry_rain_expected', 'adequate_moisture', 'safety_lockout')"),
):
    """Returns the most recent telemetry document from MongoDB Atlas or demonstration scenario."""
    if scenario and scenario.lower() not in ["live", "none", ""]:
        from backend.app.irrigation_intelligence import recommendation_service
        sc_doc = recommendation_service.get_scenario_telemetry(scenario)
        if sc_doc:
            return sc_doc

    coll = get_telemetry_collection()
    doc = coll.find_one(sort=[("recorded_at", DESCENDING)])
    if not doc:
        raise HTTPException(status_code=404, detail="No telemetry records found in database.")
    return serialize_mongo_document(doc)


@router.get("/telemetry/history", summary="Get Chronological Telemetry History")
def get_telemetry_history(
    hours: int = Query(default=24, ge=1, le=168, description="Query window in hours (1-168)"),
    limit: int = Query(default=100, ge=1, le=1000, description="Max observations to return"),
):
    """
    Returns chronological telemetry observations from the last N hours.
    Ordered chronologically (oldest to newest) for plotting.
    """
    coll = get_telemetry_collection()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    cursor = coll.find(
        {"recorded_at": {"$gte": since}},
        sort=[("recorded_at", DESCENDING)],
    ).limit(limit)

    records = list(cursor)
    # Reverse to chronological order (oldest -> newest) for time series consumers
    records.reverse()
    return [serialize_mongo_document(r) for r in records]


@router.get("/telemetry/device/{device_id}", summary="Get Device-Specific Telemetry History")
def get_device_telemetry(
    device_id: str,
    hours: int = Query(default=24, ge=1, le=168, description="Query window in hours (1-168)"),
    limit: int = Query(default=100, ge=1, le=1000, description="Max observations to return"),
):
    """
    Returns chronological telemetry observations for a specific hardware node.
    """
    coll = get_telemetry_collection()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    cursor = coll.find(
        {
            "device_id": device_id,
            "recorded_at": {"$gte": since},
        },
        sort=[("recorded_at", DESCENDING)],
    ).limit(limit)

    records = list(cursor)
    records.reverse()
    return [serialize_mongo_document(r) for r in records]


@router.get("/telemetry/collector/status", summary="Get Collector Engine Diagnostics")
def get_collector_status():
    """Returns background collector operational metrics and failure statistics."""
    return collector.get_status()


@router.post("/telemetry/collect", summary="Trigger Manual On-Demand Telemetry Collection")
async def trigger_manual_collection():
    """
    Immediately triggers a single fetch-and-store cycle from the configured ESP32.
    Useful for testing, initial hardware verification, or on-demand synchronization.
    """
    doc = await collector.collect_and_store_once()
    if doc is None:
        return {
            "status": "HARDWARE_UNREACHABLE",
            "message": "Failed to reach ESP32 at /api/status. Telemetry was not fabricated.",
            "last_error": collector.last_error,
        }
    return {
        "status": "STORED",
        "document": serialize_mongo_document(doc),
    }


@router.get("/prediction/soil-moisture", summary="Get 3-Hour Soil Moisture ML Prediction")
def get_soil_moisture_prediction(
    device_id: Optional[str] = Query(default=None, description="Optional target device ID"),
    scenario: Optional[str] = Query(default=None, description="Optional what-if demonstration scenario ('dry_no_rain', 'dry_rain_expected', 'adequate_moisture', 'safety_lockout')"),
):
    """
    Executes safe 3-hour forward root-zone soil moisture prediction using the trained V2 model.
    Enforces strict gating:
    - Refuses prediction if soil sensor is in FAULT (status='unavailable', reason='SOIL_SENSOR_FAULT').
    - Refuses if historical telemetry coverage is < 6 hours (status='warming_up', reason='INSUFFICIENT_HISTORY').
    - Refuses if required weather data is missing (status='missing_features', reason='MISSING_WEATHER_DATA').
    - NEVER directly commands or overrides irrigation pumps.
    """
    if scenario and scenario.lower() not in ["live", "none", ""]:
        from backend.app.irrigation_intelligence import recommendation_service
        sc_pred = recommendation_service.get_scenario_prediction(scenario)
        if sc_pred:
            return sc_pred

    from backend.app.ml_inference import inference_service
    return inference_service.predict_latest_from_db(device_id=device_id)


@router.get("/irrigation/recommendation", summary="Get Explainable Irrigation Recommendation")
def get_irrigation_recommendation(
    device_id: Optional[str] = Query(default=None, description="Optional target device ID"),
    scenario: Optional[str] = Query(default=None, description="Optional what-if demonstration scenario ('dry_no_rain', 'dry_rain_expected', 'adequate_moisture', 'safety_lockout')"),
):
    """
    Computes an explainable, forecast-aware irrigation recommendation (Phase 5).
    Combines live physical telemetry, Open-Meteo atmospheric forecasts, crop coefficients (Kc/MAD),
    and Soil-Water ML V2 predictions under strict safety precedence.
    Does NOT actuate the pump. Purely advisory and explainable.
    """
    from backend.app.irrigation_intelligence import recommendation_service
    return recommendation_service.get_recommendation(device_id=device_id, scenario=scenario)


@router.get("/ml/validation/summary", summary="Get Real Field Validation Summary")
def get_ml_validation_summary(
    device_id: Optional[str] = Query(default=None, description="Optional target device ID"),
):
    """
    Returns real-world validation statistics for Soil-Water V2 from matured field predictions.
    Separates real field metrics from simulated development metrics.
    If zero predictions have been validated, returns status='collecting_data' and null metrics.
    """
    from backend.app.prediction_validation import validation_service
    # Run validation worker pass first to ensure any newly matured predictions are evaluated
    try:
        validation_service.validate_matured_predictions()
    except Exception:
        pass
    return validation_service.get_validation_summary(device_id=device_id)


@router.get("/ml/validation/history", summary="Get Real Field Validation History")
def get_ml_validation_history(
    device_id: Optional[str] = Query(default=None, description="Optional target device ID"),
    limit: int = Query(default=50, ge=1, le=200, description="Max history records to return"),
    status: Optional[str] = Query(default=None, description="Optional validation status filter ('VALIDATED', 'PENDING', 'NO_MATCH', 'INVALID_TARGET_DATA')"),
):
    """
    Returns recent prediction-actual pairs from the predictions collection.
    """
    from backend.app.prediction_validation import validation_service
    return validation_service.get_validation_history(device_id=device_id, limit=limit, status=status)


@router.post("/ml/validation/run-worker", summary="Trigger Background Validation Pass")
def trigger_validation_worker(
    tolerance_minutes: Optional[int] = Query(default=None, ge=1, le=60, description="Matching tolerance in minutes (default 15)"),
):
    """
    Manually triggers a validation scan over matured PENDING predictions.
    """
    from backend.app.prediction_validation import validation_service
    return validation_service.validate_matured_predictions(tolerance_minutes=tolerance_minutes)



