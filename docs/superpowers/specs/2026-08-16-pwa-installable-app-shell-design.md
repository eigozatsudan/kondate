# こんだて日和 PWA（インストール可能 + アプリシェル）設計

- 日付: 2026-08-16
- 状態: **レビュー MF 反映済み・Plan 作成済み**（1次 REVISE / 敵対 BLOCK_WITH_CONDITIONS / 2次 REVISE_SPEC → MF-I1…I9 を本文へ反映。Plan は MF-P1…P6 反映済み）
- 実装計画: `docs/superpowers/plans/2026-08-16-pwa-installable-app-shell.md`
- 種別: 設計。本編 Vite SPA のインストール可能性と再訪シェル高速化
- 対象: `src/`、`index.html`、`public/icons/`、ビルド後 `dist/sw.js`、`scripts/csp-headers.mjs` / `scripts/emit-deploy-headers.mjs`、関連テスト / 軽い E2E
- 非対象: `admin/`、Netlify Functions、Supabase、contracts、safety 評価パイプライン
- レビュー:
  - [1次](../reviews/2026-08-16-pwa-installable-app-shell-primary.md)
  - [敵対](../reviews/2026-08-16-pwa-installable-app-shell-adversarial.md)
  - [2次](../reviews/2026-08-16-pwa-installable-app-shell-secondary.md)

---

## 1. 結論

本編を **ホーム画面に置ける Web アプリ** にし、**2 回目以降の起動でハッシュ付き JS / CSS とアイコンだけを Cache Storage から返す**。フォントは unicode-range スライスのままブラウザ HTTP キャッシュに任せる（SW Precache に入れない）。献立・買い物・アレルギー・API 応答はキャッシュしない。プッシュ通知は作らない。

| 項目 | 決定 |
| --- | --- |
| 範囲 | インストール可能性 + 許可リスト型アプリシェル。オフラインデータなし |
| 主対象 | iPhone / iPad（Safari 系）。Android も同等の初回案内を出す |
| 案内 | ログイン後・本体画面で 1 回。設定に常設。ログイン画面では出さない |
| 既存ユーザー | 登録日やオンボーディングでは出し分けない。端末フラグが無い人が次に開いたときが初回 |
| 更新 | 今の画面は奪わない。次に開いたとき静かに新しい版 |
| Worker | `vite-plugin-pwa` / Workbox は使わない。ビルドが書いた小さな `sw.js` のみ |
| シェル URL | `/`（Netlify の `/* → index.html` 200 rewrite。`/index.html` は Precache しない） |
| 認証 | `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` を再定義しない |

---

## 2. 目的と対象外

### 2.1 目的

1. Safari / Chrome のインストール基準を満たし、ホーム画面から standalone で開ける。
2. 再訪時、ハッシュ付き JS / CSS とアイコンを Cache Storage から返す。フォントは HTTP キャッシュ。
3. 新規も既存も、初めてこの機能に触れた端末では同じ初回案内を出す。
4. iPhone と Android で、その端末の手順（または Chrome のインストールダイアログ）を出す。

### 2.2 対象外

- 献立・履歴・買い物・冷蔵庫・家族設定・アレルギー・下書き・生成 pending のキャッシュ
- オフライン専用画面、Background Sync、プッシュ、バッジ、Web Share Target
- ログイン画面・LP・ウェルカム・オンボーディングでの案内
- 操作中の強制再読み込み、更新バナー
- `vite-plugin-pwa`、Workbox、`openrouter/auto` 等と無関係な依存追加
- CSP の緩和（`script-src` への `unsafe-inline` / `blob:` / CDN 追加）
- Auth ロック export の再定義、OAuth / マジックリンクの standalone 修復
- プライバシー方針本文の改訂（ユーザーデータはキャッシュしない）
- admin コンソールの PWA 化
- ブランドの描き直し・ダークモード（アイコン新設は §6.3 のみ）

### 2.3 受け入れ残差（直さない）

