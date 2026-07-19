import { Buffer } from "node:buffer";
import { z } from "zod";
import { releaseQuota } from "../../../shared/contracts/generation.js";

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

const positiveInteger = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const releaseLockedInteger = <const Value extends number, const Text extends string>(
  value: Value,
  text: Text,
) => z.union([z.literal(value), z.literal(text)]).transform(() => value);
const globalDailyLimit = (max: number) => z.coerce.number().int().min(1).max(max).default(max);

const rawServerEnvSchema = continuationServerEnvSchema.extend({
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODELS: z.string(),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  USER_DAILY_AI_LIMIT: releaseLockedInteger(releaseQuota.userDailySuccessLimit, "5"),
  USER_DAILY_EXTERNAL_CALL_LIMIT: releaseLockedInteger(
    releaseQuota.userDailyExternalCallLimit,
    "12",
  ),
  USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: releaseLockedInteger(
    releaseQuota.userShortWindowExternalCallLimit,
    "4",
  ),
  USER_SHORT_WINDOW_SECONDS: releaseLockedInteger(releaseQuota.userShortWindowSeconds, "600"),
  GLOBAL_DAILY_AI_LIMIT: globalDailyLimit(45),
  OPENROUTER_TIMEOUT_MS: positiveInteger(20_000),
  FUNCTION_TOTAL_BUDGET_MS: positiveInteger(50_000),
  AI_PROCESSING_STALE_SECONDS: positiveInteger(180),
});

type ParsedServerEnv = z.infer<typeof rawServerEnvSchema>;
export type ServerEnv = ParsedServerEnv & {
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
};

export function parseManagedSupabaseProjectRef(value: string): string | null {
  return managedSupabaseOrigin.exec(value)?.[1] ?? null;
}

export function parseOpenRouterModels(value: string): readonly string[] {
  const models = value
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

export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  if (source.VITE_AUTH_CONTINUATION_ENCRYPTION_KEY !== undefined) {
    throw new Error("server_configuration_invalid");
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
  return {
    ...result.data,
    supabase: {
      url: result.data.SUPABASE_URL,
      publishableKey: result.data.SUPABASE_PUBLISHABLE_KEY,
      serviceRoleKey: result.data.SUPABASE_SERVICE_ROLE_KEY,
    },
    openRouter: {
      apiKey: result.data.OPENROUTER_API_KEY,
      baseUrl: result.data.OPENROUTER_BASE_URL.replace(/\/$/u, ""),
      models: parseOpenRouterModels(result.data.OPENROUTER_MODELS),
      userDailyLimit: result.data.USER_DAILY_AI_LIMIT,
      userDailyAttemptLimit: result.data.USER_DAILY_EXTERNAL_CALL_LIMIT,
      userShortWindowLimit: result.data.USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT,
      userShortWindowSeconds: result.data.USER_SHORT_WINDOW_SECONDS,
      globalDailyLimit: result.data.GLOBAL_DAILY_AI_LIMIT,
      timeoutMs: result.data.OPENROUTER_TIMEOUT_MS,
      functionTotalBudgetMs: result.data.FUNCTION_TOTAL_BUDGET_MS,
      staleAfterSeconds: result.data.AI_PROCESSING_STALE_SECONDS,
    },
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
