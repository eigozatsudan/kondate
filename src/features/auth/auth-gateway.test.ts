import type { AuthError } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  createAuthGateway,
  dropInflightResumeMapForTests,
  IMMEDIATE_CLAIM_TIMEOUT_MS,
  INFLIGHT_RESUME_MAP_TTL_MS,
  resetInflightResumeForTests,
  type AuthGatewayDeps,
} from "./auth-gateway";
import {
  ContinuationHttpError,
  ContinuationResponseLostError,
  createAuthFlow,
  markAuthContinuationCallbackOwner,
  readAuthFlow,
  writePendingAuthDeposit,
  type ContinuationApi,
} from "./auth-flow";
import { publishAuthContinuationCompletion } from "./auth-continuation-completion";
import {
  EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS,
  tryAcquireAuthContinuationExchangeInFlight,
} from "./auth-continuation-recovery";

/** R2: localStorage acquire の確認遅延を超えて exchange 開始まで進める */
async function flushResumeUntilExchange(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20);
  });
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

afterEach(() => {
  // モジュール共有 in-flight Map をテスト間で隔離（C4 hang 等が次ケースへ漏れないようにする）
  resetInflightResumeForTests();
});

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
          // C6: create 時 now と揃えた絶対期限（過去固定日時だと巨大 skew になる）
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
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
  /** C5: exchange 失敗時の sibling session 検査用 */
  getSessionResult?: { data: { session: unknown }; error: AuthError | null };
}) {
  const oauthResult = overrides?.oauthResult ?? { data: null, error: null };
  const otpResult = overrides?.otpResult ?? { data: null, error: null };
  const exchangeResult = overrides?.exchangeResult ?? { data: null, error: null };
  const signInWithPasswordResult = overrides?.signInWithPasswordResult ?? {
    data: null,
    error: null,
  };
  const getSessionResult = overrides?.getSessionResult ?? {
    data: { session: null },
    error: null,
  };
  return {
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue(oauthResult),
      signInWithOtp: vi.fn().mockResolvedValue(otpResult),
      exchangeCodeForSession: vi.fn().mockResolvedValue(exchangeResult),
      signInWithPassword: vi.fn().mockResolvedValue(signInWithPasswordResult),
      getSession: vi.fn().mockResolvedValue(getSessionResult),
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
  // create 応答 expiresAt（now+5m）と skew 0 近傍になるよう壁時計を共有する（C6）
  now: () => new Date(),
};

function configurePublicEnv(): void {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:8000");
  vi.stubEnv(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature",
  );
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

it("same-browser magic-link callback deposits then claims immediately", async () => {
  configurePublicEnv();
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "magic-code-1", returnTo: "/onboarding" });
  const deposit = vi.fn().mockResolvedValue(undefined);
  const api = continuationApiMock({ claim, deposit });
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps({
      getPublicEnv: () => ({
        authContinuationTtlMs: 300_000,
        authProviderMode: "oauth_mock",
        oauthMockOrigin: "http://127.0.0.1:8788",
      }),
      fetchImpl,
    }),
  );
  const sent = await gateway.sendMagicLink("user@example.com", "/onboarding");
  const flow = readAuthFlow(sent.flowId, storage);
  if (flow === null) throw new Error("magic-link flow was not stored");

  await expect(
    gateway.completeCallback(
      new URL(
        `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`,
      ),
    ),
  ).resolves.toEqual({
    kind: "complete",
    continuation: "same_browser",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(deposit).toHaveBeenCalledWith(flow.id, {
    state: flow.state,
    code: "code-1",
    secret: flow.secret,
  });
  expect(claim).toHaveBeenCalledWith(flow.id, { secret: flow.secret, state: flow.state });
  // magic link の sessionExchange は supabase。mock exchange は使わない。
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("magic-code-1");
  expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});

it("exchanges a stored Google mock flow only with the local mock provider", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "google-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      Response.json({ email: "fixture@example.com", password: "fixture-password-1234" }),
    );
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps({
      getPublicEnv: () => ({
        authContinuationTtlMs: 300_000,
        authProviderMode: "oauth_mock",
        oauthMockOrigin: "http://127.0.0.1:8788",
      }),
      fetchImpl,
    }),
  );
  await gateway.signInWithGoogle("/onboarding");
  const storedFlowId = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .find((key) => key?.startsWith("kondate.auth.flow."))
    ?.replace("kondate.auth.flow.", "");
  if (storedFlowId === undefined) throw new Error("Google flow was not stored");

  await expect(gateway.resumeFlow(storedFlowId)).resolves.toMatchObject({ kind: "complete" });
  expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8788/exchange", expect.any(Object));
  expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
    email: "fixture@example.com",
    password: "fixture-password-1234",
  });
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
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

