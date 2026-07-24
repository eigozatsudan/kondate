import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Page } from "@playwright/test";
import { expect, test as authTest } from "./auth";
import {
  clickWizardNext,
  seedGeneratedIdeaMenu,
  seedGeneratedMenu,
  setMockScenario,
} from "./history";
import { accessTokenFromPage } from "./local-supabase";

export { expect, clickWizardNext, seedGeneratedMenu, seedGeneratedIdeaMenu, setMockScenario };

const userIdSchema = z.uuid();

async function readEnv(): Promise<{ serviceRoleKey: string; postgresPassword: string }> {
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  const serviceRoleKey = z
    .string()
    .min(20)
    .parse(/^SERVICE_ROLE_KEY=(.+)$/mu.exec(envText)?.[1]?.trim());
  const postgresPassword = z
    .string()
    .min(1)
    .parse(/^POSTGRES_PASSWORD=(.+)$/mu.exec(envText)?.[1]?.trim());
  return { serviceRoleKey, postgresPassword };
}

async function connectOwnedPg(): Promise<Client> {
  const { postgresPassword } = await readEnv();
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:54322/postgres?sslmode=disable`,
  });
  await client.connect();
  return client;
}

/** Auth Admin（service role）。service 値を page へ渡さない。 */
export async function createServiceAdmin() {
  const { serviceRoleKey } = await readEnv();
  return createClient("http://127.0.0.1:8000", serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * public/private の user_id 付き base table の所有行数を返す。
 * 接続文字列・行 payload はログに出さない。
 */
export async function queryOwnedCounts(
  userId: string,
): Promise<Array<{ table: string; count: number }>> {
  const parsedUserId = userIdSchema.parse(userId);
  const client = await connectOwnedPg();
  try {
    const tables = await client.query<{ table_schema: string; table_name: string }>(
      `select n.nspname as table_schema, c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
        where c.relkind = 'r'
          and n.nspname in ('public', 'private')
        order by n.nspname, c.relname`,
    );
    const rows: Array<{ table: string; count: number }> = [];
    for (const table of tables.rows) {
      const qualified = `${table.table_schema}.${table.table_name}`;
      const countResult = await client.query<{ count: string }>(
        `select count(*)::text as count from ${table.table_schema}.${table.table_name} where user_id = $1::uuid`,
        [parsedUserId],
      );
      rows.push({ table: qualified, count: Number(countResult.rows[0]?.count ?? 0) });
    }
    return rows;
  } finally {
    await client.end();
  }
}

export const requiredNonEmptyFamilies = new Set([
  "public.profiles",
  "public.household_members",
  "public.privacy_consents",
  "public.pantry_items",
  "public.generation_drafts",
  "public.menus",
  "public.dishes",
  "public.menu_member_adaptations",
  "public.menu_safety_actions",
  "public.menu_label_confirmations",
  "public.menu_revalidations",
  "public.shopping_lists",
  "public.shopping_items",
  "public.shopping_label_confirmations",
  "private.generation_regeneration_snapshots",
]);

/**
 * UI 経路で埋まらない必須ファミリーを service DB（pg）で埋める。
 * page / ブラウザへ secret は渡さない。既存 household 献立の FK を再利用する。
 */
async function seedMissingOwnedFamiliesViaPg(userId: string): Promise<void> {
  const parsedUserId = userIdSchema.parse(userId);
  const client = await connectOwnedPg();
  try {
    // pantry
    await client.query(
      `insert into public.pantry_items (user_id, name, quantity, unit)
       select $1::uuid, 'にんじん', 1, '本'
        where not exists (
          select 1 from public.pantry_items where user_id = $1::uuid
        )`,
      [parsedUserId],
    );

    // generation_drafts（途中 draft: target_mode/servings は null 可）
    await client.query(
      `insert into public.generation_drafts (
         user_id, meal_type, main_ingredients, cuisine_genre, target_member_ids,
         avoid_ingredients, memo, pantry_selections, revision, target_mode, servings
       )
       select $1::uuid, 'breakfast', array['鶏肉']::text[], 'japanese', '{}'::uuid[],
              '{}'::text[], '', '[]'::jsonb, 0, null, null
        where not exists (
          select 1 from public.generation_drafts where user_id = $1::uuid
        )`,
      [parsedUserId],
    );

    // household menu の関連 ID を取得（seedGeneratedMenu が作成済み前提）
    const menuCtx = await client.query<{
      menu_id: string;
      dish_id: string;
      ingredient_id: string | null;
      step_id: string | null;
      anonymous_ref: string | null;
      menu_version: number;
    }>(
      `select m.id::text as menu_id,
              d.id::text as dish_id,
              i.id::text as ingredient_id,
              s.id::text as step_id,
              t.anonymous_ref,
              m.version as menu_version
         from public.menus m
         join public.dishes d on d.menu_id = m.id and d.user_id = m.user_id
         left join lateral (
           select id from public.dish_ingredients
            where menu_id = m.id and dish_id = d.id and user_id = m.user_id
            order by position asc limit 1
         ) i on true
         left join lateral (
           select id from public.recipe_steps
            where menu_id = m.id and dish_id = d.id and user_id = m.user_id
            order by position asc limit 1
         ) s on true
         left join lateral (
           select anonymous_ref from public.menu_target_members
            where menu_id = m.id and user_id = m.user_id
            order by anonymous_ref asc limit 1
         ) t on true
        where m.user_id = $1::uuid
          and m.target_mode = 'household'
        order by m.created_at asc
        limit 1`,
      [parsedUserId],
    );
    const ctx = menuCtx.rows[0];
    if (ctx === undefined) {
      throw new Error("seedMissingOwnedFamiliesViaPg: household menu/dish missing");
    }
    if (ctx.ingredient_id === null || ctx.step_id === null || ctx.anonymous_ref === null) {
      throw new Error("seedMissingOwnedFamiliesViaPg: dish graph incomplete");
    }

    // menu_member_adaptations → menu_safety_actions の順（複合 FK）
    await client.query(
      `insert into public.menu_member_adaptations (
         menu_id, dish_id, user_id, anonymous_member_ref, portion_text,
         branch_before_recipe_step_id, serving_check
       )
       select $1::uuid, $2::uuid, $3::uuid, $4, '半量', $5::uuid, '柔らかさを確認する'
        where not exists (
          select 1 from public.menu_member_adaptations where user_id = $3::uuid
        )`,
      [ctx.menu_id, ctx.dish_id, parsedUserId, ctx.anonymous_ref, ctx.step_id],
    );

    await client.query(
      `insert into public.menu_safety_actions (
         menu_id, dish_id, ingredient_id, user_id, anonymous_member_ref,
         before_recipe_step_id, position, kind, instruction
       )
       select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, 1, 'cut_small', '小さく切る'
        where not exists (
          select 1 from public.menu_safety_actions where user_id = $4::uuid
        )`,
      [ctx.menu_id, ctx.dish_id, ctx.ingredient_id, parsedUserId, ctx.anonymous_ref, ctx.step_id],
    );

    await client.query(
      `insert into public.menu_label_confirmations (
         menu_id, user_id, source_type, source_id, source_path, source_text_snapshot,
         allergen_id, anonymous_member_ref, dictionary_version, requirement_safety_fingerprint
       )
       select $1::uuid, $2::uuid, 'dish', $3::uuid, 'dishes.0.name', 'cascade-seed',
              'wheat', $4, 'jp-caa-2026-04.v1', repeat('a', 64)
        where not exists (
          select 1 from public.menu_label_confirmations where user_id = $2::uuid
        )`,
      [ctx.menu_id, parsedUserId, ctx.dish_id, ctx.anonymous_ref],
    );

    await client.query(
      `insert into public.menu_revalidations (
         user_id, menu_id, safety_fingerprint, allergen_catalog_version,
         food_rule_version, status, issues
       )
       select $1::uuid, $2::uuid, repeat('a', 64), 'allergens-v1', 'food-v1', 'valid', '[]'::jsonb
        where not exists (
          select 1 from public.menu_revalidations where user_id = $1::uuid
        )`,
      [parsedUserId, ctx.menu_id],
    );

    // shopping_lists / items / label confirmations
    const listId = randomUUID();
    await client.query(
      `insert into public.shopping_lists (id, user_id, safety_fingerprint, status, version)
       select $1::uuid, $2::uuid, repeat('b', 64), 'active', 1
        where not exists (
          select 1 from public.shopping_lists where user_id = $2::uuid
        )`,
      [listId, parsedUserId],
    );
    const listRow = await client.query<{ id: string }>(
      `select id::text as id from public.shopping_lists where user_id = $1::uuid limit 1`,
      [parsedUserId],
    );
    const activeListId = z.uuid().parse(listRow.rows[0]?.id);

    const itemId = randomUUID();
    await client.query(
      `insert into public.shopping_items (
         id, list_id, user_id, display_name, normalized_name, quantity_text, store_section
       )
       select $1::uuid, $2::uuid, $3::uuid, 'にんじん', 'にんじん', '1本', 'produce'
        where not exists (
          select 1 from public.shopping_items where user_id = $3::uuid
        )`,
      [itemId, activeListId, parsedUserId],
    );
    const itemRow = await client.query<{ id: string }>(
      `select id::text as id from public.shopping_items where user_id = $1::uuid limit 1`,
      [parsedUserId],
    );
    const activeItemId = z.uuid().parse(itemRow.rows[0]?.id);

    const labelConfirmRow = await client.query<{ id: string }>(
      `select id::text as id from public.menu_label_confirmations
        where user_id = $1::uuid limit 1`,
      [parsedUserId],
    );
    const menuLabelId = z.uuid().parse(labelConfirmRow.rows[0]?.id);

    await client.query(
      `insert into public.shopping_label_confirmations (
         list_id, item_id, user_id, allergen_id, allergen_display_name,
         anonymous_member_ref, member_display_name, confirmation_status,
         dictionary_version, menu_label_confirmation_id,
         source_derivation_group_id, source_display_name, source_id_snapshot,
         source_menu_id_snapshot, source_path, source_type, source_warning_key
       )
       select $1::uuid, $2::uuid, $3::uuid, 'wheat', '小麦',
              $4, '家族1', 'pending',
              'jp-caa-2026-04.v1', $5::uuid,
              gen_random_uuid(), 'にんじん', $6::uuid,
              $7::uuid, 'dishes.0.ingredients.0.name', 'ingredient', repeat('c', 64)
        where not exists (
          select 1 from public.shopping_label_confirmations where user_id = $3::uuid
        )`,
      [
        activeListId,
        activeItemId,
        parsedUserId,
        ctx.anonymous_ref,
        menuLabelId,
        ctx.ingredient_id,
        ctx.menu_id,
      ],
    );

    // private.generation_regeneration_snapshots（ai_generation_requests が親）
    const requestId = randomUUID();
    const idempotencyKey = randomUUID();
    await client.query(
      `insert into private.ai_generation_requests (
         id, user_id, idempotency_key, request_kind, status,
         request_hmac_version, request_hmac, user_usage_day,
         failure_code, started_at, completed_at
       )
       select $1::uuid, $2::uuid, $3::uuid, 'regenerate_menu', 'failed',
              'generation-command.v2', repeat('c', 64), (now() at time zone 'Asia/Tokyo')::date,
              'generation_timeout', now(), now()
        where not exists (
          select 1 from private.generation_regeneration_snapshots where user_id = $2::uuid
        )`,
      [requestId, parsedUserId, idempotencyKey],
    );
    // idea は target_member_ids が空配列必須（household は 1〜20 人）
    await client.query(
      `insert into private.generation_regeneration_snapshots (
         request_id, user_id, kind, source_menu_id, source_menu_version,
         replace_dish_id, target_mode, servings, target_member_ids
       )
       select r.id, r.user_id, 'regenerate_menu', $2::uuid, $3,
              null, 'idea', 2, '{}'::uuid[]
         from private.ai_generation_requests r
        where r.user_id = $1::uuid
          and r.id = $4::uuid
          and not exists (
            select 1 from private.generation_regeneration_snapshots s where s.user_id = $1::uuid
          )`,
      [parsedUserId, ctx.menu_id, ctx.menu_version, requestId],
    );
  } finally {
    await client.end();
  }
}

/**
 * 削除証明用に必須ファミリーを seed する。
 * wheat メンバー + household 献立 + idea 献立 + 買い物 を UI で構築し、
 * 不足分は pg で埋めて requiredNonEmptyFamilies をすべて positive にする。
 */
export async function seedCompleteOwnedGraph(page: Page): Promise<{
  userId: string;
  oldToken: string;
}> {
  const oldToken = await accessTokenFromPage(page);
  // JWT の sub を userId として使う（service role を page に載せない）
  const payload = JSON.parse(
    Buffer.from(oldToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { sub?: string };
  const userId = userIdSchema.parse(payload.sub);

  // household 献立（wheat prep 込み）+ idea 献立。その他ファミリーは pg で埋める。
  await seedGeneratedMenu(page);
  await setMockScenario(page, "idea-servings-2");
  await seedGeneratedIdeaMenu(page, 2);

  // Plan 契約: requiredNonEmptyFamilies をすべて positive にする（RLS 非依存）
  await seedMissingOwnedFamiliesViaPg(userId);

  return { userId, oldToken };
}

export async function deleteThroughSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  // 既存メンバー編集コントロールが残っていること
  await expect(
    page.getByRole("button", { name: /この家族の設定を完了|家族を追加/u }).first(),
  ).toBeVisible();

  const danger = page.getByRole("region", { name: "DangerZone" });
  await expect(danger).toBeVisible();
  // 折りたたみ → 展開 → 確認ダイアログ（2 段階）
  await danger.getByRole("button", { name: "アカウントを削除" }).click();
  await danger.getByRole("button", { name: "削除の確認へ進む" }).click();
  const dialog = page.getByRole("dialog", { name: "アカウントを削除しますか？" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/確認のため/u).fill("削除する");
  await dialog.getByRole("button", { name: "完全に削除する" }).click();
  await expect(page).toHaveURL(/\/login/u, { timeout: 30_000 });
}

export const test = authTest.extend<{ acceptancePage: Page }>({
  acceptancePage: async ({ completedOnboardingPage: page }, provide) => {
    await provide(page);
  },
});
