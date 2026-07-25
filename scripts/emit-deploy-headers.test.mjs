import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertProductionCspMatchesSupabaseUrl, buildDeployHeadersFile } from "./csp-headers.mjs";
import { emitDeployHeaders, main, parseContextArg } from "./emit-deploy-headers.mjs";

const projectRef = "abcdefghijklmnopqrst";
const origin = `https://${projectRef}.supabase.co`;

test("parseContextArg reads --context value", () => {
  assert.equal(parseContextArg(["--context", "production"]), "production");
  assert.equal(parseContextArg([]), undefined);
  assert.throws(() => parseContextArg(["--context"]), /csp_context_missing/);
});

test("emit writes preview wildcard headers by default", async () => {
  const publishDir = await mkdtemp(join(tmpdir(), "kondate-headers-preview-"));
  const result = await emitDeployHeaders({
    env: {},
    publishDir,
  });
  assert.equal(result.context, "deploy-preview");
  const body = await readFile(join(publishDir, "_headers"), "utf8");
  assert.equal(body, buildDeployHeadersFile({ context: "deploy-preview" }));
  assert.match(body, /\*\.supabase\.co/u);
});

test("emit production headers pin VITE_SUPABASE_URL and refuse missing URL", async () => {
  const publishDir = await mkdtemp(join(tmpdir(), "kondate-headers-prod-"));
  const result = await emitDeployHeaders({
    context: "production",
    env: { VITE_SUPABASE_URL: origin },
    publishDir,
  });
  const body = await readFile(result.target, "utf8");
  assert.equal(assertProductionCspMatchesSupabaseUrl(body, origin), true);

  await assert.rejects(
    () =>
      emitDeployHeaders({
        context: "production",
        env: {},
        publishDir,
      }),
    /csp_supabase_url/,
  );
});

test("main returns closed codes without printing origins", async () => {
  const messages = [];
  const code = await main({
    argv: ["--context", "production"],
    env: {},
    publishDir: await mkdtemp(join(tmpdir(), "kondate-headers-main-")),
    write: (line) => messages.push(line),
  });
  assert.equal(code, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /^emit-deploy-headers: csp_supabase_url/u);
  assert.doesNotMatch(messages[0], /supabase\.co/u);
});
