import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { z } from "zod";
import { expect, test, type Route } from "@playwright/test";

test.setTimeout(120_000);

async function readPostgresPassword(): Promise<string> {
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  return z
    .string()
    .min(1)
    .parse(/^POSTGRES_PASSWORD=(.+)$/mu.exec(envText)?.[1]?.trim());
}

/**
 * P1#2: oauth-mock cancel authority、past expires_at continuation、
 * safe retry copy、transient code/state 消去を E2E で証明する。
 * 300 秒 sleep は禁止 — expires_at を過去に seed する。
 */
test(
  "oauth-mock cancel returns safe retry copy and erases transient code/state",
  {
    tag: ["@smoke"],
  },
  async ({ page }) => {
    await page.goto("/login?returnTo=%2Fplanner");
    await page.getByRole("button", { name: "Googleで続ける" }).click();
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8788\/authorize\?/u);
    const providerUrl = new URL(page.url());
    const flow = providerUrl.searchParams.get("flow");
    const state = providerUrl.searchParams.get("state");
    expect(flow).toMatch(/^[0-9a-f-]{36}$/u);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const callbackRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/auth/callback",
    );
    await page.getByRole("link", { name: "キャンセル" }).click();
    const callbackUrl = new URL((await callbackRequest).url());
    expect(callbackUrl.searchParams.get("flow")).toBe(flow);
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    expect(callbackUrl.searchParams.get("error")).toBe("access_denied");
    expect(callbackUrl.searchParams.has("code")).toBe(false);

    // safe retry copy + 別手段
    await expect(page.getByText(/Googleログインがキャンセルされました/u)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
    // SHOW_EMAIL_LOGIN=true: メール導線は既定表示（gateway 維持）
    await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();

    // transient code/state がアドレスバーから消えている
    const visible = new URL(page.url());
    expect(visible.searchParams.has("code")).toBe(false);
    expect(visible.searchParams.has("state")).toBe(false);
    expect(visible.searchParams.has("error")).toBe(false);
  },
);

