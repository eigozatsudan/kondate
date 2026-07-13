import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("pins Node 24 and exposes every verification script", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=24 <25");
  assert.match(manifest.devDependencies["@netlify/functions"], /^\^5\./u);
  for (const name of [
    "build",
    "format:check",
    "lint",
    "typecheck",
    "test",
    "db:test",
    "db:types",
    "e2e",
  ]) {
    assert.equal(typeof manifest.scripts[name], "string", `missing ${name}`);
  }
  assert.equal(await readFile(".nvmrc", "utf8"), "24\n");
});

test("E2E mobile project uses Chromium while preserving the iPhone viewport", async () => {
  const config = await readFile("playwright.config.ts", "utf8");
  assert.match(
    config,
    /name: "mobile-chromium", use: \{ \.\.\.devices\["iPhone SE"\], browserName: "chromium" \}/u,
  );
});

test("E2E uses one worker for the shared local auth stack", async () => {
  const config = await readFile("playwright.config.ts", "utf8");
  assert.match(config, /workers: 1/u);
  assert.doesNotMatch(config, /process\.env\.CI \? \{ workers: 1 \}/u);
});

test("Vite ignores Playwright output directories", async () => {
  const config = await readFile("vite.config.ts", "utf8");
  assert.match(config, /"\*\*\/playwright-report\/\*\*"/u);
  assert.match(config, /"\*\*\/test-results\/\*\*"/u);
});

test("Vitest excludes the plan-mandated node:test Function server suite", async () => {
  const config = await readFile("vitest.config.ts", "utf8");
  assert.match(config, /exclude: \["tools\/e2e-function-server\.test\.mjs"\]/u);
  assert.match(config, /"tools\/\*\*\/\*\.test\.mjs"/u);
});

test("local secret generator emits unquoted Supabase verification paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kondate-local-secrets-"));
  await mkdir(join(cwd, "infra/supabase"), { recursive: true });
  await writeFile(
    join(cwd, "infra/supabase/.env.example"),
    [
      'MAILER_URLPATHS_CONFIRMATION="/quoted/confirmation"',
      'MAILER_URLPATHS_INVITE="/quoted/invite"',
      'MAILER_URLPATHS_RECOVERY="/quoted/recovery"',
      'MAILER_URLPATHS_EMAIL_CHANGE="/quoted/email-change"',
    ].join("\n"),
  );

  const script = resolve("scripts/generate-local-secrets.mjs");
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script], { cwd, stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("exit", (code) =>
      code === 0 ? resolveRun() : rejectRun(new Error(`generator exited with ${String(code)}`)),
    );
  });

  const generated = await readFile(join(cwd, ".env"), "utf8");
  for (const key of [
    "MAILER_URLPATHS_CONFIRMATION",
    "MAILER_URLPATHS_INVITE",
    "MAILER_URLPATHS_RECOVERY",
    "MAILER_URLPATHS_EMAIL_CHANGE",
  ]) {
    assert.match(generated, new RegExp(`^${key}=/auth/v1/verify$`, "mu"));
  }
});
