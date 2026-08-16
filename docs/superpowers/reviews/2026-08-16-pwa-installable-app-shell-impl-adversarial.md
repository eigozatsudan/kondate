# 敵対的レビュー: PWA 実装

**Verdict:** PASS_WITH_RESIDUALS

- **役割:** 独立 adversarial reviewer（実装著者コンテキスト非共有。本ファイルのみ書込）
- **日付:** 2026-08-16
- **Worktree:** `/home/dev/projects/kondate/.worktrees/pwa-installable-app-shell`
- **Branch:** `feat/pwa-installable-app-shell`
- **Base..Head:** `560f07c4`..`048c4c88`
- **Diff 正本:** `.superpowers/sdd/review-560f07c4..048c4c88.diff`
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)
- **照合 plan:** [`docs/superpowers/plans/2026-08-16-pwa-installable-app-shell.md`](../plans/2026-08-16-pwa-installable-app-shell.md)
- **姿勢:** 16 不変を破る。Cache Storage への献立 / 買い物 / アレルギー / API / Supabase / localStorage 複製、callback 横取り、グローバル `caches.match`、CSP 緩和、Auth ロック再定義、E2E 見出し侵食を優先して突く。§2.3 残差は must-fix にしない。

---

## Summary

許可リスト SW・案内カード・E2E dismiss は、設計レビューが BLOCK した穴（`/index.html` の 301、`caches.match(SHELL_URL)` 全検索、`CACHE_NAME` が非ハッシュ内容を見ない、`evaluate(setItem)` 正本）を **実装で閉じている**。Cache Storage にユーザーデータや認可 code を載せる正面経路は、live コード上成立しない。CSP token・Workbox・`package.json` の `build` 文字列・Auth ロック export も汚していない。

Critical 0。16 不変のうち「実装が壊した」ものは無い。BIP を `preventDefault` したあと React が再購読しない点は、plan が `peekAndroidInstallPrompt()` をカード正本に固定した **false-lead**（後述）。本番ホストの 200 非 redirect と実 SW 制御は §9.3 / §2.3 の手動残差のまま。

**総合判定: `PASS_WITH_RESIDUALS`**

| 項目 | 値 |
| --- | --- |
| **判定** | **`PASS_WITH_RESIDUALS`** |
| **Critical** | **0** |
| **Important** | **0** |
| **Residual (§2.3)** | 13（仕様受容。実装が悪化させていない） |
| **解除条件** | なし。ship-blocker は無い |

---

## Attacks that landed (Critical / Important)

なし。

ユーザーデータ / 認可 / CSP / 安全保証の嘘に届く経路は、fetch 判定順・`addAll` 許可リスト・owned 掃除の非追加・PROD 限定登録で閉じている。受け入れを落とす未達（E2E 既定 dismiss の欠落、カードが `/login` に出る、設定の片方分岐だけマウント、`/index.html` Precache）も live では成立しなかった。

---

## Attacks that did not land

攻撃番号は指示の 16 不変に対応する。

