# 2次検証: メール 6 桁 OTP ログイン設計

- **役割:** 独立 secondary verifier（1次・敵対の著者コンテキストに依存せず、live tree で再照合）
- **日付:** 2026-08-16
- **対象設計:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)
- **入力:**
  - 1次: [`2026-08-16-email-otp-login-primary.md`](./2026-08-16-email-otp-login-primary.md)（**REVISE** / C1 I5 M4）
  - 敵対: [`2026-08-16-email-otp-login-adversarial.md`](./2026-08-16-email-otp-login-adversarial.md)（**BLOCK_WITH_CONDITIONS** / C1 I6 M4）
- **照合（live tree）:** `src/features/auth/login-page.tsx` / `login-page.test.tsx` / `auth-gateway.ts` / `auth-flow.ts` / `auth-callback-page.tsx` / `auth-cleanup.ts` / `protected-routes.tsx` / `src/features/landing/free-landing-page.tsx` / `src/app/route-error-element.tsx` / `src/shared/lib/supabase.ts` / `e2e/fixtures/auth.ts` / `e2e/specs/auth.setup.ts` / `e2e/specs/auth-recovery.spec.ts` / `docs/deployment/supabase.md` / `infra/supabase/docker-compose.yml` / `infra/supabase/CONFIG.md` / `infra/supabase.override.yaml` / `supabase/config.toml` / `.env.example` / `.deploy.env`
- **手法:** 静的再照合のみ。製品コード・仕様本文は未変更（本ファイルのみ成果物）。§2.3 残差は must-fix にしない。

---

## Summary

同じタブで 6 桁を入れる方針と Auth ロック 4 export 非再定義は live と噛み合う。一方、仕様は **現行 leftover 規則を同じ `/login` 完了に凍らせ**、**`emailRedirectTo` 省略でメールから URL が消えると誤認**し、**寿命・E2E・sibling・旧 `token_hash` 経路を実装者に委ねている**。このまま Plan に落とすと主経路（LP → query 無し `/login` → 番号）が成功しないか、成功直後の再表示で session を殺す。

二次の核:

1. **Critical は F1 = C1 の 1 件。** leftover-capable `/login` は authenticated でも Navigate せず、sibling completion 無しなら local signOut する。番号経路は continuation を書かない。仕様が完了点を `/login` に移したのに規則を凍らせたので、仕様が新しい失敗を作っている。
2. **Important は重複排除後 8。** テンプレ両通・寿命天井・E2E 二系統・sibling・旧 `token_hash` pending・in-flight / 写像・入力正規化・`returnTo` 既定。
3. **新 Critical / 新 Important は立てない。** §2.3（Google standalone / メールアプリ往復 / 共有端末 60s / 6 桁の空間そのもの）は欠陥に数えない。
4. **1次 REVISE と敵対 BLOCK_WITH_CONDITIONS は矛盾しない。** 敵対の BLOCK は権限モデル破綻ではなく、文面の穴を閉じてから Plan へ、の意味。

---

## Verdict

**REVISE**

- Critical must-fix: **1**（F1 ∪ C1）
- Important must-fix（重複排除後）: **8**
- 改訂設計のコミット前に Plan へ入らない。

must-fix 反映後の見込み: **FIX_THEN_OK**（§2.3 残差 + Admin `generateLink` オペレータ面 + IP 単位 verify + 送信レイテンシ列挙）。

---

