import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// 通常スイートから除外した実 DB 統合テスト専用。jsdom ではなく node。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["netlify/functions/_shared/maintenance-db.integration.test.ts"],
    exclude: [],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