| # | 攻撃 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | Cache Storage に献立・買い物・アレルギー・API JSON・Supabase 応答・localStorage 複製を入れる | **反証** | Precache は `FIXED_PRECACHE_URLS`（`/`・manifest・icons）+ Vite manifest の `.js`/`.css` のみ（`scripts/generate-service-worker.mjs` L14–21, L89–111）。`cache.put` は `src/pwa/` に無い。navigate 成功は `fetch` をそのまま返す（`src/pwa/service-worker.ts` L46–52）。Supabase は他 origin で手順 2 が passthrough（`service-worker-routing.ts` L35–37）。SW は `localStorage` を読まない。 |
| 2 | `/api`・`/api/*`・`/auth/callback`・`/auth/callback/` を SW が横取りする（navigate 含む） | **反証** | 判定順は非 GET → 他 origin → **API/callback** → navigate（`service-worker-routing.ts` L32–43）。`isApiPath` は `=== "/api"` または `startsWith("/api/")`（L20–22）。`isAuthCallbackPath` は exact `/auth/callback` と `/auth/callback/`（L16–18）。テストが navigate でも passthrough を固定（`service-worker-routing.test.ts` L74–87）。passthrough は `respondWith` しない（`service-worker.ts` L44）。 |
| 3 | グローバル `caches.match` / `skipWaiting` / `clients.claim` / 実行時 `cache.put` | **反証** | `src/pwa/` のソース禁止をユニットが文字列固定（`service-worker-routing.test.ts` L136–148）。生成物 `dist/sw.js` も generator テストが同じ禁止を見る（`generate-service-worker.test.mjs` L107–113）。ナビ失敗は `caches.open(CACHE_NAME)` → `cache.match(SHELL_URL)`（`service-worker.ts` L48–49）。静的は自 cache の `cache.match` のみ。install は `addAll` だけ。 |
| 4 | Precache に `/index.html`・woff/woff2・webp・`/api` が入る | **反証** | `toJsOrCssUrl` は `.js`/`.css` 以外を落とす（`generate-service-worker.mjs` L89–95）。fixture は `assets` に webp/woff/woff2/`api`、キー `index.html`、`imports`/`dynamicImports` を置き、期待配列から除外する（`generate-service-worker.test.mjs` L17–45, L81–88）。`/` は入れるが `/index.html` は入れない。 |
| 5 | SHELL が `/index.html`。ナビ失敗が他 `CACHE_NAME` の HTML を返す | **反証** | `SHELL_PATH = "/"`（`service-worker-routing.ts` L14）。esbuild define は `__KONDATE_SW_SHELL__: JSON.stringify("/")`（`generate-service-worker.mjs` L190）。フォールバックは自 `CACHE_NAME` だけ（`service-worker.ts` L47–50）。waiting 中の新 cache は旧 SW の fetch から見えない。 |
| 6 | CSP 緩和 / vite-plugin-pwa / Workbox / `package.json` `build` 文字列変更 | **反証** | `CSP_STATIC_DIRECTIVES` は `default-src 'self'; … script-src 'self'` のまま（`scripts/csp-headers.mjs` L11–12）。差分は `buildHeadersFileContent` の先頭ブロックだけ（`/sw.js` no-cache + JS MIME、manifest MIME、`/*` に既存 CSP）。`package.json` L11 は `tsc -b && vite build`。`package.json` / lock / `netlify.toml` / auth 実装ファイルは本 range で未変更。`vite-plugin-pwa` / `workbox` は dependencies に無い。 |
| 7 | Auth ロック再定義。dismiss キーを `isOwnedBrowserStorageKey` に足す。logout で消える | **反証** | PWA モジュールは `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` / `ownedAuthStoragePrefixes` を import しない。`isOwnedBrowserStorageKey`（`auth-cleanup.ts` L122–138）は `kondate.auth.*` / generation / shopping / flyer / expired-pantry / feedback / household revision / magic residual。`kondate:preferences:pwa-install-tip-dismissed` は無い。`auth-cleanup.test.ts` が logout / 削除 second pass 後も `"1"` を固定（L87, L120, L138 ほか）。 |
| 8 | E2E 既定が `evaluate(setItem)` 正本。iPhone SE 既存経路でカードが見える | **反証（仕様どおり）** | 正本は `seedPwaInstallTipDismissed` → `context.addInitScript`（`e2e/fixtures/pwa-install-tip.ts` L3–10）。`loginAsNewUser` は session `evaluate` のあと・`goto("/planner")` の前に context seed（`e2e/fixtures/auth.ts` L325–329）。plan はこの順序を固定。`auth.setup.ts` L17–18 は **最初の `goto` より前**。`session-auth.ts` L23–25 は `newContext` 直後。`oauth-mock` / `auth-recovery` / `seed-onboarding` も context seed。`pwa-install-tip.spec.ts` だけ `seedPwaInstallTipDismissed: false`。`mobile-chromium` は iPhone SE だが、`completedOnboardingPage` 経由の `heading.first()`（`mobile-accessibility.spec.ts` L256）は seed 済みなのでカード h2 にならない。 |
| 9 | BIP が `createRoot` より後。カードが peek 以外を正本にする | **反証（契約どおり）** | `main.tsx` L16–19: strip → `listenForAndroidInstallPrompt()` → `registerServiceWorker()` → `createRoot`。カードの Android ボタンは `peekAndroidInstallPrompt()`（`home-screen-install-card.tsx` L60, L87–96）。surface では listen しない（`android-install-prompt.ts` L22–27）。 |
| 10 | DEV でも SW を登録する | **反証** | `register-service-worker.ts` L6: `if (!import.meta.env.PROD) return;`。E2E は Vite dev（`playwright.config.ts` `baseURL` 5173）。 |
| 11 | 既存ユーザーをアカウント年齢 / onboarding で出し分ける | **反証** | `shouldShowInstallTip` は session / standalone / dismissed / surface / pathname の 5 条件だけ（`install-tip-eligibility.ts` L23–36）。`created_at` / `onboarding_status` / アカウント年齢は `src/features/pwa/` に無い。欠落フラグは `=== "1"` 以外すべて未 dismiss（`install-tip-storage.ts` L4–5）。 |
| 12 | 敵対値 `"0"` / JSON / `setItem` throw / `/auth/callback?code=` / `/api` / `/apifake` で壊す | **反証** | `"0"` は false（`install-tip-storage.test.ts` L13–15）。読みは exact `"1"` のみなので JSON も false。`setItem` throw は write false + カードはメモリ dismiss（`install-tip-storage.ts` L8–15、`home-screen-install-card.tsx` L41–42, L64–66、カードテスト L99–107）。callback は pathname だけ見るので `?code=` は passthrough。`/api` は API。`/apifake` は API ではない（`service-worker-routing.test.ts` L36–42）— 意図どおりシェル判定に落ち、API 扱いしない。 |
| 13 | waiting SW + 旧制御 SW がグローバル match で古い HTML と新しいハッシュ JS を混ぜる | **反証** | グローバル `caches.match` 無し。旧 SW は自 `CACHE_NAME` と自 `PRECACHE_PATHS` だけ。新ハッシュ URL は旧許可リスト外 → passthrough。新 SW は waiting 中 fetch を扱わない。`addAll` の内部 fetch は Cache API が `service-workers` mode `none`。activate は自プレフィックスの **旧** `kondate-shell-*` だけ削除（`service-worker.ts` L20–31）。 |
| 14 | クエリ付き URL / email / 氏名をログする | **反証** | `src/pwa/` と `src/features/pwa/` に `console.*` 無し。SW 登録失敗は空 `catch`（`register-service-worker.ts` L8–10）。fetch ハンドラは `event.request.url` をログしない。 |
| 15 | カードが `/login` `/welcome` `/onboarding` `/privacy` `/settings` `/` に出る | **反証** | `/login` `/` は AppShell 外。`/welcome` `/onboarding` `/privacy` は `RequireSession` 下だが AppShell 外（`src/app/router.tsx` L31–96 vs L98–150）。`/settings` は AppShell 内だが `shouldShowInstallTip` が false（`install-tip-eligibility.ts` L3–11, L33–36。テスト L33–37）。カードは AppShell の Outlet 直前だけ（`app-shell.tsx` L228–230）。 |
| 16 | 設定が空家族 / 家族ありの片方だけ、または読込中 early return に常設節がある | **反証** | 空家族 return に `HomeScreenInstallSection`（`household-settings-page.tsx` L1618–1619）。家族あり本体にも同じコンポーネント（L2360–2361）。`membersQuery.isPending` / editor loading early return には置かない（L1551–1552, L1588–1589, L1635–1636）。テストは Plan と同様に mock（`household-settings-page.test.tsx` L61–63）。 |

