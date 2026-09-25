import {
  AlertTriangle,
  CloudRain,
  Droplets,
  Gauge,
  Power,
  Settings2,
  ShieldCheck,
  Sprout,
  Sun,
  Thermometer,
  Timer,
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
  deviceConnected,
  espIp,
  onEspIpChange,
  apiError,
  lastUpdated,
  activeMode,
  onModeChange,
}) {
  const d = deviceConnected ? fieldData : null;

  // --- SENSOR FAULT CHECKS ---
  const soilStatus = d?.soil?.status;
  const soilFault = Boolean(d && (!isSensorHealthy(soilStatus) || soilStatus === "FAULT"));

  const resStatus = d?.reservoir?.status;
  const rawLevel = d?.reservoir?.level_pct ?? d?.reservoir?.level_percent;
  const rawDist = d?.reservoir?.distance_cm;
  const resFault = Boolean(
    d && (
      !isSensorHealthy(resStatus) ||
      resStatus === "OUT_OF_RANGE" ||
      rawLevel === -1 ||
      (isFiniteNumber(rawLevel) && rawLevel < 0) ||
      rawDist === -1 ||
      (isFiniteNumber(rawDist) && rawDist < 0)
    )
  );

  // --- FIELD SENSORS ---
  const rawMoisture = d?.soil?.moisture_pct ?? d?.soil?.moisture_index;
  const moisture = (d && !soilFault && isFiniteNumber(rawMoisture) && rawMoisture >= 0)
    ? Number(rawMoisture.toFixed(1))
    : null;
  const moistureStatus = soilFault
    ? { tone: "poor", label: "Sensor fault" }
    : band(moisture, [35, 75], ["Dry", "Optimal", "Wet"]);

  const rawDryness = d?.soil?.dryness_pct ?? d?.soil?.dryness;
  const dryness = (d && !soilFault && isFiniteNumber(rawDryness) && rawDryness >= 0)
    ? Number(rawDryness.toFixed(1))
    : null;
  const drynessStatus = soilFault
    ? { tone: "poor", label: "Sensor fault" }
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

  // --- WATER SYSTEM ---
  const tank = (d && !resFault && isFiniteNumber(rawLevel) && rawLevel >= 0)
    ? Number(rawLevel.toFixed(1))
    : null;
  const tankStatus = resFault
    ? { tone: "poor", label: "Out of range" }
    : band(tank, [25, 100], ["Refill", "Good", ""]);

  const rawLitres = d?.reservoir?.storage_litres ?? (
    isFiniteNumber(d?.reservoir?.water_ml) && d.reservoir.water_ml >= 0
      ? d.reservoir.water_ml / 1000
      : null
  );
  const litres = (d && !resFault && isFiniteNumber(rawLitres) && rawLitres >= 0)
    ? Number(rawLitres.toFixed(1))
    : null;
  const litresStatus = resFault
    ? { tone: "poor", label: "Unavailable" }
    : band(litres, [200, Infinity], ["Low", "Good", ""]);

  const distance = (d && !resFault && isFiniteNumber(rawDist) && rawDist >= 0)
    ? Number(rawDist.toFixed(1))
    : null;
  const distStatus = resFault
    ? { tone: "poor", label: "No echo" }
    : (distance != null ? { tone: "good", label: "Echo OK" } : { tone: "neutral", label: "" });

  const rawInflow = d?.reservoir?.inflow_rate_lph;
  const inflow = (d && !resFault && isFiniteNumber(rawInflow))
    ? Number(rawInflow.toFixed(1))
    : null;
  const inflowStatus = (inflow != null && inflow > 0)
    ? { tone: "good", label: "Recharging" }
    : (inflow != null ? { tone: "neutral", label: "Static" } : { tone: "neutral", label: "" });

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
    { icon: <Droplets size={22} className="wx-rain" />, value: moisture, unit: "%", label: "Soil Moisture", status: moistureStatus },
    { icon: <Sprout size={22} className="wx-soil" />, value: dryness, unit: "%", label: "Root-zone Dryness", status: drynessStatus },
    { icon: <CloudRain size={22} className="wx-rain" />, displayValue: rainValue, label: "Rain Sensor", status: rainStatus },
    { icon: <Droplets size={22} className="wx-rain" />, value: surfaceWetness, unit: "%", label: "Surface Wetness", status: wetnessStatus },

    { icon: <Waves size={22} className="wx-rain" />, value: tank, unit: "%", label: "Tank Level", status: tankStatus },
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

  return (
    <div className="page">
      <PageHeader
        title="Live Hardware Cockpit"
        subtitle="Real-time sensor data from your field (when connected)"
        right={
          <span className={`conn-pill ${deviceConnected ? "on" : "off"}`}>
            <span className="conn-dot" />
            {deviceConnected ? "Connected" : "Not connected"}
          </span>
        }
      />

      {!deviceConnected && (
        <div className="card notice-card">
          <WifiOff size={20} />
          <div>
            <strong>ESP32 field node not reachable</strong>
            <span>
              Trying <code>http://{espIp}/api/status</code> every 3 seconds{apiError ? ` (last error: ${apiError})` : ""}. Recommendations keep working from locality data.
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
                <span className={`conn-dot ${deviceConnected ? "on" : ""}`} /> {deviceConnected ? "Online" : "Offline"}
              </strong>
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

          <label className="ip-field">
            <Settings2 size={14} />
            <input value={espIp} onChange={(e) => onEspIpChange(e.target.value.trim())} placeholder="ESP32 IP address" aria-label="ESP32 IP address" />
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

