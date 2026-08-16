# 敵対的レビュー: PWA インストール可能アプリシェル Implementation Plan

- **役割:** 独立 adversarial reviewer（実装・設計改訂の著者ではない。コンテキスト非共有）
- **日付:** 2026-08-16
- **対象 plan:** [`docs/superpowers/plans/2026-08-16-pwa-installable-app-shell.md`](../plans/2026-08-16-pwa-installable-app-shell.md)
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)（レビュー MF 反映済み）
- **照合 spec reviews:** [`2026-08-16-pwa-installable-app-shell-secondary.md`](./2026-08-16-pwa-installable-app-shell-secondary.md)（MF-I1…I9 が plan に落ちていること）
- **照合 live tree:**
  `e2e/fixtures/auth.ts` / `e2e/fixtures/session-auth.ts` / `e2e/fixtures/seed-onboarding.ts` /
  `e2e/specs/auth.setup.ts` / `e2e/specs/oauth-mock.spec.ts` / `e2e/specs/auth-recovery.spec.ts` /
  `e2e/specs/mobile-accessibility.spec.ts` / `e2e/specs/settings.spec.ts` / `playwright.config.ts` /
  `src/main.tsx` / `src/app/router.tsx` / `src/app/layouts/app-shell.tsx` /
  `src/features/household/household-settings-page.tsx` / `src/features/auth/auth-cleanup.ts` /
  `src/features/auth/auth-callback-url-capture.ts` / `src/styles.css` / `vite.config.ts` /
  `tsconfig.app.json` / `scripts/csp-headers.mjs` / `scripts/csp-headers.test.mjs` /
  `tests/tooling/project-config.test.mjs` / `netlify.toml`
- **攻撃焦点（指示）:** plan が spec と矛盾する、spec レビューの must-fix が plan に落ちていない、E2E がまだ壊れる、SW が API をキャッシュする、フォントが Precache に戻る、`skipWaiting` が現れる、Auth ロック再定義、CSP 緩和、BIP がまだ遅い、`/index.html` 301、グローバル `caches.match`、`evaluate` を `addInitScript` の代わりに使う
- **姿勢:** 実装者は plan を文字どおり守り、趣味は悪い。snippet に無い防御は書かない。テストが弱い箇所は最短の GREEN を取る。
- **編集:** なし（本ファイルのみ成果物。spec / plan 不変）

---

## Summary

改訂 spec（シェル `/`、フォント非 Precache、自 `CACHE_NAME`、BIP を `main.tsx`、E2E は `addInitScript`）を Task に割った骨格は読める。Global Constraints は `skipWaiting` / `clients.claim` / 実行時 `cache.put` / グローバル `caches.match` / Auth ロック再定義 / `CSP_STATIC_DIRECTIVES` token 追加を禁止しており、Task 4 の SW snippet もその禁止をコードとして固定している。

一方、**plan 本文が spec / MF を自分で破る箇所**と、**「Spec を見よ」だけでテスト契約が空の箇所**が残る。文字どおり実装すると次が起きる。

1. **E2E 既定 dismiss がまだ閉じない（MF-I3）。** Task 2 は `auth.setup.ts` の正本を `page.evaluate` と明記する。`loginAsNewUser` への `addInitScript` は `/planner` 直前だけ。`auth-recovery` / `requestMagicLinkAndReadUrl` 利用側 / `completedOnboardingPage` は Files に無い。Task 5 は新規 spec と `settings.spec.ts` 1 本だけ回すので、残った赤も `heading.first()` の false-green も見ない。
2. **本機能 E2E が自前の seed と衝突する。** `loginAsNewUser` が常時 dismiss するのに、`pwa-install-tip.spec.ts` は「addInitScript 無しの page でログイン」とだけ書く。経路を固定していない。
3. **SW の静的分岐が許可リストを見ない。** snippet は全 same-origin GET を `cache-first` し、`PRECACHE_URLS` 所属判定が無い。generator テストは `.woff` / `src` / `imports` / manifest キー `/index.html` / `/api` を固定しない。
4. **MF-I4 の「200 かつ非 redirect」が dist 存在チェックに退行する。** 二次が「dist だけでは不可」と書いた穴が、plan Task 4 Step 5 そのものである。
5. **MF-I6 の `/` 内容ハッシュがファイル対応を欠く。** `/` を `dist/index.html` に写す一文が無い。HTML を変えても `CACHE_NAME` が不動になり得る。

