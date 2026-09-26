"""
KRISHI SETU Synthetic Telemetry Generator
=========================================
Generates a reproducible, sequential hourly time-series dataset of agro-hydrological
telemetry using the physical SoilWaterBalance engine.

DATASET TYPE:
    SIMULATED / DEVELOPMENT DATA
    Explicitly created for ML pipeline scaffolding, code verification, and baseline modeling.
    DO NOT represent results obtained from this data as validated real-world agricultural accuracy.
"""

import json
from datetime import datetime, timedelta
from typing import Dict, Any, List
import numpy as np
import pandas as pd

from ml.config import (
    RAW_DATA_DIR,
    RANDOM_SEED,
    FIELD_CAPACITY_PCT,
    WILTING_POINT_PCT,
    SATURATION_PCT,
    DEFAULT_DEVICE_ID,
    SENSOR_NOISE_STD,
    ADC_DRY,
    ADC_WET,
    FAULT_PROBABILITY,
)
from ml.src.soil_water_balance import SoilWaterBalance


def generate_synthetic_dataset(
    n_hours: int = 5000,
    start_time: str = "2026-01-01 00:00:00",
    random_seed: int = RANDOM_SEED,
    device_id: str = DEFAULT_DEVICE_ID,
) -> pd.DataFrame:
    """
    Generates n_hours of sequential hourly physical simulation telemetry across multiple
    realistic agronomic scenarios.
    """
    np.random.seed(random_seed)
    balance = SoilWaterBalance()

    base_time = datetime.fromisoformat(start_time)
    records: List[Dict[str, Any]] = []

    # Initial physical state (starting slightly below field capacity)
    true_moisture = FIELD_CAPACITY_PCT - 2.0
    crop_profile = "Tomato (Vegetative)"
    kc_factor = 0.85
    mad_threshold_pct = 50.0  # Allowable depletion threshold

    # Scenario time blocks
    # Divide 5000 hours into consecutive agronomic scenario phases:
    # 0. Normal balanced weather & automated irrigation (0 - 1000)
    # 1. Hot, high-ET0 evaporative stress period (1000 - 1800)
    # 2. Monsoon / Heavy rain storms (1800 - 2400)
    # 3. Extended dry spell with deficit irrigation (2400 - 3400)
    # 4. Intermittent rain & moderate recovery (3400 - 4200)
    # 5. Mixed variable autumn conditions (4200 - 5000)

    for step in range(n_hours):
        current_time = base_time + timedelta(hours=step)
        hour = current_time.hour
        day_of_year = current_time.timetuple().tm_yday

        # --- 1. DETERMINE AGRO-METEOROLOGICAL SCENARIO ---
        if step < 1000:
            scenario = "NORMAL_BALANCED"
            temp_base, temp_amp = 26.0, 6.0
            humidity_base = 65.0
            et0_base = 4.2
            rain_chance = 0.03
            max_rain_intensity = 6.0
            auto_irrigate = True
        elif step < 1800:
            scenario = "HOT_HIGH_ET0"
            temp_base, temp_amp = 34.0, 7.5
            humidity_base = 40.0
            et0_base = 6.8
            rain_chance = 0.005
            max_rain_intensity = 2.0
            auto_irrigate = True
        elif step < 2400:
            scenario = "MONSOON_HEAVY_RAIN"
            temp_base, temp_amp = 24.0, 3.5
            humidity_base = 85.0
            et0_base = 2.5
            rain_chance = 0.25
            max_rain_intensity = 35.0
            auto_irrigate = False
        elif step < 3400:
            scenario = "EXTENDED_DROUGHT_DEFICIT"
            temp_base, temp_amp = 31.0, 7.0
            humidity_base = 45.0
            et0_base = 5.5
            rain_chance = 0.002
            max_rain_intensity = 1.0
            auto_irrigate = False  # Only emergency deficit irrigation below critical threshold
        elif step < 4200:
            scenario = "PASSING_SHOWERS"
            temp_base, temp_amp = 27.0, 5.0
            humidity_base = 70.0
            et0_base = 4.0
            rain_chance = 0.12
            max_rain_intensity = 12.0
            auto_irrigate = True
        else:
            scenario = "AUTUMN_MIXED"
            temp_base, temp_amp = 25.0, 5.5
            humidity_base = 60.0
            et0_base = 3.8
            rain_chance = 0.04
            max_rain_intensity = 8.0
            auto_irrigate = True

        # --- 2. DIURNAL ATMOSPHERIC FORCING ---
        # Peak temperature at 14:00, minimum at 05:00
        solar_angle = 2.0 * np.pi * (hour - 14) / 24.0
        diurnal_temp = temp_base + temp_amp * np.cos(solar_angle) + np.random.normal(0, 0.7)
        temperature_c = float(np.clip(diurnal_temp, 12.0, 48.0))

        # Humidity is inversely related to temperature
        diurnal_humidity = humidity_base - (temp_amp * 2.5) * np.cos(solar_angle) + np.random.normal(0, 2.5)
        humidity_pct = float(np.clip(diurnal_humidity, 20.0, 98.0))

        # ET0 daily rate variation with temperature
        et0_mm_day = float(np.clip(et0_base * (temperature_c / temp_base) + np.random.normal(0, 0.25), 1.5, 9.0))

        # --- 3. PRECIPITATION & RAIN SENSOR ---
        is_rain_hour = np.random.random() < rain_chance
        if is_rain_hour:
            rainfall_mm = float(np.round(np.random.exponential(scale=max_rain_intensity / 2.5), 1))
            rainfall_mm = min(rainfall_mm, max_rain_intensity)
            is_raining = 1
            surface_wetness_pct = float(np.clip(70.0 + rainfall_mm * 2.0 + np.random.normal(0, 5.0), 65.0, 100.0))
        else:
            rainfall_mm = 0.0
            is_raining = 0
            surface_wetness_pct = float(np.clip(np.random.exponential(scale=3.0), 0.0, 35.0))

        # Forecast rain (simulated NWP forecast with realistic noise)
        forecast_rain_mm = float(np.clip(rainfall_mm * 1.5 + np.random.exponential(scale=1.5), 0.0, 80.0))

        # --- 4. IRRIGATION ARBITRATION ---
        irrigation_litres = 0.0
        pump_active = 0
        moisture_threshold = FIELD_CAPACITY_PCT - (mad_threshold_pct / 100.0) * (FIELD_CAPACITY_PCT - WILTING_POINT_PCT)

        if auto_irrigate:
            # Trigger calibrated drip burst when moisture depletes to MAD buffer and no active rain
            if true_moisture <= (moisture_threshold + 3.0) and not is_raining:
                irrigation_litres = float(np.random.choice([25.0, 30.0, 40.0]))
                pump_active = 1
        elif scenario == "EXTENDED_DROUGHT_DEFICIT":
            # Deficit emergency survival irrigation only when moisture approaches wilting point
            if true_moisture <= (WILTING_POINT_PCT + 2.0) and not is_raining:
                irrigation_litres = 20.0
                pump_active = 1

        # Reservoir level simulation (depletes during irrigation, refills during rain)
        reservoir_level_pct = float(np.clip(75.0 - (step * 0.01) % 50.0 + (rainfall_mm * 2.0), 10.0, 100.0))
        reservoir_status = "HEALTHY"

        # --- 5. PHYSICAL SOIL WATER BALANCE STEP ---
        flux = balance.step(
            current_moisture_pct=true_moisture,
            rainfall_mm=rainfall_mm,
            irrigation_litres=irrigation_litres,
            et0_mm_day=et0_mm_day,
            kc_factor=kc_factor,
            mad_threshold_pct=mad_threshold_pct,
            hour=hour,
        )

        true_moisture = flux["next_moisture_pct"]

        # --- 6. SENSOR MEASUREMENT & NOISE MODEL ---
        # Add measurement noise to simulate real capacitive/TDR probe observations
        sensor_noise = np.random.normal(0, SENSOR_NOISE_STD)
        observed_moisture = float(np.clip(true_moisture + sensor_noise, 0.0, 100.0))
        soil_dryness_pct = float(np.clip(100.0 - observed_moisture, 0.0, 100.0))

        # Synthetic 12-bit ADC mapping with circuit calibration:
        # Moisture % = ((ADC_DRY - ADC) / (ADC_DRY - ADC_WET)) * 100
        # => ADC = ADC_DRY - (Moisture% / 100) * (ADC_DRY - ADC_WET)
        ideal_adc = ADC_DRY - (observed_moisture / 100.0) * (ADC_DRY - ADC_WET)
        soil_adc = int(np.clip(ideal_adc + np.random.normal(0, 12), 0, 4095))

        # Transient Hardware Fault Simulation (very rare: 0.2% probability)
        is_hardware_fault = np.random.random() < FAULT_PROBABILITY
        if is_hardware_fault:
            soil_status = "FAULT"
            soil_adc = int(np.random.choice([0, 4095]))  # Pin shorted to GND or VCC
            # In fault condition, capacitive raw reads 0 or NaN, but we record exact fault status
            observed_moisture = 0.0
            soil_dryness_pct = 0.0
        else:
            soil_status = "HEALTHY"

        records.append({
            "timestamp": current_time.strftime("%Y-%m-%d %H:%M:%S"),
            "device_id": device_id,
            "scenario": scenario,
            # Ground truth physical water state (strictly for evaluation analysis)
            "true_soil_moisture_pct": round(true_moisture, 2),
            # Telemetry observations available to ML model
            "soil_adc": soil_adc,
            "soil_moisture_pct": round(observed_moisture, 2),
            "soil_dryness_pct": round(soil_dryness_pct, 2),
            "soil_status": soil_status,
            "temperature_c": round(temperature_c, 2),
            "humidity_pct": round(humidity_pct, 1),
            "rainfall_mm": round(rainfall_mm, 2),
            "forecast_rain_mm": round(forecast_rain_mm, 2),
            "et0_mm_day": round(et0_mm_day, 2),
            "surface_wetness_pct": round(surface_wetness_pct, 1),
            "is_raining": int(is_raining),
            "crop_profile": crop_profile,
            "kc_factor": kc_factor,
            "mad_threshold_pct": mad_threshold_pct,
            "reservoir_level_pct": round(reservoir_level_pct, 1),
            "reservoir_status": reservoir_status,
            "pump_active": pump_active,
            "irrigation_litres": round(irrigation_litres, 1),
        })

    df = pd.DataFrame(records)
    return df


