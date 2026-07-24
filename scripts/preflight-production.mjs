/**
 * 本番デプロイ前の閉じた環境検証。ネットワーク呼び出しなし。
 * 失敗時は変数名または閉じたコードのみを stderr へ出し、
 * URL 成分・project ref・秘密値は出さない。
 */
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

// TS の parseOpenRouterModels / parseManagedSupabaseProjectRef と
// maintenance-env はビルド成果ではなくソースを Node から直接は import できない。
// 鏡像実装をここに置き、ユニットテストで契約を固定する。
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;
const sampleHmacPlaceholder = "generated-32-byte-base64-secret";

export function parseManagedSupabaseProjectRef(value) {
  return managedSupabaseOrigin.exec(value)?.[1] ?? null;
}

export function parseOpenRouterModels(value) {
  const models = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (models.length === 0) throw new Error("OPENROUTER_MODELS must not be empty");
  if (new Set(models).size !== models.length) {
    throw new Error("OPENROUTER_MODELS must not contain duplicates");
  }
  for (const model of models) {
    if (model === "openrouter/auto" || !model.endsWith(":free")) {
      throw new Error(`OPENROUTER_MODELS contains a non-free model: ${model}`);
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
  "SERVER_SITE_ORIGIN",
  "AUTH_CONTINUATION_ENCRYPTION_KEY",
  "GENERATION_REQUEST_HMAC_KEY",
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
  "VITE_SUPABASE_MAINTENANCE_DB_URL",
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
  requirePositiveIntegerString(env, "USER_DAILY_AI_LIMIT", 5);
  requirePositiveIntegerString(env, "USER_DAILY_EXTERNAL_CALL_LIMIT", 12);
  requirePositiveIntegerString(env, "USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT", 4);
  requirePositiveIntegerString(env, "USER_SHORT_WINDOW_SECONDS", 600);
  requirePositiveIntegerString(env, "AUTH_CONTINUATION_TTL_SECONDS", 300);
  requirePositiveIntegerString(env, "VITE_AUTH_CONTINUATION_TTL_MS", 300_000);
  requirePositiveIntegerString(env, "OPENROUTER_TIMEOUT_MS", 20_000);
  requirePositiveIntegerString(env, "FUNCTION_TOTAL_BUDGET_MS", 50_000);
  requirePositiveIntegerString(env, "AI_PROCESSING_STALE_SECONDS", 180);
  requirePositiveIntegerString(env, "VITE_MAGIC_LINK_RESEND_SECONDS");
  const globalLimit = requirePositiveIntegerString(env, "GLOBAL_DAILY_AI_LIMIT");
  if (globalLimit > 45) throw new Error("GLOBAL_DAILY_AI_LIMIT_invalid");

  if (String(env.OPENROUTER_BASE_URL) !== "https://openrouter.ai/api/v1") {
    throw new Error("OPENROUTER_BASE_URL_invalid");
  }
  parseOpenRouterModels(String(env.OPENROUTER_MODELS));

  decodeExact32Base64(
    String(env.AUTH_CONTINUATION_ENCRYPTION_KEY),
    "AUTH_CONTINUATION_ENCRYPTION_KEY",
  );

  const hmac = String(env.GENERATION_REQUEST_HMAC_KEY);
  if (hmac === sampleHmacPlaceholder) {
    throw new Error("GENERATION_REQUEST_HMAC_KEY_sample");
  }
  decodeExact32Base64(hmac, "GENERATION_REQUEST_HMAC_KEY");

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

  parseProductionMaintenanceUrl(String(env.SUPABASE_MAINTENANCE_DB_URL), serverRef);

  return { projectRef: serverRef };
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
