/**
 * 本番デプロイ前の閉じた環境検証。ネットワーク呼び出しなし。
 * 失敗時は変数名または閉じたコードのみを stderr へ出し、
 * URL 成分・project ref・秘密値は出さない。
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertProductionCspMatchesSupabaseUrl, buildDeployHeadersFile } from "./csp-headers.mjs";

// TS の parseOpenRouterModels / parseManagedSupabaseProjectRef と
// maintenance-env はビルド成果ではなくソースを Node から直接は import できない。
// 鏡像実装をここに置き、ユニットテストで契約を固定する。
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;
const sampleHmacPlaceholder = "generated-32-byte-base64-secret";

export function parseManagedSupabaseProjectRef(value) {
  return managedSupabaseOrigin.exec(value)?.[1] ?? null;
}

/**
 * production ビルドが書く _headers の connect-src が
 * VITE_SUPABASE_URL と一致し、*.supabase.co を含まないことを検証する。
 * リポジトリに project ref を直書きせず、emit と同じ純関数を再利用する。
 *
 * U5-M3: dist/_headers が既に存在するとき（ビルド後 preflight）は
 * 純関数再計算だけでなく、成果物本文も exact 一致させる。
 */
export function validateProductionCsp(supabaseUrl, options = {}) {
  const headers = buildDeployHeadersFile({
    context: "production",
    supabaseUrl,
  });
  assertProductionCspMatchesSupabaseUrl(headers, supabaseUrl);
  const artifactPath = options.headersPath;
  if (typeof artifactPath === "string" && artifactPath.length > 0) {
    const { readFileSync, existsSync } = options.fs ?? {};
    if (typeof existsSync === "function" && typeof readFileSync === "function") {
      if (!existsSync(artifactPath)) {
        throw new Error("csp_headers_artifact_missing");
      }
      const onDisk = readFileSync(artifactPath, "utf8");
      if (onDisk !== headers) {
        throw new Error("csp_headers_artifact_mismatch");
      }
    }
  }
  return true;
}

/**
 * 本番 preflight 用 OPENROUTER_MODELS パーサ。
 * 正本: scripts/openrouter-models-contract.mjs。
 * 鏡像: env.ts / verify-openrouter-models.mjs。
 * preflight は常に公式 base 前提（mock 例外は到達不能）。
 */
export function parseOpenRouterModels(value, context = {}) {
  const openRouterBaseUrl =
    typeof context.openRouterBaseUrl === "string" && context.openRouterBaseUrl.length > 0
      ? context.openRouterBaseUrl
      : "https://openrouter.ai/api/v1";
  // 設計: カンマ区切り・前後 trim・空要素なし（filter(Boolean) で空を落とさない）
  const models = String(value)
    .split(",")
    .map((item) => item.trim());
  if (models.some((model) => model.length === 0)) {
    throw new Error("OPENROUTER_MODELS must not contain empty elements");
  }
  if (models.length === 0) throw new Error("OPENROUTER_MODELS must not be empty");
  if (new Set(models).size !== models.length) {
    throw new Error("OPENROUTER_MODELS must not contain duplicates");
  }
  // preflight は本番のみ。exact mock 判定は規則同一だが到達しない経路として残す
  let mockPath = false;
  try {
    const parsed = new URL(openRouterBaseUrl);
    mockPath =
      parsed.protocol === "http:" &&
      parsed.hostname === "openrouter-mock" &&
      parsed.port === "8787" &&
      parsed.pathname === "/api/v1" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "";
  } catch {
    mockPath = false;
  }
  // router / :free は大小文字を正規化して拒否（env.ts と鏡像・G4/G5）
  const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
  for (const model of models) {
    const normalized = model.toLowerCase();
    if (routers.has(normalized)) {
      throw new Error(`OPENROUTER_MODELS rejects router model ID: ${model}`);
    }
    if (mockPath) {
      // R1: mock/ 接頭も :free 接尾も case-insensitive
      if (!normalized.startsWith("mock/") || !normalized.endsWith(":free")) {
        throw new Error(`OPENROUTER_MODELS mock path accepts only mock/*:free: ${model}`);
      }
    } else if (normalized.endsWith(":free") || normalized.startsWith("mock/")) {
      // 設計: exact mock 以外では mock/ も :free も拒否（Mock/・:Free/:FREE 含む）
      throw new Error(`OPENROUTER_MODELS rejects mock/ or :free model on non-mock base: ${model}`);
    }
  }
  return models;
}

