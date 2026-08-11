/**
 * Spec §4.2 の @smoke 固定セットをソース上で機械固定する。
 * 「いずれか 1 本以上」では不合格 — 必須ファイル × 最低本数を満たすこと。
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

/** full のみ。PR smoke に載せない（破壊的 / 重い / Notes 所有） */
const fullOnlyNoSmoke = ["e2e/specs/account-deletion.spec.ts", "e2e/specs/billing-plus.spec.ts"];

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
  // 幅ループ内の各 test に @mobile-only。desktop project は config grepInvert で除外。
  assert.ok(
    countTagLiteral(source, "@mobile-only") >= 1,
    "mobile-accessibility.spec.ts must declare @mobile-only",
  );
  // 320 household のみ smoke: ソース上は ternary 1 箇所に @smoke が載る
  assert.ok(
    source.includes('width === 320 ? ["@mobile-only", "@smoke"]') ||
      source.includes("width === 320 ? ['@mobile-only', '@smoke']"),
    "320px household wizard+result must combine @mobile-only and @smoke",
  );
});
