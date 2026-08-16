# 2次検証: メール 6 桁番号ログイン Implementation Plan

- **役割:** 独立 secondary verifier（1次・敵対の著者コンテキストに依存せず、spec / plan / live を再照合）
- **日付:** 2026-08-16
- **対象 plan:** [`../plans/2026-08-16-email-otp-login.md`](../plans/2026-08-16-email-otp-login.md)
- **照合 spec:** [`../specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)（MF-C1 / MF-I1…I8 反映済み）
- **入力:**
  - 1次: [`2026-08-16-email-otp-login-plan-primary.md`](./2026-08-16-email-otp-login-plan-primary.md)（**REVISE_PLAN** / C0 I3 M6）
  - 敵対: [`2026-08-16-email-otp-login-plan-adversarial.md`](./2026-08-16-email-otp-login-plan-adversarial.md)（**BLOCK_WITH_CONDITIONS** / C2 I6 M3）
  - 設計二次: [`2026-08-16-email-otp-login-secondary.md`](./2026-08-16-email-otp-login-secondary.md)（spec MF-C1 / MF-I1…I8）
- **照合 live tree:**
  `src/features/auth/login-page.tsx` / `login-page.test.tsx` /
  `src/features/auth/auth-gateway.ts` / `auth-flow.ts` /
  `src/features/auth/auth-callback-page.tsx` / `auth-callback-page.test.tsx` /
  `src/features/auth/auth-cleanup.ts` / `src/main.tsx` /
  `src/features/landing/free-landing-page.tsx` /
  `e2e/fixtures/auth.ts` / `e2e/specs/auth.setup.ts` /
  `infra/supabase.override.yaml` / `infra/supabase/docker-compose.yml` /
  `infra/supabase/CONFIG.md` / `compose.yaml` / `compose.e2e.yaml` /
  `docs/deployment/supabase.md`
- **手法:** 静的再照合のみ。spec / plan / 実装は未編集（本ファイルのみ成果物）。
- **語彙:** 1次 REVISE と敵対 BLOCK は「plan 本文を直してから Task 開始」で一致。二次ラベルは **`REVISE_PLAN`**。spec 再改訂は不要。

---

## Summary

plan は改訂 spec を Task 1–6 に割っており、Auth ロック 4 export 非再定義・メール用 Continuation 非新設・`emailRedirectTo` 非付与・番号非保存・CSP / `@shared/safety` 非緩和は live と衝突しない。成功 leave の既定 `/welcome`、OTP exp **3600**、桁 **6**、テンプレ両通の意図、製品 E2E と bootstrap の分割方針は本文にある。Critical（認可バイパス・安全保証の誤表示）は **plan どおりでは起きない**。新 Critical は立てない。

二次の核:

1. **leftover 例外はコード化されているが、印が component ref だけ。** 同一マウントの Navigate は書ける。MF-C1 の「再マウントしても session が残る」は ref では成立しない。敵対 C1 の「初回成功そのものが in-flight leftover に殺される」は **膨らみ**（leftover-clear は指紋 null で `getSession` を待たず即 signOut。初回マウントは未認証で終わる）。残る本物は一次 F1 と同じ再マウント穴。
2. **テンプレ配信 URL が placeholder。** `GOTRUE_MAILER_TEMPLATES_*` は HTTP URL。auth に volume 無し。`host.docker.internal:…` は未決。GREEN はファイル文字列。敵対 C2 は同じ穴を Critical に上げているだけで、F2 と別件ではない。
3. **verify / 送信床の数字が無い。** exp 3600 は足りる。MF-I4 の同一値は未閉鎖。
4. **敵対の追加 Important のうち独立なのは 3 本。** sibling ヘルパ（I1）、`loginAsNewUser` の置換 API（I2、一次 F4 を昇格）、StrictMode 二重 verify（I4）。`resumeFlow` leftover pending（I3）は一次 F8 と同じ残差。

**最終: `REVISE_PLAN`**

- Critical must-fix: **0**
- Important must-fix（重複排除後）: **6**（MF-P1…P6）
- spec 再改訂: **不要**

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`REVISE_PLAN`** |
| **Critical must-fix** | **0** |
| **Important must-fix（統合後）** | **6** |
| **解除後** | **APPROVE_AS_IS**（§2.3: Google standalone / メールアプリ往復 / 共有端末 60s / 6 桁空間 / Admin `generateLink` オペレータ面 / 既存 pending の `resumeFlow`） |
| **1次との差** | F1–F3 を維持。F4 を I2 と合わせて Important に上げる。I1 / I4 を追加。F5–F9 は Minor / residual のまま。 |
| **敵対との差** | C1 / C2 は Critical ではない。C1 は F1 の再マウント穴。C1 の「初回成功が in-flight leftover に負ける」は棄却。C2 は F2。I3 は残差。I5 は F3。I6 は F2 の受け入れ網に吸収。 |

1次 REVISE と敵対 BLOCK_WITH_CONDITIONS は矛盾しない。二次は **plan 改訂で解除**と読む。

---

## Adjudication（Critical / Important）

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 |
| --- | --- | --- | --- | --- | --- |
| **Pri F1** | 1次 | Important | **CONFIRMED** | Important | **MF-P1** |
| **Adv C1** | 敵対 | Critical | **DUPLICATE / DOWNGRADE** | Important | **MF-P1**（再マウント）。初回成功の in-flight 殺しは **FALSE_POSITIVE** |
| **Pri F2** | 1次 | Important | **CONFIRMED** | Important | **MF-P2** |
| **Adv C2** | 敵対 | Critical | **DUPLICATE / DOWNGRADE** | Important | **MF-P2** |
| **Adv I6** | 敵対 | Important | **CONFIRMED** | Important（吸収） | **MF-P2** |
| **Adv M3** | 敵対 | Minor | **CONFIRMED** | Minor（吸収） | **MF-P2**（`MAGIC_LINK_ENABLED`） |
| **Pri F3** | 1次 | Important | **CONFIRMED** | Important | **MF-P3** |
| **Adv I5** | 敵対 | Important | **DUPLICATE** | Important | **MF-P3** |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | Important | **MF-P4** |
| **Adv I2** | 敵対 | Important | **CONFIRMED** | Important | **MF-P5** |
| **Pri F4** | 1次 | Minor | **CONFIRMED / UPGRADE** | Important | **MF-P5** |
| **Adv I4** | 敵対 | Important | **CONFIRMED** | Important | **MF-P6** |
| **Adv I3** | 敵対 | Important | **DOWNGRADE** | residual | 一次 F8。新規 `?token_hash=` は Task 2 で閉じる |
| Pri F5 | 1次 | Minor | **CONFIRMED** | Minor | residual（同一改訂推奨） |
| Pri F6 | 1次 | Minor | **CONFIRMED** | Minor | residual |
| Pri F7 | 1次 | Minor | **CONFIRMED** | Minor | residual |
| Pri F8 | 1次 | Minor | **CONFIRMED** | residual | 既存 pending `resumeFlow` |
| Pri F9 | 1次 | Minor | **CONFIRMED** | Minor | residual（キー変更なら cleanup） |
| Adv M1 | 敵対 | Minor | **CONFIRMED** | residual | bootstrap `/planner` |
| Adv M2 | 敵対 | Minor | **CONFIRMED** | Minor | residual（login が `sendMagicLink` を呼ばない RED） |

### 焦点 4 件

**leftover remount vs component ref（F1 / C1）**

plan Task 3 Step 3 の `emailOtpCompletedRef` は **同じ Login インスタンス**にしか無い。live leftover-capable は空 search または `authError`（`login-page.tsx` L242–250）。マウントで即 `clearLeftoverLoginSessionIfNoSiblingCompletion`（L405–410）。それは `discardedExchangeSessionKey: null` + context ありで **`getSession` を飛ばし即 local signOut**（`auth-gateway.ts` L639–648 → L592–626）。メール OTP は Continuation を書かない。LP CTA は query 無し `/login`（`free-landing-page.tsx` L71–75）。C-R2 / C-R4 は sibling 無し leftover の非 Navigate + signOut を固定（`login-page.test.tsx` L530–575 / L648–685）。

同一マウントの verify → Navigate は ref で書ける。再マウント（成功後に leftover-capable `/login` を開き直す / RTL remount / 戻る）では ref が false で C-R4 が今の session を消す。Spec §3.3 / MF-C1 の Vitest はこれ。

敵対 C1 の追加主張「初回成功より前に走った leftover が cancel されず、verify 後の session を殺す」は成立しない。指紋 null 経路は 5s の `getSession` 待ちが無く、未認証マウントで即終わる。effect 依存は `authError` / `search` だけなので verify では再走しない。Critical への引き上げは **膨らみ**。C1 は F1 と同じ再マウント穴。

C1 是正の「マウント時点指紋だけ」は **再マウントでは足りない**。再マウント時の persist は OTP session そのものなので、指紋一致なら消す実装だと MF-C1 を再び破る。必要なのは F1 どおり **マウントをまたぐ完了印**（番号を入れない。session fingerprint または短寿命 sessionStorage。logout で `MAGIC_LINK_RESIDUAL_KEYS` に足す）。

**template delivery URL（F2 / C2）**

`CONFIG.md` L285–291: `GOTRUE_MAILER_TEMPLATES_*` は **URL**。`infra/supabase.override.yaml` L64–77 にキー無し。`docker-compose.yml` auth（L115–180）に templates volume 無し。`compose.yaml` の mailpit は SMTP/UI のみ。plan Task 4 は `http://host.docker.internal:…` または file。Self-review の「既存 mail パターン」は live に無い。Linux で `host.docker.internal` は未定義（`extra_hosts` も plan に無い）。GREEN は YAML / HTML 文字列。Mailpit 本文は Task 4/6 の必須コマンドに無い。

敵対 C2 は同じ未決経路を「既定 ConfirmationURL のまま送る」と Critical にした。認可バイパスでも安全保証の誤表示でもない。実装者が placeholder を残すと MF-I1 が落ちる、という **Important の plan 穴**。C2 は F2。Mailpit 本文と `http`/`https` 拒否パーサ（I6）と `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED`（M3）は同じ網。

**rate limit numbers（F3 / I5）**

plan ロック値は `OTP_EXP=3600` / 桁 6 / 画面再送「既存 `VITE_MAGIC_LINK_RESEND_SECONDS`」だけ。Spec §5 / MF-I4 は `GOTRUE_RATE_LIMIT_VERIFY` と送信床（`SMTP_MAX_FREQUENCY` / `RATE_LIMIT_OTP`）もローカルと本番で同一、画面再送より緩めない。live CONFIG 既定は OTP 30/時・VERIFY 30/時・SMTP 1m。hosted 公式は OTP 30/時・ユーザー送信窓 60s・**VERIFY 360/時（非カスタム）**。e2e overlay は `SMTP_MAX_FREQUENCY=1s`（`compose.e2e.yaml` L25）。数字を書かないと local 30 vs hosted 360 が残り、e2e の 1s を製品に写す余地がある。I5 は F3。実行中 GoTrue の env 観測は必須にしない（エージェントはフル E2E を回さない）。

**敵対 C1/C2 は F1/F2 と別件か**

別件ではない。C1 = F1（再マウント）。C2 = F2（配信 URL）。Critical は両方とも過大。

---

## Live evidence（指示焦点）

### leftover

| 事実 | 場所 |
| --- | --- |
| leftover-capable = `authError` または search 空 / `?` | `login-page.tsx` L242–250 |
| マウントで即 leftover-clear（cancel 無し `void`） | 同 L405–410 |
| leftover-clear は指紋 `null` + context | `auth-gateway.ts` L645–648 |
| 指紋 null は `getSession` を飛ばし即 signOut | 同 L592–626 |
| leftover-capable なら authenticated でも Navigate しない | `login-page.tsx` L415–419 |
| LP CTA は query 無し `/login` | `free-landing-page.tsx` L71–75 |
| C-R2 非 Navigate / C-R4 sibling 無し signOut | `login-page.test.tsx` L530–575 / L648–685 |
| 宛先 snapshot TTL 60s。`flowId` 必須 | `login-page.tsx` L60–68 |
| cleanup キー | `auth-cleanup.ts` L45–50 |
| 本番 `<StrictMode>` | `src/main.tsx` L30 |
| login テストは Strict 無し | `login-page.test.tsx` L33–42 |
| callback は `confirmInFlightRef` + Strict RED | `auth-callback-page.tsx` L103–186、テスト L679–710 |

### テンプレ / レート

| 事実 | 場所 |
| --- | --- |
| override に `TEMPLATES_*` / OTP_EXP 無し | `infra/supabase.override.yaml` L64–77 |
| auth に templates volume 無し | `infra/supabase/docker-compose.yml` L115–180 |
| TEMPLATES は URL | `CONFIG.md` L285–291 |
| OTP_EXP 既定 86400、LENGTH 既定 6 | `CONFIG.md` L243–244 |
| SMTP_MAX_FREQUENCY 既定 1m | `CONFIG.md` L255 |
| RATE_LIMIT_OTP / VERIFY 既定 30/時 | `CONFIG.md` L650 / L655 |
| MAGIC_LINK_ENABLED 既定 true | `CONFIG.md` L353 |
| e2e だけ送信床 1s | `compose.e2e.yaml` L25–26 |
| 画面再送 local 60 / deploy 300 | `.env.example` / `.deploy.env` |
| generateLink schema に `email_otp` 無し | `e2e/fixtures/auth.ts` L25–29 |
| `loginAsNewUser` は `page.goto(action_link)` | 同 L246–247 |
| `clearSiblingUnexpiredAuthFlows` は完了 id 必須 | `auth-flow.ts` L861–870 |
| `listUnexpired` は dismiss 済みを返さない | 同 L544 |
| Google 開始は `markAuthFlowUserDismissed` | `auth-gateway.ts` L442–458 |

---

## Merged must-fix（Plan 改訂必須）

各項は **plan 本文に書く変更**（1 段落）。spec は触らない。

### MF-P1 — leftover 完了印はマウントをまたぐ（Pri F1 ∪ Adv C1 再マウント）

Task 3 Interfaces / Step 3 から「`emailOtpCompletedRef` が true なら leftover を走らせない」だけを正とする文を削除する。代わりに: leftover-clear / leftover Navigate 抑制の印は **マウントをまたぐ**（番号も `returnTo` も入れない）。推奨は sessionStorage の短寿命完了印（TTL ≤ 60s）か、verify 成功 session の fingerprint を「このタブで今立てた」として leftover-clear が無視する印。新キーなら `MAGIC_LINK_RESIDUAL_KEYS` に足す。Continuation 新設は禁止のまま。RED を exact にする: leftover-capable `/login` と `/login?authError=unbound_callback` で `verifyEmailOtp` complete → `Navigate replace`（query 無しなら `/welcome`）。**同じ leftover-capable URL で Login を unmount/remount** しても `signOut` されない。inbound leftover（OTP 成功印なし）の C-R2 / C-R4 は残し、Files に C-R4 更新を書く。マウント時点指紋「だけ」は再マウントで OTP session 自身を消すので禁止。

### MF-P2 — テンプレが auth から読める具体値 + Mailpit 本文（Pri F2 ∪ Adv C2 ∪ I6 ∪ M3）

Task 4 Step 2 の `http://host.docker.internal:…` / 「file が使えるなら」を削除する。auth から読める経路を **1 本の具体値**で書く。推奨: override で `infra/supabase/templates` を auth に bind し、GoTrue が取る URL を検証済みスキームで固定する（例: 既存 HTTP で届くならその絶対 URL。`file://` は live 根拠が無いので「使えるなら」禁止）。Linux の `host.docker.internal` 未定義を前提にし、使うなら `extra_hosts` を本文に書く。両 `GOTRUE_MAILER_TEMPLATES_*` は同じファイル / 同じ URL。件名は `GOTRUE_MAILER_SUBJECTS_*` と件名ファイルを同じ文字列。`GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` を false にするか、残すなら「URL 無しテンプレが唯一の防御」を Task 4 と `docs/deployment/supabase.md` に書く。Task 4 GREEN を YAML キー存在だけで通さない。Task 5 の `requestEmailOtpAndReadCode` が Mailpit の Magic **と** Confirm 本文を見る、と明記する。パーサ RED: 製品テンプレ相当（`{{ .Token }}` を 6 桁に置換、`http`/`https` 無し）→ ちょうど 6 桁。本文に `http` または `https` が 1 つでもあれば throw。`https://example` だけのケースだけでは足りない。

### MF-P3 — verify / 送信床を数字で固定（Pri F3 ∪ Adv I5）

Task 4 のロック値 / YAML / `docs/deployment/supabase.md` に次を書く（ローカル override と本番 Dashboard を同一整数にする）。`GOTRUE_MAILER_OTP_EXP: "3600"` と `GOTRUE_MAILER_OTP_LENGTH: "6"` は既にある。追加: `GOTRUE_SMTP_MAX_FREQUENCY: "60s"`（画面再送 local 60 以上。hosted ユーザー送信窓と同じ）。`GOTRUE_RATE_LIMIT_OTP: "30"`。`GOTRUE_RATE_LIMIT_VERIFY: "360"`（hosted `/auth/v1/verify` は IP あたり 360/時で非カスタム。local CONFIG 既定 30 のままにしない）。`compose.e2e.yaml` の `GOTRUE_SMTP_MAX_FREQUENCY: "1s"` は suite 専用と明記し、製品 override に写さない。画面再送は既存 `VITE_MAGIC_LINK_RESEND_SECONDS` のまま。実行中 auth の env 観測は必須にしない。

### MF-P4 — 完了 id 無しの sibling ヘルパ（Adv I1）

Task 3 Step 3 の「`clearSiblingUnexpiredAuthFlows` を呼び、ダミーを作らず list+clear」を 1 本に直す。login 側ヘルパ: 未期限切れの Google / `authorization_code`（および残存 `token_hash`）を **すべて** `markAuthFlowUserDismissed` + `clearAuthFlow`。ダミー completed id 禁止。`ContinuationApi.create` 禁止。`clearSiblingUnexpiredAuthFlows` は完了 id が無いので呼ばない（空文字を渡して全消し、も禁止。意図が読めない）。RED: Google flow が storage にある状態で番号 `complete` → その flow が無い。既存 RED 5（Google 開始で番号 UI 破棄）は残す。

### MF-P5 — `loginAsNewUser` のページ外 session（Adv I2 ∪ Pri F4）

Task 5 Interfaces / Step 1 に置換 API を exact に書く。`generateLinkPropertiesSchema` の `hashed_token` をページ外で `verifyOtp({ token_hash, type: "email" })`（fixture の service admin または `page.request` POST `/auth/v1/verify`）し、返った access/refresh を現行どおり storage へ載せて `/planner` を開く。`email_otp` を schema に足さない。`page.goto(action_link)` も `request.get(action_link)` も使わない。コメント「製品外 bootstrap」。製品ログイン定義にしない。`normalizeGenerateLinkActionUrl` を残すならテスト専用と Files に書く。

### MF-P6 — StrictMode で verify は 1 回（Adv I4）

Task 3 RED 3 を `<StrictMode>` 付きにする: 6 桁入力で `verifyEmailOtp` は **1 回**。実装は callback と同型の **同期 ref**（`confirmInFlightRef`。state 更新前に立てる）。`useState` in-flight だけは remount で戻るので禁止。stale 応答は捨てる。IME composition 中は親でも verify しない（Task 1 のマス契約に加え、親 effect でも見る）。

---

## Residual（must-fix 後も残る / 同一改訂推奨）

開始阻止にしない:

| 項目 | 扱い |
| --- | --- |
| Pri F5 Files 漏れ | Task 3 に `src/app/accessibility.test.tsx`。Task 5 に `e2e/specs/auth-callback-security.spec.ts` |
| Pri F6 interface 追記 | Task 2 で mock 同時更新、または Task 2 のあとに typecheck |
| Pri F7 unavailable → 再送 / 変更で idle / 320px | 同一改訂で 1 本ずつ足してよい |
| Pri F8 / Adv I3 `resumeFlow` | 既存 TTL 内 pending の `token_hash` verify は残差。本番ユーザー無し・移行無し。新規 `?token_hash=` は Task 2 RED で pending / verify / deposit 無し |
| Pri F9 snapshot `flowId` | 既存キー流用なら任意化。新キーなら cleanup リスト |
| Adv M1 bootstrap `/planner` | 製品外として可。ヘルパ `returnTo` を query 無しにするのは任意 |
| Adv M2 `sendMagicLink` 残置 | Task 3 RED に「login は `sendMagicLink` を呼ばない」を足すと閉じる |

設計残差（plan が引き上げないこと自体は正しい）:

| 残差 | 扱い |
| --- | --- |
| Google standalone が Safari に出る | spec §2.3 |
| メールアプリ往復 | 戻る先は同じ 6 マス |
| 共有端末に宛先が 60s | snapshot |
| 6 桁の空間 / IP 単位 verify | §2.3 |
| Admin `generateLink` オペレータ面 | 製品 UI からは消す |
| `SHOW_EMAIL_LOGIN` | live 既に true |

---

## Spec MF ↔ plan

| Spec MF | plan 現状 | 二次 |
| --- | --- | --- |
| MF-C1 leftover 例外・再マウント | Task 3 ref + Navigate | **印の寿命が MF-P1** |
| MF-I1 テンプレ両通 | Task 4 ファイル + YAML キー | **配信経路と Mailpit が MF-P2** |
| MF-I2 sibling | Task 3 ダミーなし + list/clear | **ヘルパ exact と RED が MF-P4** |
| MF-I3 既定 `/welcome` | Task 3 `sanitizeLoginReturnPath` | 充足。bootstrap `/planner` は残差 |
| MF-I4 3600s・レート同一 | Task 4 `OTP_EXP=3600` | exp 充足。**レート数字が MF-P3** |
| MF-I5 製品 6 桁 / bootstrap 非 goto | Task 5 | 製品方針充足。**goto 代替が MF-P5。パーサは MF-P2** |
| MF-I6 `token_hash` 無処理 | Task 2 第一分岐 | 新規 URL 充足。既存 pending resume は残差 |
| MF-I7 単一 in-flight・写像 | Task 2 写像 + Task 3 in-flight | 写像充足。**Strict が MF-P6** |
| MF-I8 入力正規化 | Task 1 NFKC | 充足 |
| Auth ロック非再定義 | Global | 充足 |

---

## 棄却・非採用

| 主張 | 二次結論 |
| --- | --- |
| Adv C1 を独立 Critical（初回成功が in-flight leftover に殺される） | **FALSE_POSITIVE。** leftover-clear は指紋 null で即 signOut。未認証マウントで終わる。verify では effect 再走しない。 |
| Adv C1 を F1 と別件 | **棄却。** 再マウント穴は F1。 |
| Adv C2 を独立 Critical | **棄却。** F2 と同じ配信未決。Critical 定義（認可バイパス / 安全保証の誤表示）に当たらない。 |
| Adv I3 を Important must-fix | **DOWNGRADE residual。** spec §4.4 受け入れは新しい `?token_hash=`。Task 2 RED が pending / verify / deposit 無しを固定。既存 pending の `resumeFlow` は一次 F8。本番ユーザー無し。 |
| Adv I5 を独立 BLOCK | **DUPLICATE of F3。** |
| 実行中 GoTrue / Mailpit 再送間隔を Task 4 必須コマンドにする | **棄却。** エージェントはフル E2E を回さない。数字固定 + 製品パーサが契約。 |
| メール用 Continuation を leftover 例外に使う | **棄却。** spec / plan とも禁止。 |
| 製品成功 leave の既定 `/planner` | **棄却。** Task 3 は `/welcome`。 |
| `sendEmailOtp` への `emailRedirectTo` 再入場 | **棄却。** Task 2 RED が禁じる。 |

---

## 結論（レビュー時点）

| 項目 | 結果 |
| --- | --- |
| 判定 | **`REVISE_PLAN`** |
| Critical must-fix | **0** |
| Important must-fix | **MF-P1…P6** |
| 棄却 / 却下 | C1 Critical・C1 初回 in-flight・C2 Critical・I3 Important・I5 独立 |
| spec 再改訂 | 不要 |
| 次 | plan 本文へ MF-P1…P6 反映 → 実装 Task 開始可（**APPROVE_AS_IS**） |

**メタ:** implementation plan 二次検証。成果物は本ファイルのみ。spec / plan / 実装は未編集。
