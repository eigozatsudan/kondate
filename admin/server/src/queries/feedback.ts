/**
 * フィードバック一覧・詳細。
 * 第1版: 本文 ILIKE キーワード検索は実装しない。
 * 全文 body は includeBody 時のみ SELECT / 返却。
 */
import type { PoolClient } from "pg";
import type { FeedbackDetail, FeedbackListItem } from "../../../shared/schemas.js";
import { mapFeedbackDetail, mapFeedbackListItem } from "../lib/map-feedback.js";

export type ListFeedbackFilter = {
  fromUtc: Date;
  toUtcExclusive: Date;
  category?: string;
  userId?: string;
  limit: number;
  offset: number;
};

export async function listFeedback(
  client: PoolClient,
  filter: ListFeedbackFilter,
): Promise<FeedbackListItem[]> {
  const params: unknown[] = [filter.fromUtc, filter.toUtcExclusive];
  const where: string[] = ["created_at >= $1", "created_at < $2"];

  if (filter.category) {
    params.push(filter.category);
    where.push(`category = $${params.length}`);
  }
  if (filter.userId) {
    params.push(filter.userId);
    where.push(`user_id = $${params.length}::uuid`);
  }

  params.push(filter.limit);
  const limitIdx = params.length;
  params.push(filter.offset);
  const offsetIdx = params.length;

  // body は先頭 80 字のみ（一覧では全文を載せない）
  const sql = `
    select
      id,
      created_at,
      category,
      client_path,
      user_id,
      left(body, 80) as body_preview
    from public.user_feedback
    where ${where.join(" and ")}
    order by created_at desc, id desc
    limit $${limitIdx}
    offset $${offsetIdx}
  `;

  const res = await client.query(sql, params);
  return res.rows.map((row) => mapFeedbackListItem(row));
}

export async function getFeedback(
  client: PoolClient,
  id: string,
  includeBody: boolean,
): Promise<FeedbackDetail | null> {
  // includeBody=1 のときだけ body 列を取る（キーワード検索はしない）
  const sql = includeBody
    ? `
    select
      id,
      created_at,
      category,
      client_path,
      user_id,
      left(body, 80) as body_preview,
      body
    from public.user_feedback
    where id = $1::uuid
    limit 1
  `
    : `
    select
      id,
      created_at,
      category,
      client_path,
      user_id,
      left(body, 80) as body_preview
    from public.user_feedback
    where id = $1::uuid
    limit 1
  `;

  const res = await client.query(sql, [id]);
  const row = res.rows[0];
  if (!row) return null;
  return mapFeedbackDetail(row, includeBody);
}
