# こんだて日和 メール 6 桁番号ログイン設計

- 日付: 2026-08-16
- 状態: **設計承認済み・Plan 未作成**
- 種別: 設計。マジックリンクを廃止し、同じタブの 6 桁メール OTP にする
- 対象: `src/features/auth/`（login・gateway・callback UI）、メール文面、GoTrue / ローカル Auth の OTP 設定、関連 Vitest / E2E
- 非対象: iPhone ホーム画面案内の短縮・図解（別スライス）、SMS、パスワード、パスキー、Google の standalone 修復、`admin/`、safety、課金
- 前提: 本番に実ユーザーはいない。旧マジックリンクの移行はしない

---

## 1. 結論

メールログインは **リンクを開かない**。届いた **6 桁を、ログイン画面の 6 マスに入れる**。ホーム画面アプリから出ない。Google は残すが主ボタンではない。

| 項目 | 決定 |
| --- | --- |
| メール経路 | Supabase / GoTrue の email OTP（案 A）。自前発行しない |
| マジックリンク | 廃止。メールに URL を載せない。`token_hash` 確認画面を出さない |
| 主操作 | メール欄 + 「番号をメールで受け取る」 |
| 副操作 | 「Googleで続ける」 |
| 入力 | 6 マス。1 桁ずつ。貼り付け可。6 桁そろったら即確認 |
| 新規 / 既存 | 今と同じ 1 画面。`shouldCreateUser: true`。パスワードなし |
| 旧リンク | 無視。callback に `token_hash` が来ても入れない。専用案内なし |
| Auth ロック | `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` を再定義しない |

---

## 2. 目的と対象外

### 2.1 目的

1. ホーム画面アプリの中でメールログインを完結させる（メールアプリや Safari に出たまま戻れない、をやめる）。
2. ライトユーザーが「番号を写す」だけで進める。
3. 長押しプレビューやリンク再利用で壊れるマジックリンク経路を捨てる。

### 2.2 対象外

- iPhone / Android の「ホーム画面に置く」案内の文面・図解（別 Spec）
- SMS / WhatsApp / 音声通話
- Google OAuth が standalone で Safari に出ることの修復（§8 残差）
- マジックリンクの猶予期間・旧メールの専用案内
- メールアドレスの存在有無を画面に出すこと
- CSP 緩和、Auth ロック export の作り直し

### 2.3 受け入れ残差（直さない）

| 残差 | 扱い |
| --- | --- |
| Google はホーム画面アプリでも Safari / システムブラウザに出ることがある | 副導線のまま。案内文では触れない |
| メールアプリを開いて番号を見る操作は残る | 戻る先は同じ `/login` の 6 マス。リンクは踏ませない |
| 共有端末に宛先メールが短時間残る | 現行の短寿命 sessionStorage（continuation TTL より短い）を流用 |
| 6 桁は空間が狭い | 試行回数は GoTrue に任せ、残り回数は出さない |

---

## 3. 画面

ルートは `/login` のみ。送信後も遷移しない。

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
- 6 マス: 数字のみ。1 マス 1 桁。入力で次へ。Backspace で前へ。6 桁の貼り付けは先頭から埋める。`autocomplete="one-time-code"` をルート入力に付ける。
- 6 桁そろった時点で `verifyEmailOtp` する。別の「ログイン」ボタンは置かない。
- 確認中はマスを無効化する。
- 再送: 現行 `VITE_MAGIC_LINK_RESEND_SECONDS`（既定 60）を流用。待ち中は `{n}秒後に再送できます`。空いたら `番号を再送`。
- `メールアドレスを変更` で初期に戻す（マスと番号待ち状態を捨てる）。
- `Googleに切り替える` は残す。

### 3.3 成功

今と同じ。session が付いたら `returnTo`（既定 `/planner`）。`Navigate` の leftover 規則は変えない。

---

## 4. Auth 境界

### 4.1 伸ばす

`AuthGateway` に次を足す（既存 export を作り直さない）:

```ts
sendEmailOtp(email: string, returnTo: string): Promise<{
  email: string;
  resendAvailableAt: string;
}>;

verifyEmailOtp(input: {
  email: string;
  token: string;
}): Promise<
  | { kind: "complete"; returnTo: string }
  | { kind: "mismatch" }
  | { kind: "expired" }
  | { kind: "unavailable" }
>;
```

- `sendEmailOtp`: `client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`。**`emailRedirectTo` を付けない。** 失敗は `clear` して日本語送信エラーへ。`AuthFlow` / `ContinuationApi` は作らない。
- `verifyEmailOtp`: `token` はちょうど 6 桁の数字。それ以外はクライアントで `mismatch`（サーバに送らない）。`client.auth.verifyOtp({ email, token, type: "email" })`。成功で session。GoTrue の期限切れ・使用済みは `expired`。不一致は `mismatch`。回数超過・無効化は `unavailable`。
- `returnTo` は送信時に今の `sanitizeLoginReturnPath` で覚え、成功時に使う。continuation 行には載せない。リロード耐性は宛先メールと同じ短寿命 sessionStorage スナップショットに `email` / `returnTo` / `resendAvailableAt` だけを入れる（番号は入れない）。