| 残差 | 扱い |
| --- | --- |
| iOS のホーム画面アプリは Safari とストレージが分かれることがある | アイコン初回起動で再ログインし得る。本スライスでは直さない |
| standalone 内の Google / マジックリンクが Safari・メールに出る | 既存 continuation に任せる。ログイン画面にインストール案内は出さない |
| デプロイ直後の 1 回は古いシェルで開く | 更新方針どおり。案内も出さない |
| 通信断ではシェルだけ出て、データは既存の通信エラー | オフラインモードは作らない |
| デスクトップには初回カードを出さない | 設定の汎用 1 節だけ |
| iPhone の「デスクトップ用サイト」等、`other` になる UA | 初回カードを出さない。設定節のみ |
| CriOS / FxiOS | `ios` 扱いのまま。Safari の共有手順を出す。Safari で開き直せ、とは書かない |
| インストール成功後も「わかりました」までカードが残る | §8.5 どおり自動 dismiss しない |
| 共有端末の 2 人目 | 受け入れ 4。設定節を頼る |
| 実 SW 制御・実機インストール | CI 対象外（§9.2–9.3） |
| 旧 SW 残留の kill switch | 第1版では作らない。オンラインナビは network-first なので本体は死なない |
| DEV に残った本番相当 SW の解除 | しない。preview は 4173、E2E は 5173 で通常分離 |
| 設定の読込中 early return に常設節が無い | 空家族 / 家族ありの 2 分岐が正。読込中は許容 |
| カードが Outlet を押し下げ、主要 CTA が下に沈む | overlay しない判断の残差。下タブは覆わない |

---

## 3. 現状

| 現状 | ギャップ |
| --- | --- |
| `index.html` に `theme-color #faf9f8` のみ | manifest、apple-touch-icon、SW なし |
| 生成の `offline` は POST 応答喪失のリカバリ | オフライン利用でもシェルキャッシュでもない |
| `kondate:preferences` はログアウト掃除対象外 | 案内 dismiss の置き場として使える |
| CSP は `default-src 'self'; script-src 'self'` | Worker / manifest は同一オリジンなら追加不要 |
| `netlify.toml` の `/* → index.html` | 実ファイル（`sw.js`、manifest、icons）は Netlify が先に出す。欠落 `sw.js` は HTML 200 になり得る |
| `vite.config.ts` の `build` は `assetsInlineLimit: 0` のみ | `build.manifest` 既定 off。generator 用に必須化が要る |
| E2E は Vite dev（`tools/run-e2e-app.mjs`） | 本番専用 SW は E2E に載らない。カード案内は iPhone SE UA で出得る |
| fontsource は unicode-range 121 分割 | SW に全 woff2 を入れると `addAll` が原子失敗し得る |

---

## 4. 不変条件

1. **ユーザーデータ非キャッシュ。** Cache Storage に API JSON、Supabase 応答、localStorage の複製を置かない。
2. **`/api/*` と `/auth/callback`（末尾スラッシュあり含む）は SW が横取りしない。** `fetch()` にそのまま渡す。ナビゲーション失敗時のシェルフォールバックもこれらの path には適用しない。
3. **HTML を URL 単位で保存しない。** 保存してよい文書は Precache された `SHELL_URL`（`/`）1 枚だけ。`?code=` 付き callback URL をキーにしない。
4. **実行時キャッシュへの追加禁止。** install で入れた許可リスト以外を `cache.put` しない。使ったフォント切片の実行時 put もしない。
5. **CSP を緩めない。** `scripts/csp-headers.mjs` の `CSP_STATIC_DIRECTIVES` に token を足さない。
6. **Auth ロックを再定義しない。** 案内フラグは `kondate.auth.*` にも owned 掃除プレフィックスにも置かない。
7. **ログアウト / アカウント削除で案内フラグを消さない。** 既存の `kondate:preferences` と同じ端末設定。
8. **開発サーバでは SW を登録しない。** `import.meta.env.PROD` のときだけ。HMR と混ぜない。残存 SW の解除もしない。
9. **新しい SW は待たせる。** `skipWaiting` も `clients.claim` も呼ばない。
10. **秘密・PII をログしない。** SW 登録失敗は握りつぶす。`console` に URL クエリやユーザー識別子を出さない。
11. **ナビも静的も自 `CACHE_NAME` だけを見る。** グローバル `caches.match` は禁止（waiting 中の他シェルと混ぜない）。

---

## 5. アーキテクチャ

```
index.html  ── link rel=manifest / apple-touch-icon / favicon
main.tsx    ── PROD のみ SW 登録 + beforeinstallprompt の早期 listen
AppShell    ── 初回案内カード（本体画面・設定以外）
/settings   ── HomeScreenInstallSection（常設）
vite.config ── build.manifest: true + closeBundle で dist/sw.js
emit-deploy-headers ── /sw.js no-cache、/manifest.webmanifest の MIME、CSP は /* のまま
```

