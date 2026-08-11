/**
 * Spec §4.2 の @smoke 固定セットをソース上で機械固定する。
 * 「いずれか 1 本以上」では不合格 — 必須ファイル × 最低本数を満たすこと。
 * 加えて critical title が @smoke 近傍にあること（誤タグ付けの false green 防止）。
 * account-deletion / billing-plus は full のみ（@smoke 0）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** Playwright tag リテラル `"@smoke"` / `'@smoke'` の出現回数 */
function countTagLiteral(source, tag) {
  const re = new RegExp(String.raw`["']${tag}["']`, "gu");
  return (source.match(re) ?? []).length;
}

/**
 * title 部分文字列の前後に @smoke があること（タグ付け忘れ・別 test への付け替え防止）。
 * Playwright は options を title の前/後どちらにも置けるため、窓を前後に取る。
 */
function assertSmokeNearTitle(source, titleFragment, relativePath) {
  const idx = source.indexOf(titleFragment);
  assert.ok(idx >= 0, `${relativePath}: missing smoke title fragment: ${titleFragment}`);
  const windowStart = Math.max(0, idx - 400);
  const windowEnd = Math.min(source.length, idx + titleFragment.length + 400);
  const window = source.slice(windowStart, windowEnd);
  assert.ok(
    /@smoke/u.test(window),
    `${relativePath}: @smoke must appear near title: ${titleFragment}`,
  );
}

/**
 * Spec §4.2 表: 必須ファイル × 最低本数。
 * foundation / onboarding は「全 test」だが現行 1 本のため min=1。
 */
const requiredSmoke = [
  ["e2e/specs/foundation.spec.ts", 1],
  ["e2e/specs/oauth-mock.spec.ts", 2],
  ["e2e/specs/full-journey.spec.ts", 2],
  ["e2e/specs/auth-callback-security.spec.ts", 2],
  ["e2e/specs/auth-recovery.spec.ts", 1],
  ["e2e/specs/generation-recovery-results.spec.ts", 2],
  ["e2e/specs/shopping-list.spec.ts", 1],
  ["e2e/specs/shopping-list-races.spec.ts", 1],
  ["e2e/specs/history-safety-change.spec.ts", 1],
  ["e2e/specs/history-regeneration.spec.ts", 1],
  ["e2e/specs/menu-domain-pantry.spec.ts", 1],
  ["e2e/specs/onboarding.spec.ts", 1],
  ["e2e/specs/settings.spec.ts", 1],
  ["e2e/specs/mobile-accessibility.spec.ts", 1],
];

/**
 * Spec §4.2 の owning に近い exact title 断片（誤った test に @smoke を付け替えて本数だけ満たすのを防ぐ）。
 * MVP #9 / #13 と auth cancel/expired を必須とする。
 */
const requiredSmokeTitles = [
  ["e2e/specs/foundation.spec.ts", "protects app routes and fits the active viewport"],
  ["e2e/specs/oauth-mock.spec.ts", "local Google success returns the bound code"],
  ["e2e/specs/oauth-mock.spec.ts", "local Google cancellation returns through the app callback"],
  [
    "e2e/specs/full-journey.spec.ts",
    "household journey: welcome through shopping create and alternate reconcile",
  ],
  [
    "e2e/specs/full-journey.spec.ts",
    "idea journey: no family safety, no shopping, mode-preserving regen",
  ],
  [
    "e2e/specs/auth-callback-security.spec.ts",
    "oauth-mock cancel returns safe retry copy and erases transient code/state",
  ],
  [
    "e2e/specs/auth-callback-security.spec.ts",
    "past expires_at continuation fails with safe retry copy",
  ],
  [
    "e2e/specs/auth-recovery.spec.ts",
    "same-browser callback restores both callback and original tabs",
  ],
  [
    "e2e/specs/generation-recovery-results.spec.ts",
    "resends the same key after the first POST is aborted before server acceptance",
  ],
  [
    "e2e/specs/generation-recovery-results.spec.ts",
    "shows result details and keeps major regions within their parent",
  ],
  ["e2e/specs/shopping-list.spec.ts", "shows server-owned diff and preserves protected rows"],
  [
    "e2e/specs/shopping-list-races.spec.ts",
    "reuses one idempotency key after the first response is lost",
  ],
  [
    "e2e/specs/history-safety-change.spec.ts",
    "automatically revalidates on mount and blocks stale history after safety changes",
  ],
  ["e2e/specs/history-regeneration.spec.ts", "does not consume a success for duplicate output"],
  [
    "e2e/specs/menu-domain-pantry.spec.ts",
    "pantry CRUD, restored planner, attempt-local expiry check, and all reviewed meals",
  ],
  [
    "e2e/specs/onboarding.spec.ts",
    "resumes a partially saved member, shows next-action after complete",
  ],
  [
    "e2e/specs/settings.spec.ts",
    "adds, edits, and deletes a household member without account deletion",
  ],
  [
    "e2e/specs/mobile-accessibility.spec.ts",
    "the household wizard and result fit ${String(width)}px with usable targets",
  ],
];

/** full のみ。PR smoke に載せない（破壊的 / 重い / Notes 所有） */
const fullOnlyNoSmoke = ["e2e/specs/account-deletion.spec.ts", "e2e/specs/billing-plus.spec.ts"];

/** 幅ループ内の test() 定義数（各定義に @mobile-only が付く） */
const mobileAccessibilityTestDefs = 5;

test("smoke tag set meets Spec §4.2 minimum counts per required file", async () => {
  for (const [relativePath, minimum] of requiredSmoke) {
    const source = await readFile(relativePath, "utf8");
    const count = countTagLiteral(source, "@smoke");
    assert.ok(
      count >= minimum,
      `${relativePath}: expected ≥${String(minimum)} @smoke tag(s), found ${String(count)}`,
    );
  }
});

test("smoke tags sit on Spec §4.2 required titles (not just counts)", async () => {
  /** @type {Map<string, string>} */
  const sourceByPath = new Map();
  for (const [relativePath, titleFragment] of requiredSmokeTitles) {
    let source = sourceByPath.get(relativePath);
    if (source === undefined) {
      source = await readFile(relativePath, "utf8");
      sourceByPath.set(relativePath, source);
    }
    assertSmokeNearTitle(source, titleFragment, relativePath);
  }
});

test("account-deletion and billing-plus stay full-only without @smoke", async () => {
  for (const relativePath of fullOnlyNoSmoke) {
    const source = await readFile(relativePath, "utf8");
    const count = countTagLiteral(source, "@smoke");
    assert.equal(
      count,
      0,
      `${relativePath}: must not carry @smoke (full suite only), found ${String(count)}`,
    );
  }
});

test("mobile-accessibility marks the width matrix as @mobile-only", async () => {
  const source = await readFile("e2e/specs/mobile-accessibility.spec.ts", "utf8");
  // 幅ループ内の各 test 定義に @mobile-only（runtime は width×定義だがソースは定義数）
  const mobileOnlyCount = countTagLiteral(source, "@mobile-only");
  assert.ok(
    mobileOnlyCount >= mobileAccessibilityTestDefs,
    `mobile-accessibility.spec.ts must declare @mobile-only on each matrix test (≥${String(mobileAccessibilityTestDefs)}), found ${String(mobileOnlyCount)}`,
  );
  // 320 household のみ smoke: ソース上は ternary 1 箇所に @smoke が載る
  assert.ok(
    source.includes('width === 320 ? ["@mobile-only", "@smoke"]') ||
      source.includes("width === 320 ? ['@mobile-only', '@smoke']"),
    "320px household wizard+result must combine @mobile-only and @smoke",
  );
});
