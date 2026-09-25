import { useEffect, useState } from "react";
import { X, Sparkles, Droplets, Sun, Mountain, ShieldCheck, Sprout, IndianRupee, CheckCircle2 } from "lucide-react";
import { formatArea, inr } from "../utils/format";

export default function CropDetailModal({ crop, onClose }) {
  const [activeTab, setActiveTab] = useState("why");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!crop) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-emoji">{crop.icon}</span>
            <div>
              <h2>{crop.name}</h2>
              <span className="modal-subtitle">{crop.scientificName} • {crop.kannadaName}</span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="modal-tabs">
          <button
            className={`tab-btn ${activeTab === "why" ? "active" : ""}`}
            onClick={() => setActiveTab("why")}
          >
            <Sparkles size={15} />
            Why Suitable
          </button>

          <button
            className={`tab-btn ${activeTab === "cultivation" ? "active" : ""}`}
            onClick={() => setActiveTab("cultivation")}
          >
            <Sprout size={15} />
            Cultivation & Water
          </button>

          <button
            className={`tab-btn ${activeTab === "protection" ? "active" : ""}`}
            onClick={() => setActiveTab("protection")}
          >
            <ShieldCheck size={15} />
            Pest & Disease
          </button>

          <button
            className={`tab-btn ${activeTab === "economics" ? "active" : ""}`}
            onClick={() => setActiveTab("economics")}
          >
            <IndianRupee size={15} />
            Financial Breakdown
          </button>
        </div>

        {/* Modal Tab Content */}
        <div className="modal-body">
          {activeTab === "why" && (
            <div className="tab-pane">
              <div className="suitability-summary-banner">
                <div className="score-ring">
                  <span>{crop.suitabilityScore}%</span>
                  <small>Match Score</small>
                </div>
                <div>
                  <h4>{crop.suitabilityLevel} for your Locality</h4>
                  <p>"{crop.reason}"</p>
                </div>
              </div>

              <h3>Agronomic Suitability Factors</h3>
              <ul className="guidance-list">
                {crop.whySuitable.map((reason, i) => (
                  <li key={i}>
                    <CheckCircle2 size={16} className="text-green" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>

              <div className="spec-grid">
                <div className="spec-item">
                  <Sun size={18} className="wx-sun" />
                  <div>
                    <strong>Climate Fit:</strong>
                    <p>{crop.climateCompatibility}</p>
                  </div>
                </div>

                <div className="spec-item">
                  <Mountain size={18} className="text-green" />
                  <div>
                    <strong>Soil Requirement:</strong>
                    <p>{crop.soilCompatibility}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "cultivation" && (
            <div className="tab-pane">
              <h3>Water & Irrigation Schedule</h3>
              <div className="info-box blue-box">
                <Droplets size={20} className="wx-rain" />
                <div>
                  <strong>Recommended Irrigation:</strong>
                  <p>{crop.waterGuidance}</p>
                  <small>Total Water Req: {crop.waterReqMm} ({crop.waterReqLevel})</small>
                </div>
              </div>

              <h3 className="spaced">Fertilizer & NPK Dosage</h3>
              <div className="info-box green-box">
                <Sprout size={20} className="text-green" />
                <div>
                  <strong>NPK & Organic Amendments:</strong>
                  <p>{crop.fertilizerSchedule}</p>
                </div>
              </div>

              <h3 className="spaced">Growing Timeline & Stage</h3>
              <p>Total Duration: <strong>{crop.growingPeriodDays}</strong> | Harvest Window: <strong>{crop.harvestWindow}</strong></p>
            </div>
          )}

          {activeTab === "protection" && (
            <div className="tab-pane">
              <h3>Pest & Fungal Disease Prevention</h3>
              <div className="info-box yellow-box">
                <ShieldCheck size={20} className="wx-sun" />
                <div>
                  <strong>Common Risks & Defense:</strong>
                  <p>{crop.pestDefense}</p>
                </div>
              </div>

              <h3 className="spaced">Harvesting & Post-Harvest Handling</h3>
              <p>{crop.harvestingInfo}</p>
            </div>
          )}

          {activeTab === "economics" && (
            <div className="tab-pane">
              <h3>Financial Estimates ({formatArea(crop.allocatedAcres)} allocation)</h3>
              <div className="economics-table-wrap">
                <table className="modal-econ-table">
                  <tbody>
                    <tr>
                      <td>Allocated Land Size:</td>
                      <td><strong>{formatArea(crop.allocatedAcres)}</strong></td>
                    </tr>
                    <tr>
                      <td>Expected Yield per Acre:</td>
                      <td><strong>{crop.yieldPerAcreKg.toLocaleString("en-IN")} kg</strong></td>
                    </tr>
                    <tr>
                      <td>Estimated Market Rate:</td>
                      <td><strong>₹{crop.avgMarketPricePerKg} / kg</strong></td>
                    </tr>
                    <tr>
                      <td>Estimated Cultivation Cost:</td>
                      <td><strong className="text-red">{inr(crop.estCultivationCost)}</strong></td>
                    </tr>
                    <tr>
                      <td>Estimated Gross Revenue:</td>
                      <td><strong>{inr(crop.estGrossRevenue)}</strong></td>
                    </tr>
                    <tr className="final-net-row">
                      <td>Estimated Net Return:</td>
                      <td><strong className="text-green">{inr(crop.estNetReturn)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="disclaimer-text">
                * Note: Financial figures are estimates for planning purposes. Actual income depends on local market mandi rates, yield, and pest management.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Close Guidance
          </button>
        </div>
      </div>
    </div>
  );
}