所有境界:

| 置き場 | 内容 |
| --- | --- |
| `src/features/pwa/` | 検出、案内資格、dismiss ストレージ、copy、カード、設定セクション、SW 登録、BIP 保持 |
| `src/pwa/service-worker.ts` | SW ソース（window / React を import しない） |
| `src/pwa/service-worker-routing.ts` | fetch 判定の純関数（SW とユニットテストが共有） |
| `src/pwa/sw-defines.d.ts` | `__KONDATE_SW_*` の `declare const` |
| `scripts/generate-service-worker.mjs` | 許可リスト埋め込み + esbuild バンドル |
| `public/icons/` | 180 / 192 / 512 / maskable 512 |
| `public/manifest.webmanifest` | 静的 manifest |
| `src/app/layouts/app-shell.tsx` | カードのマウントのみ |
| `src/features/household/household-settings-page.tsx` | 設定セクションのマウントのみ（空家族・家族あり。読込中は置かない） |

`@shared/safety` は import しない。ブラウザは `@shared/safety-pure` も本機能では不要。

---

## 6. Manifest・HTML・アイコン

### 6.1 `public/manifest.webmanifest`

```json
{
  "id": "/",
  "name": "こんだて日和",
  "short_name": "こんだて日和",
  "lang": "ja",
  "dir": "ltr",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#faf9f8",
  "theme_color": "#faf9f8",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

フィールドを増やさない（`screenshots`、`shortcuts`、`share_target` は対象外）。

### 6.2 `index.html` 追加（既存 `theme-color` / referrer は残す）

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/icons/icon-192.png" type="image/png" sizes="192x192" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="こんだて日和" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

`apple-mobile-web-app-capable` は古い iOS 互換のため残す。`mobile-web-app-capable` を併記する。ブラウザタブ用 favicon は 192 PNG を流用し、別デザインを増やさない。

### 6.3 アイコン

既存ロゴファイルは無い。紙色 `#faf9f8` 地にテラコッタ `#b85033` の単純な器（椀の正面シルエット）を描いた PNG をコミットする。

| ファイル | 用途 |
| --- | --- |
| `public/icons/apple-touch-icon.png` | 180×180 |
| `public/icons/icon-192.png` | 192×192 |
| `public/icons/icon-512.png` | 512×512 |
| `public/icons/icon-512-maskable.png` | 512×512、重要部分を中央 80% に収める |

写真・人物・文字（「こ」一文字を含む）は使わない。コントラストは現行 `:root` トークンに合わせ、新しい色を足さない。

---

## 7. Service Worker

### 7.1 生成

`scripts/generate-service-worker.mjs` は Vite プラグイン（`vite.config.ts`）の `closeBundle` からのみ呼ぶ。同じプラグインの `config` フックで **`build.manifest: true` を必須化**する。`package.json` の `build`（`tsc -b && vite build`）は変えない。

`src/pwa/sw-defines.d.ts` に次を置く（`tsc -b` が `src/` を見るため）:

```ts
declare const __KONDATE_SW_CACHE_NAME__: string;
declare const __KONDATE_SW_PRECACHE__: string;
declare const __KONDATE_SW_SHELL__: string;
```

`src/pwa` は `tsconfig.app.json` から外さない。

手順（失敗したらビルド失敗）:

1. `dist/.vite/manifest.json` と `dist/index.html` を読む。欠けていれば throw。
2. §7.2 の許可リスト `PRECACHE_URLS` を作る。`/`（`SHELL_URL`）が含まれなければ throw。配列が空なら throw。
3. `PRECACHE_URLS` を UTF-8 昇順で一意化する。
4. `CACHE_NAME` は `kondate-shell-` + SHA-256 先頭 12 hex。入力は「ソート済み URL を `\n` 結合」+「非ハッシュ Precache 各ファイルの内容 SHA-256 を URL 順で `\n` 結合」。非ハッシュとはパスに Vite のハッシュ（`-` + 8 桁以上 hex）を含まないもの（`/`、`/manifest.webmanifest`、`/icons/*`）。`Date.now()` や乱数は禁止。同一入力なら同一名。
5. 既存依存の `esbuild` で `src/pwa/service-worker.ts` を IIFE バンドルする。`__KONDATE_SW_CACHE_NAME__` / `__KONDATE_SW_PRECACHE__` / `__KONDATE_SW_SHELL__` を define で文字列化する。`src/pwa/service-worker-routing.ts` は SW とユニットテストが同じ関数を import する。
6. `dist/sw.js` に書き出す。source map は出さない。