## Adjudication

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 |
| --- | --- | --- | --- | --- | --- |
| **F1** | 1次 | Critical | **CONFIRMED** | Critical | **MF-C1** |
| **C1** | 敵対 | Critical | **CONFIRMED** | Critical | **DUPLICATE of F1** → MF-C1 |
| **F2** | 1次 | Important | **CONFIRMED** | Important | **MF-I2** |
| **F3** | 1次 | Important | **CONFIRMED** | Important | **MF-I3** |
| **F4** | 1次 | Important | **CONFIRMED** | Important | **MF-I1** |
| **I1** | 敵対 | Important | **CONFIRMED** | Important | **DUPLICATE of F4** → MF-I1 |
| **F5** | 1次 | Important | **CONFIRMED**（≤15 分天井は **DOWNGRADE**） | Important | **MF-I4** |
| **I3** | 敵対 | Important | **CONFIRMED** | Important | **DUPLICATE of F5** → MF-I4 |
| **F6** | 1次 | Important | **CONFIRMED** | Important | **MF-I5** |
| **I5** | 敵対 | Important | **CONFIRMED**（`loginAsNewUser` を inbox 必須にする是正は **DOWNGRADE**） | Important | **DUPLICATE of F6** → MF-I5 |
| **I2** | 敵対 | Important | **CONFIRMED** | Important | **MF-I6** |
| **I4** | 敵対 | Important | **CONFIRMED** | Important | **MF-I7** |
| **I6** | 敵対 | Important | **CONFIRMED** | Important | **MF-I8** |
| F7 | 1次 | Minor | **CONFIRMED** | Minor | residual（must-fix 外） |
| F8 | 1次 | Minor | **CONFIRMED** | Minor | residual（§4.3 で deposited は残る。待機文の「メールのリンク」掃除は任意） |
| F9 | 1次 | Minor | **DUPLICATE of I4** | — | MF-I7 |
| F10 | 1次 | Minor | **CONFIRMED** | Minor | residual（`SHOW_EMAIL_LOGIN` は live で既に `true`） |
| M1 | 敵対 | Minor | **DUPLICATE of F3** | — | MF-I3（snapshot から `returnTo` を外す） |
| M2 | 敵対 | Minor | **DUPLICATE of I4** | — | MF-I7 |
| M3 | 敵対 | Minor | **CONFIRMED** | Minor | residual |
| M4 | 敵対 | Minor | **CONFIRMED** | Minor | residual（§6 の exact が既に正本） |

**FALSE_POSITIVE:** Critical / Important 本体には無し。棄却するのは是正の行き過ぎだけ（F5 の必須 15 分、I5 の fixture 全 inbox 化）。

---

## Live 根拠（二次が読んだ箇所）

### F1 / C1 — leftover × 同一タブ OTP

`login-page.tsx` L242–250: leftover-capable は `authError` 付き leave、または search が空 / `?`。L415–419: leftover-capable なら `authenticated` でも `<Navigate>` しない。L405–410 → `auth-gateway.ts` L639–648 → L581–626: sibling completion が無く `discardedExchangeSessionKey === null` なら **無条件 local signOut**。`hasSiblingAuthContinuationCompletion`（L546–556）は continuation 印だけを見る。

番号経路は §4.1 で `AuthFlow` / `ContinuationApi` を作らず completion を書かない。現行マジック成功は `/auth/callback` で `publishAuthContinuationCompletion` する（`auth-callback-page.tsx` L154–156, L318–320）。

主 CTA は query 無し `/login`（`free-landing-page.tsx` L71–76）。`route-error-element.tsx` L32 も `to="/login"`。callback 失敗は `/login?authError=…`（`auth-callback-page.tsx` L41–50）。`RequireSession` の `?returnTo=`（`protected-routes.tsx` L18–19）だけは leftover-capable でない。

Vitest がこの規則を固定している: `login-page.test.tsx` L530–575（query 無しは Navigate しない）、L648–685（sibling 無し leftover は local signOut）。

仕様 §3.3 は「session が付いたら `returnTo`」と「leftover 規則は変えない」を同時ロックしている。実装どおりに従うと主経路は成功後も画面に残り、再マウントで今立てた session を消す。§2.3 残差ではない（現行マジックは leftover `/login` 上で session を立てない）。

### F2 — sibling dismiss

現行 `sendMagicLink` は `createAuthFlow(..., "token_hash")`（`auth-gateway.ts` L956–965）。Google 開始成功後に `dismissSiblingOauthAuthorizationFlows`（L435–459, L928 / L942）。`confirmMagicLink` は dismiss 済みなら `verifyOtp` しない（L1230–1236）。番号送信が Flow を作らないと、この交差が消える。§8.5 を守ったまま閉じるには Continuation 新設は不要（snapshot 破棄 + 既存 Google flow の dismiss / `clearSiblingUnexpiredAuthFlows`）。

### F3 — returnTo

live login の既定は `/welcome`（`login-page.tsx` L281–283、`sanitizeLoginReturnPath` fallback L385–391）。§3.3 の `/planner` は `sanitizeReturnPath` の別関数既定。§4.1 は snapshot に `returnTo` を載せ、§4.4 は「メールと時刻だけ」。`verifyEmailOtp` 入力に `returnTo` が無い。宛先 snapshot の TTL は 60s（L55–60）で、番号寿命より短い。

