import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { sourceFingerprint, writeBuildMarker } from "./scripts/build-state.ts";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
let buildSourceHash = "";
export default defineConfig({
  root: projectRoot,
  plugins: [
    react(),
    {
      name: "zuhause-build-state",
      apply: "build",
      /** Merkt den Quellenstand vor dem Build; nachträgliche Änderungen dürfen keinen gültigen Marker erhalten. */
      buildStart() {
        buildSourceHash = sourceFingerprint(projectRoot);
      },
      /** Bestätigt erst nach der erfolgreichen Dateiausgabe die Quellen und alle erzeugten Dateien. */
      writeBundle() {
        writeBuildMarker(projectRoot, buildSourceHash);
      },
    },
  ],
  build: { outDir: "dist" },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3210" },
  },
});
