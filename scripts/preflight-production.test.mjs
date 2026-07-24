import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { main, validateProductionEnv } from "./preflight-production.mjs";

const projectRef = "abcdefghijklmnopqrst";
const otherRef = "zyxwvutsrqponmlkjihg";
const hmacKey = randomBytes(32).toString("base64");
const encKey = randomBytes(32).toString("base64");
const password = "maint-pass-value";

function completeEnv(overrides = {}) {
  return {
    VITE_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-key-value",
    VITE_MAGIC_LINK_RESEND_SECONDS: "60",
    VITE_AUTH_CONTINUATION_TTL_MS: "300000",
    VITE_AUTH_PROVIDER_MODE: "supabase",
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: "publishable-key-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
    SUPABASE_MAINTENANCE_DB_URL: `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    SERVER_SITE_ORIGIN: "https://kondate.example.com",
    AUTH_CONTINUATION_ENCRYPTION_KEY: encKey,
    GENERATION_REQUEST_HMAC_KEY: hmacKey,
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_MODELS: "google/gemma-3-27b-it:free",
    GLOBAL_DAILY_AI_LIMIT: "45",
    USER_DAILY_AI_LIMIT: "5",
    USER_DAILY_EXTERNAL_CALL_LIMIT: "12",
    USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4",
    USER_SHORT_WINDOW_SECONDS: "600",
    AUTH_CONTINUATION_TTL_SECONDS: "300",
    OPENROUTER_TIMEOUT_MS: "20000",
    FUNCTION_TOTAL_BUDGET_MS: "50000",
    AI_PROCESSING_STALE_SECONDS: "180",
    ...overrides,
  };
}

test("accepts a complete synthetic production environment", () => {
  assert.deepEqual(validateProductionEnv(completeEnv()), { projectRef });
});

for (const key of Object.keys(completeEnv())) {
  test(`rejects missing ${key}`, () => {
    const env = completeEnv();
    delete env[key];
    assert.throws(() => validateProductionEnv(env), new RegExp(key));
  });
}

test("rejects VITE_ aliases of server secrets even when empty", () => {
  for (const key of [
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
    "VITE_OPENROUTER_API_KEY",
    "VITE_GENERATION_REQUEST_HMAC_KEY",
    "VITE_SUPABASE_MAINTENANCE_DB_URL",
  ]) {
    assert.throws(() => validateProductionEnv(completeEnv({ [key]: "" })), new RegExp(key));
  }
});

test("requires VITE_AUTH_PROVIDER_MODE=supabase", () => {
  assert.throws(
    () => validateProductionEnv(completeEnv({ VITE_AUTH_PROVIDER_MODE: "oauth_mock" })),
    /VITE_AUTH_PROVIDER_MODE/,
  );
});

test("rejects VITE_OAUTH_MOCK_ORIGIN even when empty", () => {
  assert.throws(
    () => validateProductionEnv(completeEnv({ VITE_OAUTH_MOCK_ORIGIN: "" })),
    /VITE_OAUTH_MOCK_ORIGIN/,
  );
});

test("rejects KONDATE_MAINTENANCE_ENV even when empty", () => {
  assert.throws(
    () => validateProductionEnv(completeEnv({ KONDATE_MAINTENANCE_ENV: "" })),
    /KONDATE_MAINTENANCE_ENV/,
  );
});

test("rejects sample HMAC placeholder and invalid lengths", () => {
  assert.throws(
    () =>
      validateProductionEnv(
        completeEnv({ GENERATION_REQUEST_HMAC_KEY: "generated-32-byte-base64-secret" }),
      ),
    /GENERATION_REQUEST_HMAC_KEY/,
  );
  assert.throws(
    () =>
      validateProductionEnv(
        completeEnv({ GENERATION_REQUEST_HMAC_KEY: Buffer.alloc(31).toString("base64") }),
      ),
    /GENERATION_REQUEST_HMAC_KEY/,
  );
});

test("rejects browser/server project ref mismatch", () => {
  assert.throws(
    () =>
      validateProductionEnv(
        completeEnv({
          VITE_SUPABASE_URL: `https://${otherRef}.supabase.co`,
        }),
      ),
    /supabase_project_ref_mismatch/,
  );
});

test("rejects publishable key mismatch", () => {
  assert.throws(
    () => validateProductionEnv(completeEnv({ SUPABASE_PUBLISHABLE_KEY: "other-publishable" })),
    /supabase_publishable_key_mismatch/,
  );
});

test("rejects maintenance URL bound to another project ref", () => {
  assert.throws(
    () =>
      validateProductionEnv(
        completeEnv({
          SUPABASE_MAINTENANCE_DB_URL: `postgresql://kondate_maintenance_login:${password}@db.${otherRef}.supabase.co:5432/postgres?sslmode=require`,
        }),
      ),
    /maintenance_db_url_invalid/,
  );
});

test("rejects non-HTTPS maintenance and wrong login user", () => {
  assert.throws(
    () =>
      validateProductionEnv(
        completeEnv({
          SUPABASE_MAINTENANCE_DB_URL: `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=disable`,
        }),
      ),
    /maintenance_db_url_invalid/,
  );
  assert.throws(
    () =>
      validateProductionEnv(
        completeEnv({
          SUPABASE_MAINTENANCE_DB_URL: `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
        }),
      ),
    /maintenance_db_url_invalid/,
  );
});

test("CLI subprocess uses only the synthetic env object", () => {
  const script = fileURLToPath(new URL("./preflight-production.mjs", import.meta.url));
  const good = spawnSync(process.execPath, [script], {
    env: completeEnv(),
    encoding: "utf8",
  });
  assert.equal(good.status, 0, good.stderr);

  const bad = spawnSync(process.execPath, [script], {
    env: completeEnv({ OPENROUTER_API_KEY: "" }),
    encoding: "utf8",
  });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /OPENROUTER_API_KEY/);
  assert.doesNotMatch(bad.stderr, new RegExp(password));
  assert.doesNotMatch(bad.stderr, new RegExp(projectRef));
});

test("main returns closed codes without secret leakage", () => {
  const lines = [];
  const code = main(completeEnv({ USER_DAILY_AI_LIMIT: "6" }), (line) => lines.push(line));
  assert.equal(code, 1);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], new RegExp(password));
});