def main():
    print("=" * 70)
    print("KRISHI SETU - Synthetic Telemetry Data Generator")
    print("STATUS: SIMULATED / DEVELOPMENT DATA - NOT VALIDATED FIELD TELEMETRY")
    print("=" * 70)

    n_hours = 5000
    df = generate_synthetic_dataset(n_hours=n_hours, random_seed=RANDOM_SEED)

    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = RAW_DATA_DIR / "synthetic_telemetry.csv"
    meta_path = RAW_DATA_DIR / "metadata.json"

    df.to_csv(csv_path, index=False)

    metadata = {
        "dataset_name": "krishi_setu_synthetic_telemetry_v1",
        "dataset_type": "SIMULATED / DEVELOPMENT DATA",
        "notice": "Never describe model performance on synthetic data as validated real-world agricultural accuracy.",
        "generated_at": datetime.now().isoformat(),
        "total_observations": len(df),
        "random_seed": RANDOM_SEED,
        "time_range_start": df["timestamp"].iloc[0],
        "time_range_end": df["timestamp"].iloc[-1],
        "sampling_interval": "1 hour",
        "scenarios": df["scenario"].value_counts().to_dict(),
        "fault_count": int((df["soil_status"] == "FAULT").sum()),
        "irrigation_events": int((df["irrigation_litres"] > 0).sum()),
        "rain_events": int((df["rainfall_mm"] > 0).sum()),
        "mean_temperature_c": float(round(df["temperature_c"].mean(), 2)),
        "mean_soil_moisture_pct": float(round(df["soil_moisture_pct"].mean(), 2)),
    }

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"Generated {len(df)} sequential hourly observations.")
    print(f"Saved dataset  -> {csv_path}")
    print(f"Saved metadata -> {meta_path}")
    print(f"Rain events: {metadata['rain_events']} | Irrigation events: {metadata['irrigation_events']} | Faults: {metadata['fault_count']}")
    print("Done.\n")


if __name__ == "__main__":
    main()