### False-leads（悪く見えるが spec / plan がロック）

1. **BIP を `preventDefault` したあと、初回 paint では手順リストのまま。** Chromium の `beforeinstallprompt` は SW `addAll` 完了後に飛ぶことが多い。`peek` は render 時の一読で、購読しない（`home-screen-install-card.tsx` L60、`android-install-prompt.ts` L29–35）。listen 後にイベントは `held` に入るが、同一マウントではボタンに切り替わらない。plan / spec §8.5 は「peek の薄いラップでも可」「カード正本は peek」と固定しており、Task 2 レビューも購読型を後続判断とした。**native infobar を消してボタンが遅れる**のはその契約の帰結であり、本スライスの未達にはしない。クライアント遷移後の再 render では peek 非 null ならボタンになる。
2. **`loginAsNewUser` の seed が「最初の document」より後。** GoTrue verify と `/login` 着地のあと、session `evaluate` のあとに `addInitScript` する（`e2e/fixtures/auth.ts` L325–333）。plan はこの順序を明示。カードが出せる最初の document は直後の `/planner` で、その JS より前に init script が走る。`/login` は AppShell 外。
3. **`auth-callback-security.spec.ts` が raw Playwright のまま planner に落ち得る。** brief 必須リスト外。当該 spec は URL / cancel copy を見て `heading.first()` を見ない。受け入れ 9 の見出し契約は侵さない。
4. **`isAuthCallbackPath` が exact のみで、`auth-callback-url-capture` の `startsWith("/auth/callback/")` より狭い。** 実 redirect_uri は `/auth/callback`。`/auth/callback/extra` は router `*`（AppShell 外）。Cache には載らない。
5. **`/emergency-menus` が `startsWith`。** plan 本文どおり。AppShell 子は閉じた route 表なので `/emergency-menuscript` は 404 側。
6. **`readInstallTipDismissed` が `getItem` throw を包まない。** spec が要求したのは `setItem` 失敗のメモリ dismiss。Safari quota の典型は `setItem`。

