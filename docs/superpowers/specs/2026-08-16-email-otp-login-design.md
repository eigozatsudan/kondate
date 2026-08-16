# こんだて日和 メール 6 桁番号ログイン設計

- 日付: 2026-08-16
- 状態: **レビュー MF 反映済み・Plan 作成済み**（Spec MF-C1 / MF-I1…I8、Plan MF-P1…P6 を本文へ反映）
- 実装計画: `docs/superpowers/plans/2026-08-16-email-otp-login.md`
- 種別: 設計。マジックリンクを廃止し、同じタブの 6 桁メール OTP にする
- 対象: `src/features/auth/`（login・gateway・callback UI）、メール文面（Magic Link と Confirm sign up）、GoTrue OTP 設定、関連 Vitest / E2E、`docs/deployment/supabase.md`
- 非対象: iPhone ホーム画面案内の短縮・図解（別スライス）、SMS、パスワード、パスキー、Google の standalone 修復、`admin/`、safety、課金
- 前提: 本番に実ユーザーはいない。旧マジックリンクの移行はしない
- レビュー:
  - [1次](../reviews/2026-08-16-email-otp-login-primary.md)
  - [敵対](../reviews/2026-08-16-email-otp-login-adversarial.md)
  - [2次](../reviews/2026-08-16-email-otp-login-secondary.md)

---

## 1. 結論

メールログインは **リンクを開かない**。届いた **6 桁を、ログイン画面の 6 マスに入れる**。ホーム画面アプリから出ない。Google は残すが主ボタンではない。

| 項目 | 決定 |
| --- | --- |
| メール経路 | Supabase / GoTrue の email OTP（案 A）。自前発行しない |
| マジックリンク | 廃止。メールに URL を載せない。`token_hash` は pending も verify も deposit もしない |
| 主操作 | メール欄 + 「番号をメールで受け取る」 |
| 副操作 | 「Googleで続ける」 |
| 入力 | 6 マス。半角数字。1 桁ずつ。貼り付け可。6 桁そろったら即確認 |
| 新規 / 既存 | 今と同じ 1 画面。`shouldCreateUser: true`。パスワードなし |
| 成功 leave | leftover-capable `/login` でも即 `returnTo`（既定 `/welcome`）。その session を leftover 掃除しない |
| 旧リンク | 無視。専用案内なし |
| Auth ロック | `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` を再定義しない |
| Continuation | メール用に新設しない。Google 専用のまま |

---

## 2. 目的と対象外

### 2.1 目的

1. ホーム画面アプリの中でメールログインを完結させる（メールアプリや Safari に出たまま戻れない、をやめる）。
2. ライトユーザーが「番号を写す」だけで進める。
3. 長押しプレビューやリンク再利用で壊れるマジックリンク経路を捨てる。

### 2.2 対象外

- iPhone / Android の「ホーム画面に置く」案内の文面・図解（別 Spec）
- SMS / WhatsApp / 音声通話
- Google OAuth が standalone で Safari に出ることの修復（§2.3）
- マジックリンクの猶予期間・旧メールの専用案内
- メールアドレスの存在有無を画面に出すこと
- CSP 緩和、Auth ロック export の作り直し
- 全 E2E fixture を Mailpit 必須にすること（製品経路と bootstrap は分ける）
- OTP 寿命の 15 分天井（推奨であり必須ではない）

### 2.3 受け入れ残差（直さない）

| 残差 | 扱い |
| --- | --- |
| Google はホーム画面アプリでも Safari / システムブラウザに出ることがある | 副導線のまま。案内文では触れない |
| メールアプリを開いて番号を見る操作は残る | 戻る先は同じ `/login` の 6 マス。リンクは踏ませない |
| 共有端末に宛先メールが短時間残る | 短寿命 sessionStorage（continuation TTL より短い 60s）。番号は入れない |
| 6 桁は空間が狭い | 試行回数は GoTrue に任せ、残り回数は出さない。メール単位の失敗ロックは GoTrue に無い。IP レート + 短い寿命（≤3600s）で閉じる |
| Admin `generateLink` はサービスロールがあれば URL を出せる | 製品 UI からは消す。オペレータ面は残差 |
| `SHOW_EMAIL_LOGIN` フラグ | live は既に `true`。主経路は隠れない |

