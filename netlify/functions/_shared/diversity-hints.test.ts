import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIVERSITY_HINTS_ENABLED,
  DIVERSITY_SYSTEM_MARKER,
  RECENT_DISH_HINTS_MAX,
  RECENT_DISH_HINTS_TIMEOUT_MS,
  RECENT_MENUS_LIMIT,
  flattenRecentDishHints,
  loadRecentDishHints,
} from "./diversity-hints.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeOwnerClient(result: {
  data: unknown;
  error: { message?: string } | null;
  delayMs?: number;
}): unknown {
  const delayMs = result.delayMs ?? 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () =>
              new Promise((resolve) => {
                setTimeout(() => {
                  resolve({ data: result.data, error: result.error });
                }, delayMs);
              }),
          }),
        }),
      }),
    }),
  };
}

describe("diversity-hints constants", () => {
  it("locks default-on flag, marker, timeout, and caps", () => {
    expect(DIVERSITY_HINTS_ENABLED).toBe(true);
    expect(DIVERSITY_SYSTEM_MARKER).toBe("【多様性ヒント】");
    expect(RECENT_DISH_HINTS_TIMEOUT_MS).toBe(200);
    expect(RECENT_MENUS_LIMIT).toBe(10);
    expect(RECENT_DISH_HINTS_MAX).toBe(24);
  });
});

describe("flattenRecentDishHints", () => {
  it("flattens max 24; same position sorts by id; empty names dropped first", () => {
    const menuRecent = {
      id: "menu-new",
      created_at: "2026-07-30T10:00:00.000Z",
      dishes: [
        { id: "d-b", name: "B", role: "side", position: 1 },
        { id: "d-a", name: "A", role: "main", position: 1 },
        { id: "d-empty", name: "   ", role: "soup", position: 0 },
        { id: "d-null", name: null, role: "main", position: 0 },
        { id: "d-c", name: "C", role: "", position: 2 },
      ],
    };
    // 古い menu 側は 24 を超えたら切られる。新しい menu で枠を埋める。
    const fillerDishes = Array.from({ length: 23 }, (_, index) => ({
      id: `fill-${String(index).padStart(2, "0")}`,
      name: `Fill${String(index)}`,
      role: "side",
      position: index,
    }));
    const menuOld = {
      id: "menu-old",
      created_at: "2026-07-01T10:00:00.000Z",
      dishes: [
        ...fillerDishes,
        { id: "old-keep", name: "ShouldDropIfCapped", role: "main", position: 99 },
      ],
    };

    // 新しい menu だけ（空名破棄後: A,B,C の 3 + 古い側）
    const three = flattenRecentDishHints([menuRecent]);
    expect(three).toEqual([
      { dishName: "A", role: "main" },
      { dishName: "B", role: "side" },
      { dishName: "C" },
    ]);

    const capped = flattenRecentDishHints([menuRecent, menuOld]);
    expect(capped).toHaveLength(24);
    expect(capped[0]).toEqual({ dishName: "A", role: "main" });
    expect(capped[1]).toEqual({ dishName: "B", role: "side" });
    expect(capped[2]).toEqual({ dishName: "C" });
    expect(capped.some((hint) => hint.dishName === "ShouldDropIfCapped")).toBe(false);
    // 23 fillers + 3 from recent = 26 raw candidates; cap keeps 24 so last filler may drop
    expect(capped[23]?.dishName).toMatch(/^Fill/);
  });
});

describe("loadRecentDishHints", () => {
  it("timeout returns [] without throw", async () => {
    vi.useFakeTimers();
    const ownerClient = makeOwnerClient({
      data: [
        {
          id: "m1",
          created_at: "2026-07-30T00:00:00.000Z",
          dishes: [{ id: "d1", name: "遅延料理", role: "main", position: 0 }],
        },
      ],
      error: null,
      delayMs: 5_000,
    });

    const pending = loadRecentDishHints({
      ownerClient,
      userId: "user-1",
      timeoutMs: 200,
    });
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toEqual([]);
  });

  it("returns flattened hints on success", async () => {
    const ownerClient = makeOwnerClient({
      data: [
        {
          id: "m1",
          created_at: "2026-07-30T00:00:00.000Z",
          dishes: [
            { id: "d2", name: "副菜", role: "side", position: 1 },
            { id: "d1", name: "主菜", role: "main", position: 0 },
          ],
        },
      ],
      error: null,
    });
    await expect(
      loadRecentDishHints({ ownerClient, userId: "user-1", timeoutMs: 1_000 }),
    ).resolves.toEqual([
      { dishName: "主菜", role: "main" },
      { dishName: "副菜", role: "side" },
    ]);
  });

  it("returns [] on DB error without throw", async () => {
    const ownerClient = makeOwnerClient({
      data: null,
      error: { message: "boom" },
    });
    await expect(loadRecentDishHints({ ownerClient, userId: "user-1" })).resolves.toEqual([]);
  });

  it("returns [] when ownerClient is not a query client", async () => {
    await expect(loadRecentDishHints({ ownerClient: null, userId: "user-1" })).resolves.toEqual([]);
  });
});