### F4 / I1 — テンプレが本体

公式: OTP とマジックリンクは同じ `signInWithOtp`。差は本文の `{{ .Token }}` 対 `{{ .ConfirmationURL }}`。`emailRedirectTo` 省略は ConfirmationURL を消さない（SITE_URL に落ちるだけ）。

live: repo にメール HTML 無し。`infra/supabase.override.yaml` L64–77 と compose L162–180 に `GOTRUE_MAILER_TEMPLATES_*` 無し。`ENABLE_EMAIL_AUTOCONFIRM=false`。`supabase/config.toml` L19–22 `enable_confirmations = true`。新規は confirmation、既存は magic_link。本番正本は token_hash URL 必須（`docs/deployment/supabase.md` L87–117）。`detectSessionInUrl: false`（`supabase.ts` L14）。残った `/auth/v1/verify` は番号を焼いて session は立たない。

### F5 / I3 — 寿命

compose に `GOTRUE_MAILER_OTP_EXP` / `OTP_LENGTH` / `RATE_LIMIT_VERIFY` 無し。`CONFIG.md` L243–244 / L655: 寿命既定 **86400s**、桁 6、verify 30/時。hosted 公式は再送 60s・寿命 **1 時間**・86400s 超は非推奨。メール単位の失敗ロックは無い。画面再送は local 60（`.env.example`）、`.deploy.env` は 300。

§2.3 が受け入れているのは「6 桁が狭い」「残り回数を出さない」であり、**24h の 6 桁を正にすることではない**。Plan が「仮置きしない」を守って live 既定を写すと 86400s になる。必須天井を 15 分にまで落とす独立根拠は無い（hosted 既定は 3600s）。二次は **86400 を正にしない / 同一値 / ≤3600** を must-fix とし、15 分は推奨に落とす。

### F6 / I5 — E2E 二系統

`loginAsNewUser`（`e2e/fixtures/auth.ts` L211–335）は Admin `generateLink` type `magiclink` → `action_link` を開き hash を storage へ載せる。Mailpit 非経由。製品 UI を踏まない。live schema（L25–29）は `action_link` / `hashed_token` / `verification_type` のみ。repo に `email_otp` フィールドは無い。

製品回帰は `requestMagicLinkAndReadUrl`（L341–384）が Mailpit から **URL** を拾う。`auth.setup.ts` L22–25 と `auth-recovery.spec.ts` L4–45 がそれを `page.goto` する。recovery 前半 2 本はメール callback leftover（同一ブラウザ / 孤立 WebView deposit）。L47–68 の Google cancel / expired CTA は残す対象。

I5 の「`loginAsNewUser` を UI + inbox 6 桁にせよ」は suite 全体を Mailpit 待ちにする。二次は **action_link を製品ログインの定義にしない**ことだけを must-fix とし、bootstrap の hash 注入残置を許す（本文で「製品外」と選ぶ）。

### I2 — `confirmMagicLink` / pending は「呼ばない」だけでは閉じない

`completeCallback` は `token_hash` を見ると **先に** `writePendingAuthDeposit` し、`needs_confirmation` を返す（`auth-gateway.ts` L1008–1044）。callback は CTA から `confirmMagicLink` → `verifyOtp({ token_hash, type: "email" })`（`auth-callback-page.tsx` L182–205, L481–526、gateway L1834–1837）。`resumeFlow` も claimed 平文を `token_hash` として verify する（L1568–1573）。

仕様は戻りを `unbound_callback` にし、login / callback から呼ばないと書く。戻りだけ変えて pending 書込を残すと residual / resume が hash を消費する。受け入れ: 古い `?token_hash=` で `verifyOtp` も deposit も走らない。型にメソッドが残るのは可。Admin `generateLink` オペレータ面は残差。

### I4 / F9 — in-flight と写像

callback 側は `confirmInFlightRef`（`auth-callback-page.tsx` L103–104, L185–186）。login の `send` に相当ガードは無い（`login-page.tsx` L360–380）。`isExpired` は `otp_expired` / `otp_disabled` / `token_expired`（gateway L497–499）。GoTrue は不正トークンも期限切れも `otp_expired`（「Token has expired or is invalid」）に畳む。仕様の三分割コピーは実装不能になり得る。確認中の再送 / メール変更 / StrictMode 二重 verify は未規定。

