import { Droplets, Layers, Leaf, Loader2, RefreshCw, Sparkles, Sprout, Thermometer, Wind } from "lucide-react";
import { Chip, PageHeader, WeatherIcon } from "./ui";

function SoilStatus({ soil, onRetry, reference }) {
  if (soil.status === "loading") {
    return <Chip tone="info"><Loader2 size={11} className="spin" /> Gemini analysing soil…</Chip>;
  }
  if (soil.status === "ready") {
    return <Chip tone="good"><Sparkles size={11} /> Gemini AI · {soil.data.confidence} confidence</Chip>;
  }
  if (soil.status === "error") {
    return (
      <span className="soil-status-row">
        <Chip tone="fair">Regional estimate ({reference})</Chip>
        <button className="link-btn" onClick={onRetry}>Retry AI analysis</button>
      </span>
    );
  }
  return null;
}

export default function LocalityIntelligence({ localityData, soil = { status: "idle" }, onRetrySoil, onRefresh, isRefreshing }) {
  if (!localityData) {
    return (
      <div className="page">
        <PageHeader title="Locality Intelligence" subtitle="Fetching environmental data for your location…" />
      </div>
    );
  }

  const live = localityData.source !== "LOCALITY_AGRO_DATABASE";
  const sourceLabel = localityData.source === "ACCUWEATHER" ? "AccuWeather" : localityData.source === "OPEN_METEO_API" ? "Open-Meteo" : "Offline";
  const sourceDesc = live ? `From ${sourceLabel} & ${localityData.soilSource === "gemini" ? "Gemini AI" : "ICAR"} sources` : "Regional averages (API unreachable)";
  const weather = [
    { icon: <Thermometer size={30} className="wx wx-sun" />, value: `${localityData.temp}°C`, label: "Temperature", sub: `Feels like ${localityData.feelsLike}°C` },
    { icon: <Droplets size={30} className="wx wx-rain" />, value: `${localityData.humidity}%`, label: "Humidity", sub: "Relative humidity" },
    { icon: <WeatherIcon code={localityData.rainfall > 0 ? 61 : 3} size={30} />, value: `${localityData.rainfall} mm`, label: "Rainfall (Today)", sub: localityData.rainfall > 0 ? "Rain expected" : "No rain expected" },
    { icon: <Wind size={30} className="wx wx-rain" />, value: `${localityData.windSpeed} km/h`, label: "Wind Speed", sub: localityData.windDirection },
    { icon: <WeatherIcon code={localityData.weatherCode} size={30} />, value: localityData.condition, label: "Weather", sub: localityData.tempRange },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Locality Intelligence"
        subtitle={`Real-time environmental and soil data for ${localityData.locationName}`}
        right={
          <div className="header-actions">
            <div className={`source-badge ${live ? "" : "offline"}`}>
              <strong>{live ? "API Data" : "Offline Data"}</strong>
              <span>{sourceDesc}</span>
            </div>
            <button className="icon-btn" onClick={onRefresh} disabled={isRefreshing} aria-label="Refresh weather">
              <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
            </button>
          </div>
        }
      />

      <div className="weather-grid">
        {weather.map((w) => (
          <div key={w.label} className="card weather-tile">
            {w.icon}
            <strong>{w.value}</strong>
            <span>{w.label}</span>
            <small>{w.sub}</small>
          </div>
        ))}
      </div>

      <div className="soil-grid">
        <div className="card">
          <h3 className="card-title card-title-split">
            <span><span className="title-dot" />Soil Information</span>
            <SoilStatus soil={soil} onRetry={onRetrySoil} reference={localityData.soilReference} />
          </h3>
          <div className="soil-facts">
            <div className="soil-fact">
              <span className="soil-swatch"><Layers size={18} /></span>
              <div>
                <strong>{localityData.soilType.replace(" Soil", "")}</strong>
                <span>{localityData.soilTexture ? `Soil Type · ${localityData.soilTexture}` : "Soil Type"}</span>
              </div>
            </div>
            <div className="soil-fact">
              <div><strong>{localityData.soilPh}</strong><span>pH Range</span></div>
            </div>
            <div className="soil-fact">
              <div><strong>{localityData.organicMatter}</strong><span>Organic Matter</span></div>
            </div>
            <div className="soil-fact">
              <div><strong>{localityData.drainage}</strong><span>Drainage</span></div>
            </div>
          </div>
          {localityData.soilNote && <p className="soil-note">{localityData.soilNote}</p>}
        </div>

        <div className="card">
          <h3 className="card-title"><span className="title-dot" />Agro-Climatic Zone</h3>
          <div className="soil-fact">
            <span className="soil-swatch green"><Leaf size={18} /></span>
            <div><strong>{localityData.zone}</strong><span>Zone Type</span></div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">{localityData.forecast.length}-Day Weather Forecast</h3>
        <div className="forecast-row">
          {localityData.forecast.map((d) => (
            <div key={d.date} className={`forecast-day ${d.label === "Today" ? "today" : ""}`}>
              <span className="forecast-label">{d.label}</span>
              <WeatherIcon code={d.code} size={26} />
              <strong>{d.tMax}°C</strong>
              <span className="forecast-rain">
                <Droplets size={11} /> {d.rain} mm
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card tip-card">
        <Sprout size={20} className="text-green" />
        <p>
          {localityData.headline ? `${localityData.headline}. ` : ""}
          {localityData.forecast.slice(0, 3).some((d) => d.rain >= 5)
            ? "Rain is expected in the next 3 days — hold irrigation and check field drainage for raised beds."
            : "Dry spell ahead for the next 3 days — plan drip irrigation early morning to reduce evaporation."}
        </p>
      </div>
    </div>
  );
}
