import netlify from "@netlify/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const isE2eFunctionServer = process.env.KONDATE_E2E_FUNCTION_SERVER === "1";

export default defineConfig({
  // The Netlify plugin currently exposes an untyped plugin array.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  plugins: [react(), tailwindcss(), netlify({ functions: { enabled: !isE2eFunctionServer } })],
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
