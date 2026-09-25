import React from "react";
import { Layers, CheckCircle2, ArrowRight } from "lucide-react";

export default function CropComparison({ recommendations, compareList, onToggleCompare, onSelectCrop }) {
  const selectedCrops = recommendations.filter((c) => compareList.includes(c.id));

  if (selectedCrops.length === 0) {
    return (
      <div className="comparison-section empty-comparison">
        <div className="empty-box">
          <Layers size={28} color="var(--muted)" />
          <h4>Crop Comparison Matrix</h4>
          <p>Click "+ Add to Compare" on any crop card above to compare crops side-by-side.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="comparison-section">
      <div className="section-title-strip">
        <div>
          <h3>Side-by-Side Crop Comparison</h3>
          <p>Evaluating economics, water demand, and growing timeline across selected crops.</p>
        </div>
        <button
          className="secondary-button"
          style={{ fontSize: "12px", padding: "4px 12px", minHeight: "32px" }}
          onClick={() => compareList.forEach(id => onToggleCompare(id))}
        >
          Clear Comparison
        </button>
      </div>

      <div className="table-responsive">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Feature / Parameter</th>
              {selectedCrops.map((c) => (
                <th key={c.id}>
                  <div className="table-crop-header">
                    <span className="table-crop-emoji">{c.icon}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <span className="badge-tag">{c.suitabilityScore}% Match</span>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="row-title">Suitability Level</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <span className={`status-pill ${c.suitabilityScore >= 85 ? "success" : "warning"}`}>
                    {c.suitabilityLevel}
                  </span>
                </td>
              ))}
            </tr>

            <tr>
              <td className="row-title">Water Requirement</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <strong>{c.waterReqMm}</strong>
                  <div className="sub-text">{c.waterReqLevel}</div>
                </td>
              ))}
            </tr>

            <tr>
              <td className="row-title">Growing Duration</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <strong>{c.growingPeriodDays}</strong>
                  <div className="sub-text">{c.harvestWindow}</div>
                </td>
              ))}
            </tr>

            <tr>
              <td className="row-title">Soil Compatibility</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <span>{c.soilCompatibility}</span>
                </td>
              ))}
            </tr>

            <tr>
              <td className="row-title">Est. Yield per Acre</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <strong>{c.yieldPerAcreKg.toLocaleString("en-IN")} kg</strong>
                  <div className="sub-text">@ ₹{c.avgMarketPricePerKg}/kg avg मंडी rate</div>
                </td>
              ))}
            </tr>

            <tr>
              <td className="row-title">Cultivation Cost ({selectedCrops[0]?.allocatedAcres} Acre)</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <strong>₹{c.estCultivationCost.toLocaleString("en-IN")}</strong>
                </td>
              ))}
            </tr>

            <tr>
              <td className="row-title">Est. Gross Revenue ({selectedCrops[0]?.allocatedAcres} Acre)</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <strong style={{ color: "#0ea5e9" }}>₹{c.estGrossRevenue.toLocaleString("en-IN")}</strong>
                </td>
              ))}
            </tr>

            <tr className="highlight-row">
              <td className="row-title">Est. Net Return ({selectedCrops[0]?.allocatedAcres} Acre)</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <strong style={{ color: "#16b760", fontSize: "17px" }}>
                    ₹{c.estNetReturn.toLocaleString("en-IN")}
                  </strong>
                </td>
              ))}
            </tr>

            <tr>
              <td className="row-title">Actions</td>
              {selectedCrops.map((c) => (
                <td key={c.id}>
                  <button className="primary-button compact-btn" onClick={() => onSelectCrop(c)}>
                    View Deep Guidance
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
