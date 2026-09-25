/**
 * getBilling が Stripe の cancel_at（解約予定日時、UX 残り R2 修正 M-2）を運用面に出すことを固定する。
 * cancel_at だけの解約予約は cancel_at_period_end=false のまま来るので、別の件数・列で見せる。
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import { getBilling } from "./billing.js";

const userId = "22222222-2222-4222-8222-222222222222";

function createClient(cancelAt: string | null = "2026-10-10T15:00:00.000Z"): {
  client: PoolClient;
  texts: string[];
} {
  const texts: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      texts.push(text);
      const sql = text.replace(/\s+/g, " ");
      if (sql.includes("group by status")) return { rows: [{ status: "active", count: 2 }] };
      if (sql.includes("where cancel_at_period_end = true")) return { rows: [{ c: 1 }] };
      if (sql.includes("where cancel_at is not null")) return { rows: [{ c: 3 }] };
      if (sql.includes("where status = 'past_due'")) return { rows: [{ c: 0 }] };
      if (sql.includes("billing_webhook_events")) return { rows: [] };
      return {
        rows: [
          {
            user_id: userId,
            status: "active",
            current_period_end: "2026-10-22T15:00:00.000Z",
            trial_end: null,
            cancel_at_period_end: false,
            cancel_at: cancelAt,
            past_due_since: null,
          },
        ],
      };
    }),
  } as unknown as PoolClient;
  return { client, texts };
}

describe("getBilling cancel_at", () => {
  it("counts cancel_at schedules separately and shows cancel_at per subscription", async () => {
    const { client, texts } = createClient();
    const result = await getBilling(client, {
      webhookFromUtc: new Date("2026-09-17T15:00:00.000Z"),
      webhookToUtcExclusive: new Date("2026-09-24T15:00:00.000Z"),
    });
    expect(result.cancelAtPeriodEndCount).toBe(1);
    expect(result.cancelAtScheduledCount).toBe(3);
    expect(result.subscriptions[0]).toMatchObject({
      userId,
      cancelAtPeriodEnd: false,
      cancelAt: "2026-10-10T15:00:00.000Z",
    });
    const listSql = texts.at(-1)?.replace(/\s+/g, " ") ?? "";
    expect(listSql).toMatch(/\bcancel_at,/);
  });

  it("shows null when no cancel_at is scheduled", async () => {
    const { client } = createClient(null);
    const result = await getBilling(client, {
      webhookFromUtc: new Date("2026-09-17T15:00:00.000Z"),
      webhookToUtcExclusive: new Date("2026-09-24T15:00:00.000Z"),
    });
    expect(result.subscriptions[0]?.cancelAt).toBeNull();
  });
});
