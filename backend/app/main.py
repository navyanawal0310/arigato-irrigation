"""
KRISHI SETU Backend Service (FastAPI)
=====================================
Initializes database indexes, starts resilient background telemetry polling,
and exposes RESTful telemetry endpoints.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import (
    MONGODB_DATABASE,
    ESP32_BASE_URL,
    TELEMETRY_INTERVAL_SECONDS,
    get_safe_mongodb_summary,
)
from backend.app.database import init_indexes, close_connection, check_connection
from backend.app.collector import collector
from backend.app.routes.telemetry import router as telemetry_router

# Configure standard logging format
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("krishi_setu.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for database initialization and background worker."""
    logger.info("Starting KRISHI SETU Telemetry Backend...")
    logger.info(f"Target Database: {MONGODB_DATABASE}")
    logger.info(f"Target ESP32:    {ESP32_BASE_URL}/api/status")
    logger.info(f"Polling Rate:    Every {TELEMETRY_INTERVAL_SECONDS}s")
    logger.info(f"MongoDB Target:  {get_safe_mongodb_summary()}")

    # 1. Initialize MongoDB Atlas indexes
    try:
        init_indexes()
        logger.info("MongoDB Atlas indexes verified and ready.")
    except Exception as e:
        logger.error(f"MongoDB Atlas initialization warning: {e}. (Will retry on queries)")

    # 2. Start background telemetry collector
    collector.start()
    logger.info("Background telemetry collector activated.")

    yield

    # Clean shutdown
    logger.info("Shutting down KRISHI SETU Telemetry Backend...")
    await collector.stop()
    close_connection()
    logger.info("Shutdown complete.")


app = FastAPI(
    title="KRISHI SETU Telemetry Persistence Service",
    description="Real-time ESP32 telemetry ingestion and MongoDB Atlas persistence engine.",
    version="1.0.0",
    lifespan=lifespan,
)

# Standard CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Attach API routes
app.include_router(telemetry_router, prefix="/api")


@app.get("/", summary="Root Health & Service Information")
def root():
    return {
        "service": "KRISHI SETU Telemetry Persistence Backend",
        "version": "1.0.0",
        "docs_url": "/docs",
        "health_url": "/api/health",
        "database": MONGODB_DATABASE,
        "collector_running": collector.is_running,
    }


if __name__ == "__main__":
    import uvicorn
    from backend.app.config import HOST, PORT
    uvicorn.run("backend.app.main:app", host=HOST, port=PORT, reload=False)
