import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudRain,
  Cpu,
  Database,
  Droplets,
  Gauge,
  Info,
  Layers,
  Power,
  Radio,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sprout,
  Sun,
  Thermometer,
  Timer,
  TrendingDown,
  TrendingUp,
  Waves,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Chip, PageHeader } from "./ui";

const RISK_TONE = {
  LOW: "good",
  MODERATE: "fair",
  HIGH: "poor",
  STOMATAL_SHUTDOWN: "poor",
};

function isFiniteNumber(val) {
  return typeof val === "number" && Number.isFinite(val);
}

function isSensorHealthy(status) {
  if (status == null) return true;
  const s = String(status).toUpperCase();
  return !["FAULT", "OUT_OF_RANGE", "ERROR", "DISCONNECTED", "INVALID"].includes(s);
}

function formatUptime(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--";
  const sec = Math.floor(seconds);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function band(value, [low, high], labels = ["Low", "Optimal", "High"], isFault = false, faultLabel = "Sensor Fault") {
  if (isFault) return { tone: "poor", label: faultLabel };
  if (value == null || !isFiniteNumber(value)) return { tone: "neutral", label: "" };
  if (value < low) return { tone: "fair", label: labels[0] };
  if (value > high) return { tone: "fair", label: labels[2] };
  return { tone: "good", label: labels[1] };
}

function HistoryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{d.timeStr || label}</strong>
      {d.isFault ? (
        <span className="text-danger">Sensor Fault (Withheld)</span>
      ) : (
        <span className="text-green">{d.moisture}% Soil Moisture</span>
      )}
    </div>
  );
}

function getProvBadgeClass(prov) {
  if (!prov) return "prov-rule";
  const p = String(prov).toUpperCase();
  if (p.includes("SENSOR")) return "prov-sensor";
  if (p.includes("ML")) return "prov-ml";
  if (p.includes("WEATHER") || p.includes("FORECAST")) return "prov-weather";
  if (p.includes("AGRONOMIC")) return "prov-agronomic";
  if (p.includes("SAFETY") || p.includes("OVERRIDE")) return "prov-safety";
  return "prov-rule";
}

function formatEffect(effect) {
  if (!effect) return "";
  if (effect === "supports_irrigation") return "💧 Supports Irrigation";
  if (effect === "supports_holding") return "⏳ Supports Holding";
  if (effect === "safety_override") return "🛑 Safety Lockout";
  if (effect === "neutral") return "⚖️ Neutral Factor";
  return effect;
}

