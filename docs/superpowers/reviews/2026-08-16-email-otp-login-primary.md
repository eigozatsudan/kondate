# 1次レビュー: メール 6 桁 OTP ログイン設計

**対象:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)
**照合先（実装が正）:**
`src/features/auth/login-page.tsx` / `login-page.test.tsx` /
`src/features/auth/auth-gateway.ts` / `auth-flow.ts` /
`src/features/auth/auth-callback-page.tsx` / `auth-callback-url-capture.ts` /
`src/features/auth/auth-cleanup.ts` / `magic-link-state.ts` /
`src/features/auth/auth-provider.tsx` /
`src/shared/config/public-env.ts` / `src/shared/lib/supabase.ts` /
`src/features/landing/free-landing-page.tsx` /
`e2e/fixtures/auth.ts` / `e2e/specs/auth.setup.ts` /
`e2e/specs/auth-recovery.spec.ts` / `e2e/specs/oauth-mock.spec.ts` /
`docs/deployment/supabase.md` / `supabase/config.toml` /
`infra/supabase/CONFIG.md` / `infra/supabase.override.yaml` / `infra/supabase/docker-compose.yml`
**レビュー種別:** 設計一次レビュー（内部一貫性・実装可能性・Auth ロック衝突・leftover/sibling/pin・列挙・6 桁総当たり・PII/ログ・CSP・E2E）
**レビュー日:** 2026-08-16
**編集:** なし（read-only。本ファイルのみ成果物）

---

## Summary

方向は live 実装と噛み合う。メール経路を同じタブの 6 桁に閉じ、マジックリンクの `token_hash` 確認 UI とメール URL を捨て、Google は `signInWithGoogle` → `/auth/callback` → PKCE / `authorization_code` のまま残す、は目的 2.1 とロック 4 export（`AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient`）を壊さない。`credentialKind: "token_hash"` をスキーマに残して新規作成しない、`sendMagicLink` / `confirmMagicLink` を型に残して本番経路から外す、CSP 非緩和、番号を storage / ログに書かない、未登録でも送信成功に見せる、も現行の所有境界・列挙方針と衝突しない。

`needs_confirmation` UI の削除自体は Google を壊さない。当該 UI は `completeCallback` が `token_hash` を見たときだけ出る（`auth-gateway.ts` L1008–1044、`auth-callback-page.tsx` L481–526）。Google は `code` + PKCE で `complete` / `deposited` / `awaiting_completion` に落ちる。§4.2 が消すのは確認 UI だけで、§4.3 の deposited / leftover / sibling / pin は残す、と読める限り Google 本線は生きる。

一方、このまま Plan に落とすと **メインターゲットの `/login` で番号成功しても Navigate せず、再表示で session を leftover として落とす**、**Google 開始と番号 verify の sibling dismiss が消える**、**`emailRedirectTo` 省略だけではメールからリンクが消えない**、**寿命を live 既定 86400s に揃えると 6 桁が長い間当たる**、**E2E の `generateLink` と inbox 6 桁の境界が割れる**。§2.3 残差は欠陥に数えない。Critical 1 と Important が複数 open のため **REVISE**。

## Verdict

**REVISE**

- Critical: 1
- Important: 5
- Minor: 4

人間承認・implementation plan 前に、F1–F6 を設計本文へ閉じること。

---

## Findings

### Critical

#### F1 — Severity: Critical

- **id:** F1
- **Location:** 設計 §3.3 / §4.1 / §8.5; 現行 `login-page.tsx` L242–250（`isLeftoverCapableLoginLeave`）/ L395–420（認証成功 Navigate と leftover 掃除）/ L412–420; `login-page.test.tsx` L530–575（query 無し `/login` は authenticated でも Navigate しない）/ L648–685（query 無し `/login` は sibling 無し leftover を local signOut）; `free-landing-page.tsx` L60–75（CTA は `to="/login"` のみ。`returnTo` 無し）
- **Description:** §3.3 は「session が付いたら `returnTo`。Navigate の leftover 規則は変えない」と同時にロックする。live の leftover 規則は次の両方である。
  1. `authError` 付き leave **および query 無し `/login`** は leftover-capable。`authenticated` でも `<Navigate>` しない（C-R2 / C-R3）。
  2. leftover-capable マウントでは sibling completion が無い session persist を local signOut する（C-R4）。
  現行マジックは session を `/auth/callback` で作り、そこから `returnTo` へ leave する。`/login` 上では session を作らないので、この規則と矛盾しない。番号経路は **同じ `/login` ドキュメントで `verifyEmailOtp` して session を書く**。無料 LP の主 CTA は query 無し `/login` なので、設計どおり leftover を変えないと:
  - 6 桁成功後も Navigate しない（§3.3 前半と衝突）。
  - 成功後に `/login` を再表示（戻る・再読込・PWA 再起動）すると、今作った session が leftover persist として C-R4 に食われる。
