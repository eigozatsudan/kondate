# 敵対的レビュー: メール 6 桁番号ログイン Implementation Plan

- **役割:** 独立 adversarial reviewer（実装・設計改訂の著者ではない。コンテキスト非共有）
- **日付:** 2026-08-16
- **対象 plan:** [`docs/superpowers/plans/2026-08-16-email-otp-login.md`](../plans/2026-08-16-email-otp-login.md)
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)（MF-C1 / MF-I1…I8 反映済み）
- **照合 spec reviews:** [`2026-08-16-email-otp-login-{primary,adversarial,secondary}.md`](./2026-08-16-email-otp-login-adversarial.md)
- **照合 live tree:**
  `src/features/auth/login-page.tsx` / `login-page.test.tsx` /
  `src/features/auth/auth-gateway.ts` / `auth-flow.ts` /
  `src/features/auth/auth-callback-page.tsx` / `auth-callback-page.test.tsx` /
  `src/features/auth/auth-continuation-completion.ts` /
  `src/features/auth/magic-link-state.ts` / `src/main.tsx` /
  `e2e/fixtures/auth.ts` / `e2e/specs/auth.setup.ts` /
  `infra/supabase.override.yaml` / `infra/supabase/docker-compose.yml` /
  `infra/supabase/CONFIG.md` / `compose.yaml` / `compose.e2e.yaml`
- **攻撃焦点（指示）:** leftover signOut が OTP 成功後も走る / `clearSibling` が完了 id 無しで空振りまたは誤消 / テンプレが local GoTrue に載らない / `loginAsNewUser` が `action_link` を `goto` する / `confirmMagicLink` が `resumeFlow` から届く / StrictMode 二重 verify / 既定 leave が `/planner` / `emailRedirectTo` 再入場 / OTP exp が 86400 のまま / Mailpit パーサが URL を受理
- **姿勢:** 実装者は plan を文字どおり守り、趣味は悪い。snippet に無い防御は書かない。テストが弱い箇所は最短の GREEN を取る。
- **編集:** なし（本ファイルのみ成果物。spec / plan 不変）

---

## Summary

番号送信・確認を `AuthGateway` に足し、成功 leave を `sanitizeLoginReturnPath`（既定 `/welcome`）にし、`emailRedirectTo` を `sendEmailOtp` から外し、callback の confirm CTA を消す、という骨格は spec と噛み合う。Auth ロック 4 export を再定義せず、メール用 `ContinuationApi` を新設しない、も守れている。

一方、**plan 本文を文字どおり実装すると主経路のログインが壊れる**箇所が残る。

1. **leftover signOut が OTP 成功 session を殺す（MF-C1 未閉鎖）。** Task 3 の防御は `emailOtpCompletedRef`。live の leftover effect はマウントで即 `void clearLeftover…()` し、`discardedExchangeSessionKey === null` かつ sibling completion 無しなら **無条件 local signOut** する。ref は再マウントで消え、in-flight leftover は cancel されない。query 無し `/login` は leftover-capable（主経路）。
2. **テンプレが GoTrue に載らない（MF-I1 未閉鎖）。** Task 4 は HTML と YAML キーだけ。auth に volume も HTTP 配信も無い。GREEN はファイル文字列検査。GoTrue は既定本文（`ConfirmationURL`）のまま送る。
3. **製品 E2E の番号読みが URL 付き本文を通す。** パーサ RED は「番号 123456」と「`https://example` だけ」。両方ある既定メールは 6 桁を抜いて GREEN し、テンプレ未載を隠す。
4. **`loginAsNewUser` は `action_link` を踏むしか session を取れない。** generateLink 応答に access_token は無い。plan は `page.goto` を禁じ、代替 API を書かない。
5. **`resumeFlow` の `token_hash` `verifyOtp` と strip-reload の `needs_confirmation` 再構成が Task 対象外。** callback CTA を消しても leftover pending / residual recovery が hash を消費する。
6. **StrictMode 二重 verify がテストに無い。** 本番 `src/main.tsx` は `<StrictMode>`。login の RED は非 Strict。6 桁 effect は二回 verify し、二通目 `otp_expired` → mismatch で成功を消す。

