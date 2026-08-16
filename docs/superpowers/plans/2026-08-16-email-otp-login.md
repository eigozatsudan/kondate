# メール 6 桁番号ログイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マジックリンクを廃止し、同じ `/login` の 6 マスで GoTrue email OTP を確認する。

**Architecture:** `AuthGateway` に `sendEmailOtp` / `verifyEmailOtp` を足す。`AuthFlow` / `ContinuationApi` は Google 専用のまま。メール用 Continuation は作らない。成功は leftover-capable でも即 Navigate。URL 削除の本体は Magic Link と Confirm の両テンプレ。

**Tech Stack:** 既存 supabase-js、GoTrue、Vitest、Playwright、Docker `app`。

**Spec:** `docs/superpowers/specs/2026-08-16-email-otp-login-design.md`（**MF-C1 / MF-I1…I8 反映済み**）
**Reviews:** `docs/superpowers/reviews/2026-08-16-email-otp-login-{primary,adversarial,secondary}.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、`strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。コメント・コミットは日本語（Conventional Commits）
- Docker: `docker compose run --rm --no-deps app <cmd>`（エージェントは `&&` / `;` で連結しない）
- Auth ロック（`AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient`）を再定義しない
- メール用に `ContinuationApi` を新設・利用しない
- `emailRedirectTo` を番号送信に付けない。テンプレ両通から URL を除く
- 番号を localStorage / sessionStorage / ログに残さない
- OTP 寿命はローカルと本番で同一かつ **3600s**。**86400s を正にしない**。桁は 6
- leftover 掃除は「今このタブで立てた番号 session」を消さない
- `@shared/safety` をブラウザへ import しない。CSP を緩めない
- `git push` / 本番 deploy / 破壊的 git は人間の明示指示なしで行わない

## File map

| ファイル | 責務 |
| --- | --- |
| `src/features/auth/otp-digit-field.tsx` | 6 マス + 正規化 + 結合 input |
| `src/features/auth/otp-digit-field.test.tsx` | マス契約 |
| `src/features/auth/email-otp-copy.ts` | 固定日本語 |
| `src/features/auth/auth-gateway.ts` | `sendEmailOtp` / `verifyEmailOtp` / `token_hash` unbound |
| `src/features/auth/login-page.tsx` | 主 CTA・番号待ち・leftover 例外 |
| `src/features/auth/auth-callback-page.tsx` | confirm CTA 削除 |
| `infra/supabase/templates/otp-code.html` | Magic / Confirm 共用本文 |
| `infra/supabase.override.yaml` | テンプレ URL + `GOTRUE_MAILER_OTP_EXP=3600` |
| `docs/deployment/supabase.md` | token_hash 必須を番号テンプレ必須へ |
| `e2e/fixtures/auth.ts` | 製品は 6 桁、bootstrap は action_link 非 goto |

ロック値:
- `GOTRUE_MAILER_OTP_LENGTH = 6`
- `GOTRUE_MAILER_OTP_EXP = 3600`
- `GOTRUE_SMTP_MAX_FREQUENCY = 60s`（画面再送 local 60 以上。`compose.e2e.yaml` の `1s` は suite 専用で製品 override に写さない）
- `GOTRUE_RATE_LIMIT_OTP = 30`
- `GOTRUE_RATE_LIMIT_VERIFY = 360`（hosted `/auth/v1/verify` の IP あたり既定。local CONFIG 既定 30 のままにしない）
- 画面再送は既存 `VITE_MAGIC_LINK_RESEND_SECONDS`
- 番号成功印キー: `kondate.auth.emailOtpCompleted`（sessionStorage。値は時刻だけ。番号も returnTo も入れない。TTL ≤ 60s。logout の residual キーに足す）

---

### Task 1: 6 マス入力

**Files:**
- Create: `src/features/auth/otp-digit-field.tsx`
- Create: `src/features/auth/otp-digit-field.test.tsx`

**Interfaces:**
- Produces:
  - `export function normalizeOtpDigits(raw: string): string`（NFKC のあと `\d` だけ、最大 6）
  - `export function OtpDigitField(props: { value: string; disabled: boolean; onChange(next: string): void })`

- [ ] **Step 1: RED**

