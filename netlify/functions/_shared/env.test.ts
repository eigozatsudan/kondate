import { expect, it } from "vitest";
import { parseManagedSupabaseProjectRef, parseServerEnv } from "./env.js";

const validServerEnv = {
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
  SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
  AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_CONTINUATION_TTL_SECONDS: "300",
};

it("parses the exact five-minute server continuation TTL in seconds", () => {
  expect(parseServerEnv(validServerEnv).AUTH_CONTINUATION_TTL_SECONDS).toBe(300);
});

it("accepts only an exact managed Supabase origin for an HTTPS deployment", () => {
  const production = {
    ...validServerEnv,
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SERVER_SITE_ORIGIN: "https://kondate.example",
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
