import netlify from "@netlify/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const isE2eFunctionServer = process.env.KONDATE_E2E_FUNCTION_SERVER === "1";

export default defineConfig({
  // The Netlify plugin currently exposes an untyped plugin array.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  plugins: [
    react(),
    tailwindcss(),
    // Production CSP / security headers は netlify.toml がデプロイ時に付与する。
    // Vite ローカルで middleware を有効にすると同じ CSP が注入され、
    // connect-src が 127.0.0.1:8000（local Supabase）を遮断して SPA が白画面になる。
    // E2E は Function Server を別起動するため functions も同様に切る。
    netlify({
      functions: { enabled: !isE2eFunctionServer },
      middleware: false,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    watch: {
      ignored: ["**/playwright-report/**", "**/test-results/**"],
    },
    ...(isE2eFunctionServer
      ? { proxy: { "/api": { target: "http://127.0.0.1:5174", changeOrigin: true } } }
      : {}),
  },
  cacheDir: "/tmp/vite",
});
