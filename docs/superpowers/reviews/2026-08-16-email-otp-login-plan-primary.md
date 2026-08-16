# 1次レビュー: メール 6 桁番号ログイン Implementation Plan

**対象 Plan:** [`docs/superpowers/plans/2026-08-16-email-otp-login.md`](../plans/2026-08-16-email-otp-login.md)
**対象 Spec:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)（MF-C1 / MF-I1…I8 反映済み）
**照合先（実装が正）:**
`src/features/auth/login-page.tsx` / `login-page.test.tsx` /
`src/features/auth/auth-gateway.ts` / `auth-flow.ts` /
`src/features/auth/auth-callback-page.tsx` / `auth-callback-page.test.tsx` /
`src/features/auth/auth-cleanup.ts` / `magic-link-state.ts` /
`src/features/auth/auth-provider.tsx` /
`src/app/accessibility.test.tsx` /
`src/features/landing/free-landing-page.tsx` /
`e2e/fixtures/auth.ts` / `e2e/specs/auth.setup.ts` /
`e2e/specs/auth-recovery.spec.ts` / `e2e/specs/oauth-mock.spec.ts` /
`e2e/specs/auth-callback-security.spec.ts` /
`docs/deployment/supabase.md` /
`infra/supabase.override.yaml` / `infra/supabase/docker-compose.yml` /
`infra/supabase/CONFIG.md` / `compose.yaml` / `compose.e2e.yaml`
**照合 spec reviews:** [`2026-08-16-email-otp-login-secondary.md`](./2026-08-16-email-otp-login-secondary.md)（MF-C1 / MF-I1…I8）
**レビュー種別:** Plan 一次（Spec↔Plan 網羅・Auth ロック・leftover 例外がコード化されているか・token_hash pending 非書込・テンプレ両通・OTP 3600・E2E 二系統・generateLink schema・placeholder / interface drift）
**レビュー日:** 2026-08-16
**編集:** なし（本ファイルのみ。Spec / Plan / 製品コードは未編集）

---

## Summary

Plan は改訂後 Spec を Task 1–6 に落としており、Auth ロック 4 export 非再定義・メール用 Continuation 非新設・`emailRedirectTo` 非付与・番号非保存・CSP / `@shared/safety` 非緩和は live tree と衝突しない。MF 対応表は Task 番号を持っている。leftover Navigate 例外は handwave ではなく `emailOtpCompletedRef` + leftover-clear 抑止としてコード化されている。`token_hash` は pending を書かないと Task 2 RED が固定する。テンプレは Magic + Confirm 両通。OTP exp は **3600**（86400 を正にしない）。E2E は製品 6 桁と bootstrap 非 goto に分かれている。`loginAsNewUser` の action_link 非 goto は live `generateLink` schema（`hashed_token`）で実装可能。

一方、このまま Task 実行に入ると (1) **MF-C1 の「再マウントしても session が残る」が component ref では成立しない**、(2) **MF-I1 のローカルテンプレ配信 URL が placeholder のまま、Task 4 GREEN が静的検査だけで Mailpit 本文を見ない**、(3) **MF-I4 の verify / 送信床が数字で固定されていない**。Critical（認可バイパス・安全保証の誤表示）は Plan どおりでは起きない。Important が複数 open のため **REVISE_PLAN**。

## Verdict

**REVISE_PLAN**

- Critical: 0
- Important: 3
- Minor: 6

F1–F3 を Plan 本文に埋めてから実装開始。

---

## MF 対応表

