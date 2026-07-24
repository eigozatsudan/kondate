import netlify from "@netlify/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const isE2eFunctionServer = process.env.KONDATE_E2E_FUNCTION_SERVER === "1";

/**
 * netlify.toml の本番 CSP は @netlify/vite-plugin の middleware 経由で
 * ローカル HTML にも注入される。connect-src が 127.0.0.1:8000（local Supabase）
 * と oauth-mock を含まないため、CSP を残すと SPA が白画面になる。
 *
 * middleware 自体を切ると /api/* Function も死ぬ（Google ログインの
 * auth continuation が 404 になる）ので、CSP ヘッダだけを落とす。
 * プラグインは headers: { enabled: false } を型上は受けるが NetlifyDev へ
 * 渡していないため、ここでは setHeader を差し替えて除去する。
 */
function stripNetlifyDevContentSecurityPolicy(): Plugin {
  return {
    name: "strip-netlify-dev-content-security-policy",
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        const originalSetHeader = response.setHeader.bind(response);
        response.setHeader = ((
          name: string | number,
          value: number | string | readonly string[],
        ) => {
          if (String(name).toLowerCase() === "content-security-policy") {
            return response;
          }
          return originalSetHeader(name, value);
        }) as typeof response.setHeader;
        next();
      });
    },
  };
}

export default defineConfig({
  // The Netlify plugin currently exposes an untyped plugin array.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  plugins: [
    react(),
    tailwindcss(),
    // Netlify より先に setHeader をラップし、後段の CSP 注入を無効化する。
    stripNetlifyDevContentSecurityPolicy(),
    // E2E は Function Server を別起動するため functions だけ切る。
    // middleware は残し、通常 dev の /api/* を Netlify Functions へ載せる。
    netlify({
      functions: { enabled: !isE2eFunctionServer },
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
