import { useState } from "react";
import {
  BarChart3,
  BrainCircuit,
  Cloud,
  Cpu,
  Database,
  Droplets,
  FlaskConical,
  Gauge,
  History,
  MapPin,
  Merge,
  MonitorSmartphone,
  Radio,
  ShieldCheck,
  Sparkles,
  Sprout,
  UserRoundCheck,
} from "lucide-react";
import { PageHeader } from "./ui";

const COLUMNS = [
  {
    title: "Data Sources",
    items: [
      { icon: Radio, title: "ESP32 Field Node", sub: "Soil moisture · root dryness · reservoir level", tone: "green" },
      { icon: Cloud, title: "AccuWeather", sub: "Current, hourly & 5-day forecast", tone: "blue" },
      { icon: MapPin, title: "IPGeolocation", sub: "Auto-detects the farm’s location", tone: "rose" },
      { icon: Sparkles, title: "Gemini AI", sub: "Soil type, pH & micro-crop scoring", tone: "amber" },
    ],
  },
  {
    title: "Processing",
    items: [
      { icon: Merge, title: "Telemetry Collector", sub: "Merges sensor + API weather every 30 s", tone: "green" },
      { icon: BrainCircuit, title: "ML Forecast (V2)", sub: "ExtraTrees · soil moisture 3 h ahead", tone: "blue" },
      { icon: Droplets, title: "Irrigation Intelligence", sub: "Explainable pump advice", tone: "blue" },
      { icon: FlaskConical, title: "Suitability Engine", sub: "Rules 60% + Gemini 40% + live soil", tone: "amber" },
    ],
  },
  {
    title: "Output",
    items: [
      { icon: MonitorSmartphone, title: "Smart Dashboard", sub: "React web platform", tone: "blue" },
      { icon: Gauge, title: "Live Hardware Cockpit", sub: "Sensors, ML forecast, pump", tone: "green" },
      { icon: Sprout, title: "Crop Recommendations", sub: "Ranked for your land", tone: "green" },
      { icon: BarChart3, title: "Revenue Analysis", sub: "Current vs diversified", tone: "amber" },
    ],
  },
];

const STORES = [
  {
    id: "mongo",
    icon: Database,
    tone: "green",
    name: "MongoDB Atlas",
    role: "Hardware data",
    summary: "Every field reading, combined with the API weather at that moment.",
    writer: "Written by the FastAPI telemetry collector · read by the Cockpit and ML model",
    collections: [
      {
        name: "telemetry",
        text: "ESP32 soil moisture, root-zone dryness, reservoir level and pump state — plus an AccuWeather snapshot. API values only fill what the sensors can’t measure (e.g. rain in the next 3 h) and are tagged with their source.",
      },
      { name: "predictions", text: "3-hour soil-moisture forecasts, later validated against the real reading." },
    ],
  },
  {
    id: "supabase",
    icon: UserRoundCheck,
    tone: "blue",
    name: "Supabase",
    role: "User data",
    summary: "Who the farmer is, their farm, and what they did in the app.",
    writer: "Written by the dashboard · row-level security: each farmer sees only their own rows",
    collections: [
      { name: "auth.users", text: "Farmer accounts with email sign-in." },
      { name: "farmer_profiles", text: "Location, plot size, main crop, irrigation, land share and compared crops — synced across devices." },
      { name: "user_activity", text: "Sign-ins, profile saves, location changes, crops viewed, comparisons and AI soil analyses." },
    ],
  },
];

const FLOW = [
  { title: "Farmer signs in", text: "Supabase authenticates the farmer, loads their saved farm profile and starts logging their activity." },
  { title: "Location is found", text: "IPGeolocation detects the village automatically; the farmer can also search towns (AccuWeather) or use GPS." },
  { title: "Live weather is fetched", text: "AccuWeather returns current conditions and a 5-day forecast through the server API layer, so keys never reach the browser. Open-Meteo is the fallback." },
  { title: "Gemini analyses soil and crops", text: "Gemini estimates the area’s soil type, pH and drainage and scores each micro-crop for this place and season. Results are cached per location." },
  { title: "Hardware readings are combined and stored", text: "Every 30 s the collector reads the ESP32, merges the AccuWeather snapshot for the field, and writes one record to MongoDB — sensor values are never overwritten." },
  { title: "ML forecasts soil moisture", text: "The V2 model uses MongoDB history plus the merged weather to predict soil moisture 3 hours ahead; each forecast is later checked against the real reading." },
  { title: "Advice reaches the farmer", text: "Crop scores (rules + Gemini + live soil moisture), revenue estimates and irrigation advice appear in the dashboard; the farmer’s actions are logged to Supabase." },
];

