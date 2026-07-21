import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  // ローカルもretryを1回に上げる。browserはnetwork_mode:host経由でViteの
  // 非バンドルmoduleを数百件取得するため、host側のnetwork構成変更で
  // ERR_NETWORK_CHANGEDが起きるとSPAがmountできず白紙のまま落ちる。
  // 環境由来の瞬断1回でsuite全体を落とさないための保険。
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["iPhone SE"], browserName: "chromium" } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