### 7.2 Precache 許可リスト

含める:

- `/`（`SHELL_URL`。本番で 200 かつ非 redirect。Netlify の `/* → index.html` 200 rewrite に乗る）
- `/manifest.webmanifest`
- `/icons/apple-touch-icon.png`
- `/icons/icon-192.png`
- `/icons/icon-512.png`
- `/icons/icon-512-maskable.png`
- `dist/.vite/manifest.json` の各 chunk について、`file` + `css[]` + `assets[]` だけを先頭 `/` 付き URL にし、拡張子が `.js` または `.css` のもの。`src` / `imports` / `dynamicImports` は見ない

含めない:

- `/index.html`（Pretty URLs の 301 を避ける）
- `.woff` / `.woff2`（fontsource 121 スライスは HTTP キャッシュ。実行時 `cache.put` もしない）
- `.webp` / `.png`（icons 以外）/ `.jpg` / `.map`
- `/api/*`
- ソースマップ
- `sw.js` 自身

許可リストが空、または `/` が無いビルドは **失敗**する。

### 7.3 イベント

**install**

- `caches.open(CACHE_NAME)` → `addAll(PRECACHE_URLS)`
- 失敗したら install 失敗（次回起動で再試行）
- `skipWaiting()` は呼ばない

**activate**

- `CACHE_NAME` 以外の `kondate-shell-` プレフィックスキャッシュを削除
- 他 origin / 他名のキャッシュは触らない
- `clients.claim()` は呼ばない

**fetch**（同期的に判断し、対象外はデフォルトのネットワークへ）

入力: `request`

1. `request.method !== "GET"` → 横取りしない。
2. `new URL(request.url).origin !== self.origin` → 横取りしない。
3. pathname が `/api` そのもの、`/api/` で始まる、または `/auth/callback` / `/auth/callback/`（query は無視して pathname だけ見る。`auth-callback-url-capture.ts` と同じ集合）→ 横取りしない。
4. ナビゲート（`request.mode === "navigate"`）:
   - `fetch(request)` を試み、成功レスポンスを **キャッシュせず**返す。
   - ネットワーク失敗のときだけ `const cache = await caches.open(CACHE_NAME); return cache.match(SHELL_URL)`。無ければ失敗をそのまま。
   - **`caches.match`（グローバル）は使わない。** 他 `kondate-shell-*` の HTML を返さない。
5. それ以外（静的）:
   - `caches.open(CACHE_NAME)` の `cache.match`（`ignoreSearch: true`）。pathname が `PRECACHE_URLS` の pathname 集合に含まれるときだけヒットを返す。
   - ミスまたは非許可は `fetch(request)`。成功しても `cache.put` しない。

ナビゲート失敗のシェルフォールバックは、手順 3 の path には到達しない。

### 7.4 登録

`src/features/pwa/register-service-worker.ts`:

```ts
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    // 登録失敗はオンライン SPA のまま。クエリや例外メッセージを残さない
  });
}
```

`src/main.tsx` は `createRoot` の前または直後に `registerServiceWorker()` を 1 回呼ぶ。Auth callback URL strip より後でよい（SW は callback を横取りしない）。同じ `main.tsx` で §8.5 の BIP 早期 listen も呼ぶ。

### 7.5 ヘッダ

`scripts/csp-headers.mjs` の `buildHeadersFileContent` が出す exact 本文の先頭は次（CSP 行の意味は変えない）:

```
/sw.js
  Cache-Control: no-cache
  Content-Type: text/javascript; charset=utf-8

/manifest.webmanifest
  Content-Type: application/manifest+json

/*
  Content-Security-Policy: <既存どおり>
```

`worker-src` は足さない（`default-src 'self'` で足りる）。グローバル `[[headers]]` に CSP を戻さない。

更新対象テスト（名前で固定）:

- `scripts/csp-headers.test.mjs` — 先頭が `/sw.js` + no-cache + JS MIME、その後 `/*` に既存 CSP が残ること。`extractConnectSrc` が複数ブロックでも CSP を拾えること。
- `tests/tooling/project-config.test.mjs` — グローバル `[[headers]]` に CSP が無いこと（現行どおり）。

