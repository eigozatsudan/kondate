# 2次検証: PWA インストール可能アプリシェル Implementation Plan

- **役割:** 独立 secondary verifier（1次・敵対の著者コンテキストに依存せず、spec / plan / live を再照合）
- **日付:** 2026-08-16
- **対象 plan:** [`../plans/2026-08-16-pwa-installable-app-shell.md`](../plans/2026-08-16-pwa-installable-app-shell.md)
- **照合 spec:** [`../specs/2026-08-16-pwa-installable-app-shell-design.md`](../specs/2026-08-16-pwa-installable-app-shell-design.md)（MF-I1…I9 反映済み）
- **入力:**
  - 1次: [`2026-08-16-pwa-installable-app-shell-plan-primary.md`](./2026-08-16-pwa-installable-app-shell-plan-primary.md)（**REVISE** / C0 I5 M6 N2）
  - 敵対: [`2026-08-16-pwa-installable-app-shell-plan-adversarial.md`](./2026-08-16-pwa-installable-app-shell-plan-adversarial.md)（**BLOCK_WITH_CONDITIONS** / C0 I7 M4）
  - 設計二次: [`2026-08-16-pwa-installable-app-shell-secondary.md`](./2026-08-16-pwa-installable-app-shell-secondary.md)（spec MF-I1…I9）
- **照合 live tree:**
  `e2e/fixtures/auth.ts` / `e2e/fixtures/session-auth.ts` / `e2e/fixtures/seed-onboarding.ts` /
  `e2e/specs/auth.setup.ts` / `e2e/specs/oauth-mock.spec.ts` / `e2e/specs/auth-recovery.spec.ts` /
  `e2e/specs/mobile-accessibility.spec.ts` / `e2e/specs/generation-recovery-results.spec.ts` /
  `playwright.config.ts` / `src/main.tsx` / `src/app/layouts/app-shell.tsx` /
  `src/features/household/household-settings-page.tsx` / `src/features/auth/auth-cleanup.ts` /
  `src/features/auth/auth-callback-url-capture.ts` / `vite.config.ts` / `tsconfig.app.json` /
  `scripts/csp-headers.mjs` / `scripts/csp-headers.test.mjs` / `netlify.toml`
- **手法:** 静的再照合のみ。spec / plan / 実装は未編集（本ファイルのみ成果物）。
- **語彙:** 1次 REVISE と敵対 BLOCK は「plan 本文を直してから Task 開始」で一致。二次ラベルは **`REVISE_PLAN`**。spec 再改訂は不要。

---

## Summary

plan は改訂 spec を Task 1–5 に割っており、所有境界・Global Constraints・Task 順は live と衝突しない。`skipWaiting` / `clients.claim` / 実行時 `cache.put` / グローバル `caches.match` / Auth ロック再定義 / CSP token 追加 / Workbox は、snippet と Constraints を文字どおり守る限り **正面からは成立しない**。Critical 0 に同意する。新 Critical は立てない。

二次の核:

1. **plan が自分で spec §9.2 を破る。** Task 2 は `loginAsNewUser` を常時 seed する一方、本機能 E2E を「addInitScript 無しの page でログイン」とだけ書く。観測経路が無い（Pri F1 = Adv I2）。
2. **MF-I3 の既定 dismiss が未閉鎖。** `auth.setup.ts` の正本が着地後 `page.evaluate`。Files は `oauth-mock.spec.ts`「等」止まり。`auth-recovery.spec.ts`（`@smoke`、`requestMagicLinkAndReadUrl` + `context.newPage()`）が落ちている。helper が page 単位だと peer を漏らす（Pri F2 ∪ Adv I1）。
3. **generator が「Spec を見よ」のまま。** `CACHE_NAME` 12 hex・`/` → `dist/index.html`・収集の機械契約が本文に無い。最短 GREEN は woff2 1 個を除外するだけになり、121 スライス / `/index.html` 301 / HTML 更新非検知が残る（Pri F3 ∪ Adv I4 / I6）。
4. **SW snippet が §7.3 手順 5 を落とす。** 許可リスト非所属でも `cache.match` ヒットを返す。RED に `mode:"navigate"` + `/api` / `/auth/callback(/)` が無い（Pri F6 ∪ Adv I3）。
5. **`tsc -b` 通し方が無い。** live `tsconfig.app.json` は DOM のみ。snippet の `self.addEventListener("install" | "fetch", (event: ExtendableEvent | FetchEvent) => …)` は Window リスナ反変で落ち得る。実装者が `src/pwa` 除外（spec 禁止）か unchecked cast 散在に逃げる（Pri F5 ∪ Adv M1）。