// maintenance-env の本番パーサを動的 import（tsx/ts なしの Node 向けに
// 同じ規則をここへ重複実装し、テストで同期を確認する）
const localLoginUser = "kondate_maintenance_login";
const poolerHostPattern = /^[a-z0-9-]+\.pooler\.supabase\.com$/u;

function parseProductionMaintenanceUrl(raw, expectedProjectRef) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("SUPABASE_MAINTENANCE_DB_URL");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("maintenance_db_url_invalid");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("maintenance_db_url_invalid");
  }
  if (!parsed.password) throw new Error("maintenance_db_url_invalid");
  if (parsed.pathname !== "/postgres") throw new Error("maintenance_db_url_invalid");
  if (parsed.hash) throw new Error("maintenance_db_url_invalid");
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "sslmode") {
    throw new Error("maintenance_db_url_invalid");
  }
  if (parsed.searchParams.getAll("sslmode").length !== 1) {
    throw new Error("maintenance_db_url_invalid");
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode !== "require" && sslmode !== "verify-ca" && sslmode !== "verify-full") {
    throw new Error("maintenance_db_url_invalid");
  }
  if (parsed.port !== "5432") throw new Error("maintenance_db_url_invalid");
  const username = decodeURIComponent(parsed.username);
  const directHost = `db.${expectedProjectRef}.supabase.co`;
  const sessionUser = `${localLoginUser}.${expectedProjectRef}`;
  const isDirect = username === localLoginUser && parsed.hostname === directHost;
  const isSession = username === sessionUser && poolerHostPattern.test(parsed.hostname);
  if (!isDirect && !isSession) throw new Error("maintenance_db_url_invalid");
}

const REQUIRED_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_MAGIC_LINK_RESEND_SECONDS",
  "VITE_AUTH_CONTINUATION_TTL_MS",
  "VITE_AUTH_PROVIDER_MODE",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_MAINTENANCE_DB_URL",
  "MAINTENANCE_CRON_SECRET",
  "SHARE_WORKER_CRON_SECRET",
  "SERVER_SITE_ORIGIN",
  "AUTH_CONTINUATION_ENCRYPTION_KEY",
  "GENERATION_REQUEST_HMAC_KEY",
  "QUOTA_IDENTITY_HMAC_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODELS",
  "GLOBAL_DAILY_AI_LIMIT",
  "USER_DAILY_AI_LIMIT",
  "USER_DAILY_EXTERNAL_CALL_LIMIT",
  "USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT",
  "USER_SHORT_WINDOW_SECONDS",
  "AUTH_CONTINUATION_TTL_SECONDS",
  "OPENROUTER_TIMEOUT_MS",
  "FUNCTION_TOTAL_BUDGET_MS",
  "AI_PROCESSING_STALE_SECONDS",
];

const FORBIDDEN_VITE_ALIASES = [
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
  "VITE_OPENROUTER_API_KEY",
  "VITE_GENERATION_REQUEST_HMAC_KEY",
  "VITE_QUOTA_IDENTITY_HMAC_KEY",
  "VITE_AI_QUOTA_DISABLED",
  "VITE_SUPABASE_MAINTENANCE_DB_URL",
  "VITE_MAINTENANCE_CRON_SECRET",
  "VITE_SHARE_WORKER_CRON_SECRET",
  // Vite は VITE_ をブラウザへ公開し得るため、continuation 暗号鍵 alias も拒否する
  "VITE_AUTH_CONTINUATION_ENCRYPTION_KEY",
];

