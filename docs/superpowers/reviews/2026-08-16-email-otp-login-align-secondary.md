# 2次レビュー（Spec × Plan × 実装 alignment）

- **役割:** 独立 secondary verifier（1次・敵対の著者コンテキスト非共有。本ファイルのみ書込）
- **日付:** 2026-08-16
- **Worktree:** `/home/dev/projects/kondate/.worktrees/email-otp-login`
- **HEAD:** `41166419`
- **Range:** `2fe87765..41166419`
- **照合 spec:** [`docs/superpowers/specs/2026-08-16-email-otp-login-design.md`](../specs/2026-08-16-email-otp-login-design.md)（§3.2 snapshot / §3.3 leftover / §2.3 残差）
- **照合 plan:** [`docs/superpowers/plans/2026-08-16-email-otp-login.md`](../plans/2026-08-16-email-otp-login.md) Task 3
- **入力:**
  - 1次: [`2026-08-16-email-otp-login-align-primary.md`](./2026-08-16-email-otp-login-align-primary.md)（**ALIGN** / C0 I0 M1）
  - 敵対: [`2026-08-16-email-otp-login-align-adversarial.md`](./2026-08-16-email-otp-login-align-adversarial.md)（**PASS_WITH_RESIDUALS** / C0 I0）
- **手法:** 指摘 ID ごとに cited file:line を自分で開き、C9 / leftover skip / initializer の順を静的に再追跡した。製品コードは変更していない。全件テストは再実行していない。§2.3 残差は must-fix にしない。
- **Verdict:** **ALIGN**

---

## Summary

番号ログインの製品契約（同一 `/login` の 6 マス、`emailRedirectTo` 無し、`token_hash` unbound、leftover-capable でも成功 Navigate、今の番号 session を leftover が殺さない、両テンプレから URL 排除、ロック値 3600 / 6 / 30 / 360 / 60s / 印キー）は Spec / Plan / live で揃っている。1次 ALIGN と敵対 PASS_WITH_RESIDUALS は矛盾しない。

二次の核は 1 次 **M1** だけ。leftover-capable かつ印なし `authenticated` で C9 が待ち snapshot を消す経路は **コード上実在**する。ただし初回 remount は initializer が C9 より先に snapshot を読むので 6 マスは出る。欠けるのは leftover persist が残ったままの **2 回目以降の remount** だけ。典型 LP → query 無し `/login`（未認証）では C9 が走らない。これは §3.3 / MF-C1 本線の未実装ではなく、§2.3 の「戻る先は 6 マス」を初回往復で満たしたあとの狭い枝。**REAL_BUT_MINOR。** Critical / Important に上げない。敵対の「C/I なし」を確認する。新 C/I は立てない。

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`ALIGN`** |
| **Critical must-fix** | **0** |
| **Important must-fix** | **0** |
| **新 Critical / Important** | **なし** |
| **解除条件** | なし。must-fix は無い |
| **1次との差** | M1 を **REAL_BUT_MINOR** として維持。ALIGN を確認 |
| **敵対との差** | 「C/I なし」を確認。M1 相当は敵対 Residuals の C9 行と同じ。新 Finding なし |

---

## Finding-by-finding adjudication

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 |
| --- | --- | --- | --- | --- |
| **M1** | 1次 | Minor | **REAL_BUT_MINOR** | Minor（任意。must-fix にしない） |
| （C9 2nd remount） | 敵対 Residuals | residual | **CONFIRMED residual** | must-fix にしない（= 1次 M1） |
| C/I | 敵対 | 0 | **CONFIRMED なし** | — |

**FALSE_POSITIVE:** Critical / Important 本体には無し。M1 を「起きない」として棄却もしない。

---

### 1次 M1 — REAL_BUT_MINOR

**id:** M1
**result:** **REAL_BUT_MINOR**
**confidence:** 86（経路の実在） / 84（must-fix にしない）
**evidence:**

| 事実 | file:line |
| --- | --- |
| C9 は `auth.status === "authenticated"` なら `magicSentUi` / last email を消す。成功印も leftover-capable も見ない | `login-page.tsx:594-599` |
| leftover-capable かつ印なし authenticated は Navigate しない（C-R2） | `login-page.tsx:322-330`, `604-608` |
| 待ち snapshot / `waiting` / `verifying` / in-flight なら leftover を起動しない（C1b） | `login-page.tsx:562-578` |
| 実装コメントが「後続 C9 が authenticated leftover で snapshot を消しても、このマウントでは起動済みにしない」と既に書いている | `login-page.tsx:566-567` |
| 初回 remount は `useState` initializer が effect より先に `readWaitingUi()` する | `login-page.tsx:274-304`, `364-366` |
| 2 回目 remount は snapshot 無し → idle。leftover が起動する | `login-page.tsx:294-303` → `568-587` |
| C9 テストは leftover-capable query 無し `/login` + authenticated で wipe を固定する | `login-page.test.tsx:857-880` |
| C1b テストは同じ組み合わせで待ち見出しと leftover 非起動を固定する。storage 残存は見ていない | `login-page.test.tsx:785-812` |
| U1-I2 再水和テストは未認証。C9 は走らない | `login-page.test.tsx:584-600` |
| Spec §3.2 / Plan Task 3 は snapshot でリロード後の番号待ちを復元する | spec §3.2、plan Task 3 Step 3 |
| Spec §3.3 / §8.7 は「今立てた番号 session を leftover が消さない」。snapshot 保持そのものは MF-C1 ではない | spec §3.3 / §8.7 |
| §2.3 はメールアプリ往復の戻る先を同じ `/login` の 6 マスとする。初回 remount で満たす | spec §2.3 |

