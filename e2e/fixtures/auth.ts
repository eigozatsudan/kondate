import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test as base, type Frame, type Page } from "@playwright/test";
import { z } from "zod";
import { browserSupabaseSessionStorageKey } from "../../src/features/auth/auth-flow";
import { confirmAddScopeNotice } from "./household";
import { readLocalPublishableKey } from "./local-supabase";

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

/** Admin generateLink 応答の properties（必要なキーのみ） */
const generateLinkPropertiesSchema = z.object({
  action_link: z.url(),
  hashed_token: z.string().min(16),
  verification_type: z.string().min(1),
});

/** GoTrue /auth/v1/user の最低限（session.user へ載せる） */
const authUserSchema = z.looseObject({
  id: z.uuid(),
  email: z.string().optional(),
  role: z.string().optional(),
  aud: z.string().optional(),
  app_metadata: z.record(z.string(), z.unknown()).optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});

const APP_ORIGIN = "http://127.0.0.1:5173";
const SUPABASE_PUBLIC_URL = "http://127.0.0.1:8000";

type AuthFixtures = {
  authEmail: string;
  authenticatedPage: Page;
  completedOnboardingPage: Page;
  ideaModePage: Page;
};

export const test = base.extend<AuthFixtures>({
  authEmail: async ({ browserName }, provide, testInfo) => {
    // full は mobile/desktop を別プロセスで並列する。両 project とも
    // browserName=chromium、serial file は workerIndex=0 なので、title+browser+
    // worker+Date.now() だけだと同一 ms で email / identity が衝突する。
    // project.name と pid でプロセス一意性を足す。quota 定数は変えない。
    const workerIndex = String(testInfo.workerIndex);
    const timestamp = String(Date.now());
    const pid = String(process.pid);
    const safeProject = testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-").toLowerCase();
    // local-part 上限 64。衝突回避に効く project/pid/worker/時刻を先に置き、title は余り。
    const prefix = `${safeProject}-${browserName}-${workerIndex}-${pid}-${timestamp}`;
    const titleBudget = Math.max(1, 64 - prefix.length - 1);
    const safeTitle = testInfo.title
      .replaceAll(/[^a-z0-9]+/giu, "-")
      .slice(0, titleBudget)
      .toLowerCase();
    await provide(`${prefix}-${safeTitle}@example.invalid`);
  },

  authenticatedPage: async ({ page, authEmail }, provide) => {
    // Phase 3 Task 12: 使い捨て認証の既定は Admin generateLink（Mailpit 非経由）。
    // UI メール送信 + Mailpit 成功 path は auth.setup / auth-recovery が担う。
    await loginAsNewUser(page, authEmail);
    // sanitizeReturnPath は継続 API が拒否する裸の "/" を "/planner" へ正規化するため、
    // magic-link 経由のログイン自体は常に /planner へ着地する（既存仕様・変更なし）。
    // RootEntryPage の新規振分け（not_started|in_progress→/welcome）を検証するには、
    // ログイン後に改めて "/" へ遷移して RootEntryPage の profile 判定を経由する必要がある。
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/welcome", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "どちらから始めますか？" })).toBeVisible();
    // AI 共有枠の truncate は fixture / test から呼ばない（Phase 3: suite/project 境界の shell のみ）。
    // 並列 workers 下で test/fixture から truncate すると他 worker の予約枠を破壊する。
    await provide(page);
  },

  completedOnboardingPage: async ({ authenticatedPage: page }, provide) => {
    // UI クリック経路は onboarding.spec / full-journey household が担う。
    // 完了済み前提の fixture は DB seed で profile・家族1名・privacy を一括投入する。
    // service role は page に渡さない（seed-onboarding 内で .env から読む）。
    const { seedCompletedOnboardingState } = await import("./seed-onboarding");
    await seedCompletedOnboardingState(page);
    // AI 共有枠の truncate は fixture / test から呼ばない（Phase 3: shell 境界のみ）。
    await provide(page);
  },

  // ideaModePage は onboarding_status が not_started のまま /welcome を開く必要がある。
  // 主文言は「献立アイデアを考える」(not_started)。in_progress 後は
  // 「設定せず献立アイデアを考える」になるため、この fixture を使わない。
  // provide（use ではない）で eslint react-hooks を通す — shopping.ts と同じ。
  ideaModePage: async ({ authenticatedPage: page }, provide) => {
    await page.goto("/welcome");
    await page.getByRole("button", { name: "献立アイデアを考える" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    // AI 共有枠の truncate は fixture / test から呼ばない（Phase 3: shell 境界のみ）。
    await provide(page);
  },
});

export { expect };

/**
 * Auth Admin（service role）。secret は .env のみ、page には渡さない。
 * seed-onboarding / acceptance と同じパターン。
 */
async function createServiceAdmin() {
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  const serviceRoleKey = z
    .string()
    .min(20)
    .parse(/^SERVICE_ROLE_KEY=(.+)$/mu.exec(envText)?.[1]?.trim());
  return createClient(SUPABASE_PUBLIC_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GoTrue が返す action_link をブラウザ到達可能な公開 origin 向けに正規化する。
 * 内部ホスト（auth / kong 等）や localhost は 127.0.0.1:8000 へ。
 * redirect_to は未ログインでも hash を落とさない /login に寄せる
 * （/planner は protected で login へ飛ばし fragment が消える）。
 */
export function normalizeGenerateLinkActionUrl(actionLink: string): string {
  const url = new URL(actionLink);
  const internalHosts = new Set(["auth", "kong", "supabase-auth", "localhost", "0.0.0.0"]);
  // GoTrue 内部 URL や :9999 直叩きはブラウザから届かないため公開 Kong へ寄せる
  if (internalHosts.has(url.hostname) || url.port === "9999") {
    const publicBase = new URL(SUPABASE_PUBLIC_URL);
    url.protocol = publicBase.protocol;
    url.hostname = publicBase.hostname;
    url.port = publicBase.port;
  }
  // path が /verify のみの場合は /auth/v1/verify に揃える（公開 API 経由）
  if (url.pathname === "/verify" || url.pathname === "/verify/") {
    url.pathname = "/auth/v1/verify";
  }
  // 未ログインでも滞在する path。session 確立前の /planner は login へ飛ばして hash を失う。
  const safeRedirect = `${APP_ORIGIN}/login`;
  const redirectTo = url.searchParams.get("redirect_to");
  if (redirectTo === null || redirectTo.trim() === "") {
    url.searchParams.set("redirect_to", safeRedirect);
  } else {
    try {
      const redirectUrl = new URL(redirectTo);
      const isAppOrigin =
        redirectUrl.origin === APP_ORIGIN ||
        (redirectUrl.hostname === "127.0.0.1" && redirectUrl.port === "5173");
      // /planner 等の protected 着地は hash ロストの原因になるので /login へ強制
      if (!isAppOrigin || redirectUrl.pathname !== "/login") {
        url.searchParams.set("redirect_to", safeRedirect);
      }
    } catch {
      url.searchParams.set("redirect_to", safeRedirect);
    }
  }
  return url.href;
}

type HashSessionTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: string | null;
  expires_at: string | null;
  token_type: string | null;
};

/** URL の hash / query から GoTrue implicit トークンを拾う */
function parseSessionTokensFromHref(href: string): HashSessionTokens | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const fromHash = new URLSearchParams(url.hash.replace(/^#/u, ""));
  const fromQuery = url.searchParams;
  const accessToken = fromHash.get("access_token") ?? fromQuery.get("access_token");
  const refreshToken = fromHash.get("refresh_token") ?? fromQuery.get("refresh_token");
  if (accessToken === null || refreshToken === null) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: fromHash.get("expires_in") ?? fromQuery.get("expires_in"),
    expires_at: fromHash.get("expires_at") ?? fromQuery.get("expires_at"),
    token_type: fromHash.get("token_type") ?? fromQuery.get("token_type"),
  };
}

/**
 * Admin generateLink（type: magiclink）で URL を取得し、ブラウザで開いてログインする。
 * Mailpit は踏まない。失敗時は throw（Mailpit へ黙ってフォールバックしない）。
 *
 * 製品 SPA は detectSessionInUrl:false（C7: implicit fragment 拒否）のため、
 * GoTrue verify が hash に載せた実トークンを storage へ載せてから /planner を開き直す。
 * addInitScript による事前 session 手注入は行わない（Spec §7.5）。
 */
export async function loginAsNewUser(page: Page, email: string): Promise<void> {
  const admin = await createServiceAdmin();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${APP_ORIGIN}/login` },
  });
  if (error !== null) {
    throw new Error(`generateLink failed: ${error.message}`);
  }
  const properties = generateLinkPropertiesSchema.safeParse(data.properties);
  if (!properties.success) {
    throw new Error(
      `generateLink response missing action_link/hashed_token/verification_type: ${properties.error.message}`,
    );
  }

  const browserUrl = normalizeGenerateLinkActionUrl(properties.data.action_link);

  // SPA が hash を落とす前に main frame の着地 URL を掴む（protected への誤着地対策込み）。
  let capturedHref: string | undefined;
  const onFrameNavigated = (frame: Frame): void => {
    // main frame のみ（about:blank 等の子 frame は無視）
    if (frame !== page.mainFrame()) return;
    const href = frame.url();
    if (href.includes("access_token=")) {
      capturedHref = href;
    }
  };
  page.on("framenavigated", onFrameNavigated);
  try {
    // GoTrue GET /verify → redirect_to#access_token=…（implicit）。Mailpit 成功 path とは別経路。
    await page.goto(browserUrl, { waitUntil: "commit" });
    if (page.url().includes("access_token=")) {
      capturedHref = page.url();
    }
    await expect
      .poll(() => capturedHref ?? page.url(), {
        timeout: 30_000,
        intervals: [50, 100, 250, 500, 1_000],
      })
      .toContain("access_token=");
  } finally {
    page.off("framenavigated", onFrameNavigated);
  }

  const hashTokens =
    parseSessionTokensFromHref(capturedHref ?? page.url()) ??
    (await page.evaluate(() => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
      const query = new URLSearchParams(window.location.search);
      const accessToken = params.get("access_token") ?? query.get("access_token");
      const refreshToken = params.get("refresh_token") ?? query.get("refresh_token");
      if (accessToken === null || refreshToken === null) return null;
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: params.get("expires_in") ?? query.get("expires_in"),
        expires_at: params.get("expires_at") ?? query.get("expires_at"),
        token_type: params.get("token_type") ?? query.get("token_type"),
      };
    }));
  if (hashTokens === null) {
    // fail-closed: Mailpit へフォールバックしない
    throw new Error(
      "generateLink action_link did not land with access_token/refresh_token in URL hash",
    );
  }

  // 実トークンで user を取得し、supabase-js が _saveSession するのと同型を storage へ載せる。
  // service role は page に渡さない（anon + user JWT のみ）。
  const publishableKey = await readLocalPublishableKey();
  const userResponse = await page.request.get(`${SUPABASE_PUBLIC_URL}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${hashTokens.access_token}`,
    },
  });
  if (!userResponse.ok()) {
    throw new Error(
      `auth user lookup after generateLink failed: HTTP ${String(userResponse.status())}`,
    );
  }
  const user = authUserSchema.parse(await userResponse.json());
  const expiresIn = Number(hashTokens.expires_in ?? 3600);
  const expiresAt = Number(
    hashTokens.expires_at ?? String(Math.floor(Date.now() / 1000) + expiresIn),
  );
  if (!Number.isFinite(expiresIn) || !Number.isFinite(expiresAt)) {
    throw new Error("generateLink redirect hash has non-numeric expires_in/expires_at");
  }
  const session = {
    access_token: hashTokens.access_token,
    refresh_token: hashTokens.refresh_token,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: hashTokens.token_type ?? "bearer",
    user,
  };

  await page.evaluate(
    ({ storageKey, sessionJson }) => {
      window.localStorage.setItem(storageKey, sessionJson);
    },
    {
      storageKey: browserSupabaseSessionStorageKey,
      sessionJson: JSON.stringify(session),
    },
  );

  // hash を捨て、AuthProvider が storage から session を拾うよう clean に /planner を開く。
  // callback→session 確立はモバイル・負荷下で 5s 既定を超え得る（oauth-mock と同様 30s）。
  await page.goto(`${APP_ORIGIN}/planner`);
  await expect(page).toHaveURL((url) => url.pathname === "/planner", { timeout: 30_000 });
}

/**
 * UI メール送信 + Mailpit から magic-link URL を読む（auth 成功回帰用）。
 * setup project と auth-recovery / oauth 系が使う。ephemeral authenticatedPage の既定ではない。
 */
export async function requestMagicLinkAndReadUrl(page: Page, email: string): Promise<string> {
  // メール導線は SHOW_EMAIL_LOGIN=true で既定表示。emailLogin=1 は互換・明示用。
  await page.goto("/login?returnTo=%2Fplanner&emailLogin=1");
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
        // token_hash テンプレ（本番）: アプリ /auth/callback?...&token_hash=
        // 旧 / ローカル既定: GoTrue ConfirmationURL の /auth/v1/verify
        const tokenHashMatch = body.match(
          /https?:\/\/[^"'<>\s]+\/auth\/callback\?[^"'<>\s]*token_hash=[^"'<>\s]*/u,
        );
        const verifyMatch = body.match(/https?:\/\/[^"'<>\s]+\/auth\/v1\/verify[^"'<>\s]*/u);
        const raw = tokenHashMatch?.[0] ?? verifyMatch?.[0];
        link = raw?.replaceAll("&amp;", "&");
        return link ?? "";
      },
      { timeout: 15_000, intervals: [250, 500, 1_000] },
    )
    .toMatch(/\/auth\/(?:callback|v1\/verify)/u);

  if (link === undefined) throw new Error("Magic-link URL was not found in Mailpit");
  return link;
}

export async function completeMinimumOnboarding(page: Page): Promise<void> {
  await page.getByRole("button", { name: "家族設定を始める" }).click();
  await confirmAddScopeNotice(page);
  await page.getByLabel("年齢のめやす").selectOption("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel(/このアプリで献立を作れない事情はありますか/).selectOption("none");
  // サブパスBで「残りはあとで設定して完了」「この内容で設定を完了する」の2種類の
  // 完了ボタン文言が「この家族の設定を完了する」へ統一された（家族設定が任意で
  // あることを明確に伝えるための文言変更）。旧文言のままだとE2Eがボタンを
  // 見つけられずタイムアウトするため、新文言に追随する。
  await page.getByRole("button", { name: "この家族の設定を完了する" }).click();
  // 家族アテンション強化後: 1人目完了直後は次アクション画面に留まる。
  // planner へ進む共通 fixture は「献立を始める」を押すまで完了とみなす。
  await expect(page.getByRole("heading", { name: /人目の登録が完了しました/u })).toBeVisible();
  await page.getByRole("button", { name: "献立を始める" }).click();
}
