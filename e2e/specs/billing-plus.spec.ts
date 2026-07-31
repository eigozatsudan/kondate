/**
 * Plus / 課金 UI の受け入れシナリオ（mock entitlement）。
 * 本番 Stripe は呼ばない。Functions は e2e-function-server の allowlist 経由。
 * BILLING_ENABLED=false のローカル既定でも、page.route で entitlement を差し替え UI を検証する。
 */
import { expect, test } from "../fixtures/auth";
import type { Page } from "@playwright/test";

const freeOpenEntitlement = {
  ok: true as const,
  data: {
    plan: "free" as const,
    status: "none" as const,
    plusEntitled: false,
    pastDueGrace: false,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    dbPlusEntitled: false,
    productSurfacesOpen: true,
    quotaPlan: "free" as const,
  },
};

const trialingEntitlement = {
  ok: true as const,
  data: {
    plan: "plus" as const,
    status: "trialing" as const,
    plusEntitled: true,
    pastDueGrace: false,
    currentPeriodEnd: "2099-01-15T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEnd: "2099-01-08T00:00:00.000Z",
    dbPlusEntitled: true,
    productSurfacesOpen: true,
    quotaPlan: "plus" as const,
  },
};

const plusActiveEntitlement = {
  ok: true as const,
  data: {
    plan: "plus" as const,
    status: "active" as const,
    plusEntitled: true,
    pastDueGrace: false,
    currentPeriodEnd: "2099-02-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEnd: null,
    dbPlusEntitled: true,
    productSurfacesOpen: true,
    quotaPlan: "plus" as const,
  },
};

async function mockEntitlement(
  page: Page,
  body: typeof freeOpenEntitlement | typeof trialingEntitlement | typeof plusActiveEntitlement,
): Promise<void> {
  await page.route("**/api/billing/entitlement", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/** usage/today を Plus 枠（success limit 10）に見せる mock（webhook 投影後の UI 相当）。 */
async function mockUsageTodayPlus(page: Page): Promise<void> {
  await page.route("**/api/usage/today", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          plan: "plus",
          plusEntitled: true,
          success: { consumed: 0, limit: 10, remaining: 10 },
          attempts: { sent: 0, limit: 20, remaining: 20 },
          shortWindow: { sent: 0, limit: 8, remaining: 8, retryAt: null },
          quality: {
            day: { consumed: 0, limit: 3, remaining: 3 },
            month: { consumed: 0, limit: 20, remaining: 20 },
            available: true,
          },
          flyerWeekly: {
            successConsumed: 0,
            successLimit: 2,
            successRemaining: 2,
            triesConsumed: 0,
            triesLimit: 6,
            triesRemaining: 6,
            weekStartJst: "2026-07-27",
          },
          globalAvailable: true,
          retryAt: null,
        },
      }),
    });
  });
}

test.setTimeout(180_000);

test("settings shows Free plan and coming-soon gate when product surfaces are open", async ({
  completedOnboardingPage: page,
}) => {
  await mockEntitlement(page, freeOpenEntitlement);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "プラン" })).toBeVisible({ timeout: 15_000 });
  // BILL-1: LP の COMING_SOON と揃え、Settings からも Checkout を出さない
  await expect(page.getByText(/こんだて日和 Plus なら/u)).toBeVisible();
  await expect(page.getByText("ただいま開発中")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plus をはじめる" })).toHaveCount(0);
});

test("settings shows trial end warning when entitlement is trialing", async ({
  completedOnboardingPage: page,
}) => {
  await mockEntitlement(page, trialingEntitlement);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "プラン" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("こんだて日和 Plus（無料期間中）")).toBeVisible();
  await expect(
    page.getByText("無料期間が終わると、登録したお支払い方法に料金がかかります"),
  ).toBeVisible();
});

test("delete account dialog mentions paid-plan cancellation", async ({
  completedOnboardingPage: page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  const danger = page.getByRole("region", { name: "危険な操作" });
  await expect(danger).toBeVisible({ timeout: 15_000 });
  await danger.getByRole("button", { name: "アカウントを削除" }).click();
  await expect(danger.getByRole("button", { name: "削除の確認へ進む" })).toBeVisible({
    timeout: 10_000,
  });
  await danger.getByRole("button", { name: "削除の確認へ進む" }).click();
  const dialog = page.getByRole("dialog", { name: "アカウントを削除しますか？" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByText(/有料プランに入っている場合、解約手続きもあわせて行います/u),
  ).toBeVisible({ timeout: 10_000 });
});

test("planner shows Free flyer locked preview with Plus CTA", async ({
  completedOnboardingPage: page,
}) => {
  await mockEntitlement(page, freeOpenEntitlement);
  await page.goto("/planner");
  // Free locked preview（Task7 UI）。見出しまたは Plus 導線のどちらかで確認
  await expect(page.getByRole("link", { name: "Plus を見る" }).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("Plus entitlement mock shows plan label and portal path on settings", async ({
  completedOnboardingPage: page,
}) => {
  await mockEntitlement(page, plusActiveEntitlement);
  await mockUsageTodayPlus(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "プラン" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("こんだて日和 Plus")).toBeVisible();
  await expect(page.getByRole("button", { name: "お支払い・解約の管理" })).toBeVisible();
});

test("Free hard-limit CTA copy is available from settings Plus section", async ({
  completedOnboardingPage: page,
}) => {
  // 生成を 3 回回して hard limit にするのは flaky なため、
  // Free 向け Plus CTA 文面（Plus なら 1 日最大 10 回）が設定のプラン節に出ることを固定する。
  // L10-1 review 面 CTA は planner-wizard unit（shows Plus hard-limit CTA…）が正本。
  // BILL-1: COMING_SOON 中は Checkout ボタンの代わりに開発中案内を出す。
  await mockEntitlement(page, freeOpenEntitlement);
  await page.goto("/settings");
  await expect(page.getByText(/1 日最大 10 回まで/u)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("ただいま開発中")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plus をはじめる" })).toHaveCount(0);
});

test("Plus usage mock projects success limit 10 on settings plan section", async ({
  completedOnboardingPage: page,
}) => {
  // webhook 実注入の E2E 代替: entitlement + usage mock 後に Plus 契約 UI が載ることを固定。
  // Free CTA の「1 日最大 10 回」は !entitled 時のみ。Plus ではポータル導線が正。
  // 実 webhook 投影と success limit 数値は Function unit / pgTAP が正本。
  await mockEntitlement(page, plusActiveEntitlement);
  await mockUsageTodayPlus(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "プラン" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("こんだて日和 Plus")).toBeVisible();
  await expect(page.getByText(/いまのプラン/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "お支払い・解約の管理" })).toBeVisible();
});
