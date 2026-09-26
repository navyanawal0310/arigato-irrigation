"""
KRISHI SETU Predictive Soil-Water Model v1 - Global Configuration
=================================================================
Centralized parameters for physical simulation, feature engineering,
model training, and evaluation.
"""

from pathlib import Path

# --- DIRECTORY PATHS ---
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
MODELS_DIR = BASE_DIR / "models"
RESULTS_DIR = BASE_DIR / "results"
TESTS_DIR = BASE_DIR / "tests"

# Ensure directories exist
for directory in [DATA_DIR, RAW_DATA_DIR, PROCESSED_DATA_DIR, MODELS_DIR, RESULTS_DIR, TESTS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# --- REPRODUCIBILITY ---
RANDOM_SEED = 42

# --- DATASET & HORIZON ---
PREDICTION_HORIZON_HOURS = 3
DEFAULT_DEVICE_ID = "esp32-field-01"

# --- CHRONOLOGICAL DATA SPLITS ---
TRAIN_RATIO = 0.70
VAL_RATIO = 0.15
TEST_RATIO = 0.15

# --- SOIL-WATER BALANCE PHYSICAL PARAMETERS ---
# Reference soil type: Sandy Clay Loam (representative benchmark for agricultural root zones)
# NOTE: These are simulated agronomic constants and must be calibrated against in-situ core samples.
FIELD_CAPACITY_PCT = 35.0          # Volumetric soil moisture at field capacity (%)
WILTING_POINT_PCT = 12.0           # Volumetric soil moisture at permanent wilting point (%)
SATURATION_PCT = 48.0              # Saturated water content / total porosity (%)
ROOT_ZONE_DEPTH_MM = 400.0         # Effective active root-zone depth (mm) for solanaceous crops
FIELD_AREA_M2 = 100.0              # Calibrated plot footprint area (m^2)
INFILTRATION_EFFICIENCY = 0.85     # Fraction of rainfall that enters the soil without surface runoff
IRRIGATION_EFFICIENCY = 0.90       # Fraction of emitter discharge that reaches root-zone
DRAINAGE_RATE_HOURLY = 0.25        # Proportion of excess water above field capacity draining per hour

# --- SENSOR SIMULATION PARAMETERS ---
SENSOR_NOISE_STD = 0.8             # Standard deviation of gaussian sensor measurement noise (%)
ADC_DRY = 2850                     # 12-bit ADC reading in dry soil
ADC_WET = 1150                     # 12-bit ADC reading at full saturation
ADC_MIN_VALID = 300                # Minimum valid hardware ADC threshold
ADC_MAX_VALID = 3800               # Maximum valid hardware ADC threshold
FAULT_PROBABILITY = 0.002          # Probability of a transient hardware sensor fault event

# --- MODEL METADATA ---
MODEL_VERSION = "1.0.0-PROTOTYPE"
MODEL_NAME = "soil_moisture_3h"
TARGET_COLUMN = "soil_moisture_t_plus_3h"
CURRENT_MOISTURE_COLUMN = "soil_moisture_pct"
