# 敵対的レビュー（実装）

- **Verdict:** **BLOCK**
- **役割:** 独立 adversarial reviewer（実装著者コンテキスト非共有。本ファイルのみ書込）
- **日付:** 2026-08-16
- **Worktree:** `/home/dev/projects/kondate/.worktrees/email-otp-login`
- **HEAD:** `9ee91b21`
- **Range:** `2fe87765..9ee91b21`
- **Diff 正本:** `.superpowers/sdd/review-impl-2fe87765..9ee91b21.diff`
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)
- **照合 plan:** [`docs/superpowers/plans/2026-08-16-email-otp-login.md`](../plans/2026-08-16-email-otp-login.md)
- **姿勢:** 敵対ユーザー / 共有端末 / 古いマジックメール / remount / StrictMode / leftover `/login` / Mailpit・テンプレ失敗を前提に、leftover・`token_hash`・storage・テンプレを先に壊す。§2.3 残差は must-fix にしない。

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`BLOCK`** |
| **Critical** | **1**（C1 leftover in-flight signOut） |
| **Important** | **0** |
| **Minor** | **2**（参考。BLOCK 解除条件ではない） |
| **解除条件** | C1。leftover 掃除をマウント時点の persist 指紋に閉じ、in-flight leftover が番号成功 session を `_removeSession` / local `signOut` しないこと。leftover-capable `/login` と `/login?authError=unbound_callback` で verify → Navigate した **同じマウント**でも session が残る RED を足す（今の remount-after-complete だけでは不足） |

sessionStorage 印は再マウント leftover は閉じた。印より前に走った leftover `signOut` は cancel も指紋再検査もしない。query 無し `/login` は leftover-capable のままなので、主経路で番号成功した session を掃除が後から殺せる。

---

## Attack table

| id | 攻撃 | 結果 | 根拠 |
| --- | --- | --- | --- |
| 1 | leftover-capable `/login`（空 search / `?authError=unbound_callback`）で verify complete したあと、その session を leftover が signOut する | **FAIL** | 印・Navigate 順・再マウントは閉じた。**同じマウントの in-flight leftover は開いたまま**（C1） |
| 2 | callback の `token_hash` が pending / `needs_confirmation` / `verifyOtp` / deposit する | **HOLD** | URL の `token_hash` は即 unbound。pending 再構成は残るが page が unbound leave。製品 UI は `confirmMagicLink` を呼ばない |
| 3 | `sendEmailOtp` が `emailRedirectTo` を付ける / テンプレに ConfirmationURL / TokenHash / http(s) | **HOLD** | `sendEmailOtp` は `shouldCreateUser` のみ。両 TEMPLATES は同一 HTML。本文に禁止断片無し |
| 4 | 6 桁が localStorage / sessionStorage / console / leftover residual に残る | **HOLD** | 入力 state のみ。snapshot / 印 / last email に番号無し。touched ファイルに `console.*` 無し |
| 5 | snapshot または completed 印が returnTo / 番号を持つ | **HOLD** | waiting は email / resend / storedAt。印は `{ storedAt }` のみ |
| 6 | ダミー completed id / `clearSiblingUnexpiredAuthFlows("")` / OTP 成功で `ContinuationApi.create` | **HOLD** | login ヘルパが unexpired flow を個別 dismiss+clear。空文字全消し無し。`sendEmailOtp` は Flow を作らない |
| 7 | StrictMode / 6 桁連続入力で `verifyEmailOtp` が二重 | **HOLD** | 同期 `verifyInFlightRef`。Strict テストが 1 回を固定 |
| 8 | IME composition 中に verify | **HOLD** | マスが composition 中 `onChange` しない。親は 6 桁以外 verify しない |
| 9 | 非 6 桁が `verifyOtp` に届く | **HOLD** | 親 `length !== 6` return。gateway は normalize 前後とも 6 以外 mismatch・サーバ未送信 |
| 10 | ユーザー向けが OTP/PWA/英語コードを漏らす / 未登録と登録を列挙 | **HOLD** | copy は日本語固定。送信失敗は一文言。`shouldCreateUser: true`。ヒント定数は描画されない |
| 11 | 触ったブラウザファイルが `@shared/safety` を import / CSP 緩和 | **HOLD** | auth / e2e 差分に `@shared/safety` 無し。CSP ファイルは本 range 未変更 |
| 12 | AuthFlow / ContinuationApi / AuthProvider / BrowserSupabaseClient 再定義 | **HOLD** | 4 export の定義ファイルは本 range に無い |
| 13 | login 成功既定が `/planner` | **HOLD** | query 無しは `/welcome`。`/planner` は `sanitizeReturnPath` 側の無効値 fallback（M1） |
| 14 | E2E `loginAsNewUser` が `action_link` を `goto` | **HOLD** | ページ外 `verifyOtp({ token_hash })` + storage 注入。`action_link` を `goto` / `request.get` しない |
| 15 | 「ログインを完了する」がまだ届く | **HOLD** | callback は `needs_confirmation` でも unbound leave。CTA テストが非表示を固定 |