`skipWaiting` 出現・Auth ロック再定義・CSP token 追加・グローバル `caches.match` は、snippet と既存 tooling テストを文字どおり守る限り **正面からは成立しない**。blast は「既存 mobile E2E がカードで赤 / 本機能 E2E が空振り / 本番 `addAll` 失敗 / 更新してもシェル HTML が古い / フォント 121 枚で install 原子失敗」であり、Cache Storage へのアレルギー JSON や認可 code の正面混入ではない。

**総合判定: `BLOCK_WITH_CONDITIONS`**

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`BLOCK_WITH_CONDITIONS`** |
| **Critical** | **0** |
| **Important** | **7** |
| **Minor（参考）** | 4 |
| **解除後** | 下記 must-fix を plan 本文（Task 2/4 の Files・テスト契約・snippet）へ固定すれば **PROCEED_WITH_RESIDUALS**（standalone OAuth / iOS ストレージ分離 / 通信断はシェルのみ / 実 SW は CI 外 — spec §2.3） |

---

## Attack table

| # | 攻撃シナリオ | 判定 | 根拠（plan × spec × live） |
| --- | --- | --- | --- |
| A1 | `page.evaluate(setItem)` を正本にして、ドキュメント作成後にキーを書く | **成立（plan 文面）** | spec §9.2 / MF-I3: 「`page.evaluate(setItem)` を正本にしない」。plan Task 2 Step 3: `auth.setup.ts` は planner 着地後・`storageState()` 前に **`page.evaluate` でキー `"1"`**。着地時点の `/planner` は iPhone SE（`playwright.config.ts` L46–47）でカード描画済み。 |
| A2 | `loginAsNewUser` の addInitScript が L206 と衝突し、実装者が evaluate に逃げる | **成立しうる** | live `e2e/fixtures/auth.ts` L206: 「addInitScript による事前 session 手注入は行わない」。spec は「L206 は session 手注入であり本フラグとは別」と書く。**plan にその一文が無い。** 趣味の悪い実装者は L206 を尊重して evaluate する。 |
| A3 | `loginAsNewUser` 以外の planner 着地でカードが出て既存 E2E が赤 / 見出し契約が空振り | **成立** | spec §9.2 は `completedOnboardingPage` / seed 再訪 / `requestMagicLinkAndReadUrl` 利用側 / raw OAuth を列挙。plan Files が明示するのは `auth.ts` / `auth.setup.ts` / `session-auth.ts` / `oauth-mock.spec.ts` だけ。live: `auth-recovery.spec.ts` は fixture `page` で Mailpit ログインし `context.newPage()` が `/planner` に落ちる（L8–18）。`seed-onboarding.ts` L95 の再訪は Files に無い。 |
| A4 | 本機能 E2E が常時 seed された `loginAsNewUser` を使い、カードを一度も見ない | **成立（plan 内矛盾）** | Task 2 は `loginAsNewUser` に seed を常時足す。同じ Task の `pwa-install-tip.spec.ts` は「`addInitScript` を付けない page でログイン」。ログイン関数・明示削除・raw 経路のどれかが未固定。 |
| A5 | Task 5 が新規 spec + `settings.spec.ts` 1 本だけ回し、残った赤を「検証済み」にする | **成立** | plan Task 5 Step 2。acceptance 9 / MF-I3 の `heading.first()` 契約（`mobile-accessibility.spec.ts` L256）は回さない。`heading.first()` はカード `h2` でも visible のため **false-green**。 |
| A6 | SW が `/api/*` や `/auth/callback` を横取りし、失敗時にシェルを返す / 静的 cache-first に載せる | **部分成立** | spec §7.3 手順 3 が先。plan は「手順 1–5 の判定だけ」と書くが、RED 例は `mode:"navigate"` 付きの `/api` / `/auth/callback` を持たない。実装者が navigate を先に見ると callback 文書ナビが `respondWith` される。静的 snippet は許可リスト非所属でも `cache.match` する。 |
| A7 | fontsource 121 スライスが Precache に入り `addAll` が原子失敗する | **成立しうる** | live `src/styles.css` L12–14。Vite manifest の CSS `assets[]` は `.woff2`。spec §7.2 は `file`+`css[]`+`assets[]` の **`.js`/`.css` だけ**。plan テストは「webp/woff2 を含まない」だけで **`.woff` / `src` / `imports` / `dynamicImports` / manifest キーを URL 化しない**を固定しない。 |
| A8 | `/index.html` を Precache し、Netlify Pretty URLs の 301 で `addAll` が毎回失敗する | **成立しうる** | spec / MF-I4 はシェル `/`、`/index.html` 禁止。plan テストは「`/index.html` を含まない」。趣味の悪い収集は manifest キー `index.html` を `/${key}` する。MF-I4.2 の「各 URL が 200 かつ非 redirect」は plan に無く、Task 4 Step 5 は **dist 存在**だけ。 |
| A9 | 非ハッシュ `/` の中身が `CACHE_NAME` に入らず、HTML 更新が SW 更新にならない | **成立しうる** | spec §7.1.4 / MF-I6。`/` はファイルではない。plan は「非ハッシュファイル内容を変えると CACHE_NAME が変わる」とだけ書き、**`/` → `dist/index.html`** を固定しない。実装者は `/` をスキップするか空ハッシュにする。 |
| A10 | 旧 SW 制御中の `addAll(["/"])` が旧 cache-first に食われ、新キャッシュへ旧 HTML が入る | **成立しうる** | plan snippet は GET `/`（非 navigate）を cache-first。更新 install の `addAll("/")` は controlling SW の fetch を通る。hashed JS は URL が変わるので助かる。`/` は安定 URL。オンラインナビは network-first なので本体は死なないが、オフラインフォールバックは更新後に旧 HTML×消えた旧ハッシュになる。 |
| A11 | `skipWaiting` / `clients.claim` を足して料理中に画面を奪う | **反証（snippet + grep）** | Global Constraints と Task 4 snippet / Step 5 の `rg`。文字どおりなら呼ばない。 |
| A12 | グローバル `caches.match(SHELL)` で waiting 中の他シェルと混ぜる | **反証（snippet + 文字列禁止）** | spec §4.11 / MF-I5。plan snippet は `caches.open(CACHE_NAME)` 配下の `cache.match`。`caches.match(` を置くなと明記。 |
| A13 | Auth ロック export / `ownedAuthStoragePrefixes` を再定義し、案内キーを logout で消す | **概ね反証** | Files は `auth-cleanup.test.ts` のみ。キーは `kondate:preferences:`。owned に足すなと明記。趣味で `AuthProvider` に状態を吸い上げる経路は plan が開いていない（実装逸脱）。 |
| A14 | `CSP_STATIC_DIRECTIVES` に `unsafe-inline` / `blob:` / `worker-src` を足す | **概ね反証・テスト穴あり** | plan は token を足すな・CSP 文字列は変えるな。live `project-config.test.mjs` L389–393 が定数末尾 `script-src 'self'` を固定。`buildContentSecurityPolicy` への **追記**は Task 3 の prefix 正規表現では落ちない。 |
| A15 | BIP をカード `useEffect` / surface 判定後に listen し、Android 主経路を取りこぼす | **部分成立** | spec §8.5 / MF-I8。plan は `main.tsx` で `createRoot` 前に `listen` を呼ぶ。一方カード実装段落（Task 2 Step 3）は `peekAndroidInstallPrompt` に触れない。テスト RED を省略して実装段落だけなぞると、手順リストのみ / 遅延 listen になる。 |
| A16 | 実行時 `cache.put` で使ったフォント切片や GET `/api` を Cache Storage に残す | **snippet 上は反証** | 静的ミスは `fetch(request)` のみ。`cache.put` 禁止。generator が許可リストを漏らした場合のみ A6/A7 経由で install 時に載る。 |