**最終: `REVISE_PLAN`**

- Critical must-fix: **0**
- Important must-fix（重複排除後）: **6**（MF-P1…P6）
- spec 再改訂: **不要**（すべて plan 本文で書ける）

---

## Final recommendation

| 項目 | 値 |
| --- | --- |
| **判定** | **`REVISE_PLAN`** |
| **Critical must-fix** | **0** |
| **Important must-fix（統合後）** | **6** |
| **解除後** | **APPROVE_WITH_RESIDUALS**（§2.3 の standalone / 通信断はシェルのみ / 実 SW は CI 外 / A10 更新直後オフライン旧シェル） |
| **1次との差** | F6 を Adv I3 と合わせて Important 維持（所属判定 + navigate 先読み）。F8 フック名は Minor。F9–F11 は同一改訂推奨だが開始阻止にしない。 |
| **敵対との差** | I5 は独立 BLOCK にしない（I4 のリスト契約 + F9 の §9.3 転記に吸収）。I7 は Important 維持（低。実装段落の peek 欠落）。M4/A10 は spec 残差であり plan 必須改訂にしない。 |

1次 REVISE と敵対 BLOCK_WITH_CONDITIONS は矛盾しない。二次は **plan 改訂で解除**と読む。

---

## Cross-walk（Important / Minor）

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 | live 根拠（要約） |
| --- | --- | --- | --- | --- | --- | --- |
| **Pri F1** | 1次 | Important | **CONFIRMED** | Important | **MF-P1** | Task 2 は `loginAsNewUser` 常時 seed。本機能 E2E は「付けない page でログイン」のみ。opt-out / 明示削除 / raw 経路が Interfaces に無い。 |
| **Adv I2** | 敵対 | Important | **CONFIRMED** | Important | **MF-P1** | **DUPLICATE-OF F1**。spec §9.2「本機能 E2E だけが addInitScript 無し（または明示削除）」。 |
| **Pri F2** | 1次 | Important | **CONFIRMED** | Important | **MF-P2** | Files / `git add` は `oauth-mock.spec.ts` と「等」。`auth-recovery.spec.ts` は `requestMagicLinkAndReadUrl` + `context.newPage()`（L8–18）。 |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | Important | **MF-P2** | F2 同根 + Task 2 Step 3 が `auth.setup.ts` に着地後 `page.evaluate` を第一手段として書く。spec §9.2 / MF-I3「`evaluate` を正本にしない」。`playwright.config.ts` L46–47 は iPhone SE。`auth.ts` L206 は session 手注入禁止。 |
| **Pri F3** | 1次 | Important | **CONFIRMED** | Important | **MF-P3** | Task 4 Step 3 は「Spec §7.1–7.2」のみ。12 hex / 非ハッシュ判定 / `/` → `dist/index.html` が本文に無い。 |
| **Adv I6** | 敵対 | Important | **CONFIRMED** | Important | **MF-P3** | **DUPLICATE-OF F3 項目 3**。`/` はディレクトリ。写像無しだと HTML 更新で `CACHE_NAME` が不動。 |
| **Adv I4** | 敵対 | Important | **CONFIRMED** | Important | **MF-P3** | テストが「webp/woff2 を含まない」だけ。live `src/styles.css` は unicode-range 121 分割。趣味の収集は `assets[]` 無フィルタ / manifest キー URL 化。 |
| **Adv I5** | 敵対 | Important | **CONFIRMED 部分** | Important（吸収） | **MF-P3 + residual F9** | `/index.html` 非掲載は既に generator RED にある。独立 BLOCK にはしない。実 HTTP 200 は §9.3 手動（CI 外）。dist 存在は受け入れ 1 であり MF-I4.2 の代替にしない、と一文。 |
| **Pri F4** | 1次 | Important | **CONFIRMED** | Important | **MF-P4** | Task 1 RED は `write` が false まで。Task 2 実装は「write 失敗でも閉じる」と書くが、カード RED に throw fixture が無い。spec §9.1。 |
| **Pri F5** | 1次 | Important | **CONFIRMED** | Important | **MF-P5** | `tsconfig.app.json` `lib` は DOM のみ、`include` に `src`。`self` は Window。`"install"` / `"fetch"` + `ExtendableEvent` 注釈はリスナ反変で `tsc` 落ち得る。 |
| **Adv M1** | 敵対 | Minor | **CONFIRMED / UPGRADE** | Important | **MF-P5** | **DUPLICATE-OF F5**。spec は `src/pwa` を tsconfig から外さない。通し方が無い点が Important。 |
| **Pri F6** | 1次 | Minor | **CONFIRMED / UPGRADE** | Important | **MF-P6** | spec §7.3.5 は pathname ∈ PRECACHE のときだけヒット。snippet は無条件 `cache.match`。 |
| **Adv I3** | 敵対 | Important | **CONFIRMED** | Important | **MF-P6** | F6 同根 + RED が `mode:"navigate"` 付き `/api` / `/auth/callback(/)` を持たない。手順 4 を 3 より先に書くと callback 文書ナビがシェルフォールバック。 |
| **Adv I7** | 敵対 | Important | **CONFIRMED** | Important（低） | **MF-P1 付帯（カード配線）** | `main.tsx` の早期 listen は充足。カード実装段落（Task 2 Step 3）が `peek` を列挙しない。RED は inject 後ボタンを既に要求。 |
| Pri F7 | 1次 | Minor | **CONFIRMED** | Minor | residual / MF-P6 1 行 | `throw new Error("shell_miss")` は元 `TypeError` を捨てる。機能同等。 |
| Pri F8 | 1次 | Minor | **CONFIRMED 部分** | Minor | MF-P1 付帯 + residual | フック名 `useAndroidInstallPrompt` は peek で代替可。設定 BIP は spec §8.7「出してよい」（任意）。peek 配線だけ I7 に吸収。 |
| Pri F9 | 1次 | Minor | **CONFIRMED** | Minor | residual（同一改訂） | Task 5 に §9.3 / 受け入れ 1–10 が無い。CI ゲート化はしない。 |
| Pri F10 | 1次 | Minor | **CONFIRMED** | Minor | residual（同一改訂） | allowlist 実装なら自動 false。`/emergency-menus` true と `/onboarding` `/privacy` false を足すと denylist を封じる。 |
| Pri F11 | 1次 | Minor | **CONFIRMED** | Minor | residual（同一改訂） | 生成手段は sharp / 手描き任意なのに `git add` が `write-pwa-icons.mjs` を必須化。 |
| Pri N1 | 1次 | Nit | **CONFIRMED** | Nit | residual | `register-service-worker.ts` は Create。 |
| Pri N2 | 1次 | Nit | **CONFIRMED** | Nit | **MF-P2 付帯** | helper 型は `(script, arg)`。Interfaces の `() => void` は Playwright と不一致。 |
| Adv M2 | 敵対 | Minor | **CONFIRMED** | Minor | residual | plan 行番号は stale。live `PlanSettingsSection` は **L1607 / L2347**（敵対の L1557 / L2287 も既にずれ）。コンポーネント名を正とする。 |
| Adv M3 | 敵対 | Minor | **CONFIRMED** | Minor | residual | `app-shell.test.tsx` は未ログイン。storage mock 任意のまま可。 |
| Adv M4 | 敵対 | Minor | **CONFIRMED / 残差** | residual | **plan 必須改訂にしない** | 旧 SW 制御中の `addAll("/")` 自己中毒。spec §2.3「デプロイ直後 1 回は古いシェル」の変種。閉じるには spec 変更が要る。 |

