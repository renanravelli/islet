import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One page per window. Tauri loads them from dist/ in release and from the dev server in dev.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "safari16",
    rollupOptions: {
      input: { island: "island.html", onboarding: "onboarding.html", settings: "settings.html" },
    },
  },
});
