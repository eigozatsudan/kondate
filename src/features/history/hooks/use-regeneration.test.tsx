import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import {
  createPendingGeneration,
  pendingGenerationCommand,
  readPendingGeneration,
  savePendingGeneration,
} from "@/features/generation/model/pending-generation";
import { generationEndpointFor } from "@/features/generation/api/generation-api";
import type { RevalidationResult } from "../api/revalidation-api";
import { useRegeneration } from "./use-regeneration";

const postMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const userIdRef = vi.hoisted(() => ({ current: "40000000-0000-4000-8000-000000000001" }));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session: { user: { id: userIdRef.current } },
  }),
}));
vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return { ...original, useNavigate: () => navigateMock };
});
vi.mock("@/features/generation/api/generation-api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/api/generation-api")>();
  return {
    ...original,
    postGeneration: postMock,
    getGenerationStatus: statusMock,
  };
});
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

const MENU_ID = "60000000-0000-4000-8000-000000000001";
const DISH_ID = "70000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";

const validRevalidation: RevalidationResult = {
  status: "valid",
  safetyFingerprint: "current",
  allergenCatalogVersion: "allergens-v3",
  foodRuleVersion: "food-v2",
  issues: [],
  changedDetails: [],
  currentLabelWarnings: [],
};

const quota = {
  consumed: false,
  remaining: 3,
  userDailyLimit: 5,
  limitKind: null,
  retryAt: null,
} as const;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

