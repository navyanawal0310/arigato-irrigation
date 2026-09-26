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


def init_indexes() -> List[str]:
    """
    Ensures optimal query and deduplication indexes exist on the telemetry collection:
    1. device_id + recorded_at (DESCENDING) -> Supports device telemetry history queries.
    2. recorded_at (DESCENDING) -> Supports latest and chronological history queries.
    3. dedup_key (UNIQUE) -> Prevents multiple collector loops from writing duplicate observations.
    """
    coll = get_telemetry_collection()
    created_indexes = []

    try:
        # Index 1: Compound device_id + recorded_at (DESCENDING)
        idx1 = coll.create_index(
            [("device_id", ASCENDING), ("recorded_at", DESCENDING)],
            name="idx_device_recorded_at",
            background=True,
        )
        created_indexes.append(idx1)

        # Index 2: recorded_at (DESCENDING)
        idx2 = coll.create_index(
            [("recorded_at", DESCENDING)],
            name="idx_recorded_at_desc",
            background=True,
        )
        created_indexes.append(idx2)

        # Index 3: dedup_key (UNIQUE) - Deduplication protection
        idx3 = coll.create_index(
            [("dedup_key", ASCENDING)],
            name="idx_dedup_key_unique",
            unique=True,
            sparse=True,
            background=True,
        )
        created_indexes.append(idx3)

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
