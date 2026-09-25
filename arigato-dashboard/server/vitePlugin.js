// Serves /krishi-api/* from the Vite dev and preview servers so API keys stay server-side
import { ApiError, ipLocate, searchPlaces, soilInsights, weather } from "./services.js";

const PREFIX = "/krishi-api/";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw new ApiError(413, "Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}

// Only forward a caller IP when it is public — local requests let IPGeolocation use this machine's IP
function publicClientIp(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().replace(/^::ffff:/, "");
  const isPrivate = !ip || ip === "::1" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc|fd|fe80)/i.test(ip);
  return isPrivate ? null : ip;
}

function createHandler(env) {
  return async (req, res, next) => {
    if (!req.url?.startsWith(PREFIX)) return next();
    const url = new URL(req.url, "http://localhost");
    const route = url.pathname.slice(PREFIX.length);
    const q = url.searchParams;

    try {
      if (route === "ip-location" && req.method === "GET") {
        return send(res, 200, await ipLocate(env, publicClientIp(req)));
      }
      if (route === "weather" && req.method === "GET") {
        return send(res, 200, await weather(env, Number(q.get("lat")), Number(q.get("lon"))));
      }
      if (route === "places" && req.method === "GET") {
        return send(res, 200, await searchPlaces(env, q.get("q")));
      }
      if (route === "soil-insights" && req.method === "POST") {
        return send(res, 200, await soilInsights(env, await readBody(req)));
      }
      return send(res, 404, { error: `Unknown endpoint ${route}` });
    } catch (err) {
      console.warn(`[krishi-api] ${route} failed:`, err.message);
      return send(res, err instanceof ApiError ? err.status : 500, { error: err.message });
    }
  };
}

export default function krishiApi(env) {
  const handler = createHandler(env);
  return {
    name: "krishi-setu-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