### 棄却・非採用

| 主張 | 二次結論 |
| --- | --- |
| Critical（PII / 認可 code の Cache 混入、CSP 緩和、Auth 再定義） | **棄却。** snippet に `cache.put` 無し。`/api`・callback は passthrough 方針。Files は `auth-cleanup.test.ts` のみ。 |
| I5 を独立 BLOCK（本番 HTTP まで CI） | **棄却。** spec §9.2–9.3 は実 SW / 実ホストを CI 外とする。CI は Precache **リスト**に `/index.html` が無いこと（MF-P3）。200 非 redirect は §9.3 手動。 |
| Task 5 で既存 E2E 全件を回す | **棄却。** CLAUDE.md はエージェント全件 E2E を禁じる。必須は fixture 閉鎖 + `heading.first()` 非侵食の固定。 |
| `ideaModePage` / `generation-recovery` / `shopping-list-races` を個別 Files 必須 | **棄却（条件付き）。** `loginAsNewUser` / `completedOnboardingPage` が **context** seed 済みなら peer `newPage()` は同一 origin の localStorage を見る。未 seed の raw context だけヘルパ必須。 |
| `useAndroidInstallPrompt` 欠落が Important | **棄却 as Important。** peek + inject RED で同等。名前ドリフトは Minor。 |
| A10 を plan 必須改訂 | **棄却。** spec 更新モデル残差。plan が実装対象に引き上げていない点は §2.3 どおり。 |
| 敵対の「live `PlanSettingsSection` は L1557 / L2287」 | **事実 stale。** 現 tree は L1607 / L2347。行番号権威は棄却。 |

