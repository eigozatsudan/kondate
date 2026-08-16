import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingIntentCycle,
  cancelPendingIntentClear,
  cancelPendingResumeSuppressClear,
  clearResumeSuppressOnDocumentBoot,
  clearShoppingIntentCycle,
  clearShoppingResumeSuppress,
  clearShoppingSheetExpected,
  discardAppendCreateCommandIfPresent,
  hasPendingCreateCommand,
  hasShoppingDidAutoOpen,
  hasShoppingIntent,
  historyPathForShopping,
  isShoppingIntentActive,
  isShoppingResumeSuppressed,
  isShoppingSheetExpected,
  markShoppingResumeSuppress,
  markShoppingSheetAutoOpened,
  menusPathForShopping,
  resetResumeSuppressDocumentBootForTests,
  scheduleIntentClear,
  scheduleResumeSuppressClear,
  shouldKeepShoppingCommandSticky,
  shoppingDidAutoOpenKey,
  shoppingIntentStorageKey,
  shoppingResumeSuppressKey,
  shoppingSheetExpectedKey,
  shoppingSheetOccupancyLockName,
  waitForShoppingSheetOccupancyRelease,
} from "./shopping-intent";
import { pendingShoppingCommandStorageKey } from "./api/shopping-api";

const MENU = "40000000-0000-4000-8000-000000000001";
const LIST = "41000000-0000-4000-8000-000000000001";

/** jsdom に無い Web Locks を、sheet occupancy の保持 / ifAvailable / 解放待ちまで模す。 */
function createFakeLockManager() {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  type FakeLockCallback = (lock: { name: string; mode: "exclusive" } | null) => unknown;
  const acquire = (name: string, callback: FakeLockCallback): Promise<unknown> => {
    held.add(name);
    const lock = { name, mode: "exclusive" as const };
    return Promise.resolve(callback(lock)).finally(() => {
      held.delete(name);
      const queued = waiters.get(name) ?? [];
      waiters.delete(name);
      for (const resume of queued) resume();
    });
  };
  return {
    isHeld: (name: string) => held.has(name),
    hold(name: string): () => void {
      held.add(name);
      return () => {
        held.delete(name);
        const queued = waiters.get(name) ?? [];
        waiters.delete(name);
        for (const resume of queued) resume();
      };
    },
    request(
      name: string,
      optionsOrCallback: LockOptions | FakeLockCallback,
      maybeCallback?: FakeLockCallback,
    ): Promise<unknown> {
      const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      if (callback === undefined) return Promise.resolve(undefined);
      if (held.has(name)) {
        if (options.ifAvailable === true) return Promise.resolve(callback(null));
        return new Promise((resolve) => {
          const queued = waiters.get(name) ?? [];
          queued.push(() => {
            resolve(acquire(name, callback));
          });
          waiters.set(name, queued);
        });
      }
      return acquire(name, callback);
    },
  };
}

function stubNavigatorLocks(locks: ReturnType<typeof createFakeLockManager>): void {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    writable: true,
    value: locks,
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetResumeSuppressDocumentBootForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
  resetResumeSuppressDocumentBootForTests();
  Reflect.deleteProperty(navigator, "locks");
});

describe("shouldKeepShoppingCommandSticky (SHOP1)", () => {
  it("keeps sticky on committed-replay 503 shopping_unavailable", () => {
    expect(shouldKeepShoppingCommandSticky("shopping_unavailable")).toBe(true);
  });

  it("keeps sticky on safety 409 and non-safety 422 from replay", () => {
    expect(shouldKeepShoppingCommandSticky("current_safety_revalidation_required")).toBe(true);
    expect(shouldKeepShoppingCommandSticky("safety_fingerprint_changed")).toBe(true);
    expect(shouldKeepShoppingCommandSticky("current_target_member_required")).toBe(true);
    expect(shouldKeepShoppingCommandSticky("idea_menu_not_supported")).toBe(true);
    expect(shouldKeepShoppingCommandSticky("menu_load_failed")).toBe(true);
  });

  it("drops sticky on list_version_conflict so true-stale can remint", () => {
    expect(shouldKeepShoppingCommandSticky("list_version_conflict")).toBe(false);
    expect(shouldKeepShoppingCommandSticky("shopping_items_limit_exceeded")).toBe(false);
    expect(shouldKeepShoppingCommandSticky(undefined)).toBe(false);
  });
});