- **Why it matters:** 主経路（LP → `/login` → 番号）が「番号を写すだけで進める」を満たさない。成功直後は画面に留まり、再表示でログアウトする。実装者が leftover を黙って緩めると Google leftover pin（C2 / C-R2）が再発する。仕様が両方をロックしているので、Plan がどちらを正にするか分裂する。
- **Suggestion:** §3.3 を次で上書きする（アプリではなく仕様を直す）。
  1. leftover 規則の対象は **マウント時点で既にあった persist / inbound `authError` leave** に限定する。
  2. このタブの `verifyEmailOtp` 成功は leftover-capable でも **即 `Navigate` し、その session を leftover 掃除しない**。
  3. query 無し `/login` の restart leftover 掃除は、OTP 成功後の再表示には適用しない（成功済み session は live pin 扱い）。
  4. `authError` 付き `/login` で番号成功した場合も同じ例外（Google キャンセル後に番号で入れる）。
- **Status:** open

---

### Important

#### F2 — Severity: Important

- **id:** F2
- **Location:** 設計 §4.1（`sendEmailOtp` は `AuthFlow` / `ContinuationApi` を作らない）/ §4.3 / §8.5; 現行 `auth-gateway.ts` L435–459（`dismissSiblingOauthAuthorizationFlows`）/ L898–899 / L956–965（マジックは `createAuthFlow(..., "token_hash")`）/ L1230–1236（dismiss 済み token_hash は `verifyOtp` しない）; `auth-flow.ts` L861–870（`clearSiblingUnexpiredAuthFlows`）
- **Description:** 現行はメール開始で `AuthFlow`（`credentialKind: "token_hash"`）を作り、後勝ち Google 開始が sibling を dismiss する。これにより Google 成功後のマジック `verifyOtp` が勝者 session を上書きし、loser signOut で両方失う窓を閉じている（C5）。番号経路が Flow を作らないと、Google 開始は番号待ちを dismiss できない。`verifyEmailOtp` も sibling Google flow を見ない。§4.3「leftover / sibling / pin の Google 向け規則は維持」と §8.5「Google 以外で `ContinuationApi` を新規利用しない」は、交差点を書いていない。
- **Why it matters:** 番号待ちのまま「Googleで続ける」→ キャンセルで `/login` に戻る、または他タブで Google が完了したあと 6 桁を入れる、で dual session / pin mismatch / 勝者上書きが再発する。Continuation を使わずに閉じることはできる（snapshot 破棄 + 既存 Google flow の `markAuthFlowUserDismissed` / `clearSiblingUnexpiredAuthFlows`）。仕様が「触らない」だけだと実装者が交差を無視する。
- **Suggestion:** §4.1 / §4.3 に交差を固定する。
  1. `signInWithGoogle` 成功開始時: 番号待ち snapshot と 6 マス state を捨て、以降その番号では `verifyEmailOtp` しない。
  2. `verifyEmailOtp` 成功直前: 既存の unexpired Google `AuthFlow` を現行 sibling と同型で dismiss / clear する（`ContinuationApi.create` はしない）。
  3. ピンは Google 専用のまま。番号成功は AuthProvider の通常 first-session pin に載せる。
- **Status:** open

#### F3 — Severity: Important

- **id:** F3
- **Location:** 設計 §3.3（成功時 既定 `/planner`）/ §4.1（snapshot に `email` / `returnTo` / `resendAvailableAt`。`sanitizeLoginReturnPath`）/ §4.4（「値はメールと時刻だけ」）; 現行 `login-page.tsx` L49–60 / L281–283（query 無しは `/welcome`。residual TTL 60s は continuation 5 分より短い）/ `auth-flow.ts` L385–391（`sanitizeLoginReturnPath` の fallback は `/welcome`）/ `login-page.tsx` L366（gateway に渡す `returnTo` はページ側で既に sanitize 済み）
- **Description:** 三つが割れている。
  1. live の login happy path 既定は `/welcome`。§3.3 は `/planner`。初回 LP 利用者は RootEntry / Welcome を飛ばす。
  2. §4.1 の snapshot は `returnTo` を持つ。§4.4 は「メールと時刻だけ」。実装者がどちらかを落とす。
  3. `verifyEmailOtp` の入力は `{ email, token }` だけ。`returnTo` の正本が 60s snapshot だと、番号寿命（§5 で後固定。live 既定は 86400s）より先に snapshot が死に、成功 leave が既定へ落ちる。ページは URL の `returnTo` を既に持っている。gateway が snapshot だけを見る必要は無い。
