"""
KRISHI SETU Telemetry Background Collector
===========================================
Periodically fetches real hardware telemetry from ESP32 /api/status,
maps into standardized schema, and inserts into MongoDB Atlas.

Resilience:
- Survives ESP32 timeouts, network dropouts, and invalid JSON.
- Never fabricates telemetry when hardware is unreachable.
- Preserves genuine sensor faults (e.g. OUT_OF_RANGE, FAULT).
- Prevents multi-collector duplicate inserts via dedup_key.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import httpx
from pymongo.errors import DuplicateKeyError, PyMongoError

from backend.app.config import (
    ESP32_BASE_URL,
    TELEMETRY_INTERVAL_SECONDS,
)
from backend.app.database import get_telemetry_collection
from backend.app.telemetry_mapper import map_esp32_telemetry

logger = logging.getLogger("krishi_setu.collector")


class TelemetryCollector:
    """
    Manages continuous background polling of the ESP32 hardware node.
    """

    def __init__(
        self,
        esp32_url: str = ESP32_BASE_URL,
        interval_seconds: int = TELEMETRY_INTERVAL_SECONDS,
    ):
        self.esp32_url = esp32_url
        self.interval_seconds = interval_seconds
        self.status_endpoint = f"{self.esp32_url}/api/status"

        self.is_running = False
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

        # Telemetry collector telemetry stats
        self.last_fetch_attempt: Optional[datetime] = None
        self.last_successful_fetch: Optional[datetime] = None
        self.last_insert_at: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.records_inserted_count: int = 0
        self.consecutive_errors: int = 0

    async def fetch_esp32_status(self) -> Optional[Dict[str, Any]]:
        """
        Attempts to read /api/status from the ESP32.
        Returns parsed JSON or None if unreachable.
        """
        self.last_fetch_attempt = datetime.now(timezone.utc)
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(self.status_endpoint, headers={"User-Agent": "KrishiSetu-Collector/1.0"})
                if resp.status_code == 200:
                    data = resp.json()
                    self.last_successful_fetch = datetime.now(timezone.utc)
                    self.consecutive_errors = 0
                    self.last_error = None
                    return data
                else:
                    msg = f"ESP32 returned HTTP {resp.status_code}: {resp.text[:100]}"
                    self._record_error(msg)
                    return None
        except httpx.TimeoutException:
            msg = f"ESP32 connection timeout at {self.status_endpoint}"
            self._record_error(msg)
            return None
        except httpx.ConnectError:
            msg = f"ESP32 unreachable (ConnectError) at {self.status_endpoint}"
            self._record_error(msg)
            return None
        except Exception as e:
            msg = f"ESP32 fetch error ({type(e).__name__}): {e}"
            self._record_error(msg)
            return None

    def _record_error(self, message: str):
        self.last_error = message
        self.consecutive_errors += 1
        logger.warning(f"[COLLECTOR] {message} (consecutive failures: {self.consecutive_errors})")

    async def collect_and_store_once(self) -> Optional[Dict[str, Any]]:
        """
        Executes a single cycle:
        fetch -> map -> insert into MongoDB.
        Returns the inserted document or None on failure/offline.
        """
        raw_data = await self.fetch_esp32_status()
        if raw_data is None:
            # When hardware is unreachable, we log failure and do NOT fabricate data
            return None

        # Map document
        doc = map_esp32_telemetry(raw_data, source="esp32")

        # Insert into MongoDB
        try:
            coll = get_telemetry_collection()
            res = coll.insert_one(doc)
            doc["_id"] = res.inserted_id
            self.last_insert_at = datetime.now(timezone.utc)
            self.records_inserted_count += 1
            logger.info(
                f"[COLLECTOR] Stored telemetry for {doc['device_id']} (_id: {res.inserted_id}) "
                f"at {doc['recorded_at'].isoformat()}"
            )
            return doc
        except DuplicateKeyError:
            logger.info(f"[COLLECTOR] Duplicate telemetry ignored for key: {doc.get('dedup_key')}")
            # Fetch existing matching document
            existing = coll.find_one({"dedup_key": doc.get("dedup_key")})
            return existing
        except PyMongoError as pe:
            msg = f"MongoDB insert error ({type(pe).__name__}): {pe}"
            self._record_error(msg)
            return None
        except Exception as e:
            msg = f"Unexpected database error ({type(e).__name__}): {e}"
            self._record_error(msg)
            return None

    async def _loop(self):
        """Main collector loop running every interval_seconds."""
        logger.info(
            f"[COLLECTOR] Started background telemetry collection loop: "
            f"target={self.status_endpoint}, interval={self.interval_seconds}s"
        )
        self.is_running = True
        self._stop_event.clear()

        while not self._stop_event.is_set():
            try:
                await self.collect_and_store_once()
            except Exception as e:
                logger.error(f"[COLLECTOR] Unexpected loop exception: {e}", exc_info=True)

            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                pass  # Normal interval elapsed, continue loop

        self.is_running = False
        logger.info("[COLLECTOR] Background telemetry collection stopped.")

    def start(self):
        """Starts the background collection loop task."""
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self):
        """Stops the background collection loop gracefully."""
        if self._task and not self._task.done():
            self._stop_event.set()
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except asyncio.TimeoutError:
                self._task.cancel()
        self.is_running = False

    def get_status(self) -> Dict[str, Any]:
        """Returns safe summary of collector state without secrets."""
        return {
            "is_running": self.is_running,
            "interval_seconds": self.interval_seconds,
            "esp32_target": self.status_endpoint,
            "last_fetch_attempt": self.last_fetch_attempt.isoformat() if self.last_fetch_attempt else None,
            "last_successful_fetch": self.last_successful_fetch.isoformat() if self.last_successful_fetch else None,
            "last_insert_at": self.last_insert_at.isoformat() if self.last_insert_at else None,
            "last_error": self.last_error,
            "records_inserted_count": self.records_inserted_count,
            "consecutive_errors": self.consecutive_errors,
        }


# Global singleton collector instance
collector = TelemetryCollector()
