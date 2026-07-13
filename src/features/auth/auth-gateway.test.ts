import type { AuthError } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import { createAuthGateway, type AuthGatewayDeps } from "./auth-gateway";
import {
  createAuthFlow,
  markAuthContinuationCallbackOwner,
  readAuthFlow,
  type ContinuationApi,
} from "./auth-flow";

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
  create?: ContinuationApi["create"];
  deposit?: ContinuationApi["deposit"];
  claim?: ContinuationApi["claim"];
}): ContinuationApi {
  return {
    create:
      overrides?.create ??
      (() =>
        Promise.resolve({
          id: "10000000-0000-4000-8000-000000000001",
          expiresAt: "2026-07-11T00:05:00Z",
        })),
    deposit: overrides?.deposit ?? (() => Promise.resolve()),
    claim: overrides?.claim ?? (() => Promise.reject(new Error("not deposited"))),
  };
}

function authClientMock(overrides?: {
  oauthResult?: { data: unknown; error: AuthError | null };
  otpResult?: { data: unknown; error: AuthError | null };
  exchangeResult?: { data: unknown; error: AuthError | null };
  signInWithPasswordResult?: { data: unknown; error: AuthError | null };
}) {
  const oauthResult = overrides?.oauthResult ?? { data: null, error: null };
  const otpResult = overrides?.otpResult ?? { data: null, error: null };
  const exchangeResult = overrides?.exchangeResult ?? { data: null, error: null };
  const signInWithPasswordResult = overrides?.signInWithPasswordResult ?? {
    data: null,
    error: null,
  };
  return {
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue(oauthResult),
      signInWithOtp: vi.fn().mockResolvedValue(otpResult),
      exchangeCodeForSession: vi.fn().mockResolvedValue(exchangeResult),
      signInWithPassword: vi.fn().mockResolvedValue(signInWithPasswordResult),
    },
  };
}

function gatewayDeps(overrides?: Partial<AuthGatewayDeps>): AuthGatewayDeps {
  return {
    getPublicEnv: () => ({
      authContinuationTtlMs: 300_000,
      authProviderMode: "supabase",
      oauthMockOrigin: null,
    }),
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

function configurePublicEnv(): void {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:8000");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-key");
  vi.stubEnv("VITE_MAGIC_LINK_RESEND_SECONDS", "60");
  vi.stubEnv("VITE_AUTH_CONTINUATION_TTL_MS", "300000");
  vi.stubEnv("VITE_AUTH_PROVIDER_MODE", "supabase");
  vi.stubEnv("VITE_OAUTH_MOCK_ORIGIN", "");
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
        authContinuationTtlMs: 300_000,
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
      getPublicEnv: () => ({
        authContinuationTtlMs: 300_000,
        authProviderMode: "supabase",
        oauthMockOrigin: null,
      }),
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

it("clears the just-created flow when starting Google OAuth fails", async () => {
  const storage = new MapStorage();
  const client = authClientMock({
    oauthResult: { data: null, error: { message: "failed" } as AuthError },
  });
  const api = continuationApiMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );

  await expect(gateway.signInWithGoogle("/planner")).rejects.toThrow(
    "Googleログインを開始できませんでした",
  );

  expect(readAuthFlow("10000000-0000-4000-8000-000000000001", storage)).toBeNull();
});

it("replaces an existing local flow when a magic link is resent", async () => {
  configurePublicEnv();
  const storage = new MapStorage();
  const api = continuationApiMock({
    create: vi
      .fn()
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000001",
        expiresAt: "2026-07-11T00:05:00Z",
      })
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000002",
        expiresAt: "2026-07-11T00:05:00Z",
      }),
  });
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );

  const first = await gateway.sendMagicLink("user@example.com", "/planner");
  storage.setItem(`kondate.auth.supabase.callback-owner.${first.flowId}`, new Date().toISOString());
  const resent = await gateway.sendMagicLink("user@example.com", "/planner");

  expect(readAuthFlow(first.flowId, storage)).toBeNull();
  expect(storage.getItem(`kondate.auth.supabase.callback-owner.${first.flowId}`)).toBeNull();
  expect(readAuthFlow(resent.flowId, storage)).not.toBeNull();
});

it("replaces an existing local magic-link flow when switching to Google", async () => {
  configurePublicEnv();
  const storage = new MapStorage();
  const api = continuationApiMock({
    create: vi
      .fn()
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000001",
        expiresAt: "2026-07-11T00:05:00Z",
      })
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000002",
        expiresAt: "2026-07-11T00:05:00Z",
      }),
  });
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );

  const magicLink = await gateway.sendMagicLink("user@example.com", "/planner");
  await gateway.signInWithGoogle("/planner");

  expect(readAuthFlow(magicLink.flowId, storage)).toBeNull();
  expect(readAuthFlow("10000000-0000-4000-8000-000000000002", storage)).not.toBeNull();
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

it("waits for the winning tab when an in-flight recovery consumes the claim", async () => {
  const storage = new MapStorage();
  let resolveWinningClaim: ((value: { code: string; returnTo: string }) => void) | undefined;
  let rejectLosingClaim: ((reason: Error) => void) | undefined;
  const claim = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ code: string; returnTo: string }>((resolve) => {
          resolveWinningClaim = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectLosingClaim = reject;
        }),
    );
  const api = continuationApiMock({ claim });
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });
  const recovery = gateway.resumeFlow(flow.id);
  expect(claim).toHaveBeenCalledOnce();
  markAuthContinuationCallbackOwner(flow.id, storage);
  const callback = gateway.resumeFlow(flow.id);
  expect(claim).toHaveBeenCalledTimes(2);
  resolveWinningClaim?.({ code: "auth-code-1", returnTo: "/onboarding" });

  await expect(recovery).resolves.toMatchObject({ kind: "complete", flowId: flow.id });
  rejectLosingClaim?.(new Error("already claimed"));

  await expect(callback).resolves.toEqual({
    kind: "awaiting_completion",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});