`sendMagicLink` / `confirmMagicLink` は **ログイン画面と callback から呼ばない。** 型に残ってもよいが、新しい本番経路にしない。

### 4.2 捨てる（画面と経路）

- `/auth/callback` の `needs_confirmation` UI（「ログインを完了する」）
- メールの Confirmation URL / `token_hash` を踏ませる導線
- ログイン画面のマジックリンク専用コピー

### 4.3 残す

- Google: `signInWithGoogle` → `/auth/callback` → PKCE / `authorization_code`。`AuthFlow` + `ContinuationApi` は Google 専用。
- `completeCallback` が `token_hash` を見たら `unbound_callback`（専用文は出さない）。
- `AuthFlow` の `credentialKind: "token_hash"` はスキーマから消さない。**新規作成しない。**
- leftover / sibling / pin の Google 向け規則は維持。

### 4.4 秘密とログ

- 6 桁は入力 state のみ。`localStorage` / `sessionStorage` に番号を書かない。
- 宛先メールの短寿命 sessionStorage は現行マジック用キーを番号用に流用してよい（値はメールと時刻だけ。番号は入れない）。
- `console` やサーバログにメール・番号・raw GoTrue 文を出さない。
- 所有掃除: 宛先キーは今どおり logout で消す。番号は storage に無いので対象外。

---

## 5. メールと GoTrue

- 文面は日本語。件名例: `こんだて日和の番号`。本文は 6 桁を大きく出し、`アプリの画面に、この 6 つの数字を入力してください。` だけ。URL・「リンクを開く」・英語テンプレの ConfirmationURL は載せない。
- 桁は **6**。寿命・試行回数は GoTrue の email OTP 設定に従い、**ローカルと本番で同じ値**にする。Plan 作成時に `infra/supabase` と本番相当設定を読んで秒数と試行上限を本文へ固定する（この Spec では「同じ値」がロック。秒数の仮置きはしない）。
- 再送間隔の画面制御は `VITE_MAGIC_LINK_RESEND_SECONDS`。GoTrue の送信レートと矛盾したら画面側を GoTrue に合わせ、勝手に緩めない。

---

## 6. 失敗コピー（exact）

| 状況 | 文言 |
| --- | --- |
| 送信失敗 | `メールを送れませんでした。アドレスを確認してもう一度お試しください。` |
| 番号不一致 | `番号が違います。メールの 6 桁をもう一度入力してください。` |
| 期限切れ・使用済み | `この番号は使えません。新しい番号を受け取ってください。` |
| 回数超過・利用不可 | `少し待ってから、新しい番号を受け取ってください。` |
| Google 開始失敗 | 現行どおり `Googleログインを開始できませんでした。もう一度お試しください。` |

不一致のときマスを空にする。期限切れ・利用不可のときは再送できる状態にする。

未登録でも送信成功に見せる（ユーザ列挙しない）。

---

## 7. テスト

| 対象 | 固定すること |
| --- | --- |
| 6 マス | 1 桁進む / Backspace / 6 桁貼り付け / 5 桁では verify しない / 確認中は無効 |
| `sendEmailOtp` | `emailRedirectTo` 無し、`shouldCreateUser: true`、失敗で flow を残さない |
| `verifyEmailOtp` | 成功 session、mismatch / expired / unavailable の写像。非 6 桁はサーバ未送信 |
| ログイン UI | 主が番号、副が Google。送信後も `/login`。成功で returnTo |
| callback | `token_hash` は unbound。Google の既存ケースは維持 |
| メール文面 | 6 桁あり、`http` / `https` のリンク無し |
| E2E | マジックリンクを `generateLink` で踏む経路をやめる。ローカル inbox から 6 桁を読んで 6 マスへ。Google / leftover 復旧は残す |

`@shared/safety` をブラウザへ入れない。CSP を緩めない。

---

## 8. 不変条件

1. メールログインで `window.location` を IdP / メールリンクへ向けない。
2. `emailRedirectTo` を番号送信に付けない。
3. 番号を永続ストレージとログに残さない。
4. Auth ロック 4 export を再定義しない。
5. Google 以外で `ContinuationApi` を新規利用しない。
6. ユーザー向けに `PWA` / `OTP` / 英語エラーコードを出さない。

---

## 9. ファイル（目安）

- 変更: `login-page.tsx` / テスト、`auth-gateway.ts` / テスト、callback ページ（確認 UI 削除）、メールテンプレ、GoTrue 設定、`e2e/fixtures/auth.ts` と magic を踏む spec
- 追加: 6 マスコンポーネントとそのテスト、番号待ち状態（magic-link-state を置き換えまたは縮小）
- 触らない: `AuthProvider` の作り直し、`BrowserSupabaseClient` の作り直し、`createContinuationApi` の契約変更
