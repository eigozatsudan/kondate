/**
 * ダッシュボード集計。単一ハンドラ内で集約する。
 */
import type { PoolClient } from "pg";
import type { DashboardResponse } from "../../../shared/schemas.js";
import { dashboardResponseSchema } from "../../../shared/schemas.js";
import { countStuckGenerations } from "./generations.js";

export type DashboardInput = {
  fromUtc: Date;
  toUtcExclusive: Date;
  fromJst: string;
  toJst: string;
  todayJst: string;
  connectionHost: string;
  sessionUser: string;
};

export async function getDashboard(
  client: PoolClient,
  input: DashboardInput,
): Promise<DashboardResponse> {
  const todayStart = input.fromUtc; // 呼び出し側で当日範囲も渡せるが、以下で today を別途取る
  void todayStart;

  const generationStatus = await client.query<{ status: string; count: number }>(
    `
    select status, count(*)::int as count
    from private.ai_generation_requests
    where created_at >= $1 and created_at < $2
    group by status
    order by status
    `,
    [input.fromUtc, input.toUtcExclusive],
  );

  // 当日（JST）のグローバル枠
  const globalToday = await client.query<{
    usage_day: string;
    reserved_count: number;
    sent_count: number;
  }>(
    `
    select usage_day::text as usage_day, reserved_count, sent_count
    from private.ai_global_daily_usage
    where usage_day = $1::date
    limit 1
    `,
    [input.todayJst],
  );

  const feedbackCats = await client.query<{ category: string; count: number }>(
    `
    select category, count(*)::int as count
    from public.user_feedback
    where created_at >= $1 and created_at < $2
    group by category
    order by category
    `,
    [input.fromUtc, input.toUtcExclusive],
  );

  const stuckGenerationCount = await countStuckGenerations(client);

  const shareFailed = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.share_generalization_jobs
    where status = 'failed'
      and created_at >= $1 and created_at < $2
    `,
    [input.fromUtc, input.toUtcExclusive],
  );

  // 滞留: running かつ heartbeat/claimed が 15 分超過
  const shareStuck = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.share_generalization_jobs
    where status = 'running'
      and coalesce(heartbeat_at, claimed_at) < now() - interval '15 minutes'
    `,
  );

  const sharePendingStale = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.share_generalization_jobs
    where status = 'pending'
      and created_at < now() - interval '1 hour'
    `,
  );

  const billingStatus = await client.query<{ status: string; count: number }>(
    `
    select status, count(*)::int as count
    from private.billing_subscriptions
    group by status
    order by status
    `,
  );

  const g = globalToday.rows[0];

  return dashboardResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    connectionHost: input.connectionHost,
    sessionUser: input.sessionUser,
    todayJst: input.todayJst,
    rangeFromJst: input.fromJst,
    rangeToJst: input.toJst,
    generationStatusCounts: generationStatus.rows.map((r) => ({
      status: r.status,
      count: r.count,
    })),
    globalUsageToday: g
      ? {
          usageDay: g.usage_day,
          reservedCount: g.reserved_count,
          sentCount: g.sent_count,
        }
      : null,
    feedbackCategoryCounts: feedbackCats.rows.map((r) => ({
      category: r.category,
      count: r.count,
    })),
    stuckGenerationCount,
    shareFailedCount: shareFailed.rows[0]?.c ?? 0,
    shareStuckCount: shareStuck.rows[0]?.c ?? 0,
    sharePendingStaleCount: sharePendingStale.rows[0]?.c ?? 0,
    billingStatusCounts: billingStatus.rows.map((r) => ({
      status: r.status,
      count: r.count,
    })),
  });
}