- **Why it matters:** 成功着地が実装者依存になる。`/planner` にすると onboarding 案内を飛ばす。60s 後の verify が `/planner` に落ちると、明示 `returnTo=/pantry` が消える。F1 の leftover 例外と組み合わせないと、query 無し `/login` は永遠に leave できない。
- **Suggestion:**
  1. 成功 leave の既定は live と同じ **`/welcome`**（`sanitizeLoginReturnPath` の fallback）。`/planner` は `sanitizeReturnPath` の別関数既定であり、login には使わない、と一文。
  2. `returnTo` の正本は **login ページが持つ sanitize 済み URL query**（無ければ `/welcome`）。gateway の snapshot は宛先メールと `resendAvailableAt` だけ（番号は入れない）。§4.1 と §4.4 をこの一文に揃える。
  3. `verifyEmailOtp` は `returnTo` を返さなくてよい。返すなら引数で受け、60s snapshot に依存しない。
- **Status:** open

#### F4 — Severity: Important

- **id:** F4
- **Location:** 設計 §5 / §8.2（`emailRedirectTo` を付けない）/ §7（メールに `http` / `https` 無し）/ §9（「メールテンプレ」）; 現行 repo にメール HTML は無い; `docs/deployment/supabase.md` L87–117（本番 Magic Link は `{{ .RedirectTo }}&token_hash={{ .TokenHash }}`。`{{ .Token }}` 無し）; `infra/supabase.override.yaml` L64–77（テンプレ URL 無し）; `supabase/config.toml` L19–22（`enable_confirmations = true`）; `.env` / `infra/supabase/.env.example`（`ENABLE_EMAIL_AUTOCONFIRM=false`）; `src/shared/lib/supabase.ts` L14（`detectSessionInUrl: false`）
- **Description:** GoTrue の `/otp` は `emailRedirectTo` が無くても **ConfirmationURL を SITE_URL 付きで組み立てる**。既定テンプレはリンクであり 6 桁を出さない。本番正本テンプレもリンクのみで `{{ .Token }}` が無い。`emailRedirectTo` 省略は `/auth/callback?flow=&state=` を付けない防御にはなるが、メールから URL を消さない。ユーザーが残った `/auth/v1/verify` を踏むと OTP は GET 消費され、アプリは hash session を読まない（`detectSessionInUrl: false`）。6 マスに入れる番号は死ぬ。新規ユーザーは confirmation テンプレ、既存は magic_link テンプレ、になり得る（autoconfirm オフ）。
- **Why it matters:** 「リンクを踏ませない」「inbox から 6 桁を読む」はテンプレ置換が本体。仕様が「テンプレを変える」としか書いておらず、repo に編集対象が無い。実装者がクライアントだけ直すと、ローカル既定メールは URL のみ、本番ダッシュボードは token_hash リンクのまま、番号ログインは届かない。
- **Suggestion:** §5 / §9 に固定する。
  1. `emailRedirectTo` 省略は必要だが **十分条件ではない**。
  2. 変更対象は **Magic Link と Confirmation の両方**。件名は同じ系統、本文は `{{ .Token }}` を大きく、`{{ .ConfirmationURL }}` / `{{ .RedirectTo }}` / `token_hash` / `http` / `https` を置かない。
  3. ローカルは repo 内 HTML + `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` / `..._CONFIRMATION`（および subject）を compose override で指す。本番は Dashboard の両テンプレを同じ制約で差し替える。`docs/deployment/supabase.md` §2.2 を本仕様の一部として改訂する、と書く。
  4. 受け入れ: Mailpit / 本番テスト便の本文に 6 桁があり、`http` / `https` が無い。
- **Status:** open

#### F5 — Severity: Important