| MF | Spec | Plan Task | 判定 |
| --- | --- | --- | --- |
| MF-C1 leftover 例外・即 Navigate・再マウント session | §3.3 | Task 3 | **不完全（F1）**。Navigate はコード化。再マウント / leftover-capable 再表示は ref では守れない |
| MF-I1 テンプレ両通・URL 削除本体 | §5 / §8.2 | Task 4 | **不完全（F2）**。両通と 3600 は書く。配信 URL が `…`、`MAGIC_LINK_ENABLED` 未決、GREEN が静的 |
| MF-I2 Google × 番号 sibling | §4.3 | Task 3 | 充足。Google 開始で snapshot/マス破棄。verify 直前に dummy flow 無しで `listUnexpiredAuthFlows` + `clearAuthFlow`。`ContinuationApi.create` 禁止 |
| MF-I3 既定 `/welcome`・snapshot に `returnTo` 無し | §3.3 / §4.1 | Task 3 | 充足。`sanitizeLoginReturnPath`、snapshot は email / resendAvailableAt / storedAt |
| MF-I4 寿命 ≤3600・同一値・86400 禁止 | §5 | Task 4 + Global | **不完全（F3）**。exp 3600 / length 6 は固定。`RATE_LIMIT_VERIFY` / `SMTP_MAX_FREQUENCY` / `RATE_LIMIT_OTP` は数字が無い |
| MF-I5 製品 E2E / bootstrap 分割 | §7 | Task 5 | 充足。製品は 6 桁。`loginAsNewUser` は action_link 非 goto。recovery メール callback 2 本削除 |
| MF-I6 `token_hash` pending / verify / deposit 無し | §4.4 | Task 2 + 3 | 充足。`writePendingAuthDeposit` 非実行・`verifyOtp` 非呼び出し・`unbound_callback`。confirm CTA 削除 |
| MF-I7 単一 in-flight・写像三分割禁止 | §3.2 / §4.1 / §6 | Task 2 + 3 | 充足。写像表あり。in-flight + stale 破棄は Task 3 |
| MF-I8 6 マス正規化 / composition / a11y | §3.2 | Task 1 | 充足。NFKC・結合 input・`aria-label`・fieldset。verify は親 |

---

## Findings

### F1 — Severity: Important

- **id:** F1
- **Location:** Plan Task 3 Step 1.4 / Step 3 leftover 例外; Spec §3.3 / MF-C1; live `login-page.tsx` L242–250 / L405–419、`auth-gateway.ts` L639–648 / L581–626、`free-landing-page.tsx` L71–75、`login-page.test.tsx` L530–575 / L648–685
- **Description:** leftover Navigate 例外は **handwave ではない**。Task 3 は `emailOtpCompletedRef.current = true` のあと `<Navigate replace>` し、leftover-capable でも leftover-clear を走らせないとコード化している。即 leave の半分は実装可能。

  しかし MF-C1 / Spec §3.3 Vitest は「leftover-capable で verify 成功 → Navigate。**再マウントしてもその session が残る**」である。一次 F1 の再表示（戻る・再読込後の `/login`・PWA 再前面化）も同じ穴である。component ref は **同じ Login インスタンスにしか無い**。

  live leftover-clear は sibling continuation が無いと **無条件 local signOut**（`clearLeftoverLoginSessionIfNoSiblingCompletion` → `discardedExchangeSessionKey === null` + context あり）。メール OTP は Continuation を書かない（Plan も禁じている）。よって:

  1. leftover-capable `/login` で verify → Navigate `/welcome`（ref で成功）。
  2. LP CTA は query 無し `/login`（leftover-capable）。成功後に `/login` を開き直す、RTL で leftover-capable を remount する、戻るで leftover URL に戻る、のいずれかで **新しい Login がマウント**する。
  3. ref は false。C-R4 が今の session を leftover persist として signOut する。

  Task 3 Step 1 の「再マウントで session が残る（`signOut` されない）」と Step 3 の ref 実装は矛盾する。既存 C-R2 / C-R4（inbound leftover は Navigate せず signOut）は **維持すべき**で、OTP 成功 session だけを区別する印が無い。
- **Why it matters:** 主経路（LP → query 無し `/login` → 番号 → `/welcome` → あとで `/login`）が MF-C1 の再表示契約を満たさない。実装者が Step 3 snippet どおりに書くと Step 1 remount が赤のままか、C-R2 を壊して inbound leftover まで Navigate させる。
- **Suggestion:** Task 3 Interfaces に次の 1 本を固定する（Continuation 新設は禁止のまま）。
  1. leftover-clear / leftover Navigate 抑制をスキップする印は **マウントをまたぐ**。番号は入れない。例: sessionStorage の短寿命完了印（TTL ≤ 画面 residual 60s、logout で `MAGIC_LINK_RESIDUAL_KEYS` に足す）、または verify 成功 session の fingerprint を「このタブで今立てた」として leftover-clear が無視する。
  2. RED を具体化する: leftover-capable で `verifyEmailOtp` complete → Navigate。**同じ leftover-capable URL で Login を unmount/remount** しても `signOut` されない。inbound leftover（OTP 成功印なし）の C-R2 / C-R4 は残す。
  3. 印が無い inbound leftover persist は今どおり local signOut。
