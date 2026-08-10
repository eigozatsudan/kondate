import type { Session } from "@supabase/supabase-js";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AuthProvider,
  COLD_START_GET_SESSION_TIMEOUT_MS,
  COLD_START_SESSION_DEADLINE_MS,
  type AuthProviderClient,
} from "./auth-provider";
import { useAuth } from "./use-auth";

const session = { access_token: "token", user: { id: "user-1" } } as Session;
type AuthSubscription = ReturnType<
  AuthProviderClient["auth"]["onAuthStateChange"]
>["data"]["subscription"];

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
  return <output>{auth.status}</output>;
}

describe("AuthProvider", () => {
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
    expect(recovery).toHaveBeenCalledOnce();
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

    render(
      <AuthProvider
        client={client}
        recoveryGateway={{ resumeFlow: vi.fn() }}
        startRecovery={(input) => {
          completeRecovery = input.onComplete;
          return vi.fn();
        }}
      >
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("unauthenticated");

    await act(async () => {
      completeRecovery?.({ kind: "complete", flowId: "flow-1", returnTo: "/onboarding" });
      await Promise.resolve();
    });

    expect(
      JSON.parse(
        window.localStorage.getItem("kondate.auth.supabase.continuation-complete.flow-1") ?? "null",
      ),
    ).toEqual({ flowId: "flow-1", returnTo: "/onboarding" });
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
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error(`secret:${"A".repeat(43)}`);
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
      expect(completeRecovery).toBeTypeOf("function");

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
          newValue: JSON.stringify({ flowId: "flow-1", returnTo: "/onboarding" }),
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
    expect(completeRecovery).toBeTypeOf("function");

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
    window.history.replaceState(null, "", "/login");
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
    expect(recovery.mock.calls.length).toBeGreaterThanOrEqual(1);
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

  it("C5/C6/C7: soft SIGNED_OUT clears drafts/feedback but preserves in-flight flow secret", async () => {
    window.history.replaceState(null, "", "/planner");
    window.localStorage.clear();
    window.localStorage.setItem(
      "kondate:generation:v2",
      JSON.stringify({ kind: "regenerate_menu", request: { changeReason: "自由記述の下書き" } }),
    );
    window.localStorage.setItem(
      "kondate:feedback:ambiguous-fingerprint",
      "bug_report\nアレルギー free-form",
    );
    // C7: soft 失効は進行中 continuation secret を焼かない（cold-start RR1 と同型）
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
    // C3/C10: pending code / PKCE verifier は soft でも消す
    window.localStorage.setItem(
      pendingKey,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    window.localStorage.setItem("kondate.auth.supabase-code-verifier", "pkce-verifier");
    const authListeners: Array<(event: string, next: Session | null) => void> = [];
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: (cb: (event: string, next: Session | null) => void) => {
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
    expect(window.localStorage.getItem(flowKey)).not.toBeNull();
    expect(window.localStorage.getItem(pendingKey)).toBeNull();
    expect(window.localStorage.getItem("kondate.auth.supabase-code-verifier")).toBeNull();
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
          newValue: JSON.stringify({ flowId: otherFlowId, returnTo: "/planner" }),
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
          newValue: JSON.stringify({ flowId: waitingFlowId, returnTo: "/onboarding" }),
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
      JSON.stringify({ flowId: flowB, returnTo: "/onboarding" }),
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
          newValue: JSON.stringify({ flowId: flowB, returnTo: "/onboarding" }),
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
});
