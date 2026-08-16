import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPrecacheUrls,
  buildPrecacheUrls,
  generateServiceWorker,
} from "./generate-service-worker.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Vite 実形に寄せた fixture。imports / dynamicImports / フォント画像は収集対象外。 */
const fixtureManifest = {
  "src/main.tsx": {
    file: "assets/index-aaaaaaaa.js",
    css: ["assets/index-bbbbbbbb.css"],
    assets: ["assets/hero-cccccccc.webp", "fonts/x-dddddddd.woff2", "fonts/y-eeeeeeee.woff", "api"],
    imports: ["_shared-ffffffff.js"],
    dynamicImports: ["assets/page-11111111.js"],
  },
  "index.html": {
    file: "assets/index-aaaaaaaa.js",
    src: "index.html",
    isEntry: true,
  },
  "_shared-ffffffff.js": {
    file: "assets/shared-ffffffff.js",
  },
};

const expectedPrecacheUrls = [
  "/",
  "/assets/index-aaaaaaaa.js",
  "/assets/index-bbbbbbbb.css",
  "/assets/shared-ffffffff.js",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512-maskable.png",
  "/icons/icon-512.png",
  "/lp-boot.js",
  "/manifest.webmanifest",
];

/**
 * @param {string} distDir
 * @param {{ indexHtml?: string, hashedJs?: string, icon192?: Buffer, lpBootJs?: string, skipLpBoot?: boolean }} [overrides]
 */
async function writeFixtureDist(distDir, overrides = {}) {
  await mkdir(join(distDir, ".vite"), { recursive: true });
  await mkdir(join(distDir, "assets"), { recursive: true });
  await mkdir(join(distDir, "icons"), { recursive: true });
  await mkdir(join(distDir, "fonts"), { recursive: true });
  await writeFile(join(distDir, ".vite/manifest.json"), JSON.stringify(fixtureManifest));
  await writeFile(
    join(distDir, "index.html"),
    overrides.indexHtml ?? "<!doctype html><title>k</title>",
  );
  await writeFile(join(distDir, "manifest.webmanifest"), '{"name":"こんだて日和"}');
  await writeFile(join(distDir, "icons/apple-touch-icon.png"), Buffer.from("icon-180"));
  await writeFile(
    join(distDir, "icons/icon-192.png"),
    overrides.icon192 ?? Buffer.from("icon-192"),
  );
  await writeFile(join(distDir, "icons/icon-512.png"), Buffer.from("icon-512"));
  await writeFile(join(distDir, "icons/icon-512-maskable.png"), Buffer.from("icon-mask"));
  await writeFile(
    join(distDir, "assets/index-aaaaaaaa.js"),
    overrides.hashedJs ?? "console.log(1)",
  );
  await writeFile(join(distDir, "assets/index-bbbbbbbb.css"), "body{margin:0}");
  await writeFile(join(distDir, "assets/shared-ffffffff.js"), "export{}");
  await writeFile(join(distDir, "assets/hero-cccccccc.webp"), Buffer.from("webp"));
  await writeFile(join(distDir, "fonts/x-dddddddd.woff2"), Buffer.from("woff2"));
  await writeFile(join(distDir, "fonts/y-eeeeeeee.woff"), Buffer.from("woff"));
  await writeFile(join(distDir, "assets/page-11111111.js"), "export const page=1");
  if (!overrides.skipLpBoot) {
    await writeFile(
      join(distDir, "lp-boot.js"),
      overrides.lpBootJs ?? 'document.documentElement.classList.add("kondate-js");',
    );
  }
}

test("buildPrecacheUrls keeps js/css plus fixed shell assets and drops fonts images html and api", () => {
  const urls = buildPrecacheUrls(fixtureManifest);
  assert.deepEqual(urls, expectedPrecacheUrls);
  assert.ok(!urls.includes("/index.html"));
  assert.ok(!urls.includes("/app.html"));
  assert.ok(!urls.some((url) => url.endsWith(".woff") || url.endsWith(".woff2")));
  assert.ok(!urls.some((url) => url.endsWith(".webp")));
  assert.ok(!urls.includes("/api"));
  assert.ok(!urls.includes("/assets/page-11111111.js"));
});

test("assertPrecacheUrls rejects an empty list or a list without the shell", () => {
  assert.throws(() => assertPrecacheUrls([]), /sw_precache_empty/u);
  assert.throws(() => assertPrecacheUrls(["/assets/index-aaaaaaaa.js"]), /sw_shell_missing/u);
});