const STACK = [
  { group: "Frontend", items: ["React 19", "Vite 8", "Recharts", "Lucide icons", "Supabase JS"] },
  { group: "Backend & ML", items: ["Python FastAPI", "PyMongo", "scikit-learn ExtraTrees (V2)", "httpx", "Vite server API layer (Node)"] },
  { group: "Databases", items: ["MongoDB Atlas — hardware telemetry", "Supabase Postgres — users & activity", "Row-level security"] },
  { group: "APIs", items: ["AccuWeather", "IPGeolocation", "Gemini (Interactions API)", "Open-Meteo (fallback)", "Esri World Imagery"] },
  { group: "Hardware", items: ["ESP32 microcontroller", "Capacitive soil moisture sensor", "Ultrasonic tank level sensor", "Rain sensor", "Relay-driven pump"] },
  { group: "Firmware", items: ["C++ / PlatformIO", "ArduinoJson REST API", "FAO-56 evapotranspiration", "Fungal disease risk model"] },
];

const TABS = [
  { id: "system", label: "System Architecture" },
  { id: "storage", label: "Data Storage" },
  { id: "flow", label: "Data Flow" },
  { id: "stack", label: "Technology Stack" },
];

function StoreCards() {
  return (
    <div className="store-grid">
      {STORES.map(({ id, icon: Icon, tone, name, role, summary, writer, collections }) => (
        <div key={id} className={`card store-card store-${id}`}>
          <div className="store-head">
            <span className={`arch-icon tone-${tone}`}><Icon size={18} /></span>
            <div>
              <strong>{name}</strong>
              <span>{role}</span>
            </div>
          </div>
          <p className="store-summary">{summary}</p>
          <ul className="store-collections">
            {collections.map((c) => (
              <li key={c.name}>
                <code>{c.name}</code>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <p className="store-writer">
            {id === "mongo" ? <History size={13} /> : <ShieldCheck size={13} />} {writer}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function Architecture() {
  const [tab, setTab] = useState("system");

  return (
    <div className="page">
      <PageHeader title="Architecture & How it Works" subtitle="Hardware and software data, combined — from the field to your crop plan" />

      <div className="tabs" role="tablist">
        {TABS.map(({ id, label }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "system" && (
        <>
          <div className="arch-flow">
            {COLUMNS.map((col, i) => (
              <div key={col.title} className="arch-col-wrap">
                <div className="card arch-col">
                  <h3>{col.title}</h3>
                  {col.items.map(({ icon: Icon, title, sub, tone }) => (
                    <div key={title} className="arch-item">
                      <span className={`arch-icon tone-${tone}`}><Icon size={18} /></span>
                      <div>
                        <strong>{title}</strong>
                        <span>{sub}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {i < COLUMNS.length - 1 && <span className="arch-arrow" aria-hidden="true" />}
              </div>
            ))}
          </div>
          <h2 className="section-title">Where the data lives</h2>
          <StoreCards />
        </>
      )}

      {tab === "storage" && <StoreCards />}

      {tab === "flow" && (
        <div className="card">
          <ol className="flow-list">
            {FLOW.map((step, i) => (
              <li key={step.title}>
                <span className="flow-num">{i + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === "stack" && (
        <div className="stack-grid">
          {STACK.map((s) => (
            <div key={s.group} className="card">
              <h3 className="card-title">{s.group}</h3>
              <div className="chip-row">
                {s.items.map((item) => (
                  <span key={item} className="stack-chip">{item}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mode-explainer">
        <div className="card">
          <span className="arch-icon tone-green"><Cloud size={18} /></span>
          <div>
            <strong>Mode 1 · Locality Intelligence</strong>
            <p className="muted small">Works with zero hardware — AccuWeather weather and Gemini soil analysis drive the crop plan.</p>
          </div>
        </div>
        <div className="card">
          <span className="arch-icon tone-blue"><Cpu size={18} /></span>
          <div>
            <strong>Mode 2 · Hardware + Software</strong>
            <p className="muted small">The ESP32’s readings, merged with API weather in MongoDB, add live soil moisture, ML forecasts and closed-loop irrigation.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