describe("shopping-intent paths", () => {
  it("builds history and menus paths with for=shopping only", () => {
    expect(historyPathForShopping()).toBe("/history?for=shopping");
    expect(menusPathForShopping(MENU)).toBe(`/menus/${MENU}?for=shopping`);
    expect(hasShoppingIntent(new URLSearchParams("for=shopping"))).toBe(true);
    expect(hasShoppingIntent(new URLSearchParams("for=other"))).toBe(false);
  });

  it("uses kondate:shopping: storage key prefix", () => {
    expect(shoppingIntentStorageKey(MENU).startsWith("kondate:shopping:")).toBe(true);
    expect(shoppingDidAutoOpenKey(MENU).startsWith("kondate:shopping:")).toBe(true);
    expect(shoppingSheetExpectedKey(MENU).startsWith("kondate:shopping:")).toBe(true);
  });
});

describe("shopping-intent cycle", () => {
  it("begin cycle sets intent and clears did/expected", () => {
    markShoppingSheetAutoOpened(MENU);
    beginShoppingIntentCycle(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(false);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });

  it("mark auto-open sets did and expected", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(true);
  });

  it("clear expected keeps intent and did", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    clearShoppingSheetExpected(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });

  it("clear cycle removes all three keys", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    clearShoppingIntentCycle(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(false);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(false);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });
});

describe("L15 schedule/cancel", () => {
  it("schedule alone clears after timeout", () => {
    beginShoppingIntentCycle(MENU);
    scheduleIntentClear(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    vi.advanceTimersByTime(0);
    expect(isShoppingIntentActive(MENU)).toBe(false);
  });

  it("cancel after schedule keeps keys", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    scheduleIntentClear(MENU);
    cancelPendingIntentClear(MENU);
    vi.advanceTimersByTime(0);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(true);
  });
});

describe("hasPendingCreateCommand", () => {
  const command = {
    menuId: MENU,
    mode: "new" as const,
    activeListId: null,
    expectedListVersion: null,
    idempotencyKey: "00000000-0000-4000-8000-000000000099",
  };
  // fake timers 下でも age 判定が通るよう createdAtMs は it 内で付ける
  const envelope = () => JSON.stringify({ createdAtMs: Date.now(), command });

  it("returns true for fresh envelope in session", () => {
    sessionStorage.setItem(pendingShoppingCommandStorageKey("create", MENU), envelope());
    expect(hasPendingCreateCommand(MENU)).toBe(true);
  });

  it("returns true for localStorage-only envelope (SHOP3 multi-tab)", () => {
    localStorage.setItem(pendingShoppingCommandStorageKey("create", MENU), envelope());
    sessionStorage.removeItem(pendingShoppingCommandStorageKey("create", MENU));
    expect(hasPendingCreateCommand(MENU)).toBe(true);
  });

  it("returns false when missing or garbage", () => {
    expect(hasPendingCreateCommand(MENU)).toBe(false);
    sessionStorage.setItem(pendingShoppingCommandStorageKey("create", MENU), "{");
    expect(hasPendingCreateCommand(MENU)).toBe(false);
  });
});