`/planner` を製品成功 leave の既定にする文は **無い**（Task 3 は `/welcome`）。`sendEmailOtp` への `emailRedirectTo` 再入場は Task 2 RED が正面から禁じる。OTP exp の YAML キー自体は override の既存 `auth.environment` に足せば届く。壊れるのはテンプレ配信と「動いている GoTrue の値」を見ない点である。

**総合判定: `BLOCK_WITH_CONDITIONS`**

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`BLOCK_WITH_CONDITIONS`** |
| **Critical** | **2**（C1 leftover / C2 テンプレ未載） |
| **Important** | **6** |
| **Minor（参考）** | 3 |
| **解除後** | 下記 must-fix を plan 本文（Task 2/3/4/5 の実装段落・RED・受け入れ）へ固定すれば **PASS_WITH_RESIDUALS**（§2.3: Google standalone / メールアプリ往復 / 共有端末 60s / 6 桁空間 / Admin `generateLink` オペレータ面 / IP 単位 verify） |

---

## Attack table

| # | 攻撃シナリオ | 判定 | 根拠（plan × spec × live） |
| --- | --- | --- | --- |
| A1 | leftover signOut が OTP 成功のあと（または同時に）今の session を消す | **成立（Critical）** | spec §3.3 / MF-C1: マウント時点の persist だけ掃除。plan Task 3 は `emailOtpCompletedRef` + 「ref が true なら leftover を走らせない」。live `login-page.tsx` L405–410 は leftover-capable なら **マウントで即** `clearLeftoverLoginSessionIfNoSiblingCompletion`。L639–648 → L581–626: sibling completion 無し + 指紋 null なら無条件 `signOut({ scope: "local" })`。番号は Continuation を書かない。query 無し `/login` は L242–249 で leftover-capable。ref は再マウントで false。既存 C-R4（`login-page.test.tsx` L648–695）は sibling 無し leftover の signOut を固定。 |
| A2 | `clearSiblingUnexpiredAuthFlows` を完了 id 無しで呼び、何も消えない / 誤って残す | **成立（Important）** | live `auth-flow.ts` L861–870 は `completedFlowId` 必須。一致 id だけ残す。plan は「ダミーを作らず」と `clearSiblingUnexpiredAuthFlows` を同じ文で呼び、続けて `listUnexpired + clearAuthFlow` と言う。完了 id が無いときに呼び出しを skip すると Google flow が残る。`listUnexpiredAuthFlows` は dismiss 済みを列挙しない（L544）。 |
| A3 | ローカル GoTrue が既定テンプレのまま URL を送る | **成立（Critical）** | spec §5 / MF-I1: テンプレ両通が URL 削除の本体。plan Task 4 は `infra/supabase/templates` + override の **キー存在**。live `infra/supabase.override.yaml` L64–77 に `GOTRUE_MAILER_TEMPLATES_*` 無し。`docker-compose.yml` auth（L115–180）に templates volume 無し。`GOTRUE_MAILER_TEMPLATES_*` は **URL**（`CONFIG.md` L285–291）。`host.docker.internal:…` はプレースホルダ。mailpit / kong は HTML を配信しない。GREEN は `node --test` のファイル検査。Mailpit 本文は見ない。 |
| A4 | `loginAsNewUser` が禁止のあと `page.goto(action_link)` を残す | **成立** | spec §7 / MF-I5: ブラウザで action_link を踏まない。plan Task 5 は `page.goto(browserUrl)` をやめ「generateLink 応答をページ外で解決」。live schema（`e2e/fixtures/auth.ts` L25–29）は `action_link` / `hashed_token` / `verification_type` のみ。session トークンは L246–256 の `page.goto` → hash。代替の `request.post(verify)` / hashed_token 交換が無い。趣味の悪い実装者は現行 `goto` を残す。 |
| A5 | `resumeFlow` が leftover `token_hash` を `verifyOtp` する | **成立** | spec §4.4 / MF-I6: pending / verifyOtp / deposit なし。plan Task 2 は `completeCallback` の `token_hash !== null` だけ unbound。live `resumeFlow` L1568–1573 は claimed 平文を `verifyOtp({ token_hash })`。L1091–1109 は strip 後に pending から `needs_confirmation` を再構成。Task 3 は CTA 削除だけ。residual recovery は `resumeFlow` を呼ぶ。 |
| A6 | StrictMode で `verifyEmailOtp` が二度走り、成功のあと mismatch になる | **成立** | spec §3.2 / MF-I7: 単一 in-flight。本番 `src/main.tsx` L30 は `<StrictMode>`。callback は `confirmInFlightRef` + Strict テスト（`auth-callback-page.test.tsx` L679–716）。plan Task 3 RED は「一度だけ」だが login テストは Strict 無し（`login-page.test.tsx` L33–42）。`useState` in-flight は remount で戻る。GoTrue は二通目を `otp_expired` に畳む。 |
| A7 | 製品成功 leave の既定が `/planner` | **反証（製品経路）** | spec §3.3 / MF-I3。plan Task 3 は `sanitizeLoginReturnPath` 既定 `/welcome`。RED も query 無し `/welcome`。`/planner` は Task 5 bootstrap と live `sanitizeReturnPath` の別関数既定。 |
| A8 | `sendEmailOtp` に `emailRedirectTo` が戻る | **正面は反証 / 残差あり** | Task 2 snippet と RED 1 が `options` に `emailRedirectTo` 無しを固定。live `sendMagicLink` L967–971 はまだ付ける。login が `sendMagicLink` を呼び続けたら URL は残る（A3 と同根）。省略だけでは ConfirmationURL は消えない。 |
| A9 | OTP exp が 86400 のまま（override 未配線） | **部分成立** | spec §5 / MF-I4。plan は override に `GOTRUE_MAILER_OTP_EXP: "3600"`。`compose.yaml` L4–6 は override を include。同じ `auth.environment` の SMTP は今日届いている。Task 4 GREEN は YAML 文字列だけ。動いている GoTrue / Mailpit を見ない。`GOTRUE_RATE_LIMIT_VERIFY` / `RATE_LIMIT_OTP` は plan に無い。`compose.e2e.yaml` L25 の送信床 `1s` は画面再送より緩い。 |
| A10 | Mailpit パーサが URL 付き本文から 6 桁を抜いて通す | **成立** | spec §7: URL を `goto` しない。本文に `http` / `https` 無し。plan Task 5 は `"番号 123456 です"` → `"123456"`、`https://example` **だけ**は throw。両方ある既定 HTML（`ConfirmationURL` + Token）は受理。テンプレ未載（A3）を隠す。 |