it("C6: keeps the prior local flow secret when a magic link is resent", async () => {
  configurePublicEnv();
  const storage = new MapStorage();
  const api = continuationApiMock({
    create: vi
      .fn()
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000001",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      })
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000002",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
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

  // 旧リンクが deposit されても claim できるよう first secret を残す
  expect(readAuthFlow(first.flowId, storage)).not.toBeNull();
  expect(storage.getItem(`kondate.auth.supabase.callback-owner.${first.flowId}`)).not.toBeNull();
  expect(readAuthFlow(resent.flowId, storage)).not.toBeNull();
  expect(first.flowId).not.toBe(resent.flowId);
});

it("C6: keeps the prior magic-link flow secret when switching to Google", async () => {
  configurePublicEnv();
  const storage = new MapStorage();
  const api = continuationApiMock({
    create: vi
      .fn()
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000001",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      })
      .mockResolvedValueOnce({
        id: "10000000-0000-4000-8000-000000000002",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
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

  expect(readAuthFlow(magicLink.flowId, storage)).not.toBeNull();
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

// C1 (adversarial f2cb7b0b): spoofable URL error_code は state 束縛前に expired で秘密を焼かない
it("C1: spoofed error_code without matching state does not burn a live stored flow", async () => {
  const storage = new MapStorage();
  const deposit = vi.fn().mockResolvedValue(undefined);
  const api = continuationApiMock({ deposit });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

  // flow UUID のみ + error_code（state 無し）は公開 UUID 経由の可用性 DoS になり得る
  const result = await gateway.completeCallback(
    new URL(
      `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&error=access_denied&error_code=otp_expired`,
    ),
  );

  expect(result).toEqual({ kind: "error", code: "unbound_callback", returnTo: "/planner" });
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
  expect(deposit).not.toHaveBeenCalled();
});

it("C1: spoofed error_code with mismatched state does not burn a live stored flow", async () => {
  const storage = new MapStorage();
  const api = continuationApiMock();
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

  const result = await gateway.completeCallback(
    new URL(
      `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=wrong-state&error_code=otp_expired`,
    ),
  );

  expect(result).toEqual({ kind: "error", code: "unbound_callback", returnTo: "/planner" });
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
});

it("C1: error_code with matching state still expires correctly", async () => {
  const storage = new MapStorage();
  const api = continuationApiMock();
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

  // 正当な期限切れ redirect は redirect_to の state を保持する。gateway 自体は clear しない
  // （AuthCallbackPage が kind=expired で clear）。secret はここでは残る。
  const result = await gateway.completeCallback(
    new URL(
      `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&error=access_denied&error_code=otp_expired`,
    ),
  );

  expect(result).toEqual({
    kind: "expired",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
});

it("C1: unbound error_code without local flow still maps to expired", async () => {
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    continuationApiMock(),
    new MapStorage(),
    gatewayDeps(),
  );
  // e2e 相当: flow 無しでも otp_expired は期限切れ UI へ
  const result = await gateway.completeCallback(
    new URL("http://127.0.0.1:5173/auth/callback?error=access_denied&error_code=otp_expired"),
  );
  expect(result).toEqual({ kind: "expired", flowId: "", returnTo: "/planner" });
});

it("C1: code+state is preferred over spoofed error_code and still deposits", async () => {
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

  // 有効な code+state に spoofable error_code を足しても deposit/claim を捨てない
  const result = await gateway.completeCallback(
    new URL(
      `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1&error_code=otp_expired`,
    ),
  );

  expect(result).toEqual({
    kind: "complete",
    continuation: "same_browser",
    returnTo: "/onboarding",
    flowId: flow.id,
  });
  expect(deposit).toHaveBeenCalledWith(flow.id, {
    state: flow.state,
    code: "code-1",
    secret: flow.secret,
  });
  expect(claim).toHaveBeenCalled();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-1");
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

it("same-browser callback deposits then claims and exchanges immediately", async () => {
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
  // C2: 同一ブラウザは secret 付き deposit で毒（匿名 last-wins）を所有者上書きできる
  expect(deposit).toHaveBeenCalledWith(flow.id, {
    state: flow.state,
    code: "code-1",
    secret: flow.secret,
  });
  expect(claim).toHaveBeenCalledWith(flow.id, { secret: flow.secret, state: flow.state });
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-1");
  expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  // exchange 成功後は publishAuthContinuationCompletion 内 clear で secret を消す（C1/C4）
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});

it("same-browser immediate claim 404 keeps secret for recovery coordinator fallback", async () => {
  const storage = new MapStorage();
  const deposit = vi.fn().mockResolvedValue(undefined);
  const claim = vi.fn().mockRejectedValue(new ContinuationHttpError(404));
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

  // 一時 404 は terminal にせず、callback 側 recovery poll へ委ねる
  expect(result).toEqual({
    kind: "awaiting_completion",
    returnTo: "/onboarding",
    flowId: flow.id,
  });
  expect(deposit).toHaveBeenCalled();
  expect(claim).toHaveBeenCalled();
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
});

it("same-browser immediate claim hang times out into awaiting_completion with secret kept", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const deposit = vi.fn().mockResolvedValue(undefined);
    // claim が never-settle → withTimeout で awaiting へ倒す
    const claim = vi.fn().mockReturnValue(new Promise(() => undefined));
    const api = continuationApiMock({ deposit, claim });
    const client = authClientMock();
    const gateway = createAuthGateway(
      client as unknown as BrowserSupabaseClient,
      api,
      storage,
      gatewayDeps(),
    );
    const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

    const pending = gateway.completeCallback(
      new URL(
        `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`,
      ),
    );
    await vi.advanceTimersByTimeAsync(IMMEDIATE_CLAIM_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({
      kind: "awaiting_completion",
      returnTo: "/onboarding",
      flowId: flow.id,
    });
    expect(readAuthFlow(flow.id, storage)).toEqual(flow);
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("AUTH-R1: stripped callback reload keeps local secret and resumes awaiting_completion", async () => {
  const storage = new MapStorage();
  const deposit = vi.fn().mockResolvedValue(undefined);
  const api = continuationApiMock({ deposit });
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

  // strip 後の URL（code/state なし）でも local flow があれば claim 再開へ
  const result = await gateway.completeCallback(
    new URL(`http://127.0.0.1:5173/auth/callback?flow=${flow.id}`),
  );

  expect(result).toEqual({
    kind: "awaiting_completion",
    returnTo: "/onboarding",
    flowId: flow.id,
  });
  expect(deposit).not.toHaveBeenCalled();
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
});

it("AUTH-R1: stripped callback without local secret stays unbound", async () => {
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    continuationApiMock(),
    new MapStorage(),
    gatewayDeps(),
  );
  const result = await gateway.completeCallback(
    new URL("http://127.0.0.1:5173/auth/callback?flow=10000000-0000-4000-8000-000000000099"),
  );
  expect(result).toEqual({ kind: "error", code: "unbound_callback", returnTo: "/planner" });
});

it("C-R3: concurrent resumeFlow joins the in-flight claim/exchange (no dual exchange)", async () => {
  const storage = new MapStorage();
  let resolveClaim: ((value: { code: string; returnTo: string }) => void) | undefined;
  const claim = vi.fn().mockImplementation(
    () =>
      new Promise<{ code: string; returnTo: string }>((resolve) => {
        resolveClaim = resolve;
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
  // completeCallback 即時 resume と recovery の第二 resume が同一 gateway で重なるケース
  const first = gateway.resumeFlow(flow.id);
  expect(claim).toHaveBeenCalledOnce();
  markAuthContinuationCallbackOwner(flow.id, storage);
  const second = gateway.resumeFlow(flow.id);
  // C-R3: 後続は in-flight に join し、claim/exchange を二重起動しない
  expect(claim).toHaveBeenCalledOnce();
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  resolveClaim?.({ code: "auth-code-1", returnTo: "/onboarding" });
  // claim resolve → exchange まで microtask を進める
  for (let index = 0; index < 20; index += 1) await Promise.resolve();

  await expect(first).resolves.toMatchObject({ kind: "complete", flowId: flow.id });
  await expect(second).resolves.toMatchObject({ kind: "complete", flowId: flow.id });
  expect(claim).toHaveBeenCalledOnce();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-1");
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});

it("C-R3: delayed exchange success is shared with recovery join (no used-code terminal)", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const client = authClientMock();
  let resolveExchange: ((value: { data: unknown; error: AuthError | null }) => void) | undefined;
  client.auth.exchangeCodeForSession = vi.fn().mockImplementation(
    () =>
      new Promise<{ data: unknown; error: AuthError | null }>((resolve) => {
        resolveExchange = resolve;
      }),
  );
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

  const hung = gateway.resumeFlow(flow.id);
  await flushResumeUntilExchange();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  // recovery 相当の第二 resume は join のみ（第二 exchange を起こさない）
  const joined = gateway.resumeFlow(flow.id);
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledOnce();

  resolveExchange?.({ data: null, error: null });
  await expect(hung).resolves.toMatchObject({ kind: "complete", flowId: flow.id });
  await expect(joined).resolves.toMatchObject({ kind: "complete", flowId: flow.id });
  // used-code 相当の第二失敗経路は走らず、secret は成功 clear のみ
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});

it("C-R5: concurrent resumeFlow across gateway instances joins the module-shared in-flight", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const client = authClientMock();
  let resolveExchange: ((value: { data: unknown; error: AuthError | null }) => void) | undefined;
  client.auth.exchangeCodeForSession = vi.fn().mockImplementation(
    () =>
      new Promise<{ data: unknown; error: AuthError | null }>((resolve) => {
        resolveExchange = resolve;
      }),
  );
  // callback 用 gateway と AuthProvider recovery 用 gateway が別インスタンスになる経路
  const callbackGateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const providerGateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });

  const first = callbackGateway.resumeFlow(flow.id);
  await flushResumeUntilExchange();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  const second = providerGateway.resumeFlow(flow.id);
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledOnce();

  resolveExchange?.({ data: null, error: null });
  await expect(first).resolves.toMatchObject({ kind: "complete", flowId: flow.id });
  await expect(second).resolves.toMatchObject({ kind: "complete", flowId: flow.id });
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
});

it("C-R5: completeCallback holds callback-prelease during same-browser exchange and releases on complete", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const client = authClientMock();
  let resolveExchange: ((value: { data: unknown; error: AuthError | null }) => void) | undefined;
  client.auth.exchangeCodeForSession = vi.fn().mockImplementation(
    () =>
      new Promise<{ data: unknown; error: AuthError | null }>((resolve) => {
        resolveExchange = resolve;
      }),
  );
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
  markAuthContinuationCallbackOwner(flow.id, storage);

  const callbackResultPromise = gateway.completeCallback(
    new URL(
      `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=auth-code-1`,
    ),
  );
  await flushResumeUntilExchange();
  // exchange 中は pre-lease が立ち、AUTH-R2 が orphan と誤認しない
  expect(
    storage.getItem(`kondate.auth.supabase.claim-poll-target-lease.${flow.id}.callback-prelease`),
  ).not.toBeNull();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  resolveExchange?.({ data: null, error: null });
  await expect(callbackResultPromise).resolves.toMatchObject({
    kind: "complete",
    flowId: flow.id,
  });
  // complete 後は pre-lease を解放する
  expect(
    storage.getItem(`kondate.auth.supabase.claim-poll-target-lease.${flow.id}.callback-prelease`),
  ).toBeNull();
});

it.each([
  new TypeError("network unavailable"),
  new ContinuationHttpError(503),
  new ContinuationHttpError(429),
])("keeps the flow retryable when claim fails with network/429/5xx", async (claimError) => {
  const storage = new MapStorage();
  const claim = vi.fn().mockRejectedValue(claimError);
  const api = continuationApiMock({ claim });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });
  markAuthContinuationCallbackOwner(flow.id, storage);

  // B-I4: 一時失敗は terminal error にせず awaiting のまま secret を残す
  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "awaiting_completion",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
});

it("C1/C4: claim 410 (post-consume decrypt failure) is terminal and clears secret", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockRejectedValue(new ContinuationHttpError(410));
  const api = continuationApiMock({ claim });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });

  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "error",
    code: "unbound_callback",
    returnTo: "/onboarding",
    flowId: flow.id,
  });
  // C4: 410 後に secret を残すと recovery が claim 連打するため消去する
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});

it("C7: Zod parse failure (ResponseLost) after claim keeps secret for re-claim", async () => {
  const storage = new MapStorage();
  const claim = vi
    .fn()
    .mockRejectedValueOnce(new ContinuationResponseLostError())
    .mockResolvedValueOnce({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });

  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "awaiting_completion",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);

  await expect(gateway.resumeFlow(flow.id)).resolves.toMatchObject({
    kind: "complete",
    flowId: flow.id,
  });
  expect(claim).toHaveBeenCalledTimes(2);
});

it("C3: response-lost after claim keeps secret so idempotent re-claim can recover the code", async () => {
  const storage = new MapStorage();
  const claim = vi
    .fn()
    // 2xx body 欠落のあと、冪等 re-claim で code を取り直せる（C3）
    .mockRejectedValueOnce(new ContinuationResponseLostError())
    .mockResolvedValueOnce({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });

  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "awaiting_completion",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  // secret を残し、次の claim で code を回収する
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);

  await expect(gateway.resumeFlow(flow.id)).resolves.toMatchObject({
    kind: "complete",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(claim).toHaveBeenCalledTimes(2);
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});

it("R1: TypeError then 404 keeps secret (no ambiguous mark for pre-success network blip)", async () => {
  const storage = new MapStorage();
  const claim = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network unavailable before claim reached server"))
    .mockRejectedValueOnce(new ContinuationHttpError(404));
  const api = continuationApiMock({ claim });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });

  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "awaiting_completion",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "awaiting_completion",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  // 未 deposit / サーバ未到達の TypeError では secret を保持し、正当な 404 リトライを許す
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
});

it("C4: keeps secret while exchange hangs so recovery can re-claim and retry", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const client = authClientMock();
  client.auth.exchangeCodeForSession = vi.fn().mockReturnValue(new Promise(() => undefined));
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

  void gateway.resumeFlow(flow.id);
  // claim resolve → exchange 確認遅延 → exchange 開始まで進める（secret は成功まで残す）
  await flushResumeUntilExchange();

  expect(claim).toHaveBeenCalledOnce();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-1");
  // hang 中も secret を残し、recovery の再 claim を可能にする（C4）
  expect(readAuthFlow(flow.id, storage)).toEqual(flow);
});