- **Status:** open

### F2 — Severity: Important

- **id:** F2
- **Location:** Plan Task 4 Step 2 YAML `http://host.docker.internal:…` / Self-review「既存 mail パターン」; Spec §5 / MF-I1; live `infra/supabase.override.yaml` L64–77（`GOTRUE_MAILER_TEMPLATES_*` 無し）、`infra/supabase/docker-compose.yml` L162–180 / L115–139（auth に templates volume 無し）、`compose.yaml` mailpit は SMTP/UI のみ、repo にメール HTML 無し、`CONFIG.md` L285–291（TEMPLATES_* は **URL**）
- **Description:** 両テンプレ同一 HTML・件名 `こんだて日和の番号`・`{{ .Token }}` のみ・Invite/Recovery 非接触は Spec どおり。問題は **GoTrue が本文を読む経路**が未決なこと。

  - `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` / `_CONFIRMATION` は CONFIG 上 HTTP URL。auth コンテナは templates を bind していない。`file://` が使える根拠は live に無い。
  - Self-review は「既存 mail パターンに合わせる（新規ホストを発明しない）」と書くが、**既存パターンは無い**。
  - Task 4 GREEN は `scripts/otp-email-templates.test.mjs` の **ファイル文字列検査だけ**。Mailpit 本文に 6 桁があり `http` / `https` が無い（Spec §5 受け入れ）は見ない。
  - `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` の false / 「URL 無しテンプレが唯一の防御」のどちらも Task 4 に無い（MF-I1 必須）。

  実装者は placeholder を残すか、未到達 URL を書いて静的 GREEN を通せる。そのとき GoTrue は既定 ConfirmationURL テンプレのまま送り、Gmail 先読み / リンク踏破で番号が焼ける（一次 F4 / 敵対 I1）。
- **Why it matters:** `emailRedirectTo` 省略は十分条件ではない、が Plan の検証ネットから落ちる。製品 E2E は Task 5/6 でエージェントが回さない。
- **Suggestion:**
  1. 配信 URL を 1 本に固定する。auth が到達できる既存 HTTP（例: app が上がったあと `http://app:5173/…` で Vite `public/` 配下の同一 HTML を指す、または override で auth に templates を bind し、GoTrue が file を受け付けるならその **検証済み** スキーム）。`host.docker.internal:…` を残さない。Linux で `host.docker.internal` を使うなら `extra_hosts` を本文に書く。
  2. Task 4 か Task 5 のユニットに「override の両 TEMPLATES が同じ到達可能 URL / 同じファイル」を固定。Mailpit 受け入れは Task 5 の `requestEmailOtpAndReadCode` が担うと明記する。
  3. `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` を切るか、残すなら「URL 無しテンプレが唯一の防御」を Task 4 と `docs/deployment/supabase.md` に書く。
- **Status:** open

### F3 — Severity: Important

- **id:** F3
- **Location:** Plan Global Constraints / File map ロック値 / Task 4 Produces; Spec §5 / MF-I4; live `CONFIG.md` L243–244 / L255 / L650 / L655（OTP_EXP 既定 **86400**、SMTP_MAX_FREQUENCY 既定 1m、RATE_LIMIT_OTP / VERIFY 既定 30/時）、`compose.e2e.yaml` L25–26（E2E だけ `SMTP_MAX_FREQUENCY=1s`）、`.env.example` 画面再送 60、`.deploy.env` 300
- **Description:** Plan は寿命 **3600** と桁 **6** を数字で固定し、86400 を正にしない。これは MF-I4 の寿命半分を満たす。しかし MF-I4 / Spec §5 は **`GOTRUE_RATE_LIMIT_VERIFY` と送信床（`SMTP_MAX_FREQUENCY` / `RATE_LIMIT_OTP`）もローカルと本番で同一**、かつ画面再送より緩めないと要求する。Plan のロック値は画面再送を「既存 `VITE_MAGIC_LINK_RESEND_SECONDS`」とだけ言い、verify / 送信床の数字が無い。

  実装者が override に exp/length だけ書くと、local verify は CONFIG 既定 30/時、hosted 公式は IP あたり 360/時のまま「同じ値」が嘘になる。画面 60s に対し GoTrue 送信床を緩める（または e2e の 1s を製品 override に写す）余地も残る。