---

## Findings

### Critical

#### C1. leftover 例外が ref だけなので、成功 session が `/login` 上で死ぬ

- **信頼度:** 93
- **箇所:** plan Task 3 Step 3「`emailOtpCompletedRef` … leftover を走らせない」/ RED 4「再マウントで session が残る」
  spec §3.3 / §8.7 / MF-C1
  live `login-page.tsx` L242–250, L405–410, L415–419 / `auth-gateway.ts` L577–651 / `login-page.test.tsx` L530–575, L648–695
- **説明:**
  1. leftover-capable（空 search または `authError`）のマウントで leftover effect が **即**走る。OTP 成功より前。`void` なので cancel 点が無い。
  2. `clearLeftoverLoginSessionIfNoSiblingCompletion` は `loserFlowId: ""` + 指紋 null。番号経路は completion を書かない。sibling 無しなら **今の persist を local signOut** する。
  3. 成功後に ref を立てて Navigate しても、(a) 既に in-flight の leftover は止まない、(b) 再マウントで ref は false、(c) leftover-capable URL のまま再マウントすると effect が再実行される。
  4. spec の「再マウントしても session が残る」は leftover-capable `/login` での再マウントを含む。plan の RED は「再マウント」の URL を固定しない。実装者は `/welcome` 着地後の再マウントだけ書いて GREEN にできる。
  5. 既存 C-R4 は sibling 無し leftover-capable の signOut を固定している。plan は C-R4 を「マウント時点 persist だけ」に書き換える文が無い。趣味の悪い実装者は C-R4 を残し、ref 分岐だけ足す。
