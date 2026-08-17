import netlify from "@netlify/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { rewriteDevDocumentUrl } from "./scripts/vite-dev-app-html-fallback.mjs";
import {
  injectPublicLandingHtml,
  isPublicLandingIndexFilename,
} from "./src/features/landing/inject-public-landing-html";

const isE2eFunctionServer = process.env.KONDATE_E2E_FUNCTION_SERVER === "1";

/**
 * `/` 用 index.html にだけ静的 LP を埋め込む。
 * app.html は薄いシェルのままにし、transform の二重呼び出しは挿入側で冪等にする。
 */
function kondatePublicLandingHtml(): Plugin {
  return {
    name: "kondate-public-landing-html",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!isPublicLandingIndexFilename(ctx.filename)) {
          return html;
        }
        return injectPublicLandingHtml(html);
      },
    },
  };
}

/**
 * 本番ビルドの末尾で許可リスト型 sw.js を書く。
 * package.json の build 文字列は変えず、manifest はここの config だけで必須化する。
 *
 * dist は import.meta.url で辿らない。Vite 8 は本ファイルを
 * node_modules/.vite-temp/vite.config.ts.timestamp-*.mjs へ移して読むため、
 * `new URL("./dist", import.meta.url)` は実 dist ではなく temp 配下を指し、
 * Netlify では sw_precache_file_missing / sw_manifest_missing になる。
 */
function kondateServiceWorker(): Plugin {
  let outDir = resolve("dist");
  return {
    name: "kondate-service-worker",
    apply: "build",
    config() {
      return { build: { manifest: true } };
    },
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // closeBundle は Vite 8 / Rolldown では write 前に走ることがあり dist が空。
    // writeBundle はディスクへ出したあとなので manifest / public が揃う。
    writeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        const environmentName = (this as { environment?: { name?: string } }).environment?.name;
        if (environmentName !== undefined && environmentName !== "client") {
          return;
        }
        const { generateServiceWorker } = await import("./scripts/generate-service-worker.mjs");
        await generateServiceWorker({ distDir: outDir });
      },
    },
  };
}

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
        // Node の setHeader は header 名を string として受け取る。
        response.setHeader = (name: string, value: number | string | readonly string[]) => {
          if (name.toLowerCase() === "content-security-policy") {
            return response;
          }
          return originalSetHeader(name, value);
        };
        next();
      });
    },
  };
}

/**
 * 本番 `/* → /app.html` を Vite 変換経由で再現する。
 * Netlify プラグインの rewrite は app.html を生ファイルで返して
 * `@vite/client` を差し込まないので、こちらで URL だけ寄せる。
 */
function kondateDevAppHtmlFallback(): Plugin {
  return {
    name: "kondate-dev-app-html-fallback",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const rewritten = rewriteDevDocumentUrl({
          method: request.method ?? "GET",
          url: request.url ?? "/",
          accept: request.headers.accept,
        });
        if (rewritten !== null) {
          request.url = rewritten;
        }
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
    kondatePublicLandingHtml(),
    tailwindcss(),
    // Netlify より先に setHeader をラップし、後段の CSP 注入を無効化する。
    stripNetlifyDevContentSecurityPolicy(),
    // E2E は Function Server を別起動するため functions だけ切る。
    // middleware は残し、通常 dev の /api/* を Netlify Functions へ載せる。
    // redirects / staticFiles は切る。root を static にすると /src/*.tsx が
    // 空 MIME の生ソースになり、/* → app.html が /@vite/client を HTML にする。
    netlify({
      functions: { enabled: !isE2eFunctionServer },
      redirects: { enabled: false },
      staticFiles: { enabled: false },
    }),
    kondateDevAppHtmlFallback(),
    kondateServiceWorker(),
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
  // fontsource の unicode-range スライスは 4KiB 未満が多く、既定の
  // assetsInlineLimit だと data:font に潰れる。CSP は font-src 'self' のみ
  // （data: 不可）なので、フォントは常に同一オリジンのファイル URL にする。
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app.html", import.meta.url)),
      },
    },
  },
  cacheDir: "/tmp/vite",
});
