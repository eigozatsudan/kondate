# 2次レビュー（実装）

- **役割:** 独立 secondary verifier（1次・敵対の著者コンテキスト非共有。本ファイルのみ書込）
- **日付:** 2026-08-16
- **Worktree:** `/home/dev/projects/kondate/.worktrees/email-otp-login`
- **HEAD:** `9ee91b21`
- **Range:** `2fe87765..9ee91b21`
- **Diff 正本:** `.superpowers/sdd/review-impl-2fe87765..9ee91b21.diff`
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)（§3.3 / §8.7 / MF-C1）
- **照合 plan:** [`docs/superpowers/plans/2026-08-16-email-otp-login.md`](../plans/2026-08-16-email-otp-login.md) Task 3
- **入力:**
  - 1次: [`2026-08-16-email-otp-login-impl-primary.md`](./2026-08-16-email-otp-login-impl-primary.md)（REVISE / C1 I1 M5）
  - 敵対: [`2026-08-16-email-otp-login-impl-adversarial.md`](./2026-08-16-email-otp-login-impl-adversarial.md)（BLOCK / C1 M2）
- **手法:** 指摘 ID ごとに cited file:line を自分で開き、leftover 開始 → `clearLeftoverLoginSessionIfNoSiblingCompletion` → `clearDiscardedExchangeSessionIfStillPresent` → `withTimeout(signOut)` → `verifyEmailOtp` complete の leftover 効果を静的に再追跡した。製品コードは変更していない。全件テストは再実行していない。
- **Verdict:** **CONFIRM_REVISE**

---

## Summary

番号ログインの骨格（`emailRedirectTo` 無し、6 桁ゲート、`token_hash` unbound、主 CTA / 同一 `/login` / 成功既定 `/welcome`、テンプレ URL 排除、Auth ロック 4 export 非再定義、メール用 Continuation 非新設）は Spec / Plan と一致する。sessionStorage 印 `kondate.auth.emailOtpCompleted` は **成功後の再マウント leftover** を閉じた。

差し戻しは 1 点。印は leftover **開始**だけを止める。マウントで既に投げた leftover `signOut` は abort も指紋再検査も印の再読もしない。`discardedExchangeSessionKey === null` のため適用直前の session 照合を飛ばし、sibling completion が無ければ今ある session を local `signOut` する。番号経路は continuation を書かないのでこの例外に乗らない。これは Spec MF-C1 / §3.3 / §8.7 が Critical として閉じる対象の残り枝。

1次 C1 と敵対 C1 は同一欠陥。1次 I1 はその観測点欠落。新 Critical / Important は立てない。

**計画二次**（`2026-08-16-email-otp-login-plan-secondary.md`）が棄却した「未認証の初回マウントで空 `signOut` が即終わり、初回成功を殺す」は、今もその狭い経路としては成立しない。今回の C1 はその主張の再利用ではない。C-R4 inbound leftover（authenticated のままフォームを出す）と、待ち UI 再水和直後の即 verify が、同一 client の in-flight leftover と重なる。

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`CONFIRM_REVISE`** |
| **Critical must-fix** | **C1**（1次 C1 ∪ 敵対 C1） |
| **Important must-fix** | **I1** |
| **新 Critical / Important** | **なし** |
| **解除条件** | C1 を直し、I1 の RED 2 本（in-flight leftover × verify、logout / soft residual で印が消える）が落ちること。inbound leftover（印なし）の C-R2 / C-R4 は残す |

---

## Finding-by-finding adjudication

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 |
| --- | --- | --- | --- | --- |
| **C1** | 1次 | Critical | **CONFIRMED** | Critical |
| **C1** | 敵対 | Critical | **CONFIRMED / DUPLICATE of 1次 C1** | Critical |
| **I1** | 1次 | Important | **CONFIRMED** | Important |
| M1 | 1次 | Minor | keep | Minor（任意） |
| M2 | 1次 | Minor | keep | Minor（任意） |
| M3 | 1次 | Minor | keep / already-accepted-residual | Minor（任意） |
| M4 | 1次 | Minor | keep | Minor（任意） |
| M5 | 1次 | Minor | keep | Minor（任意） |
| M1 | 敵対 | Minor | already-accepted-residual | must-fix にしない（confidence 78、既定経路は `/welcome`） |
| M2 | 敵対 | Minor | keep / = 1次 M3 | Minor（任意） |

---

### 1次 C1 / 敵対 C1 — CONFIRMED Critical

**id:** C1
**result:** CONFIRMED
**confidence:** 90
**evidence:**

