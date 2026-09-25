import { Droplets, Layers, Leaf, RefreshCw, Sprout, Thermometer, Wind } from "lucide-react";
import { PageHeader, WeatherIcon } from "./ui";

export default function LocalityIntelligence({ localityData, onRefresh, isRefreshing }) {
  if (!localityData) {
    return (
      <div className="page">
        <PageHeader title="Locality Intelligence" subtitle="Fetching environmental data for your location…" />
      </div>
    );
  }

  const live = localityData.source === "OPEN_METEO_API";
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
              <span>{live ? "From Open-Meteo & ICAR sources" : "Regional averages (API unreachable)"}</span>
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
          <h3 className="card-title"><span className="title-dot" />Soil Information</h3>
          <div className="soil-facts">
            <div className="soil-fact">
              <span className="soil-swatch"><Layers size={18} /></span>
              <div><strong>{localityData.soilType.replace(" Soil", "")}</strong><span>Soil Type</span></div>
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
        <h3 className="card-title">7-Day Weather Forecast</h3>
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
          {localityData.forecast.slice(0, 3).some((d) => d.rain >= 5)
            ? "Rain is expected in the next 3 days — hold irrigation and check field drainage for raised beds."
            : "Dry spell ahead for the next 3 days — plan drip irrigation early morning to reduce evaporation."}
        </p>
      </div>
    </div>
  );
}
