/**
 * Vite の writeBundle からだけ呼ぶ。許可リスト型 dist/sw.js を esbuild で書く。
 * CACHE_NAME は URL 集合と非ハッシュ資産の内容ハッシュだけで決まり、時計や乱数は使わない。
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `/` はシェル。icons / manifest はインストール基準用の固定 URL。 */
export const FIXED_PRECACHE_URLS = Object.freeze([
  "/",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/lp-boot.js",
]);

/** Vite の `-` + 8 桁以上 hex。これが無い path だけ内容を CACHE_NAME に入れる。 */
const VITE_CONTENT_HASH = /-[0-9a-f]{8,}/iu;

/**
 * @param {unknown} bytes
 */
function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {string} url
 */
export function isHashedPrecachePath(url) {
  return VITE_CONTENT_HASH.test(url);
}

/**
 * @param {string[]} urls
 */
export function assertPrecacheUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("sw_precache_empty");
  }
  if (!urls.includes("/")) {
    throw new Error("sw_shell_missing");
  }
}

/**
 * @param {string[]} urls
 */
function uniqueSorted(urls) {
  return [...new Set(urls)].sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * @param {unknown} chunk
 * @returns {string[]}
 */
function collectChunkFiles(chunk) {
  if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)) {
    return [];
  }
  const record = /** @type {{ file?: unknown, css?: unknown, assets?: unknown }} */ (chunk);
  const files = [];
  if (typeof record.file === "string") {
    files.push(record.file);
  }
  if (Array.isArray(record.css)) {
    for (const item of record.css) {
      if (typeof item === "string") files.push(item);
    }
  }
  if (Array.isArray(record.assets)) {
    for (const item of record.assets) {
      if (typeof item === "string") files.push(item);
    }
  }
  return files;
}

/**
 * file / css / assets の .js と .css だけを先頭 `/` 付き URL にする。
 * @param {string} file
 */
function toJsOrCssUrl(file) {
  const url = file.startsWith("/") ? file : `/${file}`;
  if (!url.endsWith(".js") && !url.endsWith(".css")) {
    return null;
  }
  return url;
}

/**
 * @param {Record<string, unknown>} manifest
 * @returns {string[]}
 */
export function buildPrecacheUrls(manifest) {
  const collected = [];
  for (const chunk of Object.values(manifest)) {
    for (const file of collectChunkFiles(chunk)) {
      const url = toJsOrCssUrl(file);
      if (url !== null) collected.push(url);
    }
  }
  const urls = uniqueSorted([...FIXED_PRECACHE_URLS, ...collected]);
  assertPrecacheUrls(urls);
  return urls;
}

/**
 * `/` の中身は dist/index.html のバイト。Pretty URL のため Precache URL 自体は `/`。
 * @param {string} distDir
 * @param {string} url
 * @param {Buffer} indexHtmlBytes
 */
async function readNonHashedBytes(distDir, url, indexHtmlBytes) {
  if (url === "/") {
    return indexHtmlBytes;
  }
  try {
    return await readFile(join(distDir, url.slice(1)));
  } catch {
    throw new Error(`sw_precache_file_missing:${url}`);
  }
}

/**
 * @param {string} distDir
 * @param {string[]} precacheUrls
 * @param {Buffer} indexHtmlBytes
 */
async function computeCacheName(distDir, precacheUrls, indexHtmlBytes) {
  const contentHashes = [];
  for (const url of precacheUrls) {
    if (isHashedPrecachePath(url)) continue;
    const bytes = await readNonHashedBytes(distDir, url, indexHtmlBytes);
    contentHashes.push(sha256Hex(bytes));
  }
  const digestInput = `${precacheUrls.join("\n")}${contentHashes.join("\n")}`;
  return `kondate-shell-${sha256Hex(digestInput).slice(0, 12)}`;
}

/**
 * @param {{ distDir: string }} options
 */
export async function generateServiceWorker({ distDir }) {
  const manifestPath = join(distDir, ".vite/manifest.json");
  const indexPath = join(distDir, "index.html");

  let manifestRaw;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error("sw_manifest_missing");
  }

  let indexHtmlBytes;
  try {
    indexHtmlBytes = await readFile(indexPath);
  } catch {
    throw new Error("sw_index_html_missing");
  }

  const parsed = JSON.parse(manifestRaw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sw_manifest_invalid");
  }

  const precacheUrls = buildPrecacheUrls(/** @type {Record<string, unknown>} */ (parsed));
  const cacheName = await computeCacheName(distDir, precacheUrls, indexHtmlBytes);
  const outputPath = join(distDir, "sw.js");

  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [join(root, "src/pwa/service-worker.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: outputPath,
    sourcemap: false,
    define: {
      __KONDATE_SW_CACHE_NAME__: JSON.stringify(cacheName),
      __KONDATE_SW_PRECACHE__: JSON.stringify(JSON.stringify(precacheUrls)),
      __KONDATE_SW_SHELL__: JSON.stringify("/"),
    },
  });

  return { cacheName, precacheUrls, outputPath };
}
