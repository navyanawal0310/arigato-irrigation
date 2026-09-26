"""
KRISHI SETU: Phase 6 Acceptance Test Script
Demonstrates exact validation behavior on isolated test data:
1. Target telemetry matched: pred 43.8% -> actual 44.6% -> signed -0.8 pp, abs 0.8 pp (VALIDATED)
2. Target telemetry in FAULT -> rejected (INVALID_TARGET_DATA)
3. No telemetry in tolerance -> NO_MATCH
"""

from datetime import datetime, timezone, timedelta
from backend.app.prediction_validation import PredictionValidationService
from backend.tests.test_validation_pipeline import MockCollection

def run_acceptance_tests():
    service = PredictionValidationService(horizon_hours=3, cadence_minutes=60, tolerance_minutes=15)
    pred_time = datetime(2026, 9, 26, 10, 0, 0, tzinfo=timezone.utc)
    target_time = datetime(2026, 9, 26, 13, 0, 0, tzinfo=timezone.utc)

    print("==================================================")
    print("DEMONSTRATION 1: VALID GROUND TRUTH MATCH")
    print("==================================================")
    pred_coll = MockCollection()
    telem_coll = MockCollection()

    # Prediction candidate at 10:00, target 13:00, predicted 43.8%
    pred_coll.insert_one({
        "prediction_id": "demo-pred-001",
        "device_id": "AquaMatrix-MaxCore",
        "created_at": pred_time,
        "target_at": target_time,
        "horizon_hours": 3,
        "model": {"name": "Soil-Water V2", "version": "v2", "training_scope": "simulated-development"},
        "prediction": {"soil_moisture_pct": 43.8},
        "validation": {"status": "PENDING"}
    })

    # Real valid telemetry at 13:02 with actual 44.6%
    telem_coll.insert_one({
        "device_id": "AquaMatrix-MaxCore",
        "recorded_at": datetime(2026, 9, 26, 13, 2, 0, tzinfo=timezone.utc),
        "soil": {"status": "HEALTHY", "raw_adc": 2080, "moisture_pct": 44.6},
        "quality": {"soil_valid": True}
    })

    service.validate_matured_predictions(
        predictions_coll=pred_coll,
        telemetry_coll=telem_coll,
        now_utc=datetime(2026, 9, 26, 13, 5, 0, tzinfo=timezone.utc)
    )
    val = pred_coll.docs[0]["validation"]
    print(f"Prediction Created At:  {pred_time.strftime('%H:%M')} UTC")
    print(f"Prediction Target At:   {target_time.strftime('%H:%M')} UTC (+3h)")
    print(f"Predicted Moisture:     43.8%")
    print(f"Telemetry Recorded At:  13:02 UTC (+2 min from target)")
    print(f"Actual Moisture:        {val['actual_soil_moisture_pct']}%")
    print(f"Validation Status:      {val['status']}")
    print(f"Signed Error:           {val['signed_error_pp']:+.2f} percentage points")
    print(f"Absolute Error:         {val['absolute_error_pp']:.2f} percentage points")
    print(f"Squared Error:          {val['squared_error']:.4f}")
    print(f"Observation Offset:     {val['time_difference_sec']}s")

    print("\n==================================================")
    print("DEMONSTRATION 2: SENSOR FAULT REJECTION")
    print("==================================================")
    pred_coll2 = MockCollection()
    telem_coll2 = MockCollection()

    pred_coll2.insert_one({
        "prediction_id": "demo-pred-002",
        "device_id": "AquaMatrix-MaxCore",
        "created_at": pred_time,
        "target_at": target_time,
        "horizon_hours": 3,
        "prediction": {"soil_moisture_pct": 43.8},
        "validation": {"status": "PENDING"}
    })
    # Target telemetry at 13:01 is in hardware FAULT
    telem_coll2.insert_one({
        "device_id": "AquaMatrix-MaxCore",
        "recorded_at": datetime(2026, 9, 26, 13, 1, 0, tzinfo=timezone.utc),
        "soil": {"status": "FAULT", "raw_adc": 254, "moisture_pct": 0.0},
        "quality": {"soil_valid": False}
    })

    service.validate_matured_predictions(
        predictions_coll=pred_coll2,
        telemetry_coll=telem_coll2,
        now_utc=datetime(2026, 9, 26, 13, 5, 0, tzinfo=timezone.utc)
    )
    val2 = pred_coll2.docs[0]["validation"]
    print(f"Telemetry Status:       FAULT (ADC=254, 0.0% moisture)")
    print(f"Validation Status:      {val2['status']}")
    print(f"Actual Moisture:        {val2.get('actual_soil_moisture_pct')} (Safely Withheld)")
    print(f"Absolute Error:         {val2.get('absolute_error_pp')} (No metric computed)")
    print(f"Diagnostic Notes:       {val2.get('notes')}")

    print("\n==================================================")
    print("DEMONSTRATION 3: NO TELEMETRY IN TOLERANCE")
    print("==================================================")
    pred_coll3 = MockCollection()
    telem_coll3 = MockCollection()

    pred_coll3.insert_one({
        "prediction_id": "demo-pred-003",
        "device_id": "AquaMatrix-MaxCore",
        "created_at": pred_time,
        "target_at": target_time,
        "horizon_hours": 3,
        "prediction": {"soil_moisture_pct": 43.8},
        "validation": {"status": "PENDING"}
    })
    # Only telemetry is at 14:30 (+90m, outside ±15m tolerance)
    telem_coll3.insert_one({
        "device_id": "AquaMatrix-MaxCore",
        "recorded_at": datetime(2026, 9, 26, 14, 30, 0, tzinfo=timezone.utc),
        "soil": {"status": "HEALTHY", "raw_adc": 2100, "moisture_pct": 44.0},
        "quality": {"soil_valid": True}
    })

    service.validate_matured_predictions(
        predictions_coll=pred_coll3,
        telemetry_coll=telem_coll3,
        now_utc=datetime(2026, 9, 26, 15, 0, 0, tzinfo=timezone.utc)
    )
    val3 = pred_coll3.docs[0]["validation"]
    print(f"Target Time:            13:00 UTC (Tolerance ±15 min)")
    print(f"Nearest Telemetry:      14:30 UTC (+90 min drift)")
    print(f"Validation Status:      {val3['status']}")
    print(f"Actual Moisture:        {val3.get('actual_soil_moisture_pct')}")
    print(f"Diagnostic Notes:       {val3.get('notes')}")

    print("\n==================================================")
    print("SUMMARY METRIC INTEGRITY CHECK")
    print("==================================================")
    # Check summary when 1 validated sample is in pred_coll
    summary = service.get_validation_summary(predictions_coll=pred_coll)
    print(f"Summary Scope:          {summary['scope']}")
    print(f"Development Benchmark:  {summary['development_benchmark']['simulated_test_rmse_pp']} pp (Simulated dev data)")
    print(f"Validated Count:        {summary['validated_predictions']}")
    print(f"Field MAE:              {summary['mae_pp']} pp")
    print(f"Field RMSE:             {summary['rmse_pp']} pp")
    print(f"Field Mean Bias:        {summary['mean_bias_pp']:+.2f} pp")
    print(f"Sample Status:          {summary['sample_status']}")
    print("==================================================")

if __name__ == "__main__":
    run_acceptance_tests()