### I6 — 入力

6 マスは未実装。仕様は 6 桁貼付とルート `one-time-code` まで。対象ユーザーは日本語 IME。全角 `１２３４５６` を半角に正規化しなければ 6 桁そろわず verify しない。composition 中の verify、マスごとの名前付け、320px / 44px は本文に無い。6 桁空間の狭さ自体は §2.3 残差。

---

## Must-fix set（仕様著者が本文へ書くこと）

### MF-C1 — 同一タブ OTP 成功は leftover 例外（F1 ∪ C1）

§3.3 の「leftover 規則は変えない」を上書きする。leftover の対象は **マウント時点で既にあった persist / inbound `authError` leave** に限定する。このタブの `verifyEmailOtp` 成功は leftover-capable（query 無し `/login` および `authError` 付き `/login`）でも **即 `returnTo` へ `Navigate` し、その session を leftover 掃除しない**。Continuation をメール用に新設しない。Vitest: leftover-capable `/login?authError=unbound_callback` で verify 成功 → Navigate。再マウントしても session が残る。

### MF-I1 — メールから URL を消す本体はテンプレ両通（F4 ∪ I1）

`emailRedirectTo` 省略は必要だが十分条件ではない、と §5 / §8.2 に書く。変更対象は **Magic Link と Confirm sign up の両方**（Invite / Recovery は触らないと明示）。本文は `{{ .Token }}` を大きく、`{{ .ConfirmationURL }}` / `{{ .TokenHash }}` / `{{ .RedirectTo }}` / 生 `http` / `https` を置かない。ローカルは repo 内 HTML + compose の `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` / `..._CONFIRMATION`（および subject）。本番は Dashboard の両テンプレを同じ制約で差し替え、`docs/deployment/supabase.md` §2.2 の token_hash 必須を置き換える。`GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` を false にするか、残すなら「URL 無しテンプレが唯一の防御」と書く。受け入れ: Mailpit / 本番テスト便に 6 桁があり `http` / `https` が無い。

### MF-I2 — Google × 番号の sibling（F2）

§4.1 / §4.3 に交差を固定する。`signInWithGoogle` 成功開始時: 番号待ち snapshot と 6 マス state を捨て、以降その番号では `verifyEmailOtp` しない。`verifyEmailOtp` 成功直前: 既存の unexpired Google `AuthFlow` を現行 sibling と同型で dismiss / clear する（`ContinuationApi.create` はしない）。ピンは Google 専用のまま。番号成功は AuthProvider の通常 first-session pin に載せる。

### MF-I3 — 成功 leave の既定と snapshot（F3 ∪ M1）

成功 leave の既定は live と同じ **`/welcome`**（`sanitizeLoginReturnPath` の fallback）。`/planner` は `sanitizeReturnPath` の別関数既定であり login には使わない、と一文。`returnTo` の正本は **login ページが持つ sanitize 済み URL query**（無ければ `/welcome`）。gateway の snapshot は宛先メールと `resendAvailableAt` だけ（番号も `returnTo` も入れない）。§4.1 と §4.4 をこの一文に揃える。`verifyEmailOtp` は `returnTo` を返さなくてよい。返すなら引数で受け、60s snapshot に依存しない。

### MF-I4 — OTP 寿命を 86400s にしない（F5 ∪ I3）

§5 の「同じ値」「仮置きしない」は維持する。ただし Plan が live ローカル既定を写すことを禁じ、**寿命はローカルと本番で同一、かつ ≤ 3600s（hosted 既定）。86400s を正にしない**。桁は 6。`GOTRUE_RATE_LIMIT_VERIFY` と送信床（`SMTP_MAX_FREQUENCY` / `RATE_LIMIT_OTP`）も同一値に揃え、画面再送（`VITE_MAGIC_LINK_RESEND_SECONDS`）より緩めない。1 通あたりの失敗上限が GoTrue に無い事実を §2.3 残差に書き、IP レート + 短い寿命で閉じると明記する。残り回数は出さない。15 分天井は推奨であって必須にしない。

### MF-I5 — E2E を製品経路と bootstrap に分ける（F6 ∪ I5）

