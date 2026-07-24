import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "shared/**/*.test.ts",
      "netlify/functions/**/*.test.ts",
      "tools/**/*.test.mjs",
    ],
    exclude: [
      "tools/e2e-function-server.test.mjs",
      // 実 DB と dedicated login が必要なため通常スイートから除外
      "netlify/functions/_shared/maintenance-db.integration.test.ts",
    ],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
