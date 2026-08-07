import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
} from "@/features/household/household-queries";
import type { RevalidationResult } from "../api/revalidation-api";
import { useMenuRevalidation } from "./use-menu-revalidation";

const revalidateMenuMock = vi.hoisted(() => vi.fn());
const channelHandlers = vi.hoisted(() => ({
  members: null as null | (() => void),
  allergies: null as null | (() => void),
  statusCallback: null as null | ((status: string) => void),
  unsubscribe: vi.fn(),
}));

vi.mock("../api/revalidation-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/revalidation-api")>();
  return {
    ...original,
    revalidateMenu: revalidateMenuMock,
  };
});

// H12: storage 判定が userId 束縛になったため session を供給する
vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session: { user: { id: "40000000-0000-4000-8000-000000000001" } },
  }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    channel: () => {
      const api = {
        on: (_event: string, filter: { table?: string }, callback: () => void) => {
          if (filter.table === "household_members") channelHandlers.members = callback;
          if (filter.table === "member_allergies") channelHandlers.allergies = callback;
          return api;
        },
        subscribe: (cb?: (status: string) => void) => {
          channelHandlers.statusCallback = cb ?? null;
          return api;
        },
        unsubscribe: channelHandlers.unsubscribe,
      };
      return api;
    },
  }),
}));

const MENU_ID = "30000000-0000-4000-8000-000000000001";
const valid: RevalidationResult = {
  status: "valid",
  safetyFingerprint: "current",
  allergenCatalogVersion: "allergens-v3",
  foodRuleVersion: "food-v2",
  issues: [],
  changedDetails: [],
  currentLabelWarnings: [],
};

