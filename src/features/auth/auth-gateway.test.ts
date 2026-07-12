import type { AuthError } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import { createAuthGateway, type AuthGatewayDeps } from "./auth-gateway";
import { createAuthFlow, readAuthFlow, type ContinuationApi } from "./auth-flow";

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

function continuationApiMock(overrides?: {
  deposit?: ContinuationApi["deposit"];
  claim?: ContinuationApi["claim"];
}): ContinuationApi {
  return {
    create: () =>
      Promise.resolve({
        id: "10000000-0000-4000-8000-000000000001",
        expiresAt: "2026-07-11T00:05:00Z",
      }),
    deposit: overrides?.deposit ?? (() => Promise.resolve()),
    claim: overrides?.claim ?? (() => Promise.reject(new Error("not deposited"))),
  };
}

function authClientMock(overrides?: {
  oauthResult?: { data: unknown; error: AuthError | null };
  exchangeResult?: { data: unknown; error: AuthError | null };
  signInWithPasswordResult?: { data: unknown; error: AuthError | null };
}) {
  const oauthResult = overrides?.oauthResult ?? { data: null, error: null };
  const exchangeResult = overrides?.exchangeResult ?? { data: null, error: null };
  const signInWithPasswordResult = overrides?.signInWithPasswordResult ?? {
    data: null,
    error: null,
  };
  return {
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue(oauthResult),
      exchangeCodeForSession: vi.fn().mockResolvedValue(exchangeResult),
      signInWithPassword: vi.fn().mockResolvedValue(signInWithPasswordResult),
    },
  };
}

function gatewayDeps(overrides?: Partial<AuthGatewayDeps>): AuthGatewayDeps {
  return {
    getPublicEnv: () => ({ authProviderMode: "supabase", oauthMockOrigin: null }),
    fetchImpl: vi.fn(),
    appOrigin: "http://127.0.0.1:5173",
    navigate: vi.fn(),
    ...overrides,
  };
}

const fixedFlowDeps = {
  randomBytes: () => new Uint8Array(32).fill(7),
  now: () => new Date("2026-07-11T00:00:00Z"),
};

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

it("rejects a callback URL carrying a hash fragment without exchanging it", async () => {
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    continuationApiMock(),
    new MapStorage(),
    gatewayDeps(),
  );
  const result = await gateway.completeCallback(
    new URL(
      "http://127.0.0.1:5173/auth/callback?flow=flow-1&state=state-1&code=code-1#access_token=x",
    ),
  );
  expect(result).toEqual({ kind: "error", code: "unbound_callback", returnTo: "/planner" });
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
});

it("maps a provider error=access_denied to oauth_cancelled", async () => {
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    continuationApiMock(),
    new MapStorage(),
    gatewayDeps(),
  );
  const result = await gateway.completeCallback(
    new URL("http://127.0.0.1:5173/auth/callback?flow=flow-1&error=access_denied"),
  );
  expect(result).toEqual({ kind: "error", code: "oauth_cancelled", returnTo: "/planner" });
});

it("maps any other provider error to auth_callback_failed", async () => {
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    continuationApiMock(),
    new MapStorage(),
    gatewayDeps(),
  );
  const result = await gateway.completeCallback(
    new URL("http://127.0.0.1:5173/auth/callback?flow=flow-1&error=server_error"),
  );
  expect(result).toEqual({ kind: "error", code: "auth_callback_failed", returnTo: "/planner" });
});

it("deposits for the original browser when this context never held the flow", async () => {
  const client = authClientMock();
  const deposit = vi.fn().mockResolvedValue(undefined);
  const claim = vi.fn().mockRejectedValue(new Error("not deposited"));
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    continuationApiMock({ deposit, claim }),
    new MapStorage(),
    gatewayDeps(),
  );
  const result = await gateway.completeCallback(
    new URL("http://127.0.0.1:5173/auth/callback?flow=isolated-flow-1&state=state-1&code=code-1"),
  );
  expect(result).toEqual({
    kind: "deposited",
    continuation: "original_browser",
    flowId: "isolated-flow-1",
    returnTo: "/planner",
  });
  expect(deposit).toHaveBeenCalledWith("isolated-flow-1", { state: "state-1", code: "code-1" });
  expect(claim).not.toHaveBeenCalled();
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
});

it("completes in the original browser once claim and code exchange succeed", async () => {
  const storage = new MapStorage();
  const deposit = vi.fn().mockResolvedValue(undefined);
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ deposit, claim });
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

  const result = await gateway.completeCallback(
    new URL(`http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`),
  );

  expect(result).toEqual({
    kind: "complete",
    continuation: "same_browser",
    returnTo: "/onboarding",
    flowId: flow.id,
  });
  expect(claim).toHaveBeenCalledWith(flow.id, { secret: flow.secret, state: flow.state });
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-1");
  expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});
