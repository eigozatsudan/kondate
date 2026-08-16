# 1次レビュー（Spec × Plan × 実装 alignment）

- **Range:** `2fe87765..41166419`
- **HEAD:** `41166419`（`feat/email-otp-login`）
- **照合:** Spec `docs/superpowers/specs/2026-08-16-email-otp-login-design.md`（MF-C1 / MF-I1…I8）+ Plan `docs/superpowers/plans/2026-08-16-email-otp-login.md`
- **入力:** live 実装 + `.superpowers/sdd/review-align-2fe87765..HEAD.diff`
- **姿勢:** Spec がこのスライスの製品意図の正。live 実装がロック値の正。§2.3 受け入れ残差は再審しない。
- **Verdict:** **ALIGN**

## Summary

番号ログインの製品契約は Spec / Plan / 実装で揃っている。§3 / §6 の exact copy、`sendEmailOtp` の `emailRedirectTo` 無し・`shouldCreateUser: true`、`verifyEmailOtp` の 6 桁ゲートと GoTrue 写像、`token_hash` URL の unbound、成功既定 `/welcome`、sibling dismiss、テンプレ両通（Magic / Confirm）から URL 排除、OTP 3600 / 桁 6 / RATE_LIMIT_OTP 30 / RATE_LIMIT_VERIFY 360 / SMTP 60s、製品 E2E の Mailpit 6 桁、bootstrap の hashed_token ページ外 verify、logout で成功印を消す、Auth ロック 4 export 非再定義、メール用 Continuation 非新設はいずれも一致する。

実装レビュー時の leftover C1（印より先に走った `signOut` が番号成功 session を消す）は、`918b656d`（指紋 + 印の再読）と `643a8f6d`（番号待ち snapshot / waiting / verifying / in-flight では leftover を起動しない）で Spec §3.3 / §8.7 の本線を閉じている。残るのは leftover が **すでに** `signOut` を投げたあとの uncancelable `_removeSession` と、leftover persist が残ったまま C9 が待ち snapshot を消す狭い枝であり、§2.3 残差でも Spec 本線の未実装でもない。

Plan 本文の Task チェックボックスはすべて `- [ ]` のまま。中身は Task 1–6 相当の commit（`02e08431` … `9ee91b21`）と C1 / C1b / minors 修正（`918b656d` / `643a8f6d` / `41166419`）として着地している。チェック未更新は追跡用のプロセス残差であり、製品契約の drift ではない。

## Verdict (counts)

| 区分 | 件数 |
| --- | ---: |
| Critical | 0 |
| Important | 0 |
| Minor | 1 |

**ALIGN** — Spec が要求する製品挙動は live に載っている。差し戻し条件の未実装は無い。

## Hunt 結果

| 項目 | Spec / Plan | live | 判定 |
| --- | --- | --- | --- |
| §3 / §6 copy exact | `email-otp-copy.ts` に固定文字列 | login / 6 マス / 失敗 UI が同一定数を読む。`LOGIN_EMAIL_HINT` は削除済み | **一致** |
| leftover MF-C1（待ち skip / 指紋 / 印） | マウント時点 persist だけ。今立てた番号 session は消さない | 印 60s + 指紋再読 + 待ち/確認中は leftover 非起動。印あり remount と delayed-signOut×verify の RED あり | **本線一致**（残窓は Residual） |
| send / verify / `emailRedirectTo` | `shouldCreateUser: true`、RedirectTo 無し、6 桁以外はサーバ未送信 | `sendEmailOtp` / `verifyEmailOtp` とそのテストが固定 | **一致** |
| GoTrue 写像 | `otp_expired` / `token_expired` → mismatch。`otp_disabled` / `over_request_rate_limit` / 未知 → unavailable | `mapEmailOtpVerifyKind` と同テスト | **一致** |
| `token_hash` unbound | pending / verify / deposit 無し。`unbound_callback` | URL の `token_hash` は即 unbound。callback は `needs_confirmation` を unbound leave。confirm CTA 無し | **製品経路一致**（pending 再構成は Residual） |
| テンプレ両通・3600 / 6 / rates | Magic + Confirm 同一 HTML。exp 3600、length 6、OTP 30、VERIFY 360、SMTP 60s。e2e `1s` は suite 専用 | `otp-code.html` + override + `otp-email-templates.test.mjs`。`compose.e2e.yaml` の `1s` は製品 override に無い | **一致** |
| E2E 6 桁 vs bootstrap hashed_token | 製品は Mailpit 6 桁。bootstrap は action_link 非 goto | `requestEmailOtpAndReadCode` + `auth.setup` 6 マス。`loginAsNewUser` は hashed_token のページ外 `verifyOtp` | **一致** |
| `returnTo` 既定 `/welcome` | `sanitizeLoginReturnPath`。`/planner` は login 成功既定に使わない | query 無しは `/welcome`。gateway snapshot に `returnTo` 無し | **一致**（無効 query の内側 fallback は Residual） |
| sibling dismiss | Google 開始で番号待ち破棄。verify 直前に未期限切れ Google flow を dismiss。`ContinuationApi.create` 禁止 | `discardWaiting` + `dismissUnexpiredSiblingAuthFlowsForEmailOtp`（authorization_code と残存 token_hash を含む未期限切れ全部） | **一致** |
| leftover 成功印の logout 掃除 | `kondate.auth.emailOtpCompleted` を residual キーへ | `MAGIC_LINK_RESIDUAL_KEYS` + `clearLocalAuthAndDrafts` テスト | **一致** |
| Plan Task チェック vs 着地 | Task 1–6 の checkbox | 全部 `[ ]`。commit は Task 1–6 + C1/C1b/minors | **追跡のみ未更新**（製品 drift ではない） |

