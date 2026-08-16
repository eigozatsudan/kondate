# PWA（インストール可能 + アプリシェル）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本編をホーム画面に置け、再訪でハッシュ付き JS/CSS とアイコンだけを Cache Storage から返す（データはキャッシュしない）。

**Architecture:** 許可リスト型の小さな `dist/sw.js`（Workbox なし）。案内は端末フラグ `kondate:preferences:pwa-install-tip-dismissed`。シェル URL は `/`。ナビ失敗は自 `CACHE_NAME` のみ。BIP は `main.tsx` 初期化で取る。E2E 既定は `addInitScript` で dismiss。

**Tech Stack:** Vite 8、esbuild（既存）、Netlify `_headers`、Vitest、Playwright、Docker `app`。

**Spec:** `docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`（**レビュー MF 反映済み**）
**Reviews:** `docs/superpowers/reviews/2026-08-16-pwa-installable-app-shell-{primary,adversarial,secondary}.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、`strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。コードコメント・コミットメッセージは日本語（Conventional Commits）
- Docker: `docker compose run --rm --no-deps app <cmd>`（エージェントは `&&` / `;` でコマンド連結しない）
- `vite-plugin-pwa` / Workbox を足さない。`package.json` の `build` 文字列（`tsc -b && vite build`）は変えない
- CSP `CSP_STATIC_DIRECTIVES` に token を足さない。グローバル `[[headers]]` に CSP を戻さない
- Auth ロック（`AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` / `ownedAuthStoragePrefixes`）を再定義しない
- 案内キーを `isOwnedBrowserStorageKey` に足さない
- `skipWaiting` / `clients.claim` / 実行時 `cache.put` / グローバル `caches.match` を呼ばない
- `@shared/safety` をブラウザへ import しない
- `git push` / 本番 deploy / 破壊的 git は人間の明示指示なしで行わない

## File map

| ファイル | 責務 |
| --- | --- |
| `src/features/pwa/install-surface.ts` | `detectInstallSurface` / `isStandaloneDisplayMode` |
| `src/features/pwa/install-tip-eligibility.ts` | `shouldShowInstallTip` |
| `src/features/pwa/install-tip-storage.ts` | dismiss キーの read/write |
| `src/features/pwa/install-tip-copy.ts` | 固定日本語 |
| `src/features/pwa/android-install-prompt.ts` | BIP 早期 listen + inject |
| `src/features/pwa/register-service-worker.ts` | PROD のみ register |
| `src/features/pwa/home-screen-install-card.tsx` | 初回カード |
| `src/features/pwa/home-screen-install-section.tsx` | 設定常設 |
| `src/pwa/service-worker-routing.ts` | fetch 判定純関数 |
| `src/pwa/service-worker.ts` | SW エントリ |
| `src/pwa/sw-defines.d.ts` | `__KONDATE_SW_*` |
| `scripts/generate-service-worker.mjs` | Precache + esbuild |
| `scripts/csp-headers.mjs` | `_headers` 本文 |
| `public/manifest.webmanifest` / `public/icons/*` | インストール資産 |
| `index.html` / `src/main.tsx` / `vite.config.ts` | 配線 |
| `src/app/layouts/app-shell.tsx` | カードマウント |
| `src/features/household/household-settings-page.tsx` | 設定マウント |
| `e2e/fixtures/pwa-install-tip.ts` | dismiss ヘルパ |
| `e2e/specs/pwa-install-tip.spec.ts` | 案内 E2E |

---

### Task 1: 検出・資格・ストレージ

**Files:**
- Create: `src/features/pwa/install-surface.ts`
- Create: `src/features/pwa/install-surface.test.ts`
- Create: `src/features/pwa/install-tip-eligibility.ts`
- Create: `src/features/pwa/install-tip-eligibility.test.ts`
- Create: `src/features/pwa/install-tip-storage.ts`
- Create: `src/features/pwa/install-tip-storage.test.ts`
- Modify: `src/features/auth/auth-cleanup.test.ts`（本キーが logout 後も残る 1 本）