- **なぜ §2.3 残差ではないか:** 現行マジックは leftover `/login` の上で session を立てない。plan が完了点を `/login` に移しながら掃除を ref に閉じたので、**plan が MF-C1 を再発明して失敗している**。
- **修正要求（BLOCK 解除必須）:**
  1. leftover 掃除対象を **マウント時点の persist 指紋**（または inbound `authError` leave の事前 persist）に限定する。今 verify した session と一致したら触らない。
  2. leftover effect を `emailOtpCompletedRef` に依存させない（再マウントで死ぬ）。in-flight leftover は成功後に適用しない。
  3. leftover-capable でも `complete` のあと即 `Navigate replace`（query の `authError` を落とす）。
  4. RED を exact に: (i) `/login` と `/login?authError=unbound_callback` で verify → Navigate、(ii) **同じ leftover-capable URL** で Login を再マウントしても `signOut` されない、(iii) マウント時 leftover persist だけ消え、verify 後 persist は残る。既存 C-R4 をこの契約に合わせて更新すると Files に書く。

#### C2. テンプレが local GoTrue に載らず、メールに URL が残る

- **信頼度:** 95
- **箇所:** plan Task 4 Step 1–3 / Placeholders「既存 mail パターンに合わせる」
  spec §5 / §8.2 / MF-I1
  live `infra/supabase.override.yaml` L64–77 / `infra/supabase/docker-compose.yml` L115–180 / `CONFIG.md` L243–244, L285–291 / `compose.yaml` L4–6
- **説明:**
  - URL 削除の本体は Magic Link **と** Confirm の本文から `ConfirmationURL` / `TokenHash` / `RedirectTo` / 生 `http`/`https` を除くこと。`emailRedirectTo` 省略は十分条件ではない（plan Global もそう書く）。
  - `GOTRUE_MAILER_TEMPLATES_*` は GoTrue が **HTTP で取る URL**。auth コンテナに repo は bind されていない。`file://` や repo 相対は届かない。
  - plan の `http://host.docker.internal:…` はホストもポートも未決。mailpit は SMTP（1025/8025）、kong は API。どちらも `otp-code.html` を返さない。新規ホスト禁止なので、実装者は壊れた URL か file を書いて YAML テストを GREEN にする。
  - フェッチ失敗時 GoTrue は **既定テンプレ**（`{{ .ConfirmationURL }}`）に落ちる。新規は Confirm、既存は Magic Link。両方に URL が残る。
  - Task 4 / 6 は Mailpit 本文を見ない。Task 5 パーサは URL 付き本文を通す（I6）。受け入れ「Mailpit に 6 桁があり `http`/`https` が無い」がどの Task の必須コマンドにも無い。
- **修正要求（BLOCK 解除必須）:**
  1. auth から読める **確定パス**を plan に書く。推奨: override で templates を bind し、GoTrue が取れる URL を **具体値**で固定する（プレースホルダ禁止）。Linux の `host.docker.internal` 未定義を前提にする。
  2. 件名は `GOTRUE_MAILER_SUBJECTS_*`（plan にある）とファイルの両方を同じ文字列にする。
  3. Task 4 または 5 の受け入れに「Mailpit の Magic **と** Confirm 本文に `{{ .Token }}` 相当の 6 桁があり、`http`/`https` / `ConfirmationURL` / `TokenHash` が無い」を必須化する。YAML キー存在だけでは GREEN にしない。
  4. `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` を false にするか、残すなら「URL 無しテンプレが唯一の防御」を Task 4 本文に書く（spec §5）。

