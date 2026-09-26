"""
KRISHI SETU: Forecast-Aware Irrigation Intelligence Engine (Phase 5)
====================================================================
Transforms sensory telemetry, atmospheric forecasts, crop coefficients,
and ML soil-water predictions into an EXPLAINABLE agronomic directive.

STRICT SEPARATION OF CONCERNS:
1. OBSERVATION:  Validates physical telemetry (soil, reservoir, rain, atmosphere).
2. ML FORECAST:  Predicts 3-hour forward root-zone soil moisture (Soil-Water V2).
3. AGRONOMY:     Evaluates crop MAD deficit, FAO-56 evapotranspiration, and rain avoidance.
4. SAFETY GATE:  Deterministic overrides (sensor faults, empty reservoir, cavitations).
5. DIRECTIVE:    Final explainable action: IRRIGATE, HOLD, STOP, LOCKOUT, INSUFFICIENT_DATA.

SAFETY PRECEDENCE (Strict Hierarchy):
CRITICAL SAFETY FAILURE > SENSOR VALIDITY > WATER AVAILABILITY > RAIN AVOIDANCE > CROP WATER NEED > ML FORECAST

CRITICAL CONSTRAINTS:
- ML never directly actuates or commands the pump.
- Frontend simulated reservoir (64%) NEVER enters this backend decision engine.
- Safety overrides always prevail over ML or agronomic desire.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
import math
import logging

from backend.app.database import get_telemetry_collection
from backend.app.ml_inference import inference_service, is_finite_number

logger = logging.getLogger("krishi_setu.irrigation_intelligence")

# --- AGRONOMIC & PHYSICAL BENCHMARK CONSTANTS ---
# Reference Soil Type: Sandy Clay Loam (Solanaceae calibrated)
FIELD_CAPACITY_PCT = 35.0          # Soil moisture at field capacity (%)
WILTING_POINT_PCT = 12.0           # Soil moisture at permanent wilting point (%)
DEFAULT_MAD_PCT = 50.0             # Management Allowed Depletion (%)
CRITICAL_TANK_PCT = 15.0           # Anti-cavitation run-dry protection lockout (%)
USEFUL_RAIN_THRESHOLD_MM = 3.0     # FAO-56 effective infiltration threshold for solanaceous root zones
ACTIVE_RAIN_WETNESS_THRESHOLD = 65.0  # Optical plate wetness threshold indicating active falling rain (%)


def calculate_stress_threshold(fc: float, wp: float, mad_pct: float) -> float:
    """Calculates soil moisture percentage below which crop experiences water stress."""
    taw = max(0.0, fc - wp)
    raw = taw * (mad_pct / 100.0)
    return round(fc - raw, 2)


class IrrigationIntelligenceService:
    """
    Explainable, forecast-aware irrigation recommendation engine.
    """

    def __init__(self):
        self.useful_rain_threshold_mm = USEFUL_RAIN_THRESHOLD_MM
        self.critical_tank_pct = CRITICAL_TANK_PCT
        self.default_fc = FIELD_CAPACITY_PCT
        self.default_wp = WILTING_POINT_PCT
        self.default_mad = DEFAULT_MAD_PCT

    def get_recommendation(
        self,
        device_id: Optional[str] = None,
        scenario: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Computes an explainable irrigation recommendation.
        If scenario is provided, evaluates an isolated demonstration state without modifying any real data.
        Otherwise, evaluates live MongoDB Atlas telemetry and the V2 ML inference service.
        """
        if scenario and scenario.lower() not in ["live", "none", ""]:
            return self._evaluate_scenario(scenario.lower())

        # Production path: retrieve latest verified telemetry document
        coll = get_telemetry_collection()
        query = {"device_id": device_id} if device_id else {}
        latest_doc = coll.find_one(query, sort=[("recorded_at", -1)])

        if not latest_doc:
            return self._generate_insufficient_data_response(
                reason="No telemetry documents found in database.",
                device_id=device_id or "unknown",
            )

        # Run ML inference on the latest document
        try:
            ml_pred = inference_service.predict_for_document(latest_doc, coll=coll)
        except Exception as e:
            logger.error(f"ML inference invocation failed: {e}", exc_info=True)
            ml_pred = {"status": "model_error", "reason": "INFERENCE_INVOCATION_EXCEPTION", "details": str(e)}

        return self._evaluate(latest_doc, ml_pred=ml_pred, scenario_name="live")

    def _evaluate(
        self,
        doc: Dict[str, Any],
        ml_pred: Optional[Dict[str, Any]] = None,
        scenario_name: str = "live",
    ) -> Dict[str, Any]:
        """
        Executes the 5-layer explainable decision hierarchy on a telemetry document.
        """
        device_id = doc.get("device_id", "AquaMatrix-MaxCore")
        recorded_at = doc.get("recorded_at")
        if isinstance(recorded_at, datetime):
            timestamp_str = recorded_at.isoformat()
        else:
            timestamp_str = str(recorded_at or datetime.now(timezone.utc).isoformat())

        # Extract subdocuments
        soil = doc.get("soil", {})
        reservoir = doc.get("reservoir", {})
        rain = doc.get("rain_sensor", {})
        atmosphere = doc.get("atmosphere") or doc.get("weather") or {}
        crop = doc.get("crop", {})
        quality = doc.get("quality", {})

        # 1. PARSE OBSERVATIONS
        raw_soil_adc = soil.get("raw_adc") if "raw_adc" in soil else soil.get("adc_raw")
        soil_status = str(soil.get("status", "")).upper()
        soil_moisture_raw = soil.get("moisture_pct") if "moisture_pct" in soil else soil.get("moisture_index")
        soil_valid = (
            soil_status in ["HEALTHY", "OK"]
            and quality.get("soil_valid", True) is not False
            and is_finite_number(soil_moisture_raw)
            and (raw_soil_adc is None or (300 <= raw_soil_adc <= 3800))
        )
        current_moisture = float(soil_moisture_raw) if (soil_valid and is_finite_number(soil_moisture_raw)) else None

        # Reservoir: raw level from database (strictly NOT frontend 64% fallback)
        res_level_raw = reservoir.get("level_pct") if "level_pct" in reservoir else reservoir.get("level_percent")
        res_status = str(reservoir.get("status", "")).upper()
        res_valid = (
            res_status not in ["OUT_OF_RANGE", "FAULT", "ERROR", "DISCONNECTED", "INVALID"]
            and quality.get("reservoir_valid", True) is not False
            and is_finite_number(res_level_raw)
            and (float(res_level_raw) >= 0.0)
        )
        res_level = float(res_level_raw) if res_valid else -1.0

        # Rain Sensor
        is_raining = bool(rain.get("is_raining", False))
        surface_wetness = float(rain.get("surface_wetness_pct", 0.0)) if is_finite_number(rain.get("surface_wetness_pct")) else 0.0

        # Atmosphere & Forecast
        temp_c = float(atmosphere.get("temp_c", 25.0)) if is_finite_number(atmosphere.get("temp_c")) else 25.0
        humidity_pct = float(atmosphere.get("humidity_pct", 60.0)) if is_finite_number(atmosphere.get("humidity_pct")) else 60.0
        et0_val = atmosphere.get("et0_fao56_mm") if "et0_fao56_mm" in atmosphere else atmosphere.get("et0_mm_day")
        et0_mm = float(et0_val) if is_finite_number(et0_val) else 4.5
        forecast_rain_val = atmosphere.get("forecast_rain_next_3h_mm")
        if forecast_rain_val is None:
            forecast_rain_val = atmosphere.get("forecast_rain_mm", 0.0)
        forecast_rain_3h = float(forecast_rain_val) if is_finite_number(forecast_rain_val) else 0.0

        # Crop Parameters
        crop_id = crop.get("profile_id", "TOMATO_VEG")
        crop_name = crop.get("name", "Tomato (Vegetative)")
        kc_factor = float(crop.get("kc_factor", 0.85)) if is_finite_number(crop.get("kc_factor")) else 0.85
        mad_threshold_pct = float(crop.get("mad_threshold_pct", self.default_mad)) if is_finite_number(crop.get("mad_threshold_pct")) else self.default_mad
        stress_threshold = calculate_stress_threshold(self.default_fc, self.default_wp, mad_threshold_pct)

        # 2. PARSE ML PREDICTION
        ml_used = False
        predicted_moisture = None
        ml_change_pct = None
        ml_reason = None
        if ml_pred and ml_pred.get("status") == "ok":
            ml_used = True
            predicted_moisture = float(ml_pred.get("predicted_soil_moisture_pct"))
            ml_change_pct = float(ml_pred.get("change_pct_points", 0.0))
        else:
            ml_reason = (ml_pred.get("reason") if ml_pred else None) or "UNAVAILABLE"

        # 3. EVALUATE PRECEDENCE HIERARCHY
        directive: str
        headline: str
        reason: str
        safety_override = False
        safety_reason: Optional[str] = None
        decision_trace: List[str] = []
        factors: List[Dict[str, Any]] = []

        # Trace Step 1: Soil moisture evaluation
        if not soil_valid:
            decision_trace.append(f"1. Soil moisture evaluated: FAULT (ADC={raw_soil_adc}, status='{soil_status}') - Sensor invalid.")
        else:
            decision_trace.append(f"1. Soil moisture evaluated: {current_moisture:.1f}% (MAD stress threshold: {stress_threshold:.1f}%).")

        # Trace Step 2: ML prediction evaluation
        if ml_used:
            decision_trace.append(f"2. +3h prediction evaluated: {predicted_moisture:.1f}% ({ml_change_pct:+.1f}% points forward trend).")
        else:
            decision_trace.append(f"2. +3h prediction evaluated: UNAVAILABLE ({ml_reason}) - Deterministic agronomic fallback active.")

        # Trace Step 3: Evapotranspiration evaluation
        crop_et = round(et0_mm * kc_factor, 2)
        decision_trace.append(f"3. ET0/crop demand evaluated: ET0={et0_mm:.1f} mm/d * Kc={kc_factor:.2f} -> Crop demand: {crop_et:.2f} mm/d.")

        # Trace Step 4: Rain forecast evaluation
        decision_trace.append(f"4. Rain forecast evaluated: {forecast_rain_3h:.1f} mm expected in 3h (threshold: {self.useful_rain_threshold_mm:.1f} mm).")

        # Trace Step 5 & 6: Precedence evaluation & directive selection

        # --- LEVEL 1: CRITICAL SENSOR VALIDITY (Highest Precedence) ---
        if not soil_valid:
            directive = "LOCKOUT"
            headline = "Safety Lockout: Soil Sensor Fault"
            reason = (
                f"Soil moisture probe reporting hardware FAULT (ADC={raw_soil_adc}, status='{soil_status}'). "
                f"Irrigation locked out to prevent catastrophic uncalibrated watering."
            )
            safety_override = True
            safety_reason = "SOIL_SENSOR_FAULT"
            decision_trace.append("5. Safety constraints evaluated: CRITICAL FAILURE on soil sensor.")
            decision_trace.append("6. Final directive selected: LOCKOUT (Safety override active).")

            factors.append({
                "name": "Soil Sensor Integrity",
                "value": f"FAULT (ADC {raw_soil_adc})",
                "effect": "safety_override",
                "provenance": "SAFETY RULE",
            })
            factors.append({
                "name": "Predicted Moisture (+3h)",
                "value": "Safely Withheld",
                "effect": "neutral",
                "provenance": "ML V2",
            })
            factors.append({
                "name": "Rain Forecast",
                "value": f"{forecast_rain_3h:.1f} mm",
                "effect": "neutral",
                "provenance": "WEATHER FORECAST",
            })

        # --- LEVEL 2: WATER AVAILABILITY / RESERVOIR HEALTH ---
        elif not res_valid:
            directive = "LOCKOUT"
            headline = "Safety Lockout: Reservoir Sensor Fault"
            reason = "Storage reservoir ultrasonic sensor is OUT_OF_RANGE (no echo). Pump locked out to prevent dry-running damage."
            safety_override = True
            safety_reason = "RESERVOIR_SENSOR_FAULT"
            decision_trace.append("5. Safety constraints evaluated: CRITICAL FAILURE on reservoir sensor.")
            decision_trace.append("6. Final directive selected: LOCKOUT (Safety override active).")

            factors.append({
                "name": "Reservoir Level",
                "value": "OUT_OF_RANGE (No Echo)",
                "effect": "safety_override",
                "provenance": "SAFETY RULE",
            })
            factors.append({
                "name": "Current Soil Moisture",
                "value": f"{current_moisture:.1f}%",
                "effect": "supports_irrigation" if current_moisture <= stress_threshold else "supports_holding",
                "provenance": "LIVE SENSOR",
            })
            factors.append({
                "name": "Forecast Rainfall",
                "value": f"{forecast_rain_3h:.1f} mm",
                "effect": "neutral",
                "provenance": "WEATHER FORECAST",
            })

        elif res_level <= self.critical_tank_pct:
            directive = "LOCKOUT"
            headline = "Safety Lockout: Reservoir Depleted"
            reason = f"Reservoir storage is critically low ({res_level:.1f}% <= {self.critical_tank_pct:.0f}%). Anti-cavitation lockout active."
            safety_override = True
            safety_reason = "RESERVOIR_DEPLETED"
            decision_trace.append(f"5. Safety constraints evaluated: Reservoir depleted ({res_level:.1f}% <= {self.critical_tank_pct:.0f}%).")
            decision_trace.append("6. Final directive selected: LOCKOUT (Safety override active).")

            factors.append({
                "name": "Reservoir Level",
                "value": f"{res_level:.1f}% (Critically Low)",
                "effect": "safety_override",
                "provenance": "SAFETY RULE",
            })

        # --- LEVEL 3: ACTIVE PRECIPITATION (Observed) ---
        elif is_raining or surface_wetness >= ACTIVE_RAIN_WETNESS_THRESHOLD:
            directive = "HOLD"
            headline = "Active Precipitation Detected"
            reason = f"Physical rain sensor detects active precipitation (surface wetness: {surface_wetness:.0f}%). Irrigation suspended."
            decision_trace.append(f"5. Safety constraints evaluated: Rain sensor indicates active precipitation (wetness={surface_wetness:.0f}%).")
            decision_trace.append("6. Final directive selected: HOLD (Active rain).")

            factors.append({
                "name": "Physical Rain Sensor",
                "value": "Raining (Active)",
                "effect": "supports_holding",
                "provenance": "LIVE SENSOR",
            })
            factors.append({
                "name": "Current Soil Moisture",
                "value": f"{current_moisture:.1f}%",
                "effect": "neutral",
                "provenance": "LIVE SENSOR",
            })

        # --- LEVEL 4: RAINFALL FORECAST (Avoidance) ---
        elif forecast_rain_3h >= self.useful_rain_threshold_mm:
            directive = "HOLD"
            headline = "Rain Expected — Irrigation Deferred"
            reason = (
                f"Soil moisture is trending toward water stress, but useful rainfall ({forecast_rain_3h:.1f} mm >= {self.useful_rain_threshold_mm:.1f} mm) "
                f"is forecast within 3 hours. Irrigation deferred to conserve water and prevent nutrient leaching."
            )
            decision_trace.append(f"5. Weather avoidance evaluated: Forecast rain {forecast_rain_3h:.1f} mm >= threshold {self.useful_rain_threshold_mm:.1f} mm.")
            decision_trace.append("6. Final directive selected: HOLD (Rain forecast avoidance).")

            factors.append({
                "name": "Current Soil Moisture",
                "value": f"{current_moisture:.1f}%",
                "effect": "supports_irrigation" if current_moisture <= stress_threshold else "neutral",
                "provenance": "LIVE SENSOR",
            })
            if ml_used:
                factors.append({
                    "name": "Predicted Moisture (+3h)",
                    "value": f"{predicted_moisture:.1f}%",
                    "effect": "supports_irrigation" if predicted_moisture <= stress_threshold else "neutral",
                    "provenance": "ML V2",
                })
            factors.append({
                "name": "Forecast Rainfall (+3h)",
                "value": f"{forecast_rain_3h:.1f} mm",
                "effect": "supports_holding",
                "provenance": "WEATHER FORECAST",
            })

        # --- LEVEL 5: CROP WATER NEED & ML FORECAST ---
        else:
            is_dry_now = current_moisture <= stress_threshold
            is_predicted_dry = ml_used and (predicted_moisture <= stress_threshold)

            if is_dry_now or is_predicted_dry:
                directive = "IRRIGATE"
                if ml_used and is_predicted_dry:
                    headline = "Irrigation Recommended — Active Deficit & Dry-Down"
                    reason = (
                        f"Root-zone moisture ({current_moisture:.1f}%) is at/near crop stress threshold ({stress_threshold:.1f}%), "
                        f"and ML model projects further dry-down to {predicted_moisture:.1f}% (+3h). "
                        f"Negligible rain forecast ({forecast_rain_3h:.1f} mm)."
                    )
                else:
                    headline = "Irrigation Recommended — Root-Zone Moisture Deficit"
                    reason = (
                        f"Root-zone moisture ({current_moisture:.1f}%) is below crop MAD stress threshold ({stress_threshold:.1f}%). "
                        f"Atmospheric demand is {crop_et:.1f} mm/d with negligible rain forecast ({forecast_rain_3h:.1f} mm)."
                    )
                decision_trace.append(f"5. Agronomic evaluation: Soil deficit confirmed ({current_moisture:.1f}% <= {stress_threshold:.1f}%).")
                decision_trace.append("6. Final directive selected: IRRIGATE (Prescription justified).")

                factors.append({
                    "name": "Current Soil Moisture",
                    "value": f"{current_moisture:.1f}%",
                    "effect": "supports_irrigation",
                    "provenance": "LIVE SENSOR",
                })
                if ml_used:
                    factors.append({
                        "name": "Predicted Moisture (+3h)",
                        "value": f"{predicted_moisture:.1f}%",
                        "effect": "supports_irrigation",
                        "provenance": "ML V2",
                    })
                factors.append({
                    "name": "Forecast Rainfall (+3h)",
                    "value": f"{forecast_rain_3h:.1f} mm",
                    "effect": "supports_irrigation",
                    "provenance": "WEATHER FORECAST",
                })
                factors.append({
                    "name": "Reservoir Level",
                    "value": f"{res_level:.1f}%",
                    "effect": "neutral",
                    "provenance": "LIVE SENSOR",
                })

            else:
                directive = "HOLD"
                headline = "Soil Moisture Optimal — Irrigation Withheld"
                reason = (
                    f"Root-zone soil moisture ({current_moisture:.1f}%) remains safely above the crop MAD stress threshold ({stress_threshold:.1f}%). "
                    f"Root zone has adequate available water."
                )
                decision_trace.append(f"5. Agronomic evaluation: Moisture optimal ({current_moisture:.1f}% > {stress_threshold:.1f}%).")
                decision_trace.append("6. Final directive selected: HOLD (Nominal field storage).")

                factors.append({
                    "name": "Current Soil Moisture",
                    "value": f"{current_moisture:.1f}%",
                    "effect": "supports_holding",
                    "provenance": "LIVE SENSOR",
                })
                if ml_used:
                    factors.append({
                        "name": "Predicted Moisture (+3h)",
                        "value": f"{predicted_moisture:.1f}%",
                        "effect": "supports_holding",
                        "provenance": "ML V2",
                    })
                factors.append({
                    "name": "Forecast Rainfall (+3h)",
                    "value": f"{forecast_rain_3h:.1f} mm",
                    "effect": "neutral",
                    "provenance": "WEATHER FORECAST",
                })

        # Assemble JSON-safe response
        response = {
            "status": "ok",
            "scenario": scenario_name,
            "directive": directive,
            "headline": headline,
            "reason": reason,
            "factors": factors,
            "ml": {
                "used": ml_used,
                "model": "Soil-Water V2",
                "horizon_hours": 3,
                "predicted_soil_moisture_pct": predicted_moisture,
                "current_soil_moisture_pct": current_moisture,
                "change_pct_points": ml_change_pct,
                "reason": ml_reason,
            },
            "weather": {
                "forecast_rain_next_3h_mm": forecast_rain_3h,
                "et0_fao56_mm": et0_mm,
                "crop_et_mm_day": crop_et,
                "temp_c": temp_c,
                "humidity_pct": humidity_pct,
            },
            "crop": {
                "profile_id": crop_id,
                "name": crop_name,
                "kc_factor": kc_factor,
                "mad_threshold_pct": mad_threshold_pct,
                "stress_threshold_pct": stress_threshold,
                "field_capacity_pct": self.default_fc,
                "wilting_point_pct": self.default_wp,
            },
            "safety": {
                "override": safety_override,
                "reason": safety_reason,
                "soil_valid": soil_valid,
                "reservoir_valid": res_valid,
                "critical_tank_pct": self.critical_tank_pct,
            },
            "decision_trace": decision_trace,
            "audit": {
                "timestamp": timestamp_str,
                "device_id": device_id,
                "scenario": scenario_name,
                "directive": directive,
                "safety_override": safety_override,
                "model_version": "v2",
                "inputs_used": {
                    "soil_moisture_pct": current_moisture,
                    "predicted_soil_moisture_pct": predicted_moisture,
                    "forecast_rain_3h_mm": forecast_rain_3h,
                    "reservoir_level_pct": res_level,
                    "et0_fao56_mm": et0_mm,
                },
            },
        }

        return response

    def _evaluate_scenario(self, scenario_name: str) -> Dict[str, Any]:
        """
        Generates isolated, reproducible demonstration scenarios for what-if evaluation.
        Never touches real MongoDB documents, ESP32, or pumps.
        """
        now_iso = datetime.now(timezone.utc).isoformat()

        if scenario_name == "dry_no_rain":
            # Scenario 1: Dry soil, predicted dry-down, no rain, safety OK -> IRRIGATE
            doc = {
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "soil": {"status": "HEALTHY", "raw_adc": 2550, "moisture_pct": 19.5},
                "reservoir": {"status": "HEALTHY", "level_pct": 78.0, "storage_litres": 390.0},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 5.0},
                "atmosphere": {"temp_c": 27.5, "humidity_pct": 45.0, "et0_fao56_mm": 5.4, "forecast_rain_next_3h_mm": 0.0},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": True},
            }
            ml_pred = {
                "status": "ok",
                "current_soil_moisture_pct": 19.5,
                "predicted_soil_moisture_pct": 17.2,
                "change_pct_points": -2.3,
            }
            return self._evaluate(doc, ml_pred=ml_pred, scenario_name="dry_no_rain")

        elif scenario_name == "dry_rain_expected":
            # Scenario 2: Dry soil, predicted dry-down, useful rain expected -> HOLD
            doc = {
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "soil": {"status": "HEALTHY", "raw_adc": 2550, "moisture_pct": 19.5},
                "reservoir": {"status": "HEALTHY", "level_pct": 78.0, "storage_litres": 390.0},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 5.0},
                "atmosphere": {"temp_c": 24.0, "humidity_pct": 78.0, "et0_fao56_mm": 3.8, "forecast_rain_next_3h_mm": 6.5},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": True},
            }
            ml_pred = {
                "status": "ok",
                "current_soil_moisture_pct": 19.5,
                "predicted_soil_moisture_pct": 17.5,
                "change_pct_points": -2.0,
            }
            return self._evaluate(doc, ml_pred=ml_pred, scenario_name="dry_rain_expected")

        elif scenario_name == "adequate_moisture":
            # Scenario 3: Adequate soil moisture, safety OK -> HOLD
            doc = {
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "soil": {"status": "HEALTHY", "raw_adc": 1650, "moisture_pct": 32.0},
                "reservoir": {"status": "HEALTHY", "level_pct": 82.0, "storage_litres": 410.0},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 10.0},
                "atmosphere": {"temp_c": 25.0, "humidity_pct": 55.0, "et0_fao56_mm": 4.5, "forecast_rain_next_3h_mm": 0.0},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": True},
            }
            ml_pred = {
                "status": "ok",
                "current_soil_moisture_pct": 32.0,
                "predicted_soil_moisture_pct": 30.5,
                "change_pct_points": -1.5,
            }
            return self._evaluate(doc, ml_pred=ml_pred, scenario_name="adequate_moisture")

        elif scenario_name == "safety_lockout":
            # Scenario 4: Irrigation otherwise required, but reservoir safety invalid -> LOCKOUT
            doc = {
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "soil": {"status": "HEALTHY", "raw_adc": 2550, "moisture_pct": 19.5},
                "reservoir": {"status": "OUT_OF_RANGE", "level_pct": -1.0, "storage_litres": 0.0},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 5.0},
                "atmosphere": {"temp_c": 27.5, "humidity_pct": 45.0, "et0_fao56_mm": 5.4, "forecast_rain_next_3h_mm": 0.0},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": False},
            }
            ml_pred = {
                "status": "ok",
                "current_soil_moisture_pct": 19.5,
                "predicted_soil_moisture_pct": 17.2,
                "change_pct_points": -2.3,
            }
            return self._evaluate(doc, ml_pred=ml_pred, scenario_name="safety_lockout")

        else:
            return self._generate_insufficient_data_response(
                reason=f"Unknown demonstration scenario: '{scenario_name}'. Supported: 'dry_no_rain', 'dry_rain_expected', 'adequate_moisture', 'safety_lockout'.",
                device_id="demo",
            )

    def _generate_insufficient_data_response(self, reason: str, device_id: str) -> Dict[str, Any]:
        """Safe fallback response when telemetry cannot be resolved."""
        return {
            "status": "insufficient_data",
            "scenario": "unknown",
            "directive": "INSUFFICIENT_DATA",
            "headline": "Telemetry Incomplete — Standing By",
            "reason": reason,
            "factors": [],
            "ml": {"used": False, "model": "Soil-Water V2", "horizon_hours": 3, "reason": "NO_DATA"},
            "weather": {},
            "crop": {},
            "safety": {"override": True, "reason": "NO_TELEMETRY"},
            "decision_trace": ["1. Data ingestion check: FAILED", f"2. Rationale: {reason}", "3. Directive: INSUFFICIENT_DATA"],
            "audit": {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "device_id": device_id,
                "directive": "INSUFFICIENT_DATA",
                "safety_override": True,
            },
        }

    def get_scenario_telemetry(self, scenario_name: str) -> Optional[Dict[str, Any]]:
        """Returns standard telemetry document structure for a demonstration scenario."""
        name = scenario_name.lower().strip()
        now_iso = datetime.now(timezone.utc).isoformat()
        if name == "dry_no_rain":
            return {
                "_id": "demo_dry_no_rain",
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "source": "demo_scenario",
                "system": {"name": "AquaMatrix-MaxCore", "firmware": "6.5.0-DEMO", "uptime_sec": 3600, "wifi_status": "CONNECTED", "anomaly": "NONE"},
                "soil": {"status": "HEALTHY", "raw_adc": 2550, "adc_raw": 2550, "moisture_pct": 19.5, "moisture_index": 19.5, "dryness_pct": 80.5, "dryness": 80.5},
                "reservoir": {"status": "HEALTHY", "level_pct": 78.0, "storage_litres": 390.0, "water_ml": 390000},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 5.0, "raw_adc": 3900},
                "atmosphere": {"temp_c": 27.5, "humidity_pct": 45.0, "et0_fao56_mm": 5.4, "forecast_rain_next_3h_mm": 0.0, "forecast_rain_mm": 0.0},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": True, "rain_sensor_valid": True, "node_connected": True},
            }
        elif name == "dry_rain_expected":
            return {
                "_id": "demo_dry_rain_expected",
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "source": "demo_scenario",
                "system": {"name": "AquaMatrix-MaxCore", "firmware": "6.5.0-DEMO", "uptime_sec": 3600, "wifi_status": "CONNECTED", "anomaly": "NONE"},
                "soil": {"status": "HEALTHY", "raw_adc": 2550, "adc_raw": 2550, "moisture_pct": 19.5, "moisture_index": 19.5, "dryness_pct": 80.5, "dryness": 80.5},
                "reservoir": {"status": "HEALTHY", "level_pct": 78.0, "storage_litres": 390.0, "water_ml": 390000},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 5.0, "raw_adc": 3900},
                "atmosphere": {"temp_c": 24.0, "humidity_pct": 78.0, "et0_fao56_mm": 3.8, "forecast_rain_next_3h_mm": 6.5, "forecast_rain_mm": 6.5},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": True, "rain_sensor_valid": True, "node_connected": True},
            }
        elif name == "adequate_moisture":
            return {
                "_id": "demo_adequate_moisture",
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "source": "demo_scenario",
                "system": {"name": "AquaMatrix-MaxCore", "firmware": "6.5.0-DEMO", "uptime_sec": 3600, "wifi_status": "CONNECTED", "anomaly": "NONE"},
                "soil": {"status": "HEALTHY", "raw_adc": 1650, "adc_raw": 1650, "moisture_pct": 32.0, "moisture_index": 32.0, "dryness_pct": 68.0, "dryness": 68.0},
                "reservoir": {"status": "HEALTHY", "level_pct": 82.0, "storage_litres": 410.0, "water_ml": 410000},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 10.0, "raw_adc": 3700},
                "atmosphere": {"temp_c": 25.0, "humidity_pct": 55.0, "et0_fao56_mm": 4.5, "forecast_rain_next_3h_mm": 0.0, "forecast_rain_mm": 0.0},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": True, "rain_sensor_valid": True, "node_connected": True},
            }
        elif name == "safety_lockout":
            return {
                "_id": "demo_safety_lockout",
                "device_id": "AquaMatrix-MaxCore (Simulated Demo)",
                "recorded_at": now_iso,
                "source": "demo_scenario",
                "system": {"name": "AquaMatrix-MaxCore", "firmware": "6.5.0-DEMO", "uptime_sec": 3600, "wifi_status": "CONNECTED", "anomaly": "RESERVOIR_SENSOR_FAULT"},
                "soil": {"status": "HEALTHY", "raw_adc": 2550, "adc_raw": 2550, "moisture_pct": 19.5, "moisture_index": 19.5, "dryness_pct": 80.5, "dryness": 80.5},
                "reservoir": {"status": "OUT_OF_RANGE", "level_pct": -1.0, "storage_litres": 0.0, "water_ml": 0},
                "rain_sensor": {"is_raining": False, "surface_wetness_pct": 5.0, "raw_adc": 3900},
                "atmosphere": {"temp_c": 27.5, "humidity_pct": 45.0, "et0_fao56_mm": 5.4, "forecast_rain_next_3h_mm": 0.0, "forecast_rain_mm": 0.0},
                "crop": {"profile_id": "TOMATO_VEG", "name": "Tomato (Vegetative)", "kc_factor": 0.85, "mad_threshold_pct": 50},
                "quality": {"soil_valid": True, "reservoir_valid": False, "rain_sensor_valid": True, "node_connected": True},
            }
        return None

    def get_scenario_prediction(self, scenario_name: str) -> Optional[Dict[str, Any]]:
        """Returns standard ML prediction structure for a demonstration scenario."""
        name = scenario_name.lower().strip()
        rec = self._evaluate_scenario(name)
        ml_info = rec.get("ml", {})
        if ml_info.get("used"):
            pred_val = float(ml_info.get("predicted_soil_moisture_pct", 0.0))
            return {
                "status": "ok",
                "device_id": f"AquaMatrix-MaxCore (Demo {name})",
                "prediction_horizon_hours": ml_info.get("horizon_hours", 3),
                "current_soil_moisture_pct": ml_info.get("current_soil_moisture_pct"),
                "predicted_soil_moisture_pct": pred_val,
                "change_pct_points": ml_info.get("change_pct_points"),
                "model_version": ml_info.get("model", "Soil-Water V2"),
                "confidence_interval_95": [
                    round(pred_val - 1.88, 2),
                    round(pred_val + 1.88, 2),
                ],
                "scenario": name,
                "audit": {
                    "scenario": name,
                    "simulated": True,
                },
            }
        return None


# Singleton service instance
recommendation_service = IrrigationIntelligenceService()
