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

ロック値: `OTP_LENGTH = 6`、`GOTRUE_MAILER_OTP_EXP = 3600`、画面再送は既存 `VITE_MAGIC_LINK_RESEND_SECONDS`。

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

**Interfaces:**
- Consumes: Task 1 `OtpDigitField` / `normalizeOtpDigits`、Task 2 `sendEmailOtp` / `verifyEmailOtp` / copy
- Produces: leftover-capable でも番号成功は Navigate。sibling 規則

- [ ] **Step 1: RED**

`login-page.test.tsx`:

1. 主ボタン名 `番号をメールで受け取る`。副 `Googleで続ける`。長押しプレビュー文が無い。
2. 送信成功後も URL は `/login`。見出し `メールを確認してください`。6 マスがある。
3. 6 桁入力で `verifyEmailOtp` が一度だけ（in-flight）。確認中は再送・変更が disabled。
4. leftover-capable（query 無し、および `?authError=unbound_callback`）で verify `complete` → `returnTo`（query 無しなら `/welcome`）へ Navigate。再マウントで session が残る（`signOut` されない）。
5. Google 開始成功のあと番号待ち UI が消える。
6. `otp_expired` 相当の mismatch でマスが空。コピーは `番号が違います。メールの 6 桁をもう一度入力してください。`

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
- 成功: `emailOtpCompletedRef.current = true` のあと Navigate。`isLeftoverCapableLoginLeave` が true でも、この ref が true なら Navigate し、`clearLeftoverLoginSessionIfNoSiblingCompletion` を走らせない。
- Google 開始成功: snapshot とマスと番号待ちを捨てる。
- verify 成功直前: `clearSiblingUnexpiredAuthFlows` を、完了 id が無い場合は「番号用ダミーを作らず」既存 Google flow をすべて clear するヘルパを login 側で呼ぶ。`listUnexpiredAuthFlows` + `clearAuthFlow` で足りる。`ContinuationApi.create` はしない。
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

override の auth.environment に（パスはコンテナから読める bind に合わせる）:

```yaml
GOTRUE_MAILER_OTP_EXP: "3600"
GOTRUE_MAILER_OTP_LENGTH: "6"
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: http://host.docker.internal:… または file が使えるなら repo 相対
GOTRUE_MAILER_TEMPLATES_CONFIRMATION: （同じ HTML）
GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: こんだて日和の番号
GOTRUE_MAILER_SUBJECTS_CONFIRMATION: こんだて日和の番号
```

ローカルでテンプレ URL が host 経由必須なら、既存 mailpit / kong の出し方に合わせる。Invite / Recovery は触らない。

`docs/deployment/supabase.md` の token_hash 必須を、「Magic Link と Confirm の本文に URL を置かない・`{{ .Token }}` を置く・OTP exp 3600 / length 6」に置き換える。

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
- Produces: `requestEmailOtpAndReadCode(page, email): Promise<string>`（ちょうど 6 桁）
- `loginAsNewUser` は **page.goto(action_link) しない**。generateLink の token 取得は Playwright `request`（ページ外）または既存 hash 注入の製品外 bootstrap。製品ログイン定義にしない

- [ ] **Step 1: RED / 置換**

`requestMagicLinkAndReadUrl` を削除または内部で番号読みに置換。Mailpit から **6 桁** を取る。URL 正規表現を残さない。

`auth.setup.ts`: UI で `番号をメールで受け取る` → `requestEmailOtpAndReadCode` → 6 マス入力。`goto` でメール URL を開かない。

`auth-recovery.spec.ts`: 同一ブラウザ / 孤立 WebView の **メール callback** 2 本を削除。Google cancel / leftover は残し、ボタン名を新コピーへ。

`loginAsNewUser`: `page.goto(browserUrl)` をやめる。コメントで「製品外 bootstrap」。session は generateLink 応答をページ外で解決してから、現行どおり storage へ載せて `/planner` を開く。

- [ ] **Step 2: ユニット相当**

fixture のヘルパに、Mailpit HTML から 6 桁を抜く純関数テストを `e2e/fixtures/auth-otp-parse.test.ts`（または `src` 外なら `node --test`）で固定: `"番号 123456 です"` → `"123456"`。`https://example` だけの本文は throw。

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

Placeholders: テンプレの compose 配信 URL は既存 mail パターンに合わせる（新規ホストを発明しない）。
