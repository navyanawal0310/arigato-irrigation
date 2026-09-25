import { useState } from "react";
import { Layers, Plus, X } from "lucide-react";
import { PageHeader } from "./ui";
import { formatArea, inr } from "../utils/format";

const ROWS = [
  { label: "Suitability Score", render: (c) => `${c.suitabilityScore}%`, strong: true },
  { label: "Growing Duration", render: (c) => c.duration },
  { label: "Water Requirement", render: (c) => c.water },
  { label: "Estimated Yield", sub: "plot", render: (c) => `${c.estYieldKg.toLocaleString("en-IN")} kg` },
  { label: "Market Price (avg)", sub: "per kg", render: (c) => inr(c.avgMarketPricePerKg) },
  { label: "Estimated Revenue", render: (c) => inr(c.estGrossRevenue) },
  { label: "Estimated Cost", render: (c) => inr(c.estCultivationCost) },
];

export default function CropComparison({ recommendations, compareList, onToggleCompare, onSelectCrop }) {
  const [adding, setAdding] = useState(false);
  const selected = compareList.map((id) => recommendations.find((c) => c.id === id)).filter(Boolean);
  const available = recommendations.filter((c) => !compareList.includes(c.id));
  const bestNet = Math.max(...selected.map((c) => c.estNetReturn));
  const plot = selected[0] ? formatArea(selected[0].allocatedAcres) : "";

  return (
    <div className="page">
      <PageHeader title="Crop Comparison" subtitle="Compare different crops to make the best decision" />

      <div className="card compare-card">
        <div className="compare-toolbar">
          <div>
            <span className="field-label">Select crops to compare</span>
            <div className="chip-row">
              {selected.map((c) => (
                <span key={c.id} className="crop-chip">
                  {c.shortName}
                  <button onClick={() => onToggleCompare(c.id)} aria-label={`Remove ${c.shortName}`}>
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="add-crop">
            <button className="btn btn-primary btn-sm" onClick={() => setAdding((a) => !a)} disabled={!available.length}>
              <Plus size={15} /> Add Crop
            </button>
            {adding && available.length > 0 && (
              <div className="menu-pop">
                {available.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onToggleCompare(c.id);
                      setAdding(false);
                    }}
                  >
                    <span>{c.icon}</span> {c.shortName}
                    <small>{c.suitabilityScore}%</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {selected.length === 0 ? (
          <div className="empty-state">
            <Layers size={28} />
            <strong>No crops selected</strong>
            <span>Use “Add Crop” to compare crops side by side.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  {selected.map((c) => (
                    <th key={c.id} style={{ "--accent": c.accent }}>
                      <button className="th-crop" onClick={() => onSelectCrop(c)} title="View details">
                        {c.shortName}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <td>
                      {row.label}
                      {row.sub && <small>({row.sub === "plot" ? `per ${plot}` : row.sub})</small>}
                    </td>
                    {selected.map((c) => (
                      <td key={c.id} className={row.strong ? "strong" : ""}>{row.render(c)}</td>
                    ))}
                  </tr>
                ))}
                <tr className="net-row">
                  <td>Net Return</td>
                  {selected.map((c) => (
                    <td key={c.id}>
                      <span className={c.estNetReturn === bestNet && selected.length > 1 ? "best" : ""}>{inr(c.estNetReturn)}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