---

## Live evidence（指示焦点）

### 1. E2E dismiss（MF-P1 / MF-P2）

| 事実 | 場所 |
| --- | --- |
| `loginAsNewUser` 成功定義は session `evaluate` のあと `goto /planner` | `e2e/fixtures/auth.ts` L308–321 |
| L206 が禁じるのは **session 手注入** | 同 L204–206 |
| `completedOnboardingPage` は `loginAsNewUser` 経由 | 同 L70–94 |
| `seedCompletedOnboardingState` は同一 page で再 `goto("/planner")` | `e2e/fixtures/seed-onboarding.ts` L94–96 |
| `auth.setup.ts` は magic-link 着地後に `storageState()`。キー未書き | `e2e/specs/auth.setup.ts` L18–26 |
| `session-auth.ts` は `newContext(storageState)` 直後に `goto("/planner")` | `e2e/fixtures/session-auth.ts` L22–26 |
| `auth-recovery.spec.ts` は fixture `page` で Mailpit ログインし `context.newPage()` が `/planner` | L8–18（`@smoke`） |
| `requestMagicLinkAndReadUrl` 利用側は setup と auth-recovery のみ | specs 横断 grep |
| `oauth-mock.spec.ts` は complete なら `/planner` 着地を成功と認める | L32–34（`@smoke`） |
| mobile-chromium は iPhone SE | `playwright.config.ts` L46–47 |
| `heading.first()` は history detail。名前未固定 | `mobile-accessibility.spec.ts` L256 |
| カードは Outlet 直前の `h2`「ホーム画面に置く」 | spec §8.4 / §8.6。未 dismiss なら `heading.first()` はカードでも visible（false-green） |

plan Task 2 Step 3 は `auth.setup.ts` に「planner 着地後・`storageState()` 前に `page.evaluate`」を第一手段として書く。spec 項目 3 は保存済み state にキーを含めることであり、**手段の正本は addInitScript**（最初の `goto` より前）。evaluate 後書きは二重化として残してよいが、正本にしてはいけない。

`page.addInitScript` は sibling `newPage()` に継承されない。同一 context で先にキーが localStorage へコミット済みなら peer は助かる。`auth-recovery` は **seed 呼び出し自体が Files に無い**ので、その前提が立たない。

### 2. SW / generator（MF-P3 / MF-P6）

