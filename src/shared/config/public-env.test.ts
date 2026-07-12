import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./public-env";

describe("parsePublicEnv", () => {
  it("normalizes valid browser-only settings", () => {
    expect(
      parsePublicEnv({
        VITE_SUPABASE_URL: "http://127.0.0.1:8000",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
        VITE_MAGIC_LINK_RESEND_SECONDS: "60",
        VITE_AUTH_CONTINUATION_TTL_MS: "300000",
        VITE_AUTH_PROVIDER_MODE: "oauth_mock",
        VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788",
      }),
    ).toEqual({
      supabaseUrl: "http://127.0.0.1:8000",
      supabasePublishableKey: "public-key",
      magicLinkResendSeconds: 60,
      authContinuationTtlMs: 300_000,
      authProviderMode: "oauth_mock",
      oauthMockOrigin: "http://127.0.0.1:8788",
    });
  });

  it("rejects a missing publishable key without echoing its value", () => {
    expect(() =>
      parsePublicEnv({
        VITE_SUPABASE_URL: "http://127.0.0.1:8000",
        VITE_MAGIC_LINK_RESEND_SECONDS: "60",
        VITE_AUTH_CONTINUATION_TTL_MS: "300000",
        VITE_AUTH_PROVIDER_MODE: "oauth_mock",
        VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788",
      }),
    ).toThrow("公開設定を読み込めません");
  });

  it("accepts real Supabase Google only in production and rejects every mock value", () => {
    const base = {
      VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
      VITE_MAGIC_LINK_RESEND_SECONDS: "60",
      VITE_AUTH_CONTINUATION_TTL_MS: "300000",
    };
    expect(
      parsePublicEnv({ ...base, VITE_AUTH_PROVIDER_MODE: "supabase" }, { production: true }),
    ).toMatchObject({
      authProviderMode: "supabase",
      oauthMockOrigin: null,
      authContinuationTtlMs: 300_000,
    });
    expect(() =>
      parsePublicEnv(
        {
          ...base,
          VITE_AUTH_PROVIDER_MODE: "oauth_mock",
          VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788",
        },
        { production: true },
      ),
    ).toThrow();
    expect(() =>
      parsePublicEnv(
        {
          ...base,
          VITE_AUTH_PROVIDER_MODE: "supabase",
          VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788",
        },
        { production: true },
      ),
    ).toThrow();
    expect(() =>
      parsePublicEnv(
        {
          ...base,
          VITE_SUPABASE_URL: "http://127.0.0.1:8000",
          VITE_AUTH_PROVIDER_MODE: "supabase",
        },
        { production: true },
      ),
    ).toThrow();
    for (const unsafeUrl of [
      "https://collector.example",
      "https://short.supabase.co",
      "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co.evil.example",
      "https://user@abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co:443",
      "https://abcdefghijklmnopqrst.supabase.co/",
      "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
      "https://abcdefghijklmnopqrst.supabase.co?redirect=evil",
      "https://abcdefghijklmnopqrst.supabase.co#fragment",
    ]) {
      expect(() =>
        parsePublicEnv(
          { ...base, VITE_SUPABASE_URL: unsafeUrl, VITE_AUTH_PROVIDER_MODE: "supabase" },
          { production: true },
        ),
      ).toThrow("公開設定を読み込めません");
    }
  });
});
