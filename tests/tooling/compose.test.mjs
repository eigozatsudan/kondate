import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root compose owns every local entry-point service", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  for (const name of ["app:", "mailpit:", "openrouter-mock:", "oauth-mock:", "migrate:", "db-test:"]) {
    assert.match(compose, new RegExp(`^  ${name}`, "m"));
  }
  assert.match(compose, /infra\/supabase\/docker-compose\.yml/);
});

test("uses one canonical loopback hostname for public browser services", async () => {
  const [compose, example, config] = await Promise.all([
    readFile("compose.yaml", "utf8"), readFile(".env.example", "utf8"),
    readFile("supabase/config.toml", "utf8"),
  ]);
  for (const source of [compose, example, config]) assert.doesNotMatch(source, /http:\/\/local(?:host)/u);
  assert.match(example, /^SERVER_SITE_ORIGIN=http:\/\/127\.0\.0\.1:5173$/mu);
  assert.match(example, /^API_EXTERNAL_URL=http:\/\/127\.0\.0\.1:8000$/mu);
  assert.match(example, /^VITE_AUTH_PROVIDER_MODE=oauth_mock$/mu);
  assert.match(example, /^VITE_OAUTH_MOCK_ORIGIN=http:\/\/127\.0\.0\.1:8788$/mu);
  assert.match(config, /site_url = "http:\/\/127\.0\.0\.1:5173"/u);
});

test("Dockerfile uses Node 24", async () => {
  assert.match(await readFile("Dockerfile", "utf8"), /^FROM node:24-/m);
});
