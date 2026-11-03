import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig(({ mode }) => ({
  define: {
    // Development builds expose `isletDebug` for calibration; release builds must not.
    __ISLET_DEBUG__: JSON.stringify(mode === "development"),
  },
  plugins: [
    crx({
      manifest: manifest as ManifestV3Export,
      // Both content scripts are standalone IIFEs: no loader, no web_accessible_resources.
      contentScripts: {
        standaloneFiles: ["src/content/meet/index.ts", "src/content/meet/keep-rendering.ts"],
      },
    }),
  ],
  build: { target: "chrome105", sourcemap: false },
}));
