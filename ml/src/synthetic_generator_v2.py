"""
KRISHI SETU Synthetic Telemetry Generator (V2)
==============================================
Generates a multi-season, cyclical 6,000-hour sequential physical simulation.
Ensures representative distribution of critical agronomic regimes across ALL chronological splits:
- Training (0 to 4200h)
- Validation (4200 to 5100h)
- Test (5100 to 6000h)

All splits contain:
- Normal dry-downs
- High-ET0 heat waves
- Heavy rainstorms & near-saturation drainage
- Severe droughts approaching wilting point
- Calibrated drip irrigation & post-irrigation recovery
- Explicit forecast_rain_next_3h_mm feature (short-term forecast without target leakage)
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


def generate_synthetic_dataset_v2(
    n_hours: int = 6000,
    start_time: str = "2026-01-01 00:00:00",
    random_seed: int = RANDOM_SEED,
    device_id: str = DEFAULT_DEVICE_ID,
) -> pd.DataFrame:
    """
    Generates n_hours of sequential physical simulation data using repeating multi-regime cycles.
    """
    np.random.seed(random_seed)
    balance = SoilWaterBalance()

    base_time = datetime.fromisoformat(start_time)

    # Pre-generate raw meteorological forcing to allow realistic 3-hour forward nowcasting
    # without target leakage
    cycle_length = 900  # 900-hour repeating macro-season cleanly aligning with Val (900h) and Test (900h)

    # 1. First pass: Determine meteorological conditions and precipitation sequence
    raw_weather: List[Dict[str, Any]] = []

    for step in range(n_hours):
        current_time = base_time + timedelta(hours=step)
        hour = current_time.hour
        sh = step % cycle_length

        # 5 distinct chronological agronomic blocks within the 900-hour season
        if sh < 200:
            regime = "NORMAL_BALANCED"
            t_base, t_amp = 26.0, 5.0
            h_base = 65.0
            et0_base = 4.2
            rain_prob = 0.02
            rain_scale = 4.0
            irr_trigger = 26.5
            irr_amount = 25.0
        elif sh < 350:
            regime = "HOT_HIGH_ET0"
            t_base, t_amp = 36.0, 7.0
            h_base = 32.0
            et0_base = 7.5
            rain_prob = 0.01
            rain_scale = 3.0
            irr_trigger = 25.0
            irr_amount = 25.0
        elif sh < 570:
            regime = "EXTENDED_DROUGHT_WILTING"
            t_base, t_amp = 34.0, 6.5
            h_base = 28.0
            et0_base = 7.0
            rain_prob = 0.001
            rain_scale = 1.0
            # Pumps locked out during drought until reaching critical near-wilting threshold
            irr_trigger = 15.5
            irr_amount = 30.0
        elif sh < 750:
            regime = "HEAVY_MONSOON_STORM"
            t_base, t_amp = 23.0, 3.5
            h_base = 92.0
            et0_base = 2.0
            rain_prob = 0.30
            rain_scale = 24.0
            irr_trigger = -1.0
            irr_amount = 0.0
        else:
            regime = "PASSING_SHOWERS_RECOVERY"
            t_base, t_amp = 25.5, 4.5
            h_base = 72.0
            et0_base = 3.5
            rain_prob = 0.08
            rain_scale = 8.0
            irr_trigger = 27.5
            irr_amount = 20.0

        # Diurnal temperature cycle
        solar_angle = 2.0 * np.pi * (hour - 14) / 24.0
        temp = t_base + t_amp * np.cos(solar_angle) + np.random.normal(0, 0.5)
        temp_c = float(np.clip(temp, 10.0, 48.0))

        # Diurnal humidity
        humid = h_base - (t_amp * 2.0) * np.cos(solar_angle) + np.random.normal(0, 1.5)
        humid_pct = float(np.clip(humid, 15.0, 99.0))

        # Daily reference ET0
        et0 = float(np.clip(et0_base * (temp_c / t_base) + np.random.normal(0, 0.15), 1.0, 10.0))

        # Precipitation
        if np.random.random() < rain_prob:
            rain = float(min(55.0, round(np.random.exponential(scale=rain_scale), 1)))
        else:
            rain = 0.0

        raw_weather.append({
            "step": step,
            "timestamp": current_time,
            "regime": regime,
            "hour": hour,
            "day_of_year": current_time.timetuple().tm_yday,
            "temperature_c": temp_c,
            "humidity_pct": humid_pct,
            "et0_mm_day": et0,
            "observed_rain_mm": rain,
            "irr_trigger": irr_trigger,
            "irr_amount": irr_amount,
        })

    # 2. Second pass: Compute realistic 3-hour nowcast forecast
    for i in range(n_hours):
        # Actual future rainfall in the next 3 hours
        future_rain_actual = sum(raw_weather[j]["observed_rain_mm"] for j in range(i + 1, min(n_hours, i + 4)))

        # Meteorological forecast skill:
        # 85% accurate prediction + minor uncertainty / false alarms
        if future_rain_actual > 0:
            forecast_val = future_rain_actual * np.random.uniform(0.78, 1.12) + np.random.exponential(scale=0.15)
        else:
            # 4% chance of false-alarm light drizzle forecast
            forecast_val = np.random.exponential(scale=0.35) if np.random.random() < 0.04 else 0.0

        raw_weather[i]["forecast_rain_next_3h_mm"] = float(round(max(0.0, forecast_val), 2))
        raw_weather[i]["forecast_rain_24h_mm"] = float(round(max(0.0, future_rain_actual * 2.2 + np.random.exponential(scale=1.0)), 2))

    # 3. Third pass: Run hydrodynamic simulation with real soil state
    records: List[Dict[str, Any]] = []
    true_moisture = 30.0  # Start at balanced optimal 30%
    crop_profile = "Tomato (Vegetative)"
    kc_factor = 0.85
    mad_threshold_pct = 50.0

    for w in raw_weather:
        hour = w["hour"]
        rain_mm = w["observed_rain_mm"]
        regime = w["regime"]
        irr_trigger = w["irr_trigger"]
        irr_amount = w["irr_amount"]

        is_raining = 1 if rain_mm > 0.1 else 0
        if is_raining:
            surface_wetness = float(np.clip(75.0 + rain_mm * 1.8 + np.random.normal(0, 4.0), 70.0, 100.0))
        else:
            surface_wetness = float(np.clip(np.random.exponential(scale=2.5), 0.0, 30.0))

        # Irrigation logic
        irrigation_litres = 0.0
        pump_active = 0
        if not is_raining and irr_trigger > 0 and true_moisture <= irr_trigger:
            irrigation_litres = irr_amount
            pump_active = 1

        # Physical water balance step
        flux = balance.step(
            current_moisture_pct=true_moisture,
            rainfall_mm=rain_mm,
            irrigation_litres=irrigation_litres,
            et0_mm_day=w["et0_mm_day"],
            kc_factor=kc_factor,
            mad_threshold_pct=mad_threshold_pct,
            hour=hour,
        )
        true_moisture = flux["next_moisture_pct"]

        # Sensor noise & hardware modeling
        sensor_noise = np.random.normal(0, SENSOR_NOISE_STD)
        observed_moisture = float(np.clip(true_moisture + sensor_noise, 0.0, 100.0))
        soil_dryness = float(np.clip(100.0 - observed_moisture, 0.0, 100.0))

        ideal_adc = ADC_DRY - (observed_moisture / 100.0) * (ADC_DRY - ADC_WET)
        soil_adc = int(np.clip(ideal_adc + np.random.normal(0, 10), 0, 4095))

        # Fault injection
        is_fault = np.random.random() < FAULT_PROBABILITY
        if is_fault:
            soil_status = "FAULT"
            soil_adc = int(np.random.choice([0, 4095]))
            observed_moisture = 0.0
            soil_dryness = 0.0
        else:
            soil_status = "HEALTHY"

        res_level = float(np.clip(80.0 - (w["step"] * 0.008) % 45.0 + (rain_mm * 1.5), 15.0, 100.0))

        records.append({
            "timestamp": w["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
            "device_id": device_id,
            "scenario": regime,
            "true_soil_moisture_pct": round(true_moisture, 2),
            "soil_adc": soil_adc,
            "soil_moisture_pct": round(observed_moisture, 2),
            "soil_dryness_pct": round(soil_dryness, 2),
            "soil_status": soil_status,
            "temperature_c": round(w["temperature_c"], 2),
            "humidity_pct": round(w["humidity_pct"], 1),
            "observed_rain_mm": round(rain_mm, 2),
            "forecast_rain_next_3h_mm": w["forecast_rain_next_3h_mm"],
            "forecast_rain_24h_mm": w["forecast_rain_24h_mm"],
            "et0_mm_day": round(w["et0_mm_day"], 2),
            "surface_wetness_pct": round(surface_wetness, 1),
            "is_raining": is_raining,
            "crop_profile": crop_profile,
            "kc_factor": kc_factor,
            "mad_threshold_pct": mad_threshold_pct,
            "reservoir_level_pct": round(res_level, 1),
            "reservoir_status": "HEALTHY",
            "pump_active": pump_active,
            "irrigation_litres": round(irrigation_litres, 1),
        })

    df = pd.DataFrame(records)
    return df


def main():
    print("=" * 75)
    print("KRISHI SETU - Synthetic Telemetry Data Generator V2")
    print("STATUS: SIMULATED / DEVELOPMENT DATA - NOT VALIDATED FIELD TELEMETRY")
    print("=" * 75)

    n_hours = 6000
    df = generate_synthetic_dataset_v2(n_hours=n_hours, random_seed=RANDOM_SEED)

    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = RAW_DATA_DIR / "synthetic_telemetry_v2.csv"
    meta_path = RAW_DATA_DIR / "metadata_v2.json"

    df.to_csv(csv_path, index=False)

    metadata = {
        "dataset_name": "krishi_setu_synthetic_telemetry_v2",
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
        "rain_events": int((df["observed_rain_mm"] > 0).sum()),
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