`otp-digit-field.test.tsx`: `normalizeOtpDigits("１２３４５６")` は `"123456"`。`"12ab34"` は `"1234"`。7 桁貼付は先頭 6。`OtpDigitField` は 6 つの spinbutton/textbox。`aria-label` は `確認番号の1けた目` … `確認番号の6けた目`。`value=""` で 1 けた目に `3` を入れると `onChange("3")`。`value="12"` で 3 けた目に貼付 `"3456"` すると `onChange("123456")`。`value="12"` で 2 けた目 Backspace は `onChange("1")`。`disabled` 中は入力できない。composition 中の Enter では `onChange` しない。

- [ ] **Step 2: RED 確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/auth/otp-digit-field.test.tsx`

Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 実装**

`normalizeOtpDigits`: `raw.normalize("NFKC").replace(/\D/gu, "").slice(0, 6)`。

`OtpDigitField`: `fieldset` + 見出し。hidden または visually-hidden の単一 `input`（`autoComplete="one-time-code"`, `inputMode="numeric"`, `maxLength={6}`）が正本。6 マスはそれを映す。各マス `min-h-11 min-w-11`。compositionstart/end で IME 中フラグ。6 桁になってもこのコンポーネントは verify しない（親が `value.length === 6` を見る）。

- [ ] **Step 4: GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/auth/otp-digit-field.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/otp-digit-field.tsx src/features/auth/otp-digit-field.test.tsx
git commit -m "feat(auth): 確認番号の6マス入力を追加"
```

---

### Task 2: Gateway の番号送信・確認と token_hash 遮断

**Files:**
- Create: `src/features/auth/email-otp-copy.ts`
- Modify: `src/features/auth/auth-gateway.ts`
- Modify: `src/features/auth/auth-gateway.test.ts`

**Interfaces:**
- Produces:
  - copy 定数（Spec §3 / §6 の exact 文字列）
  - `AuthGateway.sendEmailOtp(email: string): Promise<{ email: string; resendAvailableAt: string }>`
  - `AuthGateway.verifyEmailOtp(input: { email: string; token: string }): Promise<{ kind: "complete" } | { kind: "mismatch" } | { kind: "unavailable" }>`
- Consumes: 既存 `client.auth.signInWithOtp` / `verifyOtp`、`getPublicEnv().magicLinkResendSeconds`

- [ ] **Step 1: RED**

`auth-gateway.test.ts` に足す:

1. `sendEmailOtp` は `signInWithOtp` を `{ email, options: { shouldCreateUser: true } }` で呼ぶ。`options` に `emailRedirectTo` が無い。`createAuthFlow` 相当の storage 行が増えない。
2. `verifyEmailOtp` 成功は `{ kind: "complete" }`。`token` が `"12ab34"` / `"12345"` / `"1234567"` のとき `verifyOtp` を呼ばず `{ kind: "mismatch" }`。
3. `verifyOtp` が `otp_expired` または `token_expired` → `mismatch`。`otp_disabled` または `over_request_rate_limit` → `unavailable`。未知 code → `unavailable`。
4. `completeCallback` に `token_hash` がある URL は `unbound_callback`。`writePendingAuthDeposit` が走らない（pending キー無し）。`verifyOtp` 非呼び出し。

- [ ] **Step 2: RED 確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/auth/auth-gateway.test.ts`

Expected: FAIL（メソッド未定義 / token_hash が needs_confirmation）

- [ ] **Step 3: 実装**

`email-otp-copy.ts` に Spec §3.1–3.2 と §6 の文字列を export。

`sendEmailOtp`:

```ts
async sendEmailOtp(email: string) {
  const trimmed = email.trim();
  try {
    const { error } = await client.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: true },
    });
    if (error !== null) throw new Error("email otp send failed");
  } catch {
    throw new Error(EMAIL_OTP_SEND_FAILED);
  }
  return {
    email: trimmed,
    resendAvailableAt: new Date(
      Date.now() + getPublicEnv().magicLinkResendSeconds * 1_000,
    ).toISOString(),
  };
}
```

`verifyEmailOtp`: `normalizeOtpDigits(token).length === 6` でなければ `{ kind: "mismatch" }`。`verifyOtp({ email, token: digits, type: "email" })`。成功 `{ kind: "complete" }`。code 写像は上表。

`completeCallback` の `token_hash !== null` 分岐を、pending も `needs_confirmation` も無しの `unbound_callback` に置き換える（code 同時載りも今どおり unbound）。

`sendMagicLink` / `confirmMagicLink` は型に残してよい。新しいテストからは呼ばない。

- [ ] **Step 4: GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/auth/auth-gateway.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/email-otp-copy.ts src/features/auth/auth-gateway.ts src/features/auth/auth-gateway.test.ts
git commit -m "feat(auth): メール番号の送信と確認を gateway に足す"
```

