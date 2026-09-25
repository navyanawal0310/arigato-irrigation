// External data services for KRISHI SETU. Runs on the server only — API keys never reach the browser.
import { cached } from "./cache.js";
import { MINOR_HIGH_VALUE_CROPS, SOIL_TYPES } from "../src/services/recommendationEngine.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export class ApiError extends Error {
  constructor(status, message, upstreamStatus = null) {
    super(message);
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

async function getJson(url, init = {}, timeoutMs = 10000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  // Upstream failures (bad key, quota, outage) surface as 502 so the client falls back
  if (!res.ok) throw new ApiError(502, `${new URL(url).host} ${res.status}: ${text.slice(0, 200)}`, res.status);
  return JSON.parse(text);
}

const round = (n, d) => Number(Number(n).toFixed(d));

/* ---------------------------------------------------------------- IP location */

export async function ipLocate(env, clientIp) {
  if (!env.IPGEOLOCATION_API_KEY) throw new ApiError(500, "IPGEOLOCATION_API_KEY is not set");
  const ipParam = clientIp ? `&ip=${encodeURIComponent(clientIp)}` : "";
  return cached(`ip:${clientIp || "self"}`, 6 * HOUR, async () => {
    const data = await getJson(`https://api.ipgeolocation.io/v2/ipgeo?apiKey=${env.IPGEOLOCATION_API_KEY}${ipParam}`);
    const loc = data.location ?? {};
    return {
      lat: Number(loc.latitude),
      lon: Number(loc.longitude),
      name: loc.city || loc.district || loc.state_prov,
      district: loc.district || "",
      state: loc.state_prov || "",
      country: loc.country_name || "",
      source: "ip",
    };
  });
}

/* ---------------------------------------------------------------- AccuWeather */

// AccuWeather icon numbers → WMO-style codes the UI's WeatherIcon understands
function iconToWmo(icon) {
  if ([1, 2, 30, 33, 34].includes(icon)) return 0;
  if ([3, 4, 35, 36].includes(icon)) return 2;
  if ([5, 6, 7, 8, 31, 32, 37, 38].includes(icon)) return 3;
  if (icon === 11) return 45;
  if ([12, 13, 14, 39, 40].includes(icon)) return 80;
  if ([15, 16, 17, 41, 42].includes(icon)) return 95;
  if (icon === 18) return 63;
  if ([24, 25, 26, 29].includes(icon)) return 67;
  if ([19, 20, 21, 22, 23, 43, 44].includes(icon)) return 71;
  return 0;
}

const COMPASS_WORDS = { N: "North", E: "East", S: "South", W: "West" };
const compassWords = (abbr = "") =>
  abbr.length === 3
    ? `${COMPASS_WORDS[abbr[0]]}–${abbr.slice(1).split("").map((c) => COMPASS_WORDS[c]).join(" ")}`
    : abbr.split("").map((c) => COMPASS_WORDS[c]).join(" ");

function accuHeaders(env) {
  if (!env.ACCUWEATHER_API_KEY) throw new ApiError(500, "ACCUWEATHER_API_KEY is not set");
  return { Authorization: `Bearer ${env.ACCUWEATHER_API_KEY}`, "Accept-Encoding": "gzip" };
}

function placeFromAccu(p) {
  return {
    key: p.Key,
    name: p.LocalizedName,
    district: p.SupplementalAdminAreas?.[0]?.LocalizedName || "",
    state: p.AdministrativeArea?.LocalizedName || "",
    country: p.Country?.LocalizedName || "",
    lat: p.GeoPosition?.Latitude,
    lon: p.GeoPosition?.Longitude,
  };
}

async function accuPlaceFor(env, lat, lon) {
  return cached(`aw-geo:${round(lat, 3)},${round(lon, 3)}`, 180 * DAY, async () => {
    const p = await getJson(
      `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?q=${lat},${lon}`,
      { headers: accuHeaders(env) }
    );
    return placeFromAccu(p);
  });
}

export async function weather(env, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ApiError(400, "lat and lon are required");
  const place = await accuPlaceFor(env, lat, lon);
  const headers = accuHeaders(env);

  const [current, daily] = await Promise.all([
    cached(`aw-cur:${place.key}`, 45 * MINUTE, () =>
      getJson(`https://dataservice.accuweather.com/currentconditions/v1/${place.key}?details=true`, { headers })
    ),
    cached(`aw-5day:${place.key}`, 3 * HOUR, () =>
      getJson(`https://dataservice.accuweather.com/forecasts/v1/daily/5day/${place.key}?details=true&metric=true`, { headers })
    ),
  ]);

  const c = current[0] ?? {};
  const forecast = (daily.DailyForecasts ?? []).map((d, i) => {
    const date = d.Date.slice(0, 10);
    return {
      date,
      label: i === 0 ? "Today" : new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
      code: iconToWmo(d.Day?.Icon),
      phrase: d.Day?.IconPhrase,
      tMax: Math.round(d.Temperature?.Maximum?.Value),
      tMin: Math.round(d.Temperature?.Minimum?.Value),
      rain: round((d.Day?.TotalLiquid?.Value ?? 0) + (d.Night?.TotalLiquid?.Value ?? 0), 1),
      rainChance: Math.max(d.Day?.PrecipitationProbability ?? 0, d.Night?.PrecipitationProbability ?? 0),
    };
  });

  const temp = Math.round(c.Temperature?.Metric?.Value);
  return {
    source: "ACCUWEATHER",
    place,
    temp,
    feelsLike: Math.round(c.RealFeelTemperature?.Metric?.Value ?? temp),
    humidity: c.RelativeHumidity,
    condition: c.WeatherText,
    weatherCode: iconToWmo(c.WeatherIcon),
    windSpeed: Math.round(c.Wind?.Speed?.Metric?.Value ?? 0),
    windDirection: compassWords(c.Wind?.Direction?.English),
    uvIndex: c.UVIndex,
    rainPast24h: c.PrecipitationSummary?.Past24Hours?.Metric?.Value ?? 0,
    rainfall: forecast[0]?.rain ?? 0,
    tempRange: forecast[0] ? `${forecast[0].tMin}°C – ${forecast[0].tMax}°C` : "",
    headline: daily.Headline?.Text ?? "",
    forecast,
    observedAt: c.LocalObservationDateTime,
  };
}

export async function searchPlaces(env, query) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  return cached(`aw-search:${q.toLowerCase()}`, 30 * DAY, async () => {
    const results = await getJson(
      `https://dataservice.accuweather.com/locations/v1/cities/IN/search?q=${encodeURIComponent(q)}`,
      { headers: accuHeaders(env) }
    );
    return results.slice(0, 8).map(placeFromAccu);
  });
}

