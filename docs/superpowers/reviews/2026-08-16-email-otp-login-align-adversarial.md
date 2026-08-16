# 敵対的レビュー（Spec × Plan × 実装 整列）

- **Verdict:** **PASS_WITH_RESIDUALS**
- **役割:** 独立 adversarial reviewer（実装著者コンテキスト非共有。本ファイルのみ書込）
- **日付:** 2026-08-16
- **Worktree:** `/home/dev/projects/kondate/.worktrees/email-otp-login`
- **HEAD:** `41166419`
- **Range:** `2fe87765..41166419`
- **Diff 正本:** `.superpowers/sdd/review-align-2fe87765..HEAD.diff`
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)
- **照合 plan:** [`docs/superpowers/plans/2026-08-16-email-otp-login.md`](../plans/2026-08-16-email-otp-login.md)
- **姿勢:** 実装者が spec 文を黙って落とす / Plan の楽な半分だけ GREEN する、を前提に壊す。§2.3 残差は must-fix にしない。
- **攻撃:**
  1. Spec 要求にコードが無い
  2. Plan ロック値（3600 / 6 / 30 / 360 / 60s / 印キー / TTL 60s）がコードに無い、または docs だけ
  3. Spec と矛盾するコード（leftover / `token_hash` / テンプレ URL / `returnTo`）
  4. 誤った契約を固定するテスト
  5. Task 4 テンプレ URL / Task 5 Mailpit が Magic+Confirm 両通でない

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`PASS_WITH_RESIDUALS`** |
| **Critical** | **0** |
| **Important** | **0**（confidence ≥ 80 なし） |
| **Finding IDs** | なし |
| **解除条件** | なし。must-fix は無い |

番号送信・確認・成功 leave・`token_hash` unbound・テンプレ両通・ロック値・製品 E2E 6 桁 / bootstrap 非 goto は Spec / Plan と一致する。C1 leftover in-flight `signOut` は `918b656d` / `643a8f6d` で指紋 + 待ち中非起動に閉じた。§2.3 と、運用 docs の旧マジック文言・製品 E2E が leftover-capable を踏まないこと等は残差であり、本スライスの受け入れを覆さない。

---

## Attack table

| id | 攻撃 | 結果 | 根拠 |
| --- | --- | --- | --- |
| 1 | Spec 文がコードに無い（主 CTA / 6 マス / leftover 例外 / 写像 / 両テンプレ / 製品 E2E） | **HOLD** | 下記 Alignment hold |
| 2 | ロック値 3600 / 6 / 30 / 360 / 60s / `kondate.auth.emailOtpCompleted` / TTL 60s が docs だけ | **HOLD** | override / login-page / gateway / cleanup に実値。テストは EXP/LENGTH/TEMPLATES を固定。30/360/60s は YAML 正本あり（テスト未固定は残差） |
| 3a | leftover-capable で番号成功 session を leftover が殺す | **HOLD** | 印 + 指紋再読 + 待ち中非起動 + abort。RED は remount と late signOut の両方 |
| 3b | `token_hash` が pending / `needs_confirmation` / `verifyOtp` / deposit | **HOLD** | `completeCallback` は即 `unbound_callback`。callback は confirm CTA / `confirmMagicLink` 非呼び出し |
| 3c | `sendEmailOtp` が `emailRedirectTo` を付ける / テンプレに URL | **HOLD** | options は `shouldCreateUser` のみ。両 TEMPLATES は同一 HTML。本文に禁止断片無し |
| 3d | 成功既定が `/planner` / snapshot に `returnTo` | **HOLD** | query 無しは `/welcome`。waiting / 印は email・resend・storedAt のみ |
| 4 | テストが旧マジック契約（URL goto / confirm CTA / 既定 `/planner`）を正にする | **HOLD** | 製品テストは 6 桁・unbound・`/welcome`。`sendMagicLink` 残テストは型残存経路（Spec 許容） |
| 5 | Task 4 が片系だけ / Task 5 Mailpit が Magic か Confirm の片方だけ | **HOLD** | 両 TEMPLATES が同一到達 URL。Mailpit は宛先全通を見る（新規 Confirm / 既存 Magic）。パーサは http(s) で throw |

---

## Alignment hold（Spec 文 × コード）

| Spec / Plan | コード |
| --- | --- |
| §3.1 主 `番号をメールで受け取る` / 副 `Googleで続ける` / 長押し・「ログインを完了する」無し | `email-otp-copy.ts` + `login-page.tsx`。`LOGIN_EMAIL_HINT` は削除済み（`41166419`） |
| §3.2 同一 `/login`・6 マス・NFKC・貼付・IME 中非 verify・単一 in-flight | `otp-digit-field.tsx` / `login-page.tsx` `verifyInFlightRef` |
| §3.3 leftover-capable でも `returnTo`（既定 `/welcome`）。今の session は掃除しない | leftover 例外 + 印 `kondate.auth.emailOtpCompleted` `{ storedAt }` TTL 60s |
| §4.1 `sendEmailOtp` / `verifyEmailOtp`。`emailRedirectTo` 無し。非 6 桁はサーバ未送信 | `auth-gateway.ts` L1079–1119。写像 otp_expired/token_expired→mismatch、他→unavailable |
| §4.2–4.4 `token_hash` 無処理。confirm CTA 削除 | gateway L1142–1144。callback は `needs_confirmation` も unbound leave |
| §4.3 sibling。Continuation 非新設。`token_hash` 新規作成しない | Google 開始で waiting 破棄。complete 直前に unexpired flow を dismiss+clear。`sendEmailOtp` は Flow を作らない |
| §5 両テンプレ・3600 / 6 / 30 / 360 / 60s。`MAGIC_LINK_ENABLED=false`。docs を番号必須へ | `infra/supabase.override.yaml` L105–115。`docs/deployment/supabase.md` §2.2 |
| §6 exact copy | `email-otp-copy.ts`。mismatch でマス空 |
| §7 製品 E2E 6 桁 / bootstrap 非 goto / recovery メール callback 削除 | `requestEmailOtpAndReadCode` / `loginAsNewUser` hashed_token ページ外 verify / recovery は Google cancel のみ |
| Plan 印キー + logout residual | `auth-cleanup.ts` `MAGIC_LINK_RESIDUAL_KEYS` + cleanup テスト |
| Auth ロック 4 export 非再定義 | 本 range に `AuthProvider` / `BrowserSupabaseClient` / `AuthFlow` 定義変更無し |