it("C7: rejects unexpected query keys such as access_token without depositing", async () => {
  const storage = new MapStorage();
  const deposit = vi.fn().mockResolvedValue(undefined);
  const api = continuationApiMock({ deposit });
  const client = authClientMock();
  const gateway = createAuthGateway(
    client as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

  const result = await gateway.completeCallback(
    new URL(
      `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1&access_token=stolen`,
    ),
  );

  expect(result).toEqual({ kind: "error", code: "unbound_callback", returnTo: "/planner" });
  expect(deposit).not.toHaveBeenCalled();
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
});

it("C4: publishes continuation completion when resumeFlow completes", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });

  await expect(gateway.resumeFlow(flow.id)).resolves.toMatchObject({
    kind: "complete",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(
    JSON.parse(storage.getItem(`kondate.auth.supabase.continuation-complete.${flow.id}`) ?? "null"),
  ).toEqual({ flowId: flow.id, returnTo: "/onboarding" });
});

it("C1: keeps secret when completion setItem fails after exchange success", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
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
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    if (key === `kondate.auth.supabase.continuation-complete.${flow.id}`) {
      throw new Error("quota exceeded");
    }
    originalSetItem(key, value);
  };

  await expect(gateway.resumeFlow(flow.id)).resolves.toMatchObject({
    kind: "complete",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  // C1: publish 前に clearClaimed しない。setItem 失敗時も secret が残り re-claim / 再 publish 可能
  expect(readAuthFlow(flow.id, storage)?.secret).toBe(flow.secret);
  expect(storage.getItem(`kondate.auth.supabase.continuation-complete.${flow.id}`)).toBeNull();
});