---

## 8. 案内

### 8.1 ストレージ

| キー | 置き場 | 値 |
| --- | --- | --- |
| `kondate:preferences:pwa-install-tip-dismissed` | `localStorage` のみ | `"1"` |

- 読み: 値が正確に `"1"` のときだけ dismissed。
- 書き: `"1"` のみ。JSON や日時は持たない。
- `isOwnedBrowserStorageKey` / `clearOwnedBrowserStorage` / `clearOwnedLocalDataBestEffort` / `clearSoftSessionResidualBestEffort` にこのキーを **追加しない**。
- テストで「preferences は残る」既存ケース（`kondate:preferences`）に、本キーが logout / 削除 second pass 後も残ることを追加する。

セッション中のストレージ書き込み失敗: メモリ上 dismissed とみなし、同じタブでは再表示しない。リロード後はフラグが無いので再表示してよい。

### 8.2 面の検出

```ts
export type InstallSurface = "ios" | "android" | "other";

export function detectInstallSurface(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): InstallSurface {
  if (/iPhone|iPod/u.test(userAgent)) return "ios";
  if (/iPad/u.test(userAgent)) return "ios";
  if (platform === "MacIntel" && maxTouchPoints > 1) return "ios";
  if (/Android/iu.test(userAgent)) return "android";
  return "other";
}

export function isStandaloneDisplayMode(
  matchesStandalone: boolean,
  navigatorStandalone: boolean | undefined,
): boolean {
  return matchesStandalone || navigatorStandalone === true;
}
```

`window.matchMedia("(display-mode: standalone)").matches` と iOS の `navigator.standalone` を渡す。実装は `window` をモジュール初期化で読まない（テスト注入）。CriOS / FxiOS は iPhone UA に乗るので `ios`。

### 8.3 カードを出す経路

AppShell 配下かつ設定以外:

- 出す: `/planner`、`/generation`、`/menus/*`、`/pantry`、`/history`、`/history/*`、`/shopping`、`/emergency-menus`、`/emergency-menus/*`、`/plus`
- 出さない: `/settings`（常設がある）、`/login`、`/auth/callback`、`/`、`/welcome`、`/onboarding`、`/privacy`、404

`shouldShowInstallTip`:

```ts
export function shouldShowInstallTip(input: {
  hasSession: boolean;
  pathname: string;
  surface: InstallSurface;
  standalone: boolean;
  dismissed: boolean;
}): boolean
```

全て満たすときだけ true:

1. `hasSession`
2. `!standalone`
3. `!dismissed`
4. `surface === "ios" || surface === "android"`
5. pathname が §8.3 の「出す」リスト

AppShell は `RequireSession` の内側なので 1 は常に真に近いが、関数は独立に判定する。マウントは AppShell のみ。

### 8.4 文言（固定）

共通見出し: `ホーム画面に置く`（カードは **`h2`**。設定の `h2`「ホーム画面に追加」と exact name で区別する）

共通リード: `ホーム画面に置くと、次からすぐ開けます。`

iOS 手順（カード・設定で同一。CriOS もこのまま）:

1. `画面の下（または上）の共有ボタンをタップします`
2. `「ホーム画面に追加」を選びます`
3. `「追加」をタップします`

Android 手順（ダイアログが使えないとき・設定）:

1. `右上のメニューを開きます`
2. `「アプリをインストール」または「ホーム画面に追加」を選びます`

その他（設定のみ）: `お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。`

閉じるボタン: `わかりました`（`type="button"`、最小 44×44 CSS px）

Android インストールボタン: `インストールする`（`beforeinstallprompt` を保持しているときだけ出す。手順リストは出さない）

カード・設定とも「PWA」「Service Worker」「キャッシュ」とは書かない。

### 8.5 Android `beforeinstallprompt`

`src/features/pwa/android-install-prompt.ts`（モジュール初期化）:

- `main.tsx` から `listenForAndroidInstallPrompt()` を **モジュール初期化時**（`createRoot` より前で可）に呼ぶ。
- `window` の `beforeinstallprompt` を listen し、`preventDefault()` してモジュール変数へ置く。
- surface 判定で listen 自体を遅らせない（Chromium 以外ではイベントが飛ばない）。
- `useAndroidInstallPrompt` はその保持を読むだけ。reset / inject API をテスト用に export する。
- カードの `インストールする` は `event.prompt()` を呼ぶ。
- `userChoice` / `appinstalled` でカードを自動 dismiss しない。
- イベントが無い Android は手順リストだけ。

