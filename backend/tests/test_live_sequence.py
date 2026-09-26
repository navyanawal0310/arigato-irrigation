"""
Script to test continuous collection sequence of 4 observations into MongoDB Atlas.
"""

from datetime import datetime, timezone, timedelta
from backend.app.telemetry_mapper import map_esp32_telemetry
from backend.app.database import get_telemetry_collection
from backend.app.schemas import serialize_mongo_document

def run_test():
    coll = get_telemetry_collection()
    base_time = datetime.now(timezone.utc)

    base_payload = {
        'system': {
            'name': 'AquaMatrix-MaxCore',
            'firmware': '2.4.0-PRO',
            'uptime_sec': 1420,
            'free_heap': 186412,
            'wifi_rssi': -52,
            'wifi_status': 'CONNECTED',
            'anomaly': False
        },
        'crop': {'profile_id': 1, 'name': 'Tomato (Vegetative)', 'kc_factor': 0.85},
        'soil': {'raw_adc': 341, 'moisture_pct': 38.2, 'dryness_pct': 61.8, 'status': 'HEALTHY'},
        'drainage': {'infiltration_rate_pct_min': 0.32, 'status': 'OPTIMAL'},
        'rain_sensor': {'raw_adc': 4095, 'surface_wetness_pct': 0.0, 'is_raining': False},
        'reservoir': {'distance_cm': 999.0, 'level_pct': -1.0, 'status': 'OUT_OF_RANGE'},
        'atmosphere': {'temp_c': 28.4, 'humidity_pct': 54.0, 'et0_fao56_mm': 4.52},
        'decision': {'action': 'LOCKOUT_TANK_FAULT', 'reason': 'Tank sensor out of range', 'pump_active': False},
        'model': {'crop_et_mm': 3.84, 'prescribed_litres': 0.0},
        'nvs': {'daily_water_litres': 12.5, 'pump_cycles_count': 0}
    }

    print('=== TESTING CONTINUOUS COLLECTION SEQUENCE (4 OBSERVATIONS) ===')
    inserted_ids = []

    for i in range(1, 5):
        p = dict(base_payload)
        p['system'] = dict(base_payload['system'])
        uptime = 1420 + (i * 30)
        p['system']['uptime_sec'] = uptime
        p['soil'] = dict(base_payload['soil'])
        adc = 341 + i
        p['soil']['raw_adc'] = adc
        obs_time = base_time + timedelta(seconds=i * 30)

        doc = map_esp32_telemetry(p, source='esp32', recorded_at=obs_time)
        res = coll.insert_one(doc)
        inserted_ids.append(res.inserted_id)
        print(f"Observation {i}: ID={res.inserted_id} | Time={obs_time.isoformat()} | Uptime={uptime}s | Soil ADC={adc} | Tank Status={p['reservoir']['status']}")

    # Verify timestamps increase
    docs = list(coll.find({'_id': {'$in': inserted_ids}}).sort('recorded_at', 1))
    times = [d['recorded_at'] for d in docs]
    is_increasing = all(times[j] < times[j+1] for j in range(len(times)-1))
    print(f"Timestamps strictly increasing: {is_increasing}")

    # Verify sensor faults are preserved
    tank_statuses = [d['reservoir']['status'] for d in docs]
    tank_levels = [d['reservoir']['level_pct'] for d in docs]
    print(f"Tank statuses preserved: {set(tank_statuses)}")
    print(f"Tank levels (-1 sentinel preserved): {set(tank_levels)}")

    # Verify quality flags correctly mark reservoir as invalid
    res_valid_flags = [d['quality']['reservoir_valid'] for d in docs]
    soil_valid_flags = [d['quality']['soil_valid'] for d in docs]
    print(f"Reservoir valid flags (must all be False): {set(res_valid_flags)}")
    print(f"Soil valid flags (must all be True): {set(soil_valid_flags)}")

    total_count = coll.count_documents({})
    print(f"Total documents currently in krishi_setu.telemetry: {total_count}")

if __name__ == '__main__':
    run_test()
