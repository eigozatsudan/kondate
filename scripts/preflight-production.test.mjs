import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  main,
  parseOpenRouterModels,
  validateBillingStripeEnv,
  validateProductionCsp,
  validateProductionEnv,
} from "./preflight-production.mjs";
import { rejectedModelLists } from "./openrouter-models-contract.mjs";
import { buildDeployHeadersFile } from "./csp-headers.mjs";

const projectRef = "abcdefghijklmnopqrst";
const otherRef = "zyxwvutsrqponmlkjihg";
// generation request と identity 日次枠は別ドメイン。fixture でも同一材料を使わない（S4）
const hmacKey = randomBytes(32).toString("base64");
const quotaIdentityHmacKey = randomBytes(32).toString("base64");
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
    MAINTENANCE_CRON_SECRET: "maintenance-cron-secret-32chars!!",
    SHARE_WORKER_CRON_SECRET: "share-worker-cron-secret-32ch!!",
    SERVER_SITE_ORIGIN: "https://kondate.example.com",
    AUTH_CONTINUATION_ENCRYPTION_KEY: encKey,
    GENERATION_REQUEST_HMAC_KEY: hmacKey,
    QUOTA_IDENTITY_HMAC_KEY: quotaIdentityHmacKey,
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_MODELS: "mistralai/mistral-small-3.2-24b-instruct,openai/gpt-oss-120b",
    GLOBAL_DAILY_AI_LIMIT: "20",
    USER_DAILY_AI_LIMIT: "3",
    USER_DAILY_EXTERNAL_CALL_LIMIT: "6",
    USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4",
    USER_SHORT_WINDOW_SECONDS: "600",
    AUTH_CONTINUATION_TTL_SECONDS: "300",
    OPENROUTER_TIMEOUT_MS: "24000",
    FUNCTION_TOTAL_BUDGET_MS: "55000",
    AI_PROCESSING_STALE_SECONDS: "180",
    ...overrides,
  };
}

test("accepts a complete synthetic production environment", () => {
  assert.deepEqual(validateProductionEnv(completeEnv()), { projectRef });
});

// 3 鏡像の第3: preflight も contract の空要素・危険 ID を拒否する
for (const { raw, baseUrl } of rejectedModelLists) {
  test(`preflight parseOpenRouterModels rejects unsafe list: ${raw || "empty"}`, () => {
    assert.throws(
      () => parseOpenRouterModels(raw, { openRouterBaseUrl: baseUrl }),
      /OPENROUTER_MODELS/u,
    );
  });
}

test("preflight rejects empty model list elements like vendor/a,,vendor/b", () => {
  assert.throws(
    () =>
      parseOpenRouterModels("vendor/a,,vendor/b", {
        openRouterBaseUrl: "https://openrouter.ai/api/v1",
      }),
    /empty elements/u,
  );
});

for (const key of Object.keys(completeEnv())) {
  test(`rejects missing ${key}`, () => {
    const env = completeEnv();
    // no-dynamic-delete: キーを除いたコピーで欠落を表現する
    const without = Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));
    assert.throws(() => validateProductionEnv(without), new RegExp(key));
  });
}

