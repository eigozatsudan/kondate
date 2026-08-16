# 1次レビュー（実装）

- **Range:** `2fe87765..9ee91b21`
- **HEAD:** `9ee91b21`（`feat/email-otp-login`）
- **照合:** Spec `docs/superpowers/specs/2026-08-16-email-otp-login-design.md`（MF-C1 / MF-I1…I8）+ Plan `docs/superpowers/plans/2026-08-16-email-otp-login.md`
- **入力:** 実装 + `.superpowers/sdd/review-impl-2fe87765..9ee91b21.diff`（git は再導出しない）
- **Verdict:** **REVISE**

## Summary

番号ログインの骨格は Spec / Plan に高い忠実度で載っている。`sendEmailOtp` は `emailRedirectTo` 無し・`shouldCreateUser: true`・AuthFlow 非作成、`verifyEmailOtp` の 6 桁ゲートと GoTrue 写像、`token_hash` URL の unbound（pending / verify / deposit なし）、ログイン主 CTA / 番号待ち同一 `/login` / 成功既定 `/welcome`、6 マス正規化、テンプレ両通から URL 排除、`GOTRUE_MAILER_OTP_EXP=3600`、製品 E2E の 6 桁読み、bootstrap の action_link 非 goto、Auth ロック 4 export 非再定義、メール用 Continuation 非新設、`@shared/safety` 非 import、CSP 非緩和、番号の storage / ログ非保存はいずれも実装と一致する。

差し戻し理由は 1 点だけ。leftover-capable `/login` がマウント時に起動する leftover `signOut` を、番号成功印の後から止められない。印は「次のマウント」だけを守り、今走っている掃除が新しい OTP session を消せる。これは Spec MF-C1 / §8.7 が Critical として閉じる対象そのもの。

全件テストは再実行していない。契約の有無はソースと指定 diff で照合した。

## Verdict (counts)

| 区分 | 件数 |
| --- | ---: |
| Critical | 1 |
| Important | 1 |
| Minor | 5 |

**REVISE** — C1 を直すまで完了としない。I1 は同じ穴のテスト欠落。

## Strengths

- `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` を再定義していない。メール経路は `sendEmailOtp` / `verifyEmailOtp` の追加だけ。
- 番号送信に `emailRedirectTo` を付けない。テンプレ本体（Magic Link と Confirm 共用 `otp-code.html`）から `ConfirmationURL` / `TokenHash` / `RedirectTo` / 生 `http` / `https` を除き、件名は `こんだて日和の番号`。ローカルは `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED=false`。hosted 切れない場合は「URL 無しテンプレが唯一の防御」と `docs/deployment/supabase.md` に書いてある。
- OTP 寿命 3600 / 桁 6 / `RATE_LIMIT_OTP` 30 / `RATE_LIMIT_VERIFY` 360 / `SMTP_MAX_FREQUENCY` 60s。`compose.e2e.yaml` の `1s` は suite 専用のまま。
- 成功 leave の既定は `sanitizeLoginReturnPath` 経由の `/welcome`。`/planner` を login 成功既定にしていない。
- leftover-capable でも `complete` 後は `<Navigate replace>`。inbound leftover（印なし）の C-R2 / C-R4 は残している。
- sibling: Google 開始成功で番号待ちを捨てる。番号成功直前に未期限切れ flow を `markAuthFlowUserDismissed` + `clearAuthFlow`。`ContinuationApi.create` も `clearSiblingUnexpiredAuthFlows("")` も使っていない。
- `completeCallback` が `token_hash` を見たら unbound。callback は confirm CTA / `confirmMagicLink` を呼ばず、`needs_confirmation` leftover も unbound へ落とす。
- 6 桁は React state のみ。snapshot は `email` / `resendAvailableAt` / `storedAt`。成功印は `storedAt` のみ。番号も `returnTo` も書かない。
- 失敗コピーは Spec §6 exact。mismatch でマスを空にし、unavailable では再送できる。
- 製品 E2E は Mailpit 6 桁 → 6 マス。`requestMagicLinkAndReadUrl` とメール URL `goto` は消えている。`loginAsNewUser` は hashed_token のページ外 `verifyOtp`（製品外 bootstrap）。

