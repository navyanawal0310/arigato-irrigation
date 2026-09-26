"""
KRISHI SETU Backend Configuration
=================================
Centralized settings loaded from backend/.env.
Strict security rules:
- Secrets are NEVER printed or logged.
- Only safe masked representations are exposed.
"""

import os
import re
from pathlib import Path
from dotenv import load_dotenv

# Search for .env in backend/ or root
BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BACKEND_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)
else:
    load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "krishi_setu")
ESP32_BASE_URL = os.getenv("ESP32_BASE_URL", "http://10.110.8.97").rstrip("/")
TELEMETRY_INTERVAL_SECONDS = int(os.getenv("TELEMETRY_INTERVAL_SECONDS", "30"))
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Software (API) weather merged into each hardware telemetry record
ACCUWEATHER_API_KEY = os.getenv("ACCUWEATHER_API_KEY", "")
FIELD_LATITUDE = float(os.getenv("FIELD_LATITUDE", "12.9716"))    # defaults match the ESP32 firmware
FIELD_LONGITUDE = float(os.getenv("FIELD_LONGITUDE", "77.5946"))
API_WEATHER_REFRESH_MINUTES = int(os.getenv("API_WEATHER_REFRESH_MINUTES", "60"))


def get_safe_mongodb_summary() -> str:
    """Returns a sanitized summary of the MongoDB configuration without exposing credentials."""
    if not MONGODB_URI:
        return "MISSING_MONGODB_URI"
    # Mask username and password in connection string: mongodb+srv://<user>:<pwd>@host
    masked = re.sub(r"://([^:]+):([^@]+)@", r"://***:***@", MONGODB_URI)
    return masked


def is_mongodb_configured() -> bool:
    """Checks if a non-empty MongoDB URI is available."""
    return bool(MONGODB_URI and MONGODB_URI.strip())