---

## Findings

### Critical

なし。plan の SW snippet を守る限り、API JSON / `?code=` / アレルギー自由記述を Cache Storage へ `put` する正面経路は無い。CSP 定数・Auth ロック Files も触らない。blast はシェル不全と E2E 回帰である。

---

### Important

#### I1. E2E 既定 dismiss が MF-I3 を満たさない — `evaluate` が正本のまま、列挙が欠け、検証が狭い

- **信頼度:** 94
- **箇所:** plan Task 2 Step 3 / Files; Task 5 Step 2
  spec §9.2 / MF-I3; live `auth.ts` L206–322、`auth.setup.ts` L13–26、`session-auth.ts` L20–26、`auth-recovery.spec.ts` L8–38、`seed-onboarding.ts` L94–100、`mobile-accessibility.spec.ts` L256
- **説明:**
  - spec は `evaluate` 禁止、`loginAsNewUser` / seed 再訪 / `auth.setup` / `session-auth` / magic-link 利用側 / raw planner 着地を **ドキュメント作成前**の `addInitScript`（または保存済み state 自体）で閉じる。
  - plan は `auth.setup.ts` に **着地後 `page.evaluate`** を第一手段として書く。addInitScript は「加えて」であり、正本ではない。
  - `loginAsNewUser` への seed は session `evaluate` のあと・`goto("/planner")` の前。これ自体は次ナビには効くが、plan は L206 注記を再掲しない。
  - Files に `auth-recovery.spec.ts` / `seed-onboarding.ts` / `completedOnboardingPage` / `ideaModePage` が無い。`oauth-mock.spec.ts`「等」は趣味に任せる。
  - helper を `page.addInitScript` だけにすると、同一 context の `newPage()` は script を継承しない（共有 localStorage に既に `"1"` がある場合だけ助かる。`auth-recovery` の callback タブは Mailpit 経路で **先に key が無い**）。
  - Task 5 は `pwa-install-tip.spec.ts` と `settings.spec.ts` 1 本。acceptance 9 の `heading.first()` 非侵食は、既存 assert が「visible だけ」なのでカード `h2` でも GREEN になる。
