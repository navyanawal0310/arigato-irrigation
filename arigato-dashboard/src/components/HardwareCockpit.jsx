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

const RISK_TONE = { LOW: "good", MODERATE: "fair", HIGH: "poor" };

function band(value, [low, high], labels = ["Low", "Optimal", "High"]) {
  if (value == null) return { tone: "neutral", label: "No signal" };
  if (value < low) return { tone: "fair", label: labels[0] };
  if (value > high) return { tone: "fair", label: labels[2] };
  return { tone: "good", label: labels[1] };
}

export default function HardwareCockpit({ fieldData, deviceConnected, espIp, onEspIpChange, apiError, lastUpdated, activeMode, onModeChange }) {
  const d = deviceConnected ? fieldData : null;
  const num = (v, digits = 0) => (v == null ? null : Number(Number(v).toFixed(digits)));

  const moisture = num(d?.soil?.moisture_index);
  const dryness = num(d?.soil?.dryness);
  const tank = num(d?.reservoir?.level_percent);
  const litres = num(d?.reservoir?.water_litres, 1);
  const airTemp = num(d?.weather?.temp_c, 1);
  const humidity = num(d?.weather?.humidity_pct);
  const rain = num(d?.weather?.rain_forecast_mm, 1);
  const et0 = num(d?.weather?.et0_mm_day, 1);

  const readings = [
    { icon: <Droplets size={22} className="wx-rain" />, value: moisture, unit: "%", label: "Soil Moisture", status: band(moisture, [35, 75]) },
    { icon: <Sprout size={22} className="wx-soil" />, value: dryness, unit: "%", label: "Root-zone Dryness", status: band(dryness, [0, 55], ["", "Normal", "Dry"]) },
    { icon: <Waves size={22} className="wx-rain" />, value: tank, unit: "%", label: "Tank Level", status: band(tank, [25, 100], ["Refill", "Good", ""]) },
    { icon: <Gauge size={22} className="text-green" />, value: litres, unit: " L", label: "Water Stored", status: band(litres, [2, Infinity], ["Low", "Good", ""]) },
    { icon: <Thermometer size={22} className="wx-hot" />, value: airTemp, unit: "°C", label: "Air Temperature", status: band(airTemp, [15, 34], ["Cool", "Normal", "Hot"]) },
    { icon: <Droplets size={22} className="wx-rain" />, value: humidity, unit: "%", label: "Air Humidity", status: band(humidity, [35, 80], ["Dry", "Normal", "Humid"]) },
    { icon: <CloudRain size={22} className="wx-rain" />, value: rain, unit: " mm", label: "Rain Forecast", status: band(rain, [0, 5], ["", "Low", "Rain due"]) },
    { icon: <Sun size={22} className="wx-sun" />, value: et0, unit: " mm/d", label: "Evapotranspiration", status: band(et0, [0, 6], ["", "Normal", "High"]) },
  ];

  const pumpOn = d?.decision?.pump_active ?? false;
  const risk = d?.disease?.risk_level ?? "LOW";
  const runMin = ((d?.model?.run_duration_sec ?? 0) / 60).toFixed(1);

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
          <h3 className="card-title">Sensor Readings</h3>
          <div className="sensor-grid">
            {readings.map((r) => (
              <div key={r.label} className="sensor-tile">
                <span className="sensor-icon">{r.icon}</span>
                <div>
                  <strong>{r.value == null ? "--" : `${r.value}${r.unit}`}</strong>
                  <span>{r.label}</span>
                  {r.status.label && <Chip tone={r.status.tone}>{r.status.label}</Chip>}
                </div>
              </div>
            ))}
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
            <h3>{d?.decision?.action ?? "Awaiting field data"}</h3>
            <p className="muted">{d?.decision?.reason ?? "The decision engine on the ESP32 will explain its reasoning here once connected."}</p>
          </div>
        </div>
        <div className="directive-stats">
          <div><Power size={15} /><span>Pump</span><strong>{d ? (pumpOn ? "ON" : "OFF") : "--"}</strong></div>
          <div><Timer size={15} /><span>Run time</span><strong>{d ? `${runMin} min` : "--"}</strong></div>
          <div><Droplets size={15} /><span>Prescribed</span><strong>{d ? `${Number(d.model?.prescribed_litres ?? 0).toFixed(1)} L` : "--"}</strong></div>
          <div><CloudRain size={15} /><span>Rain harvest</span><strong>{d ? `${Math.round(d.model?.harvest_potential_l ?? 0)} L` : "--"}</strong></div>
          <div><ShieldCheck size={15} /><span>Confidence</span><strong>{d ? `${d.model?.confidence_pct ?? 0}%` : "--"}</strong></div>
          <div>
            <AlertTriangle size={15} />
            <span>Disease risk</span>
            {d ? <Chip tone={RISK_TONE[risk] ?? "neutral"}>{risk}</Chip> : <strong>--</strong>}
          </div>
        </div>
        {d?.disease?.reason && <p className="muted small directive-note">{d.disease.reason}</p>}
      </div>
    </div>
  );
}