- **id:** F5
- **Location:** 設計 §2.3（試行は GoTrue。残り回数は出さない）/ §5（寿命・試行はローカルと本番で同じ。秒数の仮置きはしない。Plan で `infra/supabase` を読んで固定）; 現行 `infra/supabase/docker-compose.yml` は `GOTRUE_MAILER_OTP_EXP` / `GOTRUE_MAILER_OTP_LENGTH` / `GOTRUE_RATE_LIMIT_VERIFY` 未設定; `infra/supabase/CONFIG.md` L243–244 / L655（OTP 寿命既定 **86400s**、桁既定 6、`RATE_LIMIT_VERIFY` 既定 30/時）
- **Description:** §5 は「同じ値」だけをロックし、数値を Plan に先送りする。live ローカルを読むと寿命は **24 時間**になる。6 桁空間は 10^6。verify は IP あたり概ね 30/時なので単一 IP では足りないが、寿命 24h × 分散 IP ではオンライン総当たりが現実的になる。画面は不一致でマスを空にするだけなので、自動化の摩擦は小さい。GoTrue の「試行上限」は送信レートと verify の IP レートが主で、**1 通あたりの失敗回数ロックは仕様が前提にしているほど明確ではない**。
- **Why it matters:** Plan が「仮置きしない」を守って live 既定を写すと、6 桁を 24h 有効にする。列挙は画面では閉じても、当たった番号は session になる。セキュリティ上の上限が仕様に無い。
- **Suggestion:** 秒数の仮置きは避けてよいが、**上限だけは仕様でロック**する。
  1. 寿命は live 既定 86400s を採用しない。Plan が読む値は「ローカルと本番で同一、かつ **≤ 15 分**」。
  2. `GOTRUE_RATE_LIMIT_VERIFY`（および送信 `SMTP_MAX_FREQUENCY` / `RATE_LIMIT_OTP`）も同一値に揃え、画面再送（`VITE_MAGIC_LINK_RESEND_SECONDS`）より緩めない（§5 後段と同じ）。
  3. 1 通あたりの失敗上限が GoTrue に無いなら、その事実を §2.3 残差に書き、IP レート + 短い寿命で閉じると明記する。アプリ側で残り回数を出さない方針はそのまま。
- **Status:** open

#### F6 — Severity: Important

- **id:** F6
- **Location:** 設計 §7（E2E は `generateLink` で踏む経路をやめる。inbox から 6 桁。Google / leftover 復旧は残す）; 現行 `e2e/fixtures/auth.ts` L71–76 / L211–335（`loginAsNewUser` は Admin `generateLink` type `magiclink` → `/verify` hash を storage へ載せる。Mailpit 非経由。大多数の ephemeral 認証）/ L341–384（`requestMagicLinkAndReadUrl` は UI 送信 + Mailpit から **URL** を読む）; `e2e/specs/auth.setup.ts` L22–25; `e2e/specs/auth-recovery.spec.ts` L4–45（同一ブラウザ callback / 孤立 WebView deposit。メール leftover そのもの）/ L47–68（期限切れ CTA はマジック再送文言）; `e2e/specs/oauth-mock.spec.ts` L70
- **Description:** 「`generateLink` で踏む経路をやめる」は二系統を混ぜている。
  1. **製品経路:** `requestMagicLinkAndReadUrl` + `page.goto(magicLink)`（setup / auth-recovery）。inbox 6 桁 + 6 マスへ置き換えるのが本仕様の対象。
  2. **fixture ブートストラップ:** `loginAsNewUser` は製品ログインを通らない。suite 速度のための Admin 経路。これを inbox 必須にすると full suite が Mailpit 待ちになる。
  「Google / leftover 復旧は残す」も、auth-recovery 前半 2 本は **メール callback leftover** である。番号化後は製品経路が存在しない。残すのは Google / oauth-mock / callback-security の leftover。メール WebView deposit テストは削除対象。
- **Why it matters:** 実装者が §7 を文字どおり読むと `loginAsNewUser` を消し、E2E 全体が遅くなるか赤になる。残すと読んで fixture の `generateLink`+click を残すと、レビューが「踏む経路が残った」と見る。auth-recovery を「残す」と書いてあると、存在しないメール callback を直し続ける。
- **Suggestion:** §7 を分割する。
  1. 製品 E2E（`auth.setup` / メール成功回帰）: UI 送信 → Mailpit 本文の **6 桁** → 6 マス。URL を `goto` しない。
  2. `loginAsNewUser` / `authenticatedPage`: Admin `generateLink` の **action_link をブラウザで踏むことだけ禁止**。session を載せるなら `generateLink` 応答の `email_otp` を `verifyOtp` するか、既存の hash 注入を「製品外 bootstrap」として残す、のどちらかを本文で選ぶ。
  3. `auth-recovery` の同一ブラウザ / 孤立 WebView **メール**ケースは削除。Google cancel / leftover / oauth-mock は残し、ボタン名を `番号をメールで受け取る` / `番号を再送` に合わせる。
