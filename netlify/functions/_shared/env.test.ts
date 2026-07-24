import { describe, expect, it } from "vitest";
import {
  acceptedFreeModelLists,
  rejectedFreeModelLists,
} from "../../../scripts/openrouter-models-contract.mjs";
import { releaseQuota } from "../../../shared/contracts/generation.js";
import {
  parseManagedSupabaseProjectRef,
  parseOpenRouterModels,
  parseServerEnv,
  supabaseServerEnvSchema,
} from "./env.js";

const validServerEnv = {
  VITE_SUPABASE_URL: "http://127.0.0.1:8000",
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
  SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
  AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_CONTINUATION_TTL_SECONDS: "300",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  OPENROUTER_API_KEY: "mock-key",
  OPENROUTER_MODELS: "google/gemma-3-27b-it:free,mistralai/mistral-small-3.2-24b-instruct:free",
  GENERATION_REQUEST_HMAC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  USER_DAILY_AI_LIMIT: "5",
  USER_DAILY_EXTERNAL_CALL_LIMIT: "12",
  USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4",
  USER_SHORT_WINDOW_SECONDS: "600",
  OPENROUTER_TIMEOUT_MS: "20000",
  FUNCTION_TOTAL_BUDGET_MS: "50000",
  AI_PROCESSING_STALE_SECONDS: "180",
};