describe("discardAppendCreateCommandIfPresent (SHOP2)", () => {
  // fake timers 下でも age 判定が通るよう envelope は it 内で作る
  const appendCommand = {
    menuId: MENU,
    mode: "append" as const,
    activeListId: LIST,
    expectedListVersion: 1,
    idempotencyKey: "00000000-0000-4000-8000-0000000000aa",
  };
  const newCommand = {
    menuId: MENU,
    mode: "new" as const,
    activeListId: null,
    expectedListVersion: null,
    idempotencyKey: "00000000-0000-4000-8000-0000000000bb",
  };
  const key = () => pendingShoppingCommandStorageKey("create", MENU);

  it("discards mode=append sticky and returns true", () => {
    sessionStorage.setItem(
      key(),
      JSON.stringify({ createdAtMs: Date.now(), command: appendCommand }),
    );
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(true);
    expect(sessionStorage.getItem(key())).toBeNull();
    expect(localStorage.getItem(key())).toBeNull();
    expect(hasPendingCreateCommand(MENU)).toBe(false);
  });

  it("discards append sticky from localStorage-only (SHOP3 multi-tab)", () => {
    // Tab A が local 正本に書いたあと、discard は両 Storage を落とす
    localStorage.setItem(
      key(),
      JSON.stringify({ createdAtMs: Date.now(), command: appendCommand }),
    );
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(true);
    expect(localStorage.getItem(key())).toBeNull();
    expect(sessionStorage.getItem(key())).toBeNull();
  });

  it("keeps mode=new sticky (D-C1) and returns false", () => {
    sessionStorage.setItem(key(), JSON.stringify({ createdAtMs: Date.now(), command: newCommand }));
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(false);
    expect(hasPendingCreateCommand(MENU)).toBe(true);
  });

  it("returns false when no sticky or corrupt", () => {
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(false);
    sessionStorage.setItem(key(), "{");
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(false);
  });
});

describe("shopping resume suppress (SHOP6 + SHOP3)", () => {
  it("uses kondate:shopping: prefix and round-trips mark/clear on local+session", () => {
    expect(shoppingResumeSuppressKey("create", MENU).startsWith("kondate:shopping:")).toBe(true);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    markShoppingResumeSuppress("create", MENU);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
    // remount 相当: React state は消えても Storage の suppress は残る
    expect(sessionStorage.getItem(shoppingResumeSuppressKey("create", MENU))).toBe("1");
    // SHOP3: 跨タブ正本は localStorage
    expect(localStorage.getItem(shoppingResumeSuppressKey("create", MENU))).toBe("1");
    clearShoppingResumeSuppress("create", MENU);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    expect(localStorage.getItem(shoppingResumeSuppressKey("create", MENU))).toBeNull();
  });

  it("sees suppress written only to localStorage (other tab sheet open)", () => {
    localStorage.setItem(shoppingResumeSuppressKey("create", MENU), "1");
    sessionStorage.removeItem(shoppingResumeSuppressKey("create", MENU));
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
    // session へ promote しない（他タブ clear 後の永久 suppress を防ぐ）
    expect(sessionStorage.getItem(shoppingResumeSuppressKey("create", MENU))).toBeNull();
  });

  it("drops shared local suppress when cleared so other tab can resume again", () => {
    markShoppingResumeSuppress("create", MENU);
    // 他タブ相当: session を空にしても local で suppress 中
    sessionStorage.removeItem(shoppingResumeSuppressKey("create", MENU));
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
    clearShoppingResumeSuppress("create", MENU);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
  });

  it("scopes suppress by kind and targetId", () => {
    markShoppingResumeSuppress("create", MENU);
    markShoppingResumeSuppress("reconcile", LIST);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
    expect(isShoppingResumeSuppressed("reconcile", LIST)).toBe(true);
    clearShoppingResumeSuppress("create", MENU);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    expect(isShoppingResumeSuppressed("reconcile", LIST)).toBe(true);
  });
});

describe("resume suppress unmount clear (SHOP1)", () => {
  // Cancel なし abandon-navigate 相当: schedule 後に suppress が落ち、sticky は別経路で保持する。
  it("schedule alone clears suppress after timeout without touching other kinds", () => {
    markShoppingResumeSuppress("create", MENU);
    markShoppingResumeSuppress("reconcile", LIST);
    scheduleResumeSuppressClear("create", MENU);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
    vi.advanceTimersByTime(0);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    expect(isShoppingResumeSuppressed("reconcile", LIST)).toBe(true);
  });

  it("cancel after schedule keeps suppress (StrictMode remount / SHOP6)", () => {
    markShoppingResumeSuppress("create", MENU);
    scheduleResumeSuppressClear("create", MENU);
    cancelPendingResumeSuppressClear("create", MENU);
    vi.advanceTimersByTime(0);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
  });

  it("does not clear sticky create command when suppress is scheduled away", () => {
    // abandon-navigate は suppress だけ落とし sticky を残す（pause-not-abandon）
    sessionStorage.setItem(
      pendingShoppingCommandStorageKey("create", MENU),
      JSON.stringify({
        createdAtMs: Date.now(),
        command: {
          menuId: MENU,
          mode: "new",
          activeListId: null,
          expectedListVersion: null,
          idempotencyKey: "00000000-0000-4000-8000-0000000000cc",
        },
      }),
    );
    markShoppingResumeSuppress("create", MENU);
    scheduleResumeSuppressClear("create", MENU);
    vi.advanceTimersByTime(0);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    expect(hasPendingCreateCommand(MENU)).toBe(true);
  });

  it("scopes schedule/cancel by kind and targetId", () => {
    markShoppingResumeSuppress("create", MENU);
    markShoppingResumeSuppress("reconcile", LIST);
    scheduleResumeSuppressClear("create", MENU);
    cancelPendingResumeSuppressClear("reconcile", LIST);
    vi.advanceTimersByTime(0);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    expect(isShoppingResumeSuppressed("reconcile", LIST)).toBe(true);
  });
});

