import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString()) },
  plugins: [react()],
  // Reads the monorepo root .env.development / .env.production (shared with
  // the web app and Docker Compose) instead of this project's own directory,
  // so VITE_API_BASE_URL only needs to be set in one place per environment.
  envDir: "../..",
  // Without this, postcss-load-config searches parent directories and picks
  // up the root Next.js app's postcss.config.mjs (Tailwind), which isn't
  // installed in this project and isn't wanted here.
  css: { postcss: {} },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
