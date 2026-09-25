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
  AlertTriangle,
  Clock,
  CloudRain,
  Settings,
  Flame,
} from "lucide-react";

import "./App.css";

// Multilingual Dictionary (English + Kannada)
const TRANSLATIONS = {
  en: {
    brandSubtitle: "Smart Irrigation & Crop Defense",
    navHome: "Home",
    navDashboard: "Live Cockpit",
    navAbout: "How it Works",
    navTeam: "Team",
    heroKicker: "SENSING TODAY. SMARTER DECISIONS FOR TOMORROW.",
    heroTitle1: "Smarter Irrigation,",
    heroTitle2: "Healthier Harvests.",
    heroDesc:
      "A closed-loop agronomic intelligence system engineered for smallholder farmers. Fuses underground capacitive soil stress with FAO-56 atmospheric demand, fungal pathogen defense, and rooftop rain harvesting.",
    ctaCockpit: "View Live Cockpit",
    ctaHow: "How it Works",
    benefitWater: "Conserve Water",
    benefitYield: "Maximize Yield",
    benefitCost: "Lower Power Costs",
    benefitDefense: "Prevent Disease",
    cockpitHeading: "What should the farmer do right now?",
    cockpitSub: "AUTONOMOUS FIELD DIRECTIVE",
    decisionLabel: "RECOMMENDED ACTION",
    diseaseTitle: "Pathogen & Fungal Infection Risk",
    diseaseSafe: "Weather conditions unfavorable for fungal sporulation.",
    harvestTitle: "Free Rain-Catchment Potential",
    harvestDesc: "Estimated free water yield from rooftop/shed runoff.",
    dosingTitle: "Virtual Volumetric Dosing",
    dosingDesc: "Calculated pump run time to achieve target soil hydration.",
    modelHeader: "AGRONOMIC HYDRAULIC DEFICIT (FAO-56)",
    whyLabel: "EXPLAINABLE AGRONOMIC REASONING",
  },
  kn: {
    brandSubtitle: "ಸ್ಮಾರ್ಟ್ ನೀರಾವರಿ ಮತ್ತು ಬೆಳೆ ರಕ್ಷಣೆ",
    navHome: "ಮುಖಪುಟ",
    navDashboard: "ಲೈವ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
    navAbout: "ಕಾರ್ಯವಿಧಾನ",
    navTeam: "ತಂಡ",
    heroKicker: "ಇಂದಿನ ಸಂವೇದನೆ. ನಾಳಿನ ಸ್ಮಾರ್ಟ್ ಕೃಷಿ ನಿರ್ಧಾರಗಳು.",
    heroTitle1: "ಸ್ಮಾರ್ಟ್ ನೀರಾವರಿ,",
    heroTitle2: "ಉತ್ತಮ ಬೆಳೆ ಇಳುವರಿ.",
    heroDesc:
      "ಸಣ್ಣ ರೈತರಿಗಾಗಿ ವಿನ್ಯಾಸಗೊಳಿಸಲಾದ ಸ್ವಾಯತ್ತ ಕೃಷಿ ತಂತ್ರಜ್ಞಾನ. ಮಣ್ಣಿನ ತೇವಾಂಶ, ವಾತಾವರಣದ ನೀರಿನ ಬೇಡಿಕೆ, ಶಿಲೀಂಧ್ರ ರೋಗ ಮುನ್ನೆಚ್ಚರಿಕೆ ಮತ್ತು ಮಳೆನೀರು ಸಂಗ್ರಹಣೆಯನ್ನು ಒಟ್ಟುಗೂಡಿಸುವ ಕ್ರಾಂತಿಕಾರಿ ವ್ಯವಸ್ಥೆ.",
    ctaCockpit: "ಲೈವ್ ನಿರ್ಧಾರ ವೀಕ್ಷಿಸಿ",
    ctaHow: "ಕಾರ್ಯವಿಧಾನ ತಿಳಿಯಿರಿ",
    benefitWater: "ನೀರು ಉಳಿತಾಯ",
    benefitYield: "ಹೆಚ್ಚಿನ ಇಳುವರಿ",
    benefitCost: "ಕಡಿಮೆ ವಿದ್ಯುತ್ ವೆಚ್ಚ",
    benefitDefense: "ರೋಗ ತಡೆಗಟ್ಟುವಿಕೆ",
    cockpitHeading: "ರೈತರು ಈಗ ಏನು ಮಾಡಬೇಕು?",
    cockpitSub: "ಸ್ವಾಯತ್ತ ಕ್ಷೇತ್ರ ನಿರ್ಧಾರ",
    decisionLabel: "ಪ್ರಸ್ತುತ ಶಿಫಾರಸು",
    diseaseTitle: "ಬೆಳೆ ರೋಗ ಮತ್ತು ಶಿಲೀಂಧ್ರ ಅಪಾಯ",
    diseaseSafe: "ಹವಾಮಾನವು ಶಿಲೀಂಧ್ರ ಹರಡುವಿಕೆಗೆ ವಿರುದ್ಧವಾಗಿದೆ.",
    harvestTitle: "ಉಚಿತ ಮಳೆ ನೀರು ಸಂಗ್ರಹಣಾ ಸಾಮರ್ಥ್ಯ",
    harvestDesc: "ಸೂರುಗಳಿಂದ ಟ್ಯಾಂಕ್‌ಗೆ ಸಿಗುವ ಅಂದಾಜು ಉಚಿತ ನೀರು.",
    dosingTitle: "ನಿಖರ ನೀರಿನ ಪ್ರಮಾಣ ಹಾಗೂ ಸಮಯ",
    dosingDesc: "ಬೇರಿಗೆ ಬೇಕಾದ ನಿಖರ ನೀರನ್ನು ಪಂಪ್ ಮಾಡಲು ಬೇಕಾಗುವ ಸಮಯ.",
    modelHeader: "ಕೃಷಿ ನೀರಿನ ಕೊರತೆ ಮಾದರಿ (FAO-56)",
    whyLabel: "ವೈಜ್ಞಾನಿಕ ನಿರ್ಧಾರದ ವಿವರಣೆ",
  },
};

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [lang, setLang] = useState("en");
  const [espIp, setEspIp] = useState("10.110.8.97");
  const [fieldData, setFieldData] = useState(null);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [apiError, setApiError] = useState(null);
  const failureCount = useRef(0);

  const t = TRANSLATIONS[lang];

  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    let stopped = false;

    const fetchFieldData = async () => {
      if (fetchFieldData.running) return;
      fetchFieldData.running = true;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      try {
        const response = await fetch(`http://${espIp}/api/status`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (stopped) return;

        failureCount.current = 0;
        setFieldData(data);
        setDeviceConnected(true);
        setApiError(null);
      } catch (error) {
        if (stopped) return;
        failureCount.current += 1;
        setApiError(error.name === "AbortError" ? "Latency Spike" : error.message);
        if (failureCount.current > 2) {
          setDeviceConnected(false);
        }
      } finally {
        clearTimeout(timeout);
        fetchFieldData.running = false;
      }
    };

    fetchFieldData.running = false;
    fetchFieldData();
    const interval = setInterval(fetchFieldData, 3000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [espIp]);

  // Derived Telemetry Values
  const soilMoisture = Math.round(fieldData?.soil?.moisture_index ?? 0);
  const soilDryness = Math.round(fieldData?.soil?.dryness ?? 0);
  const tankPercent = Math.round(fieldData?.reservoir?.level_percent ?? 0);
  const tankVol = Math.round(fieldData?.reservoir?.water_ml ?? 0);
  const cropET = Number(fieldData?.model?.crop_et_mm ?? 0).toFixed(2);
  const netDemand = Number(fieldData?.model?.net_demand_mm ?? 0).toFixed(2);
  const prescribedL = Number(fieldData?.model?.prescribed_litres ?? 0).toFixed(1);
  const runDurationSec = Math.round(fieldData?.model?.run_duration_sec ?? 0);
  const runDurationMin = (runDurationSec / 60).toFixed(1);
  const harvestL = Math.round(fieldData?.model?.harvest_potential_l ?? 0);
  const diseaseRisk = fieldData?.disease?.risk_level ?? "LOW";
  const diseaseReason = fieldData?.disease?.reason ?? t.diseaseSafe;
  const isPumpActive = fieldData?.decision?.pump_active ?? false;

  return (
    <div className={`app ${darkMode ? "dark" : ""}`}>
      {/* ================= NAVBAR ================= */}
      <header className="navbar">
        <a href="#home" className="brand">
          <div className="brand-mark">
            <Leaf size={28} strokeWidth={2.4} />
          </div>
          <div className="brand-copy">
            <strong>ARIGATO</strong>
            <span>{t.brandSubtitle}</span>
          </div>
        </a>

        <nav className="nav-links">
          <a className="active" href="#home">{t.navHome}</a>
          <a href="#dashboard">{t.navDashboard}</a>
          <a href="#about">{t.navAbout}</a>
          <a href="#team">{t.navTeam}</a>
        </nav>

        <div className="nav-actions">
          {/* Vernacular Language Switcher */}
          <button
            className="secondary-button"
            style={{ minHeight: "38px", padding: "0 14px", fontSize: "12px" }}
            onClick={() => setLang((curr) => (curr === "en" ? "kn" : "en"))}
          >
            {lang === "en" ? "ಕನ್ನಡ" : "English"}
          </button>

          {/* ESP32 IP Config Box */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "20px",
              padding: "4px 10px",
            }}
          >
            <Settings size={14} color="var(--muted)" />
            <input
              type="text"
              value={espIp}
              onChange={(e) => setEspIp(e.target.value)}
              placeholder="ESP32 IP"
              style={{
                border: "none",
                background: "transparent",
                color: "var(--ink)",
                fontSize: "12px",
                width: "95px",
                outline: "none",
              }}
            />
          </div>

          <button
            className="theme-button"
            onClick={() => setDarkMode((curr) => !curr)}
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <a href="#dashboard" className="live-button">
            <Wifi size={16} />
            <span>{deviceConnected ? "LIVE NODE" : "CONNECTING"}</span>
          </a>
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
            <span>{t.heroKicker}</span>
          </div>

          <h1 className="hero-title">
            {t.heroTitle1}
            <span>{t.heroTitle2}</span>
          </h1>

          <p className="hero-description">{t.heroDesc}</p>

          <div className="hero-actions">
            <a className="primary-button" href="#dashboard">
              <BarChart3 size={18} />
              {t.ctaCockpit}
              <ArrowRight size={18} />
            </a>

            <a className="secondary-button" href="#about">
              <span className="play-icon">
                <Play size={12} fill="currentColor" />
              </span>
              {t.ctaHow}
            </a>
          </div>

          <div className="benefits">
            <Benefit icon={<Droplets size={20} />} title={t.benefitWater} subtitle="Target Dose" />
            <Benefit icon={<TrendingUp size={20} />} title={t.benefitYield} subtitle="MAD Threshold" />
            <Benefit icon={<IndianRupee size={20} />} title={t.benefitCost} subtitle="Pumping Hours" />
            <Benefit icon={<ShieldCheck size={20} />} title={t.benefitDefense} subtitle="Fungal Alerts" />
          </div>
        </section>

        {/* ================= LIVE QUICK GLANCE CARD ================= */}
        <aside className="field-card">
          <div className="field-card-top">
            <div className="field-status-title">
              <span className={`live-dot ${deviceConnected ? "" : "danger"}`} />
              <strong>Kisan Edge Node</strong>
            </div>
            <span className="node-id">ESP32 // FREERTOS</span>
          </div>

          <SensorRow
            icon={<Sprout size={16} />}
            name="Soil Moisture"
            value={deviceConnected ? `${soilMoisture}%` : "--"}
            state={soilMoisture > 30 ? "success" : "warning"}
          />
          <SensorRow
            icon={<Waves size={16} />}
            name="Water Storage"
            value={deviceConnected ? `${tankPercent}% (${tankVol} mL)` : "--"}
            state={tankPercent > 20 ? "success" : "warning"}
          />
          <SensorRow
            icon={<CloudRain size={16} />}
            name="Rain Harvesting"
            value={deviceConnected ? `+${harvestL} L Expected` : "--"}
            state="success"
          />
          <SensorRow
            icon={<AlertTriangle size={16} />}
            name="Fungi Threat"
            value={deviceConnected ? `${diseaseRisk} RISK` : "--"}
            state={diseaseRisk === "HIGH" ? "warning" : "success"}
          />

          <div className="field-card-bottom">
            <span>
              <Wifi size={13} />
              {deviceConnected ? `IP: ${espIp}` : "Searching Edge Node..."}
            </span>
            <span className="field-time">
              {isPumpActive ? "PUMP ACTIVE" : "PUMP STANDBY"}
            </span>
          </div>
        </aside>

        <div className="impact-note">
          <span>Rooted in science.</span>
          <strong>Built for farmers.</strong>
          <i />
        </div>
      </main>

      {/* ================= VALUE STRIP ================= */}
      <section className="value-strip">
        <ValueCard
          icon={<Droplets size={24} />}
          heading="Virtual Dosing"
          text="Dispenses exact liters calculated by pump flow rating without a physical meter."
        />
        <ValueCard
          icon={<ShieldCheck size={24} />}
          heading="Fungal Disease Radar"
          text="Correlates relative humidity and incubation temperature to stop Early Blight."
        />
        <ValueCard
          icon={<CloudRain size={24} />}
          heading="Rain Harvesting Math"
          text="Predicts free rooftop rainwater replenishment before clouds even precipitate."
        />
        <ValueCard
          icon={<Wifi size={24} />}
          heading="Offline SoftAP Mesh"
          text="Auto-spawns local field hotspot (192.168.4.1) when rural SIM or home router drops."
        />
      </section>

      {/* ================= REVOLUTIONARY COCKPIT DASHBOARD ================= */}
      <section id="dashboard" className="live-dashboard">
        <div className="dashboard-heading">
          <div>
            <div className="section-label">
              <span />
              {t.cockpitSub}
            </div>
            <h2>
              {t.cockpitHeading}
            </h2>
          </div>

          <div className={`connection-pill ${deviceConnected ? "connected" : "disconnected"}`}>
            <span className="live-dot" />
            {deviceConnected ? "FIELD NODE TELEMETRY ACTIVE" : "NODE UNREACHABLE"}
          </div>
        </div>

        {!deviceConnected || !fieldData ? (
          <div className="dashboard-offline">
            <Wifi size={32} />
            <div>
              <strong>Edge Controller Offline or Connecting</strong>
              <span>
                Attempting handshake with ESP32 at http://{espIp}/api/status. Ensure your laptop or phone is on the same WiFi or connected to hotspot 'Arigato-Farmer'.
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* MAIN ACTION BANNER */}
            <div className="intelligence-decision">
              <div className="decision-symbol">
                {isPumpActive ? <Flame size={32} color="#16b760" /> : <Leaf size={32} />}
              </div>

              <div className="decision-copy">
                <span>{t.decisionLabel}</span>
                <h3>{fieldData.decision?.action ?? "ANALYSING"}</h3>
                <p>{fieldData.decision?.reason ?? "Processing agro-climatic balance..."}</p>
              </div>

              <div className="decision-meta">
                <div>
                  <span>PUMP RELAY</span>
                  <strong style={{ color: isPumpActive ? "#16b760" : "var(--muted)" }}>
                    {isPumpActive ? "ENERGIZED" : "OFF"}
                  </strong>
                </div>
                <div>
                  <span>RUN DURATION</span>
                  <strong>{runDurationMin} mins</strong>
                </div>
                <div>
                  <span>CONFIDENCE</span>
                  <strong>{fieldData.decision?.confidence_percent ?? 0}%</strong>
                </div>
              </div>
            </div>

            {/* FARMER OPERATIONAL CARDS */}
            <div className="metric-grid">
              {/* Virtual Dosing */}
              <div className="live-metric">
                <div className="live-metric-icon">
                  <Clock size={20} />
                </div>
                <span>{t.dosingTitle}</span>
                <strong>{prescribedL} Litres</strong>
                <small>Run pump for {runDurationMin} minutes ({runDurationSec}s) at rated flow</small>
              </div>

              {/* Rain Harvesting Catchment */}
              <div className="live-metric">
                <div className="live-metric-icon">
                  <CloudRain size={20} />
                </div>
                <span>{t.harvestTitle}</span>
                <strong style={{ color: "#0ea5e9" }}>+{harvestL} Litres</strong>
                <small>From 25m² shed catchment under {fieldData.weather?.rain_forecast_mm ?? 0}mm forecast rain</small>
              </div>

              {/* Fungal Disease Warning */}
              <div className="live-metric">
                <div className="live-metric-icon">
                  <AlertTriangle
                    size={20}
                    color={diseaseRisk === "HIGH" ? "#ef4444" : diseaseRisk === "MODERATE" ? "#f59e0b" : "#10b981"}
                  />
                </div>
                <span>{t.diseaseTitle}</span>
                <strong
                  style={{
                    color: diseaseRisk === "HIGH" ? "#ef4444" : diseaseRisk === "MODERATE" ? "#f59e0b" : "#10b981",
                  }}
                >
                  {diseaseRisk} RISK
                </strong>
                <small>{diseaseReason}</small>
              </div>
            </div>

            {/* SENSOR RAW TELEMETRY */}
            <div className="metric-grid">
              <LiveMetric
                icon={<Sprout size={20} />}
                label="Soil Moisture Index"
                value={`${soilMoisture}%`}
                detail={`Root Depletion: ${soilDryness}% (ADC: ${fieldData.soil?.adc_raw ?? "--"})`}
              />
              <LiveMetric
                icon={<Waves size={20} />}
                label="Storage Reservoir"
                value={`${tankPercent}%`}
                detail={`Available: ${tankVol} mL | Level: ${Number(fieldData.reservoir?.distance_cm ?? 0).toFixed(1)} cm`}
              />
              <LiveMetric
                icon={<Droplets size={20} />}
                label="Atmospheric ET0"
                value={`${cropET} mm/d`}
                detail={`Net Deficit: ${netDemand} mm after effective precipitation`}
              />
            </div>

            {/* EXPLAINABLE REASONING PIPELINE */}
            <div className="decision-pipeline">
              <div className="pipeline-header">
                <div>
                  <Gauge size={20} />
                  <span>{t.whyLabel}</span>
                </div>
                <strong>CLOSED-LOOP PIPELINE</strong>
              </div>

              <div className="pipeline-flow">
                <DecisionFactor
                  number="01"
                  title="Soil Stress"
                  value={`${soilDryness}%`}
                  detail={soilDryness >= 50 ? "Stress > MAD Threshold" : "Rootzone Satisfied"}
                  active={soilDryness >= 50}
                />
                <div className="pipeline-arrow"><ArrowRight size={16} /></div>

                <DecisionFactor
                  number="02"
                  title="Crop ET Deficit"
                  value={`${netDemand} mm`}
                  detail={netDemand > 0 ? "Positive Transpiration Deficit" : "Covered by Rain"}
                  active={Number(netDemand) > 0}
                />
                <div className="pipeline-arrow"><ArrowRight size={16} /></div>

                <DecisionFactor
                  number="03"
                  title="Storage Guard"
                  value={`${tankPercent}%`}
                  detail={tankPercent <= 15 ? "Cavitation Lockout" : "Water Available"}
                  active={tankPercent > 15}
                  danger={tankPercent <= 15}
                />
                <div className="pipeline-arrow"><ArrowRight size={16} /></div>

                <DecisionFactor
                  number="04"
                  title="Dose & Disease"
                  value={`${prescribedL} L`}
                  detail={`${diseaseRisk} Fungal Index`}
                  active={true}
                />
              </div>

              <div className="pipeline-result">
                <div>
                  <span>FINAL COMMAND</span>
                  <strong>{fieldData.decision?.action}</strong>
                </div>
                <p>{fieldData.decision?.reason}</p>
                <div className="pipeline-confidence">
                  <span>SYSTEM RELIABILITY</span>
                  <strong>{fieldData.decision?.confidence_percent ?? 0}%</strong>
                </div>
              </div>
            </div>

            {/* FIELD PROFILE BANNER */}
            <div className="field-profile">
              <Leaf size={16} />
              <span>Crop: Tomato (Solanum lycopersicum)</span>
              <i />
              <span>Phenological Stage: Vegetative</span>
              <i />
              <span>Soil: Loamy Soil (MAD 50%)</span>
              <i />
              <span>Canopy: 100 m²</span>
            </div>
          </>
        )}
      </section>

      {/* ================= TEAM ================= */}
      <section id="team" className="team-section">
        <div>
          <div className="section-label">
            <span />
            NIRMAAN 2026
          </div>
          <h2>Arigato Engineering Team</h2>
          <p>
            Democratizing precision agriculture for smallholder farmers through low-cost edge intelligence, mathematical evapotranspiration models, and fail-safe automation.
          </p>
        </div>

        <div className="team-badge">
          <Leaf size={28} />
          <div>
            <span>BUILD. INNOVATE.</span>
            <strong>IMPACT.</strong>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <div className="footer-main">
          <div className="footer-brand">
            <div className="brand footer-logo">
              <div className="brand-mark"><Leaf size={26} /></div>
              <div className="brand-copy">
                <strong>ARIGATO</strong>
                <span>Kisan Precision Platform</span>
              </div>
            </div>
            <p>Empowering smallholder farmers with scientific water intelligence, one drop at a time.</p>
          </div>

          <div className="footer-links">
            <h4>Platform</h4>
            <a href="#home">Home</a>
            <a href="#dashboard">Cockpit</a>
            <a href="#about">Innovation</a>
          </div>

          <div className="footer-links">
            <h4>Firmware Modules</h4>
            <span>FAO-56 Penman-Monteith</span>
            <span>Virtual Volumetric Dosing</span>
            <span>Pathogen Radar Engine</span>
            <span>SoftAP Resilient Mesh</span>
          </div>

          <div className="footer-statement">
            <Leaf size={22} />
            <p>Technology for a <strong>greener, resilient tomorrow.</strong></p>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2026 Arigato Platform. Built for Nirmaan 2026.</span>
          <div>
            <span>BMSITM</span>
            <i />
            <span>Autonomous Agri-Tech Track</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Subcomponents
function Benefit({ icon, title, subtitle }) {
  return (
    <div className="benefit">
      <div className="benefit-icon">{icon}</div>
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
        <span className="sensor-icon">{icon}</span>
        <span>{name}</span>
      </div>
      <strong className={`sensor-value ${state}`}>{value}</strong>
    </div>
  );
}

function ValueCard({ icon, heading, text }) {
  return (
    <article className="value-card">
      <div className="value-icon">{icon}</div>
      <div>
        <h3>{heading}</h3>
        <p>{text}</p>
      </div>
    </article>
  );
}

function LiveMetric({ icon, label, value, detail }) {
  return (
    <div className="live-metric">
      <div className="live-metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function DecisionFactor({ number, title, value, detail, active = false, danger = false }) {
  return (
    <div className={`decision-factor ${danger ? "danger" : active ? "active" : ""}`}>
      <span className="factor-number">{number}</span>
      <span className="factor-title">{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <div className="factor-indicator"><i /></div>
    </div>
  );
}

export default App;