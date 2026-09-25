import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CheckCircle2, Info } from "lucide-react";
import { PageHeader } from "./ui";
import { formatArea, inr } from "../utils/format";

const compact = (n) => {
  if (n >= 100000) return `₹${+(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${+(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
};

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{d.full}</strong>
      <span>{inr(d.value)} per season</span>
      {d.gain !== undefined && <span className="text-green">+{inr(d.gain)} vs current</span>}
    </div>
  );
}

export default function AdditionalRevenue({ engine, farmerInput, onUpdateFarmerInput, localityName }) {
  const { economics, recommendations } = engine;
  const topThree = recommendations.slice(0, 3);
  const best = topThree[0];
  const potential = Math.max(best.diversifiedIncome, economics.conventionalOnlyIncome);
  const gain = potential - economics.conventionalOnlyIncome;
  const boost = Math.round((gain / (economics.conventionalOnlyIncome || 1)) * 100);
  const level = boost >= 100 ? "High" : boost >= 30 ? "Medium" : "Low";

  const data = [
    { name: "Current Crop", full: `${economics.primaryCrop} only`, value: economics.conventionalOnlyIncome, baseline: true },
    ...[...topThree]
      .sort((a, b) => a.diversifiedIncome - b.diversifiedIncome)
      .map((c) => ({ name: c.shortName, full: `${economics.primaryCrop} + ${c.shortName}`, value: c.diversifiedIncome, gain: c.additionalRevenue })),
  ];

  const insights = [
    `Minor crops can provide ${Math.max(1, Math.round(best.netReturnPerAcre / (economics.conventionalOnlyIncome / economics.totalLand)))}× higher returns per acre than ${economics.primaryCrop}.`,
    `${best.shortName} is ${best.suitabilityScore}% suitable for ${localityName} climate and soil.`,
    `Only ${farmerInput.minorSharePercent}% of your land (${formatArea(economics.hvLand)}) is needed — the rest stays with your main crop.`,
    `Complements your existing ${economics.primaryCrop} season without replacing it.`,
  ];

  return (
    <div className="page">
      <PageHeader title="Revenue Opportunity" subtitle="Compare potential returns between conventional and recommended crops" />

      <div className="kpi-grid">
        <div className="card kpi">
          <strong>{inr(economics.conventionalOnlyIncome)}</strong>
          <span>Current Crop Income</span>
          <small>(per season)</small>
        </div>
        <div className="card kpi">
          <strong>{inr(potential)}</strong>
          <span>Potential Income</span>
          <small>(with {best.shortName.toLowerCase()})</small>
        </div>
        <div className="card kpi">
          <strong>{inr(gain)}</strong>
          <span>Additional Opportunity</span>
          <small className="text-green">(+{boost}%)</small>
        </div>
        <div className="card kpi kpi-level">
          <BarChart3 size={30} />
          <div>
            <strong>{level}</strong>
            <span>Revenue Potential</span>
          </div>
        </div>
      </div>

      <div className="revenue-grid">
        <div className="card">
          <h3 className="card-title">Estimated Revenue Comparison</h3>
          <p className="card-sub">(for your {formatArea(economics.totalLand)} plot, per season)</p>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data} margin={{ top: 28, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} width={52} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--hover)" }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.baseline ? "var(--bar-baseline)" : "var(--bar-green)"} />
                  ))}
                  <LabelList dataKey="value" position="top" formatter={inr} style={{ fill: "var(--text)", fontSize: 12, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card insights-card">
          <h3 className="card-title">Key Insights</h3>
          <ul className="insight-list">
            {insights.map((text) => (
              <li key={text}>
                <CheckCircle2 size={18} />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card allocation-card">
        <div className="allocation-head">
          <label htmlFor="share">Land portion for minor crop</label>
          <strong>
            {farmerInput.minorSharePercent}% · {formatArea(economics.hvLand)}
          </strong>
        </div>
        <input
          id="share"
          type="range"
          min="5"
          max="60"
          step="5"
          value={farmerInput.minorSharePercent}
          onChange={(e) => onUpdateFarmerInput({ ...farmerInput, minorSharePercent: Number(e.target.value) })}
          style={{ "--fill": `${((farmerInput.minorSharePercent - 5) / 55) * 100}%` }}
        />
        <p className="muted small">
          <Info size={13} /> Estimates use average APMC mandi rates and historical yields. Actual income varies with market prices, weather and farm management.
        </p>
      </div>
    </div>
  );
}
