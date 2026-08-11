/**
 * クエリファイルを filesystem から読み、禁止パターンが SQL に含まれないことを検査する。
 * 自己参照配列に頼らない。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = [
  /identity_key/i,
  // request_hmac は request_hmac_version も部分一致で拾うが、正本として両方明示
  /request_hmac/i,
  /request_hmac_version/i,
  // Stripe 系は列名を個別に、および汎用 stripe_* パターンで塞ぐ
  /stripe_price_id/i,
  /stripe_[a-z0-9_]+/i,
  /auth\.users/i,
  /menu_payload/i,
];

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

      // SELECT * 検出（空白差を正規化）
      expect(normalized).not.toMatch(/select \*/);

      for (const re of FORBIDDEN) {
        expect(text).not.toMatch(re);
      }
    });
  }
});
