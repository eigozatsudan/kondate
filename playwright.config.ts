import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  // ローカルもretryを1回に上げる。browserはnetwork_mode:host経由でViteの
  // 非バンドルmoduleを数百件取得するため、host側のnetwork構成変更で
  // ERR_NETWORK_CHANGEDが起きるとSPAがmountできず白紙のまま落ちる。
  // 環境由来の瞬断1回でsuite全体を落とさないための保険。
  // アプリ race / helper 非決定性を 2 回目 green で隠さないこと（テスト自体を決定論的に保つ）。
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    // CI では trace/video を無効化し、DOM・入力・通信 header/body を artifact に載せない。
    // local は retain-on-failure。screenshot は only-on-failure のまま（pixel のみ）。
    trace: process.env.PLAYWRIGHT_DISABLE_TRACE === "1" ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.PLAYWRIGHT_DISABLE_TRACE === "1" ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone SE"], browserName: "chromium" },
      // @desktop-only は desktop project 専用。config の grepInvert が skip の単一入口
      // （fixture beforeEach には載せない。raw @playwright/test import にも効く）。
      grepInvert: /@desktop-only/,
    },
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      // @mobile-only は mobile project 専用（例: mobile-accessibility の二重実行を防ぐ）。
      grepInvert: /@mobile-only/,
    },
  ],
});