**Interfaces:**
- Produces:
  - `export type InstallSurface = "ios" | "android" | "other"`
  - `export function detectInstallSurface(userAgent: string, platform: string, maxTouchPoints: number): InstallSurface`
  - `export function isStandaloneDisplayMode(matchesStandalone: boolean, navigatorStandalone: boolean | undefined): boolean`
  - `export const PWA_INSTALL_TIP_DISMISSED_KEY = "kondate:preferences:pwa-install-tip-dismissed"`
  - `export function shouldShowInstallTip(input: { hasSession: boolean; pathname: string; surface: InstallSurface; standalone: boolean; dismissed: boolean }): boolean`
  - `export function readInstallTipDismissed(storage: Pick<Storage, "getItem">): boolean`
  - `export function writeInstallTipDismissed(storage: Pick<Storage, "setItem">): boolean`（書けたら true）

- [ ] **Step 1: 失敗するテストを書く**

`install-surface.test.ts`: iPhone / iPod / `CriOS` を含む iPhone / iPad / `MacIntel`+`maxTouchPoints>1` は `ios`。`Mozilla/5.0 (Linux; Android 14; Pixel)` は `android`。`Windows NT` と `Macintosh` + touch 0 と `Linux x86_64`（`Android` なし）は `other`。standalone は media true または `navigatorStandalone === true`。

`install-tip-eligibility.test.ts`: `/planner` + session + ios + 未 dismiss + 非 standalone は true。`hasSession:false` / standalone / dismissed / other / `/settings` / `/welcome` / `/` / `/onboarding` / `/privacy` は false。`/menus/x` / `/plus` / `/emergency-menus` / `/emergency-menus/x` は true。

`install-tip-storage.test.ts`: 欠落と `"0"` は false。`"1"` は true。`setItem` が throw したら `writeInstallTipDismissed` は false。

`auth-cleanup.test.ts` の preferences 生存ケースに `PWA_INSTALL_TIP_DISMISSED_KEY` を足す（import は `@/features/pwa/install-tip-storage`）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/install-surface.test.ts src/features/pwa/install-tip-eligibility.test.ts src/features/pwa/install-tip-storage.test.ts src/features/auth/auth-cleanup.test.ts`

Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 最小実装**

`detectInstallSurface` は Spec §8.2 の関数をそのまま。`shouldShowInstallTip` は Spec §8.3 の 5 条件。出す path: `/planner` `/generation` `/pantry` `/history` `/shopping` `/plus`、または `/menus/` `/history/` `/emergency-menus` で始まるもの。`writeInstallTipDismissed` は `storage.setItem(key, "1")` を try。

owned 掃除関数にはキーを足さない。

- [ ] **Step 4: テストが通ることを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/install-surface.test.ts src/features/pwa/install-tip-eligibility.test.ts src/features/pwa/install-tip-storage.test.ts src/features/auth/auth-cleanup.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/pwa/install-surface.ts src/features/pwa/install-surface.test.ts src/features/pwa/install-tip-eligibility.ts src/features/pwa/install-tip-eligibility.test.ts src/features/pwa/install-tip-storage.ts src/features/pwa/install-tip-storage.test.ts src/features/auth/auth-cleanup.test.ts
git commit -m "feat(pwa): インストール面の検出と案内フラグを追加"
```

---

### Task 2: 案内 UI・設定・E2E dismiss

**Files:**
- Create: `src/features/pwa/install-tip-copy.ts`
- Create: `src/features/pwa/install-tip-copy.test.ts`
- Create: `src/features/pwa/android-install-prompt.ts`
- Create: `src/features/pwa/android-install-prompt.test.ts`
- Create: `src/features/pwa/home-screen-install-card.tsx`
- Create: `src/features/pwa/home-screen-install-card.test.tsx`
- Create: `src/features/pwa/home-screen-install-section.tsx`
- Create: `src/features/pwa/home-screen-install-section.test.tsx`
- Create: `e2e/fixtures/pwa-install-tip.ts`
- Create: `e2e/specs/pwa-install-tip.spec.ts`
- Modify: `src/main.tsx`（`listenForAndroidInstallPrompt()` を `createRoot` より前）
- Modify: `src/app/layouts/app-shell.tsx`（Outlet 直前にカード）
- Modify: `src/app/layouts/app-shell.test.tsx`（カード非表示を既定にできるなら storage mock）
- Modify: `src/features/household/household-settings-page.tsx`（空家族・家族ありの `PlanSettingsSection` 直前）
- Modify: `src/features/household/household-settings-page.test.tsx`（`HomeScreenInstallSection` を Plan と同様に mock）
- Modify: `e2e/fixtures/auth.ts`（`loginAsNewUser` は **`page.context()` に** addInitScript。L206 は session 手注入のみ禁止）
- Modify: `e2e/fixtures/seed-onboarding.ts`（再訪は同一 context の addInitScript が効くこと。未 seed なら足す）
- Modify: `e2e/specs/auth.setup.ts`（**最初の `goto` より前**に context addInitScript。`storageState()` はその結果を保存するだけ。着地後 `evaluate` を正本にしない）
- Modify: `e2e/fixtures/session-auth.ts`（`newContext` 直後に `context.addInitScript`）
- Modify: `e2e/specs/auth-recovery.spec.ts`（magic-link `goto` より前にその context へ seed）
- Modify: `e2e/specs/oauth-mock.spec.ts`（planner 着地前に context seed）
- 追加不要: `generation-recovery-results.spec.ts` / `shopping-list-races.spec.ts` の `context.newPage()`（親 fixture が context seed 済みなら同一 origin の localStorage を見る）

