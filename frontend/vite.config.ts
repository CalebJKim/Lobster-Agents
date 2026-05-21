import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Backend target. Override with VITE_BACKEND=http://host:port npm run dev when
// you want to point at a local backend instead of the Spark.
const BACKEND = process.env.VITE_BACKEND || "http://10.110.23.141:8001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4454,
    host: "0.0.0.0",
    proxy: {
      "/ws": {
        target: BACKEND,
        ws: true,
        changeOrigin: true,
      },
      "/health": BACKEND,
      "/history": BACKEND,
      "/upload": BACKEND,
      "/agents": BACKEND,
      "/state": BACKEND,
      "/layout": BACKEND,
      "/sandboxes": BACKEND,
      "/approvals": BACKEND,
      "/query": BACKEND,
    },
  },
});