## Findings

### Critical

#### C1 — leftover 掃除が、今立てた番号 session を後から signOut できる
- **id:** C1
- **confidence:** 92
- **file:line:** `src/features/auth/login-page.tsx:571-578` / `src/features/auth/auth-gateway.ts:655-664` / `src/features/auth/auth-gateway.ts:597-646` / `src/features/auth/login-page.test.tsx:208-236`
- **what's wrong:** leftover-capable `/login`（query 無し、および `?authError=*`）はマウントの `useEffect` で `clearLeftoverLoginSessionIfNoSiblingCompletion()` を fire-and-forget する。印チェックは **effect 開始時の `otpCompletedFresh` だけ**。effect に abort が無く、掃除関数も印も session 指紋も見ない。`discardedExchangeSessionKey === null` のため指紋照合を飛ばし、sibling completion が無ければ **今ある session を無条件に local `signOut`** する。

  番号成功は同じ leftover-capable ページの上で session を作る。印（`kondate.auth.emailOtpCompleted`）は成功後の **次レンダー / 再マウント** だけを守る。マウント時点で既に走っている掃除は止まらない。

  典型経路は Spec が直す対象そのもの。番号待ち snapshot を sessionStorage に残したあとメールアプリへ行き、ホーム画面アプリが `/login` を再マウントする。U1-I2 が待ち UI を復元し、印はまだ無いので leftover 掃除が再起動する。ユーザーは 6 桁をすぐ貼る。`signOut` は最大 2s。その間に `verifyOtp` が新しい session を書くと、後着の leftover `signOut` がそれを消す。

  ユニットは verify を stub し、成功 Navigate の **あと** で `leftoverSignOut.mockClear()` してから再マウントする。初回マウントの掃除と verify の重なりも、待ち UI 再水和直後の貼付も見ていない。製品 E2E の `requestEmailOtpAndReadCode` は `/login?returnTo=%2Fplanner` なので leftover-capable ですらない。
- **why it matters:** Spec §3.3 / §8.7 / MF-C1。leftover 掃除の対象は「マウント時点で既にあった persist」。このタブで今立てた番号 session を消してはいけない。消えると成功 Navigate の直後にセッションが無くなり、ホーム画面アプリの往復（本スライスの存在理由）でログインし直すことになる。
- **how to fix:**
  1. leftover 掃除開始時に session 指紋を取る。`signOut` 直前に、現在 session が開始時指紋と一致するときだけ消す。新規 OTP session は指紋が違うので触らない。開始時に session が無ければ、後から現れた session は消さない。
  2. `useEffect` に cancelled フラグを付け、成功印を書いたら掃除を捨てる。掃除関数も `signOut` 直前に `kondate.auth.emailOtpCompleted` の鮮度を再読する。
  3. テストは stub の即時 `signOut` では足りない。leftover-capable + 待ち UI 再水和で `signOut` を未 settle のまま 6 桁貼付 → complete → そのあと `signOut` が settle しても session / Navigate が残ること。inbound leftover（印なし）の C-R4 は残す。

### Important

#### I1 — leftover 例外のテストが「印がある再マウント」しか固定していない
- **id:** I1
- **confidence:** 90
- **file:line:** `src/features/auth/login-page.test.tsx:208-236` / `src/features/auth/auth-cleanup.test.ts:59-91`
- **what's wrong:** Plan Task 3 / Spec §7 が要求した「leftover-capable で verify 成功 → Navigate。再マウントしても session が残る」は、成功印を書いた **後** の再マウントだけを見ている。C1 の本線（掃除 in-flight 中の complete、待ち UI 再水和からの即 verify）は無い。

  加えて Plan は成功印を `MAGIC_LINK_RESIDUAL_KEYS` に足し、logout で消すと書いた。実装は `auth-cleanup.ts:51` にキーを足している。`auth-cleanup.test.ts` は `lastMagicEmail` / `magicSentUi` だけを見ており、`kondate.auth.emailOtpCompleted` が logout / soft residual で消えることを固定していない。
