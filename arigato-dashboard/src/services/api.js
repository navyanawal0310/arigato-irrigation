// Browser client for the /krishi-api endpoints (served by the Vite dev/preview server)

async function request(path, init) {
  const res = await fetch(`/krishi-api/${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const getIpLocation = () => request("ip-location");

export const getWeather = (lat, lon) => request(`weather?lat=${lat}&lon=${lon}`);

export const searchPlaces = (query) => request(`places?q=${encodeURIComponent(query)}`);

export const getSoilInsights = (context) =>
  request("soil-insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
  });
