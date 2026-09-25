import React from "react";
import { Sparkles, ArrowRight, Droplets, Clock, TrendingUp, HelpCircle, Layers, CheckCircle } from "lucide-react";

export default function CropRecommendations({ recommendations, onSelectCrop, onSelectForCompare, compareList = [] }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="recommendations-section">
      <div className="section-title-strip">
        <div>
          <h3>Minor & High-Value Crop Recommendations</h3>
          <p>
            Ranked crop opportunities for allocated plot based on locality climate, soil profile, and water availability.
          </p>
        </div>
        <div className="disclaimer-chip">
          <HelpCircle size={14} />
          <span>Estimates based on regional APMC mandis & agro-data</span>
        </div>
      </div>

      <div className="crops-grid">
        {recommendations.map((crop, idx) => {
          const isComparing = compareList.includes(crop.id);
          const isTopMatch = idx === 0;

          return (
            <div key={crop.id} className={`crop-card ${isTopMatch ? "top-recommendation" : ""}`}>
              {isTopMatch && (
                <div className="top-match-badge">
                  <Sparkles size={13} />
                  <span>BEST DIVERSIFICATION MATCH</span>
                </div>
              )}

              <div className="crop-card-header">
                <div className="crop-identity">
                  <span className="crop-emoji">{crop.icon}</span>
                  <div>
                    <h4>{crop.name}</h4>
                    <span className="crop-subname">{crop.scientificName} • {crop.kannadaName}</span>
                  </div>
                </div>

                <div className="score-badge-wrap">
                  <span className={`score-badge ${crop.suitabilityScore >= 85 ? "high" : "moderate"}`}>
                    {crop.suitabilityScore}% Match
                  </span>
                  <span className="suitability-label">{crop.suitabilityLevel}</span>
                </div>
              </div>

              {/* Agronomic Reason */}
              <div className="agronomic-reason-box">
                <strong>Why Recommended:</strong>
                <p>"{crop.reason}"</p>
              </div>

              {/* Key Parameters */}
              <div className="crop-stats-grid">
                <div className="crop-stat">
                  <Droplets size={14} color="#0ea5e9" />
                  <span>Water Requirement</span>
                  <strong>{crop.waterReqMm}</strong>
                </div>

                <div className="crop-stat">
                  <Clock size={14} color="#f59e0b" />
                  <span>Growing Duration</span>
                  <strong>{crop.growingPeriodDays}</strong>
                </div>

                <div className="crop-stat">
                  <TrendingUp size={14} color="#16b760" />
                  <span>Est. Net Revenue ({crop.allocatedAcres} Acre)</span>
                  <strong style={{ color: "#16b760" }}>₹{crop.estNetReturn.toLocaleString("en-IN")}</strong>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="crop-card-actions">
                <button
                  className={`compare-toggle-btn ${isComparing ? "active" : ""}`}
                  onClick={() => onSelectForCompare(crop.id)}
                >
                  <Layers size={14} />
                  {isComparing ? "Selected for Compare" : "+ Add to Compare"}
                </button>

                <button className="view-details-btn" onClick={() => onSelectCrop(crop)}>
                  <span>View Full Guidance</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