---

## 3. 画面

ルートは `/login` のみ。送信後も URL は `/login` のまま（番号待ちは同一ルートの状態）。成功したら `returnTo` へ去る。

### 3.1 初期

- リードは現行どおり: `はじめての方も、すでに使っている方も、この画面から進めます。`
- 補足: `新規登録の別画面はありません。番号を受け取るか Google で進むと、はじめての方はアカウントができます。パスワードの設定は不要です。`
- 主: メール欄（`type="email"`、`autocomplete="email"`、ラベル `メールアドレス`）と主ボタン `番号をメールで受け取る`（送信中は `送信中…`、`min-h-11`）
- 副: `Googleで続ける`（処理中は `Googleへ移動中…`）
- マジックリンク用ヒント（長押しプレビュー、「ログインを完了する」）は置かない。
- `PWA` / `OTP` / `ワンタイム` はユーザー向けに書かない。

### 3.2 送信後（番号待ち）

- 見出し: `メールを確認してください`
- 宛先: `{email} に送りました`（空なら出さない）
- 本文: `メールに書いてある 6 つの数字を、下に入力してください。`
- 補足: `迷惑メールフォルダも確認してください`
- 6 マス:
  - 数字のみ。入力は NFKC のうえ半角数字に正規化する。
  - 1 マス 1 桁。入力で次へ。Backspace で前へ。
  - 貼り付けは先頭から半角数字だけを最大 6 桁埋める。
  - IME composition 中は verify しない。
  - `autocomplete="one-time-code"` は単一のルート入力（hidden または結合 input）。各マスは `aria-label`（`確認番号の1けた目` … `確認番号の6けた目`）。`fieldset` と見出しで結びつける。
  - 44×44 CSS px。320 CSS px で横スクロールしない。
- 6 桁そろった時点で `verifyEmailOtp` する。別の「ログイン」ボタンは置かない。
- **単一 in-flight:** send / verify / resend / メール変更は同時に一つだけ。確認中はマス・再送・変更を押せない。stale 応答は捨てる。
- 再送: 現行 `VITE_MAGIC_LINK_RESEND_SECONDS`（画面床）。待ち中は `{n}秒後に再送できます`。空いたら `番号を再送`。GoTrue の送信床より画面側を緩めない。
- `メールアドレスを変更` で初期に戻す（マスと番号待ちと snapshot を捨てる）。in-flight 中は押せない。
- `Googleに切り替える` は残す。開始成功時は §4.3 の sibling 規則。

### 3.3 成功（MF-C1）

`verifyEmailOtp` が `complete` を返したら、**leftover-capable でも即 `returnTo` へ `<Navigate replace>` する。**

leftover 掃除の対象は **マウント時点で既にあった persist / inbound `authError` leave** に限る。このタブで今立てた session は leftover 掃除しない。メール用 Continuation は作らない。

成功 leave の既定は live と同じ **`/welcome`**（`sanitizeLoginReturnPath` の fallback）。`/planner` は `sanitizeReturnPath` の別関数既定であり、login の成功先には使わない。

`returnTo` の正本は **login ページが持つ sanitize 済み URL query**（無ければ `/welcome`）。gateway の snapshot に `returnTo` を入れない。

Vitest: leftover-capable `/login` および `/login?authError=unbound_callback` で verify 成功 → Navigate。再マウントしてもその session が残る。

---

## 4. Auth 境界

### 4.1 伸ばす

`AuthGateway` に次を足す（既存 export を作り直さない）:

```ts
sendEmailOtp(email: string): Promise<{
  email: string;
  resendAvailableAt: string;
}>;

verifyEmailOtp(input: { email: string; token: string }): Promise<
  | { kind: "complete" }
  | { kind: "mismatch" }
  | { kind: "unavailable" }
>;
```