it("C11: after inflight resume soft TTL a later resume can start a new run", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
    const api = continuationApiMock({ claim });
    const client = authClientMock();
    // 最初の exchange は never-settle。soft TTL 後の第二 run は成功させる
    let exchangeCalls = 0;
    client.auth.exchangeCodeForSession = vi.fn().mockImplementation(() => {
      exchangeCalls += 1;
      if (exchangeCalls === 1) {
        return new Promise(() => undefined);
      }
      return Promise.resolve({ data: null, error: null });
    });
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

    void gateway.resumeFlow(flow.id);
    await vi.advanceTimersByTimeAsync(EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();

    // soft TTL 前は同一 hang Promise に join（第二 exchange しない）
    void gateway.resumeFlow(flow.id);
    await Promise.resolve();
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();

    // RR2: soft TTL は deposit 再試行壁 + claim 窓。IMMEDIATE_CLAIM だけでは Map に残る
    await vi.advanceTimersByTimeAsync(IMMEDIATE_CLAIM_TIMEOUT_MS);
    void gateway.resumeFlow(flow.id);
    await Promise.resolve();
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();

    // soft TTL 経過後は Map から外れ、後続が新規 run を立てられる（lease があれば awaiting でも可）
    await vi.advanceTimersByTimeAsync(INFLIGHT_RESUME_MAP_TTL_MS - IMMEDIATE_CLAIM_TIMEOUT_MS);
    const second = gateway.resumeFlow(flow.id);
    await vi.advanceTimersByTimeAsync(EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    // 第一 run が lease を保持中なら awaiting。lease 失効後なら complete もあり得る。
    // いずれにせよ第二 resume は hang join ではなく新しい結果を返す。
    await expect(second).resolves.toMatchObject({
      flowId: flow.id,
    });
    expect(claim.mock.calls.length).toBeGreaterThanOrEqual(1);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  new ContinuationHttpError(429),
  new ContinuationHttpError(503),
  new TypeError("network unavailable"),
])("C1: same-browser deposit transient then success retries and completes", async (firstError) => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const deposit = vi.fn().mockRejectedValueOnce(firstError).mockResolvedValueOnce(undefined);
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

    const pending = gateway.completeCallback(
      new URL(
        `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`,
      ),
    );
    // deposit 1 回目失敗 → backoff 1s → 2 回目成功 → exchange 確認遅延
    await vi.advanceTimersByTimeAsync(1_000 + EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    await expect(pending).resolves.toEqual({
      kind: "complete",
      continuation: "same_browser",
      returnTo: "/onboarding",
      flowId: flow.id,
    });
    expect(deposit).toHaveBeenCalledTimes(2);
    expect(deposit).toHaveBeenNthCalledWith(1, flow.id, {
      state: flow.state,
      code: "code-1",
      secret: flow.secret,
    });
    expect(deposit).toHaveBeenNthCalledWith(2, flow.id, {
      state: flow.state,
      code: "code-1",
      secret: flow.secret,
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-1");
  } finally {
    vi.useRealTimers();
  }
});

it("C3: same-browser deposit 429 exhausted becomes awaiting with pending code (not terminal)", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const deposit = vi.fn().mockRejectedValue(new ContinuationHttpError(429));
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

    const pending = gateway.completeCallback(
      new URL(
        `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`,
      ),
    );
    // 3 試行の backoff: 1s + 2s
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    await expect(pending).resolves.toEqual({
      kind: "awaiting_completion",
      flowId: flow.id,
      returnTo: "/onboarding",
    });
    // 3 試行（初回 + backoff 2 回）— claim はしない（deposit 未成功）
    expect(deposit).toHaveBeenCalledTimes(3);
    expect(claim).not.toHaveBeenCalled();
    // secret + pending code を残し recovery/resume が re-deposit できる
    expect(readAuthFlow(flow.id, storage)).toEqual(flow);
    expect(storage.getItem(`kondate.auth.supabase.pending-deposit.${flow.id}`)).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("C3: resumeFlow re-deposits from pending cache after prior 429 exhaust", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const deposit = vi
      .fn()
      .mockRejectedValueOnce(new ContinuationHttpError(429))
      .mockRejectedValueOnce(new ContinuationHttpError(429))
      .mockRejectedValueOnce(new ContinuationHttpError(429))
      // resume 側 re-deposit 成功
      .mockResolvedValueOnce(undefined);
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

    const pending = gateway.completeCallback(
      new URL(
        `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`,
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    await expect(pending).resolves.toMatchObject({ kind: "awaiting_completion" });

    const resumePending = gateway.resumeFlow(flow.id);
    // re-deposit は初回成功（backoff なし）+ exchange confirm delay
    await vi.advanceTimersByTimeAsync(EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20);
    for (let index = 0; index < 30; index += 1) await Promise.resolve();

    await expect(resumePending).resolves.toEqual({
      kind: "complete",
      continuation: "same_browser",
      returnTo: "/onboarding",
      flowId: flow.id,
    });
    // completeCallback 3 + resume re-deposit 1
    expect(deposit).toHaveBeenCalledTimes(4);
    expect(deposit).toHaveBeenLastCalledWith(flow.id, {
      state: flow.state,
      code: "code-1",
      secret: flow.secret,
    });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(storage.getItem(`kondate.auth.supabase.pending-deposit.${flow.id}`)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("RR2: soft TTL keeps overlapping resume joined so re-deposit is not doubled", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    // deposit は never-settle（withTimeout が試行ごとに切る）
    const deposit = vi.fn().mockReturnValue(new Promise(() => undefined));
    const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
    const api = continuationApiMock({ deposit, claim });
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
    writePendingAuthDeposit(
      flow.id,
      {
        state: flow.state,
        code: "pending-code-1",
        expiresAtMs: Date.now() + 300_000,
      },
      storage,
    );

    void gateway.resumeFlow(flow.id);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(deposit).toHaveBeenCalledTimes(1);

    // recovery 外側 30s timeout 相当で再入しても、旧 soft TTL では Map 脱落→dual だった。
    // 新 soft TTL では join のみ → deposit 試行は単一 run 分に留まる。
    await vi.advanceTimersByTimeAsync(IMMEDIATE_CLAIM_TIMEOUT_MS);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    // attempt1 timeout 後の backoff(1s) を進め attempt2 を起動
    await vi.advanceTimersByTimeAsync(1_000);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const afterOuterTimeoutWindow = deposit.mock.calls.length;
    expect(afterOuterTimeoutWindow).toBeGreaterThanOrEqual(1);
    expect(afterOuterTimeoutWindow).toBeLessThanOrEqual(3);

    void gateway.resumeFlow(flow.id);
    void gateway.resumeFlow(flow.id);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    // 重畳 resume は join し、deposit を二重起動しない
    expect(deposit).toHaveBeenCalledTimes(afterOuterTimeoutWindow);

    // soft TTL 全期間を単一 run が消化しても deposit は最大 3 試行（DEPOSIT_MAX_ATTEMPTS）
    await vi.advanceTimersByTimeAsync(
      INFLIGHT_RESUME_MAP_TTL_MS - IMMEDIATE_CLAIM_TIMEOUT_MS - 1_000,
    );
    for (let index = 0; index < 40; index += 1) await Promise.resolve();
    expect(deposit.mock.calls.length).toBeLessThanOrEqual(3);
  } finally {
    vi.useRealTimers();
  }
});

it("RR2: re-deposit in-flight guard skips second deposit after Map drop", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    // deposit は never-settle。withTimeout 前に Map だけ落としてガードを検証する。
    const deposit = vi.fn().mockReturnValue(new Promise(() => undefined));
    const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
    const api = continuationApiMock({ deposit, claim });
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
    writePendingAuthDeposit(
      flow.id,
      {
        state: flow.state,
        code: "pending-code-1",
        expiresAtMs: Date.now() + 300_000,
      },
      storage,
    );

    void gateway.resumeFlow(flow.id);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(deposit).toHaveBeenCalledTimes(1);

    // soft TTL 相当の Map 脱落を再現（redeposit in-flight は残す）
    dropInflightResumeMapForTests();

    // Map 脱落後の第二 resume: redepositInFlight ガードで deposit を重ねず claim のみ
    const second = gateway.resumeFlow(flow.id);
    await vi.advanceTimersByTimeAsync(EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20);
    for (let index = 0; index < 30; index += 1) await Promise.resolve();

    // deposit は 1 回のまま（Map 脱落後も re-deposit ガード）。claim は進む。
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls.length).toBeGreaterThanOrEqual(1);
    await expect(second).resolves.toMatchObject({ flowId: flow.id });
    // 成功 complete 後は clearAuthFlow で pending も消えてよい（ガード対象は deposit 回数）
  } finally {
    vi.useRealTimers();
  }
});

it("RR2: skips re-deposit when exchange is already in flight", async () => {
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
  const flow = await createAuthFlow("/onboarding", api, storage, {
    ...fixedFlowDeps,
    now: () => new Date(),
  });
  writePendingAuthDeposit(
    flow.id,
    {
      state: flow.state,
      code: "pending-code-1",
      expiresAtMs: Date.now() + 300_000,
    },
    storage,
  );
  // 他タブ相当: exchange lease を先に立てる
  await tryAcquireAuthContinuationExchangeInFlight(
    flow.id,
    "sibling-tab-exchange",
    storage,
    Date.now(),
    { locks: null, confirmDelayMs: 0 },
  );

  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "awaiting_completion",
    flowId: flow.id,
    returnTo: "/onboarding",
  });
  expect(deposit).not.toHaveBeenCalled();
  expect(claim).not.toHaveBeenCalled();
  expect(storage.getItem(`kondate.auth.supabase.pending-deposit.${flow.id}`)).not.toBeNull();
});

