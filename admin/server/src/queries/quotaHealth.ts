/**
 * 利用枠・健全性: グローバル日次 / stuck / 失敗トップ / 上限付近。
 * 上限付近は生成台帳の succeeded を user_id で集計して近似する（識別ハッシュ列は使わない）。
 */
import type { PoolClient } from "pg";
import type { QuotaHealthResponse } from "../../../shared/schemas.js";
import { quotaHealthResponseSchema } from "../../../shared/schemas.js";
import { listStuckGenerations } from "./generations.js";

export async function getQuotaHealth(
  client: PoolClient,
  opts: {
    /** 上限付近の集計範囲（通常は JST 当日） */
    dayFromUtc: Date;
    dayToUtcExclusive: Date;
    range24hFrom: Date;
    range7dFrom: Date;
    now: Date;
  },
): Promise<QuotaHealthResponse> {
  const globalDaily = await client.query<{
    usage_day: string;
    reserved_count: number;
    sent_count: number;
  }>(
    `
    select usage_day::text as usage_day, reserved_count, sent_count
    from private.ai_global_daily_usage
    order by usage_day desc
    limit 14
    `,
  );

  const stuckGenerations = await listStuckGenerations(client, 50);

  const failureTop24h = await client.query<{ failure_code: string; count: number }>(
    `
    select failure_code, count(*)::int as count
    from private.ai_generation_requests
    where status = 'failed'
      and failure_code is not null
      and created_at >= $1 and created_at < $2
    group by failure_code
    order by count desc, failure_code asc
    limit 20
    `,
    [opts.range24hFrom, opts.now],
  );

  const failureTop7d = await client.query<{ failure_code: string; count: number }>(
    `
    select failure_code, count(*)::int as count
    from private.ai_generation_requests
    where status = 'failed'
      and failure_code is not null
      and created_at >= $1 and created_at < $2
    group by failure_code
    order by count desc, failure_code asc
    limit 20
    `,
    [opts.range7dFrom, opts.now],
  );

  // 上限付近: success_count >= quota_success_limit - 1
  const nearLimit = await client.query<{
    user_id: string;
    success_count: number;
    quota_success_limit: number;
  }>(
    `
    with day_success as (
      select user_id, count(*)::int as success_count
      from private.ai_generation_requests
      where status = 'succeeded'
        and created_at >= $1 and created_at < $2
      group by user_id
    ),
    limits as (
      select distinct on (user_id) user_id, quota_success_limit
      from private.ai_generation_requests
      where created_at >= $1 and created_at < $2
      order by user_id, created_at desc
    )
    select d.user_id, d.success_count, l.quota_success_limit
    from day_success d
    join limits l using (user_id)
    where d.success_count >= l.quota_success_limit - 1
    order by d.success_count desc
    limit 50
    `,
    [opts.dayFromUtc, opts.dayToUtcExclusive],
  );

  return quotaHealthResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    globalDailyUsage: globalDaily.rows.map((r) => ({
      usageDay: r.usage_day,
      reservedCount: r.reserved_count,
      sentCount: r.sent_count,
    })),
    stuckGenerations,
    failureTop24h: failureTop24h.rows.map((r) => ({
      failureCode: r.failure_code,
      count: r.count,
    })),
    failureTop7d: failureTop7d.rows.map((r) => ({
      failureCode: r.failure_code,
      count: r.count,
    })),
    nearLimitUsers: nearLimit.rows.map((r) => ({
      userId: r.user_id,
      successCount: r.success_count,
      quotaSuccessLimit: r.quota_success_limit,
    })),
  });
}
