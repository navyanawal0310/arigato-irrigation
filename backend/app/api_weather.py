"""
KRISHI SETU API Weather Context
===============================
Combines hardware telemetry with software (API) data before it is stored in MongoDB.

Each collector cycle attaches an AccuWeather snapshot for the field location to the
telemetry document (`api_weather`) and fills weather features the ESP32 does not measure
— most importantly `forecast_rain_next_3h_mm`, which the ML model needs but the firmware
only approximates with a whole-day total.

Rules:
- Hardware values are NEVER overwritten; the API only fills missing features.
- Every filled feature is recorded in `atmosphere_sources` for provenance.
- API failures never block telemetry storage (the document is stored without enrichment).
- Snapshots are cached (default 60 min) to respect the AccuWeather free-tier quota.
"""

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from backend.app.config import (
    ACCUWEATHER_API_KEY,
    API_WEATHER_REFRESH_MINUTES,
    FIELD_LATITUDE,
    FIELD_LONGITUDE,
)

logger = logging.getLogger("krishi_setu.api_weather")

ACCU_BASE = "https://dataservice.accuweather.com"


def build_snapshot(place: Dict[str, Any], current: Dict[str, Any], hourly: list) -> Dict[str, Any]:
    """Normalises AccuWeather responses into the snapshot stored alongside telemetry."""
    next_3h = hourly[:3]
    precip = current.get("PrecipitationSummary") or {}
    return {
        "source": "ACCUWEATHER",
        "fetched_at": datetime.now(timezone.utc),
        "location_key": place.get("Key"),
        "place": place.get("LocalizedName"),
        "latitude": FIELD_LATITUDE,
        "longitude": FIELD_LONGITUDE,
        "condition": current.get("WeatherText"),
        "temp_c": (current.get("Temperature") or {}).get("Metric", {}).get("Value"),
        "humidity_pct": current.get("RelativeHumidity"),
        "wind_kmh": ((current.get("Wind") or {}).get("Speed") or {}).get("Metric", {}).get("Value"),
        "observed_rain_mm": (precip.get("Past3Hours") or {}).get("Metric", {}).get("Value"),
        "rain_past_24h_mm": (precip.get("Past24Hours") or {}).get("Metric", {}).get("Value"),
        "forecast_rain_next_3h_mm": round(sum(float((h.get("TotalLiquid") or {}).get("Value") or 0.0) for h in next_3h), 2),
        "forecast_rain_12h_mm": round(sum(float((h.get("TotalLiquid") or {}).get("Value") or 0.0) for h in hourly), 2),
        "rain_probability_next_3h_pct": max((h.get("PrecipitationProbability") or 0) for h in next_3h) if next_3h else None,
    }


def _missing(value: Any) -> bool:
    if value is None or isinstance(value, bool):
        return True
    try:
        return not math.isfinite(float(value))
    except (TypeError, ValueError):
        return True


# atmosphere field -> snapshot field
FILLABLE_FEATURES = {
    "forecast_rain_next_3h_mm": "forecast_rain_next_3h_mm",
    "observed_rain_mm": "observed_rain_mm",
    "temp_c": "temp_c",
    "humidity_pct": "humidity_pct",
}


def merge_api_weather(document: Dict[str, Any], snapshot: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Attaches the API snapshot and fills only the atmosphere features hardware did not provide."""
    document["api_weather"] = snapshot
    quality = document.setdefault("quality", {})
    if not snapshot:
        quality["api_weather_merged"] = False
        return document

    atmosphere = document.get("atmosphere")
    if not isinstance(atmosphere, dict):
        atmosphere = {}
        document["atmosphere"] = atmosphere

    sources: Dict[str, str] = {}
    for field, snap_field in FILLABLE_FEATURES.items():
        if _missing(atmosphere.get(field)) and not _missing(snapshot.get(snap_field)):
            atmosphere[field] = float(snapshot[snap_field])
            sources[field] = "accuweather"

    document["atmosphere_sources"] = sources
    quality["api_weather_merged"] = True
    return document


class ApiWeatherContext:
    """Fetches and caches the AccuWeather snapshot for the configured field location."""

    def __init__(self, api_key: str = ACCUWEATHER_API_KEY, refresh_minutes: int = API_WEATHER_REFRESH_MINUTES):
        self.api_key = api_key
        self.refresh_seconds = max(5, refresh_minutes) * 60
        self._place: Optional[Dict[str, Any]] = None
        self._snapshot: Optional[Dict[str, Any]] = None
        self._fetched_monotonic = 0.0
        self.last_error: Optional[str] = None

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def _get(self, client: httpx.AsyncClient, path: str, **params) -> Any:
        resp = await client.get(f"{ACCU_BASE}{path}", params=params, headers={"Authorization": f"Bearer {self.api_key}"})
        resp.raise_for_status()
        return resp.json()

    async def get_snapshot(self) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None
        if self._snapshot and time.monotonic() - self._fetched_monotonic < self.refresh_seconds:
            return self._snapshot
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                if self._place is None:
                    self._place = await self._get(
                        client, "/locations/v1/cities/geoposition/search", q=f"{FIELD_LATITUDE},{FIELD_LONGITUDE}"
                    )
                key = self._place["Key"]
                current = (await self._get(client, f"/currentconditions/v1/{key}", details="true"))[0]
                hourly = await self._get(client, f"/forecasts/v1/hourly/12hour/{key}", details="true", metric="true")
            self._snapshot = build_snapshot(self._place, current, hourly)
            self._fetched_monotonic = time.monotonic()
            self.last_error = None
            logger.info(
                f"[API WEATHER] Refreshed AccuWeather context for {self._snapshot['place']}: "
                f"next 3h rain {self._snapshot['forecast_rain_next_3h_mm']} mm"
            )
        except Exception as e:
            # Keep serving the previous snapshot (if any) rather than dropping context entirely
            self.last_error = f"{type(e).__name__}: {str(e)[:160]}"
            logger.warning(f"[API WEATHER] Refresh failed, using {'stale' if self._snapshot else 'no'} snapshot: {self.last_error}")
        return self._snapshot

    def get_status(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "field_location": {"lat": FIELD_LATITUDE, "lon": FIELD_LONGITUDE},
            "refresh_minutes": self.refresh_seconds // 60,
            "last_fetched_at": self._snapshot["fetched_at"].isoformat() if self._snapshot else None,
            "place": self._snapshot["place"] if self._snapshot else None,
            "last_error": self.last_error,
        }


api_weather = ApiWeatherContext()