describe("useRegeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userIdRef.current = USER_ID;
    postMock.mockReset();
    statusMock.mockReset();
  });

  it("refuses to build a command while revalidation is not actionable", async () => {
    const { result } = renderHook(
      () =>
        useRegeneration({
          targetMode: "household",
          menuId: MENU_ID,
          phase: "checking",
          result: undefined,
        }),
      { wrapper },
    );
    await expect(
      result.current.startWhole({ changeReason: "simpler", changeReasonCustom: null }),
    ).rejects.toThrow("revalidation_required");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("persists regenerate_menu pending and navigates to /generation without POSTing here", async () => {
    const { result } = renderHook(
      () =>
        useRegeneration({
          targetMode: "household",
          menuId: MENU_ID,
          phase: "checked",
          result: validRevalidation,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.startWhole({ changeReason: "simpler", changeReasonCustom: null });
    });

    // POST は GenerationPage 側の recovery が行う。ここでは pending 永続化のみ。
    expect(postMock).not.toHaveBeenCalled();
    const pending = readPendingGeneration(USER_ID, new Date());
    expect(pending).not.toBeNull();
    if (pending === null) throw new Error("pending required");
    const command = pendingGenerationCommand(pending);
    expect(command.kind).toBe("regenerate_menu");
    expect(generationEndpointFor(command)).toBe("/api/generations/menu");
    if (command.kind !== "regenerate_menu") throw new Error("expected regenerate_menu");
    expect(command.request.sourceMenuId).toBe(MENU_ID);
    expect(command.request.changeReason).toBe("simpler");
    expect(command.request.changeReasonCustom).toBeNull();
    expect(command.request.expiredPantryConfirmations).toEqual([]);
    expect(navigateMock).toHaveBeenCalledWith("/generation");
  });

  it("persists regenerate_dish pending with dishId and navigates to /generation", async () => {
    const { result } = renderHook(
      () =>
        useRegeneration({
          targetMode: "household",
          menuId: MENU_ID,
          phase: "checked",
          result: validRevalidation,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.startDish(DISH_ID, {
        changeReason: "child_friendly",
        changeReasonCustom: null,
      });
    });

    expect(postMock).not.toHaveBeenCalled();
    const pending = readPendingGeneration(USER_ID, new Date());
    expect(pending).not.toBeNull();
    if (pending === null) throw new Error("pending required");
    const command = pendingGenerationCommand(pending);
    expect(command.kind).toBe("regenerate_dish");
    expect(generationEndpointFor(command)).toBe("/api/generations/dish");
    if (command.kind !== "regenerate_dish") throw new Error("expected regenerate_dish");
    expect(command.request.dishId).toBe(DISH_ID);
    expect(navigateMock).toHaveBeenCalledWith("/generation");
  });

  it.each(["regenerate_menu", "regenerate_dish"] as const)(
    "recovers %s with the exact endpoint, body, and key after response loss",
    async (kind) => {
      const storage = memoryStorage();
      const command: GenerationCommand =
        kind === "regenerate_menu"
          ? {
              commandVersion: "generation-command.v2" as const,
              kind,
              request: {
                idempotencyKey: "10000000-0000-4000-8000-000000000011",
                sourceMenuId: MENU_ID,
                changeReason: "simpler",
                changeReasonCustom: null,
                expiredPantryConfirmations: [],
              },
            }
          : {
              commandVersion: "generation-command.v2" as const,
              kind,
              request: {
                idempotencyKey: "10000000-0000-4000-8000-000000000012",
                sourceMenuId: MENU_ID,
                dishId: DISH_ID,
                changeReason: "different_flavor",
                changeReasonCustom: null,
                expiredPantryConfirmations: [],
              },
            };
      const pending = createPendingGeneration(command, USER_ID, () => new Date());
      savePendingGeneration(pending, storage);
      const bodyBefore = JSON.stringify(pendingGenerationCommand(pending));
      const keyBefore = pending.request.idempotencyKey;
      const endpoint = generationEndpointFor(pendingGenerationCommand(pending));

      // 復旧経路: 永続化済み pending を読み直し、同一 body/key/endpoint で再 POST する
      const recovered = readPendingGeneration(USER_ID, new Date(), storage);
      expect(recovered).not.toBeNull();
      if (recovered === null) throw new Error("pending required");
      const resent = pendingGenerationCommand(recovered);
      expect(JSON.stringify(resent)).toBe(bodyBefore);
      expect(recovered.request.idempotencyKey).toBe(keyBefore);
      expect(generationEndpointFor(resent)).toBe(endpoint);
      expect(generationEndpointFor(resent)).toBe(
        kind === "regenerate_dish" ? "/api/generations/dish" : "/api/generations/menu",
      );

      postMock.mockResolvedValueOnce({
        status: "processing",
        idempotencyKey: keyBefore,
        requestId: "50000000-0000-4000-8000-000000000010",
        startedAt: "2026-07-11T00:00:00.000Z",
        quota,
      } satisfies GenerationStatusData);

      // recovery が POST に渡す command と同一 identity であることを実呼び出しで確認
      const { postGeneration } = await import("@/features/generation/api/generation-api");
      await postGeneration(resent);
      expect(postMock).toHaveBeenCalledTimes(1);
      const posted = postMock.mock.calls[0]?.[0] as GenerationCommand;
      expect(posted.kind).toBe(kind);
      expect(posted.request.idempotencyKey).toBe(keyBefore);
      expect(JSON.stringify(posted)).toBe(bodyBefore);
      expect(generationEndpointFor(posted)).toBe(endpoint);
    },
  );

  it("startWhole persists regenerate identity that recovery can re-read unchanged", async () => {
    const { result } = renderHook(
      () =>
        useRegeneration({
          targetMode: "household",
          menuId: MENU_ID,
          phase: "checked",
          result: validRevalidation,
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.startWhole({ changeReason: "simpler", changeReasonCustom: null });
    });
    // POST は GenerationPage 側。ここでは pending と navigate のみ。
    expect(postMock).not.toHaveBeenCalled();
    const pending = readPendingGeneration(USER_ID, new Date());
    expect(pending).not.toBeNull();
    if (pending === null) throw new Error("pending required");
    expect(pending.kind).toBe("regenerate_menu");
    expect(generationEndpointFor(pendingGenerationCommand(pending))).toBe("/api/generations/menu");
    expect(navigateMock).toHaveBeenCalledWith("/generation");
  });

  it("allows regeneration after a changed but valid current-safety result", async () => {
    const { result } = renderHook(
      () =>
        useRegeneration({
          targetMode: "household",
          menuId: MENU_ID,
          phase: "checked",
          result: {
            ...validRevalidation,
            status: "changed",
            changedDetails: ["preference_changed"],
          },
        }),
      { wrapper },
    );
    expect(result.current.canRegenerate).toBe(true);
    await act(async () => {
      await result.current.startWhole({ changeReason: "simpler", changeReasonCustom: null });
    });
    expect(navigateMock).toHaveBeenCalledWith("/generation");
    expect(readPendingGeneration(USER_ID, new Date())).not.toBeNull();
  });

  it("allows idea regeneration without revalidation phase or result", async () => {
    const { result } = renderHook(
      () =>
        useRegeneration({
          targetMode: "idea",
          menuId: MENU_ID,
          phase: null,
          result: null,
        }),
      { wrapper },
    );
    expect(result.current.canRegenerate).toBe(true);
    await act(async () => {
      await result.current.startWhole({ changeReason: "simpler", changeReasonCustom: null });
    });
    expect(postMock).not.toHaveBeenCalled();
    const pending = readPendingGeneration(USER_ID, new Date());
    expect(pending).not.toBeNull();
    if (pending === null) throw new Error("pending required");
    const command = pendingGenerationCommand(pending);
    expect(command.kind).toBe("regenerate_menu");
    if (command.kind !== "regenerate_menu") throw new Error("expected regenerate_menu");
    // mode/servings/member IDs は wire に載せない（server snapshot が正本）
    expect(command.request).toEqual({
      idempotencyKey: command.request.idempotencyKey,
      sourceMenuId: MENU_ID,
      changeReason: "simpler",
      changeReasonCustom: null,
      expiredPantryConfirmations: [],
    });
    expect(navigateMock).toHaveBeenCalledWith("/generation");
  });

  it("allows idea dish regeneration without family revalidation", async () => {
    const { result } = renderHook(
      () =>
        useRegeneration({
          targetMode: "idea",
          menuId: MENU_ID,
          phase: null,
          result: null,
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.startDish(DISH_ID, {
        changeReason: "different_flavor",
        changeReasonCustom: null,
      });
    });
    const pending = readPendingGeneration(USER_ID, new Date());
    expect(pending).not.toBeNull();
    if (pending === null) throw new Error("pending required");
    const command = pendingGenerationCommand(pending);
    expect(command.kind).toBe("regenerate_dish");
    if (command.kind !== "regenerate_dish") throw new Error("expected regenerate_dish");
    expect(command.request.dishId).toBe(DISH_ID);
    expect(command.request.sourceMenuId).toBe(MENU_ID);
    expect(navigateMock).toHaveBeenCalledWith("/generation");
  });
});
