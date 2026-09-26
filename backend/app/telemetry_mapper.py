"""
KRISHI SETU Telemetry Mapper
============================
Transforms raw ESP32 JSON responses into standardized, type-safe MongoDB documents.
Adheres strictly to the physical and quality constraints:
- Preserves original measurements without fabrication.
- Distinguishes missing values (None) from legitimate zero values (0.0).
- Preserves sensor hardware statuses (HEALTHY, OK, FAULT, OUT_OF_RANGE).
- Rejects -1 sentinel readings as valid physical measurements in quality flags.
- Injects backend-generated timezone-aware UTC timestamps.
- Generates deduplication keys to protect against multi-collector write storms.
"""

from datetime import datetime, timezone
from typing import Dict, Any, Optional
import math


def is_finite_number(val: Any) -> bool:
    """Checks if a value is a real finite integer or float."""
    if val is None or isinstance(val, bool):
        return False
    if isinstance(val, (int, float)):
        return math.isfinite(val)
    try:
        f = float(val)
        return math.isfinite(f)
    except (ValueError, TypeError):
        return False


def map_esp32_telemetry(
    raw_data: Dict[str, Any],
    source: str = "esp32",
    recorded_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Maps raw ESP32 JSON payload into the validated Krishi Setu MongoDB schema.
    """
    if recorded_at is None:
        recorded_at = datetime.now(timezone.utc)
    elif recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=timezone.utc)

    # 1. Device Identification & System
    sys_raw = raw_data.get("system", {})
    device_id = sys_raw.get("name") or "AquaMatrix-MaxCore"
    uptime_sec = sys_raw.get("uptime_sec")

    # 2. Extract Subsystems while preserving types and missing values
    crop = raw_data.get("crop")
    soil = raw_data.get("soil")
    drainage = raw_data.get("drainage")
    rain_sensor = raw_data.get("rain_sensor")
    reservoir = raw_data.get("reservoir")
    atmosphere = raw_data.get("atmosphere") or raw_data.get("weather")
    decision = raw_data.get("decision") or raw_data.get("controller")
    model = raw_data.get("model")
    disease = raw_data.get("disease") or raw_data.get("pathology")
    nvs = raw_data.get("nvs")

    # 3. Calculate Strict Quality Flags
    # A. Soil Validity:
    # Soil is valid ONLY if status is HEALTHY/OK and moisture_pct is a finite, physically valid number [0, 100]
    soil_valid = False
    if soil and isinstance(soil, dict):
        soil_status = str(soil.get("status", "")).upper()
        moisture = soil.get("moisture_pct") if "moisture_pct" in soil else soil.get("moisture_index")
        if (soil_status in ["HEALTHY", "OK"]) and is_finite_number(moisture):
            moist_val = float(moisture)
            if 0.0 <= moist_val <= 100.0:
                soil_valid = True

    # B. Reservoir Validity:
    # Reservoir is valid ONLY if status is HEALTHY/OK and level_pct >= 0 (never mark -1 sentinel as valid)
    reservoir_valid = False
    if reservoir and isinstance(reservoir, dict):
        tank_status = str(reservoir.get("status", "")).upper()
        level = reservoir.get("level_pct") if "level_pct" in reservoir else reservoir.get("level_percent")
        if (tank_status in ["HEALTHY", "OK"]) and is_finite_number(level):
            lvl_val = float(level)
            if lvl_val >= 0.0 and lvl_val <= 100.0:
                reservoir_valid = True

    # C. Rain Sensor Validity
    rain_sensor_valid = False
    if rain_sensor and isinstance(rain_sensor, dict):
        wetness = rain_sensor.get("surface_wetness_pct")
        if is_finite_number(wetness) and float(wetness) >= 0.0:
            rain_sensor_valid = True

    quality = {
        "soil_valid": soil_valid,
        "reservoir_valid": reservoir_valid,
        "rain_sensor_valid": rain_sensor_valid,
        "node_connected": True,
    }

    # 4. Deduplication Key Generation
    # Deduplication relies on (device_id, uptime_sec) when uptime is available,
    # or on a 15-second time bucket of recorded_at. This prevents duplicate writes
    # if multiple collectors poll the same hardware concurrently.
    if uptime_sec is not None and is_finite_number(uptime_sec) and int(uptime_sec) > 0:
        dedup_key = f"{device_id}_up{int(uptime_sec)}"
    else:
        # 15-second epoch window bucket
        epoch_bucket = int(recorded_at.timestamp() // 15) * 15
        dedup_key = f"{device_id}_epoch{epoch_bucket}"

    # 5. Assemble Schema-Versioned Document
    document = {
        "recorded_at": recorded_at,
        "device_id": device_id,
        "source": source,
        "dedup_key": dedup_key,
        "system": sys_raw,
        "crop": crop,
        "soil": soil,
        "drainage": drainage,
        "rain_sensor": rain_sensor,
        "reservoir": reservoir,
        "atmosphere": atmosphere,
        "decision": decision,
        "model": model,
        "disease": disease,
        "nvs": nvs,
        "quality": quality,
        "schema_version": 1,
    }

    return document
