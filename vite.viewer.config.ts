import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { appVersion } from "./vite-app-version";

export default defineConfig({
  configFile: false,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  base: "./",
  build: {
    outDir: "dist-viewer",
    emptyOutDir: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: "viewer-template.html",
    },
  },
});