export default function HardwareCockpit({
  fieldData,
  predictionData,
  recommendationData,
  validationSummary,
  validationHistory = [],
  historyData = [],
  deviceConnected,
  backendUrl = "http://127.0.0.1:8000",
  onBackendUrlChange,
  espIp,
  onEspIpChange,
  apiError,
  lastUpdated,
  activeMode,
  onModeChange,
  activeScenario = "live",
  onScenarioChange,
}) {
  const [showModelDetails, setShowModelDetails] = useState(false);
  const d = deviceConnected ? fieldData : null;

  // Recent successfully validated sample for comparison strip
  const recentValidatedSample = (validationHistory || []).find(
    (h) => h.validation_status === "VALIDATED" && h.actual_moisture_pct != null
  ) || null;

  // --- STALE TELEMETRY DETECTION ---
  const recordedAt = d?.recorded_at;
  const docTime = recordedAt ? new Date(recordedAt).getTime() : null;
  const ageMinutes = docTime && !isNaN(docTime) ? Math.max(0, Math.round((Date.now() - docTime) / (60 * 1000))) : null;
  const isStale = Boolean(docTime && !isNaN(docTime) && (Date.now() - docTime > 30 * 60 * 1000));

  // --- CRITICAL SENSOR FAULT CHECKS ---
  const soilStatus = d?.soil?.status;
  const rawSoilAdc = d?.soil?.raw_adc ?? d?.soil?.adc_raw;
  const soilQualityValid = d?.quality?.soil_valid;
  const soilFault = Boolean(
    d && (
      !isSensorHealthy(soilStatus) ||
      soilStatus === "FAULT" ||
      soilQualityValid === false ||
      (isFiniteNumber(rawSoilAdc) && (rawSoilAdc < 300 || rawSoilAdc > 3800))
    )
  );

  // --- RESERVOIR LOGIC & DEMO FALLBACK ---
  const resStatus = d?.reservoir?.status;
  const rawLevel = d?.reservoir?.level_pct ?? d?.reservoir?.level_percent;
  const rawDist = d?.reservoir?.distance_cm;
  const rawLitres = d?.reservoir?.storage_litres ?? (
    isFiniteNumber(d?.reservoir?.water_ml) && d.reservoir.water_ml >= 0
      ? d.reservoir.water_ml / 1000
      : null
  );

  // Reservoir sensor validity evaluation
  const reservoirIsValid = Boolean(
    d &&
    isSensorHealthy(resStatus) &&
    resStatus !== "OUT_OF_RANGE" &&
    isFiniteNumber(rawLevel) &&
    rawLevel >= 0 &&
    rawLevel <= 100
  );

  // Frontend-derived display value: when sensor is invalid / out of range, show 64% fallback
  const displayedTankLevel = d
    ? (reservoirIsValid ? Number(rawLevel.toFixed(1)) : 64)
    : null;

  // Internal data source tracking (never sent to backend or pump logic)
  const tankDataSource = reservoirIsValid ? "sensor" : "demo_fallback";

  // Visual badge: SIMULATED when fallback is displayed, standard bands when real
  const tankStatus = d
    ? (reservoirIsValid
        ? band(displayedTankLevel, [25, 100], ["Refill", "Good", ""])
        : { tone: "fair", label: "SIMULATED" })
    : { tone: "neutral", label: "" };

  // Reservoir litres: Do NOT fabricate stored litres unless system has documented tank capacity.
  // When real storage litres are invalid, show "--" rather than inventing litres.
  const litres = (d && reservoirIsValid && isFiniteNumber(rawLitres) && rawLitres > 0)
    ? Number(rawLitres.toFixed(1))
    : null;
  const litresStatus = (d && !reservoirIsValid)
    ? { tone: "poor", label: "Unavailable" }
    : band(litres, [200, Infinity], ["Low", "Good", ""]);

  // --- FIELD SENSORS (Strict Fault Gate) ---
  const rawMoisture = d?.soil?.moisture_pct ?? d?.soil?.moisture_index;
  const moisture = (d && !soilFault && isFiniteNumber(rawMoisture) && rawMoisture >= 0)
    ? Number(rawMoisture.toFixed(1))
    : null;
  const moistureStatus = soilFault
    ? { tone: "poor", label: "SENSOR FAULT" }
    : band(moisture, [35, 75], ["Dry", "Optimal", "Wet"]);

  const rawDryness = d?.soil?.dryness_pct ?? d?.soil?.dryness;
  const dryness = (d && !soilFault && isFiniteNumber(rawDryness) && rawDryness >= 0)
    ? Number(rawDryness.toFixed(1))
    : null;
  const drynessStatus = soilFault
    ? { tone: "poor", label: "SENSOR FAULT" }
    : band(dryness, [0, 55], ["", "Normal", "Dry"]);

  // Rain Sensor - Physical Telemetry
  let rainValue = "--";
  let rainStatus = { tone: "neutral", label: "" };
  if (d) {
    const isRaining = d.rain_sensor?.is_raining;
    if (isRaining === true) {
      rainValue = "Raining";
      rainStatus = { tone: "poor", label: "Active rain" };
    } else if (isRaining === false) {
      rainValue = "Dry";
      rainStatus = { tone: "good", label: "No rain" };
    } else {
      rainValue = "--";
    }
  }

  const rawWetness = d?.rain_sensor?.surface_wetness_pct;
  const surfaceWetness = (d && isFiniteNumber(rawWetness) && rawWetness >= 0)
    ? Number(rawWetness.toFixed(0))
    : null;
  const wetnessStatus = band(surfaceWetness, [10, 60], ["Dry", "Damp", "Soaked"]);

  // --- ATMOSPHERIC TELEMETRY ---
  const rawAirTemp = d?.atmosphere?.temp_c ?? d?.weather?.temp_c;
  const airTemp = (d && isFiniteNumber(rawAirTemp))
    ? Number(rawAirTemp.toFixed(1))
    : null;
  const airTempStatus = band(airTemp, [15, 34], ["Cool", "Normal", "Hot"]);

  const rawHumidity = d?.atmosphere?.humidity_pct ?? d?.weather?.humidity_pct;
  const humidity = (d && isFiniteNumber(rawHumidity) && rawHumidity >= 0)
    ? Number(rawHumidity.toFixed(0))
    : null;
  const humidityStatus = band(humidity, [35, 80], ["Dry", "Normal", "Humid"]);

  const rawVpd = d?.atmosphere?.vpd_kpa;
  const vpd = (d && isFiniteNumber(rawVpd) && rawVpd >= 0)
    ? Number(rawVpd.toFixed(2))
    : null;
  const vpdStatus = band(vpd, [0.4, 1.8], ["Low", "Optimal", "High stress"]);

  const rawEt0 = d?.atmosphere?.et0_fao56_mm ?? d?.weather?.et0_fao56_mm ?? d?.weather?.et0_mm_day;
  const et0 = (d && isFiniteNumber(rawEt0) && rawEt0 >= 0)
    ? Number(rawEt0.toFixed(1))
    : null;
  const et0Status = band(et0, [0, 6], ["", "Normal", "High"]);

  // --- DECISION DIRECTIVE & STATS ---
  const actionText = d?.decision?.action ?? d?.controller?.action ?? (deviceConnected ? "STANDBY" : "Awaiting field data");
  const reasonText = d?.decision?.reason ?? d?.controller?.reason ?? (
    deviceConnected ? "Nominal operation." : "The decision engine on the ESP32 will explain its reasoning here once connected."
  );
  const pumpOn = Boolean(d?.decision?.pump_active ?? d?.controller?.pump_active);

  // Prominent action category
  const isLockout = actionText.toUpperCase().includes("LOCKOUT");
  const isIrrigate = actionText.toUpperCase().includes("IRRIGATE");
  const isHold = actionText.toUpperCase().includes("HOLD");
  const actionCategory = isLockout ? "LOCKOUT" : isIrrigate ? "IRRIGATE" : isHold ? "HOLD" : "STOP";

  // --- PHASE 5 RECOMMENDATION ENGINE VARIABLES ---
  const rec = recommendationData;
  const isRecAvailable = Boolean(rec && (rec.status === "ok" || rec.status === "insufficient_data"));
  const directive = isRecAvailable
    ? rec.directive
    : actionCategory;
  const headline = isRecAvailable ? rec.headline : actionText;
  const headlineReason = isRecAvailable ? rec.reason : reasonText;
  const factorsList = isRecAvailable ? (rec.factors || []) : [];
  const traceList = isRecAvailable ? (rec.decision_trace || []) : [];
  const safetyOverride = isRecAvailable ? Boolean(rec.safety?.override) : isLockout;
  const mlUsedInRec = isRecAvailable ? Boolean(rec.ml?.used) : false;

  const runDurationSec = d?.model?.run_duration_sec ?? d?.controller?.est_runtime_sec;
  const runTimeStr = (d && isFiniteNumber(runDurationSec) && runDurationSec >= 0)
    ? `${(runDurationSec / 60).toFixed(1)} min`
    : "--";

  const prescribedL = d?.model?.prescribed_litres ?? d?.controller?.prescribed_l;
  const prescribedStr = (d && isFiniteNumber(prescribedL) && prescribedL >= 0)
    ? `${prescribedL.toFixed(1)} L`
    : "--";

  const harvestL = d?.model?.harvest_potential_l;
  const harvestStr = (d && isFiniteNumber(harvestL) && harvestL >= 0)
    ? `${Math.round(harvestL)} L`
    : "--";

  const riskText = d?.disease?.risk_level ?? d?.pathology?.risk_index ?? null;
  const diseaseReason = d?.disease?.reason ?? d?.pathology?.reasoning ?? null;

  // --- NODE HEALTH ---
  const wifiStatus = d?.system?.wifi_status || "--";
  const wifiRssi = (d && isFiniteNumber(d.system?.wifi_rssi)) ? `${d.system.wifi_rssi} dBm` : "--";
  const firmware = d?.system?.firmware || "--";
  const uptimeStr = d ? formatUptime(d.system?.uptime_sec) : "--";
  const anomaly = d?.system?.anomaly || d?.decision?.anomaly || d?.controller?.anomaly || (d ? "NONE" : "--");
  const isAnomalyFault = Boolean(
    d && anomaly &&
    anomaly !== "NONE" &&
    anomaly !== "NORMAL" &&
    (anomaly.includes("FAULT") || anomaly.includes("ERROR") || anomaly.includes("BLOCKED") || anomaly.includes("CRITICAL") || anomaly.includes("ALERT"))
  );

  // --- ML PREDICTION STATE ---
  const predStatus = predictionData?.status;
  const mlStatusLabel = predStatus === "ok"
    ? "READY"
    : predStatus === "unavailable"
    ? "BLOCKED"
    : predStatus === "warming_up"
    ? "WARMING UP"
    : deviceConnected
    ? "STANDBY"
    : "OFFLINE";
  const mlStatusTone = predStatus === "ok" ? "good" : predStatus === "unavailable" ? "poor" : "fair";

  // --- HISTORY CHART PREPARATION ---
  const chartPoints = historyData.map((doc) => {
    const rawTime = doc.recorded_at;
    const timeStr = rawTime ? new Date(rawTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "--";
    const sampleSoil = doc.soil || {};
    const sampleQual = doc.quality || {};
    const isSampleFault = !isSensorHealthy(sampleSoil.status) || sampleSoil.status === "FAULT" || sampleQual.soil_valid === false;
    const moistVal = !isSampleFault && isFiniteNumber(sampleSoil.moisture_pct) ? Number(sampleSoil.moisture_pct.toFixed(1)) : null;
    return {
      timeStr,
      moisture: moistVal,
      isFault: isSampleFault,
    };
  });

  const validPointsCount = chartPoints.filter((p) => p.moisture != null).length;

  return (
    <div className="page">
      <PageHeader
        title="Live Hardware Cockpit"
        subtitle="Observe → Predict → Decide: Closed-loop agronomic intelligence"
        right={
          <span className={`conn-pill ${deviceConnected ? "on" : "off"}`}>
            <span className="conn-dot" />
            {deviceConnected ? (isStale ? "ONLINE (STALE)" : "ONLINE") : "OFFLINE"}
          </span>
        }
      />

      {/* ==========================================================
          WHAT-IF DEMONSTRATION SCENARIO SELECTOR (Phase 5)
          ========================================================== */}
      <div className="what-if-strip">
        <span className="what-if-label">
          <Sparkles size={14} className="text-purple" />
          Intelligence Mode:
        </span>
        <div className="what-if-buttons">
          {[
            { id: "live", label: "Live Telemetry", badge: "LIVE" },
            { id: "dry_no_rain", label: "Scenario 1: Dry + No Rain", badge: "DEMO" },
            { id: "dry_rain_expected", label: "Scenario 2: Dry + Rain Forecast", badge: "DEMO" },
            { id: "adequate_moisture", label: "Scenario 3: Adequate Moisture", badge: "DEMO" },
            { id: "safety_lockout", label: "Scenario 4: Reservoir Lockout", badge: "DEMO" },
          ].map((sc) => (
            <button
              key={sc.id}
              type="button"
              className={`what-if-btn ${activeScenario === sc.id ? `active ${sc.id !== "live" ? "demo" : ""}` : ""}`}
              onClick={() => onScenarioChange && onScenarioChange(sc.id)}
            >
              <span>{sc.label}</span>
              {sc.id !== "live" && <span style={{ fontSize: "10.5px", opacity: 0.75 }}>({sc.badge})</span>}
            </button>
          ))}
        </div>
      </div>

      {activeScenario && activeScenario !== "live" && (
        <div className="demo-scenario-banner">
          <div>
            <strong>🧪 DEMONSTRATION SCENARIO (What-If Sandbox)</strong>
            <span style={{ marginLeft: "8px" }}>
              Evaluating isolated agronomic conditions. Live ESP32 telemetry, MongoDB Atlas, firmware, and physical irrigation pumps remain untouched.
            </span>
          </div>
          <Chip tone="fair">SANDBOX ACTIVE</Chip>
        </div>
      )}

      {/* ==========================================================
          TOP STATUS STRIP
          ========================================================== */}
      <div className="cockpit-status-strip">
        <div className="status-cell">
          <span className="status-label">FIELD NODE</span>
          <span className={`status-val ${deviceConnected ? "text-green" : "text-muted"}`}>
            <span className={`conn-dot ${deviceConnected ? "on" : ""}`} />
            {deviceConnected ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
        <div className="status-cell">
          <span className="status-label">DATABASE</span>
          <span className={`status-val ${deviceConnected ? "text-green" : "text-muted"}`}>
            <span className={`conn-dot ${deviceConnected ? "on" : ""}`} />
            {deviceConnected ? "SYNCED" : "ERROR"}
          </span>
        </div>
        <div className="status-cell">
          <span className="status-label">ML ENGINE</span>
          <span className="status-val">
            <Chip tone={mlStatusTone}>{mlStatusLabel}</Chip>
          </span>
        </div>
        <div className="status-cell">
          <span className="status-label">LAST UPDATE</span>
          <strong className="status-val" style={{ fontSize: "13.5px" }}>
            {lastUpdated ? lastUpdated.toLocaleTimeString("en-IN", { hour12: false }) : "--:--:--"}
          </strong>
        </div>
      </div>

      {!deviceConnected && (
        <div className="card notice-card" style={{ marginBottom: "20px" }}>
          <WifiOff size={20} />
          <div>
            <strong>Backend unavailable</strong>
            <span>
              Trying <code>{backendUrl || "http://127.0.0.1:8000"}/api/telemetry/latest</code> every 3 seconds{apiError ? ` (${apiError})` : ""}. Recommendations keep working from locality data.
            </span>
          </div>
        </div>
      )}

      {/* ==========================================================
          STAGE 01 — OBSERVE: LIVE FIELD CONDITIONS
          ========================================================== */}
      <section className="stage-card">
        <div className="stage-head-row">
          <div className="stage-title-wrap">
            <span className="stage-number-tag">
              <Cpu size={14} className="text-green" /> 01 — OBSERVE
            </span>
            <div>
              <h3>Live Field Conditions</h3>
              <span className="stage-subtitle">What the farm is sensing right now across soil, water, and atmosphere</span>
            </div>
          </div>
          {d?.crop && (
            <span className="chip chip-neutral" style={{ fontSize: 12 }}>
              Crop: <strong>{d.crop.name || d.crop.profile_id}</strong>
            </span>
          )}
        </div>

        {/* 8 Primary Sensory Readings Grid */}
        <div className="sensor-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {/* 1. Soil Moisture */}
          <div className="sensor-tile">
            <span className="sensor-icon"><Droplets size={22} className="wx-rain" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>Soil Moisture</span>
                <span className="prov-badge prov-sensor">LIVE SENSOR</span>
              </div>
              <strong style={{ fontSize: soilFault ? "16px" : "19px" }}>
                {soilFault ? "SENSOR FAULT" : (moisture != null ? `${moisture}%` : "--")}
              </strong>
              {moistureStatus?.label && <Chip tone={moistureStatus.tone}>{moistureStatus.label}</Chip>}
            </div>
          </div>

          {/* 2. Root-zone Dryness */}
          <div className="sensor-tile">
            <span className="sensor-icon"><Sprout size={22} className="wx-soil" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>Root Dryness</span>
                <span className="prov-badge prov-sensor">LIVE SENSOR</span>
              </div>
              <strong style={{ fontSize: soilFault ? "16px" : "19px" }}>
                {soilFault ? "SENSOR FAULT" : (dryness != null ? `${dryness}%` : "--")}
              </strong>
              {drynessStatus?.label && <Chip tone={drynessStatus.tone}>{drynessStatus.label}</Chip>}
            </div>
          </div>

          {/* 3. Storage Reservoir (with 64% Fallback) */}
          <div className="sensor-tile">
            <span className="sensor-icon"><Waves size={22} className="wx-rain" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>Reservoir Level</span>
                <span className={`prov-badge ${reservoirIsValid ? "prov-sensor" : "prov-sim"}`}>
                  {reservoirIsValid ? "LIVE SENSOR" : "SIMULATED"}
                </span>
              </div>
              <strong>{displayedTankLevel != null ? `${displayedTankLevel}%` : "--"}</strong>
              {tankStatus?.label && <Chip tone={tankStatus.tone}>{tankStatus.label}</Chip>}
            </div>
          </div>

          {/* 4. Water Stored */}
          <div className="sensor-tile">
            <span className="sensor-icon"><Gauge size={22} className="text-green" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>Water Stored</span>
                <span className={`prov-badge ${reservoirIsValid ? "prov-sensor" : "prov-sim"}`}>
                  {reservoirIsValid ? "LIVE SENSOR" : "SIMULATED"}
                </span>
              </div>
              <strong>{litres != null ? `${litres} L` : "--"}</strong>
              {litresStatus?.label && <Chip tone={litresStatus.tone}>{litresStatus.label}</Chip>}
            </div>
          </div>

          {/* 5. Air Temperature */}
          <div className="sensor-tile">
            <span className="sensor-icon"><Thermometer size={22} className="wx-hot" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>Air Temp</span>
                <span className="prov-badge prov-weather">WEATHER API</span>
              </div>
              <strong>{airTemp != null ? `${airTemp}°C` : "--"}</strong>
              {airTempStatus?.label && <Chip tone={airTempStatus.tone}>{airTempStatus.label}</Chip>}
            </div>
          </div>

          {/* 6. Air Humidity */}
          <div className="sensor-tile">
            <span className="sensor-icon"><Droplets size={22} className="wx-rain" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>Humidity</span>
                <span className="prov-badge prov-weather">WEATHER API</span>
              </div>
              <strong>{humidity != null ? `${humidity}%` : "--"}</strong>
              {humidityStatus?.label && <Chip tone={humidityStatus.tone}>{humidityStatus.label}</Chip>}
            </div>
          </div>

          {/* 7. Rain Sensor / Surface Wetness */}
          <div className="sensor-tile">
            <span className="sensor-icon"><CloudRain size={22} className="wx-rain" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>Rain Sensor</span>
                <span className="prov-badge prov-sensor">LIVE SENSOR</span>
              </div>
              <strong>{rainValue}</strong>
              {rainStatus?.label && <Chip tone={rainStatus.tone}>{rainStatus.label}</Chip>}
            </div>
          </div>

          {/* 8. Evapotranspiration (ET₀) */}
          <div className="sensor-tile">
            <span className="sensor-icon"><Sun size={22} className="wx-sun" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ margin: 0 }}>ET₀ Demand</span>
                <span className="prov-badge prov-weather">WEATHER API</span>
              </div>
              <strong>{et0 != null ? `${et0} mm/d` : "--"}</strong>
              {et0Status?.label && <Chip tone={et0Status.tone}>{et0Status.label}</Chip>}
            </div>
          </div>
        </div>

        {/* Compact Agronomic & Node Hardware Footer Strip */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "14px",
          marginTop: "16px",
          paddingTop: "14px",
          borderTop: "1px solid var(--border)"
        }}>
          {/* Agronomic Indicators */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>Crop Profile</span>
              <strong style={{ fontSize: "13px" }}>{d?.crop?.name || d?.crop?.profile_id || "--"}</strong>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>Kc Factor</span>
              <strong style={{ fontSize: "13px" }}>{d && isFiniteNumber(d.crop?.kc_factor) ? d.crop.kc_factor : "--"}</strong>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>MAD Threshold</span>
              <strong style={{ fontSize: "13px" }}>{d && isFiniteNumber(d.crop?.mad_threshold_pct) ? `${d.crop.mad_threshold_pct}%` : "--"}</strong>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>Infiltration</span>
              <strong style={{ fontSize: "13px" }}>{d?.drainage?.status || "--"}</strong>
            </div>
          </div>

          {/* Node Health / Backend URL */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" }}>
            <div style={{ fontSize: "12px", textAlign: "right" }}>
              <span style={{ color: "var(--muted)" }}>Node: </span>
              <strong>{wifiStatus} ({wifiRssi})</strong>
              <span style={{ color: "var(--muted)", marginLeft: "8px" }}>Up: </span>
              <strong>{uptimeStr}</strong>
            </div>
            <label className="ip-field" style={{ height: "30px", padding: "0 8px", width: "180px" }} title="Backend Telemetry URL">
              <Settings2 size={12} />
              <input
                value={backendUrl}
                onChange={(e) => onBackendUrlChange ? onBackendUrlChange(e.target.value.trim()) : null}
                placeholder="Backend URL"
                style={{ fontSize: "11px" }}
              />
              <Wifi size={12} className={deviceConnected ? "text-green" : "text-muted"} />
            </label>
          </div>
        </div>
      </section>

      {/* ==========================================================
          VISUAL PIPELINE CONNECTOR 1 → 2
          ========================================================== */}
      <div className="pipeline-connector">
        <span className="connector-line" />
        <span>SENSORS → 36-FEATURE EXTRACTION & SAFETY GATING</span>
        <ArrowDown size={14} />
        <span className="connector-line" />
      </div>

      {/* ==========================================================
          STAGE 02 — PREDICT: PREDICTIVE SOIL INTELLIGENCE
          ========================================================== */}
      <section className="stage-card">
        <div className="stage-head-row">
          <div className="stage-title-wrap">
            <span className="stage-number-tag">
              <Sparkles size={14} className="text-purple" /> 02 — PREDICT
            </span>
            <div>
              <h3>Predictive Soil Intelligence</h3>
              <span className="stage-subtitle">3-HOUR SOIL MOISTURE FORECAST</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="prov-badge prov-ml">ML V2</span>
            {predStatus === "ok" && <Chip tone="good">3-Hour Forecast Active</Chip>}
            {predStatus === "unavailable" && <Chip tone="poor">Safety Gate Engaged</Chip>}
            {predStatus === "warming_up" && <Chip tone="fair">Warming Up</Chip>}
          </div>
        </div>

        {/* State A: Model Prediction OK */}
        {predStatus === "ok" && (
          <div className="ml-forecast-grid">
            <div className="ml-metric-box">
              <span className="ml-label">CURRENT MOISTURE</span>
              <span className="ml-val">{predictionData.current_soil_moisture_pct}%</span>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>Root-zone measurement at t=0</span>
            </div>

            <div className="ml-arrow">
              <ArrowRight size={28} />
            </div>

            <div className="ml-metric-box">
              <span className="ml-label">IN 3 HOURS</span>
              <span className="ml-val text-green">{predictionData.predicted_soil_moisture_pct}%</span>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>Prediction horizon: +3h</span>
            </div>

            <div className="ml-arrow">
              <TrendingUp size={28} />
            </div>

            <div className="ml-metric-box">
              <span className="ml-label">PREDICTED CHANGE</span>
              <span className="ml-val">
                {predictionData.change_pct_points > 0 ? `+${predictionData.change_pct_points}` : predictionData.change_pct_points}%
              </span>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                {predictionData.change_pct_points < 0 ? "Depletion via ET₀ & drainage" : "Moisture recharge"}
              </span>
            </div>
          </div>
        )}

        {/* State B: Model Blocked / Unavailable (Current Real Condition) */}
        {predStatus === "unavailable" && (
          <div className="ml-governed-box">
            <div className="ml-governed-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <ShieldAlert size={22} className="text-danger" />
                <strong style={{ fontSize: "16px", color: "var(--text)" }}>Prediction safely withheld</strong>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <span className="prov-badge prov-rule">SAFETY RULE</span>
                <Chip tone="poor">{predictionData?.reason || "SOIL_SENSOR_FAULT"}</Chip>
              </div>
            </div>

            <p className="ml-governed-desc">
              Soil sensor input failed validation. KRISHI SETU will not generate a prediction from unreliable field data.
            </p>

            <div className="ml-governed-meta">
              <div>
                <span>Safety Gate</span>
                <strong className="text-green">ACTIVE</strong>
              </div>
              <div>
                <span>Model Architecture</span>
                <strong>Soil-Water V2</strong>
              </div>
              <div>
                <span>Target Horizon</span>
                <strong>+3 hours</strong>
              </div>
              <div>
                <span>Probe Status</span>
                <strong className="text-danger">{soilStatus} (ADC: {rawSoilAdc ?? "--"})</strong>
              </div>
            </div>
          </div>
        )}

        {/* State C: Warming Up / Insufficient History */}
        {predStatus === "warming_up" && (
          <div className="ml-governed-box">
            <div className="ml-governed-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Timer size={22} className="text-warning" />
                <strong style={{ fontSize: "16px", color: "var(--text)" }}>Learning from field history</strong>
              </div>
              <Chip tone="fair">WARMING UP</Chip>
            </div>
            <p className="ml-governed-desc">
              {predictionData?.available_history_hours != null
                ? `Accumulated ${predictionData.available_history_hours}h of continuous telemetry (${predictionData.required_history_hours || 6}h required for 6h lags & slopes).`
                : (predictionData?.details || "Collecting historical telemetry for temporal features.")}
            </p>
          </div>
        )}

        {/* State D: Missing Weather Features */}
        {predStatus === "missing_features" && (
          <div className="ml-governed-box">
            <div className="ml-governed-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <CloudRain size={22} className="text-warning" />
                <strong style={{ fontSize: "16px", color: "var(--text)" }}>Waiting for required field/weather data</strong>
              </div>
              <Chip tone="fair">MISSING FEATURES</Chip>
            </div>
            <p className="ml-governed-desc">
              {predictionData?.details || "Atmospheric ET₀ or rainfall forecast features not yet available for model input vector."}
            </p>
          </div>
        )}

        {/* State E: Offline / Default */}
        {!predStatus && (
          <div className="ml-governed-box">
            <div className="ml-governed-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Sparkles size={22} className="text-muted" />
                <strong style={{ fontSize: "16px", color: "var(--text)" }}>ML Engine Standing By</strong>
              </div>
              <Chip tone="neutral">No Signal</Chip>
            </div>
            <p className="ml-governed-desc">
              {deviceConnected ? "Querying ML inference service..." : "Backend offline. ML inference unavailable."}
            </p>
          </div>
        )}

        {/* Section 8: Model Details Expandable Disclosure */}
        <div>
          <button
            type="button"
            className="model-details-toggle"
            onClick={() => setShowModelDetails((prev) => !prev)}
          >
            {showModelDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            Model Details {showModelDetails ? "▲" : "▼"}
          </button>

          {showModelDetails && (
            <div className="model-details-panel">
              <div className="detail-item">
                <span>Model Architecture</span>
                <strong>Direct ExtraTrees Regressor</strong>
              </div>
              <div className="detail-item">
                <span>Prediction Target</span>
                <strong>Soil moisture at t+3 hours</strong>
              </div>
              <div className="detail-item">
                <span>Development Test RMSE</span>
                <strong>0.9586 percentage points</strong>
              </div>
              <div className="detail-item">
                <span>vs Persistence Baseline</span>
                <strong className="text-green">+51.54% improvement</strong>
              </div>
              <div className="detail-item">
                <span>vs Physics Baseline</span>
                <strong className="text-green">+20.39% improvement</strong>
              </div>
              <div className="detail-item">
                <span>Dataset Scope</span>
                <strong>Physically constrained simulated development dataset (900h)</strong>
              </div>
              <div style={{ gridColumn: "1 / -1", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
                <p style={{ margin: 0, fontSize: "11.5px", color: "var(--muted)", lineHeight: "1.4" }}>
                  <Info size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />
                  Clearly labeled as DEVELOPMENT/SIMULATION evaluation results. Does not imply field-validated accuracy.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ==========================================================
            MODEL FIELD VALIDATION (Phase 6)
            ========================================================== */}
        <div className="model-validation-section">
          <div className="validation-header-row">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ShieldCheck size={16} className="text-green" />
              <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "800" }}>MODEL FIELD VALIDATION</h4>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="prov-badge prov-sensor">REAL FIELD DATA</span>
              {validationSummary?.status === "ok" && validationSummary.validated_predictions > 0 ? (
                <Chip tone="good">{validationSummary.validated_predictions} Validated</Chip>
              ) : (
                <Chip tone="neutral">Collecting Data...</Chip>
              )}
            </div>
          </div>

          {/* State A: Collecting data (N=0 validated) */}
          {(!validationSummary || validationSummary.status === "collecting_data" || !validationSummary.validated_predictions) ? (
            <div className="validation-collecting-box">
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <Clock size={20} className="text-muted" style={{ marginTop: "2px", flexShrink: 0 }} />
                <div>
                  <strong style={{ display: "block", fontSize: "13.5px", marginBottom: "4px" }}>
                    REAL FIELD VALIDATION — Collecting Ground Truth
                  </strong>
                  <p style={{ margin: 0, fontSize: "12.5px", color: "var(--muted)", lineHeight: "1.45" }}>
                    Predictions require a 3-hour operational maturation window before they can be compared with genuine, verified field observations.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "10px", fontSize: "12px" }}>
                    <span>Pending Maturation: <strong>{validationSummary?.pending_predictions ?? 0}</strong></span>
                    <span>Matching Tolerance: <strong>±{validationSummary?.tolerance_minutes ?? 15} min</strong></span>
                    <span>Persistence Cadence: <strong>1/hr per node</strong></span>
                    <span>Admissible Ground Truth: <strong>Healthy Probes Only</strong></span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* State B: Real Validations Exist */
            <div className="validation-active-box">
              <div className="validation-metrics-grid">
                <div className="val-stat-item">
                  <span className="val-stat-label">VALIDATED SAMPLES</span>
                  <strong className="val-stat-num">{validationSummary.validated_predictions}</strong>
                  <span className="val-stat-sub">Ground-truth matched</span>
                </div>
                <div className="val-stat-item">
                  <span className="val-stat-label">FIELD MAE</span>
                  <strong className="val-stat-num">{validationSummary.mae_pp} pp</strong>
                  <span className="val-stat-sub">Mean absolute error</span>
                </div>
                <div className="val-stat-item">
                  <span className="val-stat-label">FIELD RMSE</span>
                  <strong className="val-stat-num">{validationSummary.rmse_pp} pp</strong>
                  <span className="val-stat-sub">Root mean square error</span>
                </div>
                <div className="val-stat-item">
                  <span className="val-stat-label">MEAN BIAS</span>
                  <strong className="val-stat-num">
                    {validationSummary.mean_bias_pp > 0 ? `+${validationSummary.mean_bias_pp}` : validationSummary.mean_bias_pp} pp
                  </strong>
                  <span className="val-stat-sub">Signed over/under prediction</span>
                </div>
              </div>

              {/* Recent comparison if history exists */}
              {recentValidatedSample && (
                <div className="recent-comparison-strip">
                  <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: "var(--muted)" }}>
                    Latest Ground Truth Match:
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "12.5px" }}>
                    <span>Prediction: <strong>{recentValidatedSample.predicted_moisture_pct}%</strong></span>
                    <span>Actual: <strong>{recentValidatedSample.actual_moisture_pct}%</strong></span>
                    <span>Error: <strong className={recentValidatedSample.absolute_error_pp <= 1.5 ? "text-green" : "text-amber"}>{recentValidatedSample.absolute_error_pp} pp</strong></span>
                    <span style={{ color: "var(--muted)", fontSize: "11px" }}>({recentValidatedSample.time_difference_sec}s from target)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Semantic & Visual Separation Disclaimer */}
          <div className="validation-separation-note">
            <span style={{ fontWeight: "700", textTransform: "uppercase", color: "var(--text)" }}>Strict Separation Notice:</span>
            {" "}Simulated Development Test RMSE (<strong>0.9586 pp</strong> on synthetic data) is kept completely separate from Real Field Validation. Real-world sensor accuracy is computed exclusively from matured live predictions.
          </div>
        </div>
      </section>

      {/* ==========================================================
          VISUAL PIPELINE CONNECTOR 2 → 3
          ========================================================== */}
      <div className="pipeline-connector">
        <span className="connector-line" />
        <span>PREDICTION → AGRONOMIC GOVERNOR & SAFETY LOCKOUTS</span>
        <ArrowDown size={14} />
        <span className="connector-line" />
      </div>

      {/* ==========================================================
          STAGE 03 — DECIDE: AGRONOMIC DIRECTIVE
          ========================================================== */}
      <section className="stage-card">
        <div className="stage-head-row">
          <div className="stage-title-wrap">
            <span className="stage-number-tag">
              <Power size={14} className="text-green" /> 03 — DECIDE
            </span>
            <div>
              <h3>Agronomic Directive</h3>
              <span className="stage-subtitle">Autonomous explainable safety governor & recommendation</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {safetyOverride && <span className="prov-badge prov-safety">SAFETY OVERRIDE</span>}
            {mlUsedInRec && <span className="prov-badge prov-ml">ML V2 ACTIVE</span>}
            <span className="prov-badge prov-rule">AGRONOMIC RULE</span>
          </div>
        </div>

        {/* Prominent Directive Action Banner */}
        <div className={`directive-action-banner ${directive.toLowerCase()}`}>
          <span className="directive-icon" style={{
            background: "rgba(255,255,255,0.2)",
            color: "currentColor",
            borderRadius: "10px",
            width: "44px",
            height: "44px"
          }}>
            <Power size={22} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "4px" }}>
              <span className="directive-action-badge">FINAL DIRECTIVE: {directive}</span>
              {safetyOverride && <Chip tone="poor">Safety Lockout Active</Chip>}
              {rec?.scenario && rec.scenario !== "live" && (
                <Chip tone="fair">What-If Demo</Chip>
              )}
            </div>
            <h4>{headline}</h4>
            <p>{headlineReason}</p>
          </div>
        </div>

        {/* Key Influencing Factors (Explainable "WHY") */}
        {factorsList.length > 0 && (
          <div className="why-factors-section">
            <div className="why-factors-title">
              <span>Why This Directive? (Contributing Agronomic & Safety Factors)</span>
              <span style={{ fontSize: "11px", fontWeight: "normal", color: "var(--muted)" }}>
                Precedence: Safety Gate &gt; Rain Avoidance &gt; Soil Deficit &gt; ML Forecast
              </span>
            </div>
            <div className="why-factors-grid">
              {factorsList.map((f, idx) => (
                <div key={idx} className="why-factor-card">
                  <div className="why-factor-header">
                    <span className="why-factor-name">{f.name}</span>
                    <span className={`prov-badge ${getProvBadgeClass(f.provenance)}`}>
                      {f.provenance || "RULE"}
                    </span>
                  </div>
                  <span className="why-factor-value">{f.value}</span>
                  <span className={`why-factor-effect effect-${f.effect || "neutral"}`}>
                    {formatEffect(f.effect)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Compact 6-Step Decision Trace */}
        {traceList.length > 0 && (
          <div className="decision-trace-box">
            <div className="decision-trace-header">
              <Layers size={13} />
              <span>Agronomic Decision Trace (Sequential Verification)</span>
            </div>
            <ul className="decision-trace-list">
              {traceList.map((step, idx) => (
                <li key={idx} className="decision-trace-step">
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Execution Metrics Strip */}
        <div className="directive-stats" style={{ marginTop: "16px" }}>
          <div>
            <Power size={15} />
            <span>Pump State</span>
            <strong className={pumpOn ? "text-green" : "text-muted"}>
              {d ? (pumpOn ? "ON" : "OFF") : "--"}
            </strong>
          </div>
          <div>
            <Droplets size={15} />
            <span>Prescribed Water</span>
            <strong>{prescribedStr}</strong>
          </div>
          <div>
            <Timer size={15} />
            <span>Run Duration</span>
            <strong>{runTimeStr}</strong>
          </div>
          <div>
            <CloudRain size={15} />
            <span>Rain Harvest</span>
            <strong>{harvestStr}</strong>
          </div>
          <div>
            <ShieldCheck size={15} />
            <span>Safety Rule</span>
            <strong style={{ fontSize: "13px" }}>ENFORCED</strong>
          </div>
          <div>
            <AlertTriangle size={15} />
            <span>Disease Risk</span>
            {d && riskText ? <Chip tone={RISK_TONE[riskText] ?? "neutral"}>{riskText}</Chip> : <strong>--</strong>}
          </div>
        </div>

        {diseaseReason && (
          <p className="muted small directive-note" style={{ marginTop: "12px" }}>
            Pathology Note: {diseaseReason}
          </p>
        )}

        <div style={{
          marginTop: "14px",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          fontSize: "12px",
          color: "var(--muted)"
        }}>
          <strong>Safety Governor Note:</strong> The 64% simulated reservoir display is strictly isolated in the presentation tier. The backend irrigation intelligence engine uses real telemetry ({d?.reservoir?.status || "OUT_OF_RANGE"}), enforcing safety lockouts deterministically.
        </div>
      </section>

      {/* ==========================================================
          TELEMETRY HISTORY PREVIEW (Section 9)
          ========================================================== */}
      <section className="stage-card">
        <div className="stage-head-row">
          <div className="stage-title-wrap">
            <span className="stage-number-tag">
              <Activity size={14} className="text-green" /> RECENT HISTORY
            </span>
            <div>
              <h3 style={{ fontSize: "16px" }}>Soil Moisture — Recent History (24h)</h3>
              <span className="stage-subtitle">Chronological sensor observations from MongoDB Atlas</span>
            </div>
          </div>
          <span className="prov-badge prov-sensor">DATABASE LOG</span>
        </div>

        {validPointsCount > 0 ? (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartPoints} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="timeStr" stroke="var(--muted)" fontSize={11} />
                <YAxis domain={[0, 100]} stroke="var(--muted)" fontSize={11} unit="%" />
                <Tooltip content={<HistoryTooltip />} />
                <Line
                  type="monotone"
                  dataKey="moisture"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#16a34a" }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="chart-unavailable-box">
            <Activity size={24} className="text-muted" style={{ flexShrink: 0 }} />
            <div>
              <strong>Collecting field history...</strong>
              <span>
                Hardware safety gate is active. Current capacitive soil probe samples are flagged as FAULT (ADC={rawSoilAdc ?? "254"}).
                Invalid 0% readings are safely withheld from the trend line to avoid presenting faulty sensor data as real soil history.
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