function requirePositiveIntegerString(env, key, exact) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") {
    throw new Error(key);
  }
  const text = String(raw);
  if (!/^[1-9][0-9]*$/u.test(text)) {
    throw new Error(`${key}_invalid`);
  }
  const value = Number(text);
  if (exact !== undefined && value !== exact) {
    throw new Error(`${key}_invalid`);
  }
  return value;
}

function decodeExact32Base64(value, key) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(key);
  }
  let decoded;
  try {
    decoded = Buffer.from(value, "base64");
  } catch {
    throw new Error(`${key}_invalid`);
  }
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
    throw new Error(`${key}_invalid`);
  }
  return decoded;
}

/**
 * 明示オブジェクトを検証する。process.env を継承しない。
 */
export function validateProductionEnv(env) {
  if (env === null || typeof env !== "object") {
    throw new Error("env_invalid");
  }

  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(env, key) || env[key] === undefined || env[key] === "") {
      throw new Error(key);
    }
  }

  // maintenance-cleanup アプリ層 secret: 16 文字未満は設定漏れとして拒否
  if (String(env.MAINTENANCE_CRON_SECRET).trim().length < 16) {
    throw new Error("MAINTENANCE_CRON_SECRET_invalid");
  }
  // share-generalize-worker アプリ層 secret: 同様に短すぎは拒否
  if (String(env.SHARE_WORKER_CRON_SECRET).trim().length < 16) {
    throw new Error("SHARE_WORKER_CRON_SECRET_invalid");
  }

  if (Object.hasOwn(env, "VITE_OAUTH_MOCK_ORIGIN")) {
    throw new Error("VITE_OAUTH_MOCK_ORIGIN");
  }
  if (Object.hasOwn(env, "KONDATE_MAINTENANCE_ENV")) {
    throw new Error("KONDATE_MAINTENANCE_ENV");
  }
  for (const key of FORBIDDEN_VITE_ALIASES) {
    if (Object.hasOwn(env, key)) {
      throw new Error(key);
    }
  }

  if (env.VITE_AUTH_PROVIDER_MODE !== "supabase") {
    throw new Error("VITE_AUTH_PROVIDER_MODE_invalid");
  }

  // 値そのものは比較し、失敗コードに origin を埋め込まない
  const browserUrl = String(env.VITE_SUPABASE_URL);
  const serverUrl = String(env.SUPABASE_URL);
  const browserRef = parseManagedSupabaseProjectRef(browserUrl);
  const serverRef = parseManagedSupabaseProjectRef(serverUrl);
  if (browserRef === null) throw new Error("VITE_SUPABASE_URL_invalid");
  if (serverRef === null) throw new Error("SUPABASE_URL_invalid");
  if (browserUrl !== `https://${browserRef}.supabase.co`) {
    throw new Error("VITE_SUPABASE_URL_invalid");
  }
  if (serverUrl !== `https://${serverRef}.supabase.co`) {
    throw new Error("SUPABASE_URL_invalid");
  }
  if (browserRef !== serverRef) {
    throw new Error("supabase_project_ref_mismatch");
  }
  if (String(env.SUPABASE_PUBLISHABLE_KEY) !== String(env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("supabase_publishable_key_mismatch");
  }

  // ロックされた整数
  requirePositiveIntegerString(env, "USER_DAILY_AI_LIMIT", 3);
  requirePositiveIntegerString(env, "USER_DAILY_EXTERNAL_CALL_LIMIT", 6);
  requirePositiveIntegerString(env, "USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT", 4);
  requirePositiveIntegerString(env, "USER_SHORT_WINDOW_SECONDS", 600);
  requirePositiveIntegerString(env, "AUTH_CONTINUATION_TTL_SECONDS", 300);
  requirePositiveIntegerString(env, "VITE_AUTH_CONTINUATION_TTL_MS", 300_000);
  // Netlify 同期 60s 硬上限に合わせたリリース固定（shared/contracts/function-budget.ts）
  requirePositiveIntegerString(env, "OPENROUTER_TIMEOUT_MS", 24_000);
  requirePositiveIntegerString(env, "FUNCTION_TOTAL_BUDGET_MS", 55_000);
  requirePositiveIntegerString(env, "AI_PROCESSING_STALE_SECONDS", 180);
  requirePositiveIntegerString(env, "VITE_MAGIC_LINK_RESEND_SECONDS");
  const globalLimit = requirePositiveIntegerString(env, "GLOBAL_DAILY_AI_LIMIT");
  // 製品 max のミラー: shared/contracts/plan-quota.ts の globalDailyAiLimitProductMax
  // SQL は範囲拒否しない。運用値は ENV のみで上げる。製品 max を超える運用は先に定数を上げる。
  const GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX = 500;
  if (globalLimit > GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX) {
    throw new Error("GLOBAL_DAILY_AI_LIMIT_invalid");
  }

  if (String(env.OPENROUTER_BASE_URL) !== "https://openrouter.ai/api/v1") {
    throw new Error("OPENROUTER_BASE_URL_invalid");
  }
  // 本番 preflight は常に公式 base（mock 例外は到達不能）
  parseOpenRouterModels(String(env.OPENROUTER_MODELS), {
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
  });

  decodeExact32Base64(
    String(env.AUTH_CONTINUATION_ENCRYPTION_KEY),
    "AUTH_CONTINUATION_ENCRYPTION_KEY",
  );

  const hmac = String(env.GENERATION_REQUEST_HMAC_KEY);
  if (hmac === sampleHmacPlaceholder) {
    throw new Error("GENERATION_REQUEST_HMAC_KEY_sample");
  }
  const hmacDecoded = decodeExact32Base64(hmac, "GENERATION_REQUEST_HMAC_KEY");

  const quotaIdentityHmac = String(env.QUOTA_IDENTITY_HMAC_KEY);
  if (quotaIdentityHmac === sampleHmacPlaceholder) {
    throw new Error("QUOTA_IDENTITY_HMAC_KEY_sample");
  }
  const quotaIdentityDecoded = decodeExact32Base64(quotaIdentityHmac, "QUOTA_IDENTITY_HMAC_KEY");
  // identity 日次枠と generation request integrity は別ドメイン。同一 32 バイト材料は拒否（S4）
  if (timingSafeEqual(hmacDecoded, quotaIdentityDecoded)) {
    throw new Error("hmac_keys_must_differ");
  }

  // 本番 SITE は HTTPS origin のみ
  let site;
  try {
    site = new URL(String(env.SERVER_SITE_ORIGIN));
  } catch {
    throw new Error("SERVER_SITE_ORIGIN_invalid");
  }
  if (
    site.protocol !== "https:" ||
    site.username ||
    site.password ||
    site.search ||
    site.hash ||
    (site.pathname !== "/" && site.pathname !== "") ||
    String(env.SERVER_SITE_ORIGIN) !== site.origin
  ) {
    throw new Error("SERVER_SITE_ORIGIN_invalid");
  }

  // 本番で個人枠無効は禁止（ローカル isLocal 専用）。true は fail-closed。
  const aiQuotaDisabled = env.AI_QUOTA_DISABLED;
  if (aiQuotaDisabled !== undefined && aiQuotaDisabled !== null && aiQuotaDisabled !== "") {
    if (String(aiQuotaDisabled) === "true") {
      throw new Error("AI_QUOTA_DISABLED_production");
    }
    if (String(aiQuotaDisabled) !== "false") {
      throw new Error("AI_QUOTA_DISABLED_invalid");
    }
  }

  parseProductionMaintenanceUrl(String(env.SUPABASE_MAINTENANCE_DB_URL), serverRef);

  // Billing / Stripe（BILLING_ENABLED 整合 + API version ピン）
  validateBillingStripeEnv(env);

  // production CSP の connect-src が browser managed origin と一致すること。
  // 不一致だと本番だけ API が CSP ブロックされるため、preflight で fail-closed する。
  // U5-M3: ビルド後に dist/_headers がある環境では成果物も照合する。
  const headersPath = join(process.cwd(), "dist", "_headers");
  validateProductionCsp(browserUrl, {
    headersPath: existsSync(headersPath) ? headersPath : undefined,
    fs: { existsSync, readFileSync },
  });

  return { projectRef: serverRef };
}