- **修正要求（BLOCK 解除必須）:**
  1. `evaluate` を正本として書く文を削除する。`auth.setup.ts` も **最初の `goto` より前**に `context.addInitScript`（または page）し、`storageState()` はその結果を保存するだけにする。
  2. spec §9.2 の経路を Files に名前で固定する: `loginAsNewUser` / `completedOnboardingPage` / `seedCompletedOnboardingState` / `auth.setup.ts` / `session-auth.ts` / `requestMagicLinkAndReadUrl` 利用側（少なくとも `auth-recovery.spec.ts`）/ `oauth-mock.spec.ts`。
  3. helper は **context 優先**。`page` だけに足して `newPage()` を漏らさない。
  4. `auth.ts` L206 は session 手注入だけが禁止、と plan 本文に書く。
  5. 既存契約の確認に `mobile-accessibility.spec.ts` の history `heading.first()` を「カード `h2` ではない」まで落とすか、Task 5 の必須に入れる。

#### I2. 本機能 E2E が常時 seed と両立しない

- **信頼度:** 91
- **箇所:** plan Task 2 Step 3（`loginAsNewUser` seed と `pwa-install-tip.spec.ts`「付けない page でログイン」）
  spec §9.2「本機能 E2E だけが addInitScript 無し（または明示削除）」
- **説明:** 実装者が `loginAsNewUser` に無条件 seed を入れたあと、同じ関数で案内 E2E を書くとカードは出ない。assert を緩めて GREEN にするか、seed を外せず skip する。plan は raw login / フラグ削除 / 別 fixture のどれかを選んでいない。
- **修正要求:** `pwa-install-tip.spec.ts` のログイン経路を exact に書く。推奨: auth fixture を使わず raw `page` + 明示ログイン、**または** `loginAsNewUser` 後に key を消して **reload 前に** `addInitScript` を外した context で開き直す。`loginAsNewUser` に任意引数で seed を切るなら、既存 fixture の既定は seed ありのままにする。

