import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: forward API routes to the Express backend so the auth cookie is
// first-party (same origin) in development, matching the single-origin
// production deploy described in DESIGN.md §6.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": { target: "http://localhost:4000", changeOrigin: true },
      "/markets": { target: "http://localhost:4000", changeOrigin: true },
      "/orders": { target: "http://localhost:4000", changeOrigin: true },
      "/portfolio": { target: "http://localhost:4000", changeOrigin: true },
      "/health": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
