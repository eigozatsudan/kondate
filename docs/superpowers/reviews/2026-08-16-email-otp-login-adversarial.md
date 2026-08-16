# 敵対的レビュー: メール 6 桁番号ログイン設計

**対象:**
[`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)

**照合ソース（実装・契約を正）:**
- `src/features/auth/auth-gateway.ts` / `auth-callback-page.tsx` / `login-page.tsx` / `auth-flow.ts` / `auth-cleanup.ts` / `magic-link-state.ts`
- `src/shared/lib/supabase.ts`
- `src/pwa/service-worker.ts` / `service-worker-routing.ts`
- `infra/supabase/docker-compose.yml` / `infra/supabase/CONFIG.md` / `infra/supabase/.env.example`
- `docs/deployment/supabase.md`
- `e2e/fixtures/auth.ts` / `e2e/specs/auth.setup.ts` / `e2e/specs/auth-recovery.spec.ts`
- `netlify/functions/_shared/logger.ts`

**敵対姿勢:** ship バイアス。「`emailRedirectTo` を付けない」「callback から `confirmMagicLink` を呼ばない」「leftover 規則は変えない」を信じず、GoTrue 既定テンプレ・GET `/verify`・Admin `generateLink`・同一タブ OTP 成功 × leftover signOut・6 桁オンライン推測・E2E の黙殺経路を突く。§2.3 残差は悪化しない限り受け入れ。仕様と live tree 以外は開かない。編集は本レビューファイルのみ。
**レビュー日:** 2026-08-16

**総合判定: `BLOCK_WITH_CONDITIONS`**

---

## Summary

同じタブで 6 桁を入れる方針自体は、現行マジックリンクの長押しプレビュー消費（`docs/deployment/supabase.md` L91–107、`auth-gateway.ts` L216–217）を捨てる正しい向きである。Auth ロック 4 export を触らず `AuthGateway` に足す、番号を storage に書かない、`detectSessionInUrl: false` を維持する、も現行 tree と噛み合う。

しかし仕様は **「付けないもの」で穴が塞がると誤認**しており、かつ **現行 leftover 規則を同じタブ完了にそのまま載せる**。この 2 点が設計どおり実装すると壊れる。

1. **`emailRedirectTo` 省略は ConfirmationURL を消さない。** 公式も「OTP とマジックリンクの差はメール本文だけ」と書く。ローカル compose はテンプレ未設定、`ENABLE_EMAIL_AUTOCONFIRM=false` のため新規は Confirm sign up・既存は Magic Link の **二通**。仕様 §5 は一通しか指定しない。URL が残れば GET `/verify` が 6 桁を焼き、`confirmMagicLink` / `token_hash` pending / Admin `generateLink` は今もセッションを作れる。
2. **OTP 成功は `/login` 上で起きる。** leftover-capable `/login`（空 query または `authError`）は `Navigate` せず、マウントのたびに sibling completion 無しなら local signOut する。メール OTP は continuation を作らないので completion が無い。callback 失敗後の再試行（まさに番号ログインへ落ちる経路）で成功 → 画面に残る → リロードで **今立てた session を自分で消す**。

6 桁オンライン推測は §2.3 の「GoTrue に任せる」で残差化できるが、ローカル既定寿命は **86400s**、hosted 公式は **1 時間**で、仕様の「同じ値」は未固定。E2E の `loginAsNewUser` はテンプレと無関係に `generateLink` `action_link` で hash 注入するため、fixture を残すと OTP UI を **黙って踏まない**。

Critical 1・Important 6。下記条件を仕様に書いてから Plan。満たせば `PASS_WITH_RESIDUALS`（共有端末の宛先 60s、メールアプリ往復、6 桁の空間、Google standalone、IP 単位の verify 上限）。

---

## Attacks that landed (Critical / Important)

| ID | 攻撃 | 判定 | 要約 |
| --- | --- | --- | --- |
| C1 | leftover Navigate / leftover-clear × 同一タブ OTP 成功 | **成立（Critical）** | §3.3 が leftover 規則を凍結。OTP は callback を通らない。recovery `/login` で成功しても Navigate せず、リロードで session を殺す。 |
| I1 | `emailRedirectTo` 省略で URL がメールから消えるか | **成立** | 消えない。差はテンプレ本文だけ。ローカル既定は ConfirmationURL。Confirm と Magic Link の二通を仕様が拾っていない。 |
| I2 | 旧 `token_hash` / GET `/verify` / `confirmMagicLink` で session | **成立（仕様どおりでも半開）** | UI を外しても gateway・pending・Admin `generateLink`・GET `/verify` は生きる。`completeCallback` が pending を書いてから unbound にすると残渣経路が残る。 |
| I3 | 6 桁オンライン推測 vs 未固定の寿命 / 試行 | **成立（条件）** | 桁 6 は公式どおり。寿命は local 86400s ≠ hosted 1h。verify は IP 単位。§5 が Plan に先送りしたまま実装に入ると「同じ値」が嘘になる。 |
| I4 | 6 桁そろったら即 verify の競合 | **成立** | マス無効化だけでは足りない。二重 submit / 確認中再送 / 確認中メール変更が未規定。GoTrue は不一致と期限切れを同じ `otp_expired` にしがち。 |
| I5 | E2E `generateLink` `action_link` | **成立** | `loginAsNewUser` はテンプレ非依存の黙殺経路。`requestMagicLinkAndReadUrl` は URL 無しテンプレで赤。両方を仕様が同時に閉じ切っていない。 |
| I6 | 貼付 / IME / 6 マス a11y | **部分成立** | 6 桁貼付と `one-time-code` は書いた。全角・IME composition・確認中の排他・320px×44px のラベル付けは無い。 |

---

## Attacks that did not land

| 攻撃 | 判定 | 理由 |
| --- | --- | --- |
| Auth ロック 4 export の再定義 | **反証（意図は正しい）** | §1 / §4.1 / §8.4 は `AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` を触らない。`credentialKind: "token_hash"` は残して新規作成しない。C1 の直し方が Continuation 再利用だとここで落ちる。 |
| `safeLog` / gateway catch がメール・番号を出す | **現状反証** | `auth-gateway.ts` の send/confirm は throw するだけで log しない。`safeLog` は email 欄を型で拒否（`logger.ts` L5, L45）。callback catch は rejection を捨てる（`auth-callback-page.tsx` L221–225）。実装者が `error.message` を足せば壊れる（残差）。 |
| SW が `/login` を壊す / OTP をキャッシュする | **反証** | `/login` は navigate-network-then-shell（`service-worker-routing.ts` L41–42, L50）。`/auth/callback` は passthrough（L16–17, L38–39）。非 GET は触らない。番号は storage に無いので SW の対象外。 |
| 本番 OTP 桁が 6 でない | **概ね反証** | 公式テンプレ変数 `{{ .Token }}` は 6 桁。local `GOTRUE_MAILER_OTP_LENGTH` 未設定 = CONFIG 既定 6。寿命の不一致の方が本物（I3）。 |
| 未登録の画面列挙（コピー差） | **概ね反証** | §6 は送信成功に見せる。`shouldCreateUser: true`。送信失敗は単一文。タイミング差と verify エラー写像は残差。 |
| §2.3 の共有端末宛先 60s / メールアプリ往復 / 6 桁の狭さ | **受け入れ残差** | 仕様が悪化させたのは snapshot に `returnTo` を足す点だけ（I6 近傍の軽微）。番号は入れないので現行より良くはないが、番号漏洩にはならない。 |

---

## Residuals

§2.3 をそのまま残すもの、および条件充足後も残るもの。

- Google は standalone で Safari に出る（本スライス対象外）。
- 番号を見るためにメールアプリへ行く操作は残る。戻る先は同じ `/login`。
- 共有端末に宛先メールが最大 60s（`MAGIC_RESIDUAL_TTL_MS`）残る。XSS は sessionStorage の email / 追加される `returnTo` を読める（現行 CSP + 番号非保存）。
- 6 桁の探索空間は狭い。GoTrue の IP 単位 `/verify` に任せる。分散 IP は残る。
- Admin `generateLink` はサービスロールがあれば常に URL を出せる（製品 UI から消してもオペレータ面）。
- `detectSessionInUrl: false` のため、ConfirmationURL の implicit hash を SPA は自動摂取しない。URL がメールに残ると **消費だけして session は立たない**（ユーザーから見ると「番号が使えない」）。
- オフライン時 `/login` はシェル HTML に落ち、verify はネットワーク必須。
- 送信のレイテンシ差による弱いユーザ列挙。
- `confirmMagicLink` を型に残す XSS 面（同一オリジン XSS があれば `token_hash` 直 verify も同じ）。

---

## Findings with spec section + file:line

### Critical

#### C1. leftover 規則を変えないと、OTP 成功 session が `/login` 上で死ぬ

- **信頼度:** 94
- **仕様:** §3.3「`Navigate` の leftover 規則は変えない」、§4.1「`AuthFlow` / `ContinuationApi` は作らない」「continuation 行には載せない」、§8.5
- **live:**
  - leftover 判定: `login-page.tsx` L242–249（`authError` あり、または search が空/`?`）
  - 成功時 Navigate 抑制: L415–419
  - leftover 掃除: L405–410 → `auth-gateway.ts` L639–648
  - sibling 無しなら **無条件 local signOut**: `auth-gateway.ts` L581–626（`discardedExchangeSessionKey === null` かつ `context` ありで指紋分岐をスキップして signOut）
  - 現行マジック成功は `/auth/callback` で完了し、`publishAuthContinuationCompletion` する（`auth-callback-page.tsx` L154–156, L318–320）。メール OTP はそれをやらない。
  - callback 失敗の leave は `/login?authError=…`（`auth-callback-page.tsx` L41–50, L169–172）。`auth-recovery.spec.ts` L47–68 がまさにこの着地を固定している。
- **攻撃:**
  1. Google / 旧リンク失敗 → `/login?authError=unbound_callback`（または `magic_link_expired`）。leftover-capable。
  2. 番号を受け取り、6 桁で `verifyOtp` 成功。session が persist される。
  3. leftover-capable のため `Navigate` しない。ユーザーは 6 マス画面に残る。
  4. リロード / BFCache / PWA 再前面化で Login が再マウント。effect が再実行。email OTP は completion を書いていない → sibling 無し → **今の session を local signOut**。
  5. 空の `/login`（`route-error-element.tsx` L32 の `to="/login"`）も同じ。`?returnTo=` 付きの保護リダイレクト（`protected-routes.tsx` L18）だけは leftover-capable でないので助かる。
- **なぜ §2.3 残差ではないか:** 現行マジックは leftover `/login` の上で session を立てない。仕様が完了点を `/login` に移したのに掃除規則を凍らせたので、**仕様が新しい失敗を作っている**。
- **BLOCK 解除:**
  1. `verifyEmailOtp` 成功後は leftover-capable でも `returnTo` へ進む（query の `authError` を落としてから）。
  2. leftover-clear は「このタブで今 verify した session」を leftover 扱いしない。Continuation をメール用に新設しない（§8.5）。URL replace か、短寿命の「今確立した」印で足りる。
  3. Vitest: leftover-capable `/login?authError=unbound_callback` で verify 成功 → Navigate。再マウントしても session が残る。

---

### Important

#### I1. `emailRedirectTo` を付けないことでは、メールから URL が消えない

- **信頼度:** 96
- **仕様:** §4.1 / §5 / §8.2「`emailRedirectTo` を番号送信に付けない」、§7 メール文面「`http` / `https` のリンク無し」
- **live / 公式:**
  - 現行は必ず付ける: `auth-gateway.ts` L967–971（`buildAuthCallbackUrl` + `signInWithOtp`）。
  - 公式 Passwordless: OTP と Magic Link の差は **確認メールの本文だけ**。同じ `signInWithOtp`。
  - 公式 Email Templates 既定（Management API 例）: Confirm sign up も Magic link も `<a href="{{ .ConfirmationURL }}">`。`{{ .ConfirmationURL }}` は常に生成され、`redirect_to` が無いとき Site URL に落ちるだけ。
  - ローカル: `GOTRUE_MAILER_TEMPLATES_*` 無し（`infra/supabase/docker-compose.yml` L162–180）。`ENABLE_EMAIL_AUTOCONFIRM=false`（`.env` / `infra/supabase/.env.example` L180 / `scripts/generate-local-secrets.mjs`）。新規は **confirmation**、確認済みは **magic_link**。
  - 本番手順は Magic Link に `token_hash` URL を **必須**と書いてある（`docs/deployment/supabase.md` L87–117）。Confirm テンプレは触っていない。
  - `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` 既定 `true`（`CONFIG.md` L353）。compose 未設定。
  - クライアントは `flowType: "pkce"`（`src/shared/lib/supabase.ts` L14–15）。`emailRedirectTo` を外しても SDK は PKCE challenge を付け、GoTrue は ConfirmationURL を組み立てられる。
- **攻撃:** 実装者が §8.2 だけ守ってテンプレを一通しか直さない。Gmail 先読み / ユーザーがリンクを踏む → GET `/auth/v1/verify` が OTP を消費。SPA は `detectSessionInUrl: false`（`supabase.ts` L14）なので hash session は立たない。ユーザーが 6 桁を入れると期限切れ。仕様が捨てたい「プレビューで死ぬ」が **番号ログインで再発**する。
- **BLOCK 解除:**
  1. §5 に **Magic Link と Confirm sign up の両方**（必要なら Invite / Recovery は触らないと明示）を書く。本文は `{{ .Token }}` のみ。`{{ .ConfirmationURL }}` / `{{ .TokenHash }}` / `{{ .RedirectTo }}` / 生 `http` 禁止。
  2. ローカルは compose または同等のテンプレ注入を Files に入れる。Dashboard 手順は `docs/deployment/supabase.md` §2.2 の token_hash 必須を置き換える。
  3. `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` を false にするか、残すなら「URL 無しテンプレが唯一の防御」と書く。

#### I2. `confirmMagicLink` と `token_hash` は、呼ばないだけでは閉じない

- **信頼度:** 90
- **仕様:** §1「旧リンクは無視」、§4.1「型に残ってもよいがログイン画面と callback から呼ばない」、§4.3「`token_hash` は `unbound_callback`」、§4.2 確認 UI 削除
- **live:**
  - `completeCallback` は `token_hash` を pending に書き `needs_confirmation` を返す（`auth-gateway.ts` L1008–1044）。
  - callback はそれを見て「ログインを完了する」→ `confirmMagicLink`（`auth-callback-page.tsx` L182–205, L323–325, L518）。
  - `confirmMagicLink` は `verifyOtp({ token_hash, type: "email" })`（L1834–1837）。secret 無しなら deposit（L1238–1254）。
  - `resumeFlow` も claimed 平文を `token_hash` として verify する（L1568–1573）。
  - Admin `generateLink({ type: "magiclink" })` の `action_link` は GET `/verify` → hash トークン（`e2e/fixtures/auth.ts` L217–247）。
- **攻撃:**
  1. `completeCallback` の戻りだけ unbound にして、L1026–1035 の `writePendingAuthDeposit` を残す → residual / resume が hash を consume。
  2. callback ページの `confirmMagicLink` ハンドラと `needs_confirmation` 分岐を残す（テストが大量にある）。
  3. 旧メールや Mailpit 既定 URL を踏む。UI 案内は出なくても session は立つ。
- **BLOCK 解除:**
  1. `token_hash` を見たら pending を書かず、`needs_confirmation` を返さず、`unbound_callback`。
  2. `AuthCallbackPage` から confirm CTA と `confirmMagicLink` 呼び出しを削除する（型にメソッドが残るのは可）。
  3. 受け入れ: 古い `?token_hash=` を開いても `verifyOtp` も deposit も走らない。

#### I3. 桁は 6 でも、寿命と verify 上限が local / 本番で揃っていない

- **信頼度:** 91
- **仕様:** §2.3「試行回数は GoTrue に任せ、残り回数は出さない」、§5「ローカルと本番で同じ値。Plan 作成時に読んで固定。仮置きしない」
- **live:**
  - `GOTRUE_MAILER_OTP_LENGTH` / `GOTRUE_MAILER_OTP_EXP` は compose に無い。CONFIG 既定は length 6、exp **86400**（`CONFIG.md` L243–244）。
  - hosted 公式: 再送 60s、寿命 **1 時間**。86,400s 超は非推奨。
  - `/verify` レート: CONFIG 既定 30/h（L655）。hosted ドキュメントは IP あたり 360/h（burst 30）。**メール単位の失敗ロックは無い。**
  - 画面再送は `VITE_MAGIC_LINK_RESEND_SECONDS`（local 60、`.deploy.env` は 300）。
- **攻撃:** 6 桁 = 10^6。寿命 24h・IP 360/h なら 1 IP で一日数千試行。分散すれば実用攻撃。仕様は「同じ値」と言いながら値を書かないので、Plan が local 既定のまま ship し得る。§2.3 は「狭い」ことを受け入れているが、**24h の 6 桁は受け入れ文面より悪い**。
- **BLOCK 解除:**
  1. Plan 本文に length / exp / verify レート / 再送間隔を数字で固定する。local env を hosted に合わせる（推奨: exp は hosted 既定の 3600 以下。86400 を正にしない）。
  2. 画面再送（60）を GoTrue `SMTP_MAX_FREQUENCY` / OTP 再送床より緩くしない（§5 後段は正しい。値を書く）。

#### I4. 自動 verify の競合と、GoTrue が mismatch / expired を区別しない

- **信頼度:** 88
- **仕様:** §3.2「6 桁そろった時点で verify。確認中はマスを無効化」、§4.1 の三写像、§6「不一致はマスを空。期限切れは再送可」
- **live:** callback 側は `confirmInFlightRef` で二重起動を止めている（`auth-callback-page.tsx` L103–104, L185–186）。Login の `send` に相当ガードは無い（`login-page.tsx` L360–380）。`isExpired` は `otp_expired` / `otp_disabled` / `token_expired`（`auth-gateway.ts` L497–499）。GoTrue は不正トークンも期限切れも `otp_expired`（「Token has expired or is invalid」）に畳むことが多い。
- **攻撃 / 破損:**
  1. 6 桁目の input + paste + StrictMode で `verifyEmailOtp` が二重。先着成功・後着 expired → 成功直後に「この番号は使えません」。C1 と重なると leftover-clear まで走る。
  2. 確認中に再送。GoTrue は新 OTP を出し旧を無効化。飛行中の旧 verify が勝つか、成功後に expired 表示。
  3. 確認中に「メールアドレスを変更」。state は idle、飛行中 verify が旧メールで session を立てる。
  4. 写像: 1 桁違いが `expired` 扱いになり、まだ有効な番号を捨てて再送させる（レート消費）。
- **BLOCK 解除:**
  1. send / verify / resend / メール変更を単一 in-flight。確認中は再送も変更も押せない。stale 応答は捨てる。
  2. §4.1 / §6 を GoTrue の実際の error に合わせる。区別できないなら **一つのコピー**にする。`otp_disabled` だけ `unavailable`。無理に三分割しない。

#### I5. E2E は赤になるか、黙って OTP を踏まない

- **信頼度:** 93
- **仕様:** §7「`generateLink` で踏む経路をやめる。inbox から 6 桁を 6 マスへ」
- **live:**
  - 既定ログインは `loginAsNewUser` = Admin `generateLink` + `action_link` + hash を storage へ手載せ（`e2e/fixtures/auth.ts` L72–74, L211–333）。テンプレも Login UI も見ない。
  - 製品回帰は `requestMagicLinkAndReadUrl` が Mailpit から **URL** を拾う（L369–384）。`auth.setup.ts` L22、`auth-recovery.spec.ts` L11–13, L30。
- **攻撃 / 失敗モード:**
  1. `loginAsNewUser` を残す → 大半の E2E はグリーンのまま OTP 画面を一度も踏まない（黙殺）。
  2. テンプレから URL を消す一方、`requestMagicLinkAndReadUrl` を残す → setup / recovery が赤。
  3. recovery の「両タブが callback で揃う」は番号ログインでは成立しない。仕様は「Google / leftover 復旧は残す」とだけ言い、この spec をどう書き換えるか無い。
- **BLOCK 解除:**
  1. `loginAsNewUser` の正を「UI 送信 + inbox の 6 桁 + 6 マス」にするか、Admin で 6 桁相当を読む。`action_link` 着地を製品ログインの定義にしない。
  2. `requestMagicLinkAndReadUrl` を番号読みに置換するか削除。URL 正規表現を残さない。
  3. `auth-recovery` の magic 二タブは、OTP では「元タブの 6 マスで完了、別タブに session を作らない」へ書き換えるか、Google leftover だけ残すと明記。

#### I6. 6 マスは貼付以外の入力と a11y が未規定

- **信頼度:** 82
- **仕様:** §3.2（1 マス 1 桁、Backspace、6 桁貼付、ルートに `autocomplete="one-time-code"`）、§2.3「6 桁は空間が狭い」
- **live:** 6 マスは未実装。現行は単一メール欄（`login-page.tsx`）。
- **攻撃 / 破損:** 日本語 IME 確定で余分な `input`、全角 `１２３４５６`、`123-456` / 空白付き貼付、iOS がルート以外に 1 桁だけ入れる、確認中無効化とオートフィルの競合。320px で 6×44px は隙間ごとには収まるが、ラベル無し 6 input は SR が「編集テキスト」×6 になる。
- **BLOCK 解除（実装前に一文で足りる）:**
  1. 入力は半角数字に正規化（NFKC）。6 連続数字以外の貼付は先頭の 6 桁だけ。composition 中は verify しない。
  2. `one-time-code` は単一のルート（hidden または結合 input）。各マスは `aria-label`（例: 「確認番号の1けた目」）。`fieldset` + 見出し。
  3. 狭いのは §2.3 で残してよい。44px と横スクロール禁止は守る。

---

### Minor（記録のみ。BLOCK 条件にしない）

- **M1.** snapshot に `returnTo` を足す（§4.1）。読取時に `sanitizeLoginReturnPath` しなければ XSS / 共有端末が行き先を改ざんできる。書くときだけでなく読むときも sanitize。
- **M2.** `otp_disabled` を現行 `isExpired` が expired に畳む。I4 の写像とセット。
- **M3.** ユーザ向けに `magic_link_expired` クエリと「このリンクは期限切れ」が残る（`login-page.tsx` L332–334）。§3.1 はマジック用ヒントを置かないと言うが、callback 失敗の既存コピーは残る。残すなら §6 に残すと書く。
- **M4.** 送信失敗コピーが仕様 §6（`メールを送れませんでした。…`）と現行 L378（`送信できませんでした。通信を確認して…`）で違う。Plan で exact を一本化。

---

## BLOCK 解除条件

実装 Plan に入る前に、設計改訂で以下を必須とする:

- [ ] **C1:** 同一タブ OTP 成功は leftover-capable でも `returnTo` へ進む。leftover-clear がこの session を殺さない。Continuation をメール用に新設しない。
- [ ] **I1:** Magic Link **と** Confirm sign up から URL / TokenHash を排除。ローカルテンプレを Files に入れる。本番手順の token_hash 必須を置き換える。
- [ ] **I2:** `token_hash` は pending も confirm UI も走らせない。受け入れテストを書く。
- [ ] **I3:** OTP length / exp / verify レート / 画面再送を数字で固定し、local を hosted に合わせる。86400s を正にしない。
- [ ] **I4:** send/verify/resend/メール変更の単一 in-flight。GoTrue が区別できないならコピーを三分割しない。
- [ ] **I5:** `loginAsNewUser` の `action_link` 黙殺をやめ、inbox 6 桁を正にする。recovery spec の書き換えを書く。
- [ ] **I6:** 正規化・composition・ルート `one-time-code`・マスの名前付けを一文で固定。

充足後の判定は **`PASS_WITH_RESIDUALS`**（§2.3 の Google standalone / メールアプリ往復 / 共有端末 60s / 6 桁の空間、IP 単位 verify、Admin generateLink オペレータ面）。

---

## メタ

- 種別: 設計敵対的レビュー（実装前）
- 総合: **BLOCK_WITH_CONDITIONS** / Critical **1** / Important **6** / Minor **4**
- 編集: 本ファイルのみ（仕様・実装は未変更）
