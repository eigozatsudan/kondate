# Triple review: `a87f895`

- **SHA:** `a87f895f9d925a1c5df834f9a251593061951169`
- **Subject:** `fix: マジックリンクレビュー指摘（sb fragment・確認再表示・二重送信）を直す`
- **Parent:** `e37497dde3507bdae78a3dbcaadd878a663927bc`
- **手法:** 親コミット時点の欠陥（`e37497d-triple` / prior primary·secondary）と live 実装・テストの差分照合。E2E 再実行なし。
- **独立評価:** 本 fix が **レビュー指摘を閉じたか** と **新規回帰** に限定。

---

## 1次レビュー

### Summary

`e37497d` の Critical/Important を狙った最小修正:

1. **`sb` を hash allowlist に追加**し、GoTrue 形 fixture（`…&sb=`）で `otp_expired → expired` を固定。
2. **confirm 前に `writePendingAuthDeposit`**（`C-ML1`）。strip 後 `flow` のみ URL でも `credentialKind === "token_hash"` + pending から `needs_confirmation` を再構成。専用 unit あり。
3. **`confirmInFlightRef` 同期ガード** + double-click テスト（1 回だけ `confirmMagicLink`）。
4. **confirm 後 `awaiting_completion` は leave せず** needs_confirmation UI を維持（再タップ可能）。コメント I-4。

レビュー指摘の本線は閉じている。残るのは pending に OTP 平文を載せる既存 XSS 面の延長、および confirm 経路が mount 時 code 経路ほど completion-wait を武装しない設計差（再タップで緩和）。

### Verdict: **APPROVE**

### Findings

#### Critical

（なし — `sb` 誤写は本コミットで解消）

#### Important

##### F1. deposit 成功直後に pending を消すと、confirm 途中 reload の「確認 UI 再表示」は claim/recovery 依存

- **Confidence:** 78
- **Where:** `confirmMagicLink` 同一ブラウザ: deposit `ok` → `clearPendingAuthDeposit` → その後 `verifyOtp`
- **Why:** C-ML1 の reload 再表示は **pending 残存**前提。confirm 開始後に deposit が先に成功すると pending が消え、strip 相当 URL では needs_confirmation 再構成に失敗しうる。ただし deposit 済みなら `resumeFlow` / claim + `shouldExchangeClaimedAsTokenHash` → `verifyOtp` の residual 経路があり、**完全な資格喪失ではない**。
- **Fix suggestion（任意 follow-up）:** verify 完了まで pending を残す、または awaiting 時に page 側で completion wait を武装（code 経路と同型）。

#### Minor

##### F2. confirm 経路 awaiting は page が recovery を武装しない

- **Confidence:** 72
- **Where:** `applyTerminalResult` awaiting: `return` のみ
- **Why:** 即 unbound は解消。再タップと pre-lease 残存に依存。lease 競合や 30s timeout 後の自動 completion 受信は mount 時 awaiting より弱い。Important から下げた（I-4 の最悪経路は塞いだ）。

##### F3. token_hash が pending-deposit（localStorage）に載る

- **Confidence:** 70
- **Where:** `writePendingAuthDeposit` on needs_confirmation
- **Why:** authorization code 平文 pending と同じ所有 prefix。logout / soft residual / TTL で掃除済み。同一 origin XSS ではもともと flow secret と揃うと危険、という既存モデルの延長。新規 Critical ではない。

### 検証された修正対応表

| 親の指摘 | 本コミット | 状態 |
| --- | --- | --- |
| F1 `sb` Critical | allowlist + `&sb=` tests | **Closed** |
| F2 strip reload | pending write + restore branch + test | **Closed**（confirm 中は F1 residual） |
| F3 double submit | `confirmInFlightRef` + test | **Closed** |
| F4 awaiting unbound | leave しない | **Closed**（自動 recovery は弱め） |

---

## 敵対的レビュー

**姿勢:** fix が穴を塞いだふりをしていないか。token 漏洩・二重消費・confirm バイパス・open redirect。

### Attack matrix

| # | 攻撃 | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | GoTrue `…&sb=` + otp_expired → unbound | **反証** | `sb` 許可。test fragment に `&sb=`。expired 写像。 |
| A2 | 未知 `#evil=1` は依然 fail-closed か | **反証（安全維持）** | unknown key は reject のまま。 |
| A3 | `#access_token=` 取り込み | **反証** | reject キー集合。 |
| A4 | 二重タップ dual verifyOtp | **反証** | ref 同期。test: 2 click → once。finally で ref 解除後の意図的再試行は可。 |
| A5 | strip reload で confirm 不能 | **本線反証** | pending から再構成。confirm 中 deposit 後は A6。 |
| A6 | confirm 中（deposit 後）reload | **低〜中 residual** | pending 消え → needs_confirmation UI 喪失。claim/recovery が資格を保持し得る。 |
| A7 | open redirect | **反証** | returnTo は flow 由来 + sanitize のまま。 |
| A8 | CTA 無し verify | **反証** | 変更なし。 |
| A9 | pending を他 flow に挿げ替え | **低** | restore は `stored.credentialKind === "token_hash"` かつ pending.code 長検査。攻撃者は XSS or storage 書込が必要（既存面）。 |
| A10 | 二重消費で session あり error UI | **大幅緩和** | dual call 抑止。awaiting で error leave しない。 |
| A11 | token_hash localStorage 盗難 | **residual（既存モデル）** | TTL・logout clear・soft residual clear。HTTPS same-origin。 |

### Adversarial verdict: **PASS_WITH_RESIDUALS**

---

## 2次検証

| ID | 出所 | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- | --- |
| Parent F1 | e37497d Critical | `sb` 誤写 | **CONFIRMED fixed** | live allowlist に `sb`。tests L517–539 が `&sb=`。 |
| Parent F2 | Important | strip reload 喪失 | **CONFIRMED fixed（本線）** | completeCallback token_hash で pending 書込。code/state 欠落時 restore。test `strip reload restores needs_confirmation`。 |
| Parent F3 | Important | 二重送信 | **CONFIRMED fixed** | `confirmInFlightRef`。double confirm test once。 |
| Parent F4 | Important | awaiting unbound | **CONFIRMED fixed** | applyTerminalResult awaiting は return のみ。 |
| F1（本） | Important residual | deposit 後 pending clear | **CONFIRMED residual** | `if (depositOutcome === "ok") clearPendingAuthDeposit` が verify 前。完全喪失ではなく claim 経路あり → **must-fix ではない**。 |
| F2（本） | Minor | 自動 recovery 弱 | **CONFIRMED** | 再タップ設計として受容可。 |
| F3（本） | Minor | pending XSS 面 | **CONFIRMED residual** | 既存 code pending と同型。 |
| A1–A5, A7–A8, A10 | 敵対 | 本線耐性 | **CONFIRMED** | |

### Must-fix

**なし。**

### Safe to defer

1. verify 完了まで pending 保持、または confirm awaiting で completion wait 武装（F1）。
2. pending の storage 鍵を sessionStorage に限定する検討（F3・共有端末窓）。現状 continuation TTL 整合を優先している。

### 2次 Verdict: **APPROVE**

---

## 総合（本ファイル）

| 観点 | 結果 |
| --- | --- |
| 1次 | APPROVE |
| 敵対 | PASS_WITH_RESIDUALS |
| 2次 | APPROVE（親 Critical/Important は CONFIRMED fixed） |
| **最終** | **APPROVE** |