---

### Task 3: ログイン画面と leftover 例外

**Files:**
- Modify: `src/features/auth/login-page.tsx`
- Modify: `src/features/auth/login-page.test.tsx`
- Modify: `src/features/auth/auth-callback-page.tsx`（confirm CTA と `confirmMagicLink` 呼び出しを削除）
- Modify: `src/features/auth/auth-callback-page.test.tsx`（needs_confirmation ケースを unbound に合わせる）
- Modify: `src/features/auth/magic-link-state.ts`（番号待ち state に置き換え、または縮小して login から参照）
- Modify: `src/features/auth/auth-cleanup.ts`（`kondate.auth.emailOtpCompleted` を residual 掃除キーに足す）

**Interfaces:**
- Consumes: Task 1 `OtpDigitField` / `normalizeOtpDigits`、Task 2 `sendEmailOtp` / `verifyEmailOtp` / copy
- Produces: leftover-capable でも番号成功は Navigate。sibling 規則

- [ ] **Step 1: RED**

`login-page.test.tsx`:

1. 主ボタン名 `番号をメールで受け取る`。副 `Googleで続ける`。長押しプレビュー文が無い。
2. 送信成功後も URL は `/login`。見出し `メールを確認してください`。6 マスがある。
3. 6 桁入力で `verifyEmailOtp` が一度だけ（in-flight）。確認中は再送・変更が disabled。
4. leftover-capable（query 無し、および `?authError=unbound_callback`）で verify `complete` → `returnTo`（query 無しなら `/welcome`）へ Navigate。**同じ leftover-capable URL で Login を unmount/remount** しても `signOut` されない。inbound leftover（番号成功印なし）の C-R2 / C-R4 は残す。
5. Google 開始成功のあと番号待ち UI が消える。storage に Google `authorization_code` flow がある状態で番号 `complete` → その flow が無い。
6. `otp_expired` 相当の mismatch でマスが空。コピーは `番号が違います。メールの 6 桁をもう一度入力してください。`
7. `<StrictMode>` で 6 桁入力しても `verifyEmailOtp` は **1 回**。

callback テスト: `token_hash` URL で「ログインを完了する」が無い。

- [ ] **Step 2: RED 確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/auth/login-page.test.tsx src/features/auth/auth-callback-page.test.tsx`

Expected: FAIL

- [ ] **Step 3: 実装**

- 主 CTA を番号送信に。Google を副へ。
- 番号待ちは同一 `/login`。`OtpDigitField`。`value.length === 6` かつ未 in-flight で `verifyEmailOtp`。
- 単一 in-flight フラグ。stale 応答破棄。
- snapshot: sessionStorage に `email` / `resendAvailableAt` / `storedAt` のみ。TTL は現行 60s。番号も `returnTo` も書かない。
- `returnTo` は `sanitizeLoginReturnPath`（既定 `/welcome`）。
- 成功: sessionStorage に `kondate.auth.emailOtpCompleted`（`storedAt` のみ、TTL ≤ 60s）を書いてから Navigate。**component ref だけを正にしない**（再マウントで消える）。`isLeftoverCapableLoginLeave` が true でも、印が新鮮なら Navigate し、`clearLeftoverLoginSessionIfNoSiblingCompletion` を走らせない。印が無い inbound leftover は今どおり C-R2 / C-R4。logout で印を消す（`MAGIC_LINK_RESIDUAL_KEYS` に足す）。
- 単一 verify: callback と同型の **同期 ref**（`verifyInFlightRef`。state 更新前に立てる）。`useState` in-flight だけは StrictMode remount で戻るので禁止。IME composition 中は親でも verify しない。
- Google 開始成功: snapshot とマスと番号待ちを捨てる。
- verify 成功直前: login 側ヘルパが未期限切れの Google / `authorization_code`（および残存 `token_hash`）を **すべて** `markAuthFlowUserDismissed` + `clearAuthFlow`。ダミー completed id 禁止。`ContinuationApi.create` 禁止。`clearSiblingUnexpiredAuthFlows` は完了 id が無いので呼ばない（空文字を渡して全消し、も禁止）。
- callback: `needs_confirmation` 分岐と confirm ボタンを削除。`token_hash` は gateway が unbound を返すので既存 error UI に乗る。

- [ ] **Step 4: GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/auth/login-page.test.tsx src/features/auth/auth-callback-page.test.tsx`

Expected: PASS

