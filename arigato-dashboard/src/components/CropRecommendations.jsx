import { CalendarDays, Check, Clock, Droplets, IndianRupee, Loader2, Plus, Sparkles, Sprout, Store, Sun, Mountain } from "lucide-react";
import { CropImage, PageHeader } from "./ui";
import { scoreTone } from "../utils/format";

export default function CropRecommendations({ recommendations, localityData, aiInsights, soilStatus, farmerInput, onSelectCrop, onToggleCompare, compareList }) {
  const top = recommendations[0];
  const factors = [
    { icon: <Sun size={20} />, title: "Climate Match", text: `${localityData?.temp ?? "--"}°C · ${localityData?.humidity ?? "--"}% humidity` },
    { icon: <Mountain size={20} />, title: "Soil Compatibility", text: `${localityData?.soilType ?? "--"} · pH ${localityData?.soilPh ?? "--"}` },
    { icon: <Droplets size={20} />, title: "Water Requirement", text: `Irrigation: ${{ available: "available", partial: "partial", none: "not available" }[farmerInput.irrigation]}` },
    { icon: <Store size={20} />, title: "Market Demand", text: "Local APMC mandi analysis" },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Recommended Crops"
        subtitle="Best suited minor crops for your location and land conditions"
        right={
          <span className="pill-badge">
            {aiInsights ? <><Sparkles size={12} /> Locality data + Gemini AI</> : soilStatus === "loading" ? <><Loader2 size={12} className="spin" /> Gemini refining scores…</> : "Based on locality data"}
          </span>
        }
      />

      <div className="crop-grid">
        {recommendations.map((crop) => {
          const comparing = compareList.includes(crop.id);
          return (
            <article key={crop.id} className="card crop-card">
              <span className={`suit-badge suit-${scoreTone(crop.suitabilityScore)}`}>{crop.suitabilityScore}% Suitable</span>
              <CropImage crop={crop} />
              <h3>{crop.shortName}</h3>
              <ul className="crop-meta">
                <li><Clock size={14} className="text-green" /> {crop.duration}</li>
                <li><Droplets size={14} className="wx-rain" /> {crop.water} water</li>
                <li>
                  <IndianRupee size={14} className="text-green" />
                  <span className={crop.revenue === "High" ? "text-green strong" : ""}>{crop.revenue} revenue</span>
                </li>
              </ul>
              <div className="crop-actions">
                <button className="btn btn-primary btn-sm" onClick={() => onSelectCrop(crop)}>View Details</button>
                <button
                  className={`icon-btn ${comparing ? "active" : ""}`}
                  onClick={() => onToggleCompare(crop.id)}
                  aria-pressed={comparing}
                  title={comparing ? "Remove from comparison" : "Add to comparison"}
                >
                  {comparing ? <Check size={16} /> : <Plus size={16} />}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="card">
        <h3 className="card-title">Suitability Factors</h3>
        <div className="factor-row">
          {factors.map((f) => (
            <div key={f.title} className="factor">
              <span className="factor-icon">{f.icon}</span>
              <div>
                <strong>{f.title}</strong>
                <span>{f.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {aiInsights?.extraMicrocrops?.length > 0 && (
        <div className="card">
          <h3 className="card-title"><Sparkles size={16} className="text-green" /> More micro-crops for {localityData?.shortName ?? "your area"}</h3>
          <p className="card-sub">Suggested by Gemini AI for this location and season — not yet in the revenue model</p>
          <div className="idea-grid">
            {aiInsights.extraMicrocrops.map((idea) => (
              <div key={idea.name} className="idea-card">
                <strong>{idea.name}</strong>
                <p>{idea.why}</p>
                <div className="idea-meta">
                  <span><CalendarDays size={12} /> {idea.season}</span>
                  <span><Clock size={12} /> {idea.duration}</span>
                  <span><Droplets size={12} /> {idea.waterNeed} water</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {top && (
        <div className="card tip-card">
          <Sprout size={20} className="text-green" />
          <p>
            <strong>{top.shortName}</strong> is your best match — {top.reason}
          </p>
        </div>
      )}
    </div>
  );
}
