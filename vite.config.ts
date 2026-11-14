import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { appVersion } from "./vite-app-version";

const apiPort = process.env.PORT ?? "4178";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  build: {
    outDir: "dist",
  },
});
