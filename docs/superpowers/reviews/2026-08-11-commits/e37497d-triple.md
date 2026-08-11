# Triple review: `e37497d`

- **SHA:** `e37497dde3507bdae78a3dbcaadd878a663927bc`
- **Subject:** `feat: マジックリンクを token_hash + ユーザー確認で消費する`
- **Parent:** `6a80fcbe38512a512be6ad0f906adad7378db389`
- **手法:** `git log` 親子 + 当該コミット差分 package（`/tmp/grok-1000/magic-auth-review-d0b8e4a9.diff`）+ ピン GoTrue `v2.189.0` 挙動照合。実行時 E2E は未再実行。
- **独立評価:** 後続 fix（`a87f895` 等）は本 SHA の判定に入れない。**本コミット時点のツリーのみ**。

---

## 1次レビュー

### Summary

マジックリンクを **GET `/auth/v1/verify` 一発消費**から、メールに `token_hash` を載せアプリ `/auth/callback` へ直着地 → **ユーザーが「ログインを完了する」を押したあと** `verifyOtp` POST で消費する設計へ切り替える。意図は iOS 長押しプレビュー / Gmail 安全確認による OTP 先食いの回避。`needs_confirmation` 結果型・`confirmMagicLink` API・`credentialKind: token_hash`・legacy UUID `code` との dual exchange・deploy docs のテンプレ必須化は方向として正しい。

一方、同じコミットが導入した fragment allowlist が **GoTrue 本番形の `sb` キーを欠く**ため、エラー redirect を `unbound_callback` に誤写し、直前の `6a80fcb`（otp_expired 正写）を実質潰す。加えて confirm 二重送信が state のみ、strip 後の `token_hash` 非永続、confirm 後 `awaiting_completion` 即 unbound が残る。

### Verdict: **FAIL**

### Findings

#### Critical

##### F1. GoTrue fragment キー `sb` 未 allowlist → `otp_expired` 等が `unbound_callback`

- **Confidence:** 95
- **Where:** `src/features/auth/auth-gateway.ts` `COMPLETE_CALLBACK_ALLOWED_HASH_KEYS` / `isRejectedAuthCallbackHash` / `completeCallback` 先頭 short-circuit
- **Why:** 本コミットは hash 非空即 unbound をやめ、error 系キーのみ許可する allowlist に置き換えた。許可集合は `error` / `error_description` / `error_uri` / `error_code` / `message`。ピン `supabase/gotrue:v2.189.0` の `prepErrorRedirectURL` は常に `hq.Set("sb", "")` するため、実 URL は  
  `#error=…&error_code=otp_expired&…&sb=`  
  となり **未知キー → fail-closed unbound**。query 側の `error_code` 読取より前に落ちる。テスト fixture が `sb` を含まないため green のまま本番形が壊れる。
- **攻撃 / 影響:** 旧 ConfirmationURL・未更新テンプレ・Gmail 先読みで OTP 消費後のユーザー着地が「確認できませんでした」。OAuth の `redirectErrors` も同 `sb` を付け、`oauth_cancelled` 誤写の範囲が広がる。
- **Fix:** `sb` を allowlist に追加。fixture を GoTrue 形（`&sb=`）に。未知キー fail-closed は維持。

#### Important

##### F2. URL strip 後、confirm 前に `token_hash` の SPA コピーが消える

- **Confidence:** 90
- **Where:** `auth-callback-url-capture` strip + `completeCallback` token_hash 分岐（deposit / pending 無し）+ page `result` のみ保持
- **Why:** 着地直後に query から `token_hash` を strip。本コミットは confirm まで deposit せず pending も書かない。リロード / プロセス死 / bfcache 後は `/auth/callback?flow=…` のみ → residual は deposited code 前提で **OTP 未消費なのに確認 UI を再構成できない**。
- **影響:** ユーザーはリンク死と誤認しうる。OTP 自体は未消費なのでメール再オープンは救済だが UX ハードロス。
- **Fix:** pending-deposit へ短寿命保存、または confirm 成功まで strip 延期。strip→reload の unit test。

##### F3. confirm 二重送信ガードが React state のみ

- **Confidence:** 92
- **Where:** `auth-callback-page.tsx` `confirmMagicLink`（`confirmPending` state）
- **Why:** 再 render 前の 2 タップが両方 `!confirmPending` を通過 → dual `verifyOtp`。ワンショット OTP で後勝ち / 先勝ちの error leave が `leftRef` を先に立てると、session 確立済みでも login error 画面に固定。
- **Fix:** 同期 `confirmInFlightRef` + double-click テスト。

##### F4. confirm 後 `awaiting_completion` を即 unbound に写す

- **Confidence:** 85
- **Where:** `applyTerminalResult` awaiting 分岐（コメント: recovery は effect 外）
- **Why:** code 経路の mount-time awaiting は completion wait + target recovery を武装する一方、confirm 経路は 30s `withTimeout` / lease 競合を即 unbound leave。in-flight `verifyOtp` は cancel されず、遅延 complete と UI が乖離しうる。
- **Fix:** 確認 UI 維持 + 再試行、または code 経路と同型の wait/recovery。

#### Minor

##### F5. 本番テンプレ更新は運用依存 / e2e は verify も受理

