import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { z } from "zod";
import { expect, test } from "@playwright/test";

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
test("oauth-mock cancel returns safe retry copy and erases transient code/state", async ({
  page,
}) => {
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
  await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();

  // transient code/state がアドレスバーから消えている
  const visible = new URL(page.url());
  expect(visible.searchParams.has("code")).toBe(false);
  expect(visible.searchParams.has("state")).toBe(false);
  expect(visible.searchParams.has("error")).toBe(false);
});

test("past expires_at continuation fails with safe retry copy and erases transient params", async ({
  page,
}) => {
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
  await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();

  // transient code/state 消去
  const visible = new URL(page.url());
  expect(visible.searchParams.has("code")).toBe(false);
  expect(visible.searchParams.has("state")).toBe(false);
});

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
  await expect(page).toHaveURL(/\/welcome$/u, { timeout: 30_000 });
  // success 後も code/state は残らない
  expect(new URL(page.url()).searchParams.has("code")).toBe(false);
  expect(new URL(page.url()).searchParams.has("state")).toBe(false);

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

  // mismatched state: 有効そうな形だが state が flow と不一致
  await page.goto(
    `/auth/callback?flow=${flow}&state=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz&code=ccccccccccccccccccccccccccccccccccccccccccc`,
  );
  await expect(
    page.getByText(
      /ログインを確認できませんでした|ログインの情報を確認できませんでした|最初からやり直してください/u,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
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