- [ ] **Step 5: typecheck / lint（この Task の差分だけ直す）**

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/features/auth/login-page.tsx src/features/auth/login-page.test.tsx src/features/auth/auth-callback-page.tsx src/features/auth/auth-callback-page.test.tsx src/features/auth/magic-link-state.ts
git commit -m "feat(auth): ログインを番号確認に切り替え leftover 成功を残す"
```

---

### Task 4: メール文面と OTP 寿命

**Files:**
- Create: `infra/supabase/templates/otp-code.html`
- Create: `infra/supabase/templates/otp-code-subject.txt`（中身: `こんだて日和の番号`）
- Create: `scripts/otp-email-templates.test.mjs`
- Modify: `infra/supabase.override.yaml`（auth.environment）
- Modify: `docs/deployment/supabase.md`（token_hash URL 必須を番号テンプレ必須へ）

**Interfaces:**
- Produces: 両テンプレ同一本文。`GOTRUE_MAILER_OTP_EXP=3600`。`GOTRUE_MAILER_OTP_LENGTH=6`

- [ ] **Step 1: RED**

`scripts/otp-email-templates.test.mjs`: 両テンプレファイル（または 1 ファイルを 2 環境変数で共有）に `{{ .Token }}` がある。`ConfirmationURL` / `TokenHash` / `RedirectTo` / `http` / `https` が無い。件名ファイルが `こんだて日和の番号`。override に `GOTRUE_MAILER_OTP_EXP: "3600"` と `GOTRUE_MAILER_OTP_LENGTH: "6"` と `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` / `GOTRUE_MAILER_TEMPLATES_CONFIRMATION` がある。

Run: `docker compose run --rm --no-deps app node --test scripts/otp-email-templates.test.mjs`

Expected: FAIL

- [ ] **Step 2: 実装**

HTML はプレーンでよい。本文:

```html
<p>アプリの画面に、この 6 つの数字を入力してください。</p>
<p style="font-size:28px;letter-spacing:0.2em">{{ .Token }}</p>
```

`infra/supabase.override.yaml` の auth に `./templates` を bind する（`infra/supabase/templates` → コンテナ `/home/templates`）。GoTrue の TEMPLATES は **同じファイル**を指す。`file://` は live 根拠が無いので使わない。auth が HTTP で取る必要があるなら、既存スタックで届く絶対 URL を 1 本書き、Linux で `host.docker.internal` を使う場合だけ `extra_hosts` を本文に書く。未検証 URL や `…` を残さない。

```yaml
GOTRUE_MAILER_OTP_EXP: "3600"
GOTRUE_MAILER_OTP_LENGTH: "6"
GOTRUE_SMTP_MAX_FREQUENCY: "60s"
GOTRUE_RATE_LIMIT_OTP: "30"
GOTRUE_RATE_LIMIT_VERIFY: "360"
GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED: "false"
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: <到達可能な同一 HTML の絶対 URL>
GOTRUE_MAILER_TEMPLATES_CONFIRMATION: <同じ URL>
GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: こんだて日和の番号
GOTRUE_MAILER_SUBJECTS_CONFIRMATION: こんだて日和の番号
```

`MAGIC_LINK_ENABLED` を切れないなら false を諦め、Task 4 と `docs/deployment/supabase.md` に「URL 無しテンプレが唯一の防御」と書く。Invite / Recovery は触らない。`compose.e2e.yaml` の `GOTRUE_SMTP_MAX_FREQUENCY: "1s"` は suite 専用のまま。

`docs/deployment/supabase.md` の token_hash 必須を、「Magic Link と Confirm の本文に URL を置かない・`{{ .Token }}` を置く・OTP exp 3600 / length 6 / RATE_LIMIT_OTP 30 / RATE_LIMIT_VERIFY 360 / SMTP_MAX_FREQUENCY 60s」に置き換える。

Task 4 GREEN は YAML キー存在だけで通さない。両 TEMPLATES が同じ到達可能 URL / 同じファイルであること、本文に `http`/`https`/`ConfirmationURL` が無いことを固定する。Mailpit 本文の受け入れは Task 5 の `requestEmailOtpAndReadCode` が担う。

- [ ] **Step 3: GREEN**

