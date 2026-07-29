import { Buffer } from "node:buffer";
import { z } from "zod";
import { releaseQuota } from "../../../shared/contracts/generation.js";
import { parseGenerationRequestHmacKey } from "./generation-command-integrity.js";

const localServerSupabaseUrl = "http://kong:8000";
const localBrowserSupabaseUrl = "http://127.0.0.1:8000";
const localSiteOrigin = "http://127.0.0.1:5173";
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;

const serverSupabaseUrlSchema = z.union([
  z.literal(localServerSupabaseUrl),
  z.string().regex(managedSupabaseOrigin),
]);
const encryptionKeySchema = z
  .string()
  .refine((value) => Buffer.from(value, "base64").byteLength === 32);

export const continuationServerEnvSchema = z.object({
  VITE_SUPABASE_URL: z.union([
    z.literal(localBrowserSupabaseUrl),
    z.string().regex(managedSupabaseOrigin),
  ]),
  SUPABASE_URL: serverSupabaseUrlSchema,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SERVER_SITE_ORIGIN: z.url(),
  AUTH_CONTINUATION_ENCRYPTION_KEY: encryptionKeySchema,
  AUTH_CONTINUATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .refine((value) => value === 300),
});

// リリース固定整数: 数値リテラルと十進文字列のみ受理し、未設定・近傍値・coerce を拒否する
const releaseLockedInteger = <const Value extends number, const Text extends string>(
  value: Value,
  text: Text,
) => z.union([z.literal(value), z.literal(text)]).transform(() => value);
const globalDailyLimit = (max: number) => z.coerce.number().int().min(1).max(max).default(max);

// GENERATION_REQUEST_HMAC_KEY / QUOTA_IDENTITY_HMAC_KEY 共通: canonical base64 of 32 bytes
const hmacKey32Schema = (envName: string) =>
  z
    .string()
    .min(1)
    .transform((value, context) => {
      try {
        return parseGenerationRequestHmacKey(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: `${envName} must be canonical base64 for exactly 32 bytes`,
        });
        return z.NEVER;
      }
    });

const generationRequestHmacKeySchema = hmacKey32Schema("GENERATION_REQUEST_HMAC_KEY");
const quotaIdentityHmacKeySchema = hmacKey32Schema("QUOTA_IDENTITY_HMAC_KEY");

const rawServerEnvSchema = continuationServerEnvSchema.extend({
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODELS: z.string(),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  GENERATION_REQUEST_HMAC_KEY: generationRequestHmacKeySchema,
  // identity 日次枠用。GENERATION_REQUEST_HMAC_KEY と共用しない
  QUOTA_IDENTITY_HMAC_KEY: quotaIdentityHmacKeySchema,
  USER_DAILY_AI_LIMIT: releaseLockedInteger(releaseQuota.userDailySuccessLimit, "3"),
  USER_DAILY_EXTERNAL_CALL_LIMIT: releaseLockedInteger(
    releaseQuota.userDailyExternalCallLimit,
    "6",
  ),
  USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: releaseLockedInteger(
    releaseQuota.userShortWindowExternalCallLimit,
    "4",
  ),
  USER_SHORT_WINDOW_SECONDS: releaseLockedInteger(releaseQuota.userShortWindowSeconds, "600"),
  // アプリ全体安全弁。製品 max は 200（本番運用既定は別途 80 推奨）。ローカル compose 既定 20 は維持可
  GLOBAL_DAILY_AI_LIMIT: globalDailyLimit(200),
  // 締切3値はリリース固定。未設定の silent default を禁止し、近傍値も拒否する
  // 60s/試行・150s/Function: 遅い有料モデル（luna 系等）が 20s 内に終わらないため延長
  OPENROUTER_TIMEOUT_MS: releaseLockedInteger(60_000, "60000"),
  FUNCTION_TOTAL_BUDGET_MS: releaseLockedInteger(150_000, "150000"),
  AI_PROCESSING_STALE_SECONDS: releaseLockedInteger(180, "180"),
});

type ParsedServerEnv = z.infer<typeof rawServerEnvSchema>;
export type ServerEnv = Omit<
  ParsedServerEnv,
  "GENERATION_REQUEST_HMAC_KEY" | "QUOTA_IDENTITY_HMAC_KEY"