| 事実 | file:line |
| --- | --- |
| leftover-capable = `authError` または search 空 / `?`。query 無し `/login` が主着地 | `login-page.tsx:324-332`、`free-landing-page.tsx:71-76` |
| 印は render 時の一回読み。effect 開始条件だけ | `login-page.tsx:391-392`, `573-578` |
| effect に cleanup / abort / generation 無し。`void` 投げっぱなし | `login-page.tsx:573-578` |
| leftover wrapper は指紋 `null` + `loserFlowId: ""` | `auth-gateway.ts:655-664` |
| sibling 判定は continuation 印だけ。番号成功は書かない | `auth-gateway.ts:562-572` |
| 指紋 `null` + context あり → `getSession` 照合を飛ばし、storage を同期 wipe したあと `signOut` | `auth-gateway.ts:608-642` |
| `withTimeout` は元 Promise を cancel しない | `async-timeout.ts:12-13`, `15-39` |
| 印 write は verify complete のあと。先に走った掃除は止まらない | `login-page.tsx:509-517`, `215-222` |
| `status === "complete"` の Navigate は描画だけ | `login-page.tsx:583-588` |
| leftover と verify は同一 singleton client | `src/shared/lib/supabase.ts:26-29` |
| 既存 RED は complete → `leftoverSignOut.mockClear()` → remount。in-flight を見ていない。mock は即 resolve | `login-page.test.tsx:208-236`, `23` |
| 待ち UI 再水和は UI 復元だけ | `login-page.test.tsx:473-489` |
| 製品 E2E は `/login?returnTo=%2Fplanner` で leftover-capable でない | `e2e/fixtures/auth.ts:238` |

**追跡（leftover 開始 → 適用 → verify）**

1. leftover-capable かつ印なしでマウントすると effect が即 `clearLeftoverLoginSessionIfNoSiblingCompletion()` を fire-and-forget する。
2. wrapper は `clearDiscardedExchangeSessionIfStillPresent(client, null, { loserFlowId: "", storage })`。番号成功は continuation を書かないので sibling 例外に入らない。
3. `discardedExchangeSessionKey === null` なので L608-620 の指紋再検査は走らない。L621-623 の「触らない」枝は `context === undefined` のときだけ。ここは context がある。
4. よって **今の persist を同期 wipe** し、続けて `withTimeout(client.auth.signOut({ scope: "local" }), 2_000)`。timeout しても元 `signOut` は残る。
5. `verifyEmailOtp` 成功は同じ singleton に新 session を書く。印はそれから立つ。印が立って effect が再実行されても、先に投げた `void` は cancelled にならない。
6. leftover-capable は authenticated でも Navigate しない（C-R2 / `login-page.tsx:583-588`）。C-R4 inbound leftover では AuthProvider が leftover session をメモリに持ったままフォーム（または待ち UI）を出す。そのとき `signOut` は空ではなく leftover token の logout API を待つ。

**成立する経路（計画二次の棄却を再利用しない）**

計画二次が FALSE_POSITIVE としたのは「未認証の初回マウント。指紋 null なので `getSession` プローブを待たず空 `signOut` が即終わる」という狭い主張。その経路は今も実害になりにくい。二次が確認した本線は別:

- **C-R4 inbound leftover + 同一マウント。** leftover persist / in-memory session がある leftover-capable `/login` が製品の leftover 本体。掃除の `signOut` は logout API を含む。待ち snapshot がある、またはメールをすぐ送れると、verify が同じ client に新 session を書いたあと遅延 `_removeSession` がそれを消す。
- **待ち UI 再水和。** メールアプリ往復で leftover-capable `/login` が再マウントする。U1-I2 が 6 マスを戻し、印はまだ無いので leftover が再起動する。ユーザーは番号をすぐ貼る。これが本スライスの存在理由と leftover 掃除の交差点。
- **timeout 後の late settle。** leftover 開始時に leftover session があると logout が 2s を超えても元 Promise は `_removeSession` する。印も fingerprint も見ない。

未認証・persist 無しの初回マウントだけを「毎回壊れる」とは言わない。実装はそれでも Spec 文面を満たしていない。§3.3 は leftover 対象を **マウント時点で既にあった persist** に限り、§8.7 は「今このタブで立てた番号 session を消さない」と書いている。適用時点の current session を無条件に消す今の関数は、その契約の残り枝そのもの。

**指紋だけの是正は再マウントで足りない**（計画二次の警告は今も正しい）。成功後再マウントの persist は OTP session 自身なので、印なしで「指紋一致なら消す」だけだと MF-C1 を再破る。今の sessionStorage 印は残す。足すのは (1) 開始時指紋（開始時に session が無ければ後から現れた session は消さない）(2) 印 write / unmount で in-flight を捨て、`signOut` 直前に印と指紋を再読する、の両方。

**why it matters:** leftover-capable は LP CTA の主着地。成功 Navigate の直後に session が消えると、ホーム画面アプリの往復でログインし直す。MF-C1 が閉じる対象。

---

### 1次 I1 — CONFIRMED Important

**id:** I1
**result:** CONFIRMED
**confidence:** 88
**evidence:**

- Plan Task 3 / Spec §7 の「leftover-capable で verify 成功 → Navigate。再マウントしても session が残る」は `login-page.test.tsx:208-236` が **印を書いたあと** の remount だけを固定している。`leftoverSignOut` は即 resolve（L23）。C1 本線（掃除 in-flight 中の complete、待ち UI 再水和からの即 verify）は無い。
- `auth-cleanup.ts:45-52` は `kondate.auth.emailOtpCompleted` を `MAGIC_LINK_RESIDUAL_KEYS` に足している。`shouldClearAuthKeyOnSoftResidual`（L80）と `clearOwnedBrowserStorage` / `clearSoftSessionResidualBestEffort` もその配列を読む。実装は今正しい。
- `auth-cleanup.test.ts:59-91` は `lastMagicEmail` / `magicSentUi` だけを見る。印キーを外しても GREEN のまま。
- 待ち再水和テスト（`login-page.test.tsx:473-489`）は見出しとマスだけで、leftover `signOut` と合成していない。