#### I3. 静的 fetch が許可リストを見ない — API / 非 Precache が cache-first に落ち得る

- **信頼度:** 90
- **箇所:** plan Task 4 Interfaces / snippet L376–403 / RED L332
  spec §7.3 手順 5「pathname が `PRECACHE_URLS` の pathname 集合に含まれるときだけヒット」
- **説明:**
  - `decideServiceWorkerFetch` は PRECACHE 集合を受け取らない。RED は GET `/assets/index-abc.js` → `cache-first-precache` だけ。
  - snippet の最終分岐は `cache.match(event.request)` のあと無条件にヒットを返す。所属判定が無い。
  - RED は `mode:"navigate"` の `/api/*` と `/auth/callback` を passthrough に固定しない。手順 4 を手順 3 より先に書くと、callback 文書ナビが `respondWith(fetch().catch(shell))` になる（spec: これらの path にはシェルフォールバックを適用しない）。
  - generator が `/api` やフォントを漏らすと、install の `addAll` がその URL を Cache Storage に載せる。実行時 `put` 無しでも **install 時キャッシュ**になる。
- **修正要求:**
  1. 純関数または SW 本体で **pathname ∈ PRECACHE pathname 集合**のときだけヒットを返す。非所属は `fetch`、`put` なし。
  2. RED に `mode:"navigate"` + `/api/usage-today` / `/auth/callback` / `/auth/callback/` → **passthrough**（`respondWith` しない）を必須化する。
  3. generator テストに `/api` 非含有を追加する。

#### I4. フォント / 収集が MF-I2 の機械契約になっていない

- **信頼度:** 88
- **箇所:** plan Task 4 Step 1「webp/woff2 を含まない」; Step 3「Spec §7.1–7.2」
  spec §7.2; live `src/styles.css` L12–22（121 分割 × 3 ファミリー）
- **説明:** 二次 MF-I2 は収集を `file`+`css[]`+`assets[]`、拡張子 `.js`/`.css`、`src`/`imports`/`dynamicImports` 見ない、UTF-8 昇順一意、に閉じた。plan は本文参照と「woff2 を含まない」だけ。趣味の悪い収集は (a) manifest キーを URL 化する（`/index.html` → A8）、(b) `assets[]` を拡張子フィルタせず入れる、(c) `.woff` だけ残す、(d) `imports` を辿る。テスト fixture が top-level の woff2 1 個だけだと GREEN のまま 121 枚が本番 `addAll` に入る。
- **修正要求:** generator テストの入力 manifest を **本物に寄せる**（entry の `file`/`css`/`assets` に js/css/woff2/woff/webp、別キー `index.html`、`imports`/`dynamicImports`）。期待は `.js`/`.css` と固定 URL（`/`・manifest・icons）のみ。`.woff` / `.woff2` / `.webp` / `/index.html` / `/api` は assert で排除。

#### I5. MF-I4 のホスト契約が dist 存在チェックに退行する（`/index.html` 301 が再燃する）

- **信頼度:** 89
- **箇所:** plan Task 4 Step 5; Task 3 は MIME のみ
  spec §7.2 / §9.3 / §10.1 / MF-I4.2「dist 存在チェックだけでは不可」; live `netlify.toml` L34–37（`/* → index.html` 200）に `pretty_urls = false` 無し
- **説明:** 改訂 spec はシェルを `/` にして Pretty URLs 301 を避ける判断を既に選んだ。plan も `/` 必須・`/index.html` 禁止と書く。しかし二次が BLOCK 理由にした **実行時 200 非 redirect** は、手動 §9.3 にも plan Task にも落ちていない。I4 の収集漏れで `/index.html` が再入場すると、本番 `addAll` は redirect で reject、install は静かに失敗する。受け入れ 1 の dist チェックは GREEN のまま。
- **修正要求:** generator または Task 4/5 の受け入れに「Precache 各 URL の path は `/index.html` を含まない。`/` は rewrite 200 を前提とし、リストに `/index.html` が無いことをテストで固定」を書く。可能なら fixture で「収集結果に redirect 候補の `/index.html` が無い」を機械化する（本番 HTTP まで CI に入れなくてよいが、**リスト契約は CI**）。

