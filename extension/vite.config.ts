import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [
    crx({
      manifest: manifest as ManifestV3Export,
      contentScripts: { standaloneFiles: ["src/content/meet/index.ts"] },
    }),
  ],
  build: { target: "chrome105", sourcemap: false },
});
