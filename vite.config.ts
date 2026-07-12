import netlify from "@netlify/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // The Netlify plugin currently exposes an untyped plugin array.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  plugins: [react(), tailwindcss(), netlify()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  cacheDir: "/tmp/vite",
});