| 事実 | 場所 |
| --- | --- |
| Vite `build.manifest` 既定 off。現行は `assetsInlineLimit: 0` のみ | `vite.config.ts` L72–74 |
| `/* → index.html` 200。`pretty_urls` 無し | `netlify.toml` L34–37 |
| 欠落 `sw.js` は HTML 200 になり得る | spec §3。plan はビルド throw + MIME で閉じる方針 |
| callback pathname は `/auth/callback` と `/auth/callback/` | `auth-callback-url-capture.ts` L58 |
| `_headers` 現行先頭は `/*` CSP | `scripts/csp-headers.mjs` L58–59、`csp-headers.test.mjs` L43 |
| `kondate:preferences` は owned 掃除対象外 | `auth-cleanup.ts` L122–137。キー追加禁止は live と一致 |

plan snippet の静的枝は `cache.match(request, { ignoreSearch: true })` のヒットを所属判定なしで返す。install が許可リスト以外を `put` しない前提なら実害は小さいが、§7.3.5 の文面を純関数が表現できない。navigate を API/callback より先に見ると、spec が禁じるシェルフォールバックが callback 文書ナビに付く。

### 3. 設定マウント / 型

| 事実 | 場所 |
| --- | --- |
| 空家族 `PlanSettingsSection` | `household-settings-page.tsx` **L1607** |
| 家族あり `PlanSettingsSection` | 同 **L2347** |
| 読込中 early return | L1539 / L1576。ここに置かない方針は spec §2.3 どおり |
| `tsconfig.app.json` | `lib`: DOM のみ。`src/pwa` 除外なし |

---

## Merged must-fix（Plan 改訂必須）

### MF-P1 — 本機能 E2E の観測経路とカード配線（Pri F1 ∪ Adv I2 ∪ Adv I7）

Task 2 Interfaces / Step 3 に **どれか 1 本**を exact 記載する（推奨は 1）。

1. `loginAsNewUser(page, email, { seedPwaInstallTipDismissed?: boolean })`（既定 `true`）。`pwa-install-tip.spec.ts` だけ `false`。
2. 本機能 E2E は `loginAsNewUser` を使わず、seed 呼び出し禁止の raw ログイン + `goto("/planner")`。
3. ログイン後に `removeItem` + **新しい context**（当該 context に seed 用 `addInitScript` を付けない）で開き直す。「同一 page で removeItem して reload」は addInitScript が残ると再書き込みされるので禁止。

加えてカード実装段落に:

- `peekAndroidInstallPrompt()` で Android「インストールする」を出す（inject 済みなら手順リストなし）。
- `listenForAndroidInstallPrompt` の唯一の呼び出し点は `main.tsx` の `createRoot` より前。surface 分岐で listen しない。
- `useAndroidInstallPrompt` は peek の薄いラップでもよい。Produces に名前を残すか、peek を正と明記する。

### MF-P2 — 既定 dismiss を spec §9.2 / MF-I3 に閉じる（Pri F2 ∪ Adv I1 ∪ N2）

1. **`evaluate` を正本として書く文を削除する。** `auth.setup.ts` も **最初の `goto` より前**に `context.addInitScript`（または page）。`storageState()` はその結果を保存するだけ。着地後 evaluate は二重化なら残してよいが、第一手段にしない。
2. `auth.ts` L206 は session 手注入だけが禁止、本フラグの addInitScript は別、と plan 本文に書く。
3. helper は **context 優先**。Interfaces の型を Step 3 実装（`(script, arg)`）に合わせる。`loginAsNewUser` / `authenticatedPage` は `page.context()` に seed。
4. Task 2 Files に名前で固定する: `e2e/fixtures/auth.ts`（`loginAsNewUser`） / `e2e/fixtures/seed-onboarding.ts`（再訪は同一 context の addInitScript が効くこと） / `e2e/specs/auth.setup.ts` / `e2e/fixtures/session-auth.ts` / `e2e/specs/auth-recovery.spec.ts` / `e2e/specs/oauth-mock.spec.ts`。`requestMagicLinkAndReadUrl` の直後ではなく、**magic-link `goto` より前**にその context へ seed。
5. `context.newPage()` を持つ spec（`generation-recovery-results.spec.ts` / `shopping-list-races.spec.ts`）は、親 fixture が context seed 済みなら **追加不要**と明記。未 seed の raw context だけヘルパ必須。
6. 受け入れ 9 の `heading.first()` 非侵食: `mobile-accessibility.spec.ts` L256 を「名前が `ホーム画面に置く` ではない」まで落とすか、Task 5 の確認対象に入れる。Task 5 で既存 E2E 全件は回さない。

