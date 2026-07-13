import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root compose owns every local entry-point service", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  for (const name of [
    "app:",
    "mailpit:",
    "openrouter-mock:",
    "oauth-mock:",
    "migrate:",
    "db-test:",
  ]) {
    assert.match(compose, new RegExp(`^  ${name}`, "m"));
  }
  assert.match(compose, /infra\/supabase\/docker-compose\.yml/);
});

test("uses one canonical loopback hostname for public browser services", async () => {
  const [compose, example, config] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile(".env.example", "utf8"),
    readFile("supabase/config.toml", "utf8"),
  ]);
  for (const source of [compose, example, config])
    assert.doesNotMatch(source, /http:\/\/local(?:host)/u);
  assert.match(example, /^SERVER_SITE_ORIGIN=http:\/\/127\.0\.0\.1:5173$/mu);
  assert.match(example, /^API_EXTERNAL_URL=http:\/\/127\.0\.0\.1:8000$/mu);
  assert.match(example, /^VITE_AUTH_PROVIDER_MODE=oauth_mock$/mu);
  assert.match(example, /^VITE_OAUTH_MOCK_ORIGIN=http:\/\/127\.0\.0\.1:8788$/mu);
  assert.match(config, /site_url = "http:\/\/127\.0\.0\.1:5173"/u);
});

test("Dockerfile uses Node 24", async () => {
  assert.match(await readFile("Dockerfile", "utf8"), /^FROM node:24-/m);
});

test("keeps host development on loopback while the container can accept published traffic", async () => {
  const [compose, dockerfile, viteConfig] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("Dockerfile", "utf8"),
    readFile("vite.config.ts", "utf8"),
  ]);
  assert.match(viteConfig, /host: "127\.0\.0\.1"/u);
  assert.match(dockerfile, /"--host", "0\.0\.0\.0"/u);
  assert.match(compose, /\sapp:\n(?:.*\n)*?\s{4}healthcheck:/u);
});

test("runs mock services with only their required read-only files and environment", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  const openrouter = compose.match(
    /\s{2}openrouter-mock:\n([\s\S]*?)(?=\n\s{2}[\w-]+:|\nvolumes:)/u,
  )?.[1];
  const oauth = compose.match(/\s{2}oauth-mock:\n([\s\S]*?)(?=\n\s{2}[\w-]+:|\nvolumes:)/u)?.[1];
  assert.ok(openrouter, "openrouter mock service is missing");
  assert.ok(oauth, "OAuth mock service is missing");
  assert.match(openrouter, /tools\/openrouter-mock\/server\.mjs:\/app\/server\.mjs:ro/u);
  assert.doesNotMatch(openrouter, /\.:\/workspace/u);
  assert.doesNotMatch(openrouter, /working_dir:/u);
  assert.match(oauth, /tools\/oauth-mock\/server\.mjs:\/app\/server\.mjs:ro/u);
  assert.match(oauth, /tools\/oauth-mock\/fixtures:\/app\/fixtures:ro/u);
  assert.doesNotMatch(oauth, /\.:\/workspace/u);
  assert.doesNotMatch(oauth, /working_dir:/u);
});

test("runs the development app as the node user and keeps generated Vite cache outside mounted dependencies", async () => {
  const [compose, dockerfile, viteConfig] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("Dockerfile", "utf8"),
    readFile("vite.config.ts", "utf8"),
  ]);
  assert.match(
    compose,
    /\sapp:\n(?:.*\n)*?\s{4}user: "\$\{LOCAL_UID:-1000\}:\$\{LOCAL_GID:-1000\}"/u,
  );
  assert.match(dockerfile, /^USER node$/m);
  assert.match(viteConfig, /cacheDir: "\/tmp\/vite"/u);
});

test("uses the isolated E2E Function server without changing the public origin", async () => {
  const [compose, composeE2e, viteConfig, runner] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("compose.e2e.yaml", "utf8"),
    readFile("vite.config.ts", "utf8"),
    readFile("tools/run-e2e-app.mjs", "utf8"),
  ]);
  assert.doesNotMatch(compose, /KONDATE_E2E_FUNCTION_SERVER/u);
  assert.match(composeE2e, /KONDATE_E2E_FUNCTION_SERVER: "1"/u);
  assert.match(composeE2e, /command: \["node", "tools\/run-e2e-app\.mjs"\]/u);
  assert.match(viteConfig, /functions: \{ enabled: !isE2eFunctionServer \}/u);
  assert.match(viteConfig, /target: "http:\/\/127\.0\.0\.1:5174"/u);
  assert.match(runner, /SIGTERM/u);
  assert.match(runner, /SIGINT/u);
});
