import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4454,
    host: "0.0.0.0",
    proxy: {
      "/ws": {
        target: "http://127.0.0.1:8001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