- **why it matters:** 印が logout 後に 60s 残ると、次の leftover-capable `/login` が inbound leftover 掃除を飛ばす。C-R4 の例外が前ユーザーの印で開く。実装は今正しいが、キーを外しても GREEN のまま。C1 を直しても、この観測点が無いと同じ穴が戻る。
- **how to fix:** C1 の in-flight ケースを 1 本。`clearLocalAuthAndDrafts` / `clearSoftSessionResidualBestEffort` に `emailOtpCompleted` の remove を 1 本。

### Minor

#### M1 — `LOGIN_EMAIL_HINT` に旧マジックリンク文が残る
- **id:** M1
- **file:line:** `src/features/auth/login-page.tsx:53-54`
- **what's wrong:** `届いたメールのリンクを開き、画面の「ログインを完了する」を押すと入れます。…` がまだ export されている。画面は出していない（テストも `queryByText` で否定）。
- **why it matters:** 再掲すると長押しプレビュー案内が戻る。今は死文。
- **how to fix:** 定数と参照を削除する。

#### M2 — callback 待ちコピーが「メールのリンク」のまま
- **id:** M2
- **file:line:** `src/features/auth/auth-callback-page.tsx:466`
- **what's wrong:** `Google やメールのリンクから戻ってきたあとの確認です。` Google 経路の待ち画面に、廃止したメールリンクの話が残る。
- **why it matters:** ユーザー向けにリンク踏破を想起させる。confirm CTA は無いので機能穴ではない。
- **how to fix:** Google 戻りだけに寄せる（例: `Googleから戻ってきたあとの確認です。`）。

#### M3 — `completeCallback` が pending から `needs_confirmation` を再構成する
- **id:** M3
- **file:line:** `src/features/auth/auth-gateway.ts:1114-1132` / `src/features/auth/auth-gateway.test.ts:436-470`
- **what's wrong:** `token_hash` クエリは unbound。一方、`credentialKind === "token_hash"` + pending があると URL に `token_hash` が無くても `needs_confirmation` を返す。callback はそれを unbound に落とすので製品 UI は confirm しない。テストは再構成を正として固定している。
- **why it matters:** 型に `confirmMagicLink` が残るのは Spec 許容。再構成は旧マジックの死経路。本番ユーザー無しなので実害は小さいが、gateway 契約が製品と食い違う。
- **how to fix:** pending 再構成を unbound にする。テストを「strip 後も confirm しない」に書き換える。

#### M4 — 6 マスの aria-label が copy モジュールと二重
- **id:** M4
- **file:line:** `src/features/auth/otp-digit-field.tsx:6-13` / `src/features/auth/email-otp-copy.ts:33-40`
- **what's wrong:** 同じ 6 文言が 2 箇所。E2E は copy 側、コンポーネントは独自定数。
- **why it matters:** 片方がずれると E2E だけ赤、またはスクリーンリーダーだけ旧名。
- **how to fix:** マスは `EMAIL_OTP_DIGIT_ARIA_LABELS` を読む。

#### M5 — README がマジックリンク手順のまま
- **id:** M5
- **file:line:** `README.md:102-112`
- **what's wrong:** 「ログイン用メールを送る」→ Mailpit のリンクから続行、と書いてある。`docs/deployment/supabase.md` は更新済み。
- **why it matters:** ローカル手動確認が旧経路を案内する。製品コードは見ていない。
- **how to fix:** 番号送信 → Mailpit の 6 桁 → 同じ `/login` の 6 マス、に差し替える。

## Residual / out of scope

Spec §2.3 の受け入れ残差は指摘しない。

