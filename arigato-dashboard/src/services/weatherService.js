// Locality Weather & Geo Service for KRISHI SETU
// Integrates with Open-Meteo API for real-time locality climate data

export const LOCATION_PRESETS = [
  {
    id: "mandya",
    name: "Mandya",
    state: "Karnataka",
    lat: 12.5225,
    lon: 76.8976,
    fieldLat: 12.4985, // representative farmland near town, used for the satellite view
    fieldLon: 76.8976,
    soilType: "Red Loamy Soil",
    soilPh: "6.5 - 7.0",
    organicMatter: "Medium",
    drainage: "Good",
    zone: "Southern Dry Zone",
    defaultTemp: 27,
    defaultHumidity: 65,
    defaultRainfall: 68,
    defaultCondition: "Partly Cloudy",
  },
  {
    id: "nashik",
    name: "Nashik",
    state: "Maharashtra",
    lat: 19.9975,
    lon: 73.7898,
    fieldLat: 19.996,
    fieldLon: 73.8822,
    soilType: "Black Cotton Soil",
    soilPh: "7.2 - 7.8",
    organicMatter: "Medium",
    drainage: "Moderate",
    zone: "Western Plateau Zone",
    defaultTemp: 29,
    defaultHumidity: 58,
    defaultRainfall: 45,
    defaultCondition: "Clear",
  },
  {
    id: "shimoga",
    name: "Shivamogga",
    state: "Karnataka",
    lat: 13.9299,
    lon: 75.5681,
    fieldLat: 13.9655,
    fieldLon: 75.5209,
    soilType: "Red Laterite Soil",
    soilPh: "5.8 - 6.4",
    organicMatter: "High",
    drainage: "Good",
    zone: "Central Malnad Zone",
    defaultTemp: 25,
    defaultHumidity: 78,
    defaultRainfall: 110,
    defaultCondition: "Light Rain",
  },
  {
    id: "solan",
    name: "Solan",
    state: "Himachal Pradesh",
    lat: 30.9045,
    lon: 77.0967,
    fieldLat: 30.925,
    fieldLon: 77.125,
    soilType: "Mountain Brown Soil",
    soilPh: "6.0 - 6.8",
    organicMatter: "High",
    drainage: "Good",
    zone: "Sub-Himalayan Hill Zone",
    defaultTemp: 19,
    defaultHumidity: 52,
    defaultRainfall: 35,
    defaultCondition: "Clear",
  },
  {
    id: "pune",
    name: "Pune",
    state: "Maharashtra",
    lat: 18.5204,
    lon: 73.8567,
    fieldLat: 18.6044,
    fieldLon: 74.0563,
    soilType: "Medium Black Soil",
    soilPh: "6.8 - 7.4",
    organicMatter: "Medium",
    drainage: "Moderate",
    zone: "Western Maharashtra Plain",
    defaultTemp: 28,
    defaultHumidity: 60,
    defaultRainfall: 50,
    defaultCondition: "Partly Cloudy",
  },
  {
    id: "karnal",
    name: "Karnal",
    state: "Haryana",
    lat: 29.6857,
    lon: 76.9905,
    fieldLat: 29.7,
    fieldLon: 76.93,
    soilType: "Alluvial Loam Soil",
    soilPh: "7.0 - 7.6",
    organicMatter: "Low",
    drainage: "Good",
    zone: "Trans-Gangetic Plains",
    defaultTemp: 31,
    defaultHumidity: 50,
    defaultRainfall: 20,
    defaultCondition: "Clear",
  },
];

export function getPreset(id) {
  return LOCATION_PRESETS.find((p) => p.id === id) || LOCATION_PRESETS[0];
}

// Nearest preset to a coordinate — used to borrow soil survey data for GPS locations
export function nearestPreset(lat, lon) {
  let best = LOCATION_PRESETS[0];
  let bestDist = Infinity;
  for (const p of LOCATION_PRESETS) {
    const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

// Open-Meteo WMO weather codes → short label
export function describeWeatherCode(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly Cloudy";
  if (code === 3) return "Cloudy";
  if (code >= 45 && code <= 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Thunderstorm";
  return "Clear";
}

const COMPASS = ["North", "North East", "East", "South East", "South", "South West", "West", "North West"];
function compassFromDegrees(deg) {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function dayLabel(dateStr, index) {
  if (index === 0) return "Today";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

// Deterministic 7-day outlook used when the API is unreachable
function syntheticForecast(preset) {
  const today = new Date();
  const codes = [2, 0, 1, 2, 61, 80, 1];
  return codes.map((code, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const wet = code >= 61;
    return {
      date: iso,
      label: dayLabel(iso, i),
      code,
      tMax: preset.defaultTemp + [1, 1, 3, 2, 0, -1, 1][i],
      tMin: preset.defaultTemp - 6,
      rain: wet ? 8 + i * 2 : i % 3 === 0 ? 3.5 : 0,
    };
  });
}

export async function fetchLocalityWeather(locationPreset, coords = null) {
  const preset = coords ? nearestPreset(coords.lat, coords.lon) : getPreset(locationPreset);
  const lat = coords?.lat ?? preset.lat;
  const lon = coords?.lon ?? preset.lon;
  const locationName = coords ? `My Field (near ${preset.name})` : `${preset.name}, ${preset.state}`;

  const base = {
    locationName,
    shortName: coords ? "My Field" : preset.name,
    state: preset.state,
    lat,
    lon,
    soilType: preset.soilType,
    soilPh: preset.soilPh,
    organicMatter: preset.organicMatter,
    drainage: preset.drainage,
    zone: preset.zone,
  };

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=7&timezone=auto`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const temp = Math.round(data.current?.temperature_2m ?? preset.defaultTemp);
    const code = data.current?.weather_code ?? 0;
    const daily = data.daily ?? {};
    const forecast = (daily.time ?? []).map((date, i) => ({
      date,
      label: dayLabel(date, i),
      code: daily.weather_code?.[i] ?? 0,
      tMax: Math.round(daily.temperature_2m_max?.[i] ?? temp),
      tMin: Math.round(daily.temperature_2m_min?.[i] ?? temp - 6),
      rain: Number((daily.precipitation_sum?.[i] ?? 0).toFixed(1)),
    }));

    return {
      ...base,
      source: "OPEN_METEO_API",
      temp,
      feelsLike: Math.round(data.current?.apparent_temperature ?? temp),
      humidity: Math.round(data.current?.relative_humidity_2m ?? preset.defaultHumidity),
      rainfall: forecast[0]?.rain ?? 0,
      condition: describeWeatherCode(code),
      weatherCode: code,
      windSpeed: Math.round(data.current?.wind_speed_10m ?? 8),
      windDirection: compassFromDegrees(data.current?.wind_direction_10m ?? 225),
      tempRange: `${forecast[0]?.tMin ?? temp - 4}°C – ${forecast[0]?.tMax ?? temp + 5}°C`,
      forecast,
      fetchedAt: new Date(),
    };
  } catch (err) {
    console.warn("Weather API fallback used:", err.message);
    const forecast = syntheticForecast(preset);
    return {
      ...base,
      source: "LOCALITY_AGRO_DATABASE",
      temp: preset.defaultTemp,
      feelsLike: preset.defaultTemp + 1,
      humidity: preset.defaultHumidity,
      rainfall: forecast[0].rain,
      condition: preset.defaultCondition,
      weatherCode: 2,
      windSpeed: 10,
      windDirection: "South West",
      tempRange: `${preset.defaultTemp - 6}°C – ${preset.defaultTemp + 1}°C`,
      forecast,
      fetchedAt: new Date(),
    };
  }
}