**Interfaces:**
- Consumes: Task 1 の関数と `PWA_INSTALL_TIP_DISMISSED_KEY`
- Produces:
  - copy 定数（Spec §8.4 の exact 文字列）
  - `listenForAndroidInstallPrompt(): void`（唯一の呼び出しは `main.tsx` の `createRoot` より前。surface では分岐しない）
  - `peekAndroidInstallPrompt(): { prompt(): Promise<void> } | null`（カードの Android ボタン正本）
  - `useAndroidInstallPrompt(): { prompt(): Promise<void> } | null`（peek の薄いラップでも可）
  - `resetAndroidInstallPromptForTests(): void`
  - `injectAndroidInstallPromptForTests(event: { prompt(): Promise<void> }): void`
  - `loginAsNewUser(page, email, options?: { seedPwaInstallTipDismissed?: boolean })`（既定 `true`。本機能 E2E だけ `false`）
  - `HomeScreenInstallCard`（Android は `peekAndroidInstallPrompt()` で「インストールする」。inject 済みなら手順リストなし）
  - `HomeScreenInstallSection`
  - `seedPwaInstallTipDismissed(target: { addInitScript(script: (key: string) => void, arg: string): Promise<void> }): Promise<void>`（**context 優先**）

- [ ] **Step 1: copy / BIP / カード / 設定の失敗テスト**

copy: 見出し `ホーム画面に置く`、設定見出し `ホーム画面に追加`、閉じる `わかりました`、Android ボタン `インストールする`、iOS 3 手順、Android 2 手順、other 1 文。`PWA` を含まない。

BIP: `listenForAndroidInstallPrompt` 後にカスタムイベント相当を inject し、`peek` が `prompt` を持つ。`reset` で null。

カード: ios + 資格ありで `h2`「ホーム画面に置く」と「わかりました」（min 44）。click で `writeInstallTipDismissed`。`setItem` throw でも同一マウントでは見出しが消える。storage 空の再マウントでは再表示。android + `injectAndroidInstallPromptForTests` 済みで `peekAndroidInstallPrompt()` 経由の「インストールする」、手順リストなし。`other` では render null。

設定: ios / android / other で対応手順。`h2`「ホーム画面に追加」。

- [ ] **Step 2: テスト失敗を確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/install-tip-copy.test.ts src/features/pwa/android-install-prompt.test.ts src/features/pwa/home-screen-install-card.test.tsx src/features/pwa/home-screen-install-section.test.tsx`

Expected: FAIL

- [ ] **Step 3: 実装**

`android-install-prompt.ts`: モジュール変数。`listen` は `window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); held = event; })`。テスト用 reset/inject を export。

`main.tsx`: `captureAndStripAuthCallbackUrl()` のあと、`listenForAndroidInstallPrompt()`。

`HomeScreenInstallCard`: `useAuth` の session、`useLocation`、`matchMedia("(display-mode: standalone)")`、`detectInstallSurface(...)`、`readInstallTipDismissed(localStorage)`、**`peekAndroidInstallPrompt()`**。資格が無ければ null。Android かつ peek 非 null なら「インストールする」のみ（手順リストなし）。メモリ dismiss state を持ち、write 失敗でも閉じる。

AppShell: `<HomeScreenInstallCard />` を `<Outlet />` の直前。

設定: 空家族・家族ありの両方、`PlanSettingsSection` コンポーネントの直前に `<HomeScreenInstallSection />`（行番号は正としない。読込中 early return には置かない）。

`household-settings-page.test.tsx`:

```ts
vi.mock("@/features/pwa/home-screen-install-section", () => ({
  HomeScreenInstallSection: () => (
    <section aria-label="ホーム画面に追加">ホーム画面に追加</section>
  ),
}));
```

`e2e/fixtures/pwa-install-tip.ts`:

```ts
import { PWA_INSTALL_TIP_DISMISSED_KEY } from "../../src/features/pwa/install-tip-storage";