- **Confidence:** 80
- **Where:** `docs/deployment/supabase.md` / `e2e/fixtures/auth.ts`
- **Why:** コードだけでは旧 `/verify` メールを直せない。e2e は callback|verify 両対応で primary path を強制しない。docs 更新は良いがオペレーション residual。

### 設計上の良い点（1次）

- mount / プレビューでは `verifyOtp` しない（confirm CTA 必須）→ 先食い耐性の本線は正しい。
- `code` と `token_hash` 同時載荷は fail-closed。
- `token_hash` 長 `< 16` / `type` 非正規 / state mismatch は unbound。
- `returnTo` は local flow + `sanitizeReturnPath`（open redirect を URL パラメータ直では受けない）。
- isolated WebView は deposit のみ（当該 WebView に session を作らない）。
- claim 後 UUID vs hash の dual exchange で local e2e / 移行を両立。

---

## 敵対的レビュー

**姿勢:** トークン漏洩・open redirect・confirm バイパス・二重消費・false-green テストを優先して突く。本 SHA のみ。

### Attack matrix

| # | 攻撃 | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | プレビュー GET だけで OTP 消費 | **反証（token_hash 本線）** | `completeCallback` は `needs_confirmation` のみ。`verifyOtp` は `confirmMagicLink` 後。 |
| A2 | CTA 無しで session 確立（confirm バイパス） | **反証（正規 UI）** | ページは CTA 後にのみ `confirmMagicLink`。XSS 時は別脅威（既存 SPA 面）。 |
| A3 | open redirect（`returnTo=//evil`） | **反証** | `returnTo` は stored flow + `sanitizeReturnPath` / `isSafeAuthReturnTo`。URL の任意 returnTo を信用しない。 |
| A4 | 二重 `verifyOtp` / 二重消費レース | **成立** | F3。server は 2 回目失敗するが UI leave レースで error 勝ちがあり得る。 |
| A5 | メール URL の `token_hash` 盗難 → 攻撃者 confirm | **成立（リンク窃取一般）** | マジックリンク固有。state 一致が local secret 側で要求される同一ブラウザ経路は窃取者に secret が無く deposit-only 寄り。secret 無し + state 付きは **他ブラウザ deposit** 可能（設計どおり isolated）。窃取者が同一 origin storage を持つ場合は session 化可能＝リンク窃取と同等。 |
| A6 | fragment `#access_token=` 取り込み | **反証** | reject キー集合で unbound。exchange しない。 |
| A7 | 未知 fragment / 注入キー | **意図どおり fail-closed** | ただし **`sb` が未知扱い**で正規 error も落とす（A8）。 |
| A8 | GoTrue `otp_expired` + `sb=` → unbound 誤写 | **成立 Critical** | F1。テストが `sb` 無しのため false green。 |
| A9 | strip 後 reload で confirm 不能 | **成立 Important** | F2。OTP は生きるが UI 喪失。 |
| A10 | confirm 後 hang → unbound、OTP 半消費 | **成立 Important** | F4 + `withTimeout` 非 cancel。 |
| A11 | `code`+`token_hash` 同時で曖昧消費 | **反証** | 明示 fail-closed。 |
| A12 | ログへの token / email 永続 | **本 diff 範囲で新規悪化なし** | confirm 経路も既存 no-log 方針。pending 未使用のため localStorage への hash 書き込みは本 SHA では未実施（F2 の裏返し）。 |

### Adversarial verdict: **FAIL**（A8 が ship blocker）

---

## 2次検証

**役割:** 1次・敵対の独立照合。指摘ごとに CONFIRMED / REJECTED。

| ID | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| F1 / A8 | `sb` 未許可で unbound 誤写 | **CONFIRMED Critical** | ピン gotrue `v2.189.0` が `sb=""` を付与。allowlist に `sb` 無し。short-circuit が error_code より前。fixture 無 `sb`。 |
| F2 / A9 | strip 後 token 喪失 | **CONFIRMED Important** | 本 SHA の token_hash 分岐は pending 非書込。reload は needs_confirmation 再構成不可。 |
| F3 / A4 | state のみ二重送信 | **CONFIRMED Important** | `if (… \|\| confirmPending)` + `setConfirmPending`。ref 無し。 |
| F4 / A10 | awaiting → 即 unbound | **CONFIRMED Important** | `applyTerminalResult` が awaiting で `leaveLoginError("unbound_callback")`。 |
| F5 | 運用 / テンプレ residual | **CONFIRMED Minor** | docs 必須化は良い。e2e 両対応。 |
| A1–A3, A6, A11 | 本線の耐性 | **CONFIRMED as 反証** | 設計意図どおり。 |
| A5 | リンク窃取 | **CONFIRMED as residual（設計受容）** | マジックリンク一般。本コミットが悪化させたわけではない。 |

### Must-fix（本 SHA 単体）

1. **F1** `sb` allowlist + GoTrue 形テスト（Critical）
2. **F3** 同期 in-flight ref（Important）
3. **F2** pending 永続 or strip 遅延（Important）
4. **F4** awaiting を unbound 即写にしない（Important）

### 2次 Verdict: **FAIL**（後続 `a87f895` が対象。本 SHA 単独では ship 不可）

---

## 総合（本ファイル）

| 観点 | 結果 |
| --- | --- |
| 1次 | FAIL |
| 敵対 | FAIL |
| 2次 | FAIL（Critical F1 CONFIRMED） |
| **最終** | **FAIL** |