> & {
  /** SERVER_SITE_ORIGIN がローカル canonical origin と一致するか */
  isLocal: boolean;
  /**
   * 個人枠（identity 日次・短時間）無効化。
   * true のときのみ isLocal かつ AI_QUOTA_DISABLED=true。本番でフラグ true は parse throw。
   */
  aiQuotaDisabled: boolean;
  supabase: {
    url: string;
    publishableKey: string;
    serviceRoleKey: string;
  };
  openRouter: {
    apiKey: string;
    baseUrl: string;
    models: readonly string[];
    userDailyLimit: typeof releaseQuota.userDailySuccessLimit;
    userDailyAttemptLimit: typeof releaseQuota.userDailyExternalCallLimit;
    userShortWindowLimit: typeof releaseQuota.userShortWindowExternalCallLimit;
    userShortWindowSeconds: typeof releaseQuota.userShortWindowSeconds;
    globalDailyLimit: number;
    timeoutMs: number;
    functionTotalBudgetMs: number;
    staleAfterSeconds: number;
  };
  generationIntegrity: {
    requestHmacKey: Uint8Array;
  };
  /** identity 日次枠 HMAC 鍵（メールは保存しない） */
  quotaIdentityHmacKey: Uint8Array;
  /**
   * Stripe 課金面の有効化。Task3 では未配線で常に false（枠は Free 強制）。
   * Task4 で BILLING_ENABLED と Stripe 鍵を結合する。
   */
  billingEnabled: boolean;
};

export function parseManagedSupabaseProjectRef(value: string): string | null {
  return managedSupabaseOrigin.exec(value)?.[1] ?? null;
}

/** parseOpenRouterModels が参照する base URL 文脈（mock 例外判定に必須） */
export type OpenRouterModelsParseContext = {
  openRouterBaseUrl: string;
};

/**
 * exact mock base URL 判定（openrouter.ts / verify-openrouter-models.mjs と規則同一の鏡像）。
 * mock 例外は OPENROUTER_BASE_URL の exact 一致のみ。isLocal は使わない。
 */
function isExactLocalMockBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "openrouter-mock" &&
      parsed.port === "8787" &&
      parsed.pathname === "/api/v1" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * OPENROUTER_MODELS の有料 allowlist / mock 例外規則。
 * 正本: scripts/openrouter-models-contract.mjs。
 * 鏡像: scripts/verify-openrouter-models.mjs の parseConfiguredModels、
 * scripts/preflight-production.mjs の parseOpenRouterModels。
 */
export function parseOpenRouterModels(
  value: string,
  context: OpenRouterModelsParseContext,
): readonly string[] {
  // 設計: カンマ区切り・前後 trim・空要素なし（filter(Boolean) で空を落とさない）
  const models = value.split(",").map((item) => item.trim());
  if (models.some((model) => model.length === 0)) {
    throw new Error("OPENROUTER_MODELS must not contain empty elements");
  }
  if (models.length === 0) throw new Error("OPENROUTER_MODELS must not be empty");
  if (new Set(models).size !== models.length) {
    throw new Error("OPENROUTER_MODELS must not contain duplicates");
  }
  const mockPath = isExactLocalMockBaseUrl(context.openRouterBaseUrl);
  const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
  for (const model of models) {
    if (routers.has(model)) {
      throw new Error(`OPENROUTER_MODELS rejects router model ID: ${model}`);
    }
    if (mockPath) {
      if (!model.startsWith("mock/") || !model.endsWith(":free")) {
        throw new Error(`OPENROUTER_MODELS mock path accepts only mock/*:free: ${model}`);
      }
    } else if (model.endsWith(":free") || model.startsWith("mock/")) {
      // 設計: exact mock 以外では mock/ も :free も拒否
      throw new Error(`OPENROUTER_MODELS rejects mock/ or :free model on non-mock base: ${model}`);
    }
  }
  return models;
}

const officialOpenRouterBaseUrl = "https://openrouter.ai/api/v1";