---

### Important

#### I1. sibling clear が完了 id 無しで空振りし、Google leftover が残る

- **信頼度:** 86
- **箇所:** plan Task 3 Step 3 sibling 段落; spec §4.3 / MF-I2
  live `auth-flow.ts` L861–870 / `auth-continuation-completion.ts` L169–172 / `auth-gateway.ts` L442–458
- **説明:** `clearSiblingUnexpiredAuthFlows(completedFlowId)` は「完了 id **以外**」を消す。番号成功には完了 id が無い。呼び出しを skip するか、存在する Google flow id を completed として渡すと **その Google が残る**。`listUnexpired` は dismiss 済みを返さないので、`list + clear` だけだと dismiss 済み secret が TTL まで残る。現行 Google 開始は `markAuthFlowUserDismissed`（L457）。plan は dismiss と clear のどちらを「同型」とするか決めていない。
- **修正要求:** login 側ヘルパを exact に: 未期限切れ Google / `authorization_code`（および残存 `token_hash`）を **すべて** `markAuthFlowUserDismissed` + `clearAuthFlow`。ダミー id 禁止。`ContinuationApi.create` 禁止。RED: Google flow が storage にある状態で番号 `complete` → その flow が無い。

#### I2. `loginAsNewUser` が `page.goto(action_link)` を残す

- **信頼度:** 90
- **箇所:** plan Task 5 Step 1; spec §7 / MF-I5; live `e2e/fixtures/auth.ts` L211–335
- **説明:** generateLink は session を返さない。plan は `page.goto` を禁じ、Playwright `request` または hash 注入と書くが、**hashed_token をページ外で session にする手順が無い**。実装者は現行 L247 を残す。`auth.setup.ts` L22–25 は今日 `requestMagicLinkAndReadUrl` + `page.goto(magicLink)`。Task 5 は setup を 6 マスに替えるが、`loginAsNewUser` の置換 API が空。
- **修正要求:** bootstrap を 1 本に固定する。例: Playwright `request` で `hashed_token` を `verify` し、返った token を storage へ載せる。`page.goto` する URL に `action_link` / `/auth/v1/verify` / `token_hash` を含めない。コメント「製品外 bootstrap」。Files に `normalizeGenerateLinkActionUrl` の扱い（残すならテスト専用・製品ログイン定義にしない）を書く。

#### I3. `confirmMagicLink` / `resumeFlow` が leftover `token_hash` をまだ消費する

- **信頼度:** 88
- **箇所:** plan Task 2 Step 3「`token_hash !== null` 分岐」/ Task 3 callback; spec §4.4 / MF-I6
  live `auth-gateway.ts` L1008–1044, L1091–1109, L1218–1294, L1374–1378, L1568–1573
- **説明:** 第一分岐だけ unbound にしても、(1) strip-reload が pending から `needs_confirmation` を返す、(2) 旧 pending + `credentialKind: "token_hash"` の residual が `resumeFlow` → `verifyOtp({ token_hash })`、(3) `confirmMagicLink` 本体が残る。CTA 削除は (3) の UI だけ。受け入れ「古い `?token_hash=` で verify も deposit も走らない」は `resumeFlow` を固定しないと偽。
- **修正要求:** Task 2 に次を必須化。`token_hash` クエリ **および** pending 再構成で `writePendingAuthDeposit` / `verifyOtp` / deposit / `needs_confirmation` をしない。`resumeFlow` は `awaitingConfirm` または `credentialKind: "token_hash"` の claim を verify しない。RED: token_hash URL と leftover pending の両方で `verifyOtp` 非呼び出し。

#### I4. StrictMode 二重 verify が RED に無い

