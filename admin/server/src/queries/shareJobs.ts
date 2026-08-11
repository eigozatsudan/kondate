/**
 * 共有一般化ジョブ。レシピ本文 JSON は SELECT しない。
 * 滞留定義: status = 'running' AND coalesce(heartbeat_at, claimed_at) < now() - 15 minutes
 */
import type { PoolClient } from "pg";
import type { ShareJobsResponse } from "../../../shared/schemas.js";
import { shareJobsResponseSchema } from "../../../shared/schemas.js";
import { mapShareJob } from "../lib/map-share.js";

export type ListShareJobsFilter = {
  fromUtc: Date;
  toUtcExclusive: Date;
  status?: string;
  failureCode?: string;
  limit: number;
  offset: number;
};

export async function getShareJobs(
  client: PoolClient,
  filter: ListShareJobsFilter,
): Promise<ShareJobsResponse> {
  const stuck = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.share_generalization_jobs
    where status = 'running'
      and coalesce(heartbeat_at, claimed_at) < now() - interval '15 minutes'
    `,
  );

  const pendingStale = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.share_generalization_jobs
    where status = 'pending'
      and created_at < now() - interval '1 hour'
    `,
  );

  const failed = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.share_generalization_jobs
    where status = 'failed'
      and created_at >= $1 and created_at < $2
    `,
    [filter.fromUtc, filter.toUtcExclusive],
  );

  const params: unknown[] = [filter.fromUtc, filter.toUtcExclusive];
  const where: string[] = ["created_at >= $1", "created_at < $2"];

  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.failureCode) {
    params.push(filter.failureCode);
    where.push(`failure_code = $${params.length}`);
  }

  params.push(filter.limit);
  const limitIdx = params.length;
  params.push(filter.offset);
  const offsetIdx = params.length;

  const list = await client.query(
    `
    select
      id,
      created_at,
      status,
      failure_code,
      skip_reason,
      claimed_at,
      heartbeat_at,
      finished_at,
      pass1_model,
      pass2_model,
      contributor_user_id,
      source_menu_id
    from private.share_generalization_jobs
    where ${where.join(" and ")}
    order by created_at desc, id desc
    limit $${limitIdx}
    offset $${offsetIdx}
    `,
    params,
  );

  return shareJobsResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    stuckCount: stuck.rows[0]?.c ?? 0,
    pendingStaleCount: pendingStale.rows[0]?.c ?? 0,
    failedCount: failed.rows[0]?.c ?? 0,
    jobs: list.rows.map((row) => mapShareJob(row)),
  });
}
