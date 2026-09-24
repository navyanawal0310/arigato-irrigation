import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

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
});