it("C1: cross-browser deposit 429 then success returns deposited", async () => {
  vi.useFakeTimers();
  try {
    const deposit = vi
      .fn()
      .mockRejectedValueOnce(new ContinuationHttpError(429))
      .mockResolvedValueOnce(undefined);
    const gateway = createAuthGateway(
      authClientMock() as unknown as BrowserSupabaseClient,
      continuationApiMock({ deposit }),
      new MapStorage(),
      gatewayDeps(),
    );

    const pending = gateway.completeCallback(
      new URL("http://127.0.0.1:5173/auth/callback?flow=isolated-flow-1&state=state-1&code=code-1"),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    await expect(pending).resolves.toEqual({
      kind: "deposited",
      continuation: "original_browser",
      flowId: "isolated-flow-1",
      returnTo: "/planner",
    });
    expect(deposit).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("C2: same-browser deposit hang times out into awaiting_completion with secret kept", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    // never-settle deposit → 試行ごと withTimeout → budget 後 timeout outcome
    const deposit = vi.fn().mockReturnValue(new Promise(() => undefined));
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

    const pending = gateway.completeCallback(
      new URL(
        `http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`,
      ),
    );
    // 3 試行 × 30s + backoff 1s + 2s
    await vi.advanceTimersByTimeAsync(IMMEDIATE_CLAIM_TIMEOUT_MS * 3 + 1_000 + 2_000);
    await expect(pending).resolves.toEqual({
      kind: "awaiting_completion",
      returnTo: "/onboarding",
      flowId: flow.id,
    });
    expect(deposit).toHaveBeenCalledTimes(3);
    expect(claim).not.toHaveBeenCalled();
    // C2: hangWatchdog 前に settle し secret を残す（late 204 後の claim を可能にする）
    expect(readAuthFlow(flow.id, storage)).toEqual(flow);
  } finally {
    vi.useRealTimers();
  }
});

it("C1: non-retryable deposit 400 is terminal without multi-retry", async () => {
  const storage = new MapStorage();
  const deposit = vi.fn().mockRejectedValue(new ContinuationHttpError(400));
  const api = continuationApiMock({ deposit });
  const gateway = createAuthGateway(
    authClientMock() as unknown as BrowserSupabaseClient,
    api,
    storage,
    gatewayDeps(),
  );
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);

  const result = await gateway.completeCallback(
    new URL(`http://127.0.0.1:5173/auth/callback?flow=${flow.id}&state=${flow.state}&code=code-1`),
  );

  expect(result).toEqual({ kind: "error", code: "unbound_callback", returnTo: "/onboarding" });
  expect(deposit).toHaveBeenCalledTimes(1);
});

it("C4/C5: resume short-circuits to complete when sibling already published completion", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const client = authClientMock({
    exchangeResult: {
      data: null,
      error: { message: "code already used", name: "AuthApiError", status: 400 } as AuthError,
    },
  });
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
  const flowKey = `kondate.auth.flow.${flow.id}`;
  const flowSnapshot = storage.getItem(flowKey);
  if (flowSnapshot === null) {
    throw new Error("expected flow snapshot before publish");
  }
  // 他タブが既に complete を公開したあとの loser resume（secret re-seed）
  publishAuthContinuationCompletion({ flowId: flow.id, returnTo: "/onboarding" }, storage);
  storage.setItem(flowKey, flowSnapshot);

  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "complete",
    continuation: "same_browser",
    returnTo: "/onboarding",
    flowId: flow.id,
  });
  // C4: claim/exchange 前に completion を見て dual exchange を避ける
  expect(claim).not.toHaveBeenCalled();
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(readAuthFlow(flow.id, storage)).toBeNull();
});

