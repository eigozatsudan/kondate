# Commit 6a80fcb 三重レビュー

**subject:** fix: GoTrue PKCE エラー fragment を unbound に誤写しない  
**SHA (full):** `6a80fcbe38512a512be6ad0f906adad7378db389`  
**parent:** `fc33edd52068f131e8fd3982c31f72938f6629b3`  
**Worktree:** `/home/dev/projects/kondate`  
**手法:** 静的トレース（live `auth-gateway.ts` / `auth-gateway.test.ts` の PKCE error fragment 実装とテスト。当該 SHA 専用 fix-report は quality-pass ledger 外。後続 magic-link token_hash 系コミットが同一 completeCallback を拡張）。Docker 再実行なし。コード編集なし。

**判定(1次):** APPROVE_WITH_NITS  
**判定(敵対):** PASS_WITH_RESIDUALS  
**判定(2次総合):** APPROVE_WITH_NITS  
**C/I/M 最終:** Critical 0 / Important 0 / Minor residual 1（error が fragment のみの仮想 GoTrue 変形）

---

## 差分要約

**問題:** GoTrue PKCE の失敗 redirect（`prepErrorRedirectURL`）は **query と fragment の両方**に `error_*`（および空の `sb=`）を載せる。旧実装は hash 非空だけで `unbound_callback` にし、`otp_expired` / リンク再利用を「確認できませんでした」に誤写していた。Gmail リンク保護や iOS で /verify が先に踏まれると error+hash 付き redirect になりやすく、再ログイン UX が壊れる。

**修正（live 根拠）:**
1. `COMPLETE_CALLBACK_ALLOWED_HASH_KEYS`: `error`, `error_description`, `error_uri`, `error_code`, `message`, `sb`
2. `COMPLETE_CALLBACK_REJECT_HASH_KEYS`: `access_token`, `refresh_token`, provider tokens, `expires_*` 等（implicit 系 fail-closed 維持）
3. `isRejectedAuthCallbackHash`: 許可キーのみなら通過 → query の `error_code` / `error` 判定へ（expired / oauth_cancelled 等）
4. 未知 hash キー・implicit token は従来どおり unbound

**テスト:**
- `iOS/Gmail: GoTrue PKCE error fragment + otp_expired query maps to expired (not unbound)`
- matching local flow 付き expired
- 既存 C7: `#access_token=…` / `#evil=1` は unbound

---

## 1次 Findings

### Critical
（なし）— fragment から session 材料を取り込まない。implicit grant キーは reject。許可は error 系メタデータと GoTrue `sb` 識別子のみ。

### Important
（なし）— 誤写は UX / サポート負荷の Important 帯欠陥だが、本 fix が閉じる。auth バイパスではない（expired を正しく出す方向）。

### Minor

#### M1. error が **fragment のみ**で query に無い仮想変形
`completeCallback` の expired / providerError 判定は **`url.searchParams`** を読む。GoTrue v2.189 が query+fragment 両方に載せる前提。将来 fragment-only になると、hash は通過するが error 未検出 → code 無しで unbound/awaiting 系に落ちる可能性。現行 GoTrue 前提では到達困難。

#### M2. 許可キーの値は検査しない
`sb=` 空や `error_description` の任意文字列は session に使われない。ログに載せる経路があれば別問題だが completeCallback は kind 分岐のみ。

### 1次総評
C7 fail-closed（implicit）を保ったまま GoTrue 実 redirect 形を許容する正しい修正。**APPROVE_WITH_NITS**。

---

## 敵対 Findings

| # | シナリオ | 結果 | Evidence |
| --- | --- | --- | --- |
| A1 | `#access_token=…` で session 注入 | **遮断** | REJECT_HASH_KEYS → unbound。exchange 非呼出テスト |
| A2 | `#evil=1` 未知キー | **遮断** | unbound。C7 テスト |
| A3 | query+fragment に `otp_expired` | **expired（正しい）** | テスト L508–526。unbound 誤写なし |
| A4 | 有効 code+state に偽 `error_code=otp_expired` | **deposit 優先** | `hasCodeAndState` 時は error short-circuit しない（C1 既存） |
| A5 | flow UUID + 偽 error で secret 焼き | **緩和** | stored あり・state 不一致は unbound かつ C5 系 non-burn と併存。expired は state 束縛（L588–589） |
| A6 | 空 `sb=` のみの hash で通過後、code 無し | **unbound/awaiting 系** | error 無し code 無しは既存 AUTH-R1 枝。session 成立なし |
| A7 | fragment に error のみ（query 無し） | **残 residual M1** | searchParams 未読。現行 GoTrue 両方載せ前提 |
| A8 | error_description に巨大文字列で DoS | **低** | URL 長制限はブラウザ/サーバ側。アプリは Set キー走査のみ |

**偽緑:** access_token / evil / otp_expired+sb= の三系統テストあり。fragment-only error は未テスト（M1 residual）。

**敵対判定:** **PASS_WITH_RESIDUALS**

---

## 2次検証表

| ID | 出典 | 重大度(元) | 二次判定 | 二次重大度 | live evidence |
| --- | --- | --- | --- | --- | --- |
| error fragment 許容 | 1次 | — | **CONFIRMED** | n/a | `auth-gateway.ts` L134–184, L528–533; tests L508–546 |
| implicit reject 維持 | 敵対 A1/A2 | — | **CONFIRMED** | n/a | REJECT set + tests L483–505 |
| A4 code 優先 | 敵対 | — | **CONFIRMED** | n/a | L581–594 |
| M1 fragment-only | 1次・敵対 | Minor | **CONFIRMED residual** | Minor | error 判定は searchParams のみ。GoTrue 両方載せ前提コメント L163–165 |
| 後続 token_hash 拡張 | live | — | **CONFIRMED 非退行** | n/a | token_hash 枝は code と排他。hash allowlist は error 系のまま + `sb` |
| 秘密漏洩 | — | — | **CONFIRMED なし** | n/a | hash 値を session に載せない |

### 2次総合
**APPROVE_WITH_NITS**。Critical/Important なし。fragment-only error は理論 residual。後続 magic-link 確認 UI は本 fix の error 分類を前提に積み上げており、矛盾なし。

---

## ブロッカー / residual

| 区分 | 内容 |
| --- | --- |
| **ブロッカー** | なし |
| **residual** | M1 fragment-only error（GoTrue 非準拠時）; 許可キー値の非検査（session 非使用） |

---

## クローズ可否

**クローズ可**（residual 付き）。
