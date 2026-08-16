# 2次検証: PWA インストール可能アプリシェル設計

- **役割:** 独立 secondary verifier（1次・敵対の著者コンテキストに依存せず、live tree で再照合）
- **日付:** 2026-08-16
- **対象設計:** [`docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)
- **入力:**
  - 1次: [`2026-08-16-pwa-installable-app-shell-primary.md`](./2026-08-16-pwa-installable-app-shell-primary.md)（**REVISE** / C0 I6 M6）
  - 敵対: [`2026-08-16-pwa-installable-app-shell-adversarial.md`](./2026-08-16-pwa-installable-app-shell-adversarial.md)（**BLOCK_WITH_CONDITIONS** / C0 I6 M6）
- **照合（live tree）:** `vite.config.ts`、`package.json` `build`、`tsconfig.app.json`、`scripts/csp-headers.mjs` / `scripts/csp-headers.test.mjs`、`netlify.toml`、`src/styles.css`、`src/features/auth/auth-cleanup.ts`、`src/features/auth/auth-callback-url-capture.ts`、`e2e/fixtures/auth.ts`、`e2e/specs/auth.setup.ts`、`e2e/fixtures/session-auth.ts`、`e2e/fixtures/seed-onboarding.ts`、`src/app/layouts/app-shell.tsx`、`src/features/household/household-settings-page.tsx`、`playwright.config.ts`
- **手法:** 静的再照合のみ。設計本体の編集なし（本ファイルのみ成果物）。

---

## Summary

方向性（許可リスト手書き SW、`vite-plugin-pwa` / Workbox 不採用、`/api/*` と callback の非介入、実行時 `cache.put` 禁止、CSP 非緩和、Auth ロック非再定義、案内キーを `kondate:preferences:` 配下、DEV 非登録、`skipWaiting` / `clients.claim` なし）は **live tree の不変条件と整合**する。1次・敵対が Critical 0 とした判断に同意する。Cache Storage へ API / 認可 code / アレルギーが載る正面経路は、設計どおりなら成立しない。

二次の核:

1. **Critical は双方 0 で妥当。** 新 Critical は立てない（本番 SW 不全・更新 mix・E2E 赤は blast だが PII / 認可バイパスではない）。
2. **総合は 1次 REVISE と敵対 BLOCK_WITH_CONDITIONS を統合して `REVISE_SPEC`。** 敵対の BLOCK は権限モデル破綻ではなく、**文面の穴を閉じてから plan へ**の意味。
3. **ビルドが死ぬ穴（Pri F1 = Adv M4）は CONFIRMED。** 現行 `vite.config.ts` の `build` は `assetsInlineLimit: 0` のみ。Vite 8 の `build.manifest` 既定は off。
4. **フォント / 収集未定義（Pri F2）は CONFIRMED。** `src/styles.css` が unicode-range 121 分割を正としている。
5. **E2E dismiss（Pri F3 = Adv I4）は CONFIRMED。** `loginAsNewUser` は成功定義が `/planner` 着地。仕様の `evaluate` では既存 mobile が守れない。
6. **本番ホスト契約（Adv I1 ∪ Pri F4 ∪ Adv I6）は CONFIRMED。** Pretty URLs 未固定、`.webmanifest` MIME 無し、欠落 `sw.js` は `/* → index.html` 200。
7. **更新モデル（Adv I2 / I3）は CONFIRMED。** 仕様が `caches.match(SHELL_URL)` と URL 集合 SHA を書いており、意図した「次起動で新しい版」と矛盾する。
8. **BIP 早期発火（Pri F6）は CONFIRMED。** フック mount 待ちは Android 主経路を殺す。
9. **案内残差（Adv I5）は CONFIRMED・低。** 実装分岐ではなく §2.3 に書く穴。
10. **Pri F5 = Adv M3、Pri F12 = Adv M1** は重複。F7 は収集正規化に吸収。

**最終推奨: `REVISE_SPEC`**

- 人間再承認・implementation plan 前に下記 **Merged must-fix** を設計本文へ反映すること。
- Critical must-fix: **0**
- Important must-fix（重複排除後）: **9**

---

## Final recommendation

| 判定 | 条件 |
| --- | --- |
| **REVISE_SPEC** | 必須。現状文面のまま plan に入るとビルド throw、本番 `addAll` 失敗、更新 mix、既存 E2E 赤、Android インストールボタン欠落で実装者分岐する。 |
| must-fix 反映後 | **APPROVE_WITH_RESIDUALS**（standalone OAuth / iOS ストレージ分離 / 通信断はシェルのみ / デスクトップ初回カードなし / 実 SW は CI 外 / CriOS は Safari 手順のまま / DEV 残存 SW 解除なし）。 |
| 実装開始 | 改訂設計のコミット後。 |

1次の REVISE と敵対の BLOCK_WITH_CONDITIONS は **矛盾しない**（敵対の BLOCK は条件付き、Critical 0）。二次は **REVISE_SPEC** ラベルで統一する。

---

## Cross-walk（Important / Minor）

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 | 根拠（live 要約） |
| --- | --- | --- | --- | --- | --- | --- |
| Adv Critical | 敵対 | — | なし | — | — | API/code の Cache 混入は §4.1–4.3 で反証。新 Critical なし。 |
| **Pri F1** | 1次 | Important | **CONFIRMED** | Important | **MF-I1** | `vite.config.ts` L72–74 に `manifest` 無し。Vite 既定 off。`build` は `tsc -b && vite build`。`tsconfig.app.json` は `src` 全込み。 |
| **Adv M4** | 敵対 | Minor | **CONFIRMED** | Important | **MF-I1** | **DUPLICATE-OF F1**（重大度は F1 に合わせる）。 |
| **Pri F2** | 1次 | Important | **CONFIRMED** | Important | **MF-I2** | `src/styles.css` L12–14 が 121 分割を正。§7.2 は `.woff2` を機械収集。 |
| **Pri F7** | 1次 | Minor | **CONFIRMED** | Minor | **MF-I2** | 収集順未定義のまま SHA すると同一集合で CACHE_NAME が揺れる。 |
| **Pri F3** | 1次 | Important | **CONFIRMED** | Important | **MF-I3** | `loginAsNewUser` L318–321 が `/planner` 着地済み。`auth.setup.ts` はキー非書き。 |
| **Adv I4** | 敵対 | Important | **CONFIRMED** | Important | **MF-I3** | 同根 + `session-auth.ts` L20–26 が `goto("/planner")`。`evaluate` は about:blank で失敗。 |
| **Pri F4** | 1次 | Important | **CONFIRMED** | Important | **MF-I4** | `netlify.toml` に `.webmanifest` の Content-Type 無し。 |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | Important | **MF-I4** | `netlify.toml` に `pretty_urls` 無し。§7.2 は `/index.html` 必須。 |
| **Adv I6** | 敵対 | Important | **CONFIRMED** | Important | **MF-I4** | `/* → index.html` 200（L34–37）。欠落 `sw.js` は HTML 200 → 旧 SW 残留。 |
| **Adv I2** | 敵対 | Important | **CONFIRMED** | Important | **MF-I5** | §7.3 ナビ失敗が `caches.match(SHELL_URL)`。静的だけ自 CACHE_NAME。 |
| **Adv I3** | 敵対 | Important | **CONFIRMED** | Important | **MF-I6** | §7.1 手順 3 は URL 集合 SHA のみ。非ハッシュ資産の中身が CACHE_NAME に入らない。 |
| **Pri F5** | 1次 | Important | **CONFIRMED** | Important | **MF-I7** | `scripts/csp-headers.test.mjs` L42–43 が `^/\*\n`。§7.5 は先頭に `/sw.js`。 |
| **Adv M3** | 敵対 | Minor | **CONFIRMED** | Important | **MF-I7** | **DUPLICATE-OF F5**（`/*` CSP 残存まで exact 化する同一穴）。 |
| **Pri F6** | 1次 | Important | **CONFIRMED** | Important | **MF-I8** | §8.5 はフック listen。surface 判定後では BIP を取りこぼす。 |
| **Adv I5** | 敵対 | Important | **CONFIRMED** | Important（低） | **MF-I9** | (b)(c)(d) は本文済み。(a) iPhone デスクトップ用サイトが `other` になる点だけ §2.3 欠落。 |
| **Pri F12** | 1次 | Minor | **CONFIRMED** | Minor | residual / MF-I5 付帯 | §7.3 は `/auth/callback` exact。`auth-callback-url-capture.ts` L58 は trailing slash も callback。 |
| **Adv M1** | 敵対 | Minor | **CONFIRMED** | Minor | **DUPLICATE-OF F12** | 本番 redirect は slash 無し（`oauth-mock.spec.ts` L16）。 |
| Pri F8 | 1次 | Minor | **CONFIRMED** | Minor | residual | `household-settings-page.test.tsx` は Plan / ShareConsent を mock。 |
| Pri F9 | 1次 | Minor | **CONFIRMED** | Minor | residual | CriOS を ios 扱い。Safari 手順固定は残差で可。 |
| Pri F10 | 1次 | Minor | **CONFIRMED** | Minor | **MF-I3 付帯** | 見出し未指定。`mobile-accessibility.spec.ts` L256 が `heading.first()`。 |
| Pri F11 | 1次 | Minor | **CONFIRMED** | Minor | residual | §8.2 は `/Android/` のみ。§9.1 の Linux armv は関数と矛盾。 |
| Adv M2 | 敵対 | Minor | **CONFIRMED** | Minor | residual | DEV は非登録のみ。preview 4173 と E2E 5173 は通常分離。 |
| Adv M5 | 敵対 | Minor | **CONFIRMED** | Minor | residual | 読込中 early return（L1501–1502 / L1571–1572）に常設節無しは許容。 |
| Adv M6 | 敵対 | Minor | **CONFIRMED** | Minor | residual | カードは overlay せず押し下げ。§2.3 相当で可。 |

**棄却:** なし。敵対に Critical 無しは維持。I5 のみ「低」として残差寄り must-document。

---

## Merged must-fix（承認前に設計へ書く）

### Important

#### MF-I1 — Vite manifest と SW define の型（Pri F1 ∪ Adv M4）

- §7.1 / 実装順 4 に: `vite.config.ts` の `build.manifest: true` を必須化する（`package.json` の `build` 文字列は変えない）。
- `src/pwa/service-worker.ts` 用に `declare const __KONDATE_SW_CACHE_NAME__: string` 等を同ファイルまたは `src/pwa/sw-defines.d.ts` に置く、と一文。`src/pwa` を `tsconfig.app.json` から外すなら generator テスト側で型を見る、と書く。
- 受け入れ 1 に「`dist/.vite/manifest.json` がビルド成果として存在する」を足す。

#### MF-I2 — Precache 収集とフォント（Pri F2 ∪ Pri F7）

収集を閉じる:

- 各 chunk の `file` + `css[]` + `assets[]` だけを URL 化する。`src` / `imports` / `dynamicImports` は見ない。
- `PRECACHE_URLS` は UTF-8 昇順で一意化してから `CACHE_NAME` をハッシュする。

フォントは次の **一方を本文で選ぶ**（中間の実行時 `cache.put` は §4.4 と矛盾するので採らない）:

1. **推奨:** PRECACHE から `.woff` / `.woff2` を外す。§2.1 目的 2 の「フォント」を「ブラウザ HTTP キャッシュ」に言い換える。
2. 全スライスを入れるなら、ファイル数上限・`addAll` 失敗時・初回 install の許容時間を受け入れに書く。

#### MF-I3 — E2E 既定 dismiss と見出し（Pri F3 ∪ Adv I4 ∪ Pri F10）

`page.evaluate(setItem)` を正本にしない。

1. `loginAsNewUser`・`completedOnboardingPage`（seed 後の `/planner` 再訪含む）・`reusedCompletedPage`・magic-link 着地で `/planner` に出る経路（`auth.setup` / `requestMagicLinkAndReadUrl` 利用側）・raw OAuth で planner に落ち得る spec を列挙する。
2. アプリ origin を開く fixture は **`page.addInitScript`** でキー `"1"` を書く（ドキュメント作成前）。`auth.ts` L206 が禁じているのは session 手注入であり、本フラグとは別、と一文。
3. `auth.setup.ts` は `storageState()` の前に同じキーを localStorage へ書き、保存済み state 自体を dismiss 済みにする。
4. 本機能 E2E だけが addInitScript 無し（または明示削除）でカードを見る。
5. カード見出しは **`h2`**（設定の `h2`「ホーム画面に追加」と exact name で区別）。既存 `heading.first()` / named heading 契約を壊さないことを受け入れ 9 に書く。

#### MF-I4 — 本番ホストの応答契約（Adv I1 ∪ Pri F4 ∪ Adv I6）

1. Precache / `SHELL_URL` を **本番で 200 かつ非 redirect** に固定する。推奨: シェルは `/`（`/* → index.html` の 200 rewrite に乗る）。`/index.html` は Pretty URLs の 301 があり得るので入れない、**または** `netlify.toml` に `pretty_urls = false` を書く。両方を曖昧に残さない。
2. generator または手動受け入れに「Precache 各 URL が 200 かつ redirect でない」を入れる。dist 存在チェックだけでは不可。
3. `_headers` または `netlify.toml` に `/manifest.webmanifest` → `Content-Type: application/manifest+json`（CSP は足さない。グローバル `[[headers]]` に CSP を戻さない）。
4. 受け入れに「本番 `/sw.js` の `Content-Type` が JavaScript であり `text/html` でない」。欠落時は現行どおりビルド throw。旧クライアント向け kill は第1版残差として §2.3 に書く。

#### MF-I5 — ナビフォールバックを自キャッシュに閉じる（Adv I2 ∪ Pri F12）

- ナビも静的も **必ず `caches.open(CACHE_NAME)` 配下の `cache.match`**。グローバル `caches.match` を禁止する。
- ルーティング純関数 / SW テストで「他キャッシュの `index.html` を返さない」を固定する。
- pathname 判定を capturer に揃え、`/auth/callback` と `/auth/callback/` の両方を passthrough（シェルフォールバック無し）。

#### MF-I6 — 非ハッシュ資産の内容を CACHE_NAME に含める（Adv I3）

- `CACHE_NAME`（または define する定数）に **非ハッシュ Precache ファイルの内容ハッシュ**を含める。
- 乱数 / `Date.now()` は禁止のまま。同一入力同一名は維持（入力は MF-I2 のソート済み URL + 内容ハッシュ）。

#### MF-I7 — `_headers` テストの正本（Pri F5 ∪ Adv M3）

- §7.5 / §9.1 の更新対象に **`scripts/csp-headers.test.mjs` を名前で入れる**。
- exact 本文: 先頭 `/sw.js` + `Cache-Control: no-cache`、その後の `/*` に既存 CSP。
- emit 結果が `/sw.js` に no-cache を持ち、`/*` の CSP 行が残ることを両方 assert する。

#### MF-I8 — `beforeinstallprompt` をモジュール初期化で取る（Pri F6）

- `registerServiceWorker` と同じく `main.tsx`（または同等のモジュール初期化）で `beforeinstallprompt` を listen し、`preventDefault` したイベントをモジュール変数へ置く。
- フックはその保持を読むだけ。surface 判定で listen 自体を遅らせない。
- テストはモジュールの reset / inject API を公開して書く。

#### MF-I9 — 案内の「出ない / 残る」残差（Adv I5）

§2.3 に次を足す（挙動は変えない）:

- iPhone の「デスクトップ用サイト」等、`other` になる UA では初回カードを出さない（設定節のみ）。
- インストール成功後も「わかりました」までカードは残る（§8.5 の再掲）。
- 共有端末の 2 人目は出さない（受け入れ 4 の再掲）。設定節を頼る。

---

## Residuals（must-fix 後も残る）

| 残差 | 扱い |
| --- | --- |
| iOS ホーム画面のストレージ分離による再ログイン | §2.3 どおり。本スライスで直さない |
| standalone 内 Google / マジックリンクが Safari・メールに出る | 既存 continuation。ログイン面に案内を出さない |
| デプロイ直後 1 回は旧シェル | 更新方針どおり |
| 通信断はシェルのみ、データは既存エラー | オフライン面は作らない |
| デスクトップ初回カードなし | 設定の other 1 節のみ |
| 実 SW 制御・実機インストールは CI 外 | §9.2–9.3 |
| 旧 SW 残留の kill switch なし | MF-I4 で残差化。オンラインナビは network-first なので本体は死なない |
| CriOS / FxiOS に Safari 手順が出る | 出し分けを増やさないなら §2.3 に一文 |
| DEV で残った本番相当 SW を解除しない | preview 4173 と E2E 5173 は通常分離 |
| 設定の読込中に常設節が無い | 空/あり 2 分岐が正。読込中は許容 |
| カードが Outlet を押し下げ主要 CTA が沈む | overlay しない判断の残差。§8.6 に一文可 |
| §9.1 の Linux armv | テスト表を「`Android` を含む UA は android」に合わせる |
| 家族 CRUD 巨大テストが UA に依存し得る | 実装順 2 で `HomeScreenInstallSection` を mock |

---

## 新 Critical

なし。1次・敵対が見落とした、PII 流出・認可バイパス・安全保証の誤表示に至る具体経路は再照合できなかった。

---

## 結論

| 項目 | 結果 |
| --- | --- |
| 最終判定 | **REVISE_SPEC** |
| Critical must-fix | 0 |
| Important must-fix | 9（MF-I1 … MF-I9） |
| 次アクション | 設計本文へ MF 反映 → 人間再承認 → writing-plans |
| 実装 | MF 未反映のまま開始しない |
