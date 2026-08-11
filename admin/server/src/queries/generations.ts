/**
 * 生成台帳の一覧・詳細。禁止列は列挙 SELECT に含めない。
 */
import type { PoolClient } from "pg";
import type { GenerationDetail, GenerationListItem } from "../../../shared/schemas.js";
import { mapGenerationDetail, mapGenerationListItem } from "../lib/map-generation.js";

const LIST_COLUMNS = `
  id,
  created_at,
  status,
  request_kind,
  failure_code,
  duration_ms,
  actual_model_ids,
  quality_mode,
  repair_attempted,
  user_id
`;

const DETAIL_COLUMNS = `
  ${LIST_COLUMNS},
  started_at,
  completed_at,
  user_usage_day,
  global_sent_calls,
  terminal_details,
  change_reason,
  draft_id,
  source_menu_id,
  replace_dish_id,
  completed_menu_id,
  processing_expires_at,
  quota_success_limit
`;

export type ListGenerationsFilter = {
  fromUtc: Date;
  toUtcExclusive: Date;
  status?: string;
  requestKind?: string;
  failureCode?: string;
  userId?: string;
  limit: number;
  offset: number;
};

export async function listGenerations(
  client: PoolClient,
  filter: ListGenerationsFilter,
): Promise<GenerationListItem[]> {
  const params: unknown[] = [filter.fromUtc, filter.toUtcExclusive];
  const where: string[] = [
    "created_at >= $1",
    "created_at < $2",
  ];

  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.requestKind) {
    params.push(filter.requestKind);
    where.push(`request_kind = $${params.length}`);
  }
  if (filter.failureCode) {
    params.push(filter.failureCode);
    where.push(`failure_code = $${params.length}`);
  }
  if (filter.userId) {
    params.push(filter.userId);
    where.push(`user_id = $${params.length}::uuid`);
  }

  params.push(filter.limit);
  const limitIdx = params.length;
  params.push(filter.offset);
  const offsetIdx = params.length;

  const sql = `
    select ${LIST_COLUMNS}
    from private.ai_generation_requests
    where ${where.join(" and ")}
    order by created_at desc, id desc
    limit $${limitIdx}
    offset $${offsetIdx}
  `;

  const res = await client.query(sql, params);
  return res.rows.map((row) => mapGenerationListItem(row));
}

export async function getGeneration(
  client: PoolClient,
  id: string,
): Promise<GenerationDetail | null> {
  const sql = `
    select ${DETAIL_COLUMNS}
    from private.ai_generation_requests
    where id = $1::uuid
    limit 1
  `;
  const res = await client.query(sql, [id]);
  const row = res.rows[0];
  if (!row) return null;
  return mapGenerationDetail(row);
}

/** stuck: processing かつ processing_expires_at < now() */
export async function listStuckGenerations(
  client: PoolClient,
  limit: number,
): Promise<GenerationListItem[]> {
  const sql = `
    select ${LIST_COLUMNS}
    from private.ai_generation_requests
    where status = 'processing'
      and processing_expires_at is not null
      and processing_expires_at < now()
    order by processing_expires_at asc, id asc
    limit $1
  `;
  const res = await client.query(sql, [limit]);
  return res.rows.map((row) => mapGenerationListItem(row));
}

export async function countStuckGenerations(client: PoolClient): Promise<number> {
  const res = await client.query<{ c: number }>(
    `
    select count(*)::int as c
    from private.ai_generation_requests
    where status = 'processing'
      and processing_expires_at is not null
      and processing_expires_at < now()
    `,
  );
  return res.rows[0]?.c ?? 0;
}
