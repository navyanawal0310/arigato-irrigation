import React from "react";
import { Globe, Radio, Cpu } from "lucide-react";

export default function ModeIndicator({ activeMode, onModeChange, deviceConnected, espIp }) {
  return (
    <div className="mode-indicator-container">
      <div className="mode-toggle-bar">
        <button
          className={`mode-tab ${activeMode === "general" ? "active" : ""}`}
          onClick={() => onModeChange("general")}
        >
          <Globe size={18} />
          <span>Mode 1: Generalised Recommendation</span>
          <span className="mode-badge active-badge">ACTIVE</span>
        </button>

        <button
          className={`mode-tab ${activeMode === "personalized" ? "active" : ""}`}
          onClick={() => onModeChange("personalized")}
        >
          <Radio size={18} />
          <span>Mode 2: Personalised (Sensor Feed)</span>
          <span className={`mode-badge ${deviceConnected ? "live-badge" : "standby-badge"}`}>
            {deviceConnected ? "HARDWARE ONLINE" : "ARCHITECTURE READY"}
          </span>
        </button>
      </div>

      <div className="mode-banner">
        {activeMode === "general" ? (
          <div className="banner-content general-banner">
            <div className="banner-icon">
              <Globe size={22} color="#16b760" />
            </div>
            <div>
              <strong>Mode 1 — Locality & API Intelligence Active</strong>
              <p>
                Analysing real-time regional weather, agro-climatic zones, and soil database for your village/district. Works seamlessly without any hardware attached!
              </p>
            </div>
          </div>
        ) : (
          <div className="banner-content personalized-banner">
            <div className="banner-icon">
              <Cpu size={22} color="#0ea5e9" />
            </div>
            <div>
              <strong>Mode 2 — Personalised Sensor Feed Integration</strong>
              <p>
                {deviceConnected
                  ? `Hardware connected at http://${espIp}. Real-time soil moisture and micro-climate readings are refining suitability precision.`
                  : "Awaiting hardware sensor node feed. Connect ESP32 edge node to unlock hyper-local field precision. The recommendation pipeline is pre-configured and ready."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
