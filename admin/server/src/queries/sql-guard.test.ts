/**
 * クエリファイルを filesystem から読み、禁止パターンが SQL に含まれないことを検査する。
 * 自己参照配列に頼らない。
 *
 * menu_payload は basename exact が sharedRecipes.ts のときのみ許可
 * （詳細取得・title 関数引数用）。他ファイルへの出現は禁止。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_ALWAYS = [
  /identity_key/i,
  // request_hmac は request_hmac_version も部分一致で拾うが、正本として両方明示
  /request_hmac/i,
  /request_hmac_version/i,
  // Stripe 系は列名を個別に、および汎用 stripe_* パターンで塞ぐ
  /stripe_price_id/i,
  /stripe_[a-z0-9_]+/i,
  /auth\.users/i,
];

const MENU_PAYLOAD = /menu_payload/i;
/** basename exact のみ許可。他ファイルに menu_payload を書いてはならない */
const ALLOW_MENU_PAYLOAD_BASENAME = "sharedRecipes.ts";

function normalizeSql(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

describe("sql-guard: query files on disk", () => {
  const files = readdirSync(here)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(here, f));

  it("finds at least one query module", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`has no forbidden SQL patterns: ${file.split("/").pop()}`, () => {
      const text = readFileSync(file, "utf8");
      const normalized = normalizeSql(text);

      for (const re of FORBIDDEN_ALWAYS) {
        expect(text).not.toMatch(re);
      }
      const base = file.split("/").pop();
      if (base !== ALLOW_MENU_PAYLOAD_BASENAME) {
        expect(text).not.toMatch(MENU_PAYLOAD);
      }
      // SELECT * 検出（空白差を正規化）
      expect(normalized).not.toMatch(/select \*/);
    });
  }
});