it("C4: existing session alone does not skip claim/exchange (new login while signed-in)", async () => {
  const storage = new MapStorage();
  const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
  const api = continuationApiMock({ claim });
  const client = authClientMock({
    getSessionResult: {
      data: {
        session: {
          access_token: "old-tok",
          refresh_token: "old-ref",
          expires_in: 3600,
          token_type: "bearer",
          user: { id: "old-user" },
        },
      },
      error: null,
    },
  });
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

  await expect(gateway.resumeFlow(flow.id)).resolves.toEqual({
    kind: "complete",
    continuation: "same_browser",
    returnTo: "/onboarding",
    flowId: flow.id,
  });
  expect(claim).toHaveBeenCalledOnce();
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-1");
});

it("C4/C5: provider exchange failure without session stays terminal unbound after probes", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
    const api = continuationApiMock({ claim });
    const client = authClientMock({
      exchangeResult: {
        data: null,
        error: { message: "invalid code", name: "AuthApiError", status: 400 } as AuthError,
      },
    });
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

    const pending = gateway.resumeFlow(flow.id);
    // exchange confirm delay + loser session probe gaps (200ms × 2)
    await vi.advanceTimersByTimeAsync(EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20 + 400);
    for (let index = 0; index < 40; index += 1) await Promise.resolve();

    await expect(pending).resolves.toEqual({
      kind: "error",
      code: "unbound_callback",
      returnTo: "/onboarding",
      flowId: flow.id,
    });
    // baseline 1 回 + loser probes 3 回。開始前・pre-exchange complete 判定では session を見ない
    expect(client.auth.getSession).toHaveBeenCalledTimes(4);
    expect(readAuthFlow(flow.id, storage)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("C1: exchange hard-fail with pre-existing unchanged session stays terminal (no false complete)", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
    const api = continuationApiMock({ claim });
    // 既ログイン（Alice）。exchange 失敗後も同一 session が残る → complete してはいけない
    const existingSession = {
      access_token: "old-tok",
      refresh_token: "old-ref",
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "alice-user" },
    };
    const client = authClientMock({
      exchangeResult: {
        data: null,
        error: { message: "invalid code", name: "AuthApiError", status: 400 } as AuthError,
      },
      getSessionResult: {
        data: { session: existingSession },
        error: null,
      },
    });
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

    const pending = gateway.resumeFlow(flow.id);
    await vi.advanceTimersByTimeAsync(EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20 + 400);
    for (let index = 0; index < 40; index += 1) await Promise.resolve();

    await expect(pending).resolves.toEqual({
      kind: "error",
      code: "unbound_callback",
      returnTo: "/onboarding",
      flowId: flow.id,
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
    // completion を当該 flow で公開しない（false complete 防止）
    expect(storage.getItem("kondate.auth.supabase.continuation-complete")).toBeNull();
    expect(storage.getItem(`kondate.auth.supabase.continuation-complete.${flow.id}`)).toBeNull();
    expect(readAuthFlow(flow.id, storage)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("C4/C5: loser exchange recovers complete when getSession lags then succeeds", async () => {
  vi.useFakeTimers();
  try {
    const storage = new MapStorage();
    const claim = vi.fn().mockResolvedValue({ code: "auth-code-1", returnTo: "/onboarding" });
    const api = continuationApiMock({ claim });
    const client = authClientMock({
      exchangeResult: {
        data: null,
        error: { message: "code already used", name: "AuthApiError", status: 400 } as AuthError,
      },
    });
    let getSessionCalls = 0;
    client.auth.getSession = vi.fn().mockImplementation(() => {
      getSessionCalls += 1;
      // loser probe 1–2 は null。3 回目で sibling session
      if (getSessionCalls >= 3) {
        return Promise.resolve({
          data: {
            session: {
              access_token: "tok",
              refresh_token: "ref",
              expires_in: 3600,
              token_type: "bearer",
              user: { id: "user-1" },
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { session: null }, error: null });
    });
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

    const pending = gateway.resumeFlow(flow.id);
    await vi.advanceTimersByTimeAsync(EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS + 20 + 400);
    for (let index = 0; index < 40; index += 1) await Promise.resolve();

    await expect(pending).resolves.toEqual({
      kind: "complete",
      continuation: "same_browser",
      returnTo: "/onboarding",
      flowId: flow.id,
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