---

## Residuals (spec §2.3)

実装が悪化させていない。must-fix にしない。

| 残差 | 実装上の現れ |
| --- | --- |
| iOS ホーム画面は Safari とストレージが分かれ、再ログインし得る | `start_url` `/`。standalone 修復はしていない |
| standalone 内の Google / マジックリンクが Safari・メールに出る | ログイン面にカードを出さない。Auth ロック非再定義 |
| デプロイ直後の 1 回は古いシェル | `skipWaiting` / `clients.claim` 無し。オンラインナビは network-first |
| 通信断ではシェルだけ、データは既存エラー | オフライン画面無し。ナビ失敗だけ自 SHELL |
| デスクトップには初回カードを出さない | `surface === "other"` でカード null。設定は汎用 1 文 |
| iPhone「デスクトップ用サイト」等 `other` | カード無し。設定節のみ |
| CriOS / FxiOS は ios のまま | `iPhone` UA で ios。Safari 共有手順。Safari で開けとは書かない |
| インストール成功後も「わかりました」までカードが残る | `userChoice` / `appinstalled` で dismiss しない |
| 共有端末の 2 人目 | 端末フラグのみ。設定節を頼る |
| 実 SW 制御・実機インストールは CI 外 | E2E は Vite dev。`@smoke` 無し |
| 旧 SW 残留の kill switch 無し | 第1版。オンライン本体は死なない |
| DEV に残った本番相当 SW の解除をしない | `register-service-worker.ts` は解除しない。preview 4173 / E2E 5173 |
| 設定の読込中 early return に常設節が無い | `membersQuery.isPending` 等。空家族 / 家族ありが正 |
| カードが Outlet を押し下げ、主要 CTA が沈む | overlay しない。下タブは覆わない |

§9.3 の本番 Precache URL「200 かつ非 redirect」は手動受け入れのまま。generator は dist 存在と許可リストを固定するが、ホスト curl の代替ではない（plan Task 4 Step 5 がそう書いている）。

---

## Findings with file:line

### Critical

なし。

### Important

なし。

### 不変ごとの証拠（file:line）

**1. ユーザーデータ非キャッシュ**

```14:21:scripts/generate-service-worker.mjs
export const FIXED_PRECACHE_URLS = Object.freeze([
  "/",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
]);
```

```89:95:scripts/generate-service-worker.mjs
function toJsOrCssUrl(file) {
  const url = file.startsWith("/") ? file : `/${file}`;
  if (!url.endsWith(".js") && !url.endsWith(".css")) {
    return null;
  }
  return url;
}
```

```16:18:src/pwa/service-worker.ts
sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});
```

`src/` 全体で `caches.open` / `cache.put` は SW 以外に無い。

**2. API / callback 非介入**

```16:47:src/pwa/service-worker-routing.ts
export function isAuthCallbackPath(pathname: string): boolean {
  return pathname === "/auth/callback" || pathname === "/auth/callback/";
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
// …
  if (isApiPath(input.pathname) || isAuthCallbackPath(input.pathname)) {
    return { action: "passthrough" };
  }
  if (input.mode === "navigate") {
    return { action: "navigate-network-then-shell" };
  }
```

**3–5. 禁止 API・SHELL `/`・自 CACHE_NAME**

```45:63:src/pwa/service-worker.ts
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
```

**6. CSP / build 文字列 / Workbox**

