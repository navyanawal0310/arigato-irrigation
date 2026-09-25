import React from "react";
import { Thermometer, Droplets, CloudRain, Mountain, Sun, Wind, Globe, Check } from "lucide-react";

export default function LocalityIntelligence({ localityData }) {
  if (!localityData) return null;

  return (
    <div className="locality-section">
      <div className="section-title-strip">
        <div>
          <h3>Locality Intelligence</h3>
          <p>Real-time agro-climatic & environmental parameters retrieved from public API data</p>
        </div>
        <div className="api-badge-pill">
          <Globe size={14} />
          <span>LOCALITY API DERIVED DATA</span>
        </div>
      </div>

      <div className="locality-cards-grid">
        {/* Temperature Card */}
        <div className="intel-card">
          <div className="intel-icon temp-icon">
            <Thermometer size={22} />
          </div>
          <div className="intel-content">
            <span className="intel-label">Ambient Temperature</span>
            <strong className="intel-value">{localityData.temp}°C</strong>
            <small className="intel-sub">Expected Range: {localityData.tempRange}</small>
          </div>
          <span className="source-tag">Open-Meteo API</span>
        </div>

        {/* Humidity Card */}
        <div className="intel-card">
          <div className="intel-icon humidity-icon">
            <Droplets size={22} />
          </div>
          <div className="intel-content">
            <span className="intel-label">Relative Humidity</span>
            <strong className="intel-value">{localityData.humidity}%</strong>
            <small className="intel-sub">Atmospheric Moisture</small>
          </div>
          <span className="source-tag">Live Sat Feed</span>
        </div>

        {/* Rainfall Card */}
        <div className="intel-card">
          <div className="intel-icon rain-icon">
            <CloudRain size={22} />
          </div>
          <div className="intel-content">
            <span className="intel-label">Rainfall Forecast</span>
            <strong className="intel-value">{localityData.rainfall} mm</strong>
            <small className="intel-sub">Condition: {localityData.condition}</small>
          </div>
          <span className="source-tag">Weather API</span>
        </div>

        {/* Soil Profile Card */}
        <div className="intel-card">
          <div className="intel-icon soil-icon">
            <Mountain size={22} />
          </div>
          <div className="intel-content">
            <span className="intel-label">Locality Soil Type</span>
            <strong className="intel-value" style={{ fontSize: "16px" }}>{localityData.soilType}</strong>
            <small className="intel-sub">pH Range: {localityData.soilPh}</small>
          </div>
          <span className="source-tag">Agro-Soil Survey</span>
        </div>

        {/* Weather Forecast Summary */}
        <div className="intel-card">
          <div className="intel-icon weather-icon">
            <Sun size={22} />
          </div>
          <div className="intel-content">
            <span className="intel-label">Agro-Climatic Zone</span>
            <strong className="intel-value" style={{ fontSize: "14px", lineHeight: "1.3" }}>{localityData.zone}</strong>
            <small className="intel-sub">Wind: {localityData.windSpeed} km/h</small>
          </div>
          <span className="source-tag">ICAR Regional Map</span>
        </div>
      </div>
    </div>
  );
}
