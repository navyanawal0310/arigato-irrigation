import { ArrowRight, Cpu, Droplets, Globe, IndianRupee, Mountain, Play, Radio, ScanSearch, Sprout, Thermometer } from "lucide-react";
import { WeatherIcon } from "./ui";
import { inr } from "../utils/format";

const FEATURES = [
  { id: "locality", icon: ScanSearch, title: "Locality Analysis", text: "Live weather, soil & agro-climatic zone for your village." },
  { id: "recommendations", icon: Sprout, title: "Crop Recommendations", text: "Minor crops ranked by suitability for your land." },
  { id: "revenue", icon: IndianRupee, title: "Revenue Estimation", text: "See the extra income a small plot portion can earn." },
  { id: "cockpit", icon: Cpu, title: "Real-time Sensor Data", text: "ESP32 field node for soil moisture & irrigation." },
];

export default function HomePage({ localityData, engine, activeMode, onModeChange, deviceConnected, onNavigate }) {
  const top = engine.topRecommendation;
  const stats = [
    { icon: <Thermometer size={22} className="wx wx-sun" />, value: `${localityData?.temp ?? "--"}°C`, label: "Temperature" },
    { icon: <Droplets size={22} className="wx wx-rain" />, value: `${localityData?.humidity ?? "--"}%`, label: "Humidity" },
    { icon: <WeatherIcon code={localityData?.weatherCode ?? 61} />, value: `${localityData?.rainfall ?? "--"} mm`, label: "Rainfall (Today)" },
    { icon: <Mountain size={22} className="wx wx-soil" />, value: localityData?.soilType?.replace(" Soil", "") ?? "--", label: "Soil Type" },
  ];

  return (
    <div className="page home-page">
      <section className="hero">
        <img className="hero-bg" src="/farmer-golden-hour.jpg" alt="" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <span className="hero-kicker">Welcome to</span>
          <h1>KRISHI SETU</h1>
          <p>Data-driven insights for a more profitable and sustainable farming future.</p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => onNavigate("profile")}>
              Get Started <ArrowRight size={16} />
            </button>
            <button className="btn btn-glass btn-lg" onClick={() => onNavigate("about")}>
              <Play size={15} fill="currentColor" /> How it Works
            </button>
          </div>
        </div>
      </section>

      <div className="hero-stats card">
        {stats.map((s) => (
          <div key={s.label} className="hero-stat">
            <span className="hero-stat-icon">{s.icon}</span>
            <div>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Key Features</h2>
      <div className="feature-grid">
        {FEATURES.map(({ id, icon: Icon, title, text }) => (
          <button key={id} className="card feature-card" onClick={() => onNavigate(id)}>
            <span className="feature-icon"><Icon size={26} /></span>
            <strong>{title}</strong>
            <span>{text}</span>
          </button>
        ))}
      </div>

      <div className="home-bottom-grid">
        <div className="card insight-card">
          <span className="eyebrow">Today's best opportunity</span>
          <div className="insight-row">
            <span className="insight-emoji">{top?.icon}</span>
            <div>
              <strong>{top?.shortName}</strong>
              <span>{top?.suitabilityScore}% suitable for {localityData?.shortName ?? "your locality"}</span>
            </div>
            <div className="insight-gain">
              <strong>+{inr(engine.economics.additionalRevenue)}</strong>
              <span>additional per season</span>
            </div>
          </div>
          <button className="btn btn-soft" onClick={() => onNavigate("revenue")}>
            See revenue breakdown <ArrowRight size={14} />
          </button>
        </div>

        <div className="card mode-card">
          <span className="eyebrow">Recommendation mode</span>
          <div className="segmented">
            <button className={activeMode === "general" ? "active" : ""} onClick={() => onModeChange("general")}>
              <Globe size={15} /> Locality API
            </button>
            <button className={activeMode === "personalized" ? "active" : ""} onClick={() => onModeChange("personalized")}>
              <Radio size={15} /> Field Sensors
            </button>
          </div>
          <p className="muted small">
            {activeMode === "general"
              ? "Using live Open-Meteo weather and ICAR soil data — no hardware needed."
              : deviceConnected
                ? "Live ESP32 soil moisture is refining every suitability score."
                : "Waiting for the ESP32 field node. Scores use locality data until it connects."}
          </p>
        </div>
      </div>
    </div>
  );
}