```11:12:scripts/csp-headers.mjs
export const CSP_STATIC_DIRECTIVES =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'";
```

```60:70:scripts/csp-headers.mjs
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

`package.json` L11: `"build": "tsc -b && vite build"`。本 range で `package.json` 非差分。

**7. Auth / owned / logout**

```122:138:src/features/auth/auth-cleanup.ts
function isOwnedBrowserStorageKey(key: string): boolean {
  return (
    key.startsWith("kondate.auth.") ||
    key.startsWith("kondate:generation:") ||
    key.startsWith("kondate:shopping:") ||
    key.startsWith("kondate:flyer:") ||
    key.startsWith("kondate:expired-pantry-confirm:") ||
    key.startsWith("kondate:feedback:") ||
    key === householdSafetyRevisionStorageKey ||
    key.startsWith(`${householdSafetyRevisionStorageKey}:`) ||
    (MAGIC_LINK_RESIDUAL_KEYS as readonly string[]).includes(key)
  );
}
```

キーは `kondate:preferences:pwa-install-tip-dismissed`（`install-tip-storage.ts` L2）。owned に足していない。

**8. E2E addInitScript**

```3:10:e2e/fixtures/pwa-install-tip.ts
export async function seedPwaInstallTipDismissed(target: {
  addInitScript(script: (key: string) => void, arg: string): Promise<unknown>;
}): Promise<void> {
  await target.addInitScript((key) => {
    window.localStorage.setItem(key, "1");
  }, PWA_INSTALL_TIP_DISMISSED_KEY);
}
```

```325:333:e2e/fixtures/auth.ts
  if (options?.seedPwaInstallTipDismissed !== false) {
    await seedPwaInstallTipDismissed(page.context());
  }
  await page.goto(`${APP_ORIGIN}/planner`);
```

`auth.setup.ts` L17–18 は最初の `goto` より前。`session-auth.ts` L23–25 は `newContext` 直後。

**9–10. BIP 順・PROD 登録**

```16:19:src/main.tsx
listenForAndroidInstallPrompt();
registerServiceWorker();
```

```5:10:src/features/pwa/register-service-worker.ts
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
```

```59:62:src/features/pwa/home-screen-install-card.tsx
  const androidPrompt = surface === "android" ? peekAndroidInstallPrompt() : null;
```

**11–12. 既存ユーザー = フラグ欠落。敵対ストレージ / path**

```4:15:src/features/pwa/install-tip-storage.ts
export function readInstallTipDismissed(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY) === "1";
}
export function writeInstallTipDismissed(storage: Pick<Storage, "setItem">): boolean {
  try {
    storage.setItem(PWA_INSTALL_TIP_DISMISSED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
```

**15–16. カード path・設定両分岐**

```3:20:src/features/pwa/install-tip-eligibility.ts
const EXACT_INSTALL_TIP_PATHS = new Set([
  "/planner",
  "/generation",
  "/pantry",
  "/history",
  "/shopping",
  "/plus",
]);
function isInstallTipPath(pathname: string): boolean {
  if (EXACT_INSTALL_TIP_PATHS.has(pathname)) return true;
  return (
    pathname.startsWith("/menus/") ||
    pathname.startsWith("/history/") ||
    pathname.startsWith("/emergency-menus")
  );
}
```

```1551:1552:src/features/household/household-settings-page.tsx
  if (membersQuery.isPending)
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
```

```1618:1619:src/features/household/household-settings-page.tsx
        <HomeScreenInstallSection />
        <PlanSettingsSection
```

```2360:2363:src/features/household/household-settings-page.tsx
      <HomeScreenInstallSection />
      <PlanSettingsSection
```

**13. waiting × 旧 SW**

activate は `key.startsWith("kondate-shell-") && key !== CACHE_NAME` だけ delete（`service-worker.ts` L26–28）。fetch は自 cache のみ。混ぜるグローバル match が無い。

**14. ログ**

`register-service-worker.ts` L8–10 の空 `catch`。PWA / SW ソースに `console.*` 無し。

---

## 検証について

フルスイートは回していない（指示どおり）。ソース・契約テスト・router / cleanup / E2E fixture の読み取りで 16 不変を突いた。`dist/sw.js` は worktree に残っておらず、生成物の禁止文字列は `scripts/generate-service-worker.test.mjs` の一時 dist アサーションを正とした。
