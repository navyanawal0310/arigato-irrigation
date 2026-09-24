import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Activity,
  Droplets,
  IndianRupee,
  Leaf,
  Moon,
  Play,
  Sprout,
  Sun,
  TrendingUp,
  Users,
  Wifi,
  Waves,
  Gauge,
  ShieldCheck,
} from "lucide-react";

import "./App.css";

function App() {
  const [darkMode, setDarkMode] = useState(false);
  

  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, [darkMode]);
  const [fieldData, setFieldData] = useState(null);
const [deviceConnected, setDeviceConnected] = useState(false);
const [apiError, setApiError] = useState(null);
const failureCount = useRef(0);

useEffect(() => {
  console.log("ARIGATO: starting ESP32 connection...");

  let stopped = false;

  const fetchFieldData = async () => {
    // Never allow overlapping ESP32 requests
    if (fetchFieldData.running) {
      return;
    }

    fetchFieldData.running = true;

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 6000);

    try {
      const response = await fetch(
        "http://10.233.65.251/api/status",
        {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (stopped) return;

      // Valid ESP32 response
      failureCount.current = 0;

      setFieldData(data);
      setDeviceConnected(true);
      setApiError(null);

      console.log("ARIGATO LIVE DATA:", data);

    } catch (error) {
      if (stopped) return;

      failureCount.current += 1;

      // IMPORTANT:
      // Keep the last valid field data on screen.
      // A temporary missed request must NOT erase the dashboard.

      if (error.name === "AbortError") {
        setApiError("Connection temporarily delayed");
      } else {
        setApiError(error.message);
      }

      console.warn(
        `ARIGATO: poll missed (${failureCount.current}) — keeping last valid data`
      );

    } finally {
      clearTimeout(timeout);
      fetchFieldData.running = false;
    }
  };

  fetchFieldData.running = false;

  // First request immediately
  fetchFieldData();

  // Irrigation data does not require rapid polling.
  // One request every 10 seconds is sufficient.
  const interval = setInterval(fetchFieldData, 10000);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}, []);
const areaM2 = fieldData?.field?.area_m2 ?? 0;
const netDemandMm = fieldData?.model?.net_demand_mm ?? 0;
const recommendedWater = fieldData?.model?.recommended_water_l ?? 0;

const theoreticalWater = netDemandMm * areaM2;

const waterWithheld = Math.max(
  theoreticalWater - recommendedWater,
  0
);

const withholdingPercent =
  theoreticalWater > 0
    ? (waterWithheld / theoreticalWater) * 100
    : 0;
  return (
    <div className={`app ${darkMode ? "dark" : ""}`}>

      {/* ================= NAVBAR ================= */}

      <header className="navbar">
        <a href="#home" className="brand">
          <div className="brand-mark">
            <Leaf size={30} strokeWidth={2.2} />
          </div>

          <div className="brand-copy">
            <strong>ARIGATO</strong>
            <span>Smart Irrigation</span>
          </div>
        </a>

        <nav className="nav-links">
          <a className="active" href="#home">
            Home
          </a>

          <a href="#dashboard">
            Dashboard
          </a>

          <a href="#about">
            About
          </a>

          <a href="#team">
            Our Team
          </a>
        </nav>

        <div className="nav-actions">
          <button
            className="theme-button"
            onClick={() => setDarkMode((current) => !current)}
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun size={19} /> : <Moon size={19} />}
          </button>

          <button className="live-button">
            <Wifi size={17} />
            <span>Live Demo</span>
          </button>
        </div>
      </header>

      {/* ================= HERO ================= */}

      <main id="home" className="hero">

        <div className="hero-shade" />

        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />

        <section className="hero-content">

          <div className="hero-kicker">
            <span className="kicker-line" />

            <span>
              SENSING TODAY. SMARTER DECISIONS FOR TOMORROW.
            </span>
          </div>

          <h1 className="hero-title">
            Smarter Irrigation
            <span>Healthier Farms</span>
          </h1>

          <p className="hero-description">
            A low-cost IoT intelligence system helping smallholder
            farmers make better irrigation decisions using real-time
            field data — so every drop of water creates more value.
          </p>

          <div className="hero-actions">

            <a className="primary-button" href="#dashboard">
              <BarChart3 size={19} />
              View Live Dashboard
              <ArrowRight size={18} />
            </a>

            <a className="secondary-button" href="#about">
              <span className="play-icon">
                <Play size={13} fill="currentColor" />
              </span>

              How It Works
            </a>

          </div>

          <div className="benefits">

            <Benefit
              icon={<Droplets size={22} />}
              title="Conserve"
              subtitle="Water"
            />

            <Benefit
              icon={<TrendingUp size={22} />}
              title="Improve"
              subtitle="Yield"
            />

            <Benefit
              icon={<IndianRupee size={22} />}
              title="Reduce"
              subtitle="Costs"
            />

            <Benefit
              icon={<Users size={22} />}
              title="Support"
              subtitle="Farmers"
            />

          </div>

        </section>

        {/* ================= LIVE FIELD CARD ================= */}

        <aside className="field-card">

          <div className="field-card-top">

            <div className="field-status-title">
              <span className="live-dot" />
              <strong>Live Field Status</strong>
            </div>

            <span className="node-id">
              FIELD NODE 01
            </span>

          </div>

         <SensorRow
  icon={<Droplets size={18} />}
  name="Weather"
  value={
    fieldData
      ? fieldData.weather?.source === "LIVE"
        ? "Live"
        : "Fallback"
      : "Loading..."
  }
  state={
    fieldData?.weather?.source === "LIVE"
      ? "success"
      : "warning"
  }
/>

<SensorRow
  icon={<Waves size={18} />}
  name="Tank Level"
  value={
    !deviceConnected
      ? "--"
      : fieldData?.reservoir?.sensor_ok
      ? `${Math.round(fieldData.reservoir.level_percent)}%`
      : "Sensor fault"
  }
  state={
    !deviceConnected
      ? "neutral"
      : fieldData?.reservoir?.sensor_ok
      ? fieldData.reservoir.level_percent > 20
        ? "success"
        : "warning"
      : "warning"
  }
/>

<SensorRow
  icon={<Sprout size={18} />}
  name="Soil Moisture"
  value={
    !deviceConnected
      ? "--"
      : fieldData?.soil?.sensor_ok
      ? `${Math.round(fieldData.soil.moisture_index)}%`
      : "Sensor fault"
  }
  state={
    !deviceConnected
      ? "neutral"
      : fieldData?.soil?.sensor_ok
      ? "success"
      : "warning"
  }
/>

<SensorRow
  icon={<Wifi size={18} />}
  name="Node Status"
  value={deviceConnected ? "Online" : "Offline"}
  state={deviceConnected ? "success" : "warning"}
/>
          <div className="field-card-bottom">

            <span>
  <Wifi size={14} />
  {deviceConnected ? "ESP32 connected" : "ESP32 disconnected"}
</span>

<span className="field-time">
  {fieldData?.system
    ? `V${fieldData.system.version}`
    : "Connecting..."}
</span>

          </div>

        </aside>

        <div className="impact-note">
          <span>Small ideas.</span>
          <strong>Big impact.</strong>
          <i />
        </div>

        <div className="scroll-indicator">
          <span>EXPLORE</span>
          <div />
        </div>

      </main>

      {/* ================= VALUE STRIP ================= */}

      <section className="value-strip">

        <ValueCard
          icon={<Droplets size={25} />}
          heading="Smarter Water Use"
          text="Irrigate only when conditions require it"
        />

        <ValueCard
          icon={<TrendingUp size={25} />}
          heading="Better Decisions"
          text="Convert field readings into clear actions"
        />

        <ValueCard
          icon={<IndianRupee size={25} />}
          heading="Lower Waste"
          text="Reduce unnecessary pumping and water use"
        />

        <ValueCard
          icon={<ShieldCheck size={25} />}
          heading="Explainable"
          text="Show farmers why each action is recommended"
        />

      </section>

      {/* ================= MINI PRODUCT INTRO ================= */}

      <section id="about" className="product-intro">

        <div className="section-label">
          <span />
          THE IDEA
        </div>

        <div className="intro-grid">

          <div className="intro-heading">

            <h2>
              From field signals
              <span>to useful decisions.</span>
            </h2>

          </div>

          <div className="intro-copy">

            <p>
              Arigato combines a lightweight field node with an
              intelligent software layer. Instead of adding hardware
              for every possible measurement, the system focuses on
              useful signals and turns them into practical irrigation
              guidance.
            </p>

            <div className="intro-points">

              <MiniPoint
                icon={<Gauge size={19} />}
                title="Sense"
                text="Capture field conditions"
              />

              <MiniPoint
                icon={<Wifi size={19} />}
                title="Connect"
                text="Transmit live readings"
              />

              <MiniPoint
                icon={<Leaf size={19} />}
                title="Decide"
                text="Recommend the next action"
              />

            </div>

          </div>

        </div>

      </section>

{/* ================= LIVE INTELLIGENCE DASHBOARD ================= */}

<section id="dashboard" className="live-dashboard">

  <div className="dashboard-heading">

    <div>
      <div className="section-label">
        <span />
        LIVE INTELLIGENCE
      </div>

      <h2>
        What should the farmer
        <span>do right now?</span>
      </h2>
    </div>

    <div
      className={`connection-pill ${
        deviceConnected ? "connected" : "disconnected"
      }`}
    >
      <span className="live-dot" />
      {deviceConnected ? "FIELD NODE LIVE" : "FIELD NODE OFFLINE"}
    </div>

  </div>

  {!deviceConnected || !fieldData ? (

    <div className="dashboard-offline">
      <Wifi size={32} />

      <div>
        <strong>Waiting for field node</strong>
        <span>
          Connect the ESP32 to begin receiving live intelligence.
        </span>
      </div>
    </div>

  ) : (

    <>
      {/* MAIN DECISION */}

      <div className="intelligence-decision">

        <div className="decision-symbol">
          <Leaf size={32} />
        </div>

        <div className="decision-copy">

          <span>CURRENT RECOMMENDATION</span>

          <h3>
            {fieldData.decision?.action ?? "ANALYSING"}
          </h3>

          <p>
            {fieldData.decision?.reason ??
              "Waiting for sufficient field information."}
          </p>

        </div>

        <div className="decision-meta">

          <div>
            <span>PRIORITY</span>
            <strong>
              {fieldData.decision?.priority ?? "--"}
            </strong>
          </div>

          <div>
            <span>CONFIDENCE</span>
            <strong>
              {fieldData.decision?.confidence_percent ?? 0}%
            </strong>
          </div>

        </div>

      </div>


      {/* LIVE SENSOR CARDS */}

      <div className="metric-grid">

        <LiveMetric
          icon={<Sprout size={22} />}
          label="Soil Moisture"
          value={
            fieldData.soil?.sensor_ok
              ? `${Math.round(fieldData.soil.moisture_index)}%`
              : "FAULT"
          }
          detail={
            fieldData.soil?.sensor_ok
              ? `Dryness ${Math.round(
                  fieldData.soil.dryness_score
                )}%`
              : "Sensor unavailable"
          }
        />

        <LiveMetric
          icon={<Waves size={22} />}
          label="Reservoir"
          value={`${Math.round(
            fieldData.reservoir?.level_percent ?? 0
          )}%`}
          detail={
            fieldData.reservoir?.state ?? "Unknown"
          }
        />

        <LiveMetric
          icon={<Droplets size={22} />}
          label="Weather"
          value={fieldData.weather?.source ?? "--"}
          detail={`${Number(
            fieldData.weather?.effective_rain_mm ?? 0
          ).toFixed(1)} mm effective rain`}
        />

      </div>


      {/* MODEL OUTPUT */}

      <div className="model-panel">

        <div className="model-panel-title">
          <div>
            <Gauge size={21} />
            <span>IRRIGATION MODEL</span>
          </div>

          <span>V{fieldData.system?.version}</span>
        </div>

        <div className="model-grid">

          <ModelMetric
            label="Crop ET"
            value={`${Number(
              fieldData.model?.crop_et_mm_day ?? 0
            ).toFixed(2)} mm/day`}
          />

          <ModelMetric
            label="Net Water Demand"
            value={`${Number(
              fieldData.model?.net_demand_mm ?? 0
            ).toFixed(2)} mm`}
          />

          <ModelMetric
            label="Recommended Water"
            value={`${Number(
              fieldData.model?.recommended_water_l ?? 0
            ).toFixed(1)} L`}
            highlight
          />

        </div>

      </div>


      {/* EXPLAINABILITY */}

      <div className="explain-panel">

        <div className="explain-copy">

          <span className="explain-label">
            WHY THIS DECISION?
          </span>

          <strong>
            {fieldData.decision?.reason}
          </strong>

          <p>
            ARIGATO combines field conditions, crop demand,
            reservoir availability and weather information before
            recommending irrigation.
          </p>

        </div>

        <div
          className={`automation-state ${
            fieldData.decision?.automation_ready
              ? "ready"
              : "locked"
          }`}
        >
          <ShieldCheck size={24} />

          <div>
            <span>AUTOMATION</span>

            <strong>
              {fieldData.decision?.automation_ready
                ? "READY"
                : "LOCKED"}
            </strong>
          </div>

        </div>

      </div>

{/* EXPLAINABLE DECISION PIPELINE */}

<div className="decision-pipeline">

  <div className="pipeline-header">
    <div>
      <Gauge size={21} />
      <span>DECISION BREAKDOWN</span>
    </div>

    <strong>LIVE MODEL TRACE</strong>
  </div>

  <div className="pipeline-flow">

    <DecisionFactor
      number="01"
      title="Soil Stress"
      value={`${Math.round(
        fieldData.soil?.dryness_score ?? 0
      )}%`}
      detail={
        (fieldData.soil?.dryness_score ?? 0) >= 70
          ? "High irrigation pressure"
          : (fieldData.soil?.dryness_score ?? 0) >= 40
          ? "Moderate irrigation pressure"
          : "Low irrigation pressure"
      }
      active={(fieldData.soil?.dryness_score ?? 0) >= 40}
    />

    <div className="pipeline-arrow">
      <ArrowRight size={18} />
    </div>

    <DecisionFactor
      number="02"
      title="Crop Demand"
      value={`${Number(
        fieldData.model?.net_demand_mm ?? 0
      ).toFixed(2)} mm`}
      detail={
        (fieldData.model?.net_demand_mm ?? 0) > 0
          ? "Crop requires water"
          : "No current demand"
      }
      active={(fieldData.model?.net_demand_mm ?? 0) > 0}
    />

    <div className="pipeline-arrow">
      <ArrowRight size={18} />
    </div>

    <DecisionFactor
      number="03"
      title="Water Supply"
      value={`${Math.round(
        fieldData.reservoir?.level_percent ?? 0
      )}%`}
      detail={
        (fieldData.reservoir?.level_percent ?? 0) <= 20
          ? "Reservoir critically low"
          : "Water available"
      }
      active={(fieldData.reservoir?.level_percent ?? 0) > 20}
      danger={(fieldData.reservoir?.level_percent ?? 0) <= 20}
    />

    <div className="pipeline-arrow">
      <ArrowRight size={18} />
    </div>

    <DecisionFactor
      number="04"
      title="Weather"
      value={`${Number(
        fieldData.weather?.effective_rain_mm ?? 0
      ).toFixed(1)} mm`}
      detail={
        (fieldData.weather?.effective_rain_mm ?? 0) > 0
          ? "Rain reduces irrigation"
          : fieldData.weather?.source === "LIVE"
          ? "No effective rain"
          : "Fallback estimate"
      }
      active={fieldData.weather?.source === "LIVE"}
    />

  </div>

  <div className="pipeline-result">

    <div>
      <span>FINAL DECISION</span>

      <strong>
        {fieldData.decision?.action ?? "ANALYSING"}
      </strong>
    </div>

    <p>
      {fieldData.decision?.reason}
    </p>

    <div className="pipeline-confidence">
      <span>MODEL CONFIDENCE</span>
      <strong>
        {fieldData.decision?.confidence_percent ?? 0}%
      </strong>
    </div>

  </div>

</div>

{/* SYSTEM HEALTH + ANOMALY DETECTION */}

<div className="health-panel">

  <div className="health-header">
    <div>
      <Activity size={21} />
      <span>SYSTEM HEALTH</span>
    </div>

    <strong>
      {fieldData.decision?.confidence_percent ?? 0}% CONFIDENCE
    </strong>
  </div>

  <div className="health-grid">

    <HealthItem
      label="Soil Sensor"
      healthy={fieldData.soil?.sensor_ok}
      healthyText="Healthy"
      faultText="Sensor Fault"
    />

    <HealthItem
      label="Reservoir Sensor"
      healthy={fieldData.reservoir?.sensor_ok}
      healthyText="Healthy"
      faultText="Sensor Fault"
    />

    <HealthItem
      label="Weather Intelligence"
      healthy={fieldData.weather?.source === "LIVE"}
      healthyText="Live Data"
      faultText="Fallback Mode"
      warning
    />

    <HealthItem
      label="ESP32 Link"
      healthy={deviceConnected}
      healthyText="Connected"
      faultText="Connection Lost"
    />

  </div>

  <div className="health-message">

    <ShieldCheck size={21} />

    <div>
      <span>ANOMALY MONITOR</span>

      <strong>
        {!fieldData.soil?.sensor_ok
          ? "Soil sensor requires attention"
          : !fieldData.reservoir?.sensor_ok
          ? "Reservoir sensor requires attention"
          : fieldData.weather?.source !== "LIVE"
          ? "Weather API unavailable — fallback model active"
          : "All monitored systems operating normally"}
      </strong>
    </div>

  </div>

</div>


      {/* FIELD PROFILE */}

      <div className="field-profile">

        <Leaf size={17} />

        <span>{fieldData.field?.crop}</span>

        <i />

        <span>{fieldData.field?.growth_stage}</span>

        <i />

        <span>{fieldData.field?.soil_type} Soil</span>

        <i />

        <span>{fieldData.field?.area_m2} m²</span>

      </div>

    </>

  )}

</section>
{/* WATER INTELLIGENCE */}
<section className="water-intelligence">

  <div className="water-heading">
    <div>
      <span className="section-kicker">WATER INTELLIGENCE</span>
      <h3>
        Every litre has a <span>reason.</span>
      </h3>
    </div>

    <div className="water-model-badge">
      LIVE CALCULATION
    </div>
  </div>

  <div className="water-metrics">

    <div className="water-metric">
      <span className="metric-number">
        {theoreticalWater.toFixed(1)}
        <small> L</small>
      </span>

      <strong>Crop Requirement</strong>
      <p>
        Water theoretically required from current crop demand.
      </p>
    </div>

    <div className="metric-divider" />

    <div className="water-metric">
      <span className="metric-number green">
        {recommendedWater.toFixed(1)}
        <small> L</small>
      </span>

      <strong>Recommended Now</strong>
      <p>
        Water ARIGATO currently recommends applying.
      </p>
    </div>

    <div className="metric-divider" />

    <div className="water-metric">
      <span className="metric-number amber">
        {waterWithheld.toFixed(1)}
        <small> L</small>
      </span>

      <strong>Currently Withheld</strong>
      <p>
        Water intentionally not prescribed under current conditions.
      </p>
    </div>

  </div>

  <div className="water-reason">

    <div className="reason-top">
      <span>WHY IS WATER BEING WITHHELD?</span>

      <strong>
        {withholdingPercent.toFixed(0)}%
      </strong>
    </div>

    <div className="decision-flow">

      <div className="flow-node active">
        <span>01</span>
        <strong>Crop Demand</strong>
        <small>{netDemandMm.toFixed(2)} mm</small>
      </div>

      <div className="flow-arrow">→</div>

      <div
        className={`flow-node ${
          fieldData?.reservoir?.state === "CRITICAL"
            ? "warning"
            : "active"
        }`}
      >
        <span>02</span>
        <strong>Water Supply</strong>
        <small>
          {fieldData?.reservoir?.level_percent ?? 0}% available
        </small>
      </div>

      <div className="flow-arrow">→</div>

      <div className="flow-node final">
        <span>03</span>
        <strong>Decision</strong>
        <small>
          {fieldData?.decision?.action ?? "WAITING"}
        </small>
      </div>

    </div>

    <p className="water-explanation">
      ARIGATO compares crop demand with field conditions, reservoir
      availability and weather intelligence before prescribing water.
      Water withheld because of a constraint is tracked separately from
      genuine water savings.
    </p>

  </div>

</section>
      {/* ================= TEAM PLACEHOLDER ================= */}

      <section id="team" className="team-section">

        <div>
          <div className="section-label">
            <span />
            BUILT FOR NIRMAAN 2026
          </div>

          <h2>Arigato Algorithms</h2>

          <p>
            Building a focused, low-cost irrigation prototype around
            practical sensing, intelligent decisions and a clear farmer
            experience.
          </p>
        </div>

        <div className="team-badge">
          <Leaf size={28} />
          <div>
            <span>BUILD.</span>
            <span>INNOVATE.</span>
            <strong>IMPACT.</strong>
          </div>
        </div>

      </section>

      {/* ================= FOOTER ================= */}

      <footer className="footer">

        <div className="footer-main">

          <div className="footer-brand">

            <div className="brand footer-logo">

              <div className="brand-mark">
                <Leaf size={29} />
              </div>

              <div className="brand-copy">
                <strong>ARIGATO</strong>
                <span>Smart Irrigation</span>
              </div>

            </div>

            <p>
              A smarter, more sustainable approach to irrigation for
              smallholder farms.
            </p>

          </div>

          <div className="footer-links">

            <h4>Explore</h4>

            <a href="#home">Home</a>
            <a href="#dashboard">Dashboard</a>
            <a href="#about">About</a>
            <a href="#team">Our Team</a>

          </div>

          <div className="footer-links">

            <h4>Prototype</h4>

            <span>ESP32 Field Node</span>
            <span>Live Dashboard</span>
            <span>Decision Engine</span>
            <span>Anomaly Detection</span>

          </div>

          <div className="footer-statement">

            <Leaf size={24} />

            <p>
              Technology for a
              <strong> greener tomorrow.</strong>
            </p>

          </div>

        </div>

        <div className="footer-bottom">

          <span>
            © 2026 Arigato Algorithms
          </span>

          <div>
            <span>BMSITM</span>
            <i />
            <span>NIRMAAN 2026</span>
          </div>

        </div>

      </footer>

    </div>
  );
}