### MF-P3 — generator 機械契約（Pri F3 ∪ Adv I4 ∪ Adv I6 ∪ Adv I5 の CI 部）

Task 4 Step 3 に手順（または 40 行以内の入出力）を埋め、RED を機械化する。

1. `CACHE_NAME` = `kondate-shell-` + SHA-256 先頭 **12 hex**。入力は「UTF-8 昇順 URL を `\n` 結合」+「非ハッシュ Precache 各ファイル内容の SHA-256 を URL 順で `\n` 結合」。`Date.now()` / 乱数禁止。`expect(cacheName).toMatch(/^kondate-shell-[0-9a-f]{12}$/)`。
2. 非ハッシュ = パスに Vite ハッシュ（`-` + 8 桁以上 hex）を含まないもの（`/`、`/manifest.webmanifest`、`/icons/*`）。
3. **`/` の内容は `dist/index.html` のバイト。** `index.html` 1 バイト変更で `CACHE_NAME` が変わることを assert。
4. 収集は各 chunk の `file` + `css[]` + `assets[]` だけ（拡張子 `.js` / `.css`）。`src` / `imports` / `dynamicImports` は見ない。
5. fixture manifest を実形に寄せる: entry の `file`/`css`/`assets` に js/css/woff2/woff/webp、別キー `index.html`、`imports` / `dynamicImports`。期待は `.js`/`.css` と固定 URL（`/`・manifest・icons）のみ。`.woff` / `.woff2` / `.webp` / `/index.html` / `/api` は assert で排除。
6. esbuild `define` は `JSON.stringify` で文字列化する（未 stringify の identifier 置換を禁止）。
7. Task 4 Step 5 の dist 存在は受け入れ 1 の一部。**MF-I4.2（200 かつ非 redirect）の代替にしない。** リストに `/index.html` が無いことが CI 契約。ホストの 200 非 redirect は §9.3 手動。

### MF-P4 — メモリ dismiss の RED（Pri F4）

`home-screen-install-card.test.tsx` に `setItem` throw fixture を追加する。

- click 後、同一マウントで見出し「ホーム画面に置く」が無い。
- storage 空の再マウント（reload 相当）では再表示する。

Task 1 の `writeInstallTipDismissed` が false を返す契約は維持。

### MF-P5 — `tsc -b` の通し方（Pri F5 ∪ Adv M1）

- `src/pwa` を `tsconfig.app.json` から外さない。WebWorker lib を app tsconfig に足さない。
- `sw-defines.d.ts`（または隣接）に `ServiceWorkerGlobalScope` への狭い宣言を置く。
- `service-worker.ts` は `const sw = self as unknown as ServiceWorkerGlobalScope` のような **1 箇所**の境界キャストに閉じる。unchecked cast をイベントごとに散らさない。

### MF-P6 — 静的ヒットは PRECACHE 所属のみ（Pri F6 ∪ Adv I3）

1. `decideServiceWorkerFetch` に `precachePathnames: ReadonlySet<string>` を足す。pathname 非所属の静的 GET は `passthrough`（または hit 禁止の network-only）。SW はヒット返却前に pathname を見る。
2. 判定順は spec §7.3: 非 GET → 他 origin → **API / callback** → navigate → 静的。
3. RED 必須: `mode:"navigate"` + `/api/usage-today` / `/api` / `/auth/callback` / `/auth/callback/` → **passthrough**（`respondWith` しない）。
4. 推奨 1 行: シェル miss は元の catch 引数を再 throw する（Pri F7）。