---

## Findings

### Critical

#### C1. leftover-capable `/login` の in-flight `signOut` が、今立てた番号 session を殺す

- **Confidence:** 92
- **Where:** `src/features/auth/login-page.tsx` L324–332, L391–392, L509–518, L571–578, L583–588
  `src/features/auth/auth-gateway.ts` L597–647, L655–668
  `src/features/auth/login-page.test.tsx` L207–237, L684–693
  spec §3.3 / §8.7 / MF-C1
  plan Task 3「マウント時点 persist だけ」「in-flight leftover は成功後に適用しない」
- **Attack 1 内訳:**
  - ref-only 印: **閉じた**（`kondate.auth.emailOtpCompleted` を sessionStorage。L86, L215–222）
  - TTL / キー不一致: **閉じた**（60s、`MAGIC_LINK_RESIDUAL_KEYS` に同一キー）
  - 印を Navigate より後に書く: **閉じた**（L512 のあと L517。`status === "complete"` で Navigate）
  - 成功後の **再**マウント: **閉じた**（印が新しければ effect が early return。RED L225–235）
  - **同じマウントの leftover が後から signOut:** **開いた**
- **説明:**
  1. query 無し `/login` と `authError` leave は leftover-capable（L324–332）。これが製品の主着地。
  2. 印が無いマウントで effect が即 `void clearLeftoverLoginSessionIfNoSiblingCompletion()`（L571–578）。cleanup / abort 無し。StrictMode はこれを二本立てる。
  3. leftover 掃除は `discardedExchangeSessionKey === null` + `loserFlowId: ""`。sibling continuation が無ければ **今の persist を同期 wipe し、続けて local `signOut`**（gateway L608–642, L655–664）。番号成功は continuation を書かないので、この例外に乗らない。
  4. supabase-js の `signOut` は `getSession` →（token があれば）logout API → **最後に `_removeSession`**。`withTimeout(..., 2_000)` は元 Promise を cancel しない（gateway コメント L57, L640）。logout が 2s を超えてから settle すると、その時点の session を消す。
  5. leftover persist がある inbound（C-R2 / C-R4 が想定する leftover-capable 本体）では、AuthProvider が leftover session をメモリに持ったままフォームを出す。ユーザーが番号待ち snapshot から 6 桁を貼ると、`verifyEmailOtp` が **同じ client** に新 session を書く。遅延 `_removeSession` はそれを消す。
  6. 印は leftover 開始**後**にしか立たない。印が立って effect が再実行されても、先に投げた `void` は止まらない。`status === "complete"` の Navigate は成功描画だけで、in-flight 掃除を無効化しない。
  7. 既存 RED は verify 完了 → unmount → **印がある状態で** remount する（test L223–235）。in-flight leftover を残したまま verify するケースを見ていない。`leftoverSignOut` は即 resolve。製品 E2E の `requestEmailOtpAndReadCode` は `/login?returnTo=%2Fplanner` なので leftover-capable ですらない。
- **なぜ §2.3 残差ではないか:** 旧マジックは leftover `/login` の上で session を立てない。本スライスが完了点を leftover-capable `/login` に移した。spec は「今このタブで立てた番号 session は leftover 掃除しない」と明示している。
- **修正:**
  1. leftover effect 開始時に persist / in-memory session の指紋を取る。適用直前に指紋が変わっていたら触らない。
  2. 番号 `complete`（印 write）で in-flight leftover を捨てる。generation / aborted フラグ。`withTimeout` 後の late `signOut` も適用しない。
  3. RED: leftover persist を置いた leftover-capable `/login` で、`signOut` を遅延 resolve したまま 6 桁 verify → Navigate。**そのあと** `signOut` が settle しても persist / session が残る。今の remount-after-complete は残す。

### Important

なし。

### Minor（参考。BLOCK 解除条件ではない）