/* ---------------------------------------------------------------- Gemini soil & micro-crop analysis */

const CROP_IDS = MINOR_HIGH_VALUE_CROPS.map((c) => c.id);

const SOIL_SCHEMA = {
  type: "object",
  properties: {
    soilType: { type: "string", enum: SOIL_TYPES, description: "Closest class for the dominant agricultural soil" },
    soilTexture: { type: "string", description: "Texture in 2–4 words, e.g. 'sandy clay loam'" },
    phMin: { type: "number" },
    phMax: { type: "number" },
    organicMatter: { type: "string", enum: ["Low", "Medium", "High"] },
    drainage: { type: "string", enum: ["Poor", "Moderate", "Good"] },
    agroZone: { type: "string", description: "Official agro-climatic zone name, short" },
    soilNote: { type: "string", description: "One practical sentence about managing this soil" },
    cropScores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: CROP_IDS },
          score: { type: "integer", minimum: 0, maximum: 100 },
          reason: { type: "string", description: "Location-specific reason, max 25 words" },
        },
        required: ["id", "score", "reason"],
      },
    },
    extraMicrocrops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          why: { type: "string", description: "Max 20 words" },
          season: { type: "string", description: "Best sowing window, e.g. 'Oct – Nov (Rabi)'" },
          duration: { type: "string", description: "e.g. '60 – 75 days'" },
          waterNeed: { type: "string", enum: ["Low", "Medium", "High"] },
        },
        required: ["name", "why", "season", "duration", "waterNeed"],
      },
    },
    confidence: { type: "string", enum: ["Low", "Medium", "High"] },
  },
  required: [
    "soilType", "soilTexture", "phMin", "phMax", "organicMatter", "drainage",
    "agroZone", "soilNote", "cropScores", "extraMicrocrops", "confidence",
  ],
};

