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
  Globe,
  Radio,
  Sparkles,
  Layers,
  MapPin,
  Maximize2,
  HelpCircle,
  Home,
  User,
  Compass,
  Cpu,
  Info,
  ChevronRight,
} from "lucide-react";

import "./App.css";

// KRISHI SETU Services & Components
import { fetchLocalityWeather, LOCATION_PRESETS } from "./services/weatherService";
import { evaluateSuitability } from "./services/recommendationEngine";
import ModeIndicator from "./components/ModeIndicator";
import FarmerProfile from "./components/FarmerProfile";
import LocalityIntelligence from "./components/LocalityIntelligence";
import CropRecommendations from "./components/CropRecommendations";
import CropComparison from "./components/CropComparison";
import AdditionalRevenue from "./components/AdditionalRevenue";
import CropDetailModal from "./components/CropDetailModal";

// Multilingual Dictionary (English + Kannada)
const TRANSLATIONS = {
  en: {
    brandName: "KRISHI SETU",
    brandSubtitle: "Smart Agronomic Platform",
    navOverview: "Home",
    navProfile: "Farmer & Land Profile",
    navLocality: "Locality Intelligence",
    navRevenue: "Revenue Opportunity",
    navRecs: "Crop Recommendations",
    navCompare: "Crop Comparison",
    navCockpit: "Live Hardware Cockpit",
    navAbout: "Architecture & How it Works",
    navTeam: "Team",
    cockpitSub: "AUTONOMOUS FIELD DIRECTIVE",
    decisionLabel: "RECOMMENDED ACTION",
    diseaseTitle: "Pathogen & Fungal Infection Risk",
    diseaseSafe: "Weather conditions unfavorable for fungal sporulation.",
    harvestTitle: "Free Rain-Catchment Potential",
    dosingTitle: "Virtual Volumetric Dosing",
    whyLabel: "EXPLAINABLE AGRONOMIC REASONING",
  },
  kn: {
    brandName: "ಕೃಷಿ ಸೇತು",
    brandSubtitle: "ಸ್ಮಾರ್ಟ್ ಕೃಷಿ ವ್ಯವಸ್ಥೆ",
    navOverview: "ಮುಖಪುಟ",
    navProfile: "ರೈತ ಮತ್ತು ಜಮೀನು ವಿವರ",
    navLocality: "ವಾತಾವರಣ ಮತ್ತು ಮಣ್ಣು",
    navRevenue: "ಹೆಚ್ಚುವರಿ ಆದಾಯ",
    navRecs: "ಬೆಳೆ ಶಿಫಾರಸುಗಳು",
    navCompare: "ಬೆಳೆ ಹೋಲಿಕೆ",
    navCockpit: "ಲೈವ್ ಹಾರ್ಡ್‌ವೇರ್",
    navAbout: "ಕಾರ್ಯವಿಧಾನ",
    navTeam: "ತಂಡ",
    cockpitSub: "ಸ್ವಾಯತ್ತ ಕ್ಷೇತ್ರ ನಿರ್ಧಾರ",
    decisionLabel: "ಪ್ರಸ್ತುತ ಶಿಫಾರಸು",
    diseaseTitle: "ಬೆಳೆ ರೋಗ ಮತ್ತು ಶಿಲೀಂಧ್ರ ಅಪಾಯ",
    diseaseSafe: "ಹವಾಮಾನವು ಶಿಲೀಂಧ್ರ ಹರಡುವಿಕೆಗೆ ವಿರುದ್ಧವಾಗಿದೆ.",
    harvestTitle: "ಉಚಿತ ಮಳೆ ನೀರು ಸಂಗ್ರಹಣಾ ಸಾಮರ್ಥ್ಯ",
    dosingTitle: "ನಿಖರ ನೀರಿನ ಪ್ರಮಾಣ ಹಾಗೂ ಸಮಯ",
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

  // Active Sidebar View Tab: "overview" | "profile" | "locality" | "revenue" | "recommendations" | "compare" | "cockpit" | "about" | "team"
  const [activeTab, setActiveTab] = useState("overview");

  // KRISHI SETU State
  const [activeMode, setActiveMode] = useState("general"); // "general" | "personalized"
  const [farmerInput, setFarmerInput] = useState({
    locationPreset: "mandya",
    customLocation: "",
    totalLandAcres: 2.0,
    highValueLandAcres: 0.5,
    primaryCrop: "Paddy / Rice",
    irrigationType: "Drip Irrigation",
  });
  const [localityData, setLocalityData] = useState(null);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const [compareList, setCompareList] = useState(["capsicum", "strawberry"]);
  const [selectedCropModal, setSelectedCropModal] = useState(null);

  const t = TRANSLATIONS[lang];

  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, [darkMode]);

  // Load Locality Weather API Data
  const loadWeather = async (presetId) => {
    setIsRefreshingWeather(true);
    const data = await fetchLocalityWeather(presetId || farmerInput.locationPreset);
    setLocalityData(data);
    setIsRefreshingWeather(false);
  };

  useEffect(() => {
    loadWeather(farmerInput.locationPreset);
  }, [farmerInput.locationPreset]);

  // ESP32 Telemetry Handshake
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

  // Evaluate Crop Suitability & Additional Revenue Impact
  const recommendationEngineOutput = evaluateSuitability({
    farmerInput,
    localityData,
    sensorData: activeMode === "personalized" && deviceConnected ? fieldData?.soil : null,
  });

  const handleToggleCompare = (cropId) => {
    setCompareList((prev) =>
      prev.includes(cropId) ? prev.filter((id) => id !== cropId) : [...prev, cropId]
    );
  };

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
    <div className={`dashboard-layout ${darkMode ? "dark" : ""}`}>
      {/* ================= LEFT SIDEBAR ================= */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Leaf size={26} strokeWidth={2.4} />
          </div>
          <div className="brand-copy">
            <strong>{t.brandName}</strong>
            <span>{t.brandSubtitle}</span>
          </div>
        </div>

        <nav className="sidebar-menu">
          <span className="menu-group-label">DASHBOARD MODULES</span>

          <button
            className={`menu-item ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <Home size={18} />
            <span>{t.navOverview}</span>
          </button>

          <button
            className={`menu-item ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            <User size={18} />
            <span>{t.navProfile}</span>
          </button>

          <button
            className={`menu-item ${activeTab === "locality" ? "active" : ""}`}
            onClick={() => setActiveTab("locality")}
          >
            <Compass size={18} />
            <span>{t.navLocality}</span>
          </button>

          <button
            className={`menu-item ${activeTab === "revenue" ? "active" : ""}`}
            onClick={() => setActiveTab("revenue")}
          >
            <TrendingUp size={18} />
            <span>{t.navRevenue}</span>
            <span className="pill-tag green">+GAIN</span>
          </button>

          <button
            className={`menu-item ${activeTab === "recommendations" ? "active" : ""}`}
            onClick={() => setActiveTab("recommendations")}
          >
            <Sparkles size={18} />
            <span>{t.navRecs}</span>
          </button>

          <button
            className={`menu-item ${activeTab === "compare" ? "active" : ""}`}
            onClick={() => setActiveTab("compare")}
          >
            <Layers size={18} />
            <span>{t.navCompare}</span>
          </button>

          <span className="menu-group-label" style={{ marginTop: "16px" }}>HARDWARE & ABOUT</span>

          <button
            className={`menu-item ${activeTab === "cockpit" ? "active" : ""}`}
            onClick={() => setActiveTab("cockpit")}
          >
            <Cpu size={18} />
            <span>{t.navCockpit}</span>
            <span className={`pill-tag ${deviceConnected ? "live" : "standby"}`}>
              {deviceConnected ? "LIVE" : "NODE"}
            </span>
          </button>

          <button
            className={`menu-item ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            <Info size={18} />
            <span>{t.navAbout}</span>
          </button>

          <button
            className={`menu-item ${activeTab === "team" ? "active" : ""}`}
            onClick={() => setActiveTab("team")}
          >
            <Users size={18} />
            <span>{t.navTeam}</span>
          </button>
        </nav>

        {/* Sidebar Controls Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-control-row">
            {/* Language Switcher */}
            <button
              className="lang-toggle-btn"
              onClick={() => setLang((curr) => (curr === "en" ? "kn" : "en"))}
            >
              {lang === "en" ? "ಕನ್ನಡ" : "English"}
            </button>

            {/* Dark Mode */}
            <button
              className="sidebar-theme-btn"
              onClick={() => setDarkMode((curr) => !curr)}
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>

          {/* ESP32 IP Input */}
          <div className="sidebar-ip-box">
            <Settings size={13} color="var(--muted)" />
            <input
              type="text"
              value={espIp}
              onChange={(e) => setEspIp(e.target.value)}
              placeholder="ESP32 IP"
            />
            <span className={`status-dot ${deviceConnected ? "online" : ""}`} />
          </div>
        </div>
      </aside>

      {/* ================= MAIN CONTENT WRAPPER ================= */}
      <div className="app-main-wrapper">
        {/* Top Header */}
        <header className="app-topbar">
          <div className="topbar-left">
            <h2>
              {activeTab === "overview" && "Home"}
              {activeTab === "profile" && "Farmer & Field Profile"}
              {activeTab === "locality" && "Locality Intelligence"}
              {activeTab === "revenue" && "Potential Additional Revenue"}
              {activeTab === "recommendations" && "Crop Recommendations"}
              {activeTab === "compare" && "Crop Comparison Matrix"}
              {activeTab === "cockpit" && "Live Hardware Cockpit (ESP32)"}
              {activeTab === "about" && "KRISHI SETU Architecture & Innovation"}
              {activeTab === "team" && "Engineering Team"}
            </h2>
            <span className="topbar-sub">KRISHI SETU Agronomic Intelligence Cockpit</span>
          </div>

          <div className="topbar-right">
            {/* Quick Mode Toggle */}
            <div className="topbar-mode-switch">
              <button
                className={`topbar-mode-btn ${activeMode === "general" ? "active" : ""}`}
                onClick={() => setActiveMode("general")}
              >
                <Globe size={14} /> Mode 1: API Data
              </button>
              <button
                className={`topbar-mode-btn ${activeMode === "personalized" ? "active" : ""}`}
                onClick={() => setActiveMode("personalized")}
              >
                <Radio size={14} /> Mode 2: Sensor Feed
              </button>
            </div>

            <div className={`node-status-pill ${deviceConnected ? "connected" : "standby"}`}>
              <Wifi size={14} />
              <span>{deviceConnected ? `NODE: ${espIp}` : "API MODE ACTIVE"}</span>
            </div>
          </div>
        </header>

        {/* Dashboard Content Canvas */}
        <main className="dashboard-canvas">
          {/* ================= TAB 1: OVERVIEW / HOME (FULL TRANS-AGRI CANVAS) ================= */}
          {(activeTab === "overview" || activeTab === "all") && (
            <div className="tab-view-container home-screen-container">
              {/* Full Screen Header Banner */}
              <div className="home-hero-header">
                <div className="welcome-text">
                  <span className="kicker-tag">KRISHI SETU AGRONOMIC PLATFORM</span>
                  <h1>SMARTER IRRIGATION, HEALTHIER FARM</h1>
                  <p>
                    A closed-loop agronomic intelligence system engineered for smallholder farmers. Fuses locality climate APIs, soil profile data, and edge sensors for high-value crop diversification & pathogen defense.
                  </p>
                </div>

                <div className="welcome-stats">
                  <div className="w-stat">
                    <span>Location</span>
                    <strong>{localityData?.locationName || "Mandya"}</strong>
                  </div>
                  <div className="w-stat">
                    <span>Top Match</span>
                    <strong style={{ color: "#16b760" }}>
                      {recommendationEngineOutput.topRecommendation?.name} ({recommendationEngineOutput.topRecommendation?.suitabilityScore}%)
                    </strong>
                  </div>
                  <div className="w-stat">
                    <span>Additional Net Gain</span>
                    <strong style={{ color: "#16b760" }}>
                      +₹{recommendationEngineOutput.economics.additionalRevenue.toLocaleString("en-IN")}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Mode Banner */}
              <ModeIndicator
                activeMode={activeMode}
                onModeChange={setActiveMode}
                deviceConnected={deviceConnected}
                espIp={espIp}
              />
            </div>
          )}

          {/* ================= TAB 2: FARMER PROFILE ================= */}
          {activeTab === "profile" && (
            <div className="tab-view-container">
              <FarmerProfile
                farmerInput={farmerInput}
                onUpdateFarmerInput={setFarmerInput}
                onRefreshData={() => loadWeather(farmerInput.locationPreset)}
                isRefreshing={isRefreshingWeather}
              />
            </div>
          )}

          {/* ================= TAB 3: LOCALITY INTELLIGENCE ================= */}
          {activeTab === "locality" && (
            <div className="tab-view-container">
              <LocalityIntelligence localityData={localityData} />
            </div>
          )}

          {/* ================= TAB 4: REVENUE OPPORTUNITY ================= */}
          {activeTab === "revenue" && (
            <div className="tab-view-container">
              <AdditionalRevenue
                economics={recommendationEngineOutput.economics}
                topCrop={recommendationEngineOutput.topRecommendation}
                farmerInput={farmerInput}
                onUpdateFarmerInput={setFarmerInput}
              />
            </div>
          )}

          {/* ================= TAB 5: CROP RECOMMENDATIONS ================= */}
          {activeTab === "recommendations" && (
            <div className="tab-view-container">
              <CropRecommendations
                recommendations={recommendationEngineOutput.recommendations}
                onSelectCrop={(crop) => setSelectedCropModal(crop)}
                onSelectForCompare={handleToggleCompare}
                compareList={compareList}
              />
            </div>
          )}

          {/* ================= TAB 6: CROP COMPARISON ================= */}
          {activeTab === "compare" && (
            <div className="tab-view-container">
              <CropComparison
                recommendations={recommendationEngineOutput.recommendations}
                compareList={compareList}
                onToggleCompare={handleToggleCompare}
                onSelectCrop={(crop) => setSelectedCropModal(crop)}
              />
            </div>
          )}

          {/* ================= TAB 7: LIVE HARDWARE COCKPIT ================= */}
          {activeTab === "cockpit" && (
            <div className="tab-view-container">
              <section className="live-dashboard" style={{ padding: "0" }}>
                <div className="dashboard-heading">
                  <div>
                    <div className="section-label"><span />{t.cockpitSub}</div>
                    <h2>Autonomous Field Directive & Telemetry</h2>
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
                      <strong>Edge Controller Standby / Unreachable</strong>
                      <span>
                        Attempting handshake with ESP32 at http://{espIp}/api/status. Mode 1 (API Locality Recommendation) continues operating smoothly. Connect your hardware node to see live telemetry.
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
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

                    <div className="metric-grid">
                      <div className="live-metric">
                        <div className="live-metric-icon"><Clock size={20} /></div>
                        <span>{t.dosingTitle}</span>
                        <strong>{prescribedL} Litres</strong>
                        <small>Run pump for {runDurationMin} minutes ({runDurationSec}s)</small>
                      </div>

                      <div className="live-metric">
                        <div className="live-metric-icon"><CloudRain size={20} /></div>
                        <span>{t.harvestTitle}</span>
                        <strong style={{ color: "#0ea5e9" }}>+{harvestL} Litres</strong>
                        <small>From 25m² shed catchment</small>
                      </div>

                      <div className="live-metric">
                        <div className="live-metric-icon">
                          <AlertTriangle
                            size={20}
                            color={diseaseRisk === "HIGH" ? "#ef4444" : diseaseRisk === "MODERATE" ? "#f59e0b" : "#10b981"}
                          />
                        </div>
                        <span>{t.diseaseTitle}</span>
                        <strong style={{ color: diseaseRisk === "HIGH" ? "#ef4444" : diseaseRisk === "MODERATE" ? "#f59e0b" : "#10b981" }}>
                          {diseaseRisk} RISK
                        </strong>
                        <small>{diseaseReason}</small>
                      </div>
                    </div>

                    <div className="metric-grid">
                      <LiveMetric
                        icon={<Sprout size={20} />}
                        label="Soil Moisture Index"
                        value={`${soilMoisture}%`}
                        detail={`Root Depletion: ${soilDryness}%`}
                      />
                      <LiveMetric
                        icon={<Waves size={20} />}
                        label="Storage Reservoir"
                        value={`${tankPercent}%`}
                        detail={`Available: ${tankVol} mL`}
                      />
                      <LiveMetric
                        icon={<Droplets size={20} />}
                        label="Atmospheric ET0"
                        value={`${cropET} mm/d`}
                        detail={`Net Deficit: ${netDemand} mm`}
                      />
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {/* ================= TAB 8: ARCHITECTURE & ABOUT ================= */}
          {activeTab === "about" && (
            <div className="tab-view-container">
              <section className="product-intro" style={{ padding: "0" }}>
                <div className="intro-copy">
                  <div className="section-label"><span />KRISHI SETU INNOVATION</div>
                  <h2>Dual-Mode Agronomic Intelligence Architecture</h2>
                  <p>
                    KRISHI SETU bridges the gap between locality-level climatic APIs and hyper-local edge IoT sensors. Farmers get immediate data-driven minor crop recommendations to unlock additional revenue from suitable land portions, backed by closed-loop irrigation & pathogen defense models.
                  </p>
                </div>

                <div className="architecture-grid">
                  <div className="architecture-mode-card mode1-card">
                    <div className="mode-card-icon mode1-icon">
                      <Globe size={26} color="#16b760" />
                    </div>
                    <div className="mode-card-body">
                      <h3>Mode 1: API Locality Intelligence</h3>
                      <p>
                        Fetches real-time temperature, humidity, and rainfall forecasts from open meteorological APIs and ICAR soil databases to recommend and rank high-value crops without requiring any physical sensors.
                      </p>
                    </div>
                  </div>

                  <div className="architecture-mode-card mode2-card">
                    <div className="mode-card-icon mode2-icon">
                      <Radio size={26} color="#0ea5e9" />
                    </div>
                    <div className="mode-card-body">
                      <h3>Mode 2: Personalised Hardware Feed</h3>
                      <p>
                        Directly ingests live ESP32 edge node telemetry (soil moisture index, root depletion, micro-climate) to dynamically calibrate irrigation prescriptions and boost recommendation precision.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ================= TAB 9: TEAM ================= */}
          {activeTab === "team" && (
            <div className="tab-view-container">
              <section className="team-section" style={{ padding: "0" }}>
                <div>
                  <div className="section-label"><span />KRISHI SETU 2026</div>
                  <h2>Krishi Setu Engineering Team</h2>
                  <p>
                    Democratizing precision agriculture for smallholder farmers through low-cost edge intelligence, mathematical evapotranspiration models, and high-value crop diversification.
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
            </div>
          )}
        </main>
      </div>

      {/* Detailed Crop Guidance Modal */}
      {selectedCropModal && (
        <CropDetailModal
          crop={selectedCropModal}
          onClose={() => setSelectedCropModal(null)}
        />
      )}
    </div>
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

export default App;