#### I6. `/` の内容ハッシュ対応が無く、MF-I6 が空振りする

- **信頼度:** 87
- **箇所:** plan Task 4 Step 1「非ハッシュファイル内容を変えると CACHE_NAME が変わる」
  spec §7.1 手順 4（非ハッシュ = `/` / manifest / icons）
- **説明:** `/` は `dist/` ディレクトリであり、中身は `dist/index.html`。写像を書かない実装者は `/` をハッシュ対象から外す。icons / manifest だけ変えるテストで GREEN にできる。`index.html` の script 参照が変わっても `sw.js` バイトが一致し、ブラウザは更新を検知しない。A10 と重なる。
- **修正要求:** 「`/` の内容は `dist/index.html` のバイト」を generator 仕様とテストに exact 記載。`index.html` 1 バイト変更で `CACHE_NAME` が変わること、`Date.now()` / 乱数禁止を assert。

#### I7. BIP 保持がカード実装段落から落ちている（遅延 listen の再燃口）

- **信頼度:** 84
- **箇所:** plan Task 2 Step 3 カード段落; Interfaces の `peek` / `inject`
  spec §8.5 / MF-I8
- **説明:** `main.tsx` の早期 listen 自体は spec どおり。しかしカード実装は session / location / matchMedia / surface / storage だけを列挙し、**`peekAndroidInstallPrompt()` で「インストールする」を出す**と書かない。設定の BIP ボタンは spec も「出してよい」。RED を省略した実装者は (a) カード `useEffect` で listen する、(b) `surface === "android"` になってから listen する、(c) 手順リストだけ出す。A15。
- **修正要求:** カード（と出すなら設定）の実装段落に `peek` を必須化。`listenForAndroidInstallPrompt` は surface 分岐禁止、`main.tsx` の `createRoot` より前だけ、と再掲。ユニットは inject 後にボタンがあり手順リストが無いことを既に書く — それを実装必須と明示する。

---

### Minor（参考）

#### M1. `src/pwa` の型 / `tsconfig.app.json` 除外が plan に無い

- **信頼度:** 78
- live `tsconfig.app.json` は `lib`: DOM のみ、`include`: `src`。`FetchEvent` は通ることが多いが、趣味の悪い修正は `src/pwa` を外すか `any` キャストする。spec MF-I1 は「外すなら generator 側で型を見る」。plan は禁止も代替も書かない。

#### M2. 設定マウント行番号が 1 行ずれている

- **信頼度:** 74
- plan: 空家族 L1556 前 / 家族あり L2286 前。live は `PlanSettingsSection` が L1557 / L2287。探索は可能。読込中 early return（L1501、L1527）に置かない方針は plan にあり、spec §2.3 残差と一致。

#### M3. AppShell テストの storage mock が任意

- **信頼度:** 72
- live `app-shell.test.tsx` は未ログインなのでカードは出ない（資格 1 が false）。session 付きテストを後から足すと突然 `h2` が増える。任意のまま残差。

#### M4. 旧 SW の `addAll("/")` 自己中毒（A10）は spec も未閉鎖

- **信頼度:** 76
- plan 固有の矛盾というより改訂 spec の更新モデル残差。plan が閉じないなら §2.3 に「更新直後のオフラインシェルは旧 HTML になり得る」を残差として計画側でも指示すべき。

---

## Refuted attacks（成立しない / snippet で潰されている）

| 攻撃 | 結論 |
| --- | --- |
| `skipWaiting` / `clients.claim` を snippet に書く | Task 4 コードと Step 5 `rg` で反証。 |
| グローバル `caches.match(` | 禁止文 + snippet は `cache.match`。 |
| 実行時 `cache.put` で API / フォント切片を足す | snippet に `put` 無し。 |
| `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` の再定義 | Files 外。案内キーは preferences。 |
| `kondate.auth.*` に案内キーを置く | キー定数が `kondate:preferences:pwa-install-tip-dismissed`。 |
| logout で案内キーを owned 掃除に足す | Task 1 が明示的に禁止 + cleanup テストは残す側。 |
| `CSP_STATIC_DIRECTIVES` へ `unsafe-inline` / CDN | 既存 `project-config` が定数を固定。plan は変えるなと書く。 |
| `vite-plugin-pwa` / Workbox | Global Constraints。 |
| 開発サーバで SW 登録 | spec §7.4 をそのまま。 |
| シェルを `/index.html` に戻す（テストを書いた場合） | テスト名としては禁止。収集実装が漏れる場合は I4/I5。 |

