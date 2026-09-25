import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  Cloud,
  Cpu,
  Database,
  FlaskConical,
  IndianRupee,
  Layers,
  LineChart,
  MonitorSmartphone,
  Radio,
  Sprout,
  Store,
  Workflow,
} from "lucide-react";
import { PageHeader } from "./ui";

const COLUMNS = [
  {
    title: "Data Sources",
    items: [
      { icon: Cloud, title: "Weather API", sub: "Open-Meteo", tone: "blue" },
      { icon: Layers, title: "Soil & Agro Data", sub: "ICAR / NBSS", tone: "amber" },
      { icon: Store, title: "Market Prices", sub: "APMC mandi data", tone: "rose" },
      { icon: Radio, title: "Hardware Sensors", sub: "ESP32 field node", tone: "green" },
    ],
  },
  {
    title: "Data Processing",
    items: [
      { icon: Database, title: "Data Collection", sub: "& validation", tone: "green" },
      { icon: FlaskConical, title: "Analysis Engine", sub: "Crop suitability model", tone: "green" },
      { icon: IndianRupee, title: "Revenue Estimation", sub: "Yield × mandi price − cost", tone: "green" },
    ],
  },
  {
    title: "Output",
    items: [
      { icon: MonitorSmartphone, title: "Smart Dashboard", sub: "Web platform", tone: "blue" },
      { icon: Sprout, title: "Crop Recommendations", sub: "Ranked by suitability", tone: "green" },
      { icon: BarChart3, title: "Revenue Analysis", sub: "Current vs diversified", tone: "green" },
      { icon: BookOpen, title: "Cultivation Guidance", sub: "Water, NPK, pest care", tone: "amber" },
    ],
  },
];

const FLOW = [
  { title: "Farmer enters land profile", text: "Location, plot size, main crop, irrigation availability and farming type." },
  { title: "Locality data is fetched", text: "Open-Meteo returns live temperature, humidity, wind and a 7-day forecast; soil type, pH and agro-climatic zone come from ICAR regional surveys." },
  { title: "Field sensors refine it (Mode 2)", text: "When the ESP32 node is online its soil-moisture reading adjusts each crop's score for your exact field." },
  { title: "Suitability is scored", text: "Each minor crop is scored on temperature fit, soil match, water need vs. availability and humidity." },
  { title: "Revenue is estimated", text: "Yield × average mandi price − cultivation cost, scaled to the land portion you choose." },
  { title: "Guidance is delivered", text: "Ranked crops, side-by-side comparison, revenue uplift and step-by-step cultivation advice." },
];

const STACK = [
  { group: "Frontend", items: ["React 19", "Vite", "Recharts", "Lucide icons"] },
  { group: "Data & APIs", items: ["Open-Meteo Forecast API", "ICAR soil survey data", "APMC mandi price averages", "Esri World Imagery"] },
  { group: "Hardware", items: ["ESP32 microcontroller", "Capacitive soil moisture sensor", "Ultrasonic tank level sensor", "Relay-driven pump"] },
  { group: "Firmware & Models", items: ["C++ / PlatformIO", "ArduinoJson REST API", "FAO-56 evapotranspiration", "Fungal disease risk model"] },
];

const TABS = [
  { id: "system", label: "System Architecture", icon: Workflow },
  { id: "flow", label: "Data Flow", icon: LineChart },
  { id: "stack", label: "Technology Stack", icon: Cpu },
];

export default function Architecture() {
  const [tab, setTab] = useState("system");

  return (
    <div className="page">
      <PageHeader title="Architecture & How it Works" subtitle="From data collection to crop recommendations" />

      <div className="tabs" role="tablist">
        {TABS.map(({ id, label }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "system" && (
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
      )}

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
            <p className="muted small">Works with zero hardware — recommendations from live weather and regional soil data.</p>
          </div>
        </div>
        <div className="card">
          <span className="arch-icon tone-blue"><Radio size={18} /></span>
          <div>
            <strong>Mode 2 · Personalised Field Feed</strong>
            <p className="muted small">An ESP32 node adds live soil moisture and runs closed-loop irrigation for your exact plot.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