ロック値の所在:

| 値 | コード | テスト固定 |
| --- | --- | --- |
| `GOTRUE_MAILER_OTP_EXP=3600` | `infra/supabase.override.yaml` | `scripts/otp-email-templates.test.mjs` |
| `GOTRUE_MAILER_OTP_LENGTH=6` | 同 | 同 |
| `GOTRUE_RATE_LIMIT_OTP=30` | 同 | 無し（YAML 正本。docs と同一） |
| `GOTRUE_RATE_LIMIT_VERIFY=360` | 同 | 無し |
| `GOTRUE_SMTP_MAX_FREQUENCY=60s` | 同。`compose.e2e.yaml` の `1s` は suite 専用 | 無し |
| 印 `kondate.auth.emailOtpCompleted` / TTL 60s | `login-page.tsx` L84–90 / `auth-gateway.ts` L650–655 | leftover remount / cleanup テスト |
| 両 TEMPLATES = `http://otp-templates:8080/otp-code.html` | override L112–113。`otp-templates` nginx | 値まで同一 URL を固定 |
| 件名 `こんだて日和の番号` | override SUBJECTS 両通 + `otp-code-subject.txt` | 件名ファイル。YAML SUBJECTS は未 assert |

---

## Findings

### Critical

なし。

### Important

なし（confidence ≥ 80 の整列欠陥は無い）。

---

## Residuals（must-fix にしない）

§2.3 受け入れ残差は再掲しない（Google standalone / メールアプリ往復 / 共有端末 60s / 6 桁空間 / Admin `generateLink` / `SHOW_EMAIL_LOGIN`）。

加えて本レビューが落としたが must-fix にしないもの:

| 残差 | 理由 |
| --- | --- |
| `magic_link_expired` コピー「このリンクは期限切れか…」と recovery E2E がその文言を要求 | 旧 `?token_hash=` は unbound（「最初からやり直してください」）。本コピーは `error_code=otp_expired` の既存 leave。専用旧リンク案内ではない |
| `docs/deployment/README.md` がまだ「マジックリンク」運用 | Spec / Plan の置換対象は `supabase.md`。正本は番号テンプレ済み |
| 製品 E2E `requestEmailOtpAndReadCode` が `/login?returnTo=%2Fplanner` | leftover-capable を踏まない。Unit が query 無し / `unbound_callback` を固定。Spec §7 は 6 桁入力を要求し leftover E2E は要求しない |
| `otp-email-templates.test.mjs` が 30 / 360 / 60s / SUBJECTS env / `MAGIC_LINK_ENABLED` を assert しない | 値は override にある。キー削除で GREEN は残るが「docs だけ」ではない |
| C1b: 待ち snapshot 中は inbound leftover の C-R4 を起動しない | 指紋経路は残る。待ち無し C-R4 テストは残存。メール往復中の leftover persist 温存は C1 再発防止の意図的保守 |
| C9 が leftover authenticated で waiting snapshot を消す | 初回 remount は initializer が先に読む。2 回目 reload で待ち UI が落ちる。§2.3 の「戻る先は 6 マス」は初回 remount で満たす |
| `sendMagicLink` / `confirmMagicLink` と pending `needs_confirmation` 再構成 | Spec は型残存を許容。製品 UI は呼ばない。callback は leftover `needs_confirmation` も unbound |
| 無効 `returnTo` が `sanitizeReturnPath` 経由で `/planner` | 既定 query 無しは `/welcome`。既存 residual |
| 6 マス 44px ×6 + card padding が 320 のカード内に収まらない | page-frame 288 − card 余白で内容 246、マス列 274。カードからはみ出すが文書右端は ≈311 < 320。横スクロールは未確定（confidence 72） |
| Mailpit 実本文・`generateLink`+ページ外 `verifyOtp` の live 未観測 | Task 5/6 が製品 E2E 全件をエージェント禁止。パーサは http(s) fail-closed |
| `infra/supabase/templates` が vendor ツリー内 | 現行は載っている。`vendor-supabase.sh --refresh` で消える運用リスク |

---

## Final

**PASS_WITH_RESIDUALS。Finding IDs: なし。**

Spec の主契約（同じ `/login` の 6 マス、`emailRedirectTo` 無し、`token_hash` unbound、leftover-capable でも `/welcome` Navigate、今の番号 session を leftover が殺さない、両テンプレから URL を除く）は HEAD `41166419` のコードとテストにある。Plan ロック値 3600 / 6 / 30 / 360 / 60s / 印キー / TTL 60s は override と auth 実装にあり、docs だけではない。Task 4 は Magic+Confirm が同一到達 URL、Task 5 Mailpit は宛先全通を見て http(s) なら throw する。残るのは運用 README の旧語、E2E が leftover-capable を踏まないこと、レート YAML のテスト未固定、型に残る `sendMagicLink` であり、受け入れを覆さない。
