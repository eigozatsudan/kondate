import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingIntentCycle,
  cancelPendingIntentClear,
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
  it("returns true for fresh envelope", () => {
    sessionStorage.setItem(
      pendingShoppingCommandStorageKey("create", MENU),
      JSON.stringify({
        createdAtMs: Date.now(),
        command: {
          menuId: MENU,
          mode: "new",
          activeListId: null,
          expectedListVersion: null,
          idempotencyKey: "00000000-0000-4000-8000-000000000099",
        },
      }),
    );
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

  it("discards mode=append sticky and returns true", () => {
    sessionStorage.setItem(
      pendingShoppingCommandStorageKey("create", MENU),
      JSON.stringify({ createdAtMs: Date.now(), command: appendCommand }),
    );
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(true);
    expect(sessionStorage.getItem(pendingShoppingCommandStorageKey("create", MENU))).toBeNull();
    expect(hasPendingCreateCommand(MENU)).toBe(false);
  });

  it("keeps mode=new sticky (D-C1) and returns false", () => {
    sessionStorage.setItem(
      pendingShoppingCommandStorageKey("create", MENU),
      JSON.stringify({ createdAtMs: Date.now(), command: newCommand }),
    );
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(false);
    expect(hasPendingCreateCommand(MENU)).toBe(true);
  });

  it("returns false when no sticky or corrupt", () => {
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(false);
    sessionStorage.setItem(pendingShoppingCommandStorageKey("create", MENU), "{");
    expect(discardAppendCreateCommandIfPresent(MENU)).toBe(false);
  });
});

describe("shopping resume suppress (SHOP6)", () => {
  it("uses kondate:shopping: prefix and round-trips mark/clear", () => {
    expect(shoppingResumeSuppressKey("create", MENU).startsWith("kondate:shopping:")).toBe(true);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(false);
    markShoppingResumeSuppress("create", MENU);
    expect(isShoppingResumeSuppressed("create", MENU)).toBe(true);
    // remount 相当: React state は消えても sessionStorage の suppress は残る
    expect(sessionStorage.getItem(shoppingResumeSuppressKey("create", MENU))).toBe("1");
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
