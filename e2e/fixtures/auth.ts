import { expect, test as base, type Page } from "@playwright/test";
import { z } from "zod";

const messageListSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      To: z.array(z.object({ Address: z.string() })),
    }),
  ),
});

const messageSchema = z.object({
  HTML: z.string().nullable().optional(),
  Text: z.string().nullable().optional(),
});

type AuthFixtures = {
  authEmail: string;
  authenticatedPage: Page;
  completedOnboardingPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authEmail: async ({ browserName }, provide, testInfo) => {
    const safeTitle = testInfo.title
      .replaceAll(/[^a-z0-9]+/giu, "-")
      .slice(0, 30)
      .toLowerCase();
    const workerIndex = String(testInfo.workerIndex);
    const timestamp = String(Date.now());
    await provide(`${safeTitle}-${browserName}-${workerIndex}-${timestamp}@example.invalid`);
  },

  authenticatedPage: async ({ page, authEmail }, provide) => {
    const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
    await page.goto(magicLink);
    // sanitizeReturnPathは継続APIが拒否する裸の"/"を送信前に"/planner"へ正規化するため、
    // magic-link経由のログイン自体は常に/plannerへ着地する（既存仕様・変更なし）。
    // RootEntryPageの新規振分け（not_started|in_progress→/welcome）を検証するには、
    // ログイン後に改めて"/"へ遷移してRootEntryPageのprofile判定を経由する必要がある。
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/welcome");
    await expect(page.getByRole("heading", { name: "どちらから始めますか？" })).toBeVisible();
    await provide(page);
  },

  completedOnboardingPage: async ({ authenticatedPage: page }, provide) => {
    // welcomeから家族導線を選んでから家族設定を完了する。家族設定の完了は
    // 現在プライバシー同意と切り離されており、直接/plannerへ遷移する。
    // この後で/privacyを独立して開いて同意を保存する。
    await page.getByRole("button", { name: "家族情報を登録する" }).click();
    await completeMinimumOnboarding(page);
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    await page.goto("/privacy?returnTo=%2Fplanner");
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    await provide(page);
  },
});

export { expect };

export async function requestMagicLinkAndReadUrl(page: Page, email: string): Promise<string> {
  await page.goto("/login?returnTo=%2Fplanner");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "ログイン用メールを送る" }).click();
  await expect(page.getByText(`${email} に送りました`)).toBeVisible();

  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const searchUrl = new URL("/api/v1/search", "http://127.0.0.1:8025");
        searchUrl.search = new URLSearchParams({ query: `to:${email}` }).toString();
        const listResponse = await page.request.get(searchUrl.href);
        if (!listResponse.ok()) return "";
        const parsedList = messageListSchema.safeParse(await listResponse.json());
        if (!parsedList.success) return "";
        const message = parsedList.data.messages.find((candidate) =>
          candidate.To.some((recipient) => recipient.Address === email),
        );
        if (message === undefined) return "";
        const detailResponse = await page.request.get(
          `http://127.0.0.1:8025/api/v1/message/${message.ID}`,
        );
        if (!detailResponse.ok()) return "";
        const parsedMessage = messageSchema.safeParse(await detailResponse.json());
        if (!parsedMessage.success) return "";
        const body = parsedMessage.data.HTML ?? parsedMessage.data.Text ?? "";
        const match = body.match(/https?:\/\/[^"'<>\s]+\/auth\/v1\/verify[^"'<>\s]*/u);
        link = match?.[0].replaceAll("&amp;", "&");
        return link ?? "";
      },
      { timeout: 15_000, intervals: [250, 500, 1_000] },
    )
    .toContain("/auth/v1/verify");

  if (link === undefined) throw new Error("Magic-link URL was not found in Mailpit");
  return link;
}

export async function completeMinimumOnboarding(page: Page): Promise<void> {
  await page.getByRole("button", { name: "家族設定を始める" }).click();
  await page.getByLabel("年齢のめやす").selectOption("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel("食べない食事はありますか").selectOption("none");
  // サブパスBで「残りはあとで設定して完了」「この内容で設定を完了する」の2種類の
  // 完了ボタン文言が「この家族の設定を完了する」へ統一された（家族設定が任意で
  // あることを明確に伝えるための文言変更）。旧文言のままだとE2Eがボタンを
  // 見つけられずタイムアウトするため、新文言に追随する。
  await page.getByRole("button", { name: "この家族の設定を完了する" }).click();
}