describe("parseOpenRouterModels", () => {
  it.each(acceptedFreeModelLists)("accepts contract free-model list %#", ({ raw, models }) => {
    expect(parseOpenRouterModels(raw)).toEqual(models);
  });

  it.each(rejectedFreeModelLists)("rejects unsafe model configuration %s", (value) => {
    expect(() => parseOpenRouterModels(value)).toThrow("OPENROUTER_MODELS");
  });

  it("requires the exact release-locked quota tuple", () => {
    const parsed = parseServerEnv(validServerEnv);
    expect(parsed.AUTH_CONTINUATION_TTL_SECONDS).toBe(300);
    expect(parsed.SERVER_SITE_ORIGIN).toBe("http://127.0.0.1:5173");
    expect(parsed.openRouter).toMatchObject({
      userDailyLimit: releaseQuota.userDailySuccessLimit,
      userDailyAttemptLimit: releaseQuota.userDailyExternalCallLimit,
      userShortWindowLimit: releaseQuota.userShortWindowExternalCallLimit,
      userShortWindowSeconds: releaseQuota.userShortWindowSeconds,
      globalDailyLimit: 45,
      timeoutMs: 20_000,
      functionTotalBudgetMs: 50_000,
      staleAfterSeconds: 180,
    });
    expect(parsed.generationIntegrity.requestHmacKey).toEqual(
      Buffer.from(validServerEnv.GENERATION_REQUEST_HMAC_KEY, "base64"),
    );
  });

  it.each([
    ["USER_DAILY_AI_LIMIT", undefined],
    ["USER_DAILY_AI_LIMIT", "6"],
    ["USER_DAILY_AI_LIMIT", "05"],
    ["USER_DAILY_EXTERNAL_CALL_LIMIT", undefined],
    ["USER_DAILY_EXTERNAL_CALL_LIMIT", "13"],
    ["USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT", undefined],
    ["USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT", "5"],
    ["USER_SHORT_WINDOW_SECONDS", undefined],
    ["USER_SHORT_WINDOW_SECONDS", "601"],
  ] as const)("rejects missing or changed release quota %s=%s", (key, value) => {
    expect(() => parseServerEnv({ ...validServerEnv, [key]: value })).toThrow();
  });

  it.each([
    ["missing", undefined],
    ["non-canonical base64", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["31-byte key", Buffer.alloc(31, 1).toString("base64")],
    ["33-byte key", Buffer.alloc(33, 1).toString("base64")],
  ] as const)("rejects an invalid GENERATION_REQUEST_HMAC_KEY (%s)", (_label, value) => {
    expect(() => parseServerEnv({ ...validServerEnv, GENERATION_REQUEST_HMAC_KEY: value })).toThrow(
      "server_configuration_invalid",
    );
  });

  it("rejects a browser-prefixed generation HMAC key alias", () => {
    expect(() =>
      parseServerEnv({
        ...validServerEnv,
        VITE_GENERATION_REQUEST_HMAC_KEY: validServerEnv.GENERATION_REQUEST_HMAC_KEY,
      }),
    ).toThrow("server_configuration_invalid");
  });

  it.each(["0", "46"])("rejects out-of-range global quota %s", (value) => {
    expect(() => parseServerEnv({ ...validServerEnv, GLOBAL_DAILY_AI_LIMIT: value })).toThrow();
  });

  it("allows the operator to lower the global quota", () => {
    expect(
      parseServerEnv({ ...validServerEnv, GLOBAL_DAILY_AI_LIMIT: "1" }).openRouter.globalDailyLimit,
    ).toBe(1);
  });

  it.each([
    ["OPENROUTER_TIMEOUT_MS", 20_000, "timeoutMs", 20_000],
    ["OPENROUTER_TIMEOUT_MS", "20000", "timeoutMs", 20_000],
    ["FUNCTION_TOTAL_BUDGET_MS", 50_000, "functionTotalBudgetMs", 50_000],
    ["FUNCTION_TOTAL_BUDGET_MS", "50000", "functionTotalBudgetMs", 50_000],
    ["AI_PROCESSING_STALE_SECONDS", 180, "staleAfterSeconds", 180],
    ["AI_PROCESSING_STALE_SECONDS", "180", "staleAfterSeconds", 180],
  ] as const)("accepts exact deadline lock %s=%s", (key, value, openRouterKey, expected) => {
    const parsed = parseServerEnv({ ...validServerEnv, [key]: value });
    expect(parsed.openRouter[openRouterKey]).toBe(expected);
  });

  it.each([
    ["OPENROUTER_TIMEOUT_MS", undefined],
    ["OPENROUTER_TIMEOUT_MS", "19999"],
    ["OPENROUTER_TIMEOUT_MS", "20001"],
    ["OPENROUTER_TIMEOUT_MS", "0"],
    ["OPENROUTER_TIMEOUT_MS", "-1"],
    ["OPENROUTER_TIMEOUT_MS", "20000.5"],
    ["OPENROUTER_TIMEOUT_MS", ""],
    ["OPENROUTER_TIMEOUT_MS", "020000"],
    ["FUNCTION_TOTAL_BUDGET_MS", undefined],
    ["FUNCTION_TOTAL_BUDGET_MS", "30000"],
    ["FUNCTION_TOTAL_BUDGET_MS", "49999"],
    ["FUNCTION_TOTAL_BUDGET_MS", "50001"],
    ["FUNCTION_TOTAL_BUDGET_MS", "0"],
    ["FUNCTION_TOTAL_BUDGET_MS", "-1"],
    ["FUNCTION_TOTAL_BUDGET_MS", "50000.1"],
    ["FUNCTION_TOTAL_BUDGET_MS", ""],
    ["AI_PROCESSING_STALE_SECONDS", undefined],
    ["AI_PROCESSING_STALE_SECONDS", "179"],
    ["AI_PROCESSING_STALE_SECONDS", "181"],
    ["AI_PROCESSING_STALE_SECONDS", "0"],
    ["AI_PROCESSING_STALE_SECONDS", "-1"],
    ["AI_PROCESSING_STALE_SECONDS", "180.5"],
    ["AI_PROCESSING_STALE_SECONDS", ""],
  ] as const)("rejects missing or drifted deadline lock %s=%s", (key, value) => {
    expect(() => parseServerEnv({ ...validServerEnv, [key]: value })).toThrow(
      "server_configuration_invalid",
    );
  });
});

it("parses the exact five-minute server continuation TTL in seconds", () => {
  expect(parseServerEnv(validServerEnv).AUTH_CONTINUATION_TTL_SECONDS).toBe(300);
});

it("projects only the Supabase server credentials for authenticated functions", () => {
  expect(supabaseServerEnvSchema.parse(validServerEnv)).toEqual({
    SUPABASE_URL: validServerEnv.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: validServerEnv.SUPABASE_SERVICE_ROLE_KEY,
  });
  expect(parseServerEnv(validServerEnv)).toMatchObject({
    SERVER_SITE_ORIGIN: validServerEnv.SERVER_SITE_ORIGIN,
    AUTH_CONTINUATION_TTL_SECONDS: 300,
  });
});

it("accepts only an exact managed Supabase origin for an HTTPS deployment", () => {
  const production = {
    ...validServerEnv,
    VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SERVER_SITE_ORIGIN: "https://kondate.example",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  };
  expect(parseServerEnv(production).SUPABASE_URL).toBe(production.SUPABASE_URL);
  expect(parseManagedSupabaseProjectRef(production.SUPABASE_URL)).toBe("abcdefghijklmnopqrst");
  for (const unsafeUrl of [
    "https://collector.example",
    "https://short.supabase.co",
    "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.example",
    "https://abcdefghijklmnopqrst.supabase.co:443",
    "https://abcdefghijklmnopqrst.supabase.co/",
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
    "https://abcdefghijklmnopqrst.supabase.co?redirect=evil",
    "https://abcdefghijklmnopqrst.supabase.co#fragment",
    "https://user@abcdefghijklmnopqrst.supabase.co",
  ]) {
    expect(() => parseServerEnv({ ...production, SUPABASE_URL: unsafeUrl })).toThrow(
      "server_configuration_invalid",
    );
  }
});

it("accepts only the exact official OpenRouter base URL for an HTTPS deployment", () => {
  const production = {
    ...validServerEnv,
    VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SERVER_SITE_ORIGIN: "https://kondate.example",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  };
  expect(parseServerEnv(production).openRouter.baseUrl).toBe("https://openrouter.ai/api/v1");
  for (const unsafeUrl of [
    "http://openrouter.ai/api/v1",
    "https://openrouter.ai/api/v1/",
    "https://openrouter.ai/api/v1/models",
    "https://user:pass@openrouter.ai/api/v1",
    "https://openrouter.ai/api/v1?x=1",
    "https://openrouter.ai/api/v1#frag",
    "https://evil.openrouter.ai/api/v1",
    "https://openrouter.ai.evil.example/api/v1",
    "https://openrouter.example/api/v1",
  ]) {
    expect(() => parseServerEnv({ ...production, OPENROUTER_BASE_URL: unsafeUrl })).toThrow(
      "server_configuration_invalid",
    );
  }
});

it("rejects different browser and server Supabase projects for an HTTPS deployment", () => {
  expect(() =>
    parseServerEnv({
      ...validServerEnv,
      VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      SUPABASE_URL: "https://bcdefghijklmnopqrstu.supabase.co",
      SERVER_SITE_ORIGIN: "https://kondate.example",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    }),
  ).toThrow("server_configuration_invalid");
});

it("rejects a non-canonical browser Supabase URL for local development", () => {
  expect(() =>
    parseServerEnv({
      ...validServerEnv,
      VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    }),
  ).toThrow("server_configuration_invalid");
});

it.each(["299", "300000"])("rejects a wrong server TTL unit/value: %s", (value) => {
  expect(() =>
    parseServerEnv({ ...validServerEnv, AUTH_CONTINUATION_TTL_SECONDS: value }),
  ).toThrow();
});

it("does not accept the browser millisecond key in place of the server key", () => {
  expect(() =>
    parseServerEnv({
      SUPABASE_URL: validServerEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: validServerEnv.SUPABASE_SERVICE_ROLE_KEY,
      SERVER_SITE_ORIGIN: validServerEnv.SERVER_SITE_ORIGIN,
      AUTH_CONTINUATION_ENCRYPTION_KEY: validServerEnv.AUTH_CONTINUATION_ENCRYPTION_KEY,
      VITE_AUTH_CONTINUATION_TTL_MS: "300000",
    }),
  ).toThrow();
});