### 8.6 UI

- モーダルにしない。AppShell の `Outlet` の直前、デスクトップ用バーの下に 1 枚の `<section>`。
- 見出しは **`h2`**。`aria-labelledby` で結びつける。
- 下タブは覆わない。カードは Outlet を押し下げる（主要 CTA が折りたたみ下に沈み得る。§2.3）。
- 320 CSS px で横スクロールしない。
- 既存トークン（地 `#faf9f8`、本文 `#26211e`、主ボタンは現行 primary）を使う。新しい色を足さない。新規 CSS セレクタを足す場合だけ `src/styles.contrast.test.ts` に追加する。既存 `card` / `stack` だけで足りるなら新規セレクタは作らない。
- フォーカスはカード出現で奪わない。

### 8.7 設定

`HomeScreenInstallSection` を `PlanSettingsSection` の前、家族ブロックの後に置く。空家族分岐と家族あり分岐の **両方**に同じコンポーネントを置く。読込中 early return には置かない。

- `h2`: `ホーム画面に追加`
- 面に応じて §8.4 の手順を出す（iOS / Android / other の三系統。iOS 主＋ Android 1 行の併記はしない）
- Android で BIP 保持があるときは設定でも `インストールする` を出してよい
- `household-settings-page.test.tsx` は `PlanSettingsSection` と同様に本セクションを mock する

---

## 9. テスト

### 9.1 ユニット

| 対象 | 固定すること |
| --- | --- |
| `detect-install-surface` | iPhone / iPod / iPad / iPadOS(MacIntel+touch) / CriOS は ios。`Android` を含む UA は android。Windows / Macintosh touch なし / `Android` を含まない Linux は other |
| `shouldShowInstallTip` | 未ログイン、standalone、dismissed、other、`/settings`、`/welcome`、`/` は false。`/planner` で ios/android + session は true。既存ユーザー＝ dismissed false |
| dismiss ストレージ | `"1"` のみ真。書けないときはメモリ dismiss |
| logout 掃除 | 本キーは残る（`auth-cleanup.test.ts` に 1 本） |
| SW ルーティング純関数 | §7.3。API / `/auth/callback` / `/auth/callback/` / 非 GET / 他 origin は passthrough。navigate 失敗は **自 CACHE_NAME の SHELL のみ**（他キャッシュの HTML を返さない）。許可外は put しない |
| generate-service-worker | webp / woff2 を含めない、`/` 必須、`/index.html` を入れない、空リストは throw、URL ソート、非ハッシュ内容が CACHE_NAME に効く |
| ヘッダ | `scripts/csp-headers.test.mjs` が §7.5 の exact 本文。`project-config.test.mjs` はグローバル CSP 無し |
| カード / 設定 | 文言、`h2`、44px、Android ボタン。BIP は inject API |
| SW define | `tsc -b` が `src/pwa/service-worker.ts` を通す |

SW の `self.addEventListener` 本体はルーティング関数を呼ぶだけにする。

### 9.2 E2E

`page.evaluate(setItem)` を正本にしない。

既定 dismiss の入口（すべて **ドキュメント作成前**）:

1. `e2e/fixtures/auth.ts` の `loginAsNewUser` — **`page.addInitScript`** でキー `"1"`。`/planner` 着地より前。L206 が禁じているのは session 手注入であり、本フラグとは別。
2. `completedOnboardingPage` / seed 後の `/planner` 再訪 — 同じ context の addInitScript が効くこと。
3. `e2e/specs/auth.setup.ts` — `storageState()` 保存前に同じキーを localStorage へ書き、保存済み state 自体を dismiss 済みにする。
4. `e2e/fixtures/session-auth.ts` — `newContext(storageState)` 後に **`context.addInitScript`**（または storageState JSON にキーが入っていること）。`goto("/planner")` 前。`about:blank` での `page.evaluate` は使わない。
5. `requestMagicLinkAndReadUrl` 利用側、および raw Playwright で planner に落ち得る spec（`oauth-mock.spec.ts` 等）— 同じ addInitScript を共有ヘルパ `seedPwaInstallTipDismissed(pageOrContext)` にまとめる。