Run: `docker compose run --rm --no-deps app node --test scripts/otp-email-templates.test.mjs`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add infra/supabase/templates infra/supabase.override.yaml docs/deployment/supabase.md scripts/otp-email-templates.test.mjs
git commit -m "feat(auth): 番号メール文面とOTP寿命3600秒を固定する"
```

---

### Task 5: E2E 製品経路と bootstrap

**Files:**
- Modify: `e2e/fixtures/auth.ts`
- Modify: `e2e/specs/auth.setup.ts`
- Modify: `e2e/specs/auth-recovery.spec.ts`
- Modify: ボタン名を参照する spec（`oauth-mock.spec.ts` 等。grep `ログイン用メール`）

**Interfaces:**
- Produces: `requestEmailOtpAndReadCode(page, email): Promise<string>`（ちょうど 6 桁。本文に `http` / `https` が 1 つでもあれば throw）
- `loginAsNewUser`: `generateLinkPropertiesSchema` の `hashed_token` をページ外で `verifyOtp({ token_hash, type: "email" })`（service admin または `page.request` POST `/auth/v1/verify`）。返った access/refresh を現行どおり storage へ載せて `/planner` を開く。`email_otp` を schema に足さない。`page.goto(action_link)` も `request.get(action_link)` も使わない。コメント「製品外 bootstrap」

- [ ] **Step 1: RED / 置換**

`requestMagicLinkAndReadUrl` を削除または番号読みに置換。Mailpit の Magic **と** Confirm 本文を見る。URL 正規表現を残さない。

`auth.setup.ts`: UI で `番号をメールで受け取る` → `requestEmailOtpAndReadCode` → 6 マス入力。`goto` でメール URL を開かない。

`auth-recovery.spec.ts`: 同一ブラウザ / 孤立 WebView の **メール callback** 2 本を削除。Google cancel / leftover は残し、ボタン名を新コピーへ。

`loginAsNewUser`: `page.goto(browserUrl)` と `request.get(action_link)` をやめる。`hashed_token` + ページ外 `verifyOtp`。`normalizeGenerateLinkActionUrl` を残すならテスト専用と Files に書く。

- [ ] **Step 2: ユニット相当**

Mailpit HTML から 6 桁を抜く純関数: 製品テンプレ相当（`{{ .Token }}` を `123456` に置換、`http`/`https` 無し）→ `"123456"`。本文に `http` または `https` が 1 つでもあれば throw。`https://example` だけのケースだけでは足りない。

Run: そのテストが PASS すること（製品 E2E 全件はこの Task では回さない。CLAUDE.md）。

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/auth.ts e2e/specs/auth.setup.ts e2e/specs/auth-recovery.spec.ts e2e/specs/oauth-mock.spec.ts
git commit -m "test(auth): 製品E2Eを番号入力にしマジックリンク踏破を外す"
```

---

### Task 6: 横断ゲート

**Files:** 漏れていれば Task 1–5 の差分だけ

- [ ] **Step 1**

Run: `docker compose run --rm --no-deps app npm run format:check`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npx vitest run src/features/auth/otp-digit-field.test.tsx src/features/auth/auth-gateway.test.ts src/features/auth/login-page.test.tsx src/features/auth/auth-callback-page.test.tsx`

Run: `docker compose run --rm --no-deps app node --test scripts/otp-email-templates.test.mjs`

Expected: すべて PASS。失敗はこの Plan の差分だけ直す。

- [ ] **Step 2**

人間またはセッションが E2E を回すとき: `./scripts/run-e2e.sh -- e2e/specs/auth.setup.ts` 相当と login 製品経路。フル E2E はエージェントが勝手に全件回さない。

- [ ] **Step 3: Commit（差分が無いならしない）**

```bash
git commit -m "test(auth): 番号ログインの横断ゲートを固定する"
```

---

## Self-review (plan vs spec)

| Spec | Task |
| --- | --- |
| §3 画面・6 マス・copy | Task 1 + 3 |
| §3.3 leftover 例外・既定 `/welcome` | Task 3 |
| §4.1 send/verify・写像 | Task 2 |
| §4.2–4.4 token_hash 無処理 | Task 2 + 3 |
| §4.3 sibling | Task 3 |
| §5 テンプレ両通・3600s | Task 4 |
| §6 exact copy | Task 2 copy + Task 3 UI |
| §7 製品 E2E / bootstrap | Task 5 |
| Auth ロック非再定義 / Continuation 非新設 | Global + Task 2–3 |
| iPhone 案内図解 | 非対象 |

Placeholders: なし（テンプレは bind + 同一到達 URL。`host.docker.internal:…` は禁止）。

**Plan レビュー:** `docs/superpowers/reviews/2026-08-16-email-otp-login-plan-{primary,adversarial,secondary}.md`（二次 REVISE_PLAN / MF-P1…P6 を本文へ反映済み）。
