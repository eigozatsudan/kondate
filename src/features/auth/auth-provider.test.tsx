import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthProvider,
  COLD_START_GET_SESSION_TIMEOUT_MS,
  COLD_START_SESSION_DEADLINE_MS,
  COLD_START_SESSION_RETRY_MS,
  type AuthProviderClient,
} from "./auth-provider";
import { clearSoftResidualRecoverySuppressed, SIGN_OUT_TIMEOUT_MS } from "./auth-cleanup";
import {
  ACTIVE_LOGIN_FLOW_STORAGE_KEY,
  createAuthFlow,
  defaultAuthContinuationTtlMs,
  writeActiveLoginFlowId,
  writeSessionActiveLoginFlowId,
} from "./auth-flow";
import { notifySoftResidualRecoveryRearm } from "./soft-residual-recovery-suppress";
import { resetLeftoverPkceProtectionForTests } from "./auth-gateway";
import { AUTH_SESSION_SWITCH_KEY, armIntentionalAuthSessionSwitch } from "./live-auth-session-mark";
import { resetAccessTokenPinGateForTests } from "./session";
import { useAuth } from "./use-auth";

const session = { access_token: "token", user: { id: "user-1" } } as Session;
type AuthSubscription = ReturnType<
  AuthProviderClient["auth"]["onAuthStateChange"]
>["data"]["subscription"];
type AuthStateListener = (event: AuthChangeEvent, next: Session | null) => void;

function createAuthSubscription(): AuthSubscription {
  return {
    id: "test-subscription",
    callback: () => undefined,
    unsubscribe: vi.fn(),
  };
}

function Probe() {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "authenticated" && auth.session !== null)
      document.title = auth.session.user.id;
  }, [auth]);
  return (
    <output>
      {auth.status}
      {auth.sessionProbeDegraded ? ":degraded" : ""}
    </output>
  );
}