test("generateServiceWorker embeds a content-addressed cache name and the allowlist", async () => {
  const distDir = join(tmpdir(), `kondate-sw-${String(Date.now())}-a`);
  await writeFixtureDist(distDir);
  const first = await generateServiceWorker({ distDir });
  assert.deepEqual(first.precacheUrls, expectedPrecacheUrls);
  assert.match(first.cacheName, /^kondate-shell-[0-9a-f]{12}$/u);
  assert.equal(first.outputPath, join(distDir, "sw.js"));

  const second = await generateServiceWorker({ distDir });
  assert.equal(second.cacheName, first.cacheName);

  const sw = await readFile(first.outputPath, "utf8");
  assert.doesNotMatch(sw, /skipWaiting/u);
  assert.doesNotMatch(sw, /clients\.claim/u);
  assert.doesNotMatch(sw, /caches\.match\(/u);
  assert.doesNotMatch(sw, /cache\.put/u);
  assert.match(sw, /cache\.match/u);
  assert.doesNotMatch(sw, /\/index\.html/u);
});

test("CACHE_NAME follows index.html bytes and other non-hashed files, not hashed chunks", async () => {
  const baseDir = join(tmpdir(), `kondate-sw-${String(Date.now())}-b`);
  await writeFixtureDist(baseDir);
  const baseline = await generateServiceWorker({ distDir: baseDir });

  const indexChanged = join(tmpdir(), `kondate-sw-${String(Date.now())}-c`);
  await writeFixtureDist(indexChanged, { indexHtml: "<!doctype html><title>k</title>X" });
  const afterIndex = await generateServiceWorker({ distDir: indexChanged });
  assert.notEqual(afterIndex.cacheName, baseline.cacheName);

  const iconChanged = join(tmpdir(), `kondate-sw-${String(Date.now())}-d`);
  await writeFixtureDist(iconChanged, { icon192: Buffer.from("icon-192-changed") });
  const afterIcon = await generateServiceWorker({ distDir: iconChanged });
  assert.notEqual(afterIcon.cacheName, baseline.cacheName);

  const hashedChanged = join(tmpdir(), `kondate-sw-${String(Date.now())}-e`);
  await writeFixtureDist(hashedChanged, { hashedJs: "console.log(2)" });
  const afterHashed = await generateServiceWorker({ distDir: hashedChanged });
  assert.equal(afterHashed.cacheName, baseline.cacheName);
});

test("generateServiceWorker throws when the Vite manifest or index.html is missing", async () => {
  const missingManifest = join(tmpdir(), `kondate-sw-${String(Date.now())}-f`);
  await mkdir(missingManifest, { recursive: true });
  await writeFile(join(missingManifest, "index.html"), "<!doctype html>");
  await assert.rejects(
    () => generateServiceWorker({ distDir: missingManifest }),
    /sw_manifest_missing/u,
  );

  const missingIndex = join(tmpdir(), `kondate-sw-${String(Date.now())}-g`);
  await mkdir(join(missingIndex, ".vite"), { recursive: true });
  await writeFile(join(missingIndex, ".vite/manifest.json"), JSON.stringify(fixtureManifest));
  await assert.rejects(
    () => generateServiceWorker({ distDir: missingIndex }),
    /sw_index_html_missing/u,
  );
});

test("generateServiceWorker throws when lp-boot.js is missing from dist", async () => {
  const missingLpBoot = join(tmpdir(), `kondate-sw-${String(Date.now())}-lp-missing`);
  await writeFixtureDist(missingLpBoot, { skipLpBoot: true });
  await assert.rejects(
    () => generateServiceWorker({ distDir: missingLpBoot }),
    /sw_precache_file_missing/u,
  );
});

test("CACHE_NAME follows lp-boot.js bytes", async () => {
  const baseDir = join(tmpdir(), `kondate-sw-${String(Date.now())}-lp-base`);
  await writeFixtureDist(baseDir);
  const baseline = await generateServiceWorker({ distDir: baseDir });

  const lpBootChanged = join(tmpdir(), `kondate-sw-${String(Date.now())}-lp-changed`);
  await writeFixtureDist(lpBootChanged, {
    lpBootJs: 'document.documentElement.classList.add("kondate-js");X',
  });
  const afterLpBoot = await generateServiceWorker({ distDir: lpBootChanged });
  assert.notEqual(afterLpBoot.cacheName, baseline.cacheName);
});

test("generator source has no clock or random and stringifies esbuild defines", async () => {
  const source = await readFile(join(root, "scripts/generate-service-worker.mjs"), "utf8");
  assert.doesNotMatch(source, /Date\.now\s*\(/u);
  assert.doesNotMatch(source, /Math\.random\s*\(/u);
  assert.doesNotMatch(source, /crypto\.randomUUID/u);
  assert.match(source, /JSON\.stringify/u);
  assert.match(source, /define:/u);
});

test("CACHE_NAME is the SHA-256 prefix of sorted URLs plus non-hashed file digests", async () => {
  const distDir = join(tmpdir(), `kondate-sw-${String(Date.now())}-h`);
  const indexHtml = "<!doctype html><title>digest</title>";
  await writeFixtureDist(distDir, { indexHtml });
  const result = await generateServiceWorker({ distDir });

  const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const nonHashed = result.precacheUrls.filter((url) => !/-[0-9a-f]{8,}/iu.test(url));
  const contentByUrl = {
    "/": indexHtml,
    "/manifest.webmanifest": '{"name":"こんだて日和"}',
    "/icons/apple-touch-icon.png": Buffer.from("icon-180"),
    "/icons/icon-192.png": Buffer.from("icon-192"),
    "/icons/icon-512.png": Buffer.from("icon-512"),
    "/icons/icon-512-maskable.png": Buffer.from("icon-mask"),
    "/lp-boot.js": 'document.documentElement.classList.add("kondate-js");',
  };
  const urlPart = result.precacheUrls.join("\n");
  const hashPart = nonHashed.map((url) => sha256Hex(contentByUrl[url])).join("\n");
  assert.equal(result.cacheName, `kondate-shell-${sha256Hex(urlPart + hashPart).slice(0, 12)}`);
});
