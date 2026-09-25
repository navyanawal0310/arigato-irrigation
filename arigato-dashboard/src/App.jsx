import { useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  Compass,
  Cpu,
  Home,
  Info,
  Layers,
  Leaf,
  MapPin,
  Menu,
  Moon,
  Search,
  Sparkles,
  Sun,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";

import "./App.css";

import { fetchLocalityWeather, LOCATION_PRESETS, presetLocation } from "./services/weatherService";
import { evaluateSuitability } from "./services/recommendationEngine";
import { getIpLocation, getSoilInsights, searchPlaces } from "./services/api";
import { isMissingTable, loadProfile, saveProfile, supabase } from "./services/supabaseClient";
import AccountMenu from "./components/AccountMenu";
import HomePage from "./components/HomePage";
import FarmerProfile from "./components/FarmerProfile";
import LocalityIntelligence from "./components/LocalityIntelligence";
import AdditionalRevenue from "./components/AdditionalRevenue";
import CropRecommendations from "./components/CropRecommendations";
import CropComparison from "./components/CropComparison";
import HardwareCockpit from "./components/HardwareCockpit";
import Architecture from "./components/Architecture";
import Team from "./components/Team";
import CropDetailModal from "./components/CropDetailModal";

const TRANSLATIONS = {
  en: {
    brandName: "KRISHI SETU",
    brandSubtitle: "Smart Agronomic Platform",
    groupModules: "Dashboard Modules",
    groupAbout: "Hardware & About",
    overview: "Home",
    profile: "Farmer & Land Profile",
    locality: "Locality Intelligence",
    revenue: "Revenue Opportunity",
    recommendations: "Crop Recommendations",
    compare: "Crop Comparison",
    cockpit: "Live Hardware Cockpit",
    about: "Architecture & How it Works",
    team: "Team",
  },
  kn: {
    brandName: "ಕೃಷಿ ಸೇತು",
    brandSubtitle: "ಸ್ಮಾರ್ಟ್ ಕೃಷಿ ವ್ಯವಸ್ಥೆ",
    groupModules: "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
    groupAbout: "ಹಾರ್ಡ್‌ವೇರ್ ಮತ್ತು ಮಾಹಿತಿ",
    overview: "ಮುಖಪುಟ",
    profile: "ರೈತ ಮತ್ತು ಜಮೀನು ವಿವರ",
    locality: "ವಾತಾವರಣ ಮತ್ತು ಮಣ್ಣು",
    revenue: "ಹೆಚ್ಚುವರಿ ಆದಾಯ",
    recommendations: "ಬೆಳೆ ಶಿಫಾರಸುಗಳು",
    compare: "ಬೆಳೆ ಹೋಲಿಕೆ",
    cockpit: "ಲೈವ್ ಹಾರ್ಡ್‌ವೇರ್",
    about: "ಕಾರ್ಯವಿಧಾನ",
    team: "ತಂಡ",
  },
};

const NAV = [
  { group: "groupModules", items: [
    { id: "overview", icon: Home },
    { id: "profile", icon: User },
    { id: "locality", icon: Compass },
    { id: "revenue", icon: TrendingUp, tag: "gain" },
    { id: "recommendations", icon: Sparkles },
    { id: "compare", icon: Layers },
  ] },
  { group: "groupAbout", items: [
    { id: "cockpit", icon: Cpu, tag: "node" },
    { id: "about", icon: Info },
    { id: "team", icon: Users },
  ] },
];

function useClickOutside(ref, onOutside) {
  useEffect(() => {
    const handler = (e) => ref.current && !ref.current.contains(e.target) && onOutside(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}


const PROFILE_STORAGE_KEY = "krishi-setu-profile";
const DEFAULT_COMPARE = ["strawberry", "capsicum", "tomato", "mint"];
const DEFAULT_FARMER_INPUT = {
  location: presetLocation(LOCATION_PRESETS[0]),
  plotSize: 2,
  plotUnit: "acre",
  primaryCrop: "Paddy / Rice",
  irrigation: "available",
  farmingType: "Open Field",
  minorSharePercent: 25,
};

// Signed-out farmers keep their profile in this browser
function readLocalProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [lang, setLang] = useState("en");
  const [activeTab, setActiveTab] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState(null); // "location" | "search" | "alerts"
  const [query, setQuery] = useState("");

  const [espIp, setEspIp] = useState("10.110.8.97");
  const [fieldData, setFieldData] = useState(null);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const failureCount = useRef(0);

  const [activeMode, setActiveMode] = useState("general");
  const [showGateway, setShowGateway] = useState(true);
  const [isFirstVisit] = useState(() => !readLocalProfile());
  const [farmerInput, setFarmerInput] = useState(() => ({ ...DEFAULT_FARMER_INPUT, ...readLocalProfile()?.farmerInput }));
  const [compareList, setCompareList] = useState(() => readLocalProfile()?.compareList ?? DEFAULT_COMPARE);
  const [localityData, setLocalityData] = useState(null);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const [selectedCrop, setSelectedCrop] = useState(null);

  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState(null);
  const [placeStatus, setPlaceStatus] = useState(null); // null | "searching" | "detecting" | error message

  const [session, setSession] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const profileLoadedFor = useRef(null);
  const latestProfile = useRef({ farmerInput, compareList });
  latestProfile.current = { farmerInput, compareList };

  const t = TRANSLATIONS[lang];
  const topbarRef = useRef(null);
  useClickOutside(topbarRef, setOpenMenu);

  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, [darkMode]);

  const setLocation = (location) => setFarmerInput((f) => ({ ...f, location }));

  // First visit: locate the farmer by IP (unless they've already picked a place)
  useEffect(() => {
    if (!isFirstVisit) return;
    let cancelled = false;
    getIpLocation()
      .then((loc) => {
        if (cancelled || !Number.isFinite(loc.lat)) return;
        setFarmerInput((f) => (f.location.source === "preset" && f.location.presetId === LOCATION_PRESETS[0].id ? { ...f, location: loc } : f));
      })
      .catch((err) => console.warn("IP location unavailable:", err.message));
    return () => {
      cancelled = true;
    };
  }, [isFirstVisit]);

  const { location } = farmerInput;
  const loadWeather = async () => {
    setIsRefreshingWeather(true);
    setLocalityData(await fetchLocalityWeather(location));
    setIsRefreshingWeather(false);
  };

  useEffect(() => {
    let cancelled = false;
    fetchLocalityWeather(location).then((data) => {
      if (!cancelled) setLocalityData(data);
    });
    return () => {
      cancelled = true;
    };
    // Refetch only when the place itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon, location.name]);

  // Gemini soil + micro-crop analysis, keyed by place (slow, so results are remembered per location)
  const soilKey = localityData ? `${localityData.lat},${localityData.lon}` : null;
  const [soilByKey, setSoilByKey] = useState({});
  const [soilAttempt, setSoilAttempt] = useState(0);
  const soil = (soilKey && soilByKey[soilKey]) || { status: soilKey ? "loading" : "idle" };

  useEffect(() => {
    if (!soilKey || soilByKey[soilKey]) return;
    let cancelled = false;
    const { lat, lon, shortName, district, state, country, temp, humidity, rainfall } = localityData;
    getSoilInsights({ lat, lon, name: shortName, district, state, country, temp, humidity, rainfall })
      .then((data) => !cancelled && setSoilByKey((m) => ({ ...m, [soilKey]: { status: "ready", data } })))
      .catch((err) => !cancelled && setSoilByKey((m) => ({ ...m, [soilKey]: { status: "error", error: err.message } })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soilKey, soilAttempt]);

  const retrySoil = () => {
    setSoilByKey((m) => {
      const next = { ...m };
      delete next[soilKey];
      return next;
    });
    setSoilAttempt((a) => a + 1);
  };

  const aiInsights = soil.status === "ready" ? soil.data : null;
  const locality = localityData && {
    ...localityData,
    ...(aiInsights && {
      soilType: aiInsights.soilType,
      soilPh: aiInsights.soilPh,
      organicMatter: aiInsights.organicMatter,
      drainage: aiInsights.drainage,
      zone: aiInsights.agroZone,
      soilTexture: aiInsights.soilTexture,
      soilNote: aiInsights.soilNote,
      soilSource: "gemini",
    }),
  };

  // Supabase auth session
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  const userName = session?.user?.user_metadata?.full_name;

  // On sign-in: pull the saved farm profile, or upload this browser's one for a new account
  useEffect(() => {
    if (!userId) {
      profileLoadedFor.current = null;
      return;
    }
    let cancelled = false;
    loadProfile(userId)
      .then(async (remote) => {
        if (cancelled) return;
        if (remote) {
          setFarmerInput((f) => ({ ...f, ...remote.farmerInput }));
          if (remote.compareList?.length) setCompareList(remote.compareList);
        } else {
          const { farmerInput: current, compareList: currentCompare } = latestProfile.current;
          await saveProfile(userId, current, currentCompare, userName);
        }
        profileLoadedFor.current = userId;
        setSyncStatus("saved");
      })
      .catch((err) => !cancelled && setSyncStatus(isMissingTable(err) ? "no-table" : "error"));
    return () => {
      cancelled = true;
    };
  }, [userId, userName]);

  // Persist changes: always to this browser, and to Supabase when signed in
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ farmerInput, compareList }));
    } catch {
      // storage unavailable (private mode) — nothing to do
    }
    if (!userId || profileLoadedFor.current !== userId) return;
    const timer = setTimeout(() => {
      setSyncStatus("saving");
      saveProfile(userId, farmerInput, compareList)
        .then(() => setSyncStatus("saved"))
        .catch((err) => setSyncStatus(isMissingTable(err) ? "no-table" : "error"));
    }, 800);
    return () => clearTimeout(timer);
  }, [farmerInput, compareList, userId]);

  const detectLocation = async () => {
    setPlaceStatus("detecting");
    try {
      setLocation(await getIpLocation());
      setPlaceStatus(null);
      setOpenMenu(null);
    } catch (err) {
      setPlaceStatus(`Couldn’t detect location: ${err.message}`);
    }
  };

  const runPlaceSearch = async (e) => {
    e.preventDefault();
    if (placeQuery.trim().length < 2) return;
    setPlaceStatus("searching");
    try {
      setPlaceResults(await searchPlaces(placeQuery));
      setPlaceStatus(null);
    } catch (err) {
      setPlaceResults([]);
      setPlaceStatus(`Search failed: ${err.message}`);
    }
  };

  // ESP32 telemetry polling
  useEffect(() => {
    let stopped = false;
    let running = false;

    const poll = async () => {
      if (running || !espIp) return;
      running = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(`http://${espIp}/api/status`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (stopped) return;
        failureCount.current = 0;
        setFieldData(data);
        setDeviceConnected(true);
        setLastUpdated(new Date());
        setApiError(null);
      } catch (error) {
        if (stopped) return;
        failureCount.current += 1;
        setApiError(error.name === "AbortError" ? "timed out" : error.message);
        if (failureCount.current > 2) setDeviceConnected(false);
      } finally {
        clearTimeout(timeout);
        running = false;
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [espIp]);

  const engine = evaluateSuitability({
    farmerInput,
    localityData: locality,
    sensorData: activeMode === "personalized" && deviceConnected ? fieldData?.soil : null,
    aiInsights,
  });

  const toggleCompare = (cropId) =>
    setCompareList((prev) => (prev.includes(cropId) ? prev.filter((id) => id !== cropId) : [...prev, cropId]));

  const navigate = (id) => {
    setActiveTab(id);
    setNavOpen(false);
    setOpenMenu(null);
    window.scrollTo({ top: 0 });
  };

  // Search across pages and crops
  const searchResults = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pages = NAV.flatMap((g) => g.items)
      .filter((i) => TRANSLATIONS.en[i.id].toLowerCase().includes(q) || t[i.id].toLowerCase().includes(q))
      .map((i) => ({ key: i.id, label: t[i.id], kind: "Page", action: () => navigate(i.id) }));
    const crops = engine.recommendations
      .filter((c) => `${c.name} ${c.kannadaName} ${c.category}`.toLowerCase().includes(q))
      .map((c) => ({ key: c.id, label: `${c.icon} ${c.shortName}`, kind: `${c.suitabilityScore}% suitable`, action: () => { setSelectedCrop(c); setOpenMenu(null); } }));
    const places = LOCATION_PRESETS.filter((p) => `${p.name} ${p.state}`.toLowerCase().includes(q)).map((p) => ({
      key: p.id,
      label: `${p.name}, ${p.state}`,
      kind: "Location",
      action: () => {
        setLocation(presetLocation(p));
        setOpenMenu(null);
      },
    }));
    return [...pages, ...crops, ...places].slice(0, 8);
  })();

  const alerts = (() => {
    const list = [];
    const wetDay = localityData?.forecast?.slice(0, 3).find((d) => d.rain >= 5);
    if (wetDay) list.push({ tone: "info", text: `${wetDay.rain} mm rain expected ${wetDay.label === "Today" ? "today" : `on ${wetDay.label}`} — hold irrigation.` });
    if (deviceConnected && fieldData?.disease?.risk_level && fieldData.disease.risk_level !== "LOW")
      list.push({ tone: "poor", text: `${fieldData.disease.risk_level} fungal disease risk in your field.` });
    if (engine.topRecommendation)
      list.push({ tone: "good", text: `${engine.topRecommendation.shortName} is ${engine.topRecommendation.suitabilityScore}% suitable for your land.` });
    if (!deviceConnected) list.push({ tone: "neutral", text: "Field sensor node is offline — using locality data." });
    return list;
  })();

  const locationLabel = localityData?.locationName ?? "Locating…";

  const pages = {
    overview: (
      <HomePage
        localityData={localityData}
        engine={engine}
        activeMode={activeMode}
        onModeChange={setActiveMode}
        deviceConnected={deviceConnected}
        onNavigate={navigate}
      />
    ),
    profile: (
      <FarmerProfile
        key={JSON.stringify(farmerInput)}
        farmerInput={farmerInput}
        onSave={(draft) => {
          setFarmerInput(draft);
          navigate("locality");
        }}
      />
    ),
    locality: <LocalityIntelligence localityData={localityData} onRefresh={loadWeather} isRefreshing={isRefreshingWeather} />,
    revenue: (
      <AdditionalRevenue
        engine={engine}
        farmerInput={farmerInput}
        onUpdateFarmerInput={setFarmerInput}
        localityName={localityData?.shortName ?? "your locality"}
      />
    ),
    recommendations: (
      <CropRecommendations
        recommendations={engine.recommendations}
        localityData={localityData}
        farmerInput={farmerInput}
        onSelectCrop={setSelectedCrop}
        onToggleCompare={toggleCompare}
        compareList={compareList}
      />
    ),
    compare: (
      <CropComparison
        recommendations={engine.recommendations}
        compareList={compareList}
        onToggleCompare={toggleCompare}
        onSelectCrop={setSelectedCrop}
      />
    ),
    cockpit: (
      <HardwareCockpit
        fieldData={fieldData}
        deviceConnected={deviceConnected}
        espIp={espIp}
        onEspIpChange={setEspIp}
        apiError={apiError}
        lastUpdated={lastUpdated}
        activeMode={activeMode}
        onModeChange={setActiveMode}
      />
    ),
    about: <Architecture />,
    team: <Team />,
  };

  return (
    <>
      <div className={`app ${darkMode ? "dark" : ""} ${navOpen ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand" onClick={() => setShowGateway(true)} title="Return to Welcome Screen" role="button" tabIndex={0}>
          <span className="brand-mark"><Leaf size={22} strokeWidth={2.2} /></span>
          <div>
            <strong>{t.brandName}</strong>
            <span>{t.brandSubtitle}</span>
          </div>
          <button className="icon-btn sidebar-close" onClick={(e) => { e.stopPropagation(); setNavOpen(false); }} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.group} className="nav-group">
              <span className="nav-label">{t[section.group]}</span>
              {section.items.map(({ id, icon: Icon, tag }) => (
                <button key={id} className={`nav-item ${activeTab === id ? "active" : ""}`} onClick={() => navigate(id)}>
                  <Icon size={17} />
                  <span>{t[id]}</span>
                  {tag === "gain" && <span className="nav-tag gain">+GAIN</span>}
                  {tag === "node" && <span className={`nav-tag ${deviceConnected ? "live" : "node"}`}>{deviceConnected ? "LIVE" : "NODE"}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="btn btn-soft btn-sm" onClick={() => setLang((l) => (l === "en" ? "kn" : "en"))}>
            {lang === "en" ? "ಕನ್ನಡ" : "English"}
          </button>
          <button className="icon-btn" onClick={() => setDarkMode((d) => !d)} aria-label="Toggle dark mode">
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="main">
        <header className="topbar" ref={topbarRef}>
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>

          <div className="popover-anchor">
            <button className="location-btn" onClick={() => setOpenMenu(openMenu === "location" ? null : "location")}>
              <MapPin size={15} className="text-green" />
              <span>{locationLabel}</span>
              <ChevronDown size={14} />
            </button>
            {openMenu === "location" && (
              <div className="menu-pop">
                <form className="place-search-row" onSubmit={runPlaceSearch}>
                  <input
                    value={placeQuery}
                    onChange={(e) => setPlaceQuery(e.target.value)}
                    placeholder="Search town or village…"
                    aria-label="Search places"
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={placeStatus === "searching"}>
                    {placeStatus === "searching" ? "…" : <Search size={14} />}
                  </button>
                </form>
                <button className="detect-btn" onClick={detectLocation} disabled={placeStatus === "detecting"}>
                  <MapPin size={14} /> {placeStatus === "detecting" ? "Detecting…" : "Detect my location"}
                </button>
                {placeResults && placeResults.length > 0 && (
                  <>
                    <span className="menu-heading">Results</span>
                    {placeResults.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => {
                          setLocation({ lat: p.lat, lon: p.lon, name: p.name, state: p.state, district: p.district, country: p.country, source: "search" });
                          setPlaceResults(null);
                          setPlaceQuery("");
                          setOpenMenu(null);
                        }}
                      >
                        {p.name}, {p.state}
                      </button>
                    ))}
                  </>
                )}
                {placeResults && placeResults.length === 0 && <span className="menu-empty">No places found</span>}
                {typeof placeStatus === "string" && placeStatus.startsWith("Couldn") && <span className="menu-empty">{placeStatus}</span>}
                <span className="menu-heading">Presets</span>
                {LOCATION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={location.source === "preset" && location.presetId === p.id ? "selected" : ""}
                    onClick={() => {
                      setLocation(presetLocation(p));
                      setOpenMenu(null);
                    }}
                  >
                    {p.name}, {p.state}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="popover-anchor search">
            <Search size={15} className="search-icon" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpenMenu("search");
              }}
              onFocus={() => setOpenMenu("search")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchResults[0]) {
                  searchResults[0].action();
                  setQuery("");
                }
                if (e.key === "Escape") setOpenMenu(null);
              }}
              placeholder="Search location, crop or anything…"
              aria-label="Search"
            />
            {openMenu === "search" && query && (
              <div className="menu-pop wide">
                {searchResults.length === 0 && <span className="menu-empty">No matches for “{query}”</span>}
                {searchResults.map((r) => (
                  <button
                    key={`${r.kind}-${r.key}`}
                    onClick={() => {
                      r.action();
                      setQuery("");
                    }}
                  >
                    <span>{r.label}</span>
                    <small>{r.kind}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="topbar-right">
            <div className="popover-anchor">
              <button className="icon-btn bell" onClick={() => setOpenMenu(openMenu === "alerts" ? null : "alerts")} aria-label="Notifications">
                <Bell size={18} />
                {alerts.some((a) => a.tone === "poor" || a.tone === "info") && <span className="bell-dot" />}
              </button>
              {openMenu === "alerts" && (
                <div className="menu-pop right wide">
                  <span className="menu-heading">Notifications</span>
                  {alerts.map((a) => (
                    <div key={a.text} className={`alert-item tone-${a.tone}`}>
                      <span className="alert-dot" />
                      {a.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="popover-anchor">
              <button className="avatar" onClick={() => setOpenMenu(openMenu === "account" ? null : "account")} aria-label="Farmer profile">
                <User size={18} />
              </button>
              {openMenu === "account" && (
                <div className="menu-pop right account-dropdown">
                  <AccountMenu session={session} syncStatus={syncStatus} onGoToProfile={() => { navigate("profile"); setOpenMenu(null); }} />
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">{pages[activeTab]}</main>
      </div>

      {selectedCrop && <CropDetailModal crop={selectedCrop} onClose={() => setSelectedCrop(null)} />}
    </div>

    {showGateway && (
      <div className="gateway-screen">
        <div className="gateway-backdrop" />
        <div className="gateway-top-actions">
          <button
            className="gateway-lang-btn"
            onClick={() => setLang((l) => (l === "en" ? "kn" : "en"))}
          >
            {lang === "en" ? "ಕನ್ನಡ" : "English"}
          </button>
        </div>

        <div className="gateway-content">
          <div className="gateway-branding">
            <div className="gateway-logo-pill">
              <Leaf size={16} className="gateway-leaf-icon" />
              <span className="gateway-pill-text">{t.brandSubtitle}</span>
            </div>
            <h1 className="gateway-brand-title">KRISHI SETU</h1>
            <p className="gateway-brand-tagline">from technology to soil</p>
          </div>

          <div className="gateway-console-card">
            <AccountMenu
              session={session}
              syncStatus={syncStatus}
              onGoToProfile={() => {
                navigate("profile");
                setShowGateway(false);
              }}
              onEnterDashboard={() => setShowGateway(false)}
              isGateway={true}
            />
          </div>
        </div>
      </div>
    )}
  </>
);
}

export default App;
