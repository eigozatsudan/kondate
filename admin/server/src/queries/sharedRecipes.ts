/**
 * 共有プール一覧・詳細。
 * menu_payload 文字列は本ファイル（basename sharedRecipes.ts）のみ SQL に出現してよい。
 * 一覧の SELECT リストに menu_payload 列は出さない（title 関数の引数参照のみ）。
 * レスポンス DTO に生 payload は載せない。
 */
import type { PoolClient } from "pg";
import type { SharedRecipeDetail, SharedRecipesResponse } from "../../../shared/schemas.js";
import { sharedRecipesResponseSchema } from "../../../shared/schemas.js";
import { mapSharedRecipeDetail, mapSharedRecipeListItem } from "../lib/map-shared-recipe.js";
import type { SharedRecipeListRow } from "../lib/map-shared-recipe.js";

export type ListSharedRecipesFilter = {
  fromUtc: Date;
  toUtcExclusive: Date;
  status?: "active" | "disabled";
  mealType?: "breakfast" | "lunch" | "dinner";
  limit: number;
  offset: number;
};

export async function listSharedRecipes(
  client: PoolClient,
  filter: ListSharedRecipesFilter,
): Promise<SharedRecipesResponse> {
  // counts: 日付 + mealType のみ（status は使わない）
  const countParams: unknown[] = [filter.fromUtc, filter.toUtcExclusive];
  const countWhere = ["r.created_at >= $1", "r.created_at < $2"];
  if (filter.mealType) {
    countParams.push(filter.mealType);
    countWhere.push(`r.meal_type = $${countParams.length}`);
  }

  const counts = await client.query<{ active: number; disabled: number }>(
    `
    select
      count(*) filter (where r.status = 'active')::int as active,
      count(*) filter (where r.status = 'disabled')::int as disabled
    from private.shared_emergency_recipes r
    where ${countWhere.join(" and ")}
    `,
    countParams,
  );

  // items: 日付 + mealType + status
  const listParams: unknown[] = [filter.fromUtc, filter.toUtcExclusive];
  const listWhere = ["r.created_at >= $1", "r.created_at < $2"];
  if (filter.mealType) {
    listParams.push(filter.mealType);
    listWhere.push(`r.meal_type = $${listParams.length}`);
  }
  if (filter.status) {
    listParams.push(filter.status);
    listWhere.push(`r.status = $${listParams.length}`);
  }
  listParams.push(filter.limit);
  const limitIdx = listParams.length;
  listParams.push(filter.offset);
  const offsetIdx = listParams.length;

  const list = await client.query<SharedRecipeListRow>(
    `
    select
      r.id,
      r.created_at,
      r.status,
      r.meal_type,
      r.total_elapsed_minutes,
      private.share_recipe_title_from_payload(r.menu_payload) as title,
      r.standard_allergen_ids,
      r.eligible_age_bands,
      o.contributor_user_id,
      o.source_menu_id
    from private.shared_emergency_recipes r
    left join private.shared_emergency_recipe_origins o on o.recipe_id = r.id
    where ${listWhere.join(" and ")}
    order by r.created_at desc, r.id desc
    limit $${limitIdx}
    offset $${offsetIdx}
    `,
    listParams,
  );

  return sharedRecipesResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    activeCount: counts.rows[0]?.active ?? 0,
    disabledCount: counts.rows[0]?.disabled ?? 0,
    items: list.rows.map((row) => mapSharedRecipeListItem(row)),
  });
}

export async function getSharedRecipe(
  client: PoolClient,
  id: string,
): Promise<SharedRecipeDetail | null> {
  const res = await client.query<SharedRecipeListRow & { menu_payload: unknown }>(
    `
    select
      r.id,
      r.created_at,
      r.status,
      r.meal_type,
      r.total_elapsed_minutes,
      private.share_recipe_title_from_payload(r.menu_payload) as title,
      r.standard_allergen_ids,
      r.eligible_age_bands,
      o.contributor_user_id,
      o.source_menu_id,
      r.menu_payload
    from private.shared_emergency_recipes r
    left join private.shared_emergency_recipe_origins o on o.recipe_id = r.id
    where r.id = $1::uuid
    limit 1
    `,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return mapSharedRecipeDetail(row);
}