- `sendEmailOtp`: `client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`。**`emailRedirectTo` を付けない**（十分条件ではない。URL 削除の本体は §5）。`AuthFlow` / `ContinuationApi` は作らない。失敗は日本語送信エラー。
- `verifyEmailOtp`: `token` はちょうど 6 桁の半角数字。それ以外はクライアントで `mismatch`（サーバに送らない）。`client.auth.verifyOtp({ email, token, type: "email" })`。成功で session。`returnTo` は返さない（画面が持つ）。
- GoTrue 写像（MF-I7）:
  - `otp_expired` / `token_expired` → `mismatch`（不正も期限切れも同じコピー。三分割しない）
  - `otp_disabled` / `over_request_rate_limit` → `unavailable`
  - 未知 → `unavailable`（fail-closed。サーバ文は出さない）
- 画面 snapshot（短寿命 sessionStorage）: `email` と `resendAvailableAt` と時刻だけ。**番号も `returnTo` も入れない。**

`sendMagicLink` / `confirmMagicLink` は **ログイン画面と callback から呼ばない。** 型に残ってもよい。

### 4.2 捨てる（画面と経路）

- `/auth/callback` の `needs_confirmation` UI（「ログインを完了する」）と `confirmMagicLink` 呼び出し
- メールの Confirmation URL / `token_hash` を踏ませる導線
- ログイン画面のマジックリンク専用コピー
- 製品 E2E がメール URL を `goto` する経路

### 4.3 残す / sibling（MF-I2）

- Google: `signInWithGoogle` → `/auth/callback` → PKCE / `authorization_code`。`AuthFlow` + `ContinuationApi` は Google 専用。ピンも Google 専用。番号成功は AuthProvider の通常 first-session pin に載せる。
- `signInWithGoogle` 開始成功時: 番号待ち snapshot と 6 マス state を捨て、以降その番号では `verifyEmailOtp` しない。
- `verifyEmailOtp` 成功直前: 既存の未期限切れ Google `AuthFlow` を現行 sibling と同型で dismiss / clear する。`ContinuationApi.create` はしない。
- leftover / sibling / pin の **Google 向け**規則は維持。
- `AuthFlow` の `credentialKind: "token_hash"` はスキーマから消さない。**新規作成しない。**

### 4.4 `token_hash` は何もしない（MF-I6）

`completeCallback` が `token_hash` を見たら:

- pending を書かない
- `needs_confirmation` を返さない
- `verifyOtp` しない
- deposit しない
- `unbound_callback` を返す

受け入れ: 古い `?token_hash=` を開いても `verifyOtp` も deposit も走らない。

### 4.5 秘密とログ

- 6 桁は入力 state のみ。`localStorage` / `sessionStorage` に番号を書かない。
- `console` やサーバログにメール・番号・raw GoTrue 文を出さない。
- 所有掃除: 宛先キーは今どおり logout で消す。番号は storage に無いので対象外。

---

## 5. メールと GoTrue（MF-I1 / MF-I4）

`emailRedirectTo` 省略は必要だが、**URL を消す本体ではない。** GoTrue はテンプレの `{{ .ConfirmationURL }}` でリンクを出す。

変更対象は **Magic Link と Confirm sign up の両方**。Invite / Recovery は触らない。

- 件名: `こんだて日和の番号`
- 本文: 6 桁（`{{ .Token }}`）を大きく出し、`アプリの画面に、この 6 つの数字を入力してください。`
- 置かない: `{{ .ConfirmationURL }}` / `{{ .TokenHash }}` / `{{ .RedirectTo }}` / 生の `http` / `https`
- ローカル: repo 内 HTML + compose の `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` と `GOTRUE_MAILER_TEMPLATES_CONFIRMATION`（subject 含む）
- 本番: Dashboard の両テンプレを同じ制約で差し替え。`docs/deployment/supabase.md` の token_hash URL 必須を、番号テンプレ必須に置き換える
- `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED`: 切れるなら false。切れない／残すなら **URL 無しテンプレが唯一の防御** と明記する

桁は **6**。寿命は **ローカルと本番で同一、かつ ≤ 3600s**（hosted 既定）。**86400s を正にしない。** Plan 作成時に秒数を読み、この上限の中で同一値を固定する。