---

## Residual（must-fix 後も残る / 同一改訂推奨）

同一改訂で閉じるとよいが、開始阻止にしない:

| 項目 | 扱い |
| --- | --- |
| Pri F9 §9.3 / 受け入れ 1–10 | Task 5 に箇条書き転記。「実装 PR 説明に貼る。CI ゲートにしない」 |
| Pri F10 path RED | `/emergency-menus` と `/emergency-menus/x` を true、`/onboarding` `/privacy` を false |
| Pri F11 | `write-pwa-icons.mjs` は作ったときだけ `git add` |
| Pri N1 | Create / Modify の誤記 |
| 設定の BIP ボタン RED | spec「出してよい」。出すなら 1 本。出さないなら残差 |
| Adv M2 行番号 | `PlanSettingsSection` コンポーネント名を正とする |
| Task 2 と Task 4 の `main.tsx` | strip → BIP → register → `createRoot` を Task 4 に 1 行 |

設計残差（plan が引き上げないこと自体は正しい）:

| 残差 | 扱い |
| --- | --- |
| iOS standalone ストレージ分離 / 再ログイン | spec §2.3 |
| standalone 内 OAuth / マジックリンク | 既存 continuation |
| デプロイ直後 1 回の旧シェル | 更新方針 |
| **A10: 旧 SW 制御中の `addAll("/")` が旧 HTML を新キャッシュへ入れる** | §2.3 の変種。オンラインナビは network-first。閉じるなら spec |
| 通信断はシェルのみ | オフライン面は作らない |
| デスクトップ初回カードなし / `other` UA | 設定節のみ |
| CriOS / FxiOS は Safari 手順 | §2.3 |
| インストール成功後も「わかりました」まで残す | §8.5 |
| 実 SW・実機は CI 外 | §9.2–9.3 |
| 旧 SW kill switch / DEV 残存 SW 解除なし | §2.3 |
| カードが Outlet を押し下げ CTA が沈む | overlay しない判断 |
| Adv M3 AppShell storage mock 任意 | 未ログイン既定で既存 heading は守れる |

---

## Spec MF（設計二次）↔ plan

| Spec MF | plan 現状 | 二次 |
| --- | --- | --- |
| MF-I1 `build.manifest` + `sw-defines` | Task 4 `config()` + 型ファイル | 方向充足。**通し方が MF-P5** |
| MF-I2 収集 + フォント除外 | 「Spec §7.1–7.2」+ woff2 | **機械契約が MF-P3** |
| MF-I3 E2E `addInitScript` | helper + 一部 fixture | **evaluate 正本・列挙欠けが MF-P1/P2** |
| MF-I4 200 非 redirect / MIME | Task 3 MIME、シェル `/`、`/index.html` 禁止 RED | MIME 充足。ホスト 200 は §9.3。**リスト契約を MF-P3 で明示** |
| MF-I5 自 `CACHE_NAME` / callback `/` | snippet + `isAuthCallbackPath` | 自キャッシュ充足。**所属判定と navigate+API が MF-P6** |
| MF-I6 非ハッシュ内容ハッシュ | 「内容を変えると名が変わる」 | **`/` → `index.html` が MF-P3** |
| MF-I7 `_headers` 先頭 `/sw.js` | Task 3 exact prefix | 充足 |
| MF-I8 BIP モジュール初期化 | `main.tsx` + inject | 呼び出し点充足。**カード peek が MF-P1** |
| MF-I9 案内残差 | 実装しない | spec §2.3。plan 非対象で可 |

---

## 結論（レビュー時点）

| 項目 | 結果 |
| --- | --- |
| 判定 | **`REVISE_PLAN`** |
| Critical must-fix | 0 |
| Important must-fix | **MF-P1…P6** |
| spec 再改訂 | 不要 |
| 次 | plan 本文へ MF 反映 → 実装 Task 開始可（**APPROVE_WITH_RESIDUALS**） |

**メタ:** implementation plan 二次検証。成果物は本ファイルのみ。spec / plan / 実装は未編集。