function Benefit({ icon, title, subtitle }) {
  return (
    <div className="benefit">

      <div className="benefit-icon">
        {icon}
      </div>

      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>

    </div>
  );
}


function SensorRow({ icon, name, value, state }) {
  return (
    <div className="sensor-row">

      <div className="sensor-name">

        <span className="sensor-icon">
          {icon}
        </span>

        <span>{name}</span>

      </div>

      <strong className={`sensor-value ${state}`}>
        {value}
      </strong>

    </div>
  );
}


function ValueCard({ icon, heading, text }) {
  return (
    <article className="value-card">

      <div className="value-icon">
        {icon}
      </div>

      <div>
        <h3>{heading}</h3>
        <p>{text}</p>
      </div>

    </article>
  );
}


function MiniPoint({ icon, title, text }) {
  return (
    <div className="mini-point">

      <div>
        {icon}
      </div>

      <p>
        <strong>{title}</strong>
        <span>{text}</span>
      </p>

    </div>
  );
}

function LiveMetric({ icon, label, value, detail }) {
  return (
    <div className="live-metric">

      <div className="live-metric-icon">
        {icon}
      </div>

      <span>{label}</span>

      <strong>{value}</strong>

      <small>{detail}</small>

    </div>
  );
}


function ModelMetric({ label, value, highlight = false }) {
  return (
    <div className={`model-metric ${highlight ? "highlight" : ""}`}>

      <span>{label}</span>

      <strong>{value}</strong>

    </div>
  );
}
function DecisionFactor({
  number,
  title,
  value,
  detail,
  active = false,
  danger = false,
}) {
  return (
    <div
      className={`decision-factor ${
        danger ? "danger" : active ? "active" : ""
      }`}
    >
      <span className="factor-number">{number}</span>

      <span className="factor-title">{title}</span>

      <strong>{value}</strong>

      <small>{detail}</small>

      <div className="factor-indicator">
        <i />
      </div>
    </div>
  );
}
function HealthItem({
  label,
  healthy,
  healthyText,
  faultText,
  warning = false,
}) {
  return (
    <div className="health-item">

      <span className="health-item-label">
        {label}
      </span>

      <div
        className={`health-state ${
          healthy ? "healthy" : warning ? "caution" : "fault"
        }`}
      >
        <i />
        {healthy ? healthyText : faultText}
      </div>

    </div>
  );
}
export default App;