"""
KRISHI SETU Database Layer (MongoDB Atlas via PyMongo)
======================================================
Manages connection pooling, index creation, and collection access.
Never exposes credentials in logs or responses.
"""

from typing import Optional, Dict, Any, List
import logging
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import PyMongoError, DuplicateKeyError

from backend.app.config import MONGODB_URI, MONGODB_DATABASE

logger = logging.getLogger("krishi_setu.database")

_mongo_client: Optional[MongoClient] = None


def get_client() -> MongoClient:
    """Returns singleton MongoClient with connection pooling and fast failover timeout."""
    global _mongo_client
    if _mongo_client is None:
        if not MONGODB_URI:
            raise ValueError("MONGODB_URI is not configured in backend/.env")
        _mongo_client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=10000,
            maxPoolSize=20,
            retryWrites=True,
        )
    return _mongo_client


def get_database():
    """Returns the krishi_setu database instance."""
    client = get_client()
    return client[MONGODB_DATABASE]


def get_telemetry_collection():
    """Returns the telemetry collection."""
    db = get_database()
    return db["telemetry"]


def get_predictions_collection():
    """Returns the predictions collection for Phase 6 model validation."""
    db = get_database()
    return db["predictions"]


def init_indexes() -> List[str]:
    """
    Ensures optimal query and deduplication indexes exist on:
    1. telemetry collection:
       - device_id + recorded_at (DESCENDING)
       - recorded_at (DESCENDING)
       - dedup_key (UNIQUE)
    2. predictions collection (Phase 6):
       - device_id + created_at (DESCENDING) -> Cadence & history lookup
       - target_at + validation.status -> Validation worker queue scanning
       - prediction_id (UNIQUE) -> Canonical identifier lookup
       - validation.status -> State filtering (PENDING vs VALIDATED)
       - dedup_key (UNIQUE, SPARSE) -> Server-side cadence enforcement
    """
    coll = get_telemetry_collection()
    pred_coll = get_predictions_collection()
    created_indexes = []

    try:
        # Telemetry Index 1: Compound device_id + recorded_at (DESCENDING)
        idx1 = coll.create_index(
            [("device_id", ASCENDING), ("recorded_at", DESCENDING)],
            name="idx_device_recorded_at",
            background=True,
        )
        created_indexes.append(idx1)

        # Telemetry Index 2: recorded_at (DESCENDING)
        idx2 = coll.create_index(
            [("recorded_at", DESCENDING)],
            name="idx_recorded_at_desc",
            background=True,
        )
        created_indexes.append(idx2)

        # Telemetry Index 3: dedup_key (UNIQUE) - Deduplication protection
        idx3 = coll.create_index(
            [("dedup_key", ASCENDING)],
            name="idx_dedup_key_unique",
            unique=True,
            sparse=True,
            background=True,
        )
        created_indexes.append(idx3)

        # Predictions Index 1: device_id + created_at (DESCENDING)
        pidx1 = pred_coll.create_index(
            [("device_id", ASCENDING), ("created_at", DESCENDING)],
            name="idx_pred_device_created",
            background=True,
        )
        created_indexes.append(pidx1)

        # Predictions Index 2: target_at + validation.status (Worker query)
        pidx2 = pred_coll.create_index(
            [("target_at", ASCENDING), ("validation.status", ASCENDING)],
            name="idx_pred_target_status",
            background=True,
        )
        created_indexes.append(pidx2)

        # Predictions Index 3: prediction_id (UNIQUE)
        pidx3 = pred_coll.create_index(
            [("prediction_id", ASCENDING)],
            name="idx_pred_id_unique",
            unique=True,
            background=True,
        )
        created_indexes.append(pidx3)

        # Predictions Index 4: validation.status
        pidx4 = pred_coll.create_index(
            [("validation.status", ASCENDING)],
            name="idx_pred_status",
            background=True,
        )
        created_indexes.append(pidx4)

        # Predictions Index 5: dedup_key (UNIQUE, SPARSE)
        pidx5 = pred_coll.create_index(
            [("dedup_key", ASCENDING)],
            name="idx_pred_dedup_unique",
            unique=True,
            sparse=True,
            background=True,
        )
        created_indexes.append(pidx5)

        logger.info(f"MongoDB indexes initialized successfully: {created_indexes}")
    except Exception as e:
        logger.error(f"Failed to initialize indexes: {e}")
        raise

    return created_indexes


def check_connection() -> Dict[str, Any]:
    """Tests connectivity to MongoDB Atlas."""
    try:
        client = get_client()
        res = client.admin.command("ping")
        return {
            "status": "CONNECTED",
            "ping": res.get("ok") == 1.0,
            "database": MONGODB_DATABASE,
            "error": None,
        }
    except Exception as e:
        return {
            "status": "DISCONNECTED",
            "ping": False,
            "database": MONGODB_DATABASE,
            "error": str(e),
        }


def close_connection():
    """Closes MongoClient connection pool."""
    global _mongo_client
    if _mongo_client is not None:
        _mongo_client.close()
        _mongo_client = None