本機能 E2E `e2e/specs/pwa-install-tip.spec.ts` だけが addInitScript 無し（または明示削除）でカードを見る。

1. フラグを消した iPhone UA で `/planner` にカード（`h2`「ホーム画面に置く」）が出る。
2. `わかりました` 後に出ない。
3. `/settings` に `h2`「ホーム画面に追加」がある。
4. Android UA で手順またはインストールボタンがある。

既存 E2E の `getByRole("heading").first()` および named heading 契約を、既定 fixture ではカードが侵さない。

実機のホーム画面追加、実 SW 制御下の再訪、Playwright での installability は CI 対象外。`@smoke` は付けない。

### 9.3 手動（実装 PR 説明に手順を書く。CI ゲートにしない）

- 本番相当 `vite build` で `dist/.vite/manifest.json` と `dist/sw.js` がある
- preview / 本番で Precache 各 URL が **200 かつ非 redirect**（`/` は 200 rewrite 可。`/index.html` はリストに無い）
- `/sw.js` の `Content-Type` が JavaScript であり `text/html` でない。`Cache-Control: no-cache`
- `/manifest.webmanifest` の `Content-Type` が `application/manifest+json`
- Chromium でインストールでき、2 回目のリロードでシェル JS が service worker 経由
- ネットワークオフでシェルは出るがデータはエラー
- `/api/` を DevTools で確認し SW が応答していない

---

## 10. 受け入れ

1. 本番ビルドの `dist` に `manifest.webmanifest`、icons、`sw.js`、`dist/.vite/manifest.json`、ハッシュ付き JS/CSS の Precache がある。
2. 開発サーバでは SW が登録されない。
3. iOS / Android の既存ユーザー（フラグ無し、`other` でない UA）が本体画面を開くと、それぞれの初回案内が出る。
4. 閉じたあと、ログアウトして別アカウントで入っても同じ端末では出ない。
5. standalone では出ない。
6. `/api/*` と `/auth/callback` および `/auth/callback/` は SW 非介入。
7. HTML が query 付き URL で Cache Storage に残らない。ナビ失敗は自 `CACHE_NAME` の `/` だけ。
8. `scripts/csp-headers.test.mjs` がグリーン。`sw.js` が no-cache + JS MIME。manifest が `application/manifest+json`。
9. 既存 E2E（§9.2 の既定 dismiss）がカード理由で赤くならない。`heading.first()` がカードの `h2` にならない。
10. 本番 `/sw.js` の `Content-Type` が JavaScript であり `text/html` でない。欠落時はビルド throw。

---

## 11. 実装順（Plan への入力）

1. 検出・資格・ストレージ + テスト（UI なし）
2. copy + カード（`h2`）+ 設定マウント（両分岐、家族テストは mock）+ E2E addInitScript dismiss + 案内 E2E
3. manifest / icons / index.html + MIME ヘッダ
4. SW ルーティング純関数 + `build.manifest` + generator + Vite プラグイン + 登録 + BIP 早期 listen + `sw.js` ヘッダ
5. `csp-headers.test.mjs` / cleanup テストの更新

1 と 3 は独立。2 は 1 に依存。4 は 3 の URL を Precache に含めるため 3 の後が安全。

---

## 12. Key Decisions

1. **許可リスト SW を手書きする** — 自動 generateSW は API までキャッシュし得る。本リポジトリの審査に向かない。
2. **案内は端末フラグのみ** — 既存ユーザーを「新規だけ」から外さない。アカウント作成日は見ない。
3. **iOS と Android で手順を出し分ける** — 片方の手順を他方に出さない。
4. **更新は次起動** — `skipWaiting` / `clients.claim` なし。料理中に画面を奪わない。
5. **E2E 既定は addInitScript で dismiss 済み** — mobile-chromium が iPhone UA のため、既存 shots / フローを守る。`evaluate` は正本にしない。
6. **Auth / Functions / DB 非変更** — シェルと案内だけ。standalone ログイン欠陥は残差。
7. **シェルは `/`。フォントは Precache しない** — Netlify Pretty URLs と fontsource 121 スライスを壊さない。
8. **ナビフォールバックは自 CACHE_NAME のみ** — waiting 中の新旧 mix を禁止。
9. **BIP はモジュール初期化で取る** — フック mount 待ちで Android 主経路を殺さない。