describe("clearResumeSuppressOnDocumentBoot (SHOP2 hard reload)", () => {
  // hard reload 後: unmount clear が走らず suppress と sticky が同居して auto-resume が凍る穴。
  it("clears orphan suppress once per document boot", async () => {
    markShoppingResumeSuppress("create", MENU);
    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(true);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    // 同一 document（StrictMode remount / SPA）では 2 回目 no-op
    markShoppingResumeSuppress("create", MENU);
    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(false);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
  });

  it("does not clear other kind/target and is no-op when already clear", async () => {
    markShoppingResumeSuppress("create", MENU);
    markShoppingResumeSuppress("reconcile", LIST);
    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(true);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    expect(isShoppingResumeSuppressed("reconcile", LIST)).toBe(true);
    expect(await clearResumeSuppressOnDocumentBoot("reconcile", LIST)).toBe(true);
    expect(isShoppingResumeSuppressed("reconcile", LIST)).toBe(false);
    // 既に clear 済みでも boot token は消費済み → false
    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(false);
  });

  it("re-arms after reset so simulated hard reload can clear again", async () => {
    markShoppingResumeSuppress("create", MENU);
    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(true);
    markShoppingResumeSuppress("create", MENU);
    resetResumeSuppressDocumentBootForTests();
    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(true);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
  });

  it("does not clear shared suppress while a live peer holds the sheet occupancy lock (SHOP1)", async () => {
    // Tab A が sheet 表示中: mark が occupancy lock を保持し、共有 local 正本が立つ。
    // Tab B hard reload は自タブ shoppingSheet=null でも、peer lock があるあいだ共有旗を消さない。
    const locks = createFakeLockManager();
    stubNavigatorLocks(locks);
    markShoppingResumeSuppress("create", MENU);
    expect(locks.isHeld(shoppingSheetOccupancyLockName("create", MENU))).toBe(true);

    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(false);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
    expect(localStorage.getItem(shoppingResumeSuppressKey("create", MENU))).toBe("1");
  });

  it("still clears orphan shared suppress when occupancy lock is free (SHOP1)", async () => {
    // 保持タブ死亡相当: 共有旗だけ残り lock は無い。hard reload の boot は従来どおり落とす。
    const locks = createFakeLockManager();
    stubNavigatorLocks(locks);
    localStorage.setItem(shoppingResumeSuppressKey("create", MENU), "1");
    expect(locks.isHeld(shoppingSheetOccupancyLockName("create", MENU))).toBe(false);

    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(true);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
  });

  it("re-evaluates boot after a peer occupancy lock is released (SHOP3)", async () => {
    // Tab B: 自タブは occupancyHeldUntil を持たず、peer の lock だけ見える。
    // 初回 boot は token 非消費。peer 死亡後の wait 完了で orphan suppress を落とせる。
    const locks = createFakeLockManager();
    stubNavigatorLocks(locks);
    const releasePeer = locks.hold(shoppingSheetOccupancyLockName("create", MENU));
    localStorage.setItem(shoppingResumeSuppressKey("create", MENU), "1");

    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(false);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);

    const waiting = waitForShoppingSheetOccupancyRelease("create", MENU);
    releasePeer();
    await waiting;
    expect(await clearResumeSuppressOnDocumentBoot("create", MENU)).toBe(true);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
  });
});