- **Why it matters:** 6 桁の探索空間は §2.3 残差。寿命 3600 まで閉じても、verify 上限を local/prod で揃えないと MF-I4 の「Plan が読んで固定」が再先送りになる。
- **Suggestion:** Task 4 に数字を書く。例（hosted に合わせるならその旨）:
  - `GOTRUE_MAILER_OTP_EXP: "3600"`（済）
  - `GOTRUE_MAILER_OTP_LENGTH: "6"`（済）
  - `GOTRUE_RATE_LIMIT_VERIFY` / `GOTRUE_RATE_LIMIT_OTP` を同一整数（local override と `docs/deployment/supabase.md` の Dashboard 値）
  - `GOTRUE_SMTP_MAX_FREQUENCY` を画面再送以上（local 画面 60s なら ≥60s）。`compose.e2e.yaml` の `1s` は suite 専用と明記し、製品 override に写さない
- **Status:** open

### F4 — Severity: Minor

- **id:** F4
- **Location:** Plan Task 5 Interfaces / Step 1 `loginAsNewUser`; Spec §7 / MF-I5; live `e2e/fixtures/auth.ts` L25–29 / L211–247
- **Description:** `generateLinkPropertiesSchema` は `action_link` / `hashed_token` / `verification_type` のみ。`email_otp` は無い。`page.goto(action_link)` をやめて session を載せるのは **実装可能**: 既にある `hashed_token` をページ外 `verifyOtp({ token_hash, type: "email" })`（fixture の service admin または `page.request` POST `/auth/v1/verify`）し、現行どおり storage へ載せて `/planner` を開く。

  Plan の「Playwright `request` で token 取得」は、`request.get(action_link)` と読める。HTTP クライアントは `Location` の fragment を落とすことがあり、実装者が未検証の `email_otp` に逃げる余地がある。
- **Why it matters:** 二次 MF-I5 は「未検証フィールドを正にしない」。action_link GET に頼ると bootstrap が不安定になる。
- **Suggestion:** Task 5 に「`properties.hashed_token` + ページ外 `verifyOtp`。`email_otp` を schema に足さない。`page.goto(action_link)` も `request.get(action_link)` も使わない」と書く。
- **Status:** open

### F5 — Severity: Minor

- **id:** F5
- **Location:** Plan Task 3 Files / Task 5 Files / Task 6 vitest 範囲; live `src/app/accessibility.test.tsx` L263–284、`e2e/specs/auth-callback-security.spec.ts` L54 / L116
- **Description:** 主 CTA 改名と `AuthGateway` メソッド追加の参照が Files から落ちている。`accessibility.test.tsx` は `AuthGateway` オブジェクトリテラル + `ログイン用メールを送る`。`auth-callback-security.spec.ts` も同ボタン名（@smoke）。Task 6 の vitest は auth 4 ファイルだけで、この穴を見ない。Task 3 typecheck はリポジトリ全体なので accessibility の型割れはそこで見つかるが、E2E smoke は人間待ち。
- **Suggestion:** Task 3 Files に `src/app/accessibility.test.tsx`。Task 5 Files / `git add` に `e2e/specs/auth-callback-security.spec.ts`。grep 対象を本文に残す。
- **Status:** open

### F6 — Severity: Minor

- **id:** F6
- **Location:** Plan Task 2 Interfaces; live `auth-gateway.ts` L412–422
- **Description:** `AuthGateway` へのメソッド追加は延長でありロック再定義ではない。ただし Task 2 GREEN は `auth-gateway.test.ts` だけ。interface を必須メソッドに足すと `login-page.test.tsx` / callback / accessibility のオブジェクトリテラルが型割れする。Task 3 typecheck まで赤が残る。
- **Suggestion:** Task 2 Interfaces に interface 追記を明示する。Task 2 GREEN のあとに typecheck を置くか、テスト mock を Task 2 で同時更新する。
- **Status:** open

### F7 — Severity: Minor

