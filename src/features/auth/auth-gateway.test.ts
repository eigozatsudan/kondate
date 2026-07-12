import type { AuthError } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import { createAuthGateway } from "./auth-gateway";
import type { ContinuationApi } from "./auth-flow";

class MapStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}

function continuationApiMock(): ContinuationApi {
  return {
    create: () =>
      Promise.resolve({
        id: "10000000-0000-4000-8000-000000000001",
        expiresAt: "2026-07-11T00:05:00Z",
      }),
    deposit: () => Promise.resolve(),
    claim: () => Promise.reject(new Error("not deposited")),
  };
}

function authClientMock(overrides?: { oauthResult?: { data: unknown; error: AuthError | null } }) {
  const oauthResult = overrides?.oauthResult ?? { data: null, error: null };
  return {
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue(oauthResult),
    },
  };
}

it("uses the local Compose provider only in oauth_mock mode", async () => {
  const navigate = vi.fn();
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    continuationApiMock(),
    new MapStorage(),
    {
      getPublicEnv: () => ({
        authProviderMode: "oauth_mock",
        oauthMockOrigin: "http://127.0.0.1:8788",
      }),
      fetchImpl: vi.fn(),
      appOrigin: "http://127.0.0.1:5173",
      navigate,
    },
  );
  await gateway.signInWithGoogle("/onboarding");
  const target = new URL(String(navigate.mock.calls[0]?.[0]));
  expect(target.origin + target.pathname).toBe("http://127.0.0.1:8788/authorize");
  expect(target.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5173/auth/callback");
  expect(target.searchParams.get("flow")).toMatch(/^[0-9a-f-]{36}$/u);
  expect(target.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
});

it("uses Supabase Google and never the mock URL in production mode", async () => {
  const fetchImpl = vi.fn();
  const client = authClientMock({ oauthResult: { data: {}, error: null } });
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    continuationApiMock(),
    new MapStorage(),
    {
      getPublicEnv: () => ({ authProviderMode: "supabase", oauthMockOrigin: null }),
      fetchImpl,
      appOrigin: "http://127.0.0.1:5173",
      navigate: vi.fn(),
    },
  );
  await gateway.signInWithGoogle("/planner");
  expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: "google",
    options: {
      redirectTo: expect.stringMatching(/^http:\/\/127\.0\.0\.1:5173\/auth\/callback\?/u) as string,
    },
  });
  expect(fetchImpl).not.toHaveBeenCalled();
});
