/**
 * listSharedRecipes の counts が status 非依存であること（Spec §7.1 / MF-I4）を固定する。
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import { listSharedRecipes } from "./sharedRecipes.js";

function createRecordingClient(rows: {
  counts: { active: number; disabled: number };
  list: unknown[];
}): { client: PoolClient; queries: { text: string; params: unknown[] }[] } {
  const queries: { text: string; params: unknown[] }[] = [];
  let call = 0;
  const client = {
    query: vi.fn(async (text: string, params: unknown[]) => {
      queries.push({ text, params });
      call += 1;
      if (call === 1) {
        return { rows: [rows.counts] };
      }
      return { rows: rows.list };
    }),
  } as unknown as PoolClient;
  return { client, queries };
}

describe("listSharedRecipes counts vs status", () => {
  it("does not put status into counts SQL/params when status filter is set", async () => {
    const fromUtc = new Date("2026-08-01T15:00:00.000Z");
    const toUtcExclusive = new Date("2026-08-08T15:00:00.000Z");
    const { client, queries } = createRecordingClient({
      counts: { active: 2, disabled: 1 },
      list: [],
    });

    const result = await listSharedRecipes(client, {
      fromUtc,
      toUtcExclusive,
      status: "active",
      mealType: "dinner",
      limit: 50,
      offset: 0,
    });

    expect(result.activeCount).toBe(2);
    expect(result.disabledCount).toBe(1);
    expect(queries).toHaveLength(2);

    const [countQuery, listQuery] = queries;
    // counts: 日付 + mealType のみ（status バインドも SQL 断片も無い）
    expect(countQuery.text).not.toMatch(/\$\d+\s*and\s*r\.status|r\.status\s*=\s*\$/i);
    // status フィルタは filter (where r.status = 'active'|'disabled') の固定句のみ
    expect(countQuery.params).toEqual([fromUtc, toUtcExclusive, "dinner"]);
    expect(countQuery.params).not.toContain("active");

    // items: status が WHERE と params に入る
    expect(listQuery.text).toMatch(/r\.status\s*=\s*\$\d+/i);
    expect(listQuery.params).toContain("active");
    expect(listQuery.params).toContain("dinner");
  });
});
