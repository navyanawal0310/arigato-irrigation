import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import krishiApi from "./server/vitePlugin.js";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // All vars (including server-only API keys) for the /krishi-api middleware.
  // Only VITE_* / NEXT_PUBLIC_* vars are ever exposed to browser code.
  const env = loadEnv(mode, root, "");

  return {
    root,
    envDir: root,
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    plugins: [react(), krishiApi(env)],

    server: {
      host: "127.0.0.1",

      proxy: {
        "/api": {
          target: "http://10.233.65.251",
          changeOrigin: true,
          secure: false,

          configure: (proxy) => {
            proxy.on("error", (err) => {
              console.log("ESP32 PROXY ERROR:", err.message);
            });

            proxy.on("proxyReq", (proxyReq, req) => {
              console.log("ESP32 REQUEST:", req.method, req.url);
            });

            proxy.on("proxyRes", (proxyRes, req) => {
              console.log(
                "ESP32 RESPONSE:",
                proxyRes.statusCode,
                req.url
              );
            });
          },
        },
      },
    },
  };
});
