import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** oauth-mock の authorize。query 付きであることまで固定する。 */
export const OAUTH_MOCK_AUTHORIZE_URL = /^http:\/\/127\.0\.0\.1:8788\/authorize\?/u;

/**
 * Google CTA 後の provider 到達を待つ。
 * leftover 掃除は最大 2s、その後 continuation API と signInWithOAuth の
 * リダイレクトが続く。並列 worker 下では 5s 既定を超え、ボタンが
 * 「Googleへ移動中…」のまま URL 断言で落ちる。
 */
export async function expectOAuthMockAuthorizePage(page: Page): Promise<void> {
  await expect(page).toHaveURL(OAUTH_MOCK_AUTHORIZE_URL, { timeout: 15_000 });
}
