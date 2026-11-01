import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// The gateway serves the built files, so in development the page proxies the API to a gateway on the same machine.
const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8787";
const API = ["/sessions", "/nodes", "/catalogue", "/devices", "/v1"];

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "dist", sourcemap: false },
  server: {
    proxy: Object.fromEntries(API.map((path) => {
      return [path, { target: GATEWAY, changeOrigin: true }];
    })),
  },
});
