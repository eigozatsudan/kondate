import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthProvider,
  COLD_START_GET_SESSION_TIMEOUT_MS,
  COLD_START_SESSION_DEADLINE_MS,
  type AuthProviderClient,
} from "./auth-provider";
import { clearSoftResidualRecoverySuppressed } from "./auth-cleanup";
import { ACTIVE_LOGIN_FLOW_STORAGE_KEY, createAuthFlow } from "./auth-flow";
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

describe("AuthProvider", () => {
  beforeEach(() => {
    // residual recovery は /login + 非 suppress 前提。前テストの path / 印を毎回落とす。
    window.history.replaceState(null, "", "/");
    try {
      window.localStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    // R1: module pin ゲートが他テストへ漏れないようにする
    resetAccessTokenPinGateForTests();
    // C4/R3: soft residual 共有 suppress が次テストを止めないようにする。
    // clearSoftResidualRecoverySuppressed は R4 re-arm を発火するため、teardown では
    // storage を直接落としてマウント中 Provider への act 外 setState を避ける。
    try {
      window.localStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem("kondate.auth.soft-residual-recovery-suppress");
      window.sessionStorage.removeItem(ACTIVE_LOGIN_FLOW_STORAGE_KEY);
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
    expect(window.localStorage.getItem(pendingKey)).not.toBeNull();
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
    window.localStorage.setItem(
      `kondate.auth.supabase.pending-deposit.${flowId}`,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
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
    // R3: secret/pending は残っている（burn ではなく suppress）
    expect(window.localStorage.getItem(`kondate.auth.flow.${flowId}`)).not.toBeNull();
    expect(
      window.localStorage.getItem(`kondate.auth.supabase.pending-deposit.${flowId}`),
    ).not.toBeNull();
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

    // R4: createAuthFlow / clearSoft 相当 — remount なしで re-arm
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
    const startRecovery = vi.fn<(input: { targetFlowId?: string }) => () => void>();
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
    // C2: 再武装は今開始した flow だけ（prior 全件ではない）
    expect(startRecovery.mock.calls.at(-1)?.[0]?.targetFlowId).toBe(
      "10000000-0000-4000-8000-0000000000a4",
    );
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
    const startRecovery = vi.fn<(input: { targetFlowId?: string }) => () => void>();
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
    expect(lastInput?.targetFlowId).toBe(newFlowId);
    expect(lastInput?.targetFlowId).not.toBe(priorFlowId);
    // R3: prior-user secret / pending は焼かない
    expect(window.localStorage.getItem(`kondate.auth.flow.${priorFlowId}`)).not.toBeNull();
    expect(
      window.localStorage.getItem(`kondate.auth.supabase.pending-deposit.${priorFlowId}`),
    ).not.toBeNull();
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

  it("C4: fail-closed stays unauthenticated after hung getSession settles; createAuthFlow can apply", async () => {
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
      await act(async () => {
        for (const listener of authListeners) {
          listener("SIGNED_IN", session);
        }
        await Promise.resolve();
      });
      expect(screen.getByText("authenticated")).toBeInTheDocument();
    } finally {
      window.localStorage.clear();
      vi.useRealTimers();
    }
  });
});