const invalid: RevalidationResult = {
  ...valid,
  status: "invalid",
  safetyFingerprint: "invalid-fp",
  issues: [{ code: "allergen_present", path: "dishes.0", message: "アレルゲンが含まれます" }],
};

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useMenuRevalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelHandlers.members = null;
    channelHandlers.allergies = null;
    channelHandlers.statusCallback = null;
    revalidateMenuMock.mockResolvedValue(valid);
  });

  afterEach(() => {
    vi.useRealTimers();
    // HR4 等が document.visibilityState を上書きしたまま残さない
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
    } catch {
      // ignore
    }
  });

  it("enters checking on mount and resolves to checked", async () => {
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    expect(result.current.phase).toBe("checking");
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    expect(result.current.result?.status).toBe("valid");
  });

  it("fails closed on same-tab safety event then recovers", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
    });
    expect(result.current.phase).toBe("checking");
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("fails closed on other-tab storage revision events", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: householdSafetyRevisionStorageKey,
          newValue: crypto.randomUUID(),
        }),
      );
    });
    expect(result.current.phase).toBe("checking");
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("fails closed on realtime household member and allergy callbacks", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    expect(channelHandlers.members).not.toBeNull();
    expect(channelHandlers.allergies).not.toBeNull();
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      channelHandlers.members?.();
    });
    expect(result.current.phase).toBe("checking");
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("keeps checking when an older in-flight revalidation settles after a newer one started", async () => {
    const first = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    expect(result.current.phase).toBe("checking");

    act(() => {
      first.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });

    const older = deferredPromise<RevalidationResult>();
    const newer = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    act(() => {
      window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();

    act(() => {
      window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
    });
    expect(result.current.phase).toBe("checking");

    const stale: RevalidationResult = {
      ...valid,
      safetyFingerprint: "stale-older",
      status: "changed",
      changedDetails: ["preference_changed"],
    };
    const fresh: RevalidationResult = {
      ...valid,
      safetyFingerprint: "fresh-latest",
    };

    act(() => {
      older.resolve(stale);
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();

    act(() => {
      newer.resolve(fresh);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    expect(result.current.result?.safetyFingerprint).toBe("fresh-latest");
  });

  it("beginRecheck forces checking synchronously before the next fetch settles", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      result.current.beginRecheck();
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("keeps checked result during soft recheck (focus / background poll path)", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    expect(result.current.isSoftRechecking).toBe(false);
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      result.current.beginSoftRecheck();
    });
    expect(result.current.phase).toBe("checked");
    expect(result.current.result?.status).toBe("valid");
    // HR1: 本文用 phase は checked のまま、CTA 用 isSoftRechecking だけ true
    await waitFor(() => {
      expect(result.current.isSoftRechecking).toBe(true);
    });
    expect(result.current.phase).toBe("checked");
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
      expect(result.current.isSoftRechecking).toBe(false);
    });
  });

  it("soft recheck on window focus does not enter checking when already checked", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.phase).toBe("checked");
    expect(result.current.result).toEqual(valid);
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("soft recheck resolving to invalid keeps phase checked with invalid status", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      result.current.beginSoftRecheck();
    });
    expect(result.current.phase).toBe("checked");
    expect(result.current.result?.status).toBe("valid");
    act(() => {
      deferred.resolve(invalid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
      expect(result.current.result?.status).toBe("invalid");
    });
    expect(result.current.result?.issues[0]?.code).toBe("allergen_present");
  });

  it("soft network failure closes gate (error) instead of reopening last-known-good valid", async () => {
    // H5: 検知〜再検査完了まで fail-closed。soft 失敗で旧 valid の CTA を開かない。
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      result.current.beginSoftRecheck();
    });
    // soft 飛行中は focus 点滅防止のため checked のまま
    expect(result.current.phase).toBe("checked");
    act(() => {
      deferred.reject(new Error("network"));
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });
    expect(result.current.result).toBeUndefined();
    expect(result.current.errorMessage).toMatch(/network|確認できませんでした/u);
  });

  it("hard recheck network failure ends in error without reopening prior valid", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      result.current.beginHardRecheck();
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    act(() => {
      deferred.reject(new Error("network"));
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });
    expect(result.current.result).toBeUndefined();
    expect(result.current.errorMessage).toMatch(/network|確認できませんでした/u);
  });

  it("soft in-flight then hard safety event drops to checking without prior result", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const softFlight = deferredPromise<RevalidationResult>();
    const hardFlight = deferredPromise<RevalidationResult>();
    revalidateMenuMock
      .mockReturnValueOnce(softFlight.promise)
      .mockReturnValueOnce(hardFlight.promise);
    act(() => {
      result.current.beginSoftRecheck();
    });
    expect(result.current.phase).toBe("checked");
    act(() => {
      window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    // soft が後から成功しても hard 未完了なら checking のまま
    act(() => {
      softFlight.resolve(valid);
    });
    expect(result.current.phase).toBe("checking");
    act(() => {
      hardFlight.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("online recovery uses hard recheck (not soft)", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const deferred = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferred.promise);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    act(() => {
      deferred.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("offline during soft recheck keeps checking even when soft settles (HR3)", async () => {
    // soft 飛行中に offline → soft が成功終端しても finally が forcedChecking を下ろさない。
    // online hard が成功するまで CTA を再開放しない。
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const softFlight = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(softFlight.promise);
    act(() => {
      result.current.beginSoftRecheck();
    });
    expect(result.current.phase).toBe("checked");
    await waitFor(() => {
      expect(result.current.isSoftRechecking).toBe(true);
    });

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    expect(result.current.isSoftRechecking).toBe(false);

    // 遅延 soft 成功でも offline hold の世代が進んでいるため checking のまま
    act(() => {
      softFlight.resolve(valid);
    });
    // マイクロタスクで finally が走っても phase が checked に戻らないこと
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    expect(result.current.isSoftRechecking).toBe(false);

    // online 復帰の hard で初めて checked へ戻る
    const onlineFlight = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(onlineFlight.promise);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.phase).toBe("checking");
    act(() => {
      onlineFlight.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    expect(result.current.result?.status).toBe("valid");
  });

  it("offline alone forces checking until online hard succeeds (HR3)", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    // HR1: offline hold フラグで UI が接続誘導 copy に切り替えられる
    expect(result.current.isOfflineHold).toBe(true);

    const onlineFlight = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(onlineFlight.promise);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    // online hard 開始で offline 専用文言は下ろす（通常 checking へ）
    expect(result.current.isOfflineHold).toBe(false);
    expect(result.current.phase).toBe("checking");
    act(() => {
      onlineFlight.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    expect(result.current.isOfflineHold).toBe(false);
  });

  it("HR4: focus soft during offline hold does not collapse hold to error", async () => {
    // offline hold 中に focus soft が POST を起こすと finally で forcedChecking が下り
    // phase=error になり hold 専用 overlay 契約が崩れる。soft を no-op にして sticky に保つ。
    const { result, unmount } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const callsAfterMount = revalidateMenuMock.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.isOfflineHold).toBe(true);

    const visibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      window.dispatchEvent(new Event("focus"));
    });
    // soft は立たない（追加 POST なし）
    expect(revalidateMenuMock.mock.calls.length).toBe(callsAfterMount);
    expect(result.current.phase).toBe("checking");
    expect(result.current.isOfflineHold).toBe(true);
    expect(result.current.errorMessage).toBeUndefined();

    // beginSoftRecheck 直接呼び出しも hold 中は no-op
    act(() => {
      result.current.beginSoftRecheck();
    });
    expect(revalidateMenuMock.mock.calls.length).toBe(callsAfterMount);
    expect(result.current.isOfflineHold).toBe(true);

    // 後続ケースのマウント初期化を壊さないよう visibility / online を復元
    act(() => {
      if (visibilityDescriptor !== undefined) {
        Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      } else {
        // jsdom 既定へ戻す
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
      }
      window.dispatchEvent(new Event("online"));
    });
    unmount();
  });

  it("hard rechecks on Realtime CHANNEL_ERROR and TIMED_OUT (HR2)", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    expect(channelHandlers.statusCallback).not.toBeNull();

    const deferredError = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferredError.promise);
    act(() => {
      channelHandlers.statusCallback?.("CHANNEL_ERROR");
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    act(() => {
      deferredError.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });

    const deferredTimeout = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(deferredTimeout.promise);
    act(() => {
      channelHandlers.statusCallback?.("TIMED_OUT");
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();
    act(() => {
      deferredTimeout.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
  });

  it("does not hard recheck on SUBSCRIBED alone", async () => {
    const { result } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });
    const before = revalidateMenuMock.mock.calls.length;
    act(() => {
      channelHandlers.statusCallback?.("SUBSCRIBED");
    });
    expect(result.current.phase).toBe("checked");
    expect(revalidateMenuMock.mock.calls.length).toBe(before);
  });

  it("E2E1 seam: __KONDATE_REVALIDATE_POLL_MS=0 disables soft poll interval", async () => {
    // signal 専用 E2E と 2s poll を混線させないため 0 は soft poll 用 setInterval を張らない
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    (
      window as Window & { __KONDATE_REVALIDATE_POLL_MS?: number }
    ).__KONDATE_REVALIDATE_POLL_MS = 0;
    try {
      const { unmount } = renderHook(() => useMenuRevalidation(MENU_ID), { wrapper });
      await waitFor(() => {
        expect(revalidateMenuMock).toHaveBeenCalled();
      });
      // soft poll 候補（0 / 短縮 2s / 既定 60s）が interval 登録されていないこと。
      // waitFor 等の短周期 interval は対象外。
      const softPollTimers = setIntervalSpy.mock.calls.filter(
        (call) => call[1] === 0 || call[1] === 2_000 || call[1] === 60_000,
      );
      expect(softPollTimers).toHaveLength(0);
      unmount();
    } finally {
      delete (window as Window & { __KONDATE_REVALIDATE_POLL_MS?: number })
        .__KONDATE_REVALIDATE_POLL_MS;
      setIntervalSpy.mockRestore();
    }
  });

  // 60 秒 poll は history-detail-page の sixty-second-poll ケースで page 統合として検証する
});