## Strengths

- `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` を再定義していない。メール経路は `sendEmailOtp` / `verifyEmailOtp` の追加だけ。
- 番号送信に `emailRedirectTo` を付けない。テンプレ本体（Magic Link と Confirm 共用 `otp-code.html`）から `ConfirmationURL` / `TokenHash` / `RedirectTo` / 生 `http` / `https` を除き、件名は `こんだて日和の番号`。ローカルは `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED=false`。hosted 切れない場合は「URL 無しテンプレが唯一の防御」と `docs/deployment/supabase.md` にある。
- 成功 leave の既定は `sanitizeLoginReturnPath` 経由の `/welcome`。snapshot / 印に番号も `returnTo` も無い。
- leftover-capable でも `complete` 後は `<Navigate replace>`。inbound leftover（印なし）の C-R2 / C-R4 は残している。
- sibling: Google 開始成功で番号待ちを捨てる。番号成功直前に未期限切れ flow を `markAuthFlowUserDismissed` + `clearAuthFlow`。`ContinuationApi.create` も `clearSiblingUnexpiredAuthFlows("")` も使っていない。
- 製品 E2E は Mailpit 6 桁 → 6 マス。`requestMagicLinkAndReadUrl` とメール URL `goto` は消えている。`loginAsNewUser` は hashed_token のページ外 `verifyOtp`（製品外 bootstrap）。
- 失敗コピーは Spec §6 exact。mismatch でマスを空にし、unavailable では再送できる。

## Findings

### Critical

なし。

### Important

なし。

### Minor

#### M1 — leftover persist が残ったまま C9 が待ち snapshot を消す
- **id:** M1
- **confidence:** 82
- **file:line:** `src/features/auth/login-page.tsx:594-599` / `src/features/auth/login-page.tsx:568-592` / `src/features/auth/login-page.test.tsx:857-880`
- **what's wrong:** C9 は `auth.status === "authenticated"` なら `kondate.auth.magicSentUi` を消す。leftover-capable `/login` では leftover persist が authenticated でも Navigate しない（C-R2）。C1b は待ち snapshot があるとき leftover を起動しないので、inbound leftover + 番号待ちの組み合わせでは persist が残ったまま snapshot だけ消える。そのマウントの待ち UI（`state.status`）は残る。**次の remount**（メールアプリへもう一度行く、など）では snapshot が無く idle に落ち、leftover が起動する。
- **why it matters:** Spec §3.2 / Plan Task 3 の「リロード後も番号待ちを復元」と、§2.3 の「戻る先は同じ `/login` の 6 マス」が、leftover persist が残っている 2 回目以降の往復で欠ける。典型の初回 LP → `/login`（persist 無し）や、idle マウントで leftover が先に終わったあとの 1 回目 remount は壊れない。今立てた OTP session を leftover が消す MF-C1 本線でもない。
- **how to fix:** leftover-capable かつ OTP 成功印が無い authenticated では C9 が `magicSentUi` を消さない。または C9 の対象を「このタブの番号成功」に限る。

## Residual / out of scope

Spec §2.3 の受け入れ残差は指摘しない。

- Google は standalone で Safari に出ることがある。
- 番号を見るためにメールアプリは開く。戻る先は同じ `/login` の 6 マス（上記 M1 の 2 回目 remount 以外）。
- 共有端末に宛先メールが 60s 残る（番号は入れない）。
- 6 桁の空間。試行回数表示なし。GoTrue にメール単位失敗ロックは無い。
- Admin `generateLink` はオペレータ / 製品外 bootstrap 面。`loginAsNewUser` が hashed_token をページ外 verify するのは Plan Task 5 どおり。
- `SHOW_EMAIL_LOGIN` は live 既に `true`。
- `sendMagicLink` / `confirmMagicLink` が型に残ること。login / callback からは呼ばない。
- 既存 TTL 内 `token_hash` pending を `resumeFlow` が verify し得ること（本番ユーザー無し・移行無し。新規 `?token_hash=` は unbound）。
- `completeCallback` が URL に `token_hash` が無い strip 後、残件 pending から `needs_confirmation` を再構成すること。callback は unbound leave し、confirm CTA は出ない（実装レビュー M3）。
- 無効な明示 `returnTo`（空・外部 URL）は内側の `sanitizeReturnPath` が `/planner` を返す。query 無しの login 成功既定は `/welcome`。
- leftover が最後の指紋照合のあと `signOut` を投げたあとは `withTimeout` が SDK `_removeSession` を cancel できない。待ち skip + 指紋 + 印が本線を閉じたあとの残窓。
- Invite / Recovery テンプレは非対象。
- `compose.e2e.yaml` の `GOTRUE_SMTP_MAX_FREQUENCY: "1s"` は suite 専用。
- Plan チェックボックスが未チェックなこと（中身は着地済み）。

