// Locality Weather & Geo Service for KRISHI SETU
// Integrates with Open-Meteo API for real-time locality climate data

export const LOCATION_PRESETS = [
  {
    id: "mandya",
    name: "Mandya",
    state: "Karnataka",
    lat: 12.5225,
    lon: 76.8976,
    soilType: "Red Loamy Soil",
    soilPh: "6.5 - 7.0",
    zone: "Southern Dry Agro-Climatic Zone",
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
    soilType: "Black Cotton Soil",
    soilPh: "7.2 - 7.8",
    zone: "Western Plateau Agro-Zone",
    defaultTemp: 29,
    defaultHumidity: 58,
    defaultRainfall: 45,
    defaultCondition: "Sunny / Clear",
  },
  {
    id: "shimoga",
    name: "Shivamogga (Shimoga)",
    state: "Karnataka",
    lat: 13.9299,
    lon: 75.5681,
    soilType: "Red Laterite Soil",
    soilPh: "5.8 - 6.4",
    zone: "Central Malnad Region",
    defaultTemp: 25,
    defaultHumidity: 78,
    defaultRainfall: 110,
    defaultCondition: "Light Rain / Humid",
  },
  {
    id: "solan",
    name: "Solan",
    state: "Himachal Pradesh",
    lat: 30.9045,
    lon: 77.0967,
    soilType: "Mountain Brown Soil",
    soilPh: "6.0 - 6.8",
    zone: "Sub-Himalayan Hill Zone",
    defaultTemp: 19,
    defaultHumidity: 52,
    defaultRainfall: 35,
    defaultCondition: "Cool & Clear",
  },
  {
    id: "pune",
    name: "Pune",
    state: "Maharashtra",
    lat: 18.5204,
    lon: 73.8567,
    soilType: "Medium Black Soil",
    soilPh: "6.8 - 7.4",
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
    soilType: "Alluvial Loam Soil",
    soilPh: "7.0 - 7.6",
    zone: "Trans-Gangetic Plains",
    defaultTemp: 31,
    defaultHumidity: 50,
    defaultRainfall: 20,
    defaultCondition: "Sunny",
  },
];

export async function fetchLocalityWeather(locationPreset, customLocationName = "") {
  const preset = LOCATION_PRESETS.find((p) => p.id === locationPreset) || LOCATION_PRESETS[0];

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${preset.lat}&longitude=${preset.lon}&current=temperature_2m,relative_humidity_2m,weather_code,rain,surface_pressure,wind_speed_10m&daily=rain_sum,temperature_2m_max,temperature_2m_min&timezone=auto`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const currentTemp = Math.round(data.current?.temperature_2m ?? preset.defaultTemp);
    const humidity = Math.round(data.current?.relative_humidity_2m ?? preset.defaultHumidity);
    const rainForecast = data.daily?.rain_sum?.[0] ?? preset.defaultRainfall;
    const weatherCode = data.current?.weather_code ?? 0;

    // Interpret Open-Meteo weather codes
    let condition = "Clear Sky";
    if (weatherCode >= 1 && weatherCode <= 3) condition = "Partly Cloudy";
    else if (weatherCode >= 45 && weatherCode <= 48) condition = "Foggy / Mist";
    else if (weatherCode >= 51 && weatherCode <= 67) condition = "Light Rain / Drizzle";
    else if (weatherCode >= 80 && weatherCode <= 99) condition = "Rain Showers / Storm";

    return {
      success: true,
      source: "OPEN_METEO_API",
      locationName: customLocationName || `${preset.name}, ${preset.state}`,
      temp: currentTemp,
      humidity: humidity,
      rainfall: Math.round(rainForecast),
      condition: condition,
      soilType: preset.soilType,
      soilPh: preset.soilPh,
      zone: preset.zone,
      windSpeed: Math.round(data.current?.wind_speed_10m ?? 8),
      tempRange: `${data.daily?.temperature_2m_min?.[0] ?? currentTemp - 4}°C - ${data.daily?.temperature_2m_max?.[0] ?? currentTemp + 5}°C`,
    };
  } catch (err) {
    console.warn("Weather API fallback used:", err.message);
    return {
      success: true,
      source: "LOCALITY_AGRO_DATABASE",
      locationName: customLocationName || `${preset.name}, ${preset.state}`,
      temp: preset.defaultTemp,
      humidity: preset.defaultHumidity,
      rainfall: preset.defaultRainfall,
      condition: preset.defaultCondition,
      soilType: preset.soilType,
      soilPh: preset.soilPh,
      zone: preset.zone,
      windSpeed: 10,
      tempRange: `${preset.defaultTemp - 3}°C - ${preset.defaultTemp + 5}°C`,
    };
  }
}