test(
  "past expires_at continuation fails with safe retry copy and erases transient params",
  {
    tag: ["@smoke"],
  },
  async ({ page }) => {
    await page.goto("/login?returnTo=%2Fplanner");
    await page.getByRole("button", { name: "Googleで続ける" }).click();
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8788\/authorize\?/u);
    const providerUrl = new URL(page.url());
    const flowId = z.uuid().parse(providerUrl.searchParams.get("flow"));
    const state = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/u)
      .parse(providerUrl.searchParams.get("state"));

    // 300s sleep せず expires_at を過去へ seed
    const password = await readPostgresPassword();
    const client = new Client({
      connectionString: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:54322/postgres?sslmode=disable`,
    });
    await client.connect();
    try {
      const updated = await client.query(
        `update private.auth_continuations
         set expires_at = now() - interval '1 minute'
       where id = $1::uuid
       returning id, expires_at`,
        [flowId],
      );
      expect(updated.rowCount).toBe(1);
    } finally {
      await client.end();
    }

    const callbackRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/auth/callback",
    );
    await page.getByRole("link", { name: "Googleテスト利用者で続ける" }).click();
    const callbackUrl = new URL((await callbackRequest).url());
    expect(callbackUrl.searchParams.get("flow")).toBe(flowId);
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    expect(callbackUrl.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    // 期限切れ continuation は safe copy でログインへ戻す
    await expect(
      page.getByText(
        /ログインを確認できませんでした|ログインの情報を確認できませんでした|認証をもう一度|期限切れ|最初からやり直してください/u,
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
    // SHOW_EMAIL_LOGIN=true: メール導線は既定表示（gateway 維持）
    await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();

    // transient code/state 消去
    const visible = new URL(page.url());
    expect(visible.searchParams.has("code")).toBe(false);
    expect(visible.searchParams.has("state")).toBe(false);
  },
);

test("matching state reaches callback once; unknown and mismatched state fail safely", async ({
  page,
}) => {
  // 成功経路: 一致 state が元ブラウザで一度だけ交換される
  await page.goto("/login?returnTo=%2F%3Fsource%3Doauth");
  await page.getByRole("button", { name: "Googleで続ける" }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8788\/authorize\?/u);
  const providerUrl = new URL(page.url());
  const flow = providerUrl.searchParams.get("flow");
  const state = providerUrl.searchParams.get("state");
  if (flow === null || state === null) {
    throw new Error("oauth-mock authorize must expose flow and state");
  }

  const callbackRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.origin === "http://127.0.0.1:5173" && url.pathname === "/auth/callback";
  });
  await page.getByRole("link", { name: "Googleテスト利用者で続ける" }).click();
  const callbackUrl = new URL((await callbackRequest).url());
  expect(callbackUrl.searchParams.get("flow")).toBe(flow);
  expect(callbackUrl.searchParams.get("state")).toBe(state);
  expect(callbackUrl.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  // 成功後は code/state を消し、アプリ内の安全な着地先へ。
  // oauth-mock の固定 Google 利用者は DB に残り得るため、not_started→/welcome と
  // complete/skipped→/planner の両方を成功経路として認める（本ケースの関心は state 一致交換）。
  await expect(page).toHaveURL(/\/(welcome|planner)(\?|$)/u, { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.has("code")).toBe(false);
  expect(new URL(page.url()).searchParams.has("state")).toBe(false);

  // 成功後は authenticated のため Login が Navigate でエラー UI を隠す。
  // unknown / mismatched 失敗コピーを見るため、再利用ケースと同じくセッションを捨てる。
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();

  // unknown state: 存在しない flow/state で callback
  await page.goto(
    "/auth/callback?flow=00000000-0000-4000-8000-000000000099&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  await expect(
    page.getByText(
      /ログインを確認できませんでした|ログインの情報を確認できませんでした|最初からやり直してください/u,
    ),
  ).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).searchParams.has("code")).toBe(false);
  expect(new URL(page.url()).searchParams.has("state")).toBe(false);

  // mismatch 専用の未使用 continuation と、oauth-mock が発行する有効 code を使う。
  await page.goto("/login");
  await page.getByRole("button", { name: "Googleで続ける" }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8788\/authorize\?/u);
  const mismatchProviderUrl = new URL(page.url());
  const mismatchFlow = mismatchProviderUrl.searchParams.get("flow");
  const originalMismatchState = mismatchProviderUrl.searchParams.get("state");
  expect(mismatchFlow).toMatch(/^[0-9a-f-]{36}$/u);
  expect(mismatchFlow).not.toBe(flow);
  expect(originalMismatchState).toMatch(/^[A-Za-z0-9_-]{43}$/u);

  const mismatchedState = "z".repeat(43);
  expect(mismatchedState).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(mismatchedState).not.toBe(originalMismatchState);
  let resolveProviderCallback!: (response: {
    location: string;
    requestResourceType: string;
    status: number;
  }) => void;
  const providerCallback = new Promise<{
    location: string;
    requestResourceType: string;
    status: number;
  }>((resolve) => {
    resolveProviderCallback = resolve;
  });
  // provider page到達後の承認documentだけをrouteし、oauth-mock自身の302 Locationから
  // fresh flowと有効codeを取得する。browser側requestはdeposit前に中断する。
  const approvalMatcher = (url: URL) =>
    url.origin === "http://127.0.0.1:8788" &&
    url.pathname === "/authorize" &&
    url.searchParams.get("action") === "approve";
  const captureProviderCallback = async (route: Route): Promise<void> => {
    const response = await route.fetch({ maxRedirects: 0 });
    resolveProviderCallback({
      location: response.headers()["location"] ?? "",
      requestResourceType: route.request().resourceType(),
      status: response.status(),
    });
    await route.abort("aborted");
  };
  await page.route(approvalMatcher, captureProviderCallback);
  const abortedProviderNavigation = await page
    .getByRole("link", { name: "Googleテスト利用者で続ける" })
    .click()
    .then(
      () => null,
      (error: unknown) => error,
    );
  // locator click はdocument abort後もresolveする場合がある。rejectした場合だけ、
  // 製品不具合を握りつぶさないよう意図したnavigation abortであることを固定する。
  if (abortedProviderNavigation !== null) {
    if (!(abortedProviderNavigation instanceof Error)) {
      throw new Error("provider callback navigation failed with an unknown error");
    }
    expect(abortedProviderNavigation.message).toMatch(/net::ERR_ABORTED/u);
  }

  const providerCallbackResponse = await providerCallback;
  await page.unroute(approvalMatcher, captureProviderCallback);
  expect(providerCallbackResponse.requestResourceType).toBe("document");
  expect(providerCallbackResponse.status).toBe(302);
  const mismatchCallbackUrl = new URL(providerCallbackResponse.location);
  expect(mismatchCallbackUrl.origin).toBe("http://127.0.0.1:5173");
  expect(mismatchCallbackUrl.pathname).toBe("/auth/callback");
  expect(mismatchCallbackUrl.searchParams.get("flow")).toBe(mismatchFlow);
  expect(mismatchCallbackUrl.searchParams.get("state")).toBe(originalMismatchState);
  expect(mismatchCallbackUrl.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);

  mismatchCallbackUrl.searchParams.set("state", mismatchedState);
  await page.goto(mismatchCallbackUrl.toString());
  await expect(
    page.getByText(
      /ログインを確認できませんでした|ログインの情報を確認できませんでした|最初からやり直してください/u,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("code")).toBe(false);
  expect(new URL(page.url()).searchParams.has("state")).toBe(false);
});

test("reused continuation code and state are rejected after a successful exchange", async ({
  page,
}) => {
  // 成功交換を1回行い、同じ callback URL を再訪しても session を増やさず safe fail する。
  // returnTo は planner（sanitize 後の既定）。not_started は welcome ではなく / 経由で振り分け得る。
  await page.goto("/login?returnTo=%2Fplanner");
  await page.getByRole("button", { name: "Googleで続ける" }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8788\/authorize\?/u);

  const callbackRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.origin === "http://127.0.0.1:5173" && url.pathname === "/auth/callback";
  });
  await page.getByRole("link", { name: "Googleテスト利用者で続ける" }).click();
  const firstCallback = new URL((await callbackRequest).url());
  const code = firstCallback.searchParams.get("code");
  const state = firstCallback.searchParams.get("state");
  const flowId = firstCallback.searchParams.get("flow");
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(flowId).toMatch(/^[0-9a-f-]{36}$/u);
  if (code === null || state === null || flowId === null) {
    throw new Error("callback must expose code, state, and flow");
  }
  // 初回交換成功: planner 着地（returnTo）または welcome
  await expect(page).toHaveURL(/\/(planner|welcome)$/u, { timeout: 30_000 });

  // 再利用経路を観測するためセッションを捨て、未認証で同一 callback を再訪する
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();

  // 同一 code/state の再利用は拒否され、safe copy でログインへ戻る
  await page.goto(`/auth/callback?flow=${flowId}&state=${state}&code=${code}`);
  await expect(
    page.getByText(
      /ログインを確認できませんでした|ログインの情報を確認できませんでした|最初からやり直してください/u,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("code")).toBe(false);
  expect(new URL(page.url()).searchParams.has("state")).toBe(false);
});