## leftover MF-C1 の着地

実装 1 次 C1 は **同じ leftover-capable マウントの in-flight leftover `signOut` が、verify が書いた番号 session を後から消す**ことだった。live は次で閉じている。

1. **印:** `kondate.auth.emailOtpCompleted`（`storedAt` のみ、TTL 60s）。新鮮なら leftover effect も掃除関数も開始しない。logout で `MAGIC_LINK_RESIDUAL_KEYS` から消す。
2. **指紋:** leftover 専用経路は `clearDiscardedExchangeSessionIfStillPresent(..., null)` を呼ばない。開始時キーと現在キーが違えば触らない。開始時 null は persist だけ消し `signOut` しない。wipe 後にも印 / 指紋を再読する。
3. **待ち skip:** leftover-capable でも `readWaitingUi()` / `waiting` / `verifying` / `verifyInFlightRef` なら leftover を起動しない。メールアプリ往復の再水和（U1-I2）で掃除を再起動しない。

Vitest が固定している本線:

- leftover-capable（query 無し / `unbound_callback`）で complete → `/welcome` Navigate。印あり remount で leftover `signOut` しない。
- leftover `getSession` を番号成功後まで止め、指紋変化で `signOut` しない。
- leftover persist + 新鮮な待ち snapshot では leftover を起動しない。印なし inbound leftover の C-R4 は残す。

これで Spec §3.3 / §8.7 / Plan Task 3 の「今このタブで立てた番号 session は leftover 掃除しない」は満たす。

## Plan Task 着地

| Task | 正本 commit | 状態 |
| --- | --- | --- |
| 1 6 マス | `02e08431` | 着地。checkbox は未更新 |
| 2 gateway send/verify / token_hash unbound | `dd39f175` | 着地 |
| 3 login leftover 例外 / sibling / callback confirm 削除 | `e0694468` | 着地。印は sessionStorage（component ref だけを正にしない） |
| 4 テンプレ両通・3600 | `a3e81ee4` | 着地。`otp-templates:8080` 同一 URL |
| 5 製品 6 桁 / bootstrap hashed_token | `9ee91b21` | 着地 |
| 6 横断ゲート | 差分 commit 無し（Plan どおり任意） | 対象ファイルは先行 Task に含まれる |
| leftover C1 | `918b656d` | 指紋 + 印 |
| leftover C1b | `643a8f6d` | 番号待ち中は leftover 非起動 |
| minors M1/M2/M4/M5 | `41166419` | 旧マジック文言削除 |

## Tests that lock the contract

| 契約 | テスト |
| --- | --- |
| `sendEmailOtp`: `emailRedirectTo` 無し、`shouldCreateUser: true`、AuthFlow 非作成 | `auth-gateway.test.ts` |
| `verifyEmailOtp`: 6 桁成功、非 6 桁は `verifyOtp` 未送信、写像表 | 同 |
| `token_hash` URL は unbound。pending / verify / deposit なし | 同 |
| 主 CTA 番号、副 Google、長押し文なし、送信後も `/login`、6 マス | `login-page.test.tsx` |
| leftover-capable で complete → `/welcome`。印あり remount で leftover しない | 同 |
| delayed leftover × verify で persist / Navigate が残る | 同 |
| 待ち snapshot では leftover を起動しない。印なし C-R4 は signOut | 同 |
| Google 開始で番号待ち破棄。番号成功で未期限切れ `authorization_code` flow が消える | 同 |
| mismatch コピー exact、マス空。StrictMode で verify 1 回 | 同 |
| logout で `emailOtpCompleted` が消える | `auth-cleanup.test.ts` |
| 両 TEMPLATES 同一到達 URL、本文に Token あり URL 断片なし、件名 exact、OTP exp 3600 / length 6 | `scripts/otp-email-templates.test.mjs` |
| Mailpit 本文: 6 桁、`http`/`https` が 1 つでもあれば throw | `e2e/fixtures/mailpit-otp-code.test.mjs` |
| 製品 E2E は 6 マス。bootstrap は action_link 非 goto | `e2e/specs/auth.setup.ts` / `e2e/fixtures/auth.ts` |

`.superpowers/sdd/task-*-review.md` は未検証主張として扱い、ソースと指定 diff で再照合した。
