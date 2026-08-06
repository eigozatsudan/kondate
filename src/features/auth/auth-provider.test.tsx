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
        window.localStorage.getItem("kondate.auth.supabase.continuation-complete") ?? "null",
      ),
    ).toEqual({ flowId: "flow-1", returnTo: "/onboarding" });
  });

  it("refreshes the session after recovery completion when publishing fails", async () => {
    window.history.replaceState(null, "", "/login");
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
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
      await screen.findByText("authenticated");

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

      // 全体 deadline タイマーで未ログイン fail-closed
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          COLD_START_SESSION_DEADLINE_MS - COLD_START_GET_SESSION_TIMEOUT_MS,
        );
      });
      expect(screen.getByText("unauthenticated")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
