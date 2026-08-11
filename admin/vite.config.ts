import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(rootDir, "client"),
  build: {
    outDir: resolve(rootDir, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5194,
    proxy: {
      "/api": "http://127.0.0.1:5193",
    },
  },
});
