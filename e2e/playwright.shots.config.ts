import { defineConfig } from "@playwright/test";

/**
 * スクリーンショット撮影専用の一時設定（2026-08-08 UI モダン化 Phase 2〜4 提出物）。
 * 本番 spec と混ざらないよう testDir を e2e/shots に分ける。コミットしない。
 *
 * 実行:
 *   ./scripts/run-e2e.sh --config=e2e/playwright.shots.config.ts --project=shots
 *
 * run-e2e.sh を通すのは、スタック起動・openrouter-mock 固定・AI 日次枠リセット・
 * 後始末をすべて本番 e2e と同じ手順で行うため。--project を渡すと mobile/desktop の
 * 2 段実行にならず 1 回で終わる。
 *
 * 置き場所が e2e/ 配下なのは tsconfig.app.json の include が "e2e" を含むため。
 * リポジトリ直下に置くと typed lint が「project service に無い」で落ちる（実測）。
 */
export default defineConfig({
  testDir: "./shots",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "off",
    video: "off",
    // 撮影は各 spec が明示的に行う。失敗時の自動撮影は要らない。
    screenshot: "off",
  },
  projects: [
    {
      name: "shots",
      use: {
        browserName: "chromium",
        // isMobile は付けない。付けると setViewportSize での幅切り替えが安定しない。
        // タッチ前提の分岐だけ再現したいので hasTouch のみ有効にする。
        hasTouch: true,
        viewport: { width: 375, height: 812 },
      },
    },
  ],
});
