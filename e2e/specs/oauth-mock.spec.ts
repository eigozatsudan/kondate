import { expect, test } from "@playwright/test";

test("local Google success returns the bound code to the app and establishes a Supabase session", async ({
  page,
}) => {
  await page.goto("/login?returnTo=%2Fonboarding");
  await page.getByRole("button", { name: "Googleで続ける" }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8788\/authorize\?/u);
  const providerUrl = new URL(page.url());
  expect(providerUrl.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5173/auth/callback");
  expect(providerUrl.searchParams.get("flow")).toMatch(/^[0-9a-f-]{36}$/u);
  expect(providerUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(providerUrl.href).not.toMatch(/token|password|email/iu);

  const callbackRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.origin === "http://127.0.0.1:5173" && url.pathname === "/auth/callback";
  });
  await page.getByRole("link", { name: "Googleテスト利用者で続ける" }).click();
  const callbackUrl = new URL((await callbackRequest).url());
  expect(callbackUrl.searchParams.get("flow")).toBe(providerUrl.searchParams.get("flow"));
  expect(callbackUrl.searchParams.get("state")).toBe(providerUrl.searchParams.get("state"));
  expect(callbackUrl.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(callbackUrl.href).not.toMatch(/access_token|refresh_token|password|email/iu);
  await expect(page).toHaveURL(/\/onboarding$/u);
  await expect(page.getByRole("heading", { name: "家族の初回設定" })).toBeVisible();
});

test("local Google cancellation returns through the app callback with actionable choices", async ({
  page,
}) => {
  await page.goto("/login?returnTo=%2Fplanner");
  await page.getByRole("button", { name: "Googleで続ける" }).click();
  const providerUrl = new URL(page.url());
  const callbackRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/auth/callback",
  );
  await page.getByRole("link", { name: "キャンセル" }).click();
  const callbackUrl = new URL((await callbackRequest).url());
  expect(callbackUrl.searchParams.get("flow")).toBe(providerUrl.searchParams.get("flow"));
  expect(callbackUrl.searchParams.get("state")).toBe(providerUrl.searchParams.get("state"));
  expect(callbackUrl.searchParams.get("error")).toBe("access_denied");
  expect(callbackUrl.searchParams.has("code")).toBe(false);
  await expect(page.getByText(/Googleログインがキャンセルされました/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();
});