§7 を分割する。(1) 製品 E2E（`auth.setup` / メール成功回帰）: UI 送信 → Mailpit 本文の **6 桁** → 6 マス。URL を `goto` しない。`requestMagicLinkAndReadUrl` は番号読みに置換するか削除し、URL 正規表現を残さない。(2) `loginAsNewUser` / `authenticatedPage`: Admin `generateLink` の **action_link をブラウザで踏むことだけ禁止**。session を載せるなら既存の hash 注入を「製品外 bootstrap」として残す、と本文で選ぶ（live schema に `email_otp` は無いので、未検証フィールドを正にしない）。(3) `auth-recovery` の同一ブラウザ / 孤立 WebView **メール**ケースは削除。Google cancel / leftover / oauth-mock は残し、ボタン名を `番号をメールで受け取る` / `番号を再送` に合わせる。fixture 全本を inbox 必須にはしない。

### MF-I6 — `token_hash` は pending も verify も走らせない（I2）

§4.2 / §4.3 を次で閉じる。`completeCallback` が `token_hash` を見たら **pending を書かず**、`needs_confirmation` を返さず、`verifyOtp` も deposit もせず、`unbound_callback`。`AuthCallbackPage` から confirm CTA と `confirmMagicLink` 呼び出しを削除する（型にメソッドが残るのは可）。受け入れ: 古い `?token_hash=` を開いても `verifyOtp` も deposit も走らない。

### MF-I7 — 単一 in-flight と GoTrue 写像（I4 ∪ F9 ∪ M2）

send / verify / resend / メール変更を単一 in-flight にする。確認中はマス無効化だけでなく再送も変更も押せない。stale 応答は捨てる。§4.1 / §6 を GoTrue の実際の `error.code` に合わせる。区別できないなら **一つのコピー**にする（無理に mismatch / expired を三分割しない）。少なくとも `otp_expired` / `token_expired` は同一扱い、`otp_disabled` / `over_request_rate_limit` は `unavailable`、未知は unavailable（fail-closed、サーバ文は出さない）。

### MF-I8 — 6 マスの正規化と a11y（I6）

§3.2 に一文: 入力は半角数字に正規化（NFKC）。6 連続数字以外の貼付は先頭の 6 桁だけ。composition 中は verify しない。`one-time-code` は単一のルート（hidden または結合 input）。各マスは `aria-label`（例: 「確認番号の1けた目」）。`fieldset` + 見出し。44px と横スクロール禁止は既存不変条件のまま。6 桁空間の狭さは §2.3 残差。

---

## 非 must-fix（確認済み）

- **§2.3 残差:** Google standalone / メールアプリ往復 / 共有端末 60s 宛先 / 6 桁の空間そのもの / IP 単位 verify。仕様が悪化させたのは snapshot に `returnTo` を足す点だけで、MF-I3 で閉じる。
- **Auth ロック 4 export:** 再定義していない。C1 の直し方が Continuation 再利用だとここで落ちる。MF-C1 / MF-I2 は Continuation 新設を禁じる。
- **F7:** 番号送信は Flow を作らないので消す行は無い。文言整理のみ。
- **F8:** §4.2 が消すのは `needs_confirmation`。`deposited` / `awaiting_completion` は §4.3 で残る。待機文から「メールのリンク」を落とすなら exact を置けば足りる。
- **F10:** `SHOW_EMAIL_LOGIN` は live で `true`。廃止一文は有用だが主経路は隠れない。
- **M3 / M4:** 旧マジック期限切れコピーと送信失敗コピーの差分。§6 exact が正本。Plan で一本化すれば足りる。
- **Admin `generateLink` オペレータ面:** 製品 UI から消してもサービスロールがあれば URL を出せる。残差。
- **新 Important+:** 無し。

---

## Final

Verdict: **REVISE**

Must-fix: **F1/C1, F2, F3, F4/I1, F5/I3, F6/I5, I2, I4, I6**

Rejected / not must-fix: **F5 の必須 15 分天井, I5 の fixture 全 inbox 化, F7, F8, F9（I4 に吸収）, F10, M1（F3 に吸収）, M2（I4 に吸収）, M3, M4, §2.3 残差**

Review path: `docs/superpowers/reviews/2026-08-16-email-otp-login-secondary.md`
