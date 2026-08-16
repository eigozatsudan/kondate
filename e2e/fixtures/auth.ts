import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test as base, type Page } from "@playwright/test";
import { z } from "zod";
import { browserSupabaseSessionStorageKey } from "../../src/features/auth/auth-flow";
import { confirmAddScopeNotice } from "./household";
import { readLocalPublishableKey } from "./local-supabase";
import { parseMailpitOtpCode } from "./mailpit-otp-code";
import { seedPwaInstallTipDismissed } from "./pwa-install-tip";

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
    // 製品外 bootstrap（generateLink + ページ外 verifyOtp）。Mailpit / 6 マスは踏まない。
    // 製品経路（UI 送信 + Mailpit 6 桁）は auth.setup が担う。
    await loginAsNewUser(page, authEmail);
    // sanitizeReturnPath は継続 API が拒否する裸の "/" を "/planner" へ正規化するため、
    // 製品外 bootstrap の着地は常に /planner（既存仕様・変更なし）。
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

/** ページ外 verifyOtp が返す session（トークンだけ。user は別途 /user で取る） */
const bootstrapSessionSchema = z.object({
  access_token: z.string().min(20),
  refresh_token: z.string().min(1),
  expires_in: z.number().optional(),
  expires_at: z.number().optional(),
  token_type: z.string().optional(),
});

/**
 * 製品外 bootstrap。Admin generateLink の hashed_token をページ外で
 * verifyOtp({ token_hash, type: "email" }) し、返った access/refresh を
 * storage へ載せて /planner を開く。
 * action_link を page.goto / request.get しない（製品の番号入力経路ではない）。
 * email_otp は schema に足さない。hashed_token だけを正本にする。
 */
export async function loginAsNewUser(
  page: Page,
  email: string,
  options?: { seedPwaInstallTipDismissed?: boolean },
): Promise<void> {
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

  // 製品外: hashed_token をブラウザに出さず verify する。action_link は踏まない。
  const { data: verified, error: verifyError } = await admin.auth.verifyOtp({
    token_hash: properties.data.hashed_token,
    type: "email",
  });
  if (verifyError !== null) {
    throw new Error("off-page verifyOtp failed");
  }
  const tokens = bootstrapSessionSchema.safeParse(verified.session);
  if (!tokens.success) {
    throw new Error("off-page verifyOtp did not return a session");
  }

  // 実トークンで user を取得し、supabase-js が _saveSession するのと同型を storage へ載せる。
  // service role は page に渡さない（anon + user JWT のみ）。
  const publishableKey = await readLocalPublishableKey();
  const userResponse = await page.request.get(`${SUPABASE_PUBLIC_URL}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${tokens.data.access_token}`,
    },
  });
  if (!userResponse.ok()) {
    throw new Error(
      `auth user lookup after generateLink failed: HTTP ${String(userResponse.status())}`,
    );
  }
  const user = authUserSchema.parse(await userResponse.json());
  const expiresIn = tokens.data.expires_in ?? 3600;
  const expiresAt = tokens.data.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn;
  if (!Number.isFinite(expiresIn) || !Number.isFinite(expiresAt)) {
    throw new Error("off-page verifyOtp session has non-numeric expires_in/expires_at");
  }
  const session = {
    access_token: tokens.data.access_token,
    refresh_token: tokens.data.refresh_token,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: tokens.data.token_type ?? "bearer",
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

  // session 手注入（上の evaluate）のあと、/planner 着地の前に context へ案内フラグを書く。
  // evaluate(setItem) をこのフラグの正本にしない。
  if (options?.seedPwaInstallTipDismissed !== false) {
    await seedPwaInstallTipDismissed(page.context());
  }

  // 製品外で載せた session を AuthProvider が拾うよう clean に /planner を開く。
  // callback→session 確立はモバイル・負荷下で 5s 既定を超え得る（oauth-mock と同様 30s）。
  await page.goto(`${APP_ORIGIN}/planner`);
  await expect(page).toHaveURL((url) => url.pathname === "/planner", { timeout: 30_000 });
}

/**
 * 製品経路: UI で番号メールを送り、Mailpit の Magic / Confirm 本文から 6 桁を読む。
 * URL 正規表現は持たない。本文に http/https が 1 つでもあれば throw。
 * setup project の成功回帰用。ephemeral authenticatedPage の既定ではない。
 */
export async function requestEmailOtpAndReadCode(page: Page, email: string): Promise<string> {
  // メール導線は SHOW_EMAIL_LOGIN=true で既定表示。emailLogin=1 は互換・明示用。
  await page.goto("/login?returnTo=%2Fplanner&emailLogin=1");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "番号をメールで受け取る" }).click();
  await expect(page.getByText(`${email} に送りました`)).toBeVisible();

  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const searchUrl = new URL("/api/v1/search", "http://127.0.0.1:8025");
        searchUrl.search = new URLSearchParams({ query: `to:${email}` }).toString();
        const listResponse = await page.request.get(searchUrl.href);
        if (!listResponse.ok()) return "";
        const parsedList = messageListSchema.safeParse(await listResponse.json());
        if (!parsedList.success) return "";
        // 新規は Confirm、既存は Magic。両方の本文を見る（テンプレ制約は同じ）。
        const messages = parsedList.data.messages.filter((candidate) =>
          candidate.To.some((recipient) => recipient.Address === email),
        );
        for (const message of messages) {
          const detailResponse = await page.request.get(
            `http://127.0.0.1:8025/api/v1/message/${message.ID}`,
          );
          if (!detailResponse.ok()) continue;
          const parsedMessage = messageSchema.safeParse(await detailResponse.json());
          if (!parsedMessage.success) continue;
          const parts = [parsedMessage.data.HTML, parsedMessage.data.Text].filter(
            (part): part is string => typeof part === "string" && part !== "",
          );
          if (parts.length === 0) continue;
          for (const part of parts) {
            if (part.includes("http") || part.includes("https")) {
              throw new Error("Mailpit message contained an http(s) fragment");
            }
          }
          for (const part of parts) {
            try {
              code = parseMailpitOtpCode(part);
              return code;
            } catch {
              // この part に 6 桁が無い（未到着・別便）。URL 残存は上で throw 済み。
            }
          }
        }
        return "";
      },
      { timeout: 15_000, intervals: [250, 500, 1_000] },
    )
    .toMatch(/^\d{6}$/u);

  if (code === undefined) throw new Error("OTP code was not found in Mailpit");
  return code;
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
