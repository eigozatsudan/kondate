# 1次レビュー: PWA インストール可能アプリシェル設計

**対象:** [`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)
**照合先（実装が正）:**
`index.html` / `vite.config.ts` / `netlify.toml` / `package.json` /
`scripts/csp-headers.mjs` / `scripts/csp-headers.test.mjs` / `scripts/emit-deploy-headers.mjs` /
`src/main.tsx` / `src/app/router.tsx` / `src/app/layouts/app-shell.tsx` / `src/app/layouts/app-shell.test.tsx` /
`src/features/household/household-settings-page.tsx`（空家族 L1556–1566・家族あり L2286–2297） /
`src/features/auth/auth-cleanup.ts` / `src/features/auth/auth-cleanup.test.ts` /
`src/features/auth/auth-callback-url-capture.ts` /
`src/styles.css`（fontsource スライス注記・`:root` トークン） / `tsconfig.app.json` /
`e2e/fixtures/auth.ts` / `e2e/fixtures/session-auth.ts` / `e2e/specs/auth.setup.ts` /
`e2e/specs/settings.spec.ts` / `e2e/specs/mobile-accessibility.spec.ts` /
`playwright.config.ts` / `tests/tooling/project-config.test.mjs`
**レビュー種別:** 設計一次レビュー（内部一貫性・実装可能性・既存契約衝突・プライバシー・CSP・Auth ロック・E2E 回帰・受け入れ）
**レビュー日:** 2026-08-16
**編集:** なし（read-only。本ファイルのみ成果物）

---

## Summary

方向は現行実装と噛み合っている。許可リスト手書き SW、`vite-plugin-pwa` / Workbox 不採用、`/api/*` と `/auth/callback` の非介入、HTML の URL 単位保存禁止、実行時 `cache.put` 禁止、CSP 非緩和、Auth ロック export 非再定義、案内フラグを `kondate.auth.*` と owned 掃除の外（`kondate:preferences:…`）に置く、開発サーバ非登録、`skipWaiting` / `clients.claim` なし、はいずれも live tree の不変条件と衝突しない。

設定マウントも実装と一致する。`household-settings-page.tsx` は空家族・家族ありの両分岐で、家族ブロックのあと・`PlanSettingsSection` の前に差し込む位置が空いている（現状は直に Plan → ShareConsent → Account）。`auth-cleanup.ts` の `isOwnedBrowserStorageKey` は `kondate:preferences` もその子キーも掃除しない。`package.json` に `vite-plugin-pwa` は無い。`index.html` は `theme-color #faf9f8` と referrer のみで、仕様の追加は既存 meta を壊さない。

一方、このまま Plan に落とすと **本番ビルドが落ちる**、**SW が載らない / 載せてもシェル目的を外す**、**iPhone SE 既定の既存 E2E がカード理由で赤くなる**、**Netlify 上で Chrome のインストール基準を満たさない**、という実装者分岐が複数残る。Critical（漏洩・認可バイパス・安全保証の誤表示）は設計どおりでは起きない。Important が複数 open のため **REVISE**。

## Verdict

**REVISE**

- Critical: 0
- Important: 6
- Minor: 6

人間承認・implementation plan 前に、F1–F6 を設計本文へ閉じること。

---

## Findings

### F1 — Severity: Important

- **Location:** 設計 §7.1 / 現行 `vite.config.ts`（`build` は `assetsInlineLimit: 0` のみ） / `package.json` `"build": "tsc -b && vite build"` / `tsconfig.app.json` `include: ["src", …]` `lib: ["ES2023", "DOM", "DOM.Iterable"]`
- **Description:** generator は `dist/.vite/manifest.json` が無ければ throw すると書いてあるが、Vite 8 の `build.manifest` 既定は off であり、現行 `vite.config.ts` も有効化していない。同時に SW ソースは `__KONDATE_SW_*` を esbuild `define` で埋める前提だが、`tsc -b` が `vite build`（`closeBundle`）より先に `src/` 全体を見る。`declare` も `src/pwa` 除外も書いていない。
- **Why it matters:** どちらも「設計どおり」で `npm run build` が落ちる。Netlify の全 context が `npm run build` 経由なので、SW 以前にデプロイ不能。実装者が manifest を別経路で読む・define 識別子を手で置換する、といった分岐が生まれる。
- **Suggestion:**
  1. §7.1 / 実装順 4 に `vite.config.ts` の `build.manifest: true` を必須化する（`package.json` の `build` 文字列は変えない、のまま）。
  2. `src/pwa/service-worker.ts` 用に `declare const __KONDATE_SW_CACHE_NAME__: string` 等を同じファイルか `src/pwa/sw-defines.d.ts` に置く、と一文で固定する。`src/pwa` を `tsconfig.app.json` から外すなら、そのファイルの型は generator テスト側で見る、と書く。
  3. 受け入れ 1 に「`dist/.vite/manifest.json` がビルド成果として存在する」を足す。
- **Status:** open

### F2 — Severity: Important

- **Location:** 設計 §7.2「`dist/.vite/manifest.json` が指すファイル」 / §2.1 目的 2（JS / CSS / **フォント**） / 現行 `src/styles.css` L12–22（400/700/明朝を unicode-range **121 分割**で読む。単一 944KB 面は使わない） / `vite.config.ts` L69–74（スライスが `data:` に潰れないよう `assetsInlineLimit: 0`。CSP `font-src 'self'`）
- **Description:** 「指すファイル」が Vite manifest のどのキーか未定義。エントリの `file` だけか、`css[]` / `assets[]` も含むか、`src` / `imports` / `dynamicImports`（モジュール ID）を除外するかが実装者依存。加えて `.woff` / `.woff2` を許可リストに入れる規則は、現行 fontsource スライス運用と衝突する。3 つの CSS が参照する切片はビルド成果にすべて出るため、機械的に集めると **100 超のフォント**が `addAll` 対象になる。
- **Why it matters:**
  - 収集が狭い: 再訪で CSS / フォントがネットワークのまま。目的 2 未達。デプロイ後に旧 SW 配下の未 precache lazy chunk が CDN から消えて 404 し得る。
  - 収集が広い（現行フォント運用のまま全 woff2）: install が数百リクエストの原子 `addAll` になる。1 件 404 / タイムアウトで **SW 全体が載らず、Chrome のインストール基準も落ちる**。unicode-range で「使った切片だけ取る」現行判断を SW が打ち消す。
- **Suggestion:** 収集を閉じる。推奨: 各 chunk の `file` + `css[]` + `assets[]` だけを URL 化し、`src` / `imports` / `dynamicImports` は見ない。配列は UTF-8 ソートしてから `CACHE_NAME` ハッシュ（F の Minor と一体）。フォントは次のいずれか一方を本文で選ぶ。
  1. **PRECACHE から `.woff` / `.woff2` を外す**（unicode-range と HTTP キャッシュに任せる。目的 2 の「フォント」を削除または「ブラウザ HTTP キャッシュ」に言い換える）。
  2. 全スライスを入れるなら、ファイル数上限・`addAll` 失敗時の扱い・初回 install の許容時間を受け入れに書く。中間（実行時に使った切片だけ `cache.put`）は不変条件 4 と矛盾するので採らない。
- **Status:** open

### F3 — Severity: Important

- **Location:** 設計 §9.2 / §10.9 / 現行 `e2e/fixtures/auth.ts` `loginAsNewUser` L318–321（成功後に **すでに** `${APP_ORIGIN}/planner` へ `goto`） / `e2e/fixtures/session-auth.ts` L20–26（`storageState` で context を開いた直後に `/planner`） / `e2e/specs/auth.setup.ts` L21–26（storageState **生産者**。dismiss キーを書いていない） / `playwright.config.ts` L47（`devices["iPhone SE"]`） / `e2e/specs/mobile-accessibility.spec.ts` L256（`getByRole("heading").first()`）
- **Description:** 既存 E2E を守る手段が `page.evaluate(setItem)` だけになっている。live tree では次が起きる。
  1. `loginAsNewUser` は setItem「成功後」より前に `/planner` を描画する。フラグを後から書いても、そのドキュメントの React state は dismissed のまま。
  2. `session-auth` の「storageState 利用前」に `evaluate` すると origin は `about:blank` で、アプリ origin の localStorage には入らない。`goto("/planner")` 後では初回描画にカードが出る。
  3. `auth.setup.ts` は仕様が触れていない第三経路で `e2e/.auth/user.json` を書く。ここにキーが無いと `reusedCompletedPage` は毎回カード付き `/planner` になる。
  4. mobile-chromium の UA は iPhone → §8.2 で `ios`。カードは AppShell の `Outlet` **直前**なので、DOM 先頭見出しが「ホーム画面に置く」になり、`heading.first()` や厳密件数の操作検査がカード理由で落ち得る。
- **Why it matters:** 受け入れ 9「既存 E2E がカード理由で赤くならない」が、仕様の snippet どおりでは成立しない。desktop project は `other` でカード無しだが、full の mobile 半面が回帰する。
- **Suggestion:** 注入を次に固定する（`evaluate` を正本にしない）。
  1. `loginAsNewUser`・`reusedCompletedPage`・その他アプリ origin を開く fixture は **`page.addInitScript`** でキー `"1"` を書く（ドキュメント作成前）。`auth.ts` L206 が禁じているのは session 手注入であり、本フラグとは別、と一文。
  2. `auth.setup.ts` は `storageState()` の前に同じキーを localStorage へ書き、保存済み state 自体を dismiss 済みにする。
  3. 対象は `loginAsNewUser` と session-auth だけでなく、magic-link 着地で `/planner` に出る経路（`auth.setup` / `requestMagicLinkAndReadUrl` 利用側）も含める。
  4. 本機能 E2E だけが addInitScript 無し（または明示削除）でカードを見る、と書く。
- **Status:** open

### F4 — Severity: Important

- **Location:** 設計 §6.1 `public/manifest.webmanifest` / 現行 `netlify.toml` `[[headers]]`（CSP 以外。`.webmanifest` の Content-Type なし） / `scripts/csp-headers.mjs` の `_headers` は CSP のみ
- **Description:** Netlify は `.webmanifest` を `application/octet-stream` で返すことがある（Netlify 公式フォーラムおよび vite-plugin-pwa の Netlify 手順が `Content-Type: application/manifest+json` を要求）。仕様は manifest ファイルと link タグだけを足し、MIME ヘッダを書いていない。
- **Why it matters:** Chrome のインストール基準（目的 1・受け入れ 1）が「manifest を解釈できない」で落ちる。`beforeinstallprompt` も出ない。iOS は apple-touch-icon / `apple-mobile-web-app-capable` 側で生き残るため、Android だけ静かに壊れる。
- **Suggestion:** `_headers` または `netlify.toml` に
  `/manifest.webmanifest` → `Content-Type: application/manifest+json`
  を必須化する（CSP は足さない。グローバル `[[headers]]` に CSP を戻さない契約は維持）。ファイル名を `manifest.json` に変えて `application/json` に乗せるなら、§6.1 / §6.2 のパスを両方直す。受け入れ 1 と手動確認に「応答の MIME が manifest+json または json」を足す。
- **Status:** open

### F5 — Severity: Important

- **Location:** 設計 §7.5「`tests/tooling` の既存 CSP テストを更新」 / 現行 `scripts/csp-headers.test.mjs` L42–43
  `assert.match(headers, /^\/\*\n {2}Content-Security-Policy: /u)`
- **Description:** `buildHeadersFileContent` の先頭に `/sw.js` ブロックを足すと、このテストは即死する。仕様が更新対象に挙げているのは `tests/tooling`（`project-config.test.mjs` は `CSP_STATIC_DIRECTIVES` と「グローバル CSP 無し」を見ており、先頭行は見ていない）。
- **Why it matters:** 実装者が §7.5 だけを追うと、tooling は緑・`node --test scripts/csp-headers.test.mjs` と本番 emit 契約が赤。ヘッダ純関数の正本テストを見落とす。
- **Suggestion:** §7.5 / §9.1 の更新対象に **`scripts/csp-headers.test.mjs` を名前で入れる**。先頭は `/sw.js` + `Cache-Control: no-cache`、その後の `/*` に既存 CSP、という exact 本文を固定する。`extractConnectSrc` が複数ブロックでも CSP 行を拾えることは現行実装で満たせるが、テスト側で回帰を残す。
- **Status:** open

### F6 — Severity: Important

- **Location:** 設計 §8.5 `src/features/pwa/use-android-install-prompt.ts` / §8.4 Android はイベント保持時だけ「インストールする」 / `src/main.tsx`（登録はここだが BIP は無い）
- **Description:** `beforeinstallprompt` は React フック mount より前に一度だけ飛ぶことが多い。仕様は「フックで listen + `preventDefault` + state 保持」「iOS / other では listen しない」だけである。検出（`detectInstallSurface`）も mount 後なので、Android 判定を待ってから listen するとイベントは既に終わっている。
- **Why it matters:** 本番 Android Chrome でボタンが恒常的に出ず、手順リストだけになる。§8.4 の主経路と §9.1「Android ボタンの出し分け」が、実装者の listen 位置次第で死ぬ。E2E は dev（SW 無し）なので「手順またはボタン」で緑になり、欠けに気づけない。
- **Suggestion:** `registerServiceWorker` と同じく `main.tsx`（PROD かつ `serviceWorker` がある環境）で **モジュール初期化時に** `beforeinstallprompt` を listen し、`preventDefault` したイベントをモジュール変数へ置く。フックはその保持を読むだけ。surface 判定で listen 自体を遅らせない（イベントは Chromium 以外では飛ばない）。テストはモジュールの reset / inject API を公開して書く。
- **Status:** open

---

### F7 — Severity: Minor

- **Location:** 設計 §7.1 手順 3 `CACHE_NAME` = SHA-256(PRECACHE_URLS を `\n` 結合) / §7.2 収集順未定義
- **Description:** 同一ファイル集合でも Object 走査順や `/index.html`・icons の push 順でハッシュが変わる。`Date.now()` 禁止の意図（同一入力なら同一名）が、入力の正規化無しでは満たせない。
- **Suggestion:** PRECACHE_URLS を URL 文字列の UTF-8 昇順で一意化してからハッシュする、と §7.1 に書く。
- **Status:** open

### F8 — Severity: Minor

- **Location:** 設計 §8.7 / 現行 `src/features/household/household-settings-page.test.tsx` L57–66（`PlanSettingsSection` と `ShareConsentSettingsSection` を mock。Account は依存だけ mock）
- **Description:** 常設セクションを両分岐にそのまま置くと、家族 CRUD の巨大テストが `matchMedia` / UA / 手順コピーに依存する。他セクションは「専用テストへ隔離」している。
- **Suggestion:** 実装順 2 に `HomeScreenInstallSection` を同ファイルで mock する（または Account 同様に window 非依存の純関数へ閉じる）と書く。
- **Status:** open

### F9 — Severity: Minor

- **Location:** 設計 §8.2 / §8.4 iOS 手順 / §9.1「CriOS は ios」
- **Description:** iPhone + CriOS / FxiOS は `ios` になり、Safari の共有シート手順が出る。iOS でホーム画面追加できるのは Safari（と一部システム UI）に限られることが多く、Chrome 内の共有には「ホーム画面に追加」が無い。
- **Suggestion:** 残差 §2.3 に「CriOS / FxiOS では Safari で開き直す旨を出さない。Safari 手順のまま」と明示するか、iOS 非 Safari だけ 1 行足す（「Safari でこのページを開いてから…」）。出し分けを増やすなら §8.4 の固定文言表を更新する。
- **Status:** open

### F10 — Severity: Minor

- **Location:** 設計 §8.4「共通見出し」タグ未指定 / §8.6 `aria-labelledby` / `src/app/layouts/app-shell.tsx` L169–218（`main h1` へフォーカス） / `e2e/specs/mobile-accessibility.spec.ts` L256
- **Description:** 見出しレベルが無い。カードを `h1` にすると 1 面 2 つの `h1`。`h2` でも Outlet より前なので、dismiss 漏れ時に `heading.first()` がカードになる。フォーカスは既存どおり `main h1` なので SR はカードを読み飛ばし得る（仕様はカードへフォーカスしない）。
- **Suggestion:** カード見出しは **`h2`** と固定。設定の `h2`「ホーム画面に追加」と文言が違うので、テストは exact name で取る。SR に一度知らせるなら `aria-live="polite"` を残差または採用として一文。
- **Status:** open

### F11 — Severity: Minor

- **Location:** 設計 §8.2 実装コード / §9.1「Android / Linux armv は android」
- **Description:** §8.2 は `/Android/iu` だけ。Linux armv で Android を含まない UA は `other`。§9.1 の表と関数が矛盾する。
- **Suggestion:** テスト表を「`Android` を含む UA は android」に合わせる。Linux armv を android にしたいなら §8.2 に条件を足す（デスクトップ Linux を誤爆しない文言で）。
- **Status:** open

### F12 — Severity: Minor

- **Location:** 設計 §7.3 手順 3 `/auth/callback` は末尾スラッシュなし exact / 現行 `src/features/auth/auth-callback-url-capture.ts` L58 は `/auth/callback/` も callback 扱い
- **Description:** `/auth/callback/` は SW では navigate 扱いになり、通信断ではシェル HTML が返る。コード自体は URL に残るので strip は動き得るが、「callback は横取りしない」の文言と capturer の path 集合がずれる。
- **Suggestion:** pathname 判定を capturer に揃え、`/auth/callback` と `/auth/callback/` の両方を passthrough（シェルフォールバック無し）にする。
- **Status:** open

---

## 良い点（維持）

- Workbox / `generateSW` を使わず許可リスト + 実行時 `cache.put` 禁止。API JSON・Supabase・localStorage 複製を Cache Storage に載せない、は本リポジトリのプライバシー方針と一致する。
- `/api` exact と `/api/` 前方、`/auth/callback` を navigate フォールバックより前に return する順序は正しい。他 origin（managed Supabase / Stripe）は origin 不一致で自然に外れる。
- `skipWaiting` / `clients.claim` なし、更新バナーなし、は AppShell の料理中フォーカス契約（`main h1`、dialog 中は奪わない）と矛盾しない。
- 案内キーを owned 掃除プレフィックスの外に置く判断は `auth-cleanup.ts` と一致する。`kondate.auth.*` に置くと soft residual / logout で消える。
- 設定は空家族・家族ありの両方、という指示は `AccountSettingsSection` の現行パターンそのもの。
- `import.meta.env.PROD` 以外で SW を登録しないのは、Vite dev + HMR と E2E（`tools` 経由の dev、SW 非対象）を壊さない。
- CSP に `worker-src` / `unsafe-inline` / `blob:` / CDN を足さない判断は `CSP_STATIC_DIRECTIVES` 契約と一致する。同一オリジンの `/sw.js` は `default-src 'self'` + `script-src 'self'` で足りる。
- `netlify.toml` の `/* → index.html` は実ファイル優先なので、`sw.js` / manifest / icons が dist にあれば SPA fallback に食われない、という現状認識は正しい。

---

## 残差として受容してよいもの（設計 §2.3 どおり）

- iOS ホーム画面アプリのストレージ分離による再ログイン。
- standalone 内 Google / マジックリンクが Safari・メールに出ること（continuation 既存）。ログイン面に案内を出さない判断は `/login` が AppShell 外である現行 router と一致。
- デプロイ直後 1 回は旧シェル。
- 通信断はシェルのみ、データは既存エラー UI。オフライン専用面は作らない。
- デスクトップ初回カードなし（設定の other 1 節のみ）。Playwright desktop-chromium はカード無しなので、fixture dismiss の主対象は mobile。