- **信頼度:** 87
- **箇所:** plan Task 3 RED 3 / 実装「`value.length === 6` かつ未 in-flight」
  spec §3.2 / MF-I7; live `src/main.tsx` L30; `auth-callback-page.tsx` L100–104, L182–186
- **説明:** 本番は StrictMode。`useEffect([otp])` + `useState` in-flight は setup→cleanup→setup で二回 verify する。GoTrue は二通目を `otp_expired` にし、plan の写像は mismatch → マス空。session は立ったあと leftover に殺され得る（C1）。callback は同じクラスのバグを Strict テストで閉じている。login RED は非 Strict。
- **修正要求:** login RED を `<StrictMode>` で「`verifyEmailOtp` は 1 回」。実装は callback と同型の **同期 ref**（state 更新前に立てる）。stale 応答破棄。IME composition 中は verify しない（Task 1 と親の両方）。

#### I5. OTP 寿命・送信床が YAML 検査だけで、レートが未固定

- **信頼度:** 82
- **箇所:** plan Global / Task 4; spec §5 / MF-I4
  live `CONFIG.md` L243–244, L650, L655; `compose.e2e.yaml` L21–26
- **説明:** `GOTRUE_MAILER_OTP_EXP` を override の既存 `auth.environment` に足すこと自体は配線として正しい。しかし GREEN はキー文字列。再作成していない auth は 86400 のまま。`GOTRUE_RATE_LIMIT_VERIFY` と `RATE_LIMIT_OTP` は plan に無い。e2e の `GOTRUE_SMTP_MAX_FREQUENCY: "1s"` は画面再送（`VITE_MAGIC_LINK_RESEND_SECONDS`）より緩い。spec はローカルと本番を同一にし、画面床より緩めないと書く。
- **修正要求:** Task 4 に `GOTRUE_RATE_LIMIT_VERIFY` / `RATE_LIMIT_OTP` / `SMTP_MAX_FREQUENCY` の **具体値**（画面再送以上、ローカル=本番）。受け入れは「動いている auth の env または Mailpit 再送間隔」まで落とすか、少なくとも e2e overlay が 3600 / 同一床を上書きしないことを書く。

#### I6. Mailpit パーサが URL 付き本文を受理する

- **信頼度:** 91
- **箇所:** plan Task 5 Step 2; spec §7 製品 E2E / メール文面
- **説明:** `"番号 123456 です"` は製品テンプレ（`アプリの画面に、この 6 つの数字を` + `{{ .Token }}`）と違う。`https://example` **だけ** throw は、既定 HTML（リンク + 6 桁）を通す。URL 正規表現を「残さない」と書きつつ、桁抽出が URL 中の数字列を拾える。A3 と合成すると、製品 E2E は URL 付きメールから桁を抜いて「番号ログイン成功」になる。
- **修正要求:** 純関数 RED を次に固定。(1) 製品テンプレ相当（`{{ .Token }}` を 6 桁に置換、`http`/`https` 無し）→ ちょうど 6 桁、(2) `http` または `https` が 1 つでもあれば throw、(3) 7 桁以上の連続数字や URL クエリだけなら throw。`requestMagicLinkAndReadUrl` の URL 正規表現を削除。

---

### Minor（参考）

#### M1. 製品成功 leave の `/planner` は bootstrap / ヘルパに残る

- **信頼度:** 74
- Task 5 の `loginAsNewUser` は `/planner` を開く（製品外として可）。`requestMagicLinkAndReadUrl` live L343 は `returnTo=%2Fplanner`。置換ヘルパがこれを写すと setup の着地が `/planner` になる。製品既定は Task 3 で `/welcome`。混乱するだけなら残差。ヘルパの `returnTo` を query 無しにして setup が `/welcome` を期待する、と書けば足りる。

#### M2. `sendMagicLink` が `emailRedirectTo` を持ち続け、login が呼び得る