function createTestContinuationApi(flowId: string) {
  return {
    create: vi.fn(() =>
      Promise.resolve({
        id: flowId,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    ),
    deposit: vi.fn(() => Promise.resolve(undefined)),
    claim: vi.fn(() => Promise.reject(new Error("not deposited"))),
  };
}

async function startTestAuthFlow(flowId: string): Promise<void> {
  await createAuthFlow("/onboarding", createTestContinuationApi(flowId), window.localStorage, {
    now: () => new Date("2026-08-12T00:00:00.000Z"),
    randomBytes: (size = 32) => new Uint8Array(size).fill(7),
  });
}

function seedActiveLoginFlowPin(flowId = "10000000-0000-4000-8000-00000000ff01"): string {
  writeActiveLoginFlowId(flowId);
  return flowId;
}

function readPinnedFlowId(storage: Storage): string | undefined {
  const raw = storage.getItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

describe("AuthProvider", () => {
  beforeEach(() => {
    // residual recovery は /login + 非 suppress 前提。前テストの path / 印を毎回落とす。
    window.history.replaceState(null, "", "/");
    try {
      window.localStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
      window.localStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
      window.localStorage.removeItem("kondate.auth.liveSession");
      window.sessionStorage.removeItem(AUTH_SESSION_SWITCH_KEY);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    // R1: module pin ゲートが他テストへ漏れないようにする
    resetAccessTokenPinGateForTests();
    resetLeftoverPkceProtectionForTests();
    try {
      window.localStorage.removeItem("kondate.auth.supabase");
    } catch {
      // ignore
    }
    // C4/R3: soft residual 共有 suppress が次テストを止めないようにする。
    // clearSoftResidualRecoverySuppressed は R4 re-arm を発火するため、teardown では
    // storage を直接落としてマウント中 Provider への act 外 setState を避ける。
    try {
      window.localStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
      window.localStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
      window.localStorage.removeItem("kondate.auth.liveSession");
      window.sessionStorage.removeItem(AUTH_SESSION_SWITCH_KEY);
    } catch {
      // ignore
    }
  });

  it("loads the initial session and refreshes on focus", async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("C5: successful apply outside /login does not grandfather unmarked persist into a live mark", async () => {
    window.history.replaceState(null, "", "/planner");
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(window.localStorage.getItem("kondate.auth.liveSession")).toBeNull();
  });

  it("C5: first pin on /planner refuses unmarked leftover persist instead of grandfathering it", async () => {
    window.history.replaceState(null, "", "/planner");
    window.localStorage.setItem(
      "kondate.auth.supabase",
      JSON.stringify({
        access_token: "leftover-access",
        refresh_token: "leftover-refresh",
        user: { id: "leftover-user" },
      }),
    );
    const leftover = {
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "leftover-user" },
    } as Session;
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: leftover }, error: null }),
        signOut,
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(document.title).not.toBe("leftover-user");
    expect(window.localStorage.getItem("kondate.auth.liveSession")).toBeNull();
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("C5: first pin on /planner accepts leftover-incapable persist that matches the live mark", async () => {
    window.history.replaceState(null, "", "/planner");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-1", storedAt: new Date().toISOString() }),
    );
    window.localStorage.setItem(
      "kondate.auth.supabase",
      JSON.stringify({
        access_token: "token",
        refresh_token: "refresh",
        user: { id: "user-1" },
      }),
    );
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-1");
    const mark = JSON.parse(window.localStorage.getItem("kondate.auth.liveSession") ?? "{}") as {
      userId?: string;
    };
    expect(mark.userId).toBe("user-1");
  });

  it("C5: successful apply fills userId on an existing live mark without creating one from leftover", async () => {
    window.history.replaceState(null, "", "/planner");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ storedAt: new Date().toISOString() }),
    );
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    const mark = JSON.parse(window.localStorage.getItem("kondate.auth.liveSession") ?? "{}") as {
      userId?: string;
    };
    expect(mark.userId).toBe("user-1");
  });

  it("C5: first pin refuses leftover persist whose userId differs from the live mark", async () => {
    window.history.replaceState(null, "", "/planner");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-a", storedAt: new Date().toISOString() }),
    );
    const leftover = {
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "leftover-user" },
    } as Session;
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: leftover }, error: null }),
        signOut,
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(document.title).not.toBe("leftover-user");
    const mark = JSON.parse(window.localStorage.getItem("kondate.auth.liveSession") ?? "{}") as {
      userId?: string;
    };
    expect(mark.userId).toBe("user-a");
  });

  it("keeps the previous session when focus getSession returns an error", async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: { message: "network" } });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    // B-I6: 一時エラーでは session を落とさない
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("U1-I4 keeps loading on cold-start getSession error until a success arrives", async () => {
    let calls = 0;
    const getSession = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({ data: { session: null }, error: { message: "idb_locked" } });
      }
      return Promise.resolve({ data: { session }, error: null });
    });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    // 初回失敗では unauthenticated に倒れず loading のまま
    expect(await screen.findByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("unauthenticated")).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
  });

  it("accepts an injectable recovery boundary without creating an auth gateway", async () => {
    // C2: residual recovery は /login のみ。非待機 path では gateway 注入だけでも start しない。
    window.history.replaceState(null, "", "/login");
    seedActiveLoginFlowPin();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const recovery = vi.fn(() => vi.fn());
    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    await waitFor(() => {
      expect(recovery).toHaveBeenCalledOnce();
    });
  });

  it("publishes completion when an in-flight recovery wins the claim", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    seedActiveLoginFlowPin();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    let completeRecovery:
      ((result: { kind: "complete"; flowId: string; returnTo: string }) => void) | undefined;
    // location.assign の jsdom 未実装による間欠汚染を避ける（完了印の検証が主目的）
    const navigateTo = vi.fn();

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        navigateTo={navigateTo}
        startRecovery={(input) => {
          completeRecovery = input.onComplete;
          return vi.fn();
        }}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    // residual recovery effect 登録を待つ（loaded 後 effect は paint 後）
    await waitFor(() => {
      expect(completeRecovery).toBeTypeOf("function");
    });

    await act(async () => {
      completeRecovery?.({ kind: "complete", flowId: "flow-1", returnTo: "/onboarding" });
      await Promise.resolve();
    });

    const stored = JSON.parse(
      window.localStorage.getItem("kondate.auth.supabase.continuation-complete.flow-1") ?? "null",
    ) as { flowId: string; returnTo: string; completedAt: string };
    expect(stored).toMatchObject({
      flowId: "flow-1",
      returnTo: "/onboarding",
    });
    expect(typeof stored.completedAt).toBe("string");
    expect(stored.completedAt.length).toBeGreaterThan(0);
  });

  it("refreshes the session after recovery completion when publishing fails", async () => {
    // C1/C6: residual recovery は unauthenticated + /login のみ start する
    window.history.replaceState(null, "", "/login");
    seedActiveLoginFlowPin();
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    let completeRecovery:
      ((result: { kind: "complete"; flowId: string; returnTo: string }) => void) | undefined;
    const navigateTo = vi.fn();
    // completion キーへの setItem だけ失敗させる（他の storage 書込を巻き込まない）
    // unbound-method を避けるため property descriptor 経由で native を保持する
    const setItemDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
    if (setItemDescriptor?.value === undefined) {
      throw new Error("Storage.prototype.setItem is missing");
    }
    const originalSetItem = setItemDescriptor.value as (
      this: Storage,
      key: string,
      value: string,
    ) => void;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key.startsWith("kondate.auth.supabase.continuation-complete")) {
        throw new Error(`secret:${"A".repeat(43)}`);
      }
      originalSetItem.call(this, key, value);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <AuthProvider
          client={client}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          navigateTo={navigateTo}
          startRecovery={(input) => {
            completeRecovery = input.onComplete;
            return vi.fn();
          }}
        >
          <Probe />
        </AuthProvider>,
      );
      await screen.findByText("unauthenticated");
      // residual recovery effect 登録を待つ（loaded 後 effect は paint 後）
      await waitFor(() => {
        expect(completeRecovery).toBeTypeOf("function");
      });

      await act(async () => {
        completeRecovery?.({ kind: "complete", flowId: "flow-1", returnTo: "/onboarding" });
        await Promise.resolve();
      });

      expect(getSession).toHaveBeenCalledTimes(2);
      expect(navigateTo).toHaveBeenCalledWith("/onboarding");
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("C16: completion listener navigates only on auth waiting paths", async () => {
    window.history.replaceState(null, "", "/settings");
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const navigateTo = vi.fn();

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        navigateTo={navigateTo}
        startRecovery={() => vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "kondate.auth.supabase.continuation-complete",
          newValue: JSON.stringify({
            flowId: "flow-1",
            returnTo: "/onboarding",
            completedAt: new Date().toISOString(),
          }),
        }),
      );
      await Promise.resolve();
    });

    // 設定画面タブは session 再取得のみ。強制 navigate しない
    expect(navigateTo).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("C14: recovery onComplete navigates only on auth waiting paths (same guard as C16)", async () => {
    // C2: recovery は /login でのみ start するため、まず login で onComplete を掴み非待機へ移す
    window.history.replaceState(null, "", "/login");
    seedActiveLoginFlowPin();
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    let completeRecovery:
      ((result: { kind: "complete"; flowId: string; returnTo: string }) => void) | undefined;
    const navigateTo = vi.fn();

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        navigateTo={navigateTo}
        startRecovery={(input) => {
          completeRecovery = input.onComplete;
          return vi.fn();
        }}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    // residual recovery effect 登録を待つ（loaded 後 effect は paint 後）
    await waitFor(() => {
      expect(completeRecovery).toBeTypeOf("function");
    });

    await act(async () => {
      window.history.pushState(null, "", "/settings");
      await Promise.resolve();
    });

    await act(async () => {
      completeRecovery?.({ kind: "complete", flowId: "flow-1", returnTo: "/onboarding" });
      await Promise.resolve();
    });

    // C14: /settings では強制 navigate しない（session 再取得は cold-start / onComplete で複数回ありうる）
    expect(navigateTo).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalled();
  });

  it("C1: does not start residual recovery when already authenticated outside auth waiting paths", async () => {
    window.history.replaceState(null, "", "/settings");
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const recovery = vi.fn(() => vi.fn());

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    // loading 中の抑止 + authenticated 後の抑止。どちらも startRecovery を呼ばない
    expect(recovery).not.toHaveBeenCalled();
  });

  it("C1/C6: does not start residual recovery on /login when already authenticated", async () => {
    // LoginPage は authenticated で即 Navigate。recovery を許可すると stop 後の in-flight
    // exchange が onAuthStateChange で無言 session 差し替えする（C1/C6）。
    window.history.replaceState(null, "", "/login");
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const recovery = vi.fn(() => vi.fn());

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    expect(recovery).not.toHaveBeenCalled();
  });

  it("C2: rejects multi-tab callback session clobber outside residual recovery", async () => {
    // residual 外（/planner 認証済み）でも pin により別 user の無言差し替えを拒否する
    window.history.replaceState(null, "", "/planner");
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    // Probe の useEffect で title が揃うまで待つ（前テストの title 残渣を避ける）
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.title).toBe("user-a");

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      // R1: pin reject 後の client cleanup → restore は async
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // R1: restore 後も listener が無い注入 client では degraded が残り得る（data plane は block）
    expect(screen.getByText(/authenticated/)).toBeInTheDocument();
    expect(document.title).toBe("user-a");
    expect(setSession).toHaveBeenCalledWith({
      access_token: "token-a",
      refresh_token: "refresh-a",
    });
  });

  it("C-R2: pin restore is rate-limited to reduce multi-tab thrash", async () => {
    window.history.replaceState(null, "", "/planner");
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();

    // cooldown 内の連続 clobber は 1 回だけ setSession restore
    // R1: pin reject は先に client cleanup（async）してから restore するため microtask を十分流す
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
        listener("SIGNED_IN", sessionB);
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.title).toBe("user-a");
    expect(setSession).toHaveBeenCalledTimes(1);
    // C-R7: cooldown で restore を見送った回は degraded を立てる
    expect(screen.getByText("authenticated:degraded")).toBeInTheDocument();
  });

  it("C-R7: pin restore failure marks sessionProbeDegraded", async () => {
    window.history.replaceState(null, "", "/planner");
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockRejectedValue(new Error("restore failed"));
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.title).toBe("user-a");
    expect(await screen.findByText("authenticated:degraded")).toBeInTheDocument();
  });

  it("R1: pin mismatch clears client via signOut so data plane cannot stay as B", async () => {
    window.history.replaceState(null, "", "/planner");
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    // restore は失敗させ、signOut による B 除去 + pin 維持 + degraded を固定する
    const setSession = vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: { message: "no" } });
    const signOut = vi.fn().mockImplementation(() => {
      // 本番同様 SIGNED_OUT を通知（pin mismatch cleanup として消費され pin は落ちない）
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      return Promise.resolve({ error: null });
    });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // R1: B を data plane から落とす signOut が先に走る
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    // React pin は A のまま（SIGNED_OUT を cleanup として消費）
    expect(document.title).toBe("user-a");
    expect(await screen.findByText("authenticated:degraded")).toBeInTheDocument();
  });

  it("C1: dual pin-mismatch cleanup nulls keep pin and do not soft-wipe drafts", async () => {
    // boolean expect だと 2 回目の SIGNED_OUT/null が pin を落とし soft residual で草稿を焼く
    window.history.replaceState(null, "", "/planner");
    window.localStorage.clear();
    window.localStorage.setItem(
      "kondate:generation:v2",
      JSON.stringify({ kind: "regenerate_menu", request: { changeReason: "下書き" } }),
    );
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const sessionC = {
      access_token: "token-c",
      refresh_token: "refresh-c",
      user: { id: "user-c" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: { message: "no" } });
    const signOut = vi.fn().mockImplementation(() => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      return Promise.resolve({ error: null });
    });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
        listener("SIGNED_IN", sessionC);
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(signOut.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(document.title).toBe("user-a");
    expect(screen.getByText(/authenticated/)).toBeInTheDocument();
    // soft residual wipe が走っていないこと
    expect(window.localStorage.getItem("kondate:generation:v2")).not.toBeNull();
  });

  it("C12: recoverDegradedSession forces residual clear to re-auth without elevating", async () => {
    window.history.replaceState(null, "", "/planner");
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockRejectedValue(new Error("restore failed"));
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    function RecoverProbe() {
      const auth = useAuth();
      return (
        <div>
          <output>
            {auth.status}
            {auth.sessionProbeDegraded ? ":degraded" : ""}
          </output>
          <button type="button" onClick={() => auth.recoverDegradedSession?.()}>
            recover
          </button>
        </div>
      );
    }

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <RecoverProbe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated:degraded")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "recover" }).click();
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
  });

  it("C-R1: rejects late residual exchange session swap after another user already won", async () => {
    // residual recovery start → A 確立（recovery stop）→ 後着 B の onAuthStateChange を捨てる。
    window.history.replaceState(null, "", "/login");
    seedActiveLoginFlowPin();
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null });
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        setSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;
    const recovery = vi.fn(() => vi.fn());

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    expect(recovery.mock.calls.length).toBeGreaterThanOrEqual(1);

    // 別経路（magic/OAuth A）が先に complete
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionA);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-a");

    // residual B の exchange が後から settle（navigate 無しの無言差し替え経路）
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      // R1: client cleanup → restore は async
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // React 状態は A のまま。勝者 token を setSession で戻そうとする
    // R1: listener 無しでは degraded 表示が残り得る
    expect(screen.getByText(/authenticated/)).toBeInTheDocument();
    expect(document.title).toBe("user-a");
    expect(setSession).toHaveBeenCalledWith({
      access_token: "token-a",
      refresh_token: "refresh-a",
    });
  });

  it("C2: does not start residual recovery on /planner when unauthenticated", async () => {
    // soft 失効後の共有端末で、非待機 path の silent claim/exchange を抑止する。
    window.history.replaceState(null, "", "/planner");
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const recovery = vi.fn(() => vi.fn());

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    expect(recovery).not.toHaveBeenCalled();
  });

  it("R1: stops recovery after SPA leave from unauthenticated /login", async () => {
    // 直前テストが /planner 等に path を残していても初期化を確実にする
    window.localStorage.clear();
    window.history.replaceState(null, "", "/login");
    expect(window.location.pathname).toBe("/login");
    seedActiveLoginFlowPin();
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    // 各 start ごとに独立した stop を返し、最新 generation の stop だけを数える
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const recovery = vi.fn(() => {
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    // path sync effect が history を包むまで待つ（並列/順序汚染で初回 effect が遅れることがある）
    await vi.waitFor(() => {
      expect(recovery.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    const startsAfterLoad = recovery.mock.calls.length;
    const activeStop = stops.at(-1);
    expect(activeStop).toBeDefined();
    expect(activeStop).not.toHaveBeenCalled();

    // SPA 遷移（React Router と同型の pushState）。AuthProvider は Router 外だが path を追跡する。
    await act(async () => {
      window.history.pushState(null, "", "/settings");
      await Promise.resolve();
    });

    expect(activeStop).toHaveBeenCalledTimes(1);
    // 非待機 path では再開しない（C2）
    expect(recovery).toHaveBeenCalledTimes(startsAfterLoad);
  });

  it("R1: restarts recovery when returning to unauthenticated /login", async () => {
    window.history.replaceState(null, "", "/login");
    seedActiveLoginFlowPin();
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const recovery = vi.fn(() => vi.fn());

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    const startsAfterLoad = recovery.mock.calls.length;
    expect(startsAfterLoad).toBeGreaterThanOrEqual(1);

    await act(async () => {
      window.history.pushState(null, "", "/settings");
      await Promise.resolve();
    });
    expect(recovery).toHaveBeenCalledTimes(startsAfterLoad);

    // 認証待ち surface へ戻ったら residual recovery を再開する
    await act(async () => {
      window.history.pushState(null, "", "/login");
      await Promise.resolve();
    });
    expect(recovery.mock.calls.length).toBe(startsAfterLoad + 1);
  });

  it("C4/R3: soft SIGNED_OUT clears drafts/feedback; preserves sibling flow secrets + suppress recovery", async () => {
    window.history.replaceState(null, "", "/planner");
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "kondate:generation:v2",
      JSON.stringify({ kind: "regenerate_menu", request: { changeReason: "自由記述の下書き" } }),
    );
    window.localStorage.setItem(
      "kondate:feedback:ambiguous-fingerprint",
      "bug_report\nアレルギー free-form",
    );
    // R3: soft 失効でも sibling mid-login の secret/pending/PKCE は温存
    // C4: residual recovery は tab-local suppress で silent complete を閉じる
    const flowId = "10000000-0000-4000-8000-0000000000c7";
    const flowKey = `kondate.auth.flow.${flowId}`;
    const pendingKey = `kondate.auth.supabase.pending-deposit.${flowId}`;
    window.localStorage.setItem(
      flowKey,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "http://127.0.0.1:5173",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    window.localStorage.setItem(
      pendingKey,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    window.localStorage.setItem("kondate.auth.supabase-code-verifier", "pkce-verifier");
    const authListeners: AuthStateListener[] = [];
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    render(
      <AuthProvider client={client} startRecovery={() => vi.fn()}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    expect(window.localStorage.getItem("kondate:generation:v2")).not.toBeNull();

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      await Promise.resolve();
    });

    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(window.localStorage.getItem("kondate:generation:v2")).toBeNull();
    expect(window.localStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    // R3: sibling mid-login keys preserved
    expect(window.localStorage.getItem(flowKey)).not.toBeNull();
    expect(window.localStorage.getItem(pendingKey)).toBeNull();
    expect(window.localStorage.getItem("kondate.auth.supabase-code-verifier")).toBe(
      "pkce-verifier",
    );
    // C4: origin 共有 localStorage で residual recovery を抑止（新タブからも見える）
    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");
  });

  it("R3/C4: soft residual suppress prevents residual recovery start on /login", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const startRecovery = vi.fn(() => vi.fn());
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const authListeners: AuthStateListener[] = [];
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    render(
      <AuthProvider client={client} startRecovery={startRecovery}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    const startsWhileAuth = startRecovery.mock.calls.length;

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    // soft residual 後は共有 suppress により recovery を開始しない
    expect(startRecovery.mock.calls.length).toBe(startsWhileAuth);
    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");
  });

  it("C4: shared soft residual suppress blocks residual recovery even with empty sessionStorage (new tab)", async () => {
    // soft 後に新タブで /login を開いた状況: localStorage に suppress のみ、sessionStorage 空
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const flowId = "10000000-0000-4000-8000-0000000000c4";
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "http://127.0.0.1:5173",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    // C5: 前タブ soft residual は pending 平文を消す。新タブ seed も合わせる。
    // 前タブの soft residual が書いた共有 suppress（sessionStorage は新タブで空）
    window.localStorage.setItem("kondate.auth.soft-residual-recovery-suppress", "1");
    const startRecovery = vi.fn(() => vi.fn());
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } as AuthProviderClient;

    render(
      <AuthProvider client={client} startRecovery={startRecovery}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    // 新タブでも共有 suppress により residual recovery を開始しない（prior user silent complete を閉じる）
    expect(startRecovery).not.toHaveBeenCalled();
    // R3: secret は残っている（burn ではなく suppress）。C5: pending 平文は消す
    expect(window.localStorage.getItem(`kondate.auth.flow.${flowId}`)).not.toBeNull();
    expect(
      window.localStorage.getItem(`kondate.auth.supabase.pending-deposit.${flowId}`),
    ).toBeNull();
  });

  it("R4: clearSoftResidual after soft re-arms residual recovery on same /login mount", async () => {
    // soft residual → suppress で residual 停止 → 意図的 clear（createAuthFlow 相当）で同一マウント再武装
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const startRecovery = vi.fn(() => vi.fn());
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const authListeners: AuthStateListener[] = [];
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    const startsWhileAuth = startRecovery.mock.calls.length;

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    // C4: suppress 中は residual を開始しない
    expect(startRecovery.mock.calls.length).toBe(startsWhileAuth);
    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");

    // R4: createAuthFlow / clearSoft 相当 — remount なしで re-arm。
    // C4: pin 無し idle では residual を始めないので、再武装前に pin を戻す。
    seedActiveLoginFlowPin();
    await act(async () => {
      clearSoftResidualRecoverySuppressed();
      await Promise.resolve();
    });
    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBeNull();
    expect(startRecovery.mock.calls.length).toBeGreaterThan(startsWhileAuth);
  });

  it("R4: createAuthFlow after soft re-arms residual recovery without remount", async () => {
    // soft → /login suppress → createAuthFlow 成功で suppress clear + re-arm（マジックリンク待機の典型）
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const startRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    startRecovery.mockReturnValue(vi.fn());
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const authListeners: AuthStateListener[] = [];
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    const startsWhileAuth = startRecovery.mock.calls.length;

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(startRecovery.mock.calls.length).toBe(startsWhileAuth);

    const api = {
      create: vi.fn(() =>
        Promise.resolve({
          id: "10000000-0000-4000-8000-0000000000a4",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
      ),
      deposit: vi.fn(() => Promise.resolve(undefined)),
      claim: vi.fn(() => Promise.reject(new Error("not deposited"))),
    };

    await act(async () => {
      await createAuthFlow("/onboarding", api, window.localStorage, {
        now: () => new Date("2026-08-12T00:00:00.000Z"),
        randomBytes: (size = 32) => new Uint8Array(size).fill(7),
      });
      await Promise.resolve();
    });

    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBeNull();
    // 意図的 login 開始後は同一 /login マウントで residual が再武装される
    expect(startRecovery.mock.calls.length).toBeGreaterThan(startsWhileAuth);
    // C2/C12: 再武装は今開始した flow だけ（prior 全件ではない）。
    // targetFlowId は callback 専用なので付けない（マジック元は owner 無し）。
    const lastRearmInput = startRecovery.mock.calls.at(-1)?.[0];
    expect(lastRearmInput?.restrictToFlowId).toBe("10000000-0000-4000-8000-0000000000a4");
    expect(lastRearmInput?.targetFlowId).toBeUndefined();
  });

  it("C2: createAuthFlow after soft does not target a prior-user flow", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const priorFlowId = "10000000-0000-4000-8000-0000000000c2";
    window.localStorage.setItem(
      `kondate.auth.flow.${priorFlowId}`,
      JSON.stringify({
        id: priorFlowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "http://127.0.0.1:5173",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.pending-deposit.${priorFlowId}`,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    const startRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    startRecovery.mockReturnValue(vi.fn());
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const authListeners: AuthStateListener[] = [];
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    const startsWhileAuth = startRecovery.mock.calls.length;

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(startRecovery.mock.calls.length).toBe(startsWhileAuth);

    const newFlowId = "10000000-0000-4000-8000-0000000000b2";
    const api = {
      create: vi.fn(() =>
        Promise.resolve({
          id: newFlowId,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
      ),
      deposit: vi.fn(() => Promise.resolve(undefined)),
      claim: vi.fn(() => Promise.reject(new Error("not deposited"))),
    };

    await act(async () => {
      await createAuthFlow("/onboarding", api, window.localStorage, {
        now: () => new Date("2026-08-12T00:00:00.000Z"),
        randomBytes: (size = 32) => new Uint8Array(size).fill(7),
      });
      await Promise.resolve();
    });

    expect(startRecovery.mock.calls.length).toBeGreaterThan(startsWhileAuth);
    const lastInput = startRecovery.mock.calls.at(-1)?.[0];
    // C12: residual は targetFlowId（callback-owner 必須）ではなく claimable 絞り込み
    expect(lastInput?.restrictToFlowId).toBe(newFlowId);
    expect(lastInput?.restrictToFlowId).not.toBe(priorFlowId);
    expect(lastInput?.targetFlowId).toBeUndefined();
    // R3: prior-user secret は焼かない。C5: soft 後の pending 平文は消す
    expect(window.localStorage.getItem(`kondate.auth.flow.${priorFlowId}`)).not.toBeNull();
    expect(
      window.localStorage.getItem(`kondate.auth.supabase.pending-deposit.${priorFlowId}`),
    ).toBeNull();
  });

  it("C13: other-tab /login remount restricts to B pin, not prior-user A", async () => {
    // A の flow+pending → SIGNED_OUT suppress → createAuthFlow(B)。
    // sessionStorage pin を消す（他タブ / remount 相当）。localStorage の B で restrict する。
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const priorFlowId = "10000000-0000-4000-8000-0000000000c3";
    window.localStorage.setItem(
      `kondate.auth.flow.${priorFlowId}`,
      JSON.stringify({
        id: priorFlowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "http://127.0.0.1:5173",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.pending-deposit.${priorFlowId}`,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    const startRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    startRecovery.mockReturnValue(vi.fn());
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const authListeners: AuthStateListener[] = [];
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    const firstMount = render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    const startsWhileAuth = startRecovery.mock.calls.length;

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(startRecovery.mock.calls.length).toBe(startsWhileAuth);

    const newFlowId = "10000000-0000-4000-8000-0000000000b3";
    const api = {
      create: vi.fn(() =>
        Promise.resolve({
          id: newFlowId,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
      ),
      deposit: vi.fn(() => Promise.resolve(undefined)),
      claim: vi.fn(() => Promise.reject(new Error("not deposited"))),
    };

    await act(async () => {
      await createAuthFlow("/onboarding", api, window.localStorage, {
        now: () => new Date("2026-08-12T00:00:00.000Z"),
        randomBytes: (size = 32) => new Uint8Array(size).fill(7),
      });
      await Promise.resolve();
    });

    expect(readPinnedFlowId(window.localStorage)).toBe(newFlowId);
    firstMount.unmount();
    // 他タブ相当: sessionStorage は空、origin 共有 localStorage に B の pin だけ
    window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);

    const remountRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    remountRecovery.mockReturnValue(vi.fn());
    const remountClient = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={remountClient}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={remountRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    // remount の getSession(null) で unauthenticated になったあと residual effect が走る。
    // フルスイート負荷下では findByText が effect より先に解決し得るので、副作用を待つ。
    await waitFor(() => {
      expect(remountRecovery).toHaveBeenCalled();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    const remountInput = remountRecovery.mock.calls.at(-1)?.[0];
    expect(remountInput?.restrictToFlowId).toBe(newFlowId);
    expect(remountInput?.restrictToFlowId).not.toBe(priorFlowId);
    expect(remountInput?.targetFlowId).toBeUndefined();
    // R3: A の secret は claim しないだけで残す。C5: soft 後の pending 平文は消す
    expect(window.localStorage.getItem(`kondate.auth.flow.${priorFlowId}`)).not.toBeNull();
    expect(
      window.localStorage.getItem(`kondate.auth.supabase.pending-deposit.${priorFlowId}`),
    ).toBeNull();
  });

  it("C5: cold-start never-authenticated unauthenticated does not wipe sibling flow (RR1 intact)", async () => {
    window.history.replaceState(null, "", "/planner");
    window.localStorage.clear();
    const flowId = "10000000-0000-4000-8000-0000000000bb";
    const flowKey = `kondate.auth.flow.${flowId}`;
    window.localStorage.setItem(
      flowKey,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "http://127.0.0.1:5173",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    // 草稿も残す — 未ログイン cold-start では C5 soft cleanup を走らせない（hadAuthenticated 無し）
    window.localStorage.setItem("kondate:generation:v2", '{"kind":"x"}');
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider client={client} startRecovery={() => vi.fn()}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    expect(window.localStorage.getItem(flowKey)).not.toBeNull();
    expect(window.localStorage.getItem("kondate:generation:v2")).toBe('{"kind":"x"}');
  });

  it("C8: idle /login with no unexpired flows does not navigate on foreign completion", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const navigateTo = vi.fn();

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        navigateTo={navigateTo}
        startRecovery={() => vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "kondate.auth.supabase.continuation-complete.flow-foreign",
          newValue: JSON.stringify({
            flowId: "flow-foreign",
            returnTo: "/onboarding",
            completedAt: new Date().toISOString(),
          }),
        }),
      );
      await Promise.resolve();
    });

    // waiting 空の idle /login は foreign/stale completion だけで returnTo へ yank しない
    expect(navigateTo).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("C7: completion listener navigates on /login only when flowId matches a waiting flow", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    const waitingFlowId = "10000000-0000-4000-8000-000000000001";
    const otherFlowId = "20000000-0000-4000-8000-000000000002";
    window.localStorage.setItem(
      `kondate.auth.flow.${waitingFlowId}`,
      JSON.stringify({
        id: waitingFlowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const navigateTo = vi.fn();

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        navigateTo={navigateTo}
        startRecovery={() => vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "kondate.auth.supabase.continuation-complete",
          newValue: JSON.stringify({
            flowId: otherFlowId,
            returnTo: "/planner",
            completedAt: new Date().toISOString(),
          }),
        }),
      );
      await Promise.resolve();
    });
    // 別 flow 完了でも完了印が storage に無い Spoof → navigate しない（session 再取得のみ）
    expect(navigateTo).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "kondate.auth.supabase.continuation-complete",
          newValue: JSON.stringify({
            flowId: waitingFlowId,
            returnTo: "/onboarding",
            completedAt: new Date().toISOString(),
          }),
        }),
      );
      await Promise.resolve();
    });
    expect(navigateTo).toHaveBeenCalledWith("/onboarding");
  });

  it("C1: multi-flow cross-tab StorageEvent navigates after winner cleared matching flow", async () => {
    // 本番順: publish は setItem(completion) → clearAuthFlow 後に他タブへ storage が届く
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    const flowA = "10000000-0000-4000-8000-0000000000a1";
    const flowB = "20000000-0000-4000-8000-0000000000b2";
    const nowIso = new Date().toISOString();
    window.localStorage.setItem(
      `kondate.auth.flow.${flowA}`,
      JSON.stringify({
        id: flowA,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/planner",
        sessionExchange: "supabase",
        startedAt: nowIso,
      }),
    );
    // flow B は勝者タブが既に clear 済み（残さない）
    const completionKey = `kondate.auth.supabase.continuation-complete.${flowB}`;
    window.localStorage.setItem(
      completionKey,
      JSON.stringify({
        flowId: flowB,
        returnTo: "/onboarding",
        completedAt: nowIso,
      }),
    );
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const navigateTo = vi.fn();

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        navigateTo={navigateTo}
        startRecovery={() => vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: completionKey,
          newValue: JSON.stringify({
            flowId: flowB,
            returnTo: "/onboarding",
            completedAt: nowIso,
          }),
        }),
      );
      await Promise.resolve();
    });
    // A が残っていても B の完了印があれば B の returnTo へ（URL returnTo フォールバックを避ける）
    expect(navigateTo).toHaveBeenCalledWith("/onboarding");
  });

  it("leaves callback claim ownership to AuthCallbackPage", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    const recovery = vi.fn(() => vi.fn());

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={recovery}
      >
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(recovery).not.toHaveBeenCalled();
  });

  it("C4: recovery onResult error clears the terminal flow secret (fail-closed)", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    const flowId = "10000000-0000-4000-8000-000000000001";
    seedActiveLoginFlowPin(flowId);
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } satisfies AuthProviderClient;
    let reportResult: ((result: { kind: "error"; flowId: string }) => void) | undefined;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={(input) => {
          reportResult = input.onResult;
          return vi.fn();
        }}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");

    await act(async () => {
      reportResult?.({ kind: "error", flowId });
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(`kondate.auth.flow.${flowId}`)).toBeNull();
  });

  it("C5: fails closed to unauthenticated when cold-start getSession never settles past deadline", async () => {
    vi.useFakeTimers();
    try {
      // persist token が残っている状態を再現（fail-closed で消えること）
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockReturnValue(new Promise(() => undefined));
      const client = {
        auth: {
          getSession,
          onAuthStateChange: () => ({
            data: { subscription: createAuthSubscription() },
          }),
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client}>
          <Probe />
        </AuthProvider>,
      );
      expect(screen.getByText("loading")).toBeInTheDocument();

      // 単発 withTimeout 後も rety は続くが loaded にはしない
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_GET_SESSION_TIMEOUT_MS);
      });
      expect(screen.getByText("loading")).toBeInTheDocument();

      // 全体 deadline タイマーで未ログイン fail-closed + session キー掃除
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          COLD_START_SESSION_DEADLINE_MS - COLD_START_GET_SESSION_TIMEOUT_MS,
        );
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(window.localStorage.getItem("kondate.auth.supabase")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("RR1: cold-start fail-closed clears session key only and keeps sibling flow secrets/pending", async () => {
    vi.useFakeTimers();
    try {
      const flowId = "10000000-0000-4000-8000-0000000000aa";
      const flowKey = `kondate.auth.flow.${flowId}`;
      const pendingKey = `kondate.auth.supabase.pending-deposit.${flowId}`;
      const ownerKey = `kondate.auth.supabase.callback-owner.${flowId}`;
      const completionKey = "kondate.auth.supabase.continuation-complete";
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      // 他タブ相当: 進行中 OAuth の secret / pending / owner / completion を共有 storage に置く
      window.localStorage.setItem(
        flowKey,
        JSON.stringify({
          id: flowId,
          secret: "A".repeat(43),
          state: "B".repeat(43),
          origin: "http://127.0.0.1:5173",
          returnTo: "/onboarding",
          sessionExchange: "supabase",
          startedAt: new Date().toISOString(),
        }),
      );
      window.localStorage.setItem(
        pendingKey,
        JSON.stringify({
          state: "B".repeat(43),
          code: "sibling-code",
          expiresAtMs: Date.now() + 60_000,
        }),
      );
      window.localStorage.setItem(ownerKey, new Date().toISOString());
      window.localStorage.setItem(
        completionKey,
        JSON.stringify({ flowId, returnTo: "/onboarding" }),
      );

      const getSession = vi.fn().mockReturnValue(new Promise(() => undefined));
      const client = {
        auth: {
          getSession,
          onAuthStateChange: () => ({
            data: { subscription: createAuthSubscription() },
          }),
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });

      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      // C5: session キーは消えて focus 復活しない
      expect(window.localStorage.getItem("kondate.auth.supabase")).toBeNull();
      // RR1: 他タブの進行中 flow / pending / owner / completion は焼かない
      expect(window.localStorage.getItem(flowKey)).not.toBeNull();
      expect(window.localStorage.getItem(pendingKey)).not.toBeNull();
      expect(window.localStorage.getItem(ownerKey)).not.toBeNull();
      expect(window.localStorage.getItem(completionKey)).not.toBeNull();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C15: cold-start fail-closed suppresses /login residual without burning sibling flow", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/login");
      window.localStorage.clear();
      window.sessionStorage.clear();
      const flowId = "10000000-0000-4000-8000-0000000000c5";
      const flowKey = `kondate.auth.flow.${flowId}`;
      const pendingKey = `kondate.auth.supabase.pending-deposit.${flowId}`;
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      window.localStorage.setItem(
        flowKey,
        JSON.stringify({
          id: flowId,
          secret: "A".repeat(43),
          state: "B".repeat(43),
          origin: "http://127.0.0.1:5173",
          returnTo: "/onboarding",
          sessionExchange: "supabase",
          startedAt: new Date().toISOString(),
        }),
      );
      window.localStorage.setItem(
        pendingKey,
        JSON.stringify({
          state: "B".repeat(43),
          code: "sibling-code",
          expiresAtMs: Date.now() + 60_000,
        }),
      );
      const startRecovery = vi.fn(() => vi.fn());
      const getSession = vi.fn().mockReturnValue(new Promise(() => undefined));
      const client = {
        auth: {
          getSession,
          onAuthStateChange: () => ({
            data: { subscription: createAuthSubscription() },
          }),
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider
          client={client}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          startRecovery={startRecovery}
        >
          <Probe />
        </AuthProvider>,
      );
      expect(screen.getByText("loading")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });

      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      // createAuthFlow するまで leftover 全件 residual を回さない（C5 と同じ origin 共有 suppress）
      expect(startRecovery).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");
      // RR1: flow / pending は焼かない
      expect(window.localStorage.getItem(flowKey)).not.toBeNull();
      expect(window.localStorage.getItem(pendingKey)).not.toBeNull();
    } finally {
      window.localStorage.clear();
      window.sessionStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C36: local pin write failure keeps suppress; starting tab recovers, other tab does not", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const startRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    startRecovery.mockReturnValue(vi.fn());
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const authListeners: AuthStateListener[] = [];
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    const firstMount = render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");
    const startsWhileAuth = startRecovery.mock.calls.length;

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_OUT", null);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(startRecovery.mock.calls.length).toBe(startsWhileAuth);
    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");

    const newFlowId = "10000000-0000-4000-8000-0000000000c6";
    const setItemDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
    if (setItemDescriptor?.value === undefined) {
      throw new Error("Storage.prototype.setItem is missing");
    }
    const originalSetItem = setItemDescriptor.value as (
      this: Storage,
      key: string,
      value: string,
    ) => void;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (this === window.localStorage && key === ACTIVE_LOGIN_FLOW_STORAGE_KEY) {
        throw new Error("quota");
      }
      originalSetItem.call(this, key, value);
    });
    try {
      await act(async () => {
        await createAuthFlow(
          "/onboarding",
          createTestContinuationApi(newFlowId),
          window.localStorage,
          {
            now: () => new Date("2026-08-12T00:00:00.000Z"),
            randomBytes: (size = 32) => new Uint8Array(size).fill(7),
          },
        );
        await Promise.resolve();
      });
    } finally {
      setItem.mockRestore();
    }

    // origin 共有 suppress は残る。開始タブは session pin で residual を開始する
    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");
    expect(readPinnedFlowId(window.sessionStorage)).toBe(newFlowId);
    expect(window.localStorage.getItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY)).toBeNull();
    expect(startRecovery.mock.calls.length).toBeGreaterThan(startsWhileAuth);
    const startedInput = startRecovery.mock.calls.at(-1)?.[0];
    expect(startedInput?.restrictToFlowId).toBe(newFlowId);
    expect(startedInput?.targetFlowId).toBeUndefined();

    firstMount.unmount();
    window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);

    const remountRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    remountRecovery.mockReturnValue(vi.fn());
    const remountClient = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={remountClient}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={remountRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    // 他タブ相当: pin 無し + suppress 残なので start しない
    expect(remountRecovery).not.toHaveBeenCalled();
  });

  it("C37: fail-closed clears leftover local pin so remount cannot restrict to abandoned A", async () => {
    vi.useFakeTimers();
    const priorFlowId = "10000000-0000-4000-8000-0000000000a7";
    const newFlowId = "10000000-0000-4000-8000-0000000000b7";
    const flowKey = `kondate.auth.flow.${priorFlowId}`;
    const pendingKey = `kondate.auth.supabase.pending-deposit.${priorFlowId}`;
    try {
      window.history.replaceState(null, "", "/login");
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      window.localStorage.setItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY, priorFlowId);
      window.localStorage.setItem(
        flowKey,
        JSON.stringify({
          id: priorFlowId,
          secret: "A".repeat(43),
          state: "B".repeat(43),
          origin: "http://127.0.0.1:5173",
          returnTo: "/onboarding",
          sessionExchange: "supabase",
          startedAt: new Date().toISOString(),
        }),
      );
      window.localStorage.setItem(
        pendingKey,
        JSON.stringify({
          state: "B".repeat(43),
          code: "sibling-code",
          expiresAtMs: Date.now() + 60_000,
        }),
      );
      const startRecovery =
        vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
      startRecovery.mockReturnValue(vi.fn());
      const getSession = vi.fn().mockReturnValue(new Promise(() => undefined));
      const client = {
        auth: {
          getSession,
          onAuthStateChange: () => ({
            data: { subscription: createAuthSubscription() },
          }),
        },
      } satisfies AuthProviderClient;

      const firstMount = render(
        <AuthProvider
          client={client}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          startRecovery={startRecovery}
        >
          <Probe />
        </AuthProvider>,
      );
      expect(screen.getByText("loading")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });

      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(startRecovery).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");
      // C37: fail-closed で abandoned A の pin を両方消す
      expect(window.localStorage.getItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY)).toBeNull();
      expect(window.sessionStorage.getItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY)).toBeNull();
      // R3: secret / pending は焼かない
      expect(window.localStorage.getItem(flowKey)).not.toBeNull();
      expect(window.localStorage.getItem(pendingKey)).not.toBeNull();

      vi.useRealTimers();
      firstMount.unmount();

      const createRecovery =
        vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
      createRecovery.mockReturnValue(vi.fn());
      const createClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
        },
      } as AuthProviderClient;
      const createMount = render(
        <AuthProvider
          client={createClient}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          startRecovery={createRecovery}
        >
          <Probe />
        </AuthProvider>,
      );
      await screen.findByText("unauthenticated");
      expect(createRecovery).not.toHaveBeenCalled();

      const setItemDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
      if (setItemDescriptor?.value === undefined) {
        throw new Error("Storage.prototype.setItem is missing");
      }
      const originalSetItem = setItemDescriptor.value as (
        this: Storage,
        key: string,
        value: string,
      ) => void;
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ): void {
        if (this === window.localStorage && key === ACTIVE_LOGIN_FLOW_STORAGE_KEY) {
          throw new Error("quota");
        }
        originalSetItem.call(this, key, value);
      });
      try {
        await act(async () => {
          await startTestAuthFlow(newFlowId);
          await Promise.resolve();
        });
      } finally {
        setItem.mockRestore();
      }

      expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");
      expect(window.localStorage.getItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY)).not.toBe(priorFlowId);
      createMount.unmount();
      window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);

      const remountRecovery =
        vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
      remountRecovery.mockReturnValue(vi.fn());
      const remountClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
        },
      } as AuthProviderClient;
      render(
        <AuthProvider
          client={remountClient}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          startRecovery={remountRecovery}
        >
          <Probe />
        </AuthProvider>,
      );
      await screen.findByText("unauthenticated");
      // suppress 残 or pin 無しなので A を restrict して start しない
      expect(remountRecovery).not.toHaveBeenCalled();
    } finally {
      window.localStorage.clear();
      window.sessionStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C38: suppress + non-UUID local pin does not start /login residual", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("kondate.auth.soft-residual-recovery-suppress", "1");
    window.localStorage.setItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY, "not-a-uuid");
    const startRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    startRecovery.mockReturnValue(vi.fn());
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    // 不正 pin は pin 無し扱い。suppress を維持し全件 residual を開始しない
    expect(startRecovery).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kondate.auth.soft-residual-recovery-suppress")).toBe("1");
  });

  it("C4: idle /login without active-login-flow pin does not start residual", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const startRecovery = vi.fn(() => vi.fn());
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    expect(startRecovery).not.toHaveBeenCalled();
  });

  it("C12: idle /login without pin does not arm first-writer until residual actually starts", async () => {
    // restrictToFlowId 確定前に armed=true すると、start しない idle /login でも
    // first-writer pin が有効になる。arm は startRecovery 直前だけ。
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const startRecovery = vi.fn(() => vi.fn());
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        setSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    expect(startRecovery).not.toHaveBeenCalled();

    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionA);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-a");
    // residual 未起動の first session は通常 pin。意図しない first-writer arm ではない。
    expect(startRecovery).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("C4: OTP session pin + rearm stops residual from claiming sibling Google pin", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    const googleFlowId = "10000000-0000-4000-8000-0000000000c4";
    const otpPinId = "20000000-0000-4000-8000-0000000000c4";
    writeActiveLoginFlowId(googleFlowId);
    window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
    const stopRecovery = vi.fn();
    const startRecovery =
      vi.fn<(input: { restrictToFlowId?: string; targetFlowId?: string }) => () => void>();
    startRecovery.mockReturnValue(stopRecovery);
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    await waitFor(() => {
      expect(startRecovery).toHaveBeenCalled();
    });
    expect(startRecovery.mock.calls.at(-1)?.[0]?.restrictToFlowId).toBe(googleFlowId);
    const startsBeforeOtp = startRecovery.mock.calls.length;

    await act(async () => {
      writeSessionActiveLoginFlowId(otpPinId);
      notifySoftResidualRecoveryRearm();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(startRecovery.mock.calls.length).toBeGreaterThan(startsBeforeOtp);
    });
    expect(stopRecovery).toHaveBeenCalled();
    expect(startRecovery.mock.calls.at(-1)?.[0]?.restrictToFlowId).toBe(otpPinId);
    expect(startRecovery.mock.calls.at(-1)?.[0]?.restrictToFlowId).not.toBe(googleFlowId);
  });

  it("C4: expired active-login-flow pin does not start /login residual", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.clear();
    window.sessionStorage.clear();
    writeActiveLoginFlowId(
      "10000000-0000-4000-8000-0000000000c4",
      Date.now() - defaultAuthContinuationTtlMs - 1,
    );
    const startRecovery = vi.fn(() => vi.fn());
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: createAuthSubscription() } }),
      },
    } as AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={startRecovery}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");
    expect(startRecovery).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY)).toBeNull();
  });

  it("C4: fail-closed stays unauthenticated after hung getSession settles; createAuthFlow applies only a new session", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      let settleHang: ((value: { data: { session: Session }; error: null }) => void) | undefined;
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>((resolve) => {
            settleHang = resolve;
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );
      expect(screen.getByText("loading")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      const callsAfterDeadline = getSession.mock.calls.length;

      getSession.mockResolvedValue({ data: { session }, error: null });
      await act(async () => {
        settleHang?.({ data: { session }, error: null });
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await vi.advanceTimersByTimeAsync(3_000);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(getSession.mock.calls.length).toBe(callsAfterDeadline);

      const api = {
        create: vi.fn(() =>
          Promise.resolve({
            id: "10000000-0000-4000-8000-0000000000c4",
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          }),
        ),
        deposit: vi.fn(() => Promise.resolve(undefined)),
        claim: vi.fn(() => Promise.reject(new Error("not deposited"))),
      };
      await act(async () => {
        await createAuthFlow("/onboarding", api, window.localStorage, {
          now: () => new Date("2026-08-12T00:00:00.000Z"),
          randomBytes: (size = 32) => new Uint8Array(size).fill(7),
        });
        await Promise.resolve();
      });
      // C14: re-arm 後も fail-closed 前の prior session（同じ access_token）は apply しない
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      // C14: 別 access_token（正規 IdP / residual complete 相当）は apply できる
      const freshSession = {
        access_token: "token-c14-fresh",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", freshSession);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C14: createAuthFlow before delayed settle still rejects prior session and accepts a new token", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      let settleHang: ((value: { data: { session: Session }; error: null }) => void) | undefined;
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>((resolve) => {
            settleHang = resolve;
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );
      expect(screen.getByText("loading")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const api = {
        create: vi.fn(() =>
          Promise.resolve({
            id: "10000000-0000-4000-8000-0000000000c4",
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          }),
        ),
        deposit: vi.fn(() => Promise.resolve(undefined)),
        claim: vi.fn(() => Promise.reject(new Error("not deposited"))),
      };
      // C14 how-to-confirm: deadline → createAuthFlow → 遅延 settle / SIGNED_IN A
      await act(async () => {
        await createAuthFlow("/onboarding", api, window.localStorage, {
          now: () => new Date("2026-08-12T00:00:00.000Z"),
          randomBytes: (size = 32) => new Uint8Array(size).fill(7),
        });
        await Promise.resolve();
      });

      // C14: settle と同 tick の SIGNED_IN（SDK が getSession resolve と同時に飛ばす経路）
      await act(async () => {
        settleHang?.({ data: { session }, error: null });
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const freshSession = {
        access_token: "token-c14-fresh",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", freshSession);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C16: re-arm then prior SIGNED_IN while stale getSession is still pending stays unauthenticated", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // C16: raw getSession は hang のまま。token を学習させない
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );
      expect(screen.getByText("loading")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-0000000000c6");
        await Promise.resolve();
      });

      // C16: token 未学習 + 旧 Promise 未 settle のまま prior SIGNED_IN。1 microtask では denylist が空
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const freshSession = {
        access_token: "token-c16-fresh",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", freshSession);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C17: re-arm interval/focus getSession leftover stays unauthenticated; SIGNED_IN of another token applies", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // fail-closed まで hang。re-arm 後の新世代 probe で leftover を返す
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      // C17: leftover A を apply しないために、fail-closed 中の SIGNED_IN で hard 学習する。
      // interval の login-era getSession は C21 で焼かないので、ここで A を入れないと
      // 後続の fresh SIGNED_IN が C16/C23 で leftover 扱いされる。
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-0000000000c7");
        await Promise.resolve();
      });

      getSession.mockResolvedValue({ data: { session }, error: null });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_RETRY_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const freshSession = {
        access_token: "token-c17-fresh",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", freshSession);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C17: TOKEN_REFRESHED of a rotated leftover after re-arm does not authenticate", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // hang のまま fail-closed。T1 は listener だけで学習する
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const leftoverT1 = {
        access_token: "token-c17-t1",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", leftoverT1);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000017");
        await Promise.resolve();
      });

      const rotatedT2 = {
        access_token: "token-c17-t2",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("TOKEN_REFRESHED", rotatedT2);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C18: second createAuthFlow does not denylist a login-era fresh token B", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      let settleHang: ((value: { data: { session: Session }; error: null }) => void) | undefined;
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>((resolve) => {
            settleHang = resolve;
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      // C18: fail-closed 後に leftover A を一度観測して denylist へ入れる。
      // B の apply は denylist に A があるあとの別 token SIGNED_IN（空 denylist 緩和はしない）。
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-0000000000c8");
        await Promise.resolve();
      });

      // 一度目のあとに login-era probe を開始し、二度目の createAuthFlow で世代を上げないこと
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_RETRY_MS);
        await Promise.resolve();
      });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000018");
        await Promise.resolve();
      });

      const sessionB = {
        access_token: "token-c18-b",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        settleHang?.({ data: { session: sessionB }, error: null });
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C16: after login-era interval, prior SIGNED_IN while stale getSession still hangs stays unauthenticated", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // stale-era も login-era も hang のまま。両方 pending でも prior を apply しない
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000016");
        await Promise.resolve();
      });

      // C16 残り: 1.5s interval で login-era が始まっても stale hang 中の prior SIGNED_IN は拒否
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_RETRY_MS);
        await Promise.resolve();
      });

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const freshSession = {
        access_token: "token-c16-remain-fresh",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", freshSession);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C19: SIGNED_IN of rotated leftover T2 after TOKEN_REFRESHED stays unauthenticated", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // hang のまま。T1 は fail-closed 中に学習し、T2 は quarantine 中の非 SIGNED_IN で学習する
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const leftoverT1 = {
        access_token: "token-c19-t1",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", leftoverT1);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000019");
        await Promise.resolve();
      });

      const rotatedT2 = {
        access_token: "token-c19-t2",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("TOKEN_REFRESHED", rotatedT2);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      // C19: T2 を remember したので後続 SIGNED_IN T2 も正規 IdP 扱いにしない
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", rotatedT2);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C20: residual onComplete trustNextRefresh applies denylisted session B", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/login");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // C20: interval は進めない。SIGNED_IN B は C16 ゲートで denylist される
          }),
      );
      const authListeners: AuthStateListener[] = [];
      let completeRecovery:
        ((result: { kind: "complete"; flowId: string; returnTo: string }) => void) | undefined;
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider
          client={client}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          navigateTo={vi.fn()}
          startRecovery={(input) => {
            completeRecovery = input.onComplete;
            return vi.fn();
          }}
        >
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000020");
        await Promise.resolve();
      });
      expect(completeRecovery).toBeTypeOf("function");

      const sessionB = {
        access_token: "token-c20-b",
        user: { id: "user-1" },
      } as Session;
      // 1.5s は進めない。C16 が B を leftover として remember する
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      getSession.mockResolvedValue({ data: { session: sessionB }, error: null });
      await act(async () => {
        completeRecovery?.({
          kind: "complete",
          flowId: "10000000-0000-4000-8000-000000000020",
          returnTo: "/onboarding",
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C22: getSession error after re-arm past wall deadline does not re-arm fail-closed", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // 初回 cold-start は hang。deadline 後に leftover A を listener で学習する
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000022");
        await Promise.resolve();
      });

      getSession.mockResolvedValue({ error: {}, data: { session: null } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_RETRY_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const freshSession = {
        access_token: "token-c22-fresh",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", freshSession);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C21: login-era getSession token B is not burned; later SIGNED_IN B authenticates", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // cold-start は hang。login-era interval だけ token B で settle する
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000021");
        await Promise.resolve();
      });

      const sessionB = {
        access_token: "token-c21-b",
        user: { id: "user-1" },
      } as Session;
      getSession.mockResolvedValue({ data: { session: sessionB }, error: null });
      // C21: settle と SIGNED_IN を別 act にする。getSession が先に B を焼く穴を踏む
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_RETRY_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C23: SIGNED_IN leftover after settled error getSession stays unauthenticated", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockResolvedValue({ error: {}, data: { session: null } });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000023");
        await Promise.resolve();
      });

      // C23: 1.5s は進めない。stale pending も token 学習も無い leftover SIGNED_IN
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const freshSession = {
        access_token: "token-c23-fresh",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", freshSession);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C24: first TOKEN_REFRESHED B with empty leftover sets is not remembered", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      let settleHang: ((value: { data: { session: Session }; error: null }) => void) | undefined;
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>((resolve) => {
            settleHang = resolve;
          }),
      );
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000024");
        await Promise.resolve();
      });

      const sessionB = {
        access_token: "token-c24-b",
        user: { id: "user-1" },
      } as Session;
      // C24 縮小: 空 denylist の先着 TOKEN_REFRESHED は焼かない（C19 は再開しない）
      await act(async () => {
        for (const listener of authListeners) {
          listener("TOKEN_REFRESHED", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      // 別経路で leftover A を hard 学習してから SIGNED_IN B が通ること
      await act(async () => {
        settleHang?.({ data: { session }, error: null });
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C25: trustNextRefresh does not apply hard leftover token A", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/login");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const leftoverA = session;
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // hang。fail-closed 中に A を hard 学習し、onComplete の getSession も A のまま
          }),
      );
      const authListeners: AuthStateListener[] = [];
      let completeRecovery:
        ((result: { kind: "complete"; flowId: string; returnTo: string }) => void) | undefined;
      const client = {
        auth: {
          getSession,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } as AuthProviderClient;

      render(
        <AuthProvider
          client={client}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          navigateTo={vi.fn()}
          startRecovery={(input) => {
            completeRecovery = input.onComplete;
            return vi.fn();
          }}
        >
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", leftoverA);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000025");
        await Promise.resolve();
      });
      expect(completeRecovery).toBeTypeOf("function");

      getSession.mockResolvedValue({ data: { session: leftoverA }, error: null });
      await act(async () => {
        completeRecovery?.({
          kind: "complete",
          flowId: "10000000-0000-4000-8000-000000000025",
          returnTo: "/onboarding",
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("fail-closed calls local signOut and unlocks UI before signOut timeout", async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockReturnValue(new Promise(() => undefined));
      const signOut = vi.fn().mockReturnValue(new Promise(() => undefined));
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: () => ({
            data: { subscription: createAuthSubscription() },
          }),
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client}>
          <Probe />
        </AuthProvider>,
      );
      expect(screen.getByText("loading")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      // UI 解放は SIGN_OUT_TIMEOUT を待たない
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS - 1);
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("fail-closed keeps sibling flow when local signOut never settles", async () => {
    vi.useFakeTimers();
    try {
      const flowId = "10000000-0000-4000-8000-0000000026aa";
      const flowKey = `kondate.auth.flow.${flowId}`;
      const pendingKey = `kondate.auth.supabase.pending-deposit.${flowId}`;
      const ownerKey = `kondate.auth.supabase.callback-owner.${flowId}`;
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      window.localStorage.setItem(
        flowKey,
        JSON.stringify({
          id: flowId,
          secret: "A".repeat(43),
          state: "B".repeat(43),
          origin: "http://127.0.0.1:5173",
          returnTo: "/onboarding",
          sessionExchange: "supabase",
          startedAt: new Date().toISOString(),
        }),
      );
      window.localStorage.setItem(
        pendingKey,
        JSON.stringify({
          state: "B".repeat(43),
          code: "sibling-code",
          expiresAtMs: Date.now() + 60_000,
        }),
      );
      window.localStorage.setItem(ownerKey, new Date().toISOString());

      const getSession = vi.fn().mockReturnValue(new Promise(() => undefined));
      const signOut = vi.fn().mockReturnValue(new Promise(() => undefined));
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: () => ({
            data: { subscription: createAuthSubscription() },
          }),
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });

      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(window.localStorage.getItem("kondate.auth.supabase")).toBeNull();
      expect(window.localStorage.getItem(flowKey)).not.toBeNull();
      expect(window.localStorage.getItem(pendingKey)).not.toBeNull();
      expect(window.localStorage.getItem(ownerKey)).not.toBeNull();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C26: after successful local signOut, login-era leftover A is not pending and SIGNED_IN A does not apply", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const leftoverA = session;
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // hang。fail-closed 中に A は見ない
          }),
      );
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000026");
        await Promise.resolve();
      });

      getSession.mockResolvedValue({ data: { session: leftoverA }, error: null });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_RETRY_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", leftoverA);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C29: after successful local signOut, onComplete getSession null stays unauthenticated", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/login");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockImplementation(
        () =>
          new Promise<{ data: { session: Session }; error: null }>(() => {
            // hang。fail-closed 中に A は見ない
          }),
      );
      const signOut = vi.fn().mockResolvedValue({ error: null });
      let completeRecovery:
        ((result: { kind: "complete"; flowId: string; returnTo: string }) => void) | undefined;
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: () => ({
            data: { subscription: createAuthSubscription() },
          }),
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider
          client={client}
          recoveryGateway={{ resumeFlow: vi.fn() }}
          navigateTo={vi.fn()}
          startRecovery={(input) => {
            completeRecovery = input.onComplete;
            return vi.fn();
          }}
        >
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000029");
        await Promise.resolve();
      });
      expect(completeRecovery).toBeTypeOf("function");

      // signOut 成功後は SDK 空。getSession が A のままなのは失敗相当なので成功パスにしない
      getSession.mockResolvedValue({ data: { session: null }, error: null });
      await act(async () => {
        completeRecovery?.({
          kind: "complete",
          flowId: "10000000-0000-4000-8000-000000000029",
          returnTo: "/onboarding",
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C28: after successful local signOut, empty leftover SIGNED_IN B authenticates", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockResolvedValue({ error: {}, data: { session: null } });
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000028");
        await Promise.resolve();
      });

      const sessionB = {
        access_token: "token-c28-b",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C30: late SIGNED_OUT after successful fail-closed signOut does not drop authenticated B", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      // persist leftover は置くが getSession は即 error/null。hung probe だと C16 stale pending が
      // C28 の正規 B を leftover 扱いするため、C30 の後着 SIGNED_OUT まで到達できない。
      const getSession = vi.fn().mockResolvedValue({ error: {}, data: { session: null } });
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000030");
        await Promise.resolve();
      });

      const sessionB = {
        access_token: "token-c30-b",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_OUT", null);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C31: leftover SIGNED_IN with persist access_token stays unauthenticated after successful signOut", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      const persistToken = "token-c31-a";
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: persistToken, refresh_token: "r" }),
      );
      const leftoverA = {
        access_token: persistToken,
        user: { id: "user-1" },
      } as Session;
      const getSession = vi.fn().mockResolvedValue({ error: {}, data: { session: null } });
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000031");
        await Promise.resolve();
      });

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", leftoverA);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();

      const sessionB = {
        access_token: "token-c31-b",
        user: { id: "user-1" },
      } as Session;
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C32: focus getSession persist leftover after authenticated B does not replace pin token", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const persistLeftover = {
        access_token: "stale",
        user: { id: "user-1" },
      } as Session;
      const sessionB = {
        access_token: "token-c32-b",
        user: { id: "user-1" },
      } as Session;
      const getSession = vi.fn().mockResolvedValue({ error: {}, data: { session: null } });
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } satisfies AuthProviderClient;

      function TokenProbe() {
        const auth = useAuth();
        return (
          <output>
            {auth.status}
            {auth.session !== null ? `:${auth.session.access_token}` : ""}
          </output>
        );
      }

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <TokenProbe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000032");
        await Promise.resolve();
      });

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionB);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated:token-c32-b")).toBeInTheDocument();

      getSession.mockResolvedValue({ data: { session: persistLeftover }, error: null });
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated:token-c32-b")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C2: same-user refresh T2 after fail-closed signOut success updates pin", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const sessionT1 = {
        access_token: "token-c2-t1",
        user: { id: "user-1" },
      } as Session;
      const sessionT2 = {
        access_token: "token-c2-t2",
        user: { id: "user-1" },
      } as Session;
      const getSession = vi.fn().mockResolvedValue({ error: {}, data: { session: null } });
      const signOut = vi.fn().mockResolvedValue({ error: null });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } satisfies AuthProviderClient;

      function TokenProbe() {
        const auth = useAuth();
        return (
          <output>
            {auth.status}
            {auth.session !== null ? `:${auth.session.access_token}` : ""}
          </output>
        );
      }

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <TokenProbe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-0000000000c2");
        await Promise.resolve();
      });

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", sessionT1);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated:token-c2-t1")).toBeInTheDocument();

      getSession.mockResolvedValue({ data: { session: sessionT2 }, error: null });
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated:token-c2-t2")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C23 remains when fail-closed local signOut fails", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/");
      window.localStorage.setItem(
        "kondate.auth.supabase",
        JSON.stringify({ access_token: "stale", refresh_token: "r" }),
      );
      const getSession = vi.fn().mockResolvedValue({ error: {}, data: { session: null } });
      const signOut = vi.fn().mockResolvedValue({ error: { message: "sign-out-failed" } });
      const authListeners: AuthStateListener[] = [];
      const client = {
        auth: {
          getSession,
          signOut,
          onAuthStateChange: (cb: AuthStateListener) => {
            authListeners.push(cb);
            return { data: { subscription: createAuthSubscription() } };
          },
        },
      } satisfies AuthProviderClient;

      render(
        <AuthProvider client={client} startRecovery={() => vi.fn()}>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });

      await act(async () => {
        await startTestAuthFlow("10000000-0000-4000-8000-000000000023");
        await Promise.resolve();
      });

      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });

  it("C2: leftover-capable /login adopts OTP session B instead of restoring pin A", async () => {
    window.history.replaceState(null, "", "/login");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-a", storedAt: new Date().toISOString() }),
    );
    window.localStorage.setItem(
      "kondate.auth.supabase",
      JSON.stringify({
        access_token: "token-a",
        refresh_token: "refresh-a",
        user: { id: "user-a" },
      }),
    );
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-a");

    armIntentionalAuthSessionSwitch("email_otp");
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.title).toBe("user-b");
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("C4: /auth/callback refuses unmarked leftover persist then first-pins Google B", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    window.localStorage.setItem(
      "kondate.auth.supabase",
      JSON.stringify({
        access_token: "leftover-access",
        refresh_token: "leftover-refresh",
        user: { id: "leftover-user" },
      }),
    );
    const leftover = {
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "leftover-user" },
    } as Session;
    const googleB = {
      access_token: "google-access",
      refresh_token: "google-refresh",
      user: { id: "google-user" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: leftover }, error: null })
      .mockResolvedValue({ data: { session: googleB }, error: null });
    const client = {
      auth: {
        getSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });

    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", googleB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("google-user");
  });

  it("C4: leftover live A on /auth/callback adopts Google B when the switch is armed", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-a", storedAt: new Date().toISOString() }),
    );
    window.localStorage.setItem(
      "kondate.auth.supabase",
      JSON.stringify({
        access_token: "token-a",
        refresh_token: "refresh-a",
        user: { id: "user-a" },
      }),
    );
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const setSession = vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: sessionA }, error: null }),
        setSession,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-a");

    armIntentionalAuthSessionSwitch("google_callback");
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
    });
    expect(document.title).toBe("user-b");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
  });

  it("C-R1: delayed leftover refuse signOut does not wipe first-pinned Google B persist", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    const leftoverPersist = JSON.stringify({
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "leftover-user" },
    });
    const googlePersist = JSON.stringify({
      access_token: "google-access",
      refresh_token: "google-refresh",
      user: { id: "google-user" },
    });
    window.localStorage.setItem("kondate.auth.supabase", leftoverPersist);
    const leftover = {
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "leftover-user" },
    } as Session;
    const googleB = {
      access_token: "google-access",
      refresh_token: "google-refresh",
      user: { id: "google-user" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    let releaseSignOut: (() => void) | undefined;
    const signOut = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSignOut = () => {
            window.localStorage.removeItem("kondate.auth.supabase");
            for (const listener of authListeners) {
              listener("SIGNED_OUT", null);
            }
            resolve({ error: null });
          };
        }),
    );
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: leftover }, error: null }),
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });

    window.localStorage.setItem("kondate.auth.supabase", googlePersist);
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", googleB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("google-user");

    await act(async () => {
      releaseSignOut?.();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(googlePersist);
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("google-user");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
  });

  it("C-R5: leftover rotation after Google persist does not replace first-pinned B", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    const leftoverPersist = JSON.stringify({
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "leftover-user" },
    });
    const googlePersist = JSON.stringify({
      access_token: "google-access",
      refresh_token: "google-refresh",
      user: { id: "google-user" },
    });
    const leftoverRotationPersist = JSON.stringify({
      access_token: "leftover-access-rotated",
      refresh_token: "leftover-refresh-rotated",
      user: { id: "leftover-user" },
    });
    window.localStorage.setItem("kondate.auth.supabase", leftoverPersist);
    const leftover = {
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "leftover-user" },
    } as Session;
    const googleB = {
      access_token: "google-access",
      refresh_token: "google-refresh",
      user: { id: "google-user" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    let releaseSignOut: (() => void) | undefined;
    const signOut = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSignOut = () => {
            window.localStorage.removeItem("kondate.auth.supabase");
            for (const listener of authListeners) {
              listener("SIGNED_OUT", null);
            }
            resolve({ error: null });
          };
        }),
    );
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: leftover }, error: null }),
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });

    window.localStorage.setItem("kondate.auth.supabase", googlePersist);
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", googleB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("google-user");

    window.localStorage.setItem("kondate.auth.supabase", leftoverRotationPersist);
    await act(async () => {
      releaseSignOut?.();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(googlePersist);
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("google-user");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
  });

  it("C-R2: first-pin on /auth/callback adopts Google B when live mark A remains and switch is armed", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-a", storedAt: new Date().toISOString() }),
    );
    window.localStorage.setItem(
      "kondate.auth.supabase",
      JSON.stringify({
        access_token: "token-a",
        refresh_token: "refresh-a",
        user: { id: "user-a" },
      }),
    );
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const client = {
      auth: {
        getSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("loading")).toBeInTheDocument();

    armIntentionalAuthSessionSwitch("google_callback");
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(AUTH_SESSION_SWITCH_KEY)).toBeNull();
  });

  it("C-R6: leftover getSession after switch first-pin does not wipe Google B", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-a", storedAt: new Date().toISOString() }),
    );
    const persistA = JSON.stringify({
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    });
    const persistB = JSON.stringify({
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    });
    window.localStorage.setItem("kondate.auth.supabase", persistA);
    const sessionA = {
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const heldGetSessions: Array<(session: Session) => void> = [];
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          heldGetSessions.push((session) => {
            resolve({ data: { session }, error: null });
          });
        }),
    );
    const client = {
      auth: {
        getSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    const first = render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("loading")).toBeInTheDocument();

    armIntentionalAuthSessionSwitch("google_callback");
    window.localStorage.setItem("kondate.auth.supabase", persistB);
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");

    await act(async () => {
      for (const release of heldGetSessions) {
        release(sessionA);
      }
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(persistB);
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();

    first.unmount();
    const remountGetSession = vi.fn().mockResolvedValue({
      data: { session: sessionB },
      error: null,
    });
    const remountClient = {
      auth: {
        getSession: remountGetSession,
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;
    render(
      <AuthProvider
        client={remountClient}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(persistB);
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
  });

  it("C-R7: delayed leftover refuse signOut does not wipe same-user Google B persist", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    const leftoverPersist = JSON.stringify({
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "same-user" },
    });
    const googlePersist = JSON.stringify({
      access_token: "google-access",
      refresh_token: "google-refresh",
      user: { id: "same-user" },
    });
    window.localStorage.setItem("kondate.auth.supabase", leftoverPersist);
    const leftover = {
      access_token: "leftover-access",
      refresh_token: "leftover-refresh",
      user: { id: "same-user" },
    } as Session;
    const googleB = {
      access_token: "google-access",
      refresh_token: "google-refresh",
      user: { id: "same-user" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    let releaseSignOut: (() => void) | undefined;
    const signOut = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSignOut = () => {
            window.localStorage.removeItem("kondate.auth.supabase");
            for (const listener of authListeners) {
              listener("SIGNED_OUT", null);
            }
            resolve({ error: null });
          };
        }),
    );
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: leftover }, error: null }),
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });

    window.localStorage.setItem("kondate.auth.supabase", googlePersist);
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", googleB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("same-user");

    await act(async () => {
      releaseSignOut?.();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(googlePersist);
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("same-user");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
  });

  it("C-R8: leftover rotation getSession after switch first-pin does not wipe Google B", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-a", storedAt: new Date().toISOString() }),
    );
    const persistA = JSON.stringify({
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    });
    const persistB = JSON.stringify({
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    });
    window.localStorage.setItem("kondate.auth.supabase", persistA);
    const sessionA2 = {
      access_token: "token-a-rotated",
      refresh_token: "refresh-a-rotated",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const heldGetSessions: Array<(session: Session) => void> = [];
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          heldGetSessions.push((session) => {
            resolve({ data: { session }, error: null });
          });
        }),
    );
    const client = {
      auth: {
        getSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    const first = render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("loading")).toBeInTheDocument();

    armIntentionalAuthSessionSwitch("google_callback");
    window.localStorage.setItem("kondate.auth.supabase", persistB);
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");

    await act(async () => {
      for (const release of heldGetSessions) {
        release(sessionA2);
      }
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(persistB);
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();

    first.unmount();
    const remountGetSession = vi.fn().mockResolvedValue({
      data: { session: sessionB },
      error: null,
    });
    const remountClient = {
      auth: {
        getSession: remountGetSession,
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;
    render(
      <AuthProvider
        client={remountClient}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(persistB);
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
  });

  it("C-R10: unmarked leftover rotation getSession after first-pin does not wipe Google B", async () => {
    window.history.replaceState(null, "", "/auth/callback?flow=flow-1");
    const persistA = JSON.stringify({
      access_token: "token-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    });
    const persistB = JSON.stringify({
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    });
    window.localStorage.setItem("kondate.auth.supabase", persistA);
    const sessionA2 = {
      access_token: "token-a-rotated",
      refresh_token: "refresh-a-rotated",
      user: { id: "user-a" },
    } as Session;
    const sessionB = {
      access_token: "token-b",
      refresh_token: "refresh-b",
      user: { id: "user-b" },
    } as Session;
    const authListeners: AuthStateListener[] = [];
    const heldGetSessions: Array<(session: Session) => void> = [];
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          heldGetSessions.push((session) => {
            resolve({ data: { session }, error: null });
          });
        }),
    );
    const client = {
      auth: {
        getSession,
        signOut,
        onAuthStateChange: (cb: AuthStateListener) => {
          authListeners.push(cb);
          return { data: { subscription: createAuthSubscription() } };
        },
      },
    } satisfies AuthProviderClient;

    const first = render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("loading")).toBeInTheDocument();

    armIntentionalAuthSessionSwitch("google_callback");
    window.localStorage.setItem("kondate.auth.supabase", persistB);
    await act(async () => {
      for (const listener of authListeners) {
        listener("SIGNED_IN", sessionB);
      }
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    // C-R9: unmarked の first-pin は switch を消費しない
    expect(window.sessionStorage.getItem(AUTH_SESSION_SWITCH_KEY)).not.toBeNull();

    await act(async () => {
      for (const release of heldGetSessions) {
        release(sessionA2);
      }
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(persistB);
    expect(screen.getByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();

    first.unmount();
    // kind: complete の commitLiveAuthSessionMark(B) 相当。印なし remount は persist B を
    // unmarked leftover として拒否する（既存 C4）。C-R10 の失敗端は persist A2 か wipe。
    window.localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-b", storedAt: new Date().toISOString() }),
    );
    const remountGetSession = vi.fn().mockResolvedValue({
      data: { session: sessionB },
      error: null,
    });
    const remountClient = {
      auth: {
        getSession: remountGetSession,
        signOut: vi.fn().mockResolvedValue({ error: null }),
        onAuthStateChange: () => ({
          data: { subscription: createAuthSubscription() },
        }),
      },
    } satisfies AuthProviderClient;
    render(
      <AuthProvider
        client={remountClient}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={vi.fn()}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(document.title).toBe("user-b");
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBe(persistB);
    expect(screen.queryByText("authenticated:degraded")).not.toBeInTheDocument();
  });
});