export async function seedPwaInstallTipDismissed(target: {
  addInitScript(
    script: (key: string) => void,
    arg: string,
  ): Promise<void>;
}): Promise<void> {
  await target.addInitScript((key) => {
    window.localStorage.setItem(key, "1");
  }, PWA_INSTALL_TIP_DISMISSED_KEY);
}
```

`loginAsNewUser(page, email, options?: { seedPwaInstallTipDismissed?: boolean })`: 既定 `true`。true のとき **`page.context()` に** `seedPwaInstallTipDismissed`。session の `evaluate` のあと、**`page.goto("/planner")` の前**。`auth.ts` の L206 コメントは session 手注入だけが禁止であり、本フラグの addInitScript は別、とコメントに書く。`evaluate(setItem)` を正本にしない。

`auth.setup.ts`: **最初の `goto`（magic-link）より前**に `seedPwaInstallTipDismissed(page.context())`。`storageState()` はその結果を保存するだけ。着地後 `evaluate` は第一手段にしない。

`session-auth.ts`: `newContext` の直後 `await seedPwaInstallTipDismissed(context)`。

`auth-recovery.spec.ts` / `oauth-mock.spec.ts`: magic-link または OAuth 完了の **`goto` より前**にその context へ seed。

`pwa-install-tip.spec.ts`: `test.use` で iPhone SE。`loginAsNewUser(page, email, { seedPwaInstallTipDismissed: false })` でログインし、`getByRole("heading", { name: "ホーム画面に置く" })`。わかりました後に消える。`/settings` の `ホーム画面に追加`。Android UA の別 test。`@smoke` なし。同一 page で `removeItem` して reload する経路は使わない（addInitScript が残ると再書き込みされる）。

- [ ] **Step 4: ユニット確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa src/app/layouts/app-shell.test.tsx src/features/household/household-settings-page.test.tsx`

Expected: PASS

- [ ] **Step 5: 型と lint（この Task のファイル）**

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Expected: PASS（失敗したらこの Task の差分だけ直す）

- [ ] **Step 6: Commit**

```bash
git add src/features/pwa src/main.tsx src/app/layouts/app-shell.tsx src/app/layouts/app-shell.test.tsx src/features/household/household-settings-page.tsx src/features/household/household-settings-page.test.tsx e2e/fixtures/pwa-install-tip.ts e2e/fixtures/auth.ts e2e/fixtures/session-auth.ts e2e/fixtures/seed-onboarding.ts e2e/specs/auth.setup.ts e2e/specs/pwa-install-tip.spec.ts e2e/specs/oauth-mock.spec.ts e2e/specs/auth-recovery.spec.ts
git commit -m "feat(pwa): ホーム画面追加の案内カードと設定を追加"
```

---

### Task 3: Manifest・アイコン・HTML・MIME

