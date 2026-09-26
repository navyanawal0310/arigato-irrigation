"""
KRISHI SETU Pydantic Schemas & BSON Serializers
===============================================
Ensures type safety, ObjectId serialization to strings, and ISO-8601 timestamps.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
from bson import ObjectId


def serialize_mongo_document(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Recursively converts MongoDB BSON objects (ObjectId, datetime) to JSON-safe structures."""
    if doc is None:
        return None

    res = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            res[k] = str(v)
        elif isinstance(v, datetime):
            res[k] = v.isoformat()
        elif isinstance(v, dict):
            res[k] = serialize_mongo_document(v)
        elif isinstance(v, list):
            res[k] = [serialize_mongo_document(item) if isinstance(item, dict) else (item.isoformat() if isinstance(item, datetime) else item) for item in v]
        else:
            res[k] = v
    return res


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    database: Dict[str, Any]
    esp32_target: str
    collector_running: bool


class CollectorStatus(BaseModel):
    is_running: bool
    interval_seconds: int
    esp32_target: str
    last_fetch_attempt: Optional[str] = None
    last_successful_fetch: Optional[str] = None
    last_insert_at: Optional[str] = None
    last_error: Optional[str] = None
    records_inserted_count: int = 0
    consecutive_errors: int = 0


class TelemetrySummary(BaseModel):
    device_id: str
    recorded_at: str
    soil_adc: Optional[int] = None
    soil_status: Optional[str] = None
    tank_status: Optional[str] = None
    tank_level_pct: Optional[float] = None
    decision: Optional[str] = None
    quality: Dict[str, Any]