function soilPrompt(ctx) {
  const month = new Date().toLocaleDateString("en-IN", { month: "long" });
  const crops = MINOR_HIGH_VALUE_CROPS.map((c) => `- ${c.id}: ${c.name}`).join("\n");
  return `You are an agronomist advising Indian smallholder farmers.

Farm location: ${[ctx.name, ctx.district, ctx.state, ctx.country].filter(Boolean).join(", ")} (lat ${ctx.lat}, lon ${ctx.lon}).
Current conditions: ${ctx.temp ?? "?"}°C, ${ctx.humidity ?? "?"}% humidity, ${ctx.rainfall ?? "?"} mm rain today. Current month: ${month}.

1. Using regional soil survey knowledge (NBSS&LUP / ICAR / state agriculture department), describe the dominant AGRICULTURAL soil around this location (not urban fill). Pick the closest soilType from the allowed list, give a typical pH range, organic matter and drainage.
2. Score each candidate micro-crop 0–100 for growing on a small portion of a farm here, starting this season. Consider soil, pH, climate, rainfall pattern and local market demand. Be discriminating — scores should differ.
${crops}
3. Suggest 4 other high-value micro-crops (not in the list above) well suited to this exact area and season.

Keep every reason specific to this place. Return JSON only.`;
}

function extractOutputText(interaction) {
  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;
    const text = (step.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("");
    if (text) return text;
  }
  return interaction.output_text ?? interaction.outputText ?? "";
}

async function callGemini(env, prompt, schema) {
  if (!env.GEMINI_API_KEY) throw new ApiError(500, "GEMINI_API_KEY is not set");
  const models = [...new Set([env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"])];
  // Two passes over the models: demand spikes on Gemini usually clear within seconds
  const attempts = [...models, ...models];
  let lastError;
  for (const [i, model] of attempts.entries()) {
    if (i === models.length) await new Promise((r) => setTimeout(r, 3000));
    try {
      const interaction = await getJson(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            model,
            input: prompt,
            store: false,
            response_format: { type: "text", mime_type: "application/json", schema },
          }),
        },
        90000
      );
      return { model, data: JSON.parse(extractOutputText(interaction)) };
    } catch (err) {
      lastError = err;
      // Busy / rate-limited → try the fallback model; anything else is a real error
      if (![429, 500, 503].includes(err.upstreamStatus)) throw err;
    }
  }
  throw lastError;
}

export async function soilInsights(env, ctx) {
  const lat = Number(ctx.lat);
  const lon = Number(ctx.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ApiError(400, "lat and lon are required");
  const month = new Date().getMonth();
  // ~1 km grid, refreshed each month (season changes the crop advice)
  return cached(`gemini-soil:${round(lat, 2)},${round(lon, 2)}:${month}`, 30 * DAY, async () => {
    const { model, data } = await callGemini(env, soilPrompt({ ...ctx, lat: round(lat, 4), lon: round(lon, 4) }), SOIL_SCHEMA);
    const lo = Math.min(data.phMin, data.phMax);
    const hi = Math.max(data.phMin, data.phMax);
    return {
      ...data,
      soilType: SOIL_TYPES.includes(data.soilType) ? data.soilType : SOIL_TYPES[0],
      soilPh: `${lo.toFixed(1)} - ${hi.toFixed(1)}`,
      cropScores: (data.cropScores ?? []).filter((s) => CROP_IDS.includes(s.id)),
      model,
      generatedAt: new Date().toISOString(),
    };
  });
}
