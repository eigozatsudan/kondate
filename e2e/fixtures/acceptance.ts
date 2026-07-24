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
  const { postgresPassword } = await readEnv();
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:54322/postgres?sslmode=disable`,
  });
  await client.connect();
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
 * 削除証明用に必須ファミリーを可能な限り seed する。
 * wheat メンバー + household 献立 + idea 献立 + 買い物 を既存 helper で構築する。
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

  // pantry を1件
  await page.goto("/pantry");
  await expect(page.getByRole("heading", { name: /冷蔵庫|食材/u })).toBeVisible({
    timeout: 15_000,
  });
  const addButton = page.getByRole("button", { name: /食材を追加|追加する/u }).first();
  if (await addButton.isVisible().catch(() => false)) {
    await addButton.click();
    const nameField = page.getByLabel(/名前|食材名/u).first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill("にんじん");
      const save = page.getByRole("button", { name: /保存|追加/u }).last();
      if (await save.isEnabled().catch(() => false)) {
        await save.click().catch(() => undefined);
      }
    }
  }

  // household 献立（wheat prep 込み）
  await seedGeneratedMenu(page);
  // idea 献立
  await setMockScenario(page, "idea-servings-2");
  await seedGeneratedIdeaMenu(page, 2);

  // revalidation を1回走らせて menu_revalidations を確保
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: /履歴|献立/u }).first()).toBeVisible({
    timeout: 15_000,
  });
  const firstCard = page
    .getByRole("link")
    .filter({ hasText: /献立|朝食|夕食|昼食/u })
    .first();
  if (await firstCard.isVisible().catch(() => false)) {
    await firstCard.click();
    await page.waitForTimeout(2_000);
  }

  // shopping は household menu から
  await page.goto("/history");
  const householdLink = page.getByRole("link").first();
  if (await householdLink.isVisible().catch(() => false)) {
    await householdLink.click();
    const shop = page.getByRole("button", { name: "買い物リストを作る" });
    if (await shop.isEnabled().catch(() => false)) {
      await shop.click().catch(() => undefined);
      await page.waitForTimeout(3_000);
    }
  }

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
  await page.getByRole("button", { name: "アカウントを削除" }).click();
  const dialog = page.getByRole("dialog", { name: "アカウントを削除しますか？" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/確認のため/u).fill("削除する");
  await dialog.getByRole("button", { name: "完全に削除する" }).click();
  await expect(page).toHaveURL(/\/login/u, { timeout: 30_000 });
}

export const test = authTest.extend<{ acceptancePage: Page }>({
  acceptancePage: async ({ completedOnboardingPage: page }, provide) => {
    await provide(page);
  },
});