- **Status:** open

---

### Minor

#### F7 — Severity: Minor

- **id:** F7
- **Location:** 設計 §4.1「失敗は `clear` して日本語送信エラーへ」
- **Description:** 現行 `sendMagicLink` の `clear` は今作った `AuthFlow` 行である（`auth-gateway.ts` L974–976）。番号送信は Flow を作らないので、消す対象が無い。実装者が「何か残っているはず」と `clearAuthFlow` や continuation を触り始める。
- **Suggestion:** 「失敗時は AuthFlow / continuation を作らない（だから消す行も無い）。画面は送信エラーへ戻す」と書く。
- **Status:** open

#### F8 — Severity: Minor

- **id:** F8
- **Location:** 設計 §4.2 / `auth-callback-page.tsx` L570–577
- **Description:** `needs_confirmation` 削除は Google を壊さない（F 前文）。残る待機コピーは「Google やメールのリンクから戻ってきたあと」のまま。実装者が確認 UI と一緒に deposited 分岐まで消すと、Google WebView 引き継ぎが死ぬ。
- **Suggestion:** §4.2 に「消すのは `kind === "needs_confirmation"` の確認 UI だけ。`deposited` / `awaiting_completion` / 待機コピーの Google 文言は残す」と書く。待機文から「メールのリンク」を落とすなら exact 文を置く。
- **Status:** open

#### F9 — Severity: Minor

- **id:** F9
- **Location:** 設計 §6; 現行 `auth-gateway.ts` L497–499（`otp_expired` / `otp_disabled` / `token_expired`）
- **Description:** mismatch / expired / unavailable の写像カテゴリはあるが、GoTrue / supabase-js の `error.code` 表が無い。`otp_disabled` を expired に入れるか unavailable に入れるかで、§6 の「マスを空にする」と「再送できる状態」が割れる。
- **Suggestion:** §6 にコード表を足す。少なくとも `otp_expired` / `token_expired` → expired、不一致（`otp_expired` 以外の invalid）→ mismatch、`over_request_rate_limit` / `otp_disabled` → unavailable。未知は unavailable（fail-closed、サーバ文は出さない）。
- **Status:** open

#### F10 — Severity: Minor

- **id:** F10
- **Location:** 設計 §3.1; 現行 `login-page.tsx` L36（`SHOW_EMAIL_LOGIN`）/ L38–41（`?emailLogin=1`）
- **Description:** 仕様はメールを主・Google を副にするが、旗と復旧クエリに触れない。旗を残すと「主操作」が隠れ得る。消すと `emailLogin=1` を見る E2E / テストが死ぬ。
- **Suggestion:** `SHOW_EMAIL_LOGIN` と `emailLogin=1` を廃止して常時番号主ボタンにする、と一文。テストは query 無し `/login` を正本にする。
- **Status:** open

---

## 非欠陥（確認済み）

- **Auth ロック 4 export / `ownedAuthStoragePrefixes`:** 再定義していない。`AuthGateway` へのメソッド追加は延長。`credentialKind: "token_hash"` は残して新規作成しない、はスキーマ互換として妥当。
- **ユーザ列挙:** `shouldCreateUser: true` + 未登録も送信成功 UI。失敗は汎用送信エラー。存在有無を出さない。§6 と対象外 2.2 で足りる。
- **PII / ログ:** 番号は入力 state のみ。宛先キーを現行 `kondate.auth.lastMagicEmail` / `magicSentUi` に流用すれば `auth-cleanup.ts` の `MAGIC_LINK_RESIDUAL_KEYS`（L45–50）が logout で消す。新キーを足すなら掃除リストへ、と Plan で書けばよい（§4.4 の流用方針で足りる）。
- **CSP:** 追加 origin 無し。既存 Supabase Auth へ `signInWithOtp` / `verifyOtp` するだけ。緩めないでよい。
- **§2.3 残差:** Google の Safari 脱出、メールアプリを開く操作、共有端末の短寿命宛先、残り回数非表示、は欠陥に数えない。
- **`needs_confirmation` 削除 vs Google:** 上記 F8 の deposited 残置を守れば本線は壊れない。