- **信頼度:** 76
- Task 2 は型に残してよい。Task 3 が `sendEmailOtp` に切り替えなければ A8 が成立する。RED に「login は `sendMagicLink` を呼ばない」を足すと閉じる。

#### M3. `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED` が Task 4 に無い

- **信頼度:** 80
- spec §5 は切れるなら false、残すならテンプレが唯一の防御。plan は触れない。C2 の修正 4 に含める。

---

## Refuted attacks

| 攻撃 | 結論 |
| --- | --- |
| 製品成功 leave の既定を `/planner` にする（A7） | Task 3 は `sanitizeLoginReturnPath` + `/welcome`。`/planner` は bootstrap と `sanitizeReturnPath`。 |
| `sendEmailOtp` の snippet に `emailRedirectTo` を書く（A8 正面） | Task 2 snippet / RED 1 が禁じる。残差は `sendMagicLink` 呼び出し漏れ（M2）とテンプレ（C2）。 |
| Auth ロック 4 export の再定義 | Global + Task 2–3。ダミー `AuthFlow` を作るなと書いてある。 |
| 番号を sessionStorage に書く | Task 3 snapshot は `email` / `resendAvailableAt` / `storedAt`。 |
| メール用 `ContinuationApi.create` | 明示禁止。 |

---

## BLOCK 解除チェックリスト（plan 改訂必須）

- [ ] **C1:** leftover はマウント時点指紋だけ。in-flight leftover は OTP session を消さない。leftover-capable URL での再マウント RED。C-R4 を更新。
- [ ] **C2:** テンプレの auth からの読み方を具体値で固定。Mailpit 本文（Magic + Confirm、`http`/`https` 無し）を受け入れに入れる。
- [ ] **I1:** 完了 id 無しで全 unexpired Google / 残存 `token_hash` を dismiss+clear するヘルパと RED。
- [ ] **I2:** `loginAsNewUser` のページ外 session 確立を API まで書く。`page.goto(action_link)` 禁止を残す。
- [ ] **I3:** `completeCallback` の pending 再構成と `resumeFlow` の `token_hash` verify を閉じる RED。
- [ ] **I4:** login を StrictMode で一度だけ verify。同期 ref。
- [ ] **I5:** exp / verify / OTP / SMTP 床の具体値。e2e overlay が 86400 や緩い床に戻さない。
- [ ] **I6:** パーサは `http`/`https` が 1 つでもあれば throw。製品テンプレ相当を fixture にする。

すべて反映後は **PASS_WITH_RESIDUALS**（§2.3）。

---

## Spec ↔ plan カバレッジ（敵対視点）

| Spec / MF | plan | 敵対評価 |
| --- | --- | --- |
| MF-C1 leftover 例外・再マウント | Task 3 ref + Navigate | **ref は再マウントと in-flight に負ける（C1）** |
| MF-I1 テンプレ両通 | Task 4 ファイル + YAML キー | **GoTrue に載る経路が無い（C2）** |
| MF-I2 sibling | Task 3「ダミーなし + list/clear」 | 完了 id API と矛盾（I1） |
| MF-I3 既定 `/welcome` | Task 3 `sanitizeLoginReturnPath` | 充足。bootstrap `/planner` は残差（M1） |
| MF-I4 3600s・レート同一 | Task 4 `OTP_EXP=3600` | exp キーは足りる。レート未記載・実行時未確認（I5） |
| MF-I5 製品 6 桁 / bootstrap 非 goto | Task 5 | パーサが URL を通す（I6）。goto 代替が空（I2） |
| MF-I6 `token_hash` 無処理 | Task 2 第一分岐のみ | strip-reload / `resumeFlow` が開いている（I3） |
| MF-I7 単一 in-flight・写像 | Task 2 写像 + Task 3 in-flight | 写像は充足。StrictMode が無い（I4） |
| MF-I8 入力正規化 | Task 1 NFKC | 方向充足。親の composition は Task 1 に寄る |
| Auth ロック非再定義 | Global | 充足 |