export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  if (source.VITE_AUTH_CONTINUATION_ENCRYPTION_KEY !== undefined) {
    throw new Error("server_configuration_invalid");
  }
  // ブラウザ向け alias は存在自体を拒否する（鍵をクライアントへ漏らさない）
  if (source.VITE_GENERATION_REQUEST_HMAC_KEY !== undefined) {
    throw new Error("server_configuration_invalid");
  }
  if (source.VITE_QUOTA_IDENTITY_HMAC_KEY !== undefined) {
    throw new Error("server_configuration_invalid");
  }
  if (source.VITE_AI_QUOTA_DISABLED !== undefined) {
    throw new Error("server_configuration_invalid");
  }
  // 未設定 / "false" / "true" のみ。1 や yes は設定ミスとして落とす。
  const rawQuotaDisabled = source.AI_QUOTA_DISABLED;
  let aiQuotaDisabledFlag = false;
  if (rawQuotaDisabled !== undefined && rawQuotaDisabled !== null && rawQuotaDisabled !== "") {
    if (rawQuotaDisabled === "true") {
      aiQuotaDisabledFlag = true;
    } else if (rawQuotaDisabled === "false") {
      aiQuotaDisabledFlag = false;
    } else {
      throw new Error("server_configuration_invalid");
    }
  }
  const result = rawServerEnvSchema.safeParse(source);
  if (!result.success) throw new Error("server_configuration_invalid");

  let site: URL;
  try {
    site = new URL(result.data.SERVER_SITE_ORIGIN);
  } catch {
    throw new Error("server_configuration_invalid");
  }
  if (site.origin !== result.data.SERVER_SITE_ORIGIN) {
    throw new Error("server_configuration_invalid");
  }
  const isLocal = site.origin === localSiteOrigin;
  // 本番で true は黙殺せず起動失敗（設計 Feature 4）
  if (aiQuotaDisabledFlag && !isLocal) {
    throw new Error("server_configuration_invalid");
  }
  const browserProjectRef = parseManagedSupabaseProjectRef(result.data.VITE_SUPABASE_URL);
  const serverProjectRef = parseManagedSupabaseProjectRef(result.data.SUPABASE_URL);
  if (
    (!isLocal && site.protocol !== "https:") ||
    (isLocal &&
      (result.data.VITE_SUPABASE_URL !== localBrowserSupabaseUrl ||
        result.data.SUPABASE_URL !== localServerSupabaseUrl))
  ) {
    throw new Error("server_configuration_invalid");
  }
  if (
    !isLocal &&
    (browserProjectRef === null ||
      serverProjectRef === null ||
      browserProjectRef !== serverProjectRef)
  ) {
    throw new Error("server_configuration_invalid");
  }
  // 本番（非ローカル）では公式 OpenRouter base URL のみ。lookalike・資格情報・query/fragment・HTTP・末尾パスを拒否する
  if (!isLocal && result.data.OPENROUTER_BASE_URL !== officialOpenRouterBaseUrl) {
    throw new Error("server_configuration_invalid");
  }
  const { GENERATION_REQUEST_HMAC_KEY, QUOTA_IDENTITY_HMAC_KEY, ...publicEnv } = result.data;
  return {
    ...publicEnv,
    isLocal,
    // 個人枠無効は isLocal ∧ AI_QUOTA_DISABLED=true のみ
    aiQuotaDisabled: aiQuotaDisabledFlag && isLocal,
    supabase: {
      url: result.data.SUPABASE_URL,
      publishableKey: result.data.SUPABASE_PUBLISHABLE_KEY,
      serviceRoleKey: result.data.SUPABASE_SERVICE_ROLE_KEY,
    },
    openRouter: {
      apiKey: result.data.OPENROUTER_API_KEY,
      baseUrl: result.data.OPENROUTER_BASE_URL.replace(/\/$/u, ""),
      models: parseOpenRouterModels(result.data.OPENROUTER_MODELS, {
        openRouterBaseUrl: result.data.OPENROUTER_BASE_URL,
      }),
      userDailyLimit: result.data.USER_DAILY_AI_LIMIT,
      userDailyAttemptLimit: result.data.USER_DAILY_EXTERNAL_CALL_LIMIT,
      userShortWindowLimit: result.data.USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT,
      userShortWindowSeconds: result.data.USER_SHORT_WINDOW_SECONDS,
      globalDailyLimit: result.data.GLOBAL_DAILY_AI_LIMIT,
      timeoutMs: result.data.OPENROUTER_TIMEOUT_MS,
      functionTotalBudgetMs: result.data.FUNCTION_TOTAL_BUDGET_MS,
      staleAfterSeconds: result.data.AI_PROCESSING_STALE_SECONDS,
    },
    generationIntegrity: {
      requestHmacKey: GENERATION_REQUEST_HMAC_KEY,
    },
    quotaIdentityHmacKey: QUOTA_IDENTITY_HMAC_KEY,
    // Task3: BILLING_ENABLED 未配線。常に false（Task4 で Stripe 鍵と結合）
    billingEnabled: false,
  };
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

export const supabaseServerEnvSchema = continuationServerEnvSchema.pick({
  SUPABASE_URL: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});

export type SupabaseServerEnv = z.infer<typeof supabaseServerEnvSchema>;

export function getSupabaseServerEnv(): SupabaseServerEnv {
  return supabaseServerEnvSchema.parse(getServerEnv());
}
