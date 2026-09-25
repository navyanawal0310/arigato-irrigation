// File-backed TTL cache so dev-server restarts don't burn API quota (AccuWeather free tier is small)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_FILE = fileURLToPath(new URL("../node_modules/.cache/krishi-setu/api-cache.json", import.meta.url));

let store = {};
try {
  store = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  store = {};
}

let flushTimer = null;
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(store));
    } catch (err) {
      console.warn("[krishi-api] cache write failed:", err.message);
    }
  }, 500);
}

const inflight = new Map();

// Returns the cached value, or runs `producer` once (concurrent callers share the promise)
export async function cached(key, ttlMs, producer) {
  const hit = store[key];
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const value = await producer();
      store[key] = { at: Date.now(), value };
      scheduleFlush();
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}
