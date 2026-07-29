import { Buffer } from "node:buffer";
import { z } from "zod";
import { STRIPE_API_VERSION } from "../../../shared/contracts/billing.js";
import { releaseQuota } from "../../../shared/contracts/generation.js";
import { parseGenerationRequestHmacKey } from "./generation-command-integrity.js";

/** ローカル exact Stripe mock。isLocal 以外で設定されていたら throw。 */
const localStripeMockBaseUrl = "http://stripe-mock:8790";

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
  // 品質モード専用 allowlist。BILLING_ENABLED=false 時は空/未設定可
  OPENROUTER_PLUS_MODELS: z.string().optional(),
  // チラシ vision 専用（任意。未設定時は Plus list を流用 — Q1）
  OPENROUTER_FLYER_MODELS: z.string().optional(),
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
    /** 品質モード専用。BILLING_ENABLED=false 時は空配列可 */
    plusModels: readonly string[];
    /** チラシ vision 専用。未設定時は空（ランタイムは plusModels へフォールバック） */
    flyerModels: readonly string[];
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
   * Stripe 課金面の有効化（Checkout/Portal/品質・チラシ製品面）。
   * false でも Webhook は鍵があれば稼働継続し、枠は Free 強制（A3）。
   */
  billingEnabled: boolean;
  /**
   * Stripe 鍵一式。BILLING_ENABLED=true 時は必須。
   * false でも鍵があれば設定（Webhook 用 A3）。鍵なしは undefined。
   */
  stripe?: {
    secretKey: string;
    webhookSecret: string;
    pricePlusMonthly: string;
    pricePlusYearly: string;
    apiVersion: typeof STRIPE_API_VERSION;
    /** exact ローカル mock のみ。本番設定は parse throw。 */
    mockBaseUrl?: string;
  };
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

function parseBillingEnabledFlag(source: Record<string, unknown>): boolean {
  const raw = source.BILLING_ENABLED;
  if (raw === undefined || raw === null || raw === "") return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("server_configuration_invalid");
}

/** 空文字は「未設定」とみなす（compose の ${VAR:-} 空展開で kill 中が壊れないようにする）。 */
function isPresentEnvString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function hasAnyStripeKey(source: Record<string, unknown>): boolean {
  // STRIPE_API_VERSION 単独（compose 既定ピン）は「鍵あり」とみなさない。
  // secret / price / mock のいずれかが非空のときだけフル一式を要求する。
  return (
    isPresentEnvString(source.STRIPE_SECRET_KEY) ||
    isPresentEnvString(source.STRIPE_WEBHOOK_SECRET) ||
    isPresentEnvString(source.STRIPE_PRICE_PLUS_MONTHLY) ||
    isPresentEnvString(source.STRIPE_PRICE_PLUS_YEARLY) ||
    isPresentEnvString(source.STRIPE_MOCK_BASE_URL)
  );
}

/**
 * Stripe 鍵一式を閉じた形に正規化する。
 * BILLING_ENABLED=true 時は全必須。false でも鍵があれば Webhook 用に受理（A3）。
 */
