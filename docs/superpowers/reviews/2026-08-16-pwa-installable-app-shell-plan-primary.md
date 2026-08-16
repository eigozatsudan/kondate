# 1次レビュー: PWA インストール可能アプリシェル Implementation Plan

**対象 Plan:** [`docs/superpowers/plans/2026-08-16-pwa-installable-app-shell.md`](../plans/2026-08-16-pwa-installable-app-shell.md)
**対象 Spec:** [`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)（MF 反映済み）
**照合先（実装が正）:** `vite.config.ts` / `index.html` / `scripts/csp-headers.mjs` / `scripts/csp-headers.test.mjs` / `scripts/emit-deploy-headers.mjs` / `src/main.tsx` / `src/app/layouts/app-shell.tsx` / `src/app/layouts/app-shell.test.tsx` / `src/app/router.tsx` / `src/features/household/household-settings-page.tsx`（空家族 L1529–1566・家族あり L2286–2297・読込中 L1501–1502 / L1526–1527 / L1571–1572） / `src/features/household/household-settings-page.test.tsx` / `src/features/auth/auth-cleanup.ts` / `src/features/auth/auth-cleanup.test.ts` / `src/features/auth/auth-callback-url-capture.ts` / `tsconfig.app.json` / `e2e/fixtures/auth.ts` / `e2e/fixtures/session-auth.ts` / `e2e/fixtures/seed-onboarding.ts` / `e2e/specs/auth.setup.ts` / `e2e/specs/oauth-mock.spec.ts` / `e2e/specs/auth-recovery.spec.ts` / `e2e/specs/mobile-accessibility.spec.ts` / `playwright.config.ts` / `tests/tooling/project-config.test.mjs`
**レビュー種別:** Plan 一次（Spec↔Plan 網羅・矛盾・欠落 interface・TDD 穴・E2E dismiss 残穴・SW 契約・Task 順）
**レビュー日:** 2026-08-16
**編集:** なし（本ファイルのみ。Spec / Plan は未編集）

---

## Summary

Plan は改訂後 Spec（MF-I1…I9 反映済み）を Task 1–5 に落としており、所有境界・Global Constraints・TDD の骨格は live tree と整合する。`vite-plugin-pwa` / Workbox 不採用、`package.json` の `build` 文字列非変更、CSP token 非追加、案内キーを `isOwnedBrowserStorageKey` に足さない、`skipWaiting` / `clients.claim` / 実行時 `cache.put` / グローバル `caches.match` 禁止、設定の空家族・家族あり両分岐（読込中 early return には置かない）は、現行 `household-settings-page.tsx` / `auth-cleanup.ts` / `vite.config.ts` と衝突しない。

設計レビューで Critical だった穴の大半は Plan 側に閉じている。`loginAsNewUser` の `/planner` goto 前 `addInitScript`、`auth.setup.ts` の storageState 前書き込み、`session-auth.ts` の `context.addInitScript`、`vite` プラグインの `build.manifest: true` + `closeBundle`、`csp-headers.test.mjs` の先頭 `/sw.js` exact、BIP の `main.tsx` 初期化 listen、はいずれも MF の意図どおり。

一方、このまま Task 実行に入ると (1) **本機能 E2E が常時 seed する `loginAsNewUser` と衝突してカードを観測できない**、(2) **§9.2 が要求する magic-link / `context.newPage()` peer の dismiss が Files に落ちていない**、(3) **generator が Spec §7.1 の CACHE_NAME / `/` 内容ハッシュを本文に固定していない**、(4) **§9.1 のメモリ dismiss に RED が無い**、(5) **`service-worker.ts` の DOM `tsc -b` 通し方が無い**、が残る。Critical（PII キャッシュ・認可バイパス・安全保証の誤表示）は Plan どおりでは起きない。Important が複数 open のため **REVISE**。

## Verdict

**REVISE**

- Critical: 0
- Important: 5
- Minor: 6
- Nit: 2

F1–F5 を Plan 本文に埋めてから実装開始。

---

## Findings

### F1 — Severity: Important

- **Location:** Plan Task 2 Interfaces / Step 3 `pwa-install-tip.spec.ts`; live `e2e/fixtures/auth.ts` `loginAsNewUser` L318–321
- **Description:** Task 2 は `loginAsNewUser` を **常に** `seedPwaInstallTipDismissed(page)` する一方、本機能 E2E を「`addInitScript` を付けない page でログイン」とだけ書く。opt-out 引数も、`removeItem` + reload の明示削除も、`requestMagicLinkAndReadUrl` 直書きも Interfaces に無い。標準ヘルパを使うとカードは出ず、`getByRole("heading", { name: "ホーム画面に置く" })` はタイムアウトする。Task 2 の検証はユニットのみで、この衝突は Task 5 の人間 E2E まで見つからない。
- **Why it matters:** Spec §9.2「本機能 E2E だけが addInitScript 無し（または明示削除）でカードを見る」と受け入れ 3 が、Plan の正本ログイン経路では成立しない。実装者が推測で分岐する。
- **Suggestion:** 次のいずれか 1 本を Interfaces に固定する。
  1. `loginAsNewUser(page, email, { seedPwaInstallTipDismissed?: boolean })`（既定 `true`）。本機能 E2E だけ `false`。
  2. 本機能 E2E は `loginAsNewUser` を使わず `requestMagicLinkAndReadUrl` + `goto`（seed 呼び出し禁止）と本文に書く。
  3. ログイン後に `localStorage.removeItem(PWA_INSTALL_TIP_DISMISSED_KEY)` + reload を「明示削除」として Step 3 に埋め込む。
- **Status:** open

### F2 — Severity: Important

- **Location:** Plan Task 2 Files / git add（`oauth-mock.spec.ts` のみ）; Spec §9.2 項目 2・5; live `e2e/specs/auth-recovery.spec.ts` / `e2e/specs/generation-recovery-results.spec.ts` L379・L434 / `e2e/specs/shopping-list-races.spec.ts`（`context.newPage()`）
- **Description:** Spec は `requestMagicLinkAndReadUrl` 利用側と、raw Playwright で `/planner` に落ち得る spec の **全部**に `seedPwaInstallTipDismissed` を要求する。Plan の Files / `git add` は `oauth-mock.spec.ts` と「等」だけで、次が落ちている。
  - `e2e/specs/auth-recovery.spec.ts`（`@smoke`。magic-link 着地で callback タブと元タブが `/planner`）
  - `completedOnboardingPage` 後の `context.newPage()` peer（generation-recovery の reopen / dual-tab、shopping-list-races）
  - `loginAsNewUser` が **page** 単位の `addInitScript` のみ。Playwright の page スクリプトは sibling `newPage()` に継承されない。`session-auth.ts` だけが `context.addInitScript`
- **Why it matters:** 既存 E2E の大半は named heading なので即死しにくい。しかし受け入れ 9 は「カード理由で赤くならない」であり、`heading.first()`（`mobile-accessibility.spec.ts` L256 は同一 page なので loginAsNewUser で守れる）以外の peer 面・smoke の magic-link 着地は Spec §9.2 の入口から外れる。実装者が `oauth-mock` だけ直して閉じる。
- **Suggestion:**
  1. `loginAsNewUser` / `authenticatedPage` は **`page.context()` に** `addInitScript` する（page でも可だが context を正とする）。
  2. Task 2 Files に `auth-recovery.spec.ts` を名前で入れる。`requestMagicLinkAndReadUrl` の直後ではなく、**magic-link `goto` より前**に context へ seed。
  3. `context.newPage()` を持つ spec を列挙し、親 fixture が context seed 済みなら「追加不要」と明記。未 seed の raw context だけヘルパ必須。
- **Status:** open

### F3 — Severity: Important

- **Location:** Plan Task 4 Step 3 `generate-service-worker.mjs`（「Spec §7.1–7.2」のみ）; Spec §7.1 手順 4・§7.2
- **Description:** generator の実装本文が無い。欠落する固定値:
  1. `CACHE_NAME` = `kondate-shell-` + SHA-256 先頭 **12 hex**。入力は「UTF-8 昇順 URL を `\n` 結合」+「非ハッシュ Precache 各ファイル内容の SHA-256 を URL 順で `\n` 結合」。`Date.now()` / 乱数禁止。
  2. 非ハッシュ判定はパスに Vite ハッシュ（`-` + 8 桁以上 hex）を含まないもの（`/`、`/manifest.webmanifest`、`/icons/*`）。
  3. **`/` に対応するファイルは `dist/index.html`。** `dist/` というパスは存在しない。未マップだと内容ハッシュを飛ばすか throw する。URL 集合が変われば CACHE_NAME は動くが、HTML だけ変わった同一アセット集合では Spec の「非ハッシュ内容が効く」が満たせない。
  4. 収集は各 chunk の `file` + `css[]` + `assets[]` だけ（`.js` / `.css`）。`src` / `imports` / `dynamicImports` は見ない。`.woff2` / `/index.html` / `sw.js` 除外。
- **Why it matters:** activate は `kondate-shell-` プレフィックスだけ消す。プレフィックスや 12 hex を外すと旧キャッシュが残る。`/` の中身を読まないと MF-I6（非ハッシュ内容を CACHE_NAME に入れる）が実装者依存。
- **Suggestion:** Task 4 Step 3 に `generateServiceWorker` の完全実装（または 40 行以内の手順＋入出力例）を埋め込む。RED に `expect(cacheName).toMatch(/^kondate-shell-[0-9a-f]{12}$/)` と「`dist/index.html` を変えると CACHE_NAME が変わる」を追加する。
- **Status:** open

### F4 — Severity: Important

- **Location:** Plan Task 1 `install-tip-storage.test.ts` / Task 2 カード RED; Spec §8.1 / §9.1
- **Description:** Spec は「書けないときはメモリ dismiss。同じタブでは再表示しない。リロード後は再表示してよい」をユニットで固定する。Plan Task 1 は `setItem` throw → `writeInstallTipDismissed` が `false` まで。Task 2 実装文は「write 失敗でも閉じる」とあるが、Step 1 のカード RED は「click で `writeInstallTipDismissed`」のみ。throw する `setItem` を渡して、同一マウントでカードが再出現しないことは書いていない。
- **Why it matters:** ストレージ拒否（Safari ITP / プライベート）で「わかりました」が効かず、同一セッションでカードが貼り付く。受け入れ 4 の端末フラグ以前のセッション内契約がテストで死ぬ。
- **Suggestion:** `home-screen-install-card.test.tsx` に `setItem` throw fixture を追加する。click 後に heading「ホーム画面に置く」が無いこと、reload 相当の再マウント（storage 空）では再表示することを固定する。
- **Status:** open

### F5 — Severity: Important

- **Location:** Plan Task 4 `service-worker.ts` 本文; live `tsconfig.app.json`（`lib: ["ES2023", "DOM", "DOM.Iterable"]`、`include` に `src`、`src/pwa` 除外なし）
- **Description:** Spec は `tsc -b` が `src/pwa/service-worker.ts` を通すことを要求する。Plan 本文は `self.addEventListener("install" | "activate" | "fetch", …)` と `FetchEvent` / `ExtendableEvent` 注釈をそのまま置く。DOM の `self` は `Window` であり、`"install"` / `"fetch"` は `WindowEventMap` に無い。`FetchEvent` は環境によっては DOM にあるが、リスナ引数の反変で `tsc` が落ち得る。`/// <reference lib="webworker" />` は DOM と衝突し得る。Plan に通し方が無い。
- **Why it matters:** Task 4 Step 5 の `npm run typecheck` / `npm run build`（`tsc -b && vite build`）が SW 本体の型で落ちる。実装者が `src/pwa` を tsconfig から外す（Spec 禁止）か、禁じられた unchecked cast を散らす。
- **Suggestion:** `sw-defines.d.ts`（または隣接の型）に `ServiceWorkerGlobalScope` への狭い宣言を置き、`service-worker.ts` は `const sw = self as unknown as ServiceWorkerGlobalScope` のような **1 箇所**の境界キャストに閉じる、と本文で固定する。WebWorker lib を `tsconfig.app.json` に足さない。
- **Status:** open

### F6 — Severity: Minor

- **Location:** Plan Task 4 `decideServiceWorkerFetch` / `service-worker.ts` 静的枝; Spec §7.3 手順 5
- **Description:** Spec は静的 GET について「pathname が `PRECACHE_URLS` の pathname 集合に含まれるときだけヒットを返す」と書く。Plan の決定関数は許可リストを受け取らず、SW 本体は `cache.match(request, { ignoreSearch: true })` のヒットを無条件に返す。install が許可リスト以外を `put` しない前提なら実害は小さい（フォント等は miss → `fetch`、`put` なし）。
- **Why it matters:** 汚染キャッシュや将来の誤 `put` に対する defense-in-depth が落ちる。純関数が Spec 手順 5 を表現できない。
- **Suggestion:** `decideServiceWorkerFetch` に `precachePathnames: ReadonlySet<string>` を足し、非許可は `passthrough`（または hit 禁止の network-only）にする。SW はヒット返却前に pathname を見る。
- **Status:** open

### F7 — Severity: Minor

- **Location:** Plan Task 4 navigate `.catch`; Spec §7.3 手順 4
- **Description:** Spec はシェル miss 時「失敗をそのまま」。Plan は `throw new Error("shell_miss")` で元の network `TypeError` を捨てる。
- **Why it matters:** DevTools / クライアントの失敗種別が変わる。機能は同等（どちらも reject）。
- **Suggestion:** `const cached = await cache.match(SHELL_URL); if (cached) return cached; throw error;` とし、元の catch 引数を再 throw する。
- **Status:** open

### F8 — Severity: Minor

- **Location:** Plan Task 2 Interfaces `peekAndroidInstallPrompt`; Spec §8.5 `useAndroidInstallPrompt`
- **Description:** Spec が名前固定するフックが Plan に無い。`peek` + カード内 `useState` で同等には実装できる。設定の Android BIP ボタン（§8.7）も RED に無い。
- **Why it matters:** ロック名が実装者ごとに分かれる。設定面の BIP が落ちてもユニットは緑。
- **Suggestion:** `useAndroidInstallPrompt()` を Produces に戻す（内部で peek）。設定 RED に「inject 済み Android で `インストールする`」を 1 本足す。
- **Status:** open

### F9 — Severity: Minor

- **Location:** Plan Task 5; Spec §9.3 / §10
- **Description:** 手動確認（`dist/sw.js` の MIME が `text/html` でない、Precache URL が 200 非 redirect、オフラインはシェルのみ、`/api/` を SW が応答しない）を PR 説明に書く指示が Task 5 に無い。受け入れ 1–10 のチェックリストも無い。
- **Why it matters:** CI 対象外の本番ホスト契約が PR で消える。
- **Suggestion:** Task 5 に §9.3 を箇条書きで転記し、「実装 PR 説明に貼る。CI ゲートにしない」と書く。
- **Status:** open

### F10 — Severity: Minor

- **Location:** Plan Task 1 eligibility RED; Spec §8.3 / §9.1
- **Description:** 出す path の実装は `/emergency-menus` 前方一致を含むが、RED は `/planner`・`/menus/x`・`/plus` のみ。出さない側も `/settings` `/welcome` `/` 止まりで、`/onboarding` `/privacy` `/login` `/auth/callback` は無い。allowlist 実装なら自動的に false。
- **Why it matters:** denylist 実装にするとログイン後 AppShell 外でも関数が true を返し得る。
- **Suggestion:** `/emergency-menus` と `/emergency-menus/x` を true、`/onboarding` `/privacy` を false にする 2 本を Task 1 RED に足す。
- **Status:** open

### F11 — Severity: Minor

- **Location:** Plan Task 3 `git add` に `scripts/write-pwa-icons.mjs`
- **Description:** 生成手段は sharp でも手描きでもよい、とあるのに `git add` がスクリプトを必須化している。手描きだと `git add` が欠落ファイルで失敗する。
- **Why it matters:** Task 3 commit Step が手段選択と矛盾する。
- **Suggestion:** `write-pwa-icons.mjs` は作ったときだけ add、と書く。4 PNG + `pwa-icons.test.mjs` は必須のまま。
- **Status:** open

### N1 — Severity: Nit

- **Location:** Plan Task 4 Files「Modify: `src/features/pwa/register-service-worker.ts`（新規）」
- **Description:** 新規ファイルを Modify と書いている。Create が正しい。
- **Status:** open

### N2 — Severity: Nit

- **Location:** Plan Task 2 Interfaces の `seedPwaInstallTipDismissed` 型 vs Step 3 実装
- **Description:** Interfaces は `addInitScript(script: () => void)`、実装は `(key: string) => void` + `arg: string`。Playwright は後者。Interfaces を実装に合わせる。
- **Status:** open

---

## Spec ↔ Plan coverage

| Spec 領域 | Plan | 判定 |
| --- | --- | --- |
| §4 不変（非キャッシュ / API・callback 非介入 / 実行時 put 禁止 / CSP / Auth 非再定義 / DEV 非登録 / skipWaiting なし / 自 CACHE_NAME） | Global + Task 4 | OK（pathname 許可リスト検査は F6） |
| §6 manifest / icons / index.html | Task 3 | OK |
| §7.1–7.2 generator / Precache / CACHE_NAME | Task 4 | 部分（**F3**） |
| §7.3 install / activate / fetch | Task 4 | 部分（F6 / F7） |
| §7.4 登録 `PROD` のみ | Task 4 | OK（DEV 非登録の専用テストは無し。許容） |
| §7.5 `_headers` exact + `extractConnectSrc` 複数ブロック | Task 3 | OK（live `^/\*` を先に RED 化） |
| §8.1–8.3 検出・資格・フラグ | Task 1 | 部分（**F4** メモリ dismiss、F10 path） |
| §8.4–8.7 copy / カード h2 / 設定両分岐 / BIP 早期 | Task 2 | 部分（**F1**、F8 フック名） |
| §9.1 ユニット表 | Task 1–4 | 部分（F3 形式、F4、F10） |
| §9.2 E2E 既定 dismiss 5 入口 | Task 2 | 部分（**F1 / F2**） |
| §9.3 手動 / PR | Task 5 | **欠落（F9）** |
| §10 受け入れ | Task 5 | 部分（チェックリスト無し） |
| §11 実装順（1∥3、2←1、4←3） | Task 1–5 | OK（下記） |
| Auth ロック非再定義 / Workbox なし | Global | OK |

## Task 順

- Spec §11 の「1 と 3 は独立、2 は 1 依存、4 は 3 の後が安全」に一致する。
- BIP 早期 listen を Task 2（カード）へ前倒ししたのは Spec §8.5 / MF-I8 に対して **より正しい**（§11 手順 4 より優先してよい）。
- `/sw.js` ヘッダを Task 3 で先に固定するのも順序入れ替え耐性として妥当。
- cleanup テストを Task 1 に置いたのは §11 手順 5 より早いが、キー定数の隣なので問題なし。
- Task 2 が `main.tsx` を触り、Task 4 が再度 `registerServiceWorker()` を足す。衝突は小さい。strip → BIP → register → `createRoot` の順を Task 4 に 1 行残すとよい。

## E2E dismiss 残穴（live 照合）

守れている入口:

| 入口 | live | Plan |
| --- | --- | --- |
| `loginAsNewUser` → `/planner` goto 前 | L318–321 が着地定義 | session 書き込み後・goto 前に seed。**タイミングは正しい** |
| `completedOnboardingPage` / `seed-onboarding.ts` の再訪 | 同一 `page` を再利用 | page に付いた addInitScript が後続 `goto("/planner")` に効く |
| `auth.setup.ts` | L19–26 が magic-link 着地。キー未書き | 冒頭 addInitScript + `storageState()` 前 evaluate。OK |
| `session-auth.ts` | L22–26 が `newContext` 直後 `/planner` | `context.addInitScript`。OK（storageState にキーが載る前提の二重化） |

残穴（F1 / F2）:

- 本機能 E2E のログインが常時 seed と未分離。
- `auth-recovery.spec.ts` が Files に無い。
- `loginAsNewUser` が page 単位だと `context.newPage()` peer にカードが出る。
- `oauth-mock.spec.ts` 以外の raw 着地が「等」のまま。

`heading.first()`（`mobile-accessibility.spec.ts` L256、`/history/:id`）は `completedOnboardingPage` 同一 page なので、F1 を除き loginAsNewUser seed で守れる。named heading 契約はカード h2「ホーム画面に置く」と衝突しない。

## SW 契約

| 契約 | Plan | 判定 |
| --- | --- | --- |
| 許可リスト以外を `cache.put` しない | 本文に `cache.put` 無し。Step 5 で `rg` | OK |
| グローバル `caches.match(` 禁止 | instance `cache.match` のみ。grep テスト | OK |
| ナビ失敗は自 `CACHE_NAME` の `SHELL_URL` | `caches.open(CACHE_NAME)` → `cache.match(SHELL_URL)` | OK（miss は F7） |
| `/api`・`/api/`・`/auth/callback`・`/auth/callback/` passthrough | `isApiPath` / `isAuthCallbackPath` が capturer 集合に一致 | OK |
| 非 GET / 他 origin passthrough | `decideServiceWorkerFetch` RED | OK |
| `/` 必須、`/index.html` 非掲載、woff2 非掲載 | generator RED | OK（CACHE_NAME 形式は F3） |
| `skipWaiting` / `clients.claim` なし | 本文なし + build 後 `rg` | OK |
| 欠落リスト / `/` 無しは throw | generator RED | OK |
| `tsc -b` が SW を通す | `sw-defines.d.ts` のみ | **F5** |

`vite.config.ts` へのプラグイン追加は実装可能。現行 `build` は `assetsInlineLimit: 0` のみ。プラグイン `config()` の `{ build: { manifest: true } }` は Vite がマージするので fontsource の inline 禁止は維持される。`closeBundle` の `import.meta.url` 基準 `./dist` はリポジトリ直下の `vite.config.ts` と一致する。

`scripts/csp-headers.test.mjs` L43 の `^/\*` は Task 3 が先に RED 化する。`extractConnectSrc` は最初の `Content-Security-Policy` 行を取るため、先頭に `/sw.js` / manifest ブロックを足しても CSP は拾える。`emit-deploy-headers.test.mjs` は `buildDeployHeadersFile` 出力との一致なので追従する。

## TDD 実行可能性

- Task 1: RED 例あり。`auth-cleanup.test.ts` の preferences 生存（L42 / L84 ほか複数）へキーを足す指示は実装可能。owned 関数にキーを足さない指示は live `isOwnedBrowserStorageKey`（`kondate:preferences` 非対象）と一致。
- Task 2: カード / 設定 / BIP の RED は回る。E2E 本体は Task 5 まで走らず、F1 が後発見になる。
- Task 3: ヘッダ RED は現行 `^/\*` で確実に FAIL する。アイコンは `sharp` が `package.json` 依存にあり実装可能。
- Task 4: ルーティング RED は回る。generator は F3 の入出力が無いと「何が RED か」が揺れる。`tsc` は F5。
- Task 5: 焦点コマンドは Docker `--no-deps` で妥当。フル E2E をエージェントが回さない注記は CLAUDE.md と一致。

## 良い点

- File map が Spec §5 の所有境界（`src/features/pwa/` / `src/pwa/` / `scripts/generate-service-worker.mjs` / 設定はマウントのみ）と一致する。
- 設定差し込み位置が live の `PlanSettingsSection` 直前（空家族 L1556 前・家族あり L2286 前）と一致。読込中 L1501 / L1527 / L1572 に置かない判断は §2.3 残差どおり。
- `household-settings-page.test.tsx` の mock が現行 `PlanSettingsSection` mock（L58–59）と同型。
- AppShell はデスクトップバーの下・`<Outlet />` 直前。`app-shell.test.tsx` は未認証 `AuthContext` なので、資格関数が session を見る限り既存 heading 契約は壊れない。
- BIP を `createRoot` より前に listen する順序は MF-I8 を満たす。
- E2E 既定を `evaluate` 正本にしない、は live `loginAsNewUser`（着地済み `/planner`）と `session-auth`（`about:blank`）の失敗モードを踏まえている。
- Global Constraints が Auth ロック export・CSP・Workbox・`git push` を明示的に封じている。

## Residual（Spec §2.3・計画が直さないもの）

- iOS standalone のストレージ分離 / 再ログイン。
- standalone 内 OAuth・マジックリンク。
- デプロイ直後 1 回の旧シェル。
- 通信断はシェルのみ（オフラインモードなし）。
- デスクトップ初回カードなし。
- CriOS / FxiOS は Safari 手順のまま。
- インストール成功後も「わかりました」まで残す。
- 実 SW・実機インストールは CI 外。
- 旧 SW kill switch / DEV 残存 SW 解除なし。
- カードが Outlet を押し下げ、主要 CTA が沈み得る。

これらを Plan が実装対象に引き上げていない点は **Spec どおりで問題なし**。

---

## Verdict（再掲）

**REVISE** — F1–F5 を Plan 本文に埋めてから Task 1 を開始する。F6–F11 は同一改訂で閉じられるとよいが、残しても実装開始は止めない。