#### M1. 無効 `returnTo` の login 成功先が `sanitizeReturnPath` 経由で `/planner`

- **Confidence:** 78（80 未満。攻撃 13 の「既定」自体は HOLD）
- **Where:** `login-page.tsx` L363–365; `auth-flow.ts` L325–326, L385–391; test L742–753
- **説明:** query 無しは `/welcome`。`?returnTo=` / 外部 URL は `sanitizeLoginReturnPath` が先に `sanitizeReturnPath` して `/planner` になり、self-return 判定に落ちない。spec は「`/planner` は login 成功先に使わない」。既定経路は壊していない。

#### M2. strip 後 leftover pending がまだ `needs_confirmation` を返す

- **Confidence:** 74（製品 CTA は閉じた。攻撃 2 は HOLD）
- **Where:** `auth-gateway.ts` L1115–1132; `auth-gateway.test.ts` L436–470; `auth-callback-page.tsx` L265–266
- **説明:** URL `token_hash` は unbound（L1066–1068）。`credentialKind === "token_hash"` の pending 再構成と `confirmMagicLink` / `resumeFlow` の `verifyOtp({ token_hash })` は型互換で残る。page は `needs_confirmation` を unbound leave にする。本番ユーザー無し・旧リンク無視の前提では inbound  stale メールは届かない。

---

## Residual accepted

仕様 §2.3 / 指示の受け入れ残差。実装が悪化させていない。must-fix にしない。

| 残差 | 扱い |
| --- | --- |
| Google は standalone で Safari に出ることがある | 副導線のまま |
| 番号を読むためにメールアプリを開く | 戻る先は同じ `/login` の 6 マス |
| 6 桁の探索空間 | GoTrue の試行・寿命に委ねる |
| Admin `generateLink` は URL を出せる | 製品 UI からは消した。オペレータ面 |
| hosted `MAGIC_LINK_ENABLED` が切れないことがある | local は `false`。切れないなら URL 無しテンプレが防御、と deploy 文書に明記 |
| 共有端末に宛先メールが 60s 残る | snapshot 契約。番号は入れない |
| sessionStorage 印の `setItem` 失敗 | 実装コメントどおり再マウント leftover は残差 |
| `otp-templates` 未起動時の GoTrue 既定テンプレ | 配線自体は到達 URL。Mailpit 失敗は運用。パーサは http(s) で throw |
| `sendMagicLink` / `confirmMagicLink` が型に残る | spec 許容。login / callback は呼ばない |
| bootstrap `loginAsNewUser` の着地 `/planner` | 製品外。製品既定は `/welcome` |

---

## Attacks that did not land（FAIL 以外の補足）

**2 token_hash.** `completeCallback` は `tokenHash !== null` で pending / verify / deposit / `needs_confirmation` をせず unbound（gateway L1064–1068, test L235–267）。capture は `token_hash` を strip するが、complete に渡す URL は unbound になる。page は CTA を出さない（callback L265–266, test L158–213）。

**3 テンプレ.** `sendEmailOtp` options に `emailRedirectTo` が無い（gateway L1007–1010, test L287–294）。`otp-code.html` は `{{ .Token }}` のみ。override は Magic / Confirm とも `http://otp-templates:8080/otp-code.html`、件名 `こんだて日和の番号`、`OTP_EXP=3600`、`MAGIC_LINK_ENABLED=false`。

**4–6 storage / 印 / sibling.** `rememberWaitingUi` / `writeEmailOtpCompletedMark` に番号も returnTo も無い。`dismissUnexpiredSiblingAuthFlowsForEmailOtp` は空文字 `clearSibling` を使わない（login L245–266）。

**7–9 入力.** Strict 1 回（test L315–332）。composition 中 Enter は `onChange` しない（otp-digit-field L82–86, L150–156）。`"12ab34"` / `"12345"` / `"1234567"` は `verifyOtp` 非呼び出し（gateway test L321–327）。

**10–12 境界.** ユーザー向けに OTP/PWA/英語 code を出さない。`LOGIN_EMAIL_HINT` は描画されない（login test L138）。4 lock export 非再定義。`@shared/safety` / CSP 非変更。

**13–15 着地 / E2E / CTA.** query 無し leftover 成功の dest は `welcome-dest`（login test L196–201）。`loginAsNewUser` は hashed_token をページ外 verify（`e2e/fixtures/auth.ts` L139–228）。`requestMagicLinkAndReadUrl` 削除。confirm CTA 非表示。