---

## BLOCK 解除チェックリスト（plan 改訂必須）

- [ ] **I1:** `evaluate` を正本から削除。§9.2 経路を Files に名前で固定。helper は context 優先。L206 注記を plan に書く。`heading.first()` 非侵食を検証対象にする。
- [ ] **I2:** `pwa-install-tip.spec.ts` のログイン経路（seed 無し or 明示削除）を exact 記載。
- [ ] **I3:** 静的ヒットは PRECACHE 所属のみ。navigate + `/api` + `/auth/callback(/)` の passthrough を RED に固定。generator は `/api` 非含有。
- [ ] **I4:** 収集テストを manifest 実形（`assets[]` の woff2、`index.html` キー、`imports`）に寄せ、`.js`/`.css` + 固定 URL 以外を排除。
- [ ] **I5:** Precache リストに `/index.html` が無いことを CI 契約にする。dist 存在だけを受け入れにしない。
- [ ] **I6:** `/` の内容ハッシュ = `dist/index.html` をテスト固定。
- [ ] **I7:** カード実装に `peek` 必須。listen の唯一の呼び出し点は `main.tsx` 初期化。

すべて反映後は **PROCEED_WITH_RESIDUALS**（§2.3 の standalone / 通信断 / 実機 SW / CriOS 手順 / DEV 残存 SW 解除なし / A10 のオフライン旧シェル）。

---

## Spec ↔ plan カバレッジ（敵対視点）

| Spec / MF | plan | 敵対評価 |
| --- | --- | --- |
| MF-I1 `build.manifest` + `sw-defines.d.ts` | Task 4 `config()` + 型ファイル | 方向充足。`src/pwa` 除外禁止が弱い（M1） |
| MF-I2 収集 + フォント除外 | 「Spec §7.1–7.2」+ woff2 テスト | **テストが機械契約になっていない（I4）** |
| MF-I3 E2E `addInitScript` | Task 2 helper + 一部 fixture | **`evaluate` 正本・列挙欠け・検証狭い（I1/I2）** |
| MF-I4 200 非 redirect / MIME / JS MIME | Task 3 MIME; シェル `/` | MIME は充足。**200 非 redirect が dist チェックに退行（I5）** |
| MF-I5 自 `CACHE_NAME` / callback 末尾 `/` | snippet + `isAuthCallbackPath` | 自キャッシュは充足。**所属判定と navigate+API RED が欠け（I3）** |
| MF-I6 非ハッシュ内容ハッシュ | 「内容を変えると名が変わる」 | **`/` → `index.html` 写像が無い（I6）** |
| MF-I7 `_headers` テスト先頭 `/sw.js` | Task 3 exact prefix | 構造は充足。builder 追記の CSP は既存定数テスト依存 |
| MF-I8 BIP モジュール初期化 | `main.tsx` + inject API | 呼び出し点は充足。**カード配線が段落から落ちた（I7）** |
| MF-I9 案内残差 | 実装しない判断 | spec §2.3 に既にある。plan 非対象で可 |
| §4.9 `skipWaiting` 禁止 | Constraints + snippet + `rg` | 充足 |
| §4.6 Auth 非再定義 | Constraints + Files | 充足 |
| §4.5 CSP 非緩和 | Constraints + Task 3「文字列は変えない」 | 概ね充足 |

---

## メタ

- レビュー種別: **implementation plan** に対する敵対的レビュー（実装コード・spec・plan 本文の変更なし）
- 成果物: 本ファイルのみ
- 総合: **`BLOCK_WITH_CONDITIONS`** / Critical **0** / Important **7**
