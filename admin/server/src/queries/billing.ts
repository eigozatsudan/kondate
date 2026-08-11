/**
 * 課金概況。外部課金 ID 列は SELECT しない。customers 表へ join しない。
 */
import type { PoolClient } from "pg";
import type { BillingResponse } from "../../../shared/schemas.js";
import { billingResponseSchema } from "../../../shared/schemas.js";
import { formatIso } from "../lib/jst.js";

export async function getBilling(
  client: PoolClient,
  opts: { webhookFromUtc: Date; webhookToUtcExclusive: Date },
): Promise<BillingResponse> {
  const statusCounts = await client.query<{ status: string; count: number }>(
    `
    select status, count(*)::int as count
    from private.billing_subscriptions
    group by status
    order by status
    `,
  );

  const cancelCount = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.billing_subscriptions
    where cancel_at_period_end = true
    `,
  );

  const pastDueCount = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.billing_subscriptions
    where status = 'past_due'
    `,
  );

  // 外部イベント ID は SELECT しない。event_type 集計のみ
  const webhookTypes = await client.query<{ event_type: string; count: number }>(
    `
    select event_type, count(*)::int as count
    from private.billing_webhook_events
    where processed_at >= $1 and processed_at < $2
    group by event_type
    order by count desc, event_type asc
    `,
    [opts.webhookFromUtc, opts.webhookToUtcExclusive],
  );

  const subs = await client.query<{
    user_id: string;
    status: string;
    current_period_end: Date | string;
    trial_end: Date | string | null;
    cancel_at_period_end: boolean;
    past_due_since: Date | string | null;
  }>(
    `
    select
      user_id,
      status,
      current_period_end,
      trial_end,
      cancel_at_period_end,
      past_due_since
    from private.billing_subscriptions
    order by current_period_end desc nulls last, user_id asc
    limit 100
    `,
  );

  return billingResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    statusCounts: statusCounts.rows.map((r) => ({
      status: r.status,
      count: r.count,
    })),
    cancelAtPeriodEndCount: cancelCount.rows[0]?.c ?? 0,
    pastDueCount: pastDueCount.rows[0]?.c ?? 0,
    webhookEventTypeCounts: webhookTypes.rows.map((r) => ({
      eventType: r.event_type,
      count: r.count,
    })),
    subscriptions: subs.rows.map((r) => ({
      userId: r.user_id,
      status: r.status,
      currentPeriodEnd: formatIso(r.current_period_end),
      trialEnd: formatIso(r.trial_end),
      cancelAtPeriodEnd: r.cancel_at_period_end,
      pastDueSince: formatIso(r.past_due_since),
    })),
  });
}