**経路は実在する。** leftover persist が残ったまま待ち snapshot がある leftover-capable `/login` を開くと:

1. initializer が snapshot を読んで 6 マスを出す。
2. leftover effect は C1b で return する。persist は残る。
3. C9 が `authenticated` だけで snapshot を消す。
4. そのマウントの `state.status === "waiting"` は残る。
5. **次の remount**（メールアプリへもう一度行く、iOS が PWA を再殺する、など）は idle に落ち、leftover が起動する。

C9 のコメントは「ログイン成功後は宛先 PII を残さない」。leftover-capable かつ印なし `authenticated` は成功 leave ではなく C-R2 の inbound leftover なので、C9 の前提とずれている。1 次の修正案（印なし leftover-capable では `magicSentUi` を消さない / C9 をこのタブの番号成功に限る）は正しい任意修正。

**must-fix にしない理由:**

- 典型の初回 LP → query 無し `/login` は未認証。C9 は走らない。U1-I2 本線は生きている。
- leftover-capable の idle マウントは待ちが無いので leftover を起動する（`568-587`）。persist は通常、メール往復の前に落ちる。
- persist が残るのは C1b が leftover を意図的に止めたあとの枝（プロセスキルで in-flight `signOut` が途切れた、など）。狭い。
- 初回 remount では 6 マスが出る。§2.3 の「戻る先は 6 マス」は初回往復で満たす。敵対 Residual と同じ読み。
- `src/main.tsx:30` の `<StrictMode>` 二重マウントは開発時だけ。本番ビルドでは 1 回の Mail 往復が即 2 回目 remount にはならない。
- MF-C1 本線（今立てた番号 session を leftover が殺す）は `918b656d` / `643a8f6d` で閉じている。M1 は session ではなく待ち snapshot の 2 回目欠落。
- 1 次は Minor、敵対は Residual。二次も上げない。

---

## 敵対「C/I なし」の確認

敵対 Attack 1–5 は HOLD。二次が cited 行を追った範囲でも、confidence ≥ 80 の整列欠陥は無い。

| 攻撃 | 二次 | 根拠 |
| --- | --- | --- |
| Spec 文がコードに無い | **HOLD** | copy / 6 マス / leftover 例外 / 写像 / 両テンプレ / 製品 E2E 6 桁は live にある |
| ロック値 3600 / 6 / 30 / 360 / 60s / 印キー | **HOLD** | override + `login-page.tsx:84-90` + cleanup。docs だけではない |
| leftover が今の番号 session を殺す | **HOLD** | 印 + 指紋再読 + 待ち中非起動。残窓は Residual |
| `token_hash` pending / verify / deposit | **HOLD** | 即 `unbound_callback` |
| `emailRedirectTo` / テンプレ URL | **HOLD** | send は `shouldCreateUser` のみ。両 TEMPLATES 同一 HTML |
| 成功既定 `/planner` / snapshot に `returnTo` | **HOLD** | query 無しは `/welcome`。waiting / 印に `returnTo` 無し |
| テストが旧マジック契約を正にする | **HOLD** | 製品テストは 6 桁・unbound・`/welcome` |
| Task 4/5 片系 | **HOLD** | 両 TEMPLATES 同一到達 URL。Mailpit は http(s) で throw |

新 Critical / Important は立てない。320px マス列のはみ出し（敵対 confidence 72）も ≥ 80 未満のまま残差。

---

## Residuals（must-fix にしない）

Spec §2.3（Google standalone / メールアプリ往復そのもの / 共有端末 60s / 6 桁空間 / Admin `generateLink` / `SHOW_EMAIL_LOGIN`）は再掲しない。

加えて:

- **M1 / C9 2nd remount。** leftover persist が残ったままの 2 回目以降。初回 remount は 6 マス。
- leftover が最後の指紋照合のあと `signOut` を投げたあとの uncancelable `_removeSession`。
- 無効な明示 `returnTo` の内側 fallback `/planner`。query 無し既定は `/welcome`。
- 既存 TTL 内 `token_hash` pending の `resumeFlow`。新規 `?token_hash=` は unbound。
- `sendMagicLink` / `confirmMagicLink` の型残存。製品 UI は呼ばない。
- Plan チェックボックス未更新。中身は Task 1–6 + C1 / C1b / minors として着地。
- `compose.e2e.yaml` の SMTP `1s` は suite 専用。

---

## Final

**ALIGN。Finding IDs: なし。must-fix: なし。**

1次 M1 は **REAL_BUT_MINOR**。敵対の C/I 0 件を確認。新 C/I なし。
