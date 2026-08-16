# 敵対的レビュー: PWA インストール可能アプリシェル設計

**対象:**
[`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)

**照合ソース（実装・契約を正）:**
- `index.html` / `vite.config.ts` / `netlify.toml`
- `scripts/csp-headers.mjs` / `scripts/emit-deploy-headers.mjs` / `tests/tooling/project-config.test.mjs`
- `src/main.tsx` / `src/app/router.tsx` / `src/app/layouts/app-shell.tsx`
- `src/features/auth/auth-cleanup.ts` / `src/features/auth/auth-flow.ts` / `src/features/auth/auth-callback-url-capture.ts` / `src/features/auth/protected-routes.tsx`
- `src/features/household/household-settings-page.tsx` / `src/features/landing/root-entry-page.tsx`
- `e2e/fixtures/auth.ts` / `e2e/fixtures/session-auth.ts` / `e2e/specs/auth.setup.ts` / `e2e/specs/oauth-mock.spec.ts` / `e2e/specs/mobile-accessibility.spec.ts` / `playwright.config.ts` / `tools/run-e2e-app.mjs`
- `package.json`（`build` = `tsc -b && vite build`、E2E は Vite dev）

**敵対姿勢:** ship バイアス。許可リスト SW と「データはキャッシュしない」宣言を信じず、Cache Storage への認可 code / API / アレルギー混入、CSP 迂回、scope 乗っ取り、stale-shell×新ハッシュ、Netlify `/* → index.html` が `sw.js` を食う経路、更新永久待ち、案内の常時表示/非表示、ログアウト誤消去、E2E fixture 穴を優先して突く。仕様と live tree 以外は開かない。編集は本レビューファイルのみ。
**レビュー日:** 2026-08-16

---

## Summary

骨格は防御的である。実行時 `cache.put` 禁止、`/api/*` と `/auth/callback` の非介入、HTML の URL 単位保存禁止、CSP token 追加禁止、Auth ロック非再定義、案内キーを owned 掃除の外に置く、DEV で SW 非登録、はいずれも現行 tree（`script-src 'self'`、`isOwnedBrowserStorageKey` が `kondate:preferences` を触らない、E2E が Vite dev、callback は `main.tsx` で最短 strip）と噛み合う。アレルギーや API JSON が Cache Storage に載る正面突破は、設計どおり実装されれば成立しない。

一方、本番ホストと更新モデルに **仕様が自分で作った穴** がある。

1. **`PRECACHE` が `/index.html` 必須**なのに、Netlify 既定 Pretty URLs は `/index.html` → `/` の 301 を出し得る。Cache API の `addAll` は redirect で reject する。install が毎回失敗し、シェル高速化が本番で死ぬ。`netlify.toml` に pretty URLs 無効化も `SHELL_URL=/` も無い。
2. **ナビ失敗フォールバックが `caches.match(SHELL_URL)`（全 Cache Storage 検索）**。`skipWaiting` / `clients.claim` を禁じた結果、waiting 中は新旧 `kondate-shell-*` が共存し、新 `index.html` × 旧ハッシュ JS の mix が仕様文面どおりに起きる。
3. **`CACHE_NAME` が URL リストの SHA だけ**。非ハッシュの `index.html` / icons の中身が変わっても `sw.js` がバイト一致し、ブラウザは更新を検知しない。「次に開いたら新しい版」と矛盾する。
4. **E2E 既定 dismiss の挿し方が不足**。`loginAsNewUser` は成功経路の最後に `/planner` へ着地し、`auth.setup` は `loginAsNewUser` を使わず、`oauth-mock.spec.ts` は raw Playwright のまま planner に落ち得る。仕様の `page.evaluate(setItem)` は about:blank では動かず、`goto` 後ではカードが既に描画される。`mobile-chromium` は `devices["iPhone SE"]`。カード見出しが Outlet より前に出ると heading-order / first-heading 系が侵される。

PII 流出や CSP 緩和、Auth ロック破壊までは設計は届いていない。よって Critical は付けない。ただし 1–4 を仕様で閉じるまで実装に入ると、本番 SW が死ぬか、更新が混ざるか、既存 E2E がカード理由で赤くなる。

**総合判定: `BLOCK_WITH_CONDITIONS`**

条件充足後は `PROCEED_WITH_RESIDUALS`（standalone OAuth / iOS ストレージ分離 / 通信断はシェルのみ / デスクトップ初回カードなし / 実 SW は E2E 外 — いずれも §2.3 の意図的残差）。

---

## Attack scenarios

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | 実行時に API / 献立 JSON を Cache Storage へ入れ、アレルギー・家族条件を残す | **反証** | §4.1 / §7.3: install の許可リスト以外 `cache.put` 禁止。許可リストは html/manifest/icons + `.js/.css/.woff/.woff2` のみ。live tree に `caches.open` / `persistQueryClient` は無い。 |
| 2 | `/auth/callback?code=` や GET `/api/*` を SW が横取りし、code / entitlement / emergency-menus をキャッシュする | **概ね反証（末尾スラッシュは残）** | §4.2 / §7.3 手順 3: pathname が `/api`・`/api/` 始まり・`/auth/callback`（query 無視・末尾スラッシュなし）なら return。Supabase は他 origin。`/api/emergency-menus` や `/api/auth/continuations/...` は `/api/` で除外。`/auth/callback/` は手順 3 をすり抜け、ナビ失敗時にシェルを返し得る。 |
| 3 | `addAll` / グローバル `caches.match` で HTML を URL 単位保存し、`?code=` をキーにする | **反証（保存）/ 部分成立（取り出し）** | 保存してよい文書は Precache の `/index.html` 1 枚（§4.3）。静的 match は `ignoreSearch: true` なので query はキーにならない。ただしナビ失敗は `caches.match(SHELL_URL)` で **全キャッシュ**を見る（#7）。 |
| 4 | MITM / 偽レスポンスで Precache を毒し、以降の再訪で悪意 JS を恒常実行 | **成立しうる（初回 TLS 前提では弱い）** | install の `addAll` だけが書き込み。本番は HTTPS。ハッシュ付き JS は内容が変わればファイル名が変わる。毒が残るのは **非ハッシュの `index.html` / icons を同一 `CACHE_NAME` で使い回す**経路（I2/I3）。 |
| 5 | CSP を緩めて `unsafe-inline` / `blob:` / CDN を足し、SW 経由でスクリプトを足す | **反証** | §2.2 / §4.5: `CSP_STATIC_DIRECTIVES` に token を足さない。現行は `default-src 'self'; script-src 'self'`（`scripts/csp-headers.mjs` L11–12）。`worker-src` 省略は `default-src` で足りると明記。合成 `new Response(html)` は書いていない。 |
| 6 | standalone で Google / マジックリンクが Safari・メールに飛び、code が別面に残る | **成立（意図的残差）** | §2.3: 直さない。`start_url` は `/`（§6.1）。iOS は Safari とストレージが分かれ得る。ログイン面に案内を出さない方針は二次被害（standalone 内ログイン誘導）を抑えるが、漏れ自体は残る。Auth ロック再定義禁止（§4.6）と一致。 |
| 7 | 旧 SW 制御中に新 SW が install 済み → オフラインナビが新 `index.html` を返し、旧ハッシュ JS が無い | **成立** | §7.3 ナビ失敗: `caches.match(SHELL_URL)`。§7.3 静的: 自 `CACHE_NAME` の `cache.match`。§4.9 / §12.4: waiting を意図的に長くする。install 済み waiting SW のキャッシュは既に存在する。 |
| 8 | `CACHE_NAME` が URL 集合だけなので、icons / `index.html` だけ変えた deploy で SW が更新されない | **成立** | §7.1 手順 3: `PRECACHE_URLS` を `\n` 結合した SHA-256 先頭 12 hex。`Date.now()` / 乱数禁止。同一 URL リストなら `sw.js` バイト一致 → ブラウザは更新扱いにしない。 |
| 9 | `/* → index.html` が欠落した `/sw.js` に HTML を 200 で返す | **部分成立** | `netlify.toml` L34–37 の SPA fallback。実ファイルは先に出る（§3）。欠落・部分 deploy・generator 失敗後の旧ブランチでは HTML 200。現代ブラウザは MIME 不一致で登録 reject（仕様は `.catch` 握りつぶし）。**旧 SW が居る端末は更新不能のまま残る**（#12）。 |
| 10 | XSS が `register("/assets/…js", { scope: "/" })` や HTML-as-SW で scope を奪う | **概ね反証** | SW は `/sw.js`、scope `/`（ディレクトリ既定で許可）。`Service-Worker-Allowed` を全域に足す設計ではない。HTML を SW にするには JS MIME が要る。XSS があっても同一オリジンに任意 JS ワーカーを置く口は現行 tree に無い。 |
| 11 | ログアウト / アカウント削除が案内キーまたは session キーを取り違えて消す | **設計上反証・実装逸脱で成立** | §4.6–4.7 / §8.1: `kondate:preferences:pwa-install-tip-dismissed` を owned に足さない。現行 `isOwnedBrowserStorageKey`（`auth-cleanup.ts` L122–138）は `kondate.auth.*` / generation / shopping / flyer / expired-pantry / feedback / household revision のみ。`kondate:preferences` はテストで残ることを既に固定。 |
| 12 | 更新が永久に waiting / install 失敗のまま固まる | **成立しうる** | skipWaiting なし + standalone の単一 client。加えて #8 のバイト一致、#9 の HTML-as-`sw.js`、#14 の `addAll` 301。仕様に `registration.update()` 周期も kill switch も無い。オンラインナビは network-first なので **アプリ本体は死なない**が、SW 修正（バイパス漏れ等）はプロセス死亡まで届かない。 |
| 13 | 既存ユーザーに案内が一度も出ない / 毎回出る | **部分成立** | 端末フラグのみ（§8.1 / §12.2）。フラグ無しなら出す（受け入れ 3）。共有端末の別アカウントは出さない（受け入れ 4）。`evaluate` 失敗・Private・quota ではタブ内メモリ dismiss、リロードで再掲（§8.1）。iPhone「デスクトップ用サイト」は Macintosh + touch 1 → `other` で出ない。`beforeinstallprompt` 成功後も自動 dismiss しない（§8.5）ので、インストール直後の同一セッションでは残り続ける。 |
| 14 | Netlify Pretty URLs が `/index.html` を 301 し、`addAll` が毎回失敗 | **成立しうる** | 仕様は `/index.html` 必須・欠けると throw（§7.1–7.2）。`netlify.toml` に `[build.processing.html] pretty_urls = false` 無し。Cache `addAll`/`put` は redirect を拒否する。受け入れ 1 は **dist にファイルがあること**だけで、ブラウザ install 成功を固定していない。 |
| 15 | E2E fixture がカードを消し損ね、iPhone SE の既存 spec / a11y / 見出し順が落ちる | **成立** | `playwright.config.ts` L46–47: `mobile-chromium` = `devices["iPhone SE"]`。`tools/run-e2e-app.mjs` は Vite dev（SW は載らないがカードは載る）。`loginAsNewUser` は末尾で `/planner` 着地（`e2e/fixtures/auth.ts` L320–321）。`auth.setup.ts` は magic-link 直で storageState 保存。`oauth-mock.spec.ts` は raw test で welcome|planner。仕様の setItem は「成功後」「storageState 利用前」の `evaluate` のみで `addInitScript` が無い。 |
| 16 | `beforeinstallprompt` や UA を HTML に挿して XSS | **反証** | 文言は §8.4 の固定日本語。面検出は `"ios" \| "android" \| "other"`。イベントは `prompt()` するだけ。ユーザー入力を copy に混ぜない。 |
| 17 | カードを Outlet 直前に置き、h2 が `main h1` より前に出て a11y / `heading.first()` を壊す | **成立しうる** | §8.6: AppShell の Outlet 直前 `<section>` + `aria-labelledby`。見出しレベル未指定。`mobile-accessibility.spec.ts` L256 は `getByRole("heading").first()`。カードが出ると document 順の最初の見出しがカード側になり得る。 |
| 18 | `vite.config.ts` が `build.manifest` 未設定のまま generator が `dist/.vite/manifest.json` を読んで全本番ビルドが throw | **成立しうる** | 現行 `vite.config.ts` の `build` は `assetsInlineLimit: 0` のみ。Vite 既定は manifest オフ。§7.1 は欠けたら throw と書くが **有効化を書いていない**。プラグイン `config` フックで足せば回避できるが、仕様だけなぞると `npm run build` が死ぬ。 |

---

## Findings

### Critical

なし。設計どおりなら Cache Storage に API / 認可 code / アレルギーは載らない。CSP を緩めず、Auth ロックを再定義せず、owned 掃除に案内キーを足さない。blast radius は「SW が動かない / 更新が混ざる / 既存 E2E が赤 / 案内の出し分けが崩れる」であり、本番 DB 破壊や無制限 PII 流出ではない。

---

### Important

#### I1. 本番 Netlify で `/index.html` Precache が `addAll` 失敗し得る（シェル機能が静かに死ぬ）

- **信頼度:** 88
- **箇所:** 仕様 §7.1–7.3 / §3 / 受け入れ 1; `netlify.toml` L34–37（`/* → index.html` 200）; Pretty URLs 設定なし
- **説明:**
  Cache API はリダイレクト応答を `addAll` / `put` しない。Netlify 既定の Pretty URLs は存在する `/index.html` を `/` へ 301 することがある。仕様は `/index.html` が含まれなければ **ビルド throw** とし、実行時の 301 は見ていない。install 失敗は「次回再試行」（§7.3）とあるが、ホストが変わらない限り無限失敗。アプリはオンライン SPA のまま動き、受け入れ 1（dist にファイルがある）もグリーンに見える。
- **修正要求（BLOCK 解除）:**
  1. `SHELL_URL` / Precache を **本番で 200 かつ非 redirect の URL** に固定する（推奨: `/` をシェルにし、`/index.html` は 301 なら入れない。または `pretty_urls = false` を `netlify.toml` に書く）。
  2. generator または手動受け入れに「`curl -I` 相当で Precache 各 URL が 200 かつ redirect でない」を入れる。dist 存在チェックだけでは不可。
  3. `/*` fallback と実ファイル優先を、`sw.js` / manifest / icons についても一文で固定（欠落時は HTML 200 → 登録失敗 → 旧 SW 残留、I6 とセット）。

#### I2. ナビフォールバックの `caches.match(SHELL_URL)` が、禁止した waiting 窓で stale-shell × 新ハッシュを起こす

- **信頼度:** 93
- **箇所:** 仕様 §7.3 手順 4–5、§4.9、§12.4
- **説明:**
  静的は「自 `CACHE_NAME` の `cache.match`」。ナビ失敗だけ **複数形 `caches.match`**（全 Cache Storage）。新しい SW は waiting 中に `addAll` 済みなので、新旧 `kondate-shell-*` が両方 `index.html` を持つ。マッチ順は実装依存。新 HTML（新ハッシュ参照）+ 旧 SW の許可リスト（旧ハッシュしか持たない）+ オフライン fetch 失敗 = 白画面。これは §2.3「デプロイ直後の 1 回は古いシェル」ではなく、**一貫性のない mix**。skipWaiting 禁止が窓を最大化する。
- **修正要求（BLOCK 解除）:**
  ナビも静的も **必ず `caches.open(CACHE_NAME)` 配下の `cache.match`**。グローバル `caches.match` を禁止し、ルーティング純関数 / SW テストで「他キャッシュの `index.html` を返さない」を固定。

#### I3. `CACHE_NAME` が非ハッシュ資産の中身を見ないので、更新が検知されない

- **信頼度:** 91
- **箇所:** 仕様 §7.1 手順 3、§4.9、受け入れ「次に開いたとき新しい版」
- **説明:**
  ハッシュ付き JS/CSS が変われば URL リストが変わり更新される。`index.html`・icons・manifest だけ（メタ追加、アイコン差し替え、theme-color）の deploy では URL 集合が同一 → `sw.js` バイト一致 → ブラウザは waiting すら作らない。オフラインフォールバックは旧 HTML / 旧アイコンのまま。§4.9 の「新しい SW は待たせる」以前に、**新しい SW が存在しない**。
- **修正要求（BLOCK 解除）:**
  `CACHE_NAME`（または define する定数）に **非ハッシュ Precache ファイルの内容ハッシュ**を含める。乱数 / `Date.now()` は禁止のままでよい。同一入力同一名は維持。

#### I4. E2E 既定 dismiss の契約が、実際の入口とタイミングを覆っていない

- **信頼度:** 92
- **箇所:** 仕様 §9.2 / 受け入れ 9; `e2e/fixtures/auth.ts` L70–84, L208–321; `e2e/specs/auth.setup.ts`; `e2e/fixtures/session-auth.ts` L20–26; `e2e/specs/oauth-mock.spec.ts` L34; `playwright.config.ts` L46–47; `e2e/specs/mobile-accessibility.spec.ts` L230–256
- **説明:**
  - `loginAsNewUser` 成功の定義は `/planner` 着地。その **後** に setItem しても、着地中は iPhone UA + session + 未 dismiss でカードが出る。`authenticatedPage` は続けて `/` へ行くので後段は助かるが、planner をそのまま使う経路は侵される。
  - `auth.setup` は `requestMagicLinkAndReadUrl` で storageState を書く。仕様が触るのは `loginAsNewUser` と `session-auth` だけ。setup 保存時にキーが無い。
  - `reusedCompletedPage` は `newContext(storageState)` → `goto("/planner")`。仕様スニペットの `page.evaluate` は **origin 文書が無いと失敗**し、`goto` 後では描画済み。`addInitScript` / storageState JSON への注入が無い。
  - `oauth-mock` 等の raw `@playwright/test` は対象外。welcome|planner のうち planner に落ちるとカードが出る。
  - カードを Outlet 直前に置くと、見出しが `main h1` より前になり得る。a11y の `heading.first()` と heading-order が既存契約と衝突する。
- **修正要求（BLOCK 解除）:**
  1. すべてのログイン入口（`loginAsNewUser` の **planner 着地前**、`auth.setup` の storageState 保存前、`session-auth` は `addInitScript` または storageState 直接注入、raw OAuth / callback spec も同じキー）を仕様に列挙する。
  2. `evaluate` だけを正本にしない。
  3. カード見出しは `h2` を Outlet 前に置かない（`p` + `aria-labelledby`、または `main` 内のページ見出しより下）。既存 E2E の heading 契約を壊さないことを受け入れに書く。

#### I5. 既存ユーザー案内の「必ず一度」が、面検出と共有端末で片側に潰れる

- **信頼度:** 86
- **箇所:** 仕様 §8.2–8.5、受け入れ 3–4、§2.3 デスクトップ残差
- **説明:**
  登録日で出し分けない方針自体は一貫している。しかし (a) iPhone のデスクトップ用サイト / 一部 Android デスクトップ UA は `other` になり **初回も出ない**、(b) 受け入れ 4 により同一端末の別アカウントは **永久に出ない**、(c) Android は `userChoice` で閉じないためインストール成功後も「わかりました」まで残る、(d) 書き込み失敗はリロードのたび再掲。仕様は (b) を受け入れ、(d) を許容するが、(a)(c) は「既存ユーザーが次に開いたら初回」と矛盾し得る。
- **修正要求:**
  (a) を残差として §2.3 に書くか、iOS デスクトップモードの検出を足す。(c) は `appinstalled` / standalone 遷移で閉じるか、残すなら「インストール直後はカードが残る」と明記。(b) は既に受け入れ済み — 共有 iPad では 2 人目が設定節だけを頼ること。実装着手の blocker は I1–I4 より弱いが、文言を閉じないと「出ない」バグと区別できない。

#### I6. `sw.js` 欠落時の HTML 200 + 握りつぶし登録失敗で、旧 SW が更新不能になる

- **信頼度:** 84
- **箇所:** `netlify.toml` L34–37; 仕様 §7.4 `.catch(() => {})`; §7.5 `/sw.js` `Cache-Control: no-cache`
- **説明:**
  実ファイルがある通常 deploy では fallback しない（§3）。generator throw ならビルド失敗で安全。危険なのは **一度載った SW がある端末へ、`sw.js` の無い成果物や HTML を `no-cache` で返したとき**。更新チェックは HTML を新ワーカーとして解釈できず、旧 SW が残る。登録失敗をログもメトリクスも残さない（§4.10）ため、観測不能。
- **修正要求:**
  受け入れに「本番 `/sw.js` の `Content-Type` が JavaScript であり `text/html` でない」を手動または tooling で固定。欠落時は **デプロイ失敗**（現状の throw を維持）。旧クライアント向け kill は第1版残差でよいが、その旨を §2.3 に書く。

---

### Minor

#### M1. `/auth/callback/`（末尾スラッシュ）と `pathname.startsWith("/auth/callback/")` がバイパス漏れ

- **信頼度:** 80
- **箇所:** 仕様 §7.3 手順 3（一致は末尾スラッシュなし）; `auth-callback-url-capture.ts` L58 は `/auth/callback/` を callback 扱い
- **修正案:** SW バイパスを capture 側と同じく exact + trailing slash にする。現状の本番 redirect は `/auth/callback`（`oauth-mock.spec.ts` L16）。

#### M2. DEV は「登録しない」だけで、同一 origin に残った本番相当 SW を解除しない

- **信頼度:** 78
- **箇所:** 仕様 §4.8 / §7.4; `package.json` の preview は既定 4173（5173 の E2E とは通常分離）
- **修正案:** `import.meta.env.PROD` でないとき `navigator.serviceWorker.getRegistrations()` して解除。E2E は fresh context なので必須ではない。

#### M3. `_headers` の `/sw.js` ブロックと `/*` CSP の合成をテストが固定しない

- **信頼度:** 76
- **箇所:** 仕様 §7.5; 現行 `buildHeadersFileContent` は `/*` の CSP のみ（`scripts/csp-headers.mjs` L58–59）
- **説明:** 別ヘッダ名なら splat と特定パスは共存し得る。テスト要求は「`/sw.js` no-cache」と「toml に CSP を戻さない」だけなので、実装が `/sw.js` ブロックで CSP 行を置き切っても検知できない。SW ファイル応答の CSP 欠落は文書 CSP ほど致命ではない。
- **修正案:** emit 結果が `/sw.js` に no-cache を持ち、`/*` の CSP 行が残ることを両方 assert。

#### M4. `build.manifest` 有効化が仕様に無い

- **信頼度:** 90（実装でプラグインが足せば回避）
- **修正案:** §7.1 または §5 に「Vite プラグインが `build.manifest: true` を入れる。`package.json` の `build` スクリプトは変えない」と書く。

#### M5. 設定の早期 return（読込中）には常設節が載らない

- **信頼度:** 74
- **箇所:** `household-settings-page.tsx` L1527–1532 / L1571–1572 の読込 `main` と、空家族 L1557・家族あり L2287 の二本
- **説明:** 仕様の「2 分岐」は空/ありで正しい。読込中に節が無いのは許容。ShareConsent が Plan と Account の間に増えているが、挿入位置（家族ブロックの後・Plan の前）は両方に書ける。

#### M6. カードが Outlet を押し下げ、320px で主要 CTA が折りたたみ下に沈む

- **信頼度:** 72
- **説明:** overlay しないので下タブは守れる。iOS 3 手順 + 44px ボタンは縦を食う。仕様は横スクロールだけ禁止。料理中の割り込み回避（フォーカス非奪取）とは両立するが、「主要 CTA を覆わない」を押し下げで満たすなら残差として書く。

---

## 反証・低リスク

| 項目 | 判定 |
| --- | --- |
| API JSON / アレルギーを Cache Storage に置く正面設計 | 反証（許可リスト + runtime put 禁止。live tree に Cache API なし） |
| `/api/*` GET（entitlement / usage / emergency-menus / generation-status）の Precache | 反証（拡張子フィルタと path バイパス） |
| `/auth/callback?code=` をキーにした HTML 保存 | 反証（非介入 + HTML は `/index.html` のみ） |
| CSP `unsafe-inline` / `blob:` / CDN | 反証（明示禁止。既存 tooling が `unsafe-inline` 不在を固定） |
| Auth ロック export の再定義 | 反証（対象外。案内キーは `kondate:preferences:*`） |
| ログアウトが session / flow secret を残して案内だけ消す、またはその逆 | 設計どおりなら反証。テスト追加（§9.1）が回帰網 |
| `beforeinstallprompt` XSS | 反証（固定 copy、面 enum） |
| DEV での新規 SW 登録 | 反証（`import.meta.env.PROD` のみ。E2E は Vite dev） |
| `@shared/safety` をブラウザへ引く | 反証（§5。本機能は safety-pure も不要） |
| admin / Functions / contracts 改変 | 反証（非対象） |
| デスクトップ初回カード | 残差として明示（§2.3） |
| standalone OAuth / iOS ストレージ分離 | 残差として明示（§2.3）。本スライスで直すな、は正しい |

---

## BLOCK 解除条件

実装 plan に入る前に、設計改訂で以下を必須とする:

- [ ] **I1:** Precache / `SHELL_URL` を Netlify 上で 200・非 redirect に固定（`/` または pretty URLs 無効）。`addAll` が 301 で死ぬ状態を第1版の正にしない。
- [ ] **I2:** ナビフォールバックを自 `CACHE_NAME` の `cache.match` に限定。`caches.match` 全検索を禁止。
- [ ] **I3:** 非ハッシュ Precache の内容を `CACHE_NAME` に含める。
- [ ] **I4:** E2E dismiss を全ログイン入口 + `addInitScript`/storageState 注入 + planner 着地前に固定。カード見出しで既存 heading 契約を壊さない。
- [ ] **I5:** 既存ユーザー「出ない/残る」の残差（デスクトップ UA、共有端末 2 人目、install 後もカード）を §2.3 か §8 に書く。
- [ ] **I6:** `/sw.js` の JS MIME を受け入れに書く。HTML fallback 時の旧 SW 残留を残差化。

Critical 0 のまま I1–I4 を設計に反映し、I5–I6 を残差または手当てすれば **PROCEED_WITH_RESIDUALS**（standalone ログイン欠陥、オフラインはシェルのみ、実 SW は CI 外、デスクトップ初回カードなし）。

---

## メタ

- 種別: 設計敵対的レビュー（実装前）
- 総合: **BLOCK_WITH_CONDITIONS** / Critical **0** / Important **6** / Minor **6**
- 編集: 本ファイルのみ（仕様・実装は未変更）