- **id:** F7
- **Location:** Plan Task 3 Step 1 RED; Spec §3.2 / §6
- **Description:** 単一 in-flight の RED はある。無いもの: `unavailable` 後に再送できる、`メールアドレスを変更` が snapshot とマスを捨てる、確認中に再送/変更が押せないことの明示、Task 1 の 320 CSS px 横スクロール禁止。
- **Suggestion:** Task 3 RED に unavailable → 再送可、変更で idle 復帰を 1 本ずつ。320px は Task 1 か visual 契約で一文。
- **Status:** open

### F8 — Severity: Minor

- **id:** F8
- **Location:** Plan Task 2 `completeCallback`; Spec §4.4; live `auth-gateway.ts` L1568–1573 `resumeFlow`
- **Description:** 新規 `token_hash` は pending を書かないので、通常の古いメールは unbound で閉じる。既存 TTL 内 pending を `resumeFlow` が `token_hash` として verify する経路は残る（敵対 I2 残差）。本スライスの受け入れ（`?token_hash=` を開いても deposit / verify しない）は満たせる。
- **Suggestion:** Task 2 に「既存 pending の resume は残差。新規 `token_hash` URL では pending キーを作らない」と一文。
- **Status:** residual

### F9 — Severity: Minor

- **id:** F9
- **Location:** Plan Task 3 snapshot; live `login-page.tsx` L62–68 / L128–147（`magicSentUi` が `flowId` 必須）、`auth-cleanup.ts` L45–50
- **Description:** snapshot から `flowId` を外すと、現行 `readMagicSentUi` は即破棄する。Task 3 は `magic-link-state.ts` を指すが、TTL / キー正本は `login-page.tsx`。キー名を変えるなら `MAGIC_LINK_RESIDUAL_KEYS` へ追加が要る。
- **Suggestion:** 既存キーを流用して `flowId` を任意にするか、新キーを cleanup リストへ足すと Task 3 に書く。
- **Status:** open

---

## 非欠陥（確認済み）

- **Auth ロック 4 export:** 再定義していない。`sendEmailOtp` / `verifyEmailOtp` は `AuthGateway` 延長。`credentialKind: "token_hash"` は残して新規作成しない。
- **メール用 Continuation:** 作らない。sibling は既存 `clearAuthFlow`。ダミー completed id を禁じている。
- **leftover 例外はコード変更:** handwave ではない（F1 は機構不足であり「書け」欠落ではない）。
- **`token_hash` pending 非書込:** Task 2 RED が `writePendingAuthDeposit` 非実行・`verifyOtp` 非呼び出し・`unbound_callback` を固定。code 同時載りは今どおり unbound。
- **テンプレ両通:** Magic Link と Confirm を同じ HTML。Invite / Recovery 非接触。
- **OTP exp 3600:** 86400 を正にしない。桁 6。
- **E2E 製品 vs bootstrap:** 製品は UI + Mailpit 6 桁。`requestMagicLinkAndReadUrl` の URL 正規表現を残さない。`loginAsNewUser` は製品ログイン定義にしない。
- **`loginAsNewUser` × generateLink schema:** `hashed_token` でページ外 verify すれば action_link をブラウザで踏まずに現行 hash 注入相当ができる（F4 は書き方の話）。
- **成功既定 `/welcome`:** `sanitizeLoginReturnPath`。`/planner` を login 既定にしない。
- **番号非保存 / ログ:** snapshot に番号も `returnTo` も入れない。
- **CSP / `@shared/safety`:** 触らない。
- **§2.3 残差:** Google standalone、メールアプリ往復、共有端末 60s、6 桁空間、Admin generateLink オペレータ面。

---

## 矛盾チェック（Global Constraints / Auth ロック）

| 項目 | 結果 |
| --- | --- |
| 4 export 再定義 | なし |
| メール Continuation 新設 | 禁止を守っている |
| leftover Google 規則の全面緩和 | inbound leftover の C-R2/C-R4 は残す意図。OTP 成功印だけ例外（F1 で印の寿命が足りない） |
| `emailRedirectTo` 付き送信 | 付けない |
| 86400s を正 | しない |
| ブラウザへ `@shared/safety` | しない |
| `git push` / 本番 Dashboard 操作をエージェントにやらせる | しない（docs 差し替えのみ） |

---

## Final

Verdict: **REVISE_PLAN**

Critical: **0** / Important: **3** / Minor: **6**

Important+: **F1, F2, F3**

Review path: `docs/superpowers/reviews/2026-08-16-email-otp-login-plan-primary.md`
