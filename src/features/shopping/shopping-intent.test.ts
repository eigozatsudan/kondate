import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingIntentCycle,
  cancelPendingIntentClear,
  cancelPendingResumeSuppressClear,
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
  scheduleIntentClear,
  scheduleResumeSuppressClear,
  shoppingDidAutoOpenKey,
  shoppingIntentStorageKey,
  shoppingResumeSuppressKey,
  shoppingSheetExpectedKey,
} from "./shopping-intent";
import { pendingShoppingCommandStorageKey } from "./api/shopping-api";

const MENU = "40000000-0000-4000-8000-000000000001";
const LIST = "41000000-0000-4000-8000-000000000001";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
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