- Google は standalone で Safari に出ることがある。
- 番号を見るためにメールアプリは開く。戻る先は同じ `/login` の 6 マス。
- 共有端末に宛先メールが 60s 残る（番号は入れない）。
- 6 桁の空間。試行回数表示なし。GoTrue にメール単位失敗ロックは無い。
- Admin `generateLink` はオペレータ / 製品外 bootstrap 面。`loginAsNewUser` が hashed_token をページ外 verify するのは Plan Task 5 どおり。
- `SHOW_EMAIL_LOGIN` は live 既に `true`。
- `sendMagicLink` / `confirmMagicLink` が型に残ること。login / callback からは呼ばない。
- 既存 TTL 内 `token_hash` pending を `resumeFlow` が verify し得ること（本番ユーザー無し・移行無し。新規 `?token_hash=` は unbound）。
- Invite / Recovery テンプレは非対象。
- `compose.e2e.yaml` の `GOTRUE_SMTP_MAX_FREQUENCY: "1s"` は suite 専用。

## Tests that lock the contract vs tests that don't

### 固定している

| 契約 | テスト |
| --- | --- |
| `sendEmailOtp`: `emailRedirectTo` 無し、`shouldCreateUser: true`、AuthFlow 非作成 | `auth-gateway.test.ts` |
| `verifyEmailOtp`: 6 桁成功、非 6 桁は `verifyOtp` 未送信、`otp_expired`/`token_expired` → mismatch、`otp_disabled`/`over_request_rate_limit`/未知 → unavailable | 同 |
| `token_hash` URL は unbound。pending / verify / deposit なし | 同 |
| 主 CTA 番号、副 Google、長押し文なし、送信後も `/login`、6 マス | `login-page.test.tsx` |
| leftover-capable（query 無し / `unbound_callback`）で complete → `/welcome` Navigate | 同 |
| 印あり再マウントで leftover `signOut` しない | 同 |
| inbound leftover（印なし）の C-R2 / C-R4 | 同 |
| Google 開始で番号待ち破棄。番号成功で未期限切れ `authorization_code` flow が消える | 同 |
| mismatch コピー exact、マス空。StrictMode で verify 1 回 | 同 |
| Google 省略時 returnTo `/welcome`。`sendEmailOtp` に returnTo を渡さない | 同 |
| 6 マス: NFKC、貼付、Backspace、disabled、composition 中 Enter | `otp-digit-field.test.tsx` |
| 両 TEMPLATES 同一到達 URL、本文に Token あり URL 断片なし、件名 exact、OTP exp 3600 / length 6 | `scripts/otp-email-templates.test.mjs` |
| Mailpit 本文: 6 桁、`http`/`https` が 1 つでもあれば throw（混在含む） | `e2e/fixtures/mailpit-otp-code.test.mjs` |
| callback に「ログインを完了する」なし。`confirmMagicLink` 非呼び出し | `auth-callback-page.test.tsx` |
| 製品 E2E は 6 マス。メール URL を `goto` しない | `e2e/specs/auth.setup.ts` / `e2e/fixtures/auth.ts` |
| bootstrap は action_link 非 goto | `e2e/fixtures/auth.ts` |
| recovery からメール callback 2 本削除。Google cancel の新ボタン名 | `e2e/specs/auth-recovery.spec.ts` |

### 固定していない（必要な契約）

| 契約 | 実態 |
| --- | --- |
| leftover 掃除は「今立てた番号 session」を消さない（MF-C1 本線） | 印あり再マウントだけ。in-flight 掃除 × verify が無い（C1 / I1） |
| logout / soft residual で成功印を消す | キーは実装にある。`auth-cleanup.test.ts` は旧 2 キーだけ（I1） |
| 待ち UI 再水和 + leftover-capable で即 verify しても session が残る | 再水和テストは UI 復元だけ。掃除との合成が無い |
| 残存 `token_hash` flow も番号成功直前に dismiss | `authorization_code` だけ |
| override の `RATE_LIMIT_*` / `MAGIC_LINK_ENABLED=false` / subjects | YAML にはある。テンプレテストは EXP / LENGTH / TEMPLATES URL だけ |

`.superpowers/sdd/task-*-review.md` は未検証主張として扱い、ソースと指定 diff で再照合した。