印が logout 後に 60s 残ると、次の leftover-capable `/login` が inbound leftover 掃除を飛ばす。C-R4 の例外が前ユーザーの印で開く。C1 を直しても、この観測点が無いと同じ穴が戻る。

I1 の in-flight ケースは C1 の RED そのもの。residual キー 1 本は C1 とは別契約で、同じ Important に残す。

---

## New findings

なし。敵対 Attack 2–15 の HOLD、1次 Strengths、§2.3 残差は二次も採用する。骨格の再調査で新しい Critical / Important は出ていない。

計画二次が棄却した「未認証初回マウントの空 leftover が毎回成功を殺す」は、今も独立 Critical にしない。

---

## Minors

| ID | 二次 | 理由 |
| --- | --- | --- |
| 1次 M1 `LOGIN_EMAIL_HINT` | **keep** | `login-page.tsx:53-54` に長押しプレビュー文が残る。画面は出していない（`login-page.test.tsx:138`）。再掲すると旧案内が戻る。死文削除は任意。 |
| 1次 M2 callback 待ちコピー | **keep** | `auth-callback-page.tsx:466`「Google やメールのリンクから戻ってきたあとの確認です。」confirm CTA は無い。機能穴ではない。 |
| 1次 M3 / 敵対 M2 pending 再構成 | **keep / already-accepted-residual** | URL `token_hash` は unbound（`auth-gateway.ts:1066-1068`）。`credentialKind === "token_hash"` + pending は `needs_confirmation` を返す（L1114-1132）。page は unbound leave（`auth-callback-page.tsx:265-266`、test L186-213）。製品 CTA は閉じた。spec は型に `confirmMagicLink` 残存を許容。本番ユーザー無し。 |
| 1次 M4 aria-label 二重 | **keep** | `otp-digit-field.tsx:6-13` と `email-otp-copy.ts:33-40`。copy 側コメントは「画面はここを読む」だがマスは独自定数。今は一致。 |
| 1次 M5 README | **keep** | `README.md:102-112` がマジックリンク手順のまま。`docs/deployment/supabase.md` は更新済み。製品コードは見ていない。 |
| 敵対 M1 無効 `returnTo` → `/planner` | **already-accepted-residual** | query 無しは `/welcome`（`login-page.tsx:363-365`）。`?returnTo=` / 外部 URL は `sanitizeReturnPath` が先に `/planner` にする（`auth-flow.ts:325-326`, `385-391`）。テストも Google 用に固定（`login-page.test.tsx:742-753`）。既定経路は壊していない。confidence 78。must-fix にしない。 |

---

## Must-fix list（implementer）

1. **C1.** leftover 掃除をマウント時点の persist に閉じる。
   - leftover 開始時に session 指紋を取る。開始時に session が無ければ、後から現れた session は消さない。
   - `signOut` / storage wipe の直前に指紋を再読する。変わっていたら触らない。
   - effect に cancelled / generation。印 write と unmount で in-flight を捨てる。掃除関数も適用直前に `kondate.auth.emailOtpCompleted` の鮮度を再読する。
   - `withTimeout` 後の late `signOut` も適用しない（元 Promise は cancel できないので、適用側の generation / 指紋が本体）。
   - **今の sessionStorage 印と remount-after-complete RED は残す。** 指紋だけに置き換えるな。成功後再マウントの persist は OTP session 自身。
   - inbound leftover（印なし）の C-R2 / C-R4 は残す。

2. **I1.** テストを本線に合わせる。
   - leftover-capable `/login` と `/login?authError=unbound_callback` で、leftover persist を置き `signOut` を未 settle のまま 6 桁 verify → Navigate。**そのあと** `signOut` が settle しても persist / session / Navigate が残る。待ち UI 再水和からの即 verify を 1 本含めてよい。
   - `clearLocalAuthAndDrafts` / `clearSoftSessionResidualBestEffort` が `kondate.auth.emailOtpCompleted` を消すことを 1 本。

Minor M1–M5（1次）と敵対 M1–M2 は BLOCK 解除条件ではない。

---

## Residual / out of scope

Spec §2.3 と 1次 / 敵対が受け入れた残差は二次も must-fix にしない。

- Google standalone / メールアプリ往復 / 共有端末の宛先 60s / 6 桁空間 / Admin `generateLink` / hosted `MAGIC_LINK_ENABLED` / 印 `setItem` 失敗 / `sendMagicLink`・`confirmMagicLink` の型残存 / 既存 TTL 内 `token_hash` pending の `resumeFlow` / `compose.e2e.yaml` の `1s`
- 残存 `token_hash` flow の dismiss は実装が unexpired 全件を捨てる。テストは `authorization_code` だけ。C1 とは別。任意。