function parseStripeConfig(
  source: Record<string, unknown>,
  options: { billingEnabled: boolean; isLocal: boolean },
): ServerEnv["stripe"] {
  const anyKey = hasAnyStripeKey(source);
  if (!options.billingEnabled && !anyKey) {
    return undefined;
  }

  const secretKey = source.STRIPE_SECRET_KEY;
  const webhookSecret = source.STRIPE_WEBHOOK_SECRET;
  const priceMonthly = source.STRIPE_PRICE_PLUS_MONTHLY;
  const priceYearly = source.STRIPE_PRICE_PLUS_YEARLY;
  const apiVersion = source.STRIPE_API_VERSION;
  const mockBaseUrl = source.STRIPE_MOCK_BASE_URL;

  // 鍵が不要（kill かつ未設定）なら stripe なし
  if (!options.billingEnabled && !anyKey) {
    return undefined;
  }

  // BILLING_ENABLED=true、または A3 で鍵を載せた kill 中は完全一式を要求
  if (typeof secretKey !== "string" || secretKey.length === 0) {
    throw new Error("server_configuration_invalid");
  }
  if (typeof webhookSecret !== "string" || webhookSecret.length === 0) {
    throw new Error("server_configuration_invalid");
  }
  if (typeof priceMonthly !== "string" || priceMonthly.length === 0) {
    throw new Error("server_configuration_invalid");
  }
  if (typeof priceYearly !== "string" || priceYearly.length === 0) {
    throw new Error("server_configuration_invalid");
  }

  // ADV-13: 鍵があるときは API version ピン必須（未設定・不一致は throw）
  if (apiVersion !== STRIPE_API_VERSION) {
    throw new Error("server_configuration_invalid");
  }

  let resolvedMock: string | undefined;
  if (mockBaseUrl !== undefined && mockBaseUrl !== null && mockBaseUrl !== "") {
    if (typeof mockBaseUrl !== "string") {
      throw new Error("server_configuration_invalid");
    }
    if (!options.isLocal) {
      throw new Error("server_configuration_invalid");
    }
    if (mockBaseUrl !== localStripeMockBaseUrl) {
      throw new Error("server_configuration_invalid");
    }
    resolvedMock = mockBaseUrl;
  }

  return {
    secretKey,
    webhookSecret,
    pricePlusMonthly: priceMonthly,
    pricePlusYearly: priceYearly,
    apiVersion: STRIPE_API_VERSION,
    ...(resolvedMock === undefined ? {} : { mockBaseUrl: resolvedMock }),
  };
}

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
  // Stripe / Billing の VITE_ は存在自体を拒否
  for (const key of Object.keys(source)) {
    if (key.startsWith("VITE_STRIPE_") || key.startsWith("VITE_BILLING_")) {
      throw new Error("server_configuration_invalid");
    }
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
  const billingEnabled = parseBillingEnabledFlag(source);
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
  const stripe = parseStripeConfig(source, { billingEnabled, isLocal });
  const openRouterBaseUrl = result.data.OPENROUTER_BASE_URL;
  const models = parseOpenRouterModels(result.data.OPENROUTER_MODELS, {
    openRouterBaseUrl,
  });
  // 品質リスト: 未設定/空は billing 無効時のみ許可。有効時は同一ゲートで 1 件以上必須
  const rawPlus = result.data.OPENROUTER_PLUS_MODELS;
  let plusModels: readonly string[] = [];
  if (rawPlus !== undefined && rawPlus.trim().length > 0) {
    try {
      plusModels = parseOpenRouterModels(rawPlus, { openRouterBaseUrl });
    } catch (error: unknown) {
      // エラー文言を PLUS 側と分かるようにする
      const message = error instanceof Error ? error.message : "invalid";
      throw new Error(message.replaceAll("OPENROUTER_MODELS", "OPENROUTER_PLUS_MODELS"));
    }
  }
  if (billingEnabled && plusModels.length === 0) {
    throw new Error(
      "OPENROUTER_PLUS_MODELS must contain at least one model when BILLING_ENABLED=true",
    );
  }
  const rawFlyer = result.data.OPENROUTER_FLYER_MODELS;
  let flyerModels: readonly string[] = [];
  if (rawFlyer !== undefined && rawFlyer.trim().length > 0) {
    try {
      flyerModels = parseOpenRouterModels(rawFlyer, { openRouterBaseUrl });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "invalid";
      throw new Error(message.replaceAll("OPENROUTER_MODELS", "OPENROUTER_FLYER_MODELS"));
    }
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
      baseUrl: openRouterBaseUrl.replace(/\/$/u, ""),
      models,
      plusModels,
      flyerModels,
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
    billingEnabled,
    ...(stripe === undefined ? {} : { stripe }),
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
