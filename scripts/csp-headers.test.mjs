import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_CONNECT_SRC,
  assertProductionCspMatchesSupabaseUrl,
  buildConnectSrc,
  buildContentSecurityPolicy,
  buildDeployHeadersFile,
  buildProductionConnectSrc,
  extractConnectSrc,
} from "./csp-headers.mjs";

const projectRef = "abcdefghijklmnopqrst";
const origin = `https://${projectRef}.supabase.co`;
const otherRef = "zyxwvutsrqponmlkjihg";

test("production connect-src pins exact https and wss managed origins", () => {
  assert.equal(
    buildProductionConnectSrc(origin),
    `'self' ${origin} wss://${projectRef}.supabase.co`,
  );
});

test("production connect-src rejects invalid or non-canonical managed URLs", () => {
  assert.throws(() => buildProductionConnectSrc(""), /csp_supabase_url/);
  assert.throws(() => buildProductionConnectSrc("http://127.0.0.1:8000"), /csp_supabase_url/);
  assert.throws(
    () => buildProductionConnectSrc(`https://${projectRef}.supabase.co/`),
    /csp_supabase_url/,
  );
  assert.throws(() => buildProductionConnectSrc(`https://short.supabase.co`), /csp_supabase_url/);
});

test("preview and branch contexts keep the managed wildcard", () => {
  assert.equal(buildConnectSrc("deploy-preview"), PREVIEW_CONNECT_SRC);
  assert.equal(buildConnectSrc("branch-deploy"), PREVIEW_CONNECT_SRC);
  assert.equal(buildConnectSrc("deploy-preview", origin), PREVIEW_CONNECT_SRC);
  assert.match(buildConnectSrc("deploy-preview"), /\*\.supabase\.co/u);
});

test("production CSP header has no wildcard and matches VITE origin", () => {
  const headers = buildDeployHeadersFile({ context: "production", supabaseUrl: origin });
  // Spec §7.5: /sw.js と manifest の MIME を /* CSP より先に固定する
  assert.match(
    headers,
    /^\/sw\.js\n {2}Cache-Control: no-cache\n {2}Content-Type: text\/javascript; charset=utf-8\n\n\/manifest\.webmanifest\n {2}Content-Type: application\/manifest\+json\n\n\/\*\n {2}Content-Security-Policy: /u,
  );
  assert.doesNotMatch(headers, /\*\.supabase\.co/u);
  assert.match(
    headers,
    new RegExp(`connect-src 'self' ${origin} wss://${projectRef}\\.supabase\\.co`),
  );
  assert.equal(assertProductionCspMatchesSupabaseUrl(headers, origin), true);
});

test("assertProductionCspMatchesSupabaseUrl rejects wildcard and wrong ref", () => {
  const wildcard = buildDeployHeadersFile({ context: "deploy-preview" });
  assert.throws(
    () => assertProductionCspMatchesSupabaseUrl(wildcard, origin),
    /csp_connect_src_wildcard_forbidden/,
  );

  const other = buildDeployHeadersFile({
    context: "production",
    supabaseUrl: `https://${otherRef}.supabase.co`,
  });
  assert.throws(
    () => assertProductionCspMatchesSupabaseUrl(other, origin),
    /csp_connect_src_mismatch/,
  );

  assert.throws(
    () => assertProductionCspMatchesSupabaseUrl("/*\n  X-Frame-Options: DENY\n", origin),
    /csp_connect_src_missing/,
  );
});

test("style-src remains self-only without unsafe-inline", () => {
  const csp = buildContentSecurityPolicy(buildConnectSrc("production", origin));
  assert.match(csp, /style-src 'self'/u);
  assert.doesNotMatch(csp, /unsafe-inline/u);
});

test("extractConnectSrc reads _headers and raw CSP", () => {
  const headers = buildDeployHeadersFile({ context: "production", supabaseUrl: origin });
  assert.equal(extractConnectSrc(headers), buildProductionConnectSrc(origin));
  assert.equal(
    extractConnectSrc(buildContentSecurityPolicy(PREVIEW_CONNECT_SRC)),
    PREVIEW_CONNECT_SRC,
  );
});