test("rejects VITE_ aliases of server secrets even when empty", () => {
  for (const key of [
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
    "VITE_OPENROUTER_API_KEY",
    "VITE_GENERATION_REQUEST_HMAC_KEY",
    "VITE_QUOTA_IDENTITY_HMAC_KEY",
    "VITE_SUPABASE_MAINTENANCE_DB_URL",
    "VITE_AUTH_CONTINUATION_ENCRYPTION_KEY",
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

test("rejects equal GENERATION_REQUEST and QUOTA_IDENTITY HMAC keys after 32-byte decode (S4)", () => {
  const sameKey = randomBytes(32).toString("base64");
  assert.throws(
    () =>
      validateProductionEnv(
        completeEnv({
          GENERATION_REQUEST_HMAC_KEY: sameKey,
          QUOTA_IDENTITY_HMAC_KEY: sameKey,
        }),
      ),
    /hmac_keys_must_differ/,
  );
});

test("accepts distinct GENERATION_REQUEST and QUOTA_IDENTITY HMAC keys (S4)", () => {
  assert.deepEqual(validateProductionEnv(completeEnv()), { projectRef });
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

test("production CSP connect-src matches VITE_SUPABASE_URL without wildcards", () => {
  const env = completeEnv();
  assert.deepEqual(validateProductionEnv(env), { projectRef });
  assert.equal(validateProductionCsp(env.VITE_SUPABASE_URL), true);
  // U5-M3: 成果物パスが無いときは純関数照合のみ（従来どおり true）
  assert.equal(validateProductionCsp(env.VITE_SUPABASE_URL, { headersPath: undefined }), true);

  const headers = buildDeployHeadersFile({
    context: "production",
    supabaseUrl: env.VITE_SUPABASE_URL,
  });
  assert.doesNotMatch(headers, /\*\.supabase\.co/u);
  assert.match(
    headers,
    new RegExp(
      `connect-src 'self' https://${projectRef}\\.supabase\\.co wss://${projectRef}\\.supabase\\.co`,
    ),
  );

  assert.throws(() => validateProductionCsp("http://127.0.0.1:8000"), /csp_supabase_url/);
  assert.throws(
    () => validateProductionCsp(`https://${otherRef}.supabase.co.evil.example`),
    /csp_supabase_url/,
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

// 製品 max は plan-quota.ts の globalDailyAiLimitProductMax（現状 500）と preflight ミラーが正本。
test("accepts GLOBAL_DAILY_AI_LIMIT up to product max 500 and rejects 501", () => {
  assert.deepEqual(validateProductionEnv(completeEnv({ GLOBAL_DAILY_AI_LIMIT: "500" })), {
    projectRef,
  });
  assert.deepEqual(validateProductionEnv(completeEnv({ GLOBAL_DAILY_AI_LIMIT: "80" })), {
    projectRef,
  });
  assert.throws(
    () => validateProductionEnv(completeEnv({ GLOBAL_DAILY_AI_LIMIT: "501" })),
    /GLOBAL_DAILY_AI_LIMIT/,
  );
});

test("billing disabled with no Stripe keys is accepted", () => {
  assert.deepEqual(validateProductionEnv(completeEnv({ BILLING_ENABLED: "false" })), {
    projectRef,
  });
  validateBillingStripeEnv(completeEnv());
});

test("billing disabled with only STRIPE_API_VERSION pin does not require full keys", () => {
  // env.ts と同型: API version 単独は鍵セット要求を起動しない
  assert.deepEqual(
    validateProductionEnv(
      completeEnv({
        BILLING_ENABLED: "false",
        STRIPE_API_VERSION: "2026-06-24.dahlia",
      }),
    ),
    { projectRef },
  );
  validateBillingStripeEnv(
    completeEnv({
      BILLING_ENABLED: "false",
      STRIPE_API_VERSION: "2026-06-24.dahlia",
    }),
  );
});

test("billing enabled requires full Stripe set and API version pin", () => {
  assert.throws(
    () => validateProductionEnv(completeEnv({ BILLING_ENABLED: "true" })),
    /STRIPE_SECRET_KEY|OPENROUTER_PLUS_MODELS/,
  );
  assert.deepEqual(
    validateProductionEnv(
      completeEnv({
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_live_test_key_value",
        STRIPE_WEBHOOK_SECRET: "whsec_test_key_value",
        STRIPE_PRICE_PLUS_MONTHLY: "price_monthly_test",
        STRIPE_PRICE_PLUS_YEARLY: "price_yearly_test",
        STRIPE_API_VERSION: "2026-06-24.dahlia",
        OPENROUTER_PLUS_MODELS: "openai/gpt-5.6-luna",
      }),
    ),
    { projectRef },
  );
  assert.throws(
    () =>
      validateBillingStripeEnv(
        completeEnv({
          BILLING_ENABLED: "true",
          STRIPE_SECRET_KEY: "sk_live_test_key_value",
          STRIPE_WEBHOOK_SECRET: "whsec_test_key_value",
          STRIPE_PRICE_PLUS_MONTHLY: "price_monthly_test",
          STRIPE_PRICE_PLUS_YEARLY: "price_yearly_test",
          STRIPE_API_VERSION: "2025-01-01.acacia",
          OPENROUTER_PLUS_MODELS: "openai/gpt-5.6-luna",
        }),
      ),
    /STRIPE_API_VERSION/,
  );
});

test("rejects VITE_STRIPE and STRIPE_MOCK_BASE_URL in production preflight", () => {
  assert.throws(
    () => validateProductionEnv(completeEnv({ VITE_STRIPE_SECRET_KEY: "" })),
    /VITE_STRIPE/,
  );
  assert.throws(
    () =>
      validateBillingStripeEnv(
        completeEnv({
          STRIPE_SECRET_KEY: "sk_live_x",
          STRIPE_WEBHOOK_SECRET: "whsec_x",
          STRIPE_PRICE_PLUS_MONTHLY: "price_m",
          STRIPE_PRICE_PLUS_YEARLY: "price_y",
          STRIPE_API_VERSION: "2026-06-24.dahlia",
          STRIPE_MOCK_BASE_URL: "http://stripe-mock:8790",
        }),
      ),
    /STRIPE_MOCK_BASE_URL/,
  );
});
