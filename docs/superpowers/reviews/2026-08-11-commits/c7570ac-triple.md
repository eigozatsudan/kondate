# Triple review: `c7570ac`

- **SHA:** `c7570ac94933ce35b80cae0375d10566a42df64a`
- **Subject:** `fix: マジックリンク案内に iOS 長押しプレビューの注意を足す`
- **Parent:** `a87f895f9d925a1c5df834f9a251593061951169`
- **手法:** 文言・docs 差分と auth 本線（token_hash 消費）の整合確認。コード実行なし。
- **独立評価:** copy / 運用 docs のみ。認証状態機械の変更は本 SHA に含めない前提で確認。

---

## 1次レビュー

### Summary

ユーザー向けに **iPhone 長押しプレビュー**で「すでに使われている / 確認できない」が起きうる旨を足す。

触っている表層:

- `LOGIN_EMAIL_HINT`（`login-page.tsx`）— 送信前の期待値説明
- `AuthCallbackPage` needs_confirmation 本文 — 着地後の操作指示
- `docs/deployment/supabase.md` メールテンプレ例の `<li>` — 本番 Dashboard テンプレの正本

token_hash 本線ではプレビュー GET は OTP を消費しないが、(1) テンプレ未更新の `/verify` 残存、(2) 旧メール、(3) プロキシの先読み、で死ぬ経路が残るため **予防 copy として妥当**。日本語・平易で非エンジニア向け。PII / 秘密を文面に載せない。

### Verdict: **APPROVE**

### Findings

#### Critical / Important

（なし）

#### Minor

##### F1. token_hash 本線では「プレビューだけでエラー」は稀になり、文言がやや旧経路寄り

- **Confidence:** 65
- **Where:** `LOGIN_EMAIL_HINT` / callback 小書き / supabase.md
- **Why:** 本線はプレビュー → 確認画面 → CTA。エラーより「確認画面でボタンを押す」が主。文言は両方カバー（普通にタップ + 確認ボタン）しており実害は低い。厳密には「プレビューだけだとログインは完了しません」優先でもよい。
- **Fix:** 任意。現行で ship 可。

##### F2. Dashboard テンプレはリポジトリ外

- **Confidence:** 80
- **Where:** `docs/deployment/supabase.md` のみ更新
- **Why:** 本番 HTML は ops が Dashboard に貼るまでユーザーに届かない。コード ship とテンプレ更新のオペギャップは `e37497d` 以来の既知 residual。本コミットは docs 側の注意を厚くした点でプラス。

---

## 敵対的レビュー

**姿勢:** 文言が誤った安全保証・フィッシング誘導・秘密露出を生まないか。

### Attack / abuse matrix

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | 「安全です」系の保証 copy | **反証** | エラー可能性と操作手順のみ。allergy/safety 無関係。 |
| A2 | 攻撃者メールに同文で正規感を出す | **residual 一般** | 任意マジックリンク文面の問題。本 diff が特に悪化させない。 |
| A3 | 文言に token / flow / email 露出 | **反証** | 静的日本語のみ。 |
| A4 | ユーザーを外部 URL へ誘導 | **反証** | アプリ内操作・メール再送のみ。 |
| A5 | 認証バイパスを示唆 | **反証** | 「完了するを押す」で消費タイミングを明示し、むしろ confirm 必須を強化。 |
| A6 | a11y: 重要情報が type-small のみ | **低 residual** | 主段落にもプレビュー非ログインを既に記載。小書きは補強。 |

### Adversarial verdict: **PASS**

---

## 2次検証

| ID | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 本線整合 | token_hash + CTA と矛盾しない | **CONFIRMED 整合** | ヒントは「リンクを開き + ログインを完了する」。callback も同旨。 |
| F1 | 旧経路寄り | **CONFIRMED Minor** | 害なし。defer OK。 |
| F2 | Dashboard 未同期 | **CONFIRMED residual** | コード欠陥ではない。 |
| A1–A5 | 安全 / 誘導 | **CONFIRMED 反証** | |
| 認証機械変更 | ロジック変更の有無 | **CONFIRMED なし（copy/docs）** | レビュー対象は案内文。 |

### Must-fix

**なし。**

### 2次 Verdict: **APPROVE**

---

## 総合（本ファイル）

| 観点 | 結果 |
| --- | --- |
| 1次 | APPROVE |
| 敵対 | PASS |
| 2次 | APPROVE |
| **最終** | **APPROVE** |
