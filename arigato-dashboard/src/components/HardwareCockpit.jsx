import {
  AlertTriangle,
  CloudRain,
  Droplets,
  Gauge,
  Power,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sprout,
  Sun,
  Thermometer,
  Timer,
  TrendingUp,
  Waves,
  Wifi,
  WifiOff,
} from "lucide-react";
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

function band(value, [low, high], labels = ["Low", "Optimal", "High"], isFault = false, faultLabel = "Sensor fault") {
  if (isFault) return { tone: "poor", label: faultLabel };
  if (value == null || !isFiniteNumber(value)) return { tone: "neutral", label: "" };
  if (value < low) return { tone: "fair", label: labels[0] };
  if (value > high) return { tone: "fair", label: labels[2] };
  return { tone: "good", label: labels[1] };
}

export default function HardwareCockpit({
  fieldData,
  predictionData,
  deviceConnected,
  backendUrl = "http://127.0.0.1:8000",
  onBackendUrlChange,
  espIp,
  onEspIpChange,
  apiError,
  lastUpdated,
  activeMode,
  onModeChange,
}) {
  const d = deviceConnected ? fieldData : null;

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

  const distance = (d && reservoirIsValid && isFiniteNumber(rawDist) && rawDist >= 0)
    ? Number(rawDist.toFixed(1))
    : null;
  const distStatus = (d && !reservoirIsValid)
    ? { tone: "poor", label: "No echo" }
    : (distance != null ? { tone: "good", label: "Echo OK" } : { tone: "neutral", label: "" });

  const rawInflow = d?.reservoir?.inflow_rate_lph;
  const inflow = (d && reservoirIsValid && isFiniteNumber(rawInflow))
    ? Number(rawInflow.toFixed(1))
    : null;
  const inflowStatus = (inflow != null && inflow > 0)
    ? { tone: "good", label: "Recharging" }
    : (inflow != null ? { tone: "neutral", label: "Static" } : { tone: "neutral", label: "" });

  // --- FIELD SENSORS (Strict Fault Gate) ---
  const rawMoisture = d?.soil?.moisture_pct ?? d?.soil?.moisture_index;
  const moisture = (d && !soilFault && isFiniteNumber(rawMoisture) && rawMoisture >= 0)
    ? Number(rawMoisture.toFixed(1))
    : null;
  const moistureStatus = soilFault
    ? { tone: "poor", label: "Sensor Fault" }
    : band(moisture, [35, 75], ["Dry", "Optimal", "Wet"]);

  const rawDryness = d?.soil?.dryness_pct ?? d?.soil?.dryness;
  const dryness = (d && !soilFault && isFiniteNumber(rawDryness) && rawDryness >= 0)
    ? Number(rawDryness.toFixed(1))
    : null;
  const drynessStatus = soilFault
    ? { tone: "poor", label: "Sensor Fault" }
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

  const readings = [
    {
      icon: <Droplets size={22} className="wx-rain" />,
      displayValue: soilFault ? "Sensor Fault" : (moisture != null ? `${moisture}%` : "--"),
      label: "Soil Moisture",
      status: moistureStatus,
    },
    {
      icon: <Sprout size={22} className="wx-soil" />,
      displayValue: soilFault ? "Sensor Fault" : (dryness != null ? `${dryness}%` : "--"),
      label: "Root-zone Dryness",
      status: drynessStatus,
    },
    { icon: <CloudRain size={22} className="wx-rain" />, displayValue: rainValue, label: "Rain Sensor", status: rainStatus },
    { icon: <Droplets size={22} className="wx-rain" />, value: surfaceWetness, unit: "%", label: "Surface Wetness", status: wetnessStatus },

    {
      icon: <Waves size={22} className="wx-rain" />,
      value: displayedTankLevel,
      unit: "%",
      label: "Tank Level",
      status: tankStatus,
    },
    { icon: <Gauge size={22} className="text-green" />, value: litres, unit: " L", label: "Water Stored", status: litresStatus },
    { icon: <Waves size={22} className="wx-rain" />, value: distance, unit: " cm", label: "Ultrasonic Distance", status: distStatus },
    { icon: <Gauge size={22} className="text-green" />, value: inflow, unit: " L/h", label: "Reservoir Inflow", status: inflowStatus },

    { icon: <Thermometer size={22} className="wx-hot" />, value: airTemp, unit: "°C", label: "Air Temperature", status: airTempStatus },
    { icon: <Droplets size={22} className="wx-rain" />, value: humidity, unit: "%", label: "Air Humidity", status: humidityStatus },
    { icon: <Sun size={22} className="wx-sun" />, value: vpd, unit: " kPa", label: "VPD (Atmospheric)", status: vpdStatus },
    { icon: <Sun size={22} className="wx-sun" />, value: et0, unit: " mm/d", label: "Evapotranspiration", status: et0Status },
  ];

  // --- DECISION DIRECTIVE & STATS ---
  const actionText = d?.decision?.action ?? d?.controller?.action ?? (deviceConnected ? "STANDBY" : "Awaiting field data");
  const reasonText = d?.decision?.reason ?? d?.controller?.reason ?? (
    deviceConnected ? "Nominal operation." : "The decision engine on the ESP32 will explain its reasoning here once connected."
  );
  const pumpOn = Boolean(d?.decision?.pump_active ?? d?.controller?.pump_active);

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

  const conf = d?.decision?.confidence_percent ?? d?.controller?.confidence_percent ?? d?.model?.confidence_pct;
  const confidenceStr = (d && isFiniteNumber(conf) && conf >= 0)
    ? `${Math.round(conf)}%`
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

  // --- PREDICTIVE ML STATE ---
  const predStatus = predictionData?.status;

  return (
    <div className="page">
      <PageHeader
        title="Live Hardware Cockpit"
        subtitle="Real-time sensor data from your field (when connected)"
        right={
          <span className={`conn-pill ${deviceConnected ? "on" : "off"}`}>
            <span className="conn-dot" />
            {deviceConnected ? (isStale ? "ONLINE (STALE)" : "ONLINE") : "OFFLINE"}
          </span>
        }
      />

      {!deviceConnected && (
        <div className="card notice-card">
          <WifiOff size={20} />
          <div>
            <strong>Backend unavailable</strong>
            <span>
              Trying <code>{backendUrl || "http://127.0.0.1:8000"}/api/telemetry/latest</code> every 3 seconds{apiError ? ` (${apiError})` : ""}. Recommendations keep working from locality data.
            </span>
          </div>
        </div>
      )}

      <div className="cockpit-grid">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 className="card-title" style={{ margin: 0 }}>Field & Water Telemetry</h3>
            {d?.crop && (
              <span className="chip chip-neutral" style={{ fontSize: 12 }}>
                Active: <strong>{d.crop.name || d.crop.profile_id}</strong>
              </span>
            )}
          </div>

          <div className="sensor-grid">
            {readings.map((r) => (
              <div key={r.label} className="sensor-tile">
                <span className="sensor-icon">{r.icon}</span>
                <div>
                  <strong>{r.displayValue != null ? r.displayValue : (r.value == null ? "--" : `${r.value}${r.unit}`)}</strong>
                  <span>{r.label}</span>
                  {r.status?.label ? <Chip tone={r.status.tone}>{r.status.label}</Chip> : null}
                </div>
              </div>
            ))}
          </div>

          <div className="agronomic-strip" style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "10px",
            marginTop: "16px",
            paddingTop: "14px",
            borderTop: "1px solid var(--border)"
          }}>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Crop Profile</span>
              <strong style={{ fontSize: "14px" }}>{d?.crop?.name || d?.crop?.profile_id || "--"}</strong>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Kc Factor</span>
              <strong style={{ fontSize: "14px" }}>{d && isFiniteNumber(d.crop?.kc_factor) ? d.crop.kc_factor : "--"}</strong>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>MAD Threshold</span>
              <strong style={{ fontSize: "14px" }}>{d && isFiniteNumber(d.crop?.mad_threshold_pct) ? `${d.crop.mad_threshold_pct}%` : "--"}</strong>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Soil Infiltration</span>
              <strong style={{ fontSize: "14px" }}>
                {d?.drainage?.status
                  ? `${d.drainage.status}${isFiniteNumber(d.drainage?.infiltration_rate_pct_min) ? ` (${d.drainage.infiltration_rate_pct_min.toFixed(1)}%/m)` : ""}`
                  : "--"}
              </strong>
            </div>
          </div>
        </div>

        <div className="card sensor-location">
          <h3 className="card-title">Sensor Location</h3>
          <img src="/mode1-smart-farm.png" alt="Field with sensor node" />

          <div className="sensor-meta">
            <div>
              <span>Last Updated</span>
              <strong>{lastUpdated ? lastUpdated.toLocaleTimeString("en-IN", { hour12: false }) : "--:--:--"}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong className={deviceConnected ? "text-green" : "text-muted"}>
                <span className={`conn-dot ${deviceConnected ? "on" : ""}`} /> {deviceConnected ? "ONLINE" : "OFFLINE"}
              </strong>
              {isStale && <div style={{ fontSize: "11px", color: "var(--amber-text)", marginTop: "2px" }}>Telemetry snapshot ({ageMinutes}m ago)</div>}
            </div>
          </div>

          <div className="node-health-box" style={{
            padding: "12px",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.5px", color: "var(--muted)" }}>NODE HEALTH</span>
              {d?.system ? (
                <Chip tone={isAnomalyFault ? "poor" : "good"}>
                  {anomaly}
                </Chip>
              ) : (
                <Chip tone="neutral">No signal</Chip>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <span style={{ display: "block", fontSize: "11px", color: "var(--muted)" }}>Wi-Fi</span>
                <strong style={{ fontSize: "13px" }}>{wifiStatus}</strong>
              </div>
              <div>
                <span style={{ display: "block", fontSize: "11px", color: "var(--muted)" }}>RSSI</span>
                <strong style={{ fontSize: "13px" }}>{wifiRssi}</strong>
              </div>
              <div>
                <span style={{ display: "block", fontSize: "11px", color: "var(--muted)" }}>Firmware</span>
                <strong style={{ fontSize: "13px", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={firmware}>
                  {firmware}
                </strong>
              </div>
              <div>
                <span style={{ display: "block", fontSize: "11px", color: "var(--muted)" }}>Uptime</span>
                <strong style={{ fontSize: "13px" }}>{uptimeStr}</strong>
              </div>
            </div>
          </div>

          <label className="ip-field" title="Backend Telemetry API URL">
            <Settings2 size={14} />
            <input
              value={backendUrl}
              onChange={(e) => onBackendUrlChange ? onBackendUrlChange(e.target.value.trim()) : (onEspIpChange ? onEspIpChange(e.target.value.trim()) : null)}
              placeholder="Backend URL (http://127.0.0.1:8000)"
              aria-label="Backend API URL"
            />
            {deviceConnected ? <Wifi size={14} className="text-green" /> : <WifiOff size={14} className="text-muted" />}
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={activeMode === "personalized"}
              onChange={(e) => onModeChange(e.target.checked ? "personalized" : "general")}
            />
            <span className="switch" />
            Use sensor data for crop recommendations
          </label>
        </div>
      </div>

      {/* --- PREDICTIVE SOIL INTELLIGENCE CARD --- */}
      <div className="card prediction-card" style={{ marginTop: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="sensor-icon" style={{ background: "var(--surface-2)", color: "var(--green, #16a34a)" }}>
              <Sparkles size={20} />
            </span>
            <div>
              <span className="eyebrow" style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Machine Learning Inference
              </span>
              <h3 style={{ margin: 0, fontSize: "17px" }}>Predictive Soil Intelligence</h3>
            </div>
          </div>
          <div>
            {predStatus === "ok" && <Chip tone="good">3-Hour Horizon</Chip>}
            {predStatus === "unavailable" && <Chip tone="poor">{predictionData?.reason || "Unavailable"}</Chip>}
            {predStatus === "warming_up" && <Chip tone="fair">Warming Up</Chip>}
            {predStatus === "missing_features" && <Chip tone="fair">Missing Features</Chip>}
            {predStatus === "model_error" && <Chip tone="poor">Model Error</Chip>}
            {!predictionData && <Chip tone="neutral">No Data</Chip>}
          </div>
        </div>

        {/* State 1: OK */}
        {predStatus === "ok" && (
          <div className="directive-stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div>
              <Droplets size={15} />
              <span>Current Moisture</span>
              <strong>{predictionData.current_soil_moisture_pct}%</strong>
            </div>
            <div>
              <Sparkles size={15} />
              <span>Predicted (in 3h)</span>
              <strong className="text-green">{predictionData.predicted_soil_moisture_pct}%</strong>
            </div>
            <div>
              <TrendingUp size={15} />
              <span>Predicted Change</span>
              <strong>
                {predictionData.change_pct_points > 0 ? `+${predictionData.change_pct_points}` : predictionData.change_pct_points}% points
              </strong>
            </div>
            <div>
              <ShieldCheck size={15} />
              <span>Model Version</span>
              <strong style={{ textTransform: "uppercase" }}>{predictionData.model_version || "V2"} (Direct)</strong>
            </div>
          </div>
        )}

        {/* State 2: UNAVAILABLE */}
        {predStatus === "unavailable" && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "12px 14px",
            borderRadius: "10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border)"
          }}>
            <AlertTriangle size={20} className="text-muted" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", fontSize: "14px", color: "var(--text)", marginBottom: "3px" }}>
                Prediction unavailable
              </strong>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: "1.4" }}>
                {predictionData?.details || `Refused for safety: ${predictionData?.reason || "Sensor quality check failed."}`}
              </p>
            </div>
          </div>
        )}

        {/* State 3: WARMING UP */}
        {predStatus === "warming_up" && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "12px 14px",
            borderRadius: "10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border)"
          }}>
            <Timer size={20} className="text-muted" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", fontSize: "14px", color: "var(--text)", marginBottom: "3px" }}>
                Learning from field history
              </strong>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: "1.4" }}>
                {predictionData?.available_history_hours != null
                  ? `Accumulated ${predictionData.available_history_hours}h of continuous telemetry (${predictionData.required_history_hours || 6}h required for reliable 6-hour lag features).`
                  : (predictionData?.details || "Collecting historical telemetry for temporal features.")}
              </p>
            </div>
          </div>
        )}

        {/* State 4: MISSING FEATURES */}
        {predStatus === "missing_features" && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "12px 14px",
            borderRadius: "10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border)"
          }}>
            <CloudRain size={20} className="text-muted" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", fontSize: "14px", color: "var(--text)", marginBottom: "3px" }}>
                Waiting for required field/weather data
              </strong>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: "1.4" }}>
                {predictionData?.details || "Atmospheric ET0 or rainfall forecast features not yet available for model input vector."}
              </p>
            </div>
          </div>
        )}

        {/* State 5: MODEL ERROR */}
        {predStatus === "model_error" && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "12px 14px",
            borderRadius: "10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border)"
          }}>
            <AlertTriangle size={20} className="text-muted" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", fontSize: "14px", color: "var(--text)", marginBottom: "3px" }}>
                Prediction temporarily unavailable
              </strong>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: "1.4" }}>
                {predictionData?.details || "Inference error occurred. Predictive engine standing by."}
              </p>
            </div>
          </div>
        )}

        {/* State 6: NO DATA YET / DEFAULT */}
        {!predStatus && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "12px 14px",
            borderRadius: "10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border)"
          }}>
            <Sparkles size={20} className="text-muted" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong style={{ display: "block", fontSize: "14px", color: "var(--text)", marginBottom: "3px" }}>
                {deviceConnected ? "Connecting to ML engine..." : "Backend unavailable"}
              </strong>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: "1.4" }}>
                {deviceConnected ? "Requesting 3-hour soil forecast from backend inference service." : "ML predictions require an active backend connection."}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card directive-card">
        <div className="directive-main">
          <span className={`directive-icon ${pumpOn ? "on" : ""}`}><Power size={22} /></span>
          <div>
            <span className="eyebrow">Irrigation directive</span>
            <h3>{actionText}</h3>
            <p className="muted">{reasonText}</p>
          </div>
        </div>
        <div className="directive-stats">
          <div>
            <Power size={15} />
            <span>Pump</span>
            <strong>{d ? (pumpOn ? "ON" : "OFF") : "--"}</strong>
          </div>
          <div>
            <Timer size={15} />
            <span>Run time</span>
            <strong>{runTimeStr}</strong>
          </div>
          <div>
            <Droplets size={15} />
            <span>Prescribed</span>
            <strong>{prescribedStr}</strong>
          </div>
          <div>
            <CloudRain size={15} />
            <span>Rain harvest</span>
            <strong>{harvestStr}</strong>
          </div>
          <div>
            <ShieldCheck size={15} />
            <span>Confidence</span>
            <strong>{confidenceStr}</strong>
          </div>
          <div>
            <AlertTriangle size={15} />
            <span>Disease risk</span>
            {d && riskText ? <Chip tone={RISK_TONE[riskText] ?? "neutral"}>{riskText}</Chip> : <strong>--</strong>}
          </div>
        </div>
        {diseaseReason && <p className="muted small directive-note">{diseaseReason}</p>}
      </div>
    </div>
  );
}

