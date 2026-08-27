import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${process.env["SERVER_PORT"] ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
});
