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
    const safeTitle = testInfo.title.replaceAll(/[^a-z0-9]+/giu, "-").slice(0, 30);
    const workerIndex = String(testInfo.workerIndex);
    const timestamp = String(Date.now());
    await provide(`${safeTitle}-${browserName}-${workerIndex}-${timestamp}@example.invalid`);
  },

  authenticatedPage: async ({ page, authEmail }, provide) => {
    const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
    await page.goto(magicLink);
    await expect(page.getByRole("heading", { name: "家族の初回設定" })).toBeVisible();
    await provide(page);
  },

  completedOnboardingPage: async ({ authenticatedPage: page }, provide) => {
    await completeMinimumOnboarding(page);
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL(/\/planner$/u);
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
  await page.getByLabel("年齢区分").selectOption("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel("対象外の食事の確認").selectOption("none");
  await page.getByRole("button", { name: "残りはあとで設定して完了" }).click();
  await page.getByRole("button", { name: "AI情報の説明へ" }).click();
}