**Files:**
- Create: `public/manifest.webmanifest`（Spec §6.1 をそのまま）
- Create: `public/icons/apple-touch-icon.png`（180）
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/icon-512-maskable.png`（中央 80%）
- Create: `scripts/pwa-icons.test.mjs`（PNG シグネチャと IHDR 幅高）
- Modify: `index.html`（Spec §6.2 の link/meta。既存 theme-color / referrer は残す）
- Modify: `scripts/csp-headers.mjs`（§7.5 の exact 本文。この Task では manifest MIME まで。`/sw.js` ブロックも同時に入れ、Task 4 の SW 生成と順序が入れ替わってもヘッダ契約を先に固定する）
- Modify: `scripts/csp-headers.test.mjs`（先頭 `^/\*` を §7.5 に合わせて更新）

**Interfaces:**
- Produces: 静的 URL `/manifest.webmanifest`、`/icons/*`、`_headers` の MIME / no-cache 契約
- Consumes: なし

- [ ] **Step 1: ヘッダテストを先に直して RED を確認**

`buildHeadersFileContent` の期待を Spec §7.5 にする:

```js
assert.match(headers, /^\/sw\.js\n {2}Cache-Control: no-cache\n {2}Content-Type: text\/javascript; charset=utf-8\n\n\/manifest\.webmanifest\n {2}Content-Type: application\/manifest\+json\n\n\/\*\n {2}Content-Security-Policy: /u);
```

`extractConnectSrc` がこの複数ブロックから CSP を拾える既存テストを残す。

Run: `docker compose run --rm --no-deps app node --test scripts/csp-headers.test.mjs`

Expected: FAIL（現行は `/*` 先頭）

- [ ] **Step 2: `buildHeadersFileContent` を実装**

```js
export function buildHeadersFileContent(csp) {
  return `/sw.js
  Cache-Control: no-cache
  Content-Type: text/javascript; charset=utf-8

/manifest.webmanifest
  Content-Type: application/manifest+json

/*
  Content-Security-Policy: ${csp}
`;
}
```

CSP 文字列自体は変えない。

- [ ] **Step 3: ヘッダテスト GREEN**

Run: `docker compose run --rm --no-deps app node --test scripts/csp-headers.test.mjs`

Expected: PASS

- [ ] **Step 4: manifest / index.html / アイコン**

`index.html` に Spec §6.2 を追加。

アイコン: 紙色 `#faf9f8` 地にテラコッタ `#b85033` の椀シルエット PNG。写真・文字なし。maskable は図形を中央 80%。生成手段は既存 `sharp` を使う小さな `scripts/write-pwa-icons.mjs` でも手描きでもよいが、成果物の 4 PNG をコミットする。`scripts/pwa-icons.test.mjs` で各ファイルの PNG シグネチャ `\x89PNG` と IHDR 幅高（180/192/512）を固定する。

- [ ] **Step 5: アイコンテスト**

Run: `docker compose run --rm --no-deps app node --test scripts/pwa-icons.test.mjs`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/manifest.webmanifest public/icons index.html scripts/csp-headers.mjs scripts/csp-headers.test.mjs scripts/pwa-icons.test.mjs
git commit -m "feat(pwa): manifest とアイコンと配信用 MIME を追加"
```

`scripts/write-pwa-icons.mjs` は作ったときだけ add する（4 PNG + `pwa-icons.test.mjs` は必須）。

---

### Task 4: Service Worker 生成と登録

**Files:**
- Create: `src/pwa/sw-defines.d.ts`
- Create: `src/pwa/service-worker-routing.ts`
- Create: `src/pwa/service-worker-routing.test.ts`
- Create: `src/pwa/service-worker.ts`
- Create: `scripts/generate-service-worker.mjs`
- Create: `scripts/generate-service-worker.test.mjs`
- Modify: `vite.config.ts`（プラグイン: `build.manifest: true` + `closeBundle` で generator）
- Create: `src/features/pwa/register-service-worker.ts`
- Modify: `src/main.tsx`（順序: strip → `listenForAndroidInstallPrompt` → `registerServiceWorker` → `createRoot`）
- Modify: `tests/tooling/project-config.test.mjs`（`build.manifest` またはプラグイン名の存在。グローバル CSP 無しは維持）

**Interfaces:**
- Consumes: Task 3 の `/` `/manifest.webmanifest` `/icons/*`
- Produces:
  - `export type SwFetchDecision = { action: "passthrough" } | { action: "navigate-network-then-shell" } | { action: "cache-first-precache" }`
  - `export function decideServiceWorkerFetch(input: { method: string; origin: string; selfOrigin: string; pathname: string; mode: string; precachePathnames: ReadonlySet<string> }): SwFetchDecision`
  - `SHELL_PATH = "/"`
  - `isAuthCallbackPath(pathname): pathname === "/auth/callback" || pathname === "/auth/callback/"`
  - `isApiPath(pathname): pathname === "/api" || pathname.startsWith("/api/")`
  - `dist/sw.js`（closeBundle）
  - `registerServiceWorker()`

- [ ] **Step 1: ルーティングと generator の RED**

`decideServiceWorkerFetch`: 判定順は非 GET → 他 origin → **API / callback** → navigate → 静的。POST → passthrough。他 origin → passthrough。`mode:"navigate"` でも `/api/usage-today` `/api` `/auth/callback` `/auth/callback/` → **passthrough**（`respondWith` しない）。`mode:"navigate"` + `/planner` → `navigate-network-then-shell`。GET `/assets/index-abc.js` かつ pathname が `precachePathnames` に含まれる → `cache-first-precache`。GET `/assets/hero.webp` や `/fonts/x.woff2`（集合外）→ passthrough。

純関数は Cache Storage を触らない。SW 本体が `navigate-network-then-shell` のとき `caches.open(CACHE_NAME)` → `cache.match(SHELL)`。グローバル `caches.match` 文字列が `src/pwa/` に無いことを固定。

generator テスト fixture は実形に寄せる: entry の `file`/`css`/`assets` に js/css/woff2/woff/webp、別キー `index.html`、`imports` / `dynamicImports`。期待 URL は `.js` / `.css` と固定（`/`・manifest・icons）のみ。`.woff` / `.woff2` / `.webp` / `/index.html` / `/api` は含まれない。`CACHE_NAME` は `/^kondate-shell-[0-9a-f]{12}$/`。`/` の内容は `dist/index.html` のバイトで、1 バイト変えると CACHE_NAME が変わる。`Date.now()` / 乱数禁止。空や `/` 欠落は throw。esbuild define は `JSON.stringify`。

- [ ] **Step 2: RED 確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/pwa/service-worker-routing.test.ts`

Run: `docker compose run --rm --no-deps app node --test scripts/generate-service-worker.test.mjs`

Expected: FAIL

- [ ] **Step 3: 実装**

`service-worker-routing.ts` は Spec §7.3 手順 1–5 の判定だけ。

`src/pwa` を `tsconfig.app.json` から外さない。WebWorker lib を app tsconfig に足さない。`sw-defines.d.ts` に `ServiceWorkerGlobalScope` への狭い宣言を置く。`service-worker.ts` の境界キャストは **1 箇所**:

```ts
/// <reference path="./sw-defines.d.ts" />
import { decideServiceWorkerFetch } from "./service-worker-routing";

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE_NAME = __KONDATE_SW_CACHE_NAME__;
const PRECACHE_URLS = JSON.parse(__KONDATE_SW_PRECACHE__) as string[];
const SHELL_URL = __KONDATE_SW_SHELL__;
const PRECACHE_PATHS = new Set(PRECACHE_URLS.map((url) => new URL(url, "https://sw.invalid").pathname));

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("kondate-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
});

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const decision = decideServiceWorkerFetch({
    method: event.request.method,
    origin: url.origin,
    selfOrigin: sw.location.origin,
    pathname: url.pathname,
    mode: event.request.mode,
    precachePathnames: PRECACHE_PATHS,
  });
  if (decision.action === "passthrough") return;
  if (decision.action === "navigate-network-then-shell") {
    event.respondWith(
      fetch(event.request).catch(async (error: unknown) => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(SHELL_URL);
        if (cached) return cached;
        throw error;
      }),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      if (!PRECACHE_PATHS.has(url.pathname)) return fetch(event.request);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      return fetch(event.request);
    }),
  );
});
```

`generateServiceWorker` の CACHE_NAME 入力: ソート済み URL の `\n` 結合 + 非ハッシュ各ファイル内容 SHA-256 を URL 順で `\n` 結合。非ハッシュはパスに `-` + 8 桁以上 hex を含まないもの。**`/` の内容は `dist/index.html` のバイト。** 収集は各 chunk の `file` + `css[]` + `assets[]` の `.js`/`.css` のみ。

`skipWaiting` / `clients.claim` / `cache.put` / `caches.match(` を置かない。

`generate-service-worker.mjs`: Spec §7.1–7.2。Vite plugin:

```ts
function kondateServiceWorker(): Plugin {
  return {
    name: "kondate-service-worker",
    config() {
      return { build: { manifest: true } };
    },
    async closeBundle() {
      const { generateServiceWorker } = await import("./scripts/generate-service-worker.mjs");
      await generateServiceWorker({ distDir: fileURLToPath(new URL("./dist", import.meta.url)) });
    },
  };
}
```

`register-service-worker.ts` は Spec §7.4。`main.tsx` で `registerServiceWorker()`。

- [ ] **Step 4: テスト GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run src/pwa/service-worker-routing.test.ts`

Run: `docker compose run --rm --no-deps app node --test scripts/generate-service-worker.test.mjs`

Expected: PASS

- [ ] **Step 5: 本番ビルドで成果物確認**

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run build`

Expected: `dist/sw.js` と `dist/.vite/manifest.json` が存在。`dist/sw.js` に `skipWaiting` / `clients.claim` / `caches.match(` が無い。Precache リスト（define された JSON）に `/index.html` が無い。これは受け入れ 1 の一部であり、本番ホストの 200 非 redirect（§9.3）の代替ではない。

（エージェントは `ls` と `rg` をホストで別コマンドとして実行）

- [ ] **Step 6: Commit**

```bash
git add src/pwa src/features/pwa/register-service-worker.ts src/main.tsx vite.config.ts scripts/generate-service-worker.mjs scripts/generate-service-worker.test.mjs tests/tooling/project-config.test.mjs
git commit -m "feat(pwa): 許可リスト型 Service Worker をビルドに載せる"
```

---

### Task 5: 横断検証の固定

**Files:**
- Modify: `tests/tooling/project-config.test.mjs`（必要なら `build.manifest` / plugin 名、`sw.js` ヘッダ契約が emit 経路にあること）
- Modify: 漏れていれば `src/styles.contrast.test.ts`（カード用の新規セレクタを足した場合のみ）

**Interfaces:**
- Consumes: Task 1–4 の契約
- Produces: なし（ゲート固定）

- [ ] **Step 1: format / lint / typecheck / 焦点テスト**

Run: `docker compose run --rm --no-deps app npm run format:check`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa src/pwa src/app/layouts/app-shell.test.tsx src/features/auth/auth-cleanup.test.ts src/features/household/household-settings-page.test.tsx`

Run: `docker compose run --rm --no-deps app node --test scripts/csp-headers.test.mjs scripts/generate-service-worker.test.mjs scripts/pwa-icons.test.mjs`

Expected: すべて PASS。失敗したら原因 Task の差分だけ直す。

- [ ] **Step 2: 人間またはセッションが E2E を回すとき**

`./scripts/run-e2e.sh -- e2e/specs/pwa-install-tip.spec.ts --project=mobile-chromium`

変更した fixture 経路の確認に `e2e/specs/settings.spec.ts` を回してよい。`mobile-accessibility.spec.ts` の `heading.first()` が「ホーム画面に置く」ではないこと（名前で否定）を、当該テストを回すかユニット相当で固定する。フル E2E はエージェントが勝手に全件回さない（CLAUDE.md）。

- [ ] **Step 2b: 実装 PR 説明に貼る手動確認（CI ゲートにしない）**

Spec §9.3 / 受け入れ 1–10:

- `dist/.vite/manifest.json` と `dist/sw.js` がある
- Precache 各 URL が 200 かつ非 redirect（`/` は 200 rewrite 可。リストに `/index.html` が無い）
- `/sw.js` の Content-Type が JavaScript であり `text/html` でない。`Cache-Control: no-cache`
- `/manifest.webmanifest` が `application/manifest+json`
- Chromium でインストールでき、2 回目にシェル JS が SW 経由
- オフラインでシェルは出るがデータはエラー
- `/api/` を SW が応答していない

- [ ] **Step 3: Commit（検証のみで差分が無いならコミットしない）**

差分があれば:

```bash
git add tests/tooling/project-config.test.mjs src/styles.contrast.test.ts
git commit -m "test(pwa): ビルド成果と CSP 契約を固定する"
```

---

## Self-review (plan vs spec)

| Spec | Task |
| --- | --- |
| §8 検出・資格・フラグ | Task 1 |
| §8 UI / §8.5 BIP / §8.7 設定 / §9.2 E2E | Task 2 |
| §6 manifest/icons / §7.5 MIME | Task 3 |
| §7 SW / §4 不変 / §10.1,6,7,10 | Task 4 |
| 受け入れ横断 | Task 5 |
| フォント非 Precache / シェル `/` / 自 CACHE_NAME / addInitScript | Task 2+4 本文（MF-P 反映） |
| Auth 非変更 / CSP 非緩和 / Workbox なし | Global Constraints |
| 本機能 E2E 観測 | Task 2: `loginAsNewUser(..., { seedPwaInstallTipDismissed: false })` |
| generator `/` → `dist/index.html` | Task 4 RED |
| メモリ dismiss | Task 2 カード RED |

Placeholders: なし（アイコン生成手段は sharp または手描きのどちらでもよいが、4 PNG + 寸法テストは必須）。

**Plan レビュー:** `docs/superpowers/reviews/2026-08-16-pwa-installable-app-shell-plan-{primary,adversarial,secondary}.md`（二次 REVISE_PLAN / MF-P1…P6 を本文へ反映済み）。
