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
  unsubscribe: vi.fn(),
}));

vi.mock("../api/revalidation-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/revalidation-api")>();
  return {
    ...original,
    revalidateMenu: revalidateMenuMock,
  };
});

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    channel: () => {
      const api = {
        on: (_event: string, filter: { table?: string }, callback: () => void) => {
          if (filter.table === "household_members") channelHandlers.members = callback;
          if (filter.table === "member_allergies") channelHandlers.allergies = callback;
          return api;
        },
        subscribe: () => api,
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

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
    revalidateMenuMock.mockResolvedValue(valid);
  });

  afterEach(() => {
    vi.useRealTimers();
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

    // 初回を完了させ actionable にする
    act(() => {
      first.resolve(valid);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("checked");
    });

    // 古い飛行中要求 A と、後から始まる最新要求 B を重ねる
    const older = deferredPromise<RevalidationResult>();
    const newer = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    act(() => {
      window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
    });
    expect(result.current.phase).toBe("checking");
    expect(result.current.result).toBeUndefined();

    // さらにシグナルで最新世代を進める（A が残ったまま B が始まる）
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

    // 古い A が先に解決しても、最新 B が未完了なら checking のまま（stale authority を返さない）
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

  // 60 秒 poll は history-detail-page の sixty-second-poll ケースで page 統合として検証する
  // （React Query と fake timers の組み合わせは unit では不安定）
});
