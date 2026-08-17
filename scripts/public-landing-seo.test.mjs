import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDeployHeadersFile } from "./csp-headers.mjs";

test("canonical link is vite-ignored so href=/ is not read as a directory", async () => {
  const source = await readFile("src/features/landing/build-public-landing-html.ts", "utf8");
  // Vite 8 は <link href="/"> を root の readFile にし EISDIR で落とす。
  assert.match(source, /<link rel="canonical" href="\/" vite-ignore \/>/u);
});

test("robots.txt allows only the homepage", async () => {
  const body = (await readFile("public/robots.txt", "utf8")).replace(/\n$/u, "");
  assert.equal(body, "User-agent: *\nAllow: /$\nDisallow: /");
});

test("SPA fallback is app.html without force", async () => {
  const toml = await readFile("netlify.toml", "utf8");
  assert.match(toml, /from = "\/\*"\n {2}to = "\/app.html"\n {2}status = 200\n/u);
  assert.doesNotMatch(toml, /to = "\/index.html"/u);
  const fallback = /from = "\/\*"\n(?<block>(?: {2}.*\n)+)/u.exec(toml);
  assert.ok(fallback?.groups?.block);
  assert.doesNotMatch(fallback.groups.block, /force/u);
});

test("app.html is noindexed and the document root is not", () => {
  const headers = buildDeployHeadersFile({ context: "deploy-preview" });
  assert.match(headers, /\/app\.html\n {2}X-Robots-Tag: noindex\n/u);
  assert.doesNotMatch(headers, /\/\*\n {2}X-Robots-Tag/u);
});