`GOTRUE_RATE_LIMIT_VERIFY` と送信床（`SMTP_MAX_FREQUENCY` / `RATE_LIMIT_OTP`）もローカルと本番で同一。画面再送（`VITE_MAGIC_LINK_RESEND_SECONDS`）より緩めない。

受け入れ: Mailpit / 本番テスト便に 6 桁があり、本文に `http` / `https` が無い。

---

## 6. 失敗コピー（exact）

GoTrue は不正トークンと期限切れを同じ `otp_expired` に畳む。**mismatch と expired をユーザー向けに三分割しない。**

| 状況 | 文言 |
| --- | --- |
| 送信失敗 | `メールを送れませんでした。アドレスを確認してもう一度お試しください。` |
| 番号が使えない（不一致・期限切れ・使用済み） | `番号が違います。メールの 6 桁をもう一度入力してください。` |
| 回数超過・利用不可 | `少し待ってから、新しい番号を受け取ってください。` |
| Google 開始失敗 | 現行どおり `Googleログインを開始できませんでした。もう一度お試しください。` |

不一致扱いはマスを空にする。利用不可のときは再送できる状態にする（in-flight 解除後）。

未登録でも送信成功に見せる（ユーザ列挙しない）。

---

## 7. テスト（MF-I5）

| 対象 | 固定すること |
| --- | --- |
| 6 マス | 半角正規化 / 1 桁進む / Backspace / 6 桁貼り付け / 5 桁では verify しない / composition 中は verify しない / 確認中は無効 |
| `sendEmailOtp` | `emailRedirectTo` 無し、`shouldCreateUser: true`、AuthFlow を作らない |
| `verifyEmailOtp` | 成功 session、写像、非 6 桁はサーバ未送信 |
| ログイン UI | 主が番号、副が Google。送信後も `/login`。成功で leftover-capable でも Navigate。再マウントで session 残存 |
| sibling | Google 開始で番号 state 破棄。番号成功直前に未期限切れ Google flow を dismiss |
| callback | `token_hash` は unbound。pending / verifyOtp / deposit なし。Google の既存ケースは維持 |
| メール文面 | 両テンプレに 6 桁あり、`http` / `https` 無し |
| 製品 E2E | UI 送信 → Mailpit の **6 桁** → 6 マス。URL を `goto` しない。`requestMagicLinkAndReadUrl` は番号読みに置換または削除 |
| bootstrap E2E | `loginAsNewUser` は **action_link をブラウザで踏まない**。session は既存の hash 注入を「製品外 bootstrap」として残してよい |
| recovery | 同一ブラウザ / 孤立 WebView の **メール callback** ケースは削除。Google cancel / leftover / oauth-mock は残し、ボタン名を新コピーに合わせる |

`@shared/safety` をブラウザへ入れない。CSP を緩めない。

---

## 8. 不変条件

1. メールログインで `window.location` を IdP / メールリンクへ向けない。
2. `emailRedirectTo` を番号送信に付けない。それだけでは不十分。テンプレ両通から URL を除く。
3. 番号を永続ストレージとログに残さない。
4. Auth ロック 4 export を再定義しない。
5. メール用に `ContinuationApi` を新設・利用しない。
6. ユーザー向けに `PWA` / `OTP` / 英語エラーコードを出さない。
7. leftover 掃除は「今このタブで立てた番号 session」を消さない。
8. OTP 寿命 86400s を正にしない。

---

## 9. ファイル（目安）

- 変更: `login-page.tsx` / テスト、`auth-gateway.ts` / テスト、callback ページ（確認 UI 削除）、GoTrue テンプレと OTP 寿命、`docs/deployment/supabase.md`、`e2e/fixtures/auth.ts` とメール URL を踏む spec
- 追加: 6 マスコンポーネントとそのテスト、番号待ち状態（magic-link-state を置き換えまたは縮小）
- 触らない: `AuthProvider` の作り直し、`BrowserSupabaseClient` の作り直し、`createContinuationApi` の契約変更