/**
 * BILLING_ENABLED と Stripe 鍵の整合を検証する。
 * - 未設定 / "false": 鍵は任意（Webhook 用に載せてもよいが、載せたなら完全一式 + API version ピン）
 * - "true": 全 Stripe 鍵必須 + STRIPE_API_VERSION=2026-06-24.dahlia
 * - VITE_STRIPE_* / VITE_BILLING_* は存在自体を拒否
 * - STRIPE_MOCK_BASE_URL は本番 preflight では拒否
 */
export function validateBillingStripeEnv(env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITE_STRIPE_") || key.startsWith("VITE_BILLING_")) {
      throw new Error(key);
    }
  }

  const rawBilling = env.BILLING_ENABLED;
  let billingEnabled = false;
  if (rawBilling !== undefined && rawBilling !== null && rawBilling !== "") {
    if (String(rawBilling) === "true") {
      billingEnabled = true;
    } else if (String(rawBilling) === "false") {
      billingEnabled = false;
    } else {
      throw new Error("BILLING_ENABLED_invalid");
    }
  }

  // env.ts の hasAnyStripeKey と同型: STRIPE_API_VERSION 単独は「鍵あり」とみなさない
  // （compose / .env.example のピンだけ置いた kill 中を壊れさせない）
  const stripeSecretKeys = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PLUS_MONTHLY",
    "STRIPE_PRICE_PLUS_YEARLY",
  ];
  const anyStripe = stripeSecretKeys.some(
    (key) => Object.hasOwn(env, key) && env[key] !== undefined && env[key] !== "",
  );
  const mockPresent =
    Object.hasOwn(env, "STRIPE_MOCK_BASE_URL") &&
    env.STRIPE_MOCK_BASE_URL !== undefined &&
    env.STRIPE_MOCK_BASE_URL !== null &&
    env.STRIPE_MOCK_BASE_URL !== "";

  // 本番 preflight では mock URL を拒否（ローカル only）
  if (mockPresent) {
    throw new Error("STRIPE_MOCK_BASE_URL");
  }

  // 鍵不要（kill かつ未設定）なら完了
  if (!billingEnabled && !anyStripe) {
    return;
  }

  // BILLING_ENABLED=true、または鍵を載せた kill 中は完全一式 + API version ピン
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PLUS_MONTHLY",
    "STRIPE_PRICE_PLUS_YEARLY",
  ]) {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(key);
    }
  }

  if (String(env.STRIPE_API_VERSION) !== "2026-06-24.dahlia") {
    throw new Error("STRIPE_API_VERSION_invalid");
  }

  // OPENROUTER_PLUS_MODELS: BILLING_ENABLED=true のとき 1 件以上（env.ts と同型）
  if (billingEnabled) {
    const plus = env.OPENROUTER_PLUS_MODELS;
    if (typeof plus !== "string" || plus.trim().length === 0) {
      throw new Error("OPENROUTER_PLUS_MODELS");
    }
    const models = plus.split(",").map((item) => item.trim());
    if (models.some((m) => m.length === 0) || models.length === 0) {
      throw new Error("OPENROUTER_PLUS_MODELS");
    }
  }
}

export function main(env = process.env, write = console.error) {
  try {
    validateProductionEnv(env);
    return 0;
  } catch (error) {
    const code = error instanceof Error ? error.message : "preflight_failed";
    write(`preflight: ${code}`);
    return 1;
  }
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  process.exitCode = main(process.env);
}
