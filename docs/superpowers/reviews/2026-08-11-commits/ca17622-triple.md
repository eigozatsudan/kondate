# Commit ca17622 三重レビュー

**subject:** fix: 認証 residual recovery と soft 残渣の安全側を強化する  
**SHA (full):** `ca17622975ee87c32363d959607ac3bddd24b82c`  
**parent:** `c5f507dfad848bbbd0e631289f03a1e71d87acbf`  
**Worktree:** `/home/dev/projects/kondate`  
**手法:** 静的トレース（差分根拠: adversarial-quality-pass-9724d2da fix-report / re-review、live HEAD の `src/features/auth/**`）。Docker / vitest 再実行なし。コード編集なし。

**判定(1次):** REQUEST_CHANGES  
**判定(敵対):** FAIL（Important 合成 path 残存）  
**判定(2次総合):** APPROVE_WITH_NITS（後続 `bfad919` で C-R1/C-R4 閉鎖を live 確認）  
**C/I/M 最終:** Critical 0 / Important 0（live 閉鎖） / Minor residual-intentional 複数

---

## 差分要約

認証 residual recovery と soft 残渣の安全側をまとめて強化した Important 帯 fix。

| 領域 | 変更 | ID |
| --- | --- | --- |
| recovery 起動 | unauthenticated + auth-waiting path（実質 `/login`）のみ。authenticated `/login`・非待機 path では start しない | C1 / C2 / C6 |
| soft residual | `pending-deposit.*`（authorization code 平文）と `kondate.auth.supabase-*`（PKCE verifier）を削除。flow secret 等は温存 | C3 / C10 |
| code 無し provider error | gateway / AuthCallbackPage で secret を即 burn しない | C5 |
| target lease | 未来 `refreshedAt` を now 正規化（即 remove しない） | C9 |

**触ったファイル（fix-report）:**  
`auth-provider.tsx`, `auth-cleanup.ts`, `auth-gateway.ts`, `auth-callback-page.tsx`, `auth-continuation-recovery.ts`, `auth-flow.ts` + 対応 tests。

**意図的に触らない residual-locked:** C4 last-wins deposit、C7 claim 冪等 ciphertext、C8 平文 secret、C11 create 孤児、C12 IP rate limit、C13 magic residual 60s。

---

## 1次 Findings

### Critical
（なし）— 本 diff は auth バイパスや secret 漏洩を広げない。soft は共有端末 code 残渣を減らす方向。

### Important

#### I1. residual recovery 起動ゲートだけでは in-flight 後着 exchange の無言 session 差し替えが残る（C-R1）

- **Where:** `auth-provider.tsx` recovery effect + `onAuthStateChange`（本 commit 時点では無条件 `setSession`）; `auth-continuation-recovery` stop は abort 不可（R2）
- **Why:** C1/C2/C6 は **start** だけ閉じる。unauthenticated `/login` で recovery が claim→exchange を開始したあと、別経路で session=A が立ち cleanup→stop しても、後着 B の `exchangeCodeForSession` は進行し、`onAuthStateChange` が React 状態を B に差し替え得る。navigate は stop 済みで捨てられるため **無言アカウント差し替え**。
- **Evidence:** post-fix re-review（`unit-auth-session-rereview.md` / verdict）が C-R1 Important 成立。本 commit 単体では未修正。
- **判定への影響:** REQUEST_CHANGES（Important 未閉鎖）。後続 `bfad919` が担当。

### Minor

#### M1. C5 non-burn 後の空 claim poll（C-R2）
正当 cancel / code 無し error 後も secret が TTL まで残り、`/login` residual recovery が空 claim を周期実行。可用性ノイズ。C5 秘密焼き DoS 緩和の表裏。

#### M2. soft が pending を消すと in-flight re-deposit 不能（C-R3）
C3 共有端末 hygiene と deposit 429 再試行の緊張。奪取 path ではない。

#### M3. future lease 正規化 write 失敗時の remove（C-R4）
C9 成功枝は温存。write 失敗枝が remove すると短時間 orphan claim 窓。storage 障害エッジ。

#### M4. residual-locked 束（C4/C7/C8/C11–C13）
設計ロック。本 Task 再交渉外。記録のみ。

### 1次総評
C1/C2/C3/C5/C6/C9/C10 の主 path は正しい最小修正。ただし I1（C-R1）が同 unit の後続 fix 待ちで、本 SHA 単独では Important 未閉鎖 → **REQUEST_CHANGES**。

---

## 敵対 Findings

### 攻撃シナリオ

| # | シナリオ | 結果 | Evidence |
| --- | --- | --- | --- |
| A1 | authenticated 中に別 OAuth residual を裏で claim/exchange | **緩和** | recovery が authenticated で start しない（C1/C6）。旧 path 閉鎖。 |
| A2 | soft 失効後 unauthenticated `/planner` で silent residual complete | **緩和** | 非待機 path で recovery 非起動（C2）。completion listener は path ガード。 |
| A3 | soft 後に共有端末へ pending code + secret が残る | **緩和** | soft が pending + PKCE verifier を削除（C3/C10）。secret は C7 温存（明示 logout で全消し）。 |
| A4 | state 一致の code 無し error で secret 即破壊 DoS | **緩和** | C5 non-burn。TTL / 明示 logout 収束。 |
| A5 | 未来 lease で callback-owned を orphan 扱い dual claim | **緩和（主枝）** | C9 now 正規化。write 失敗枝は M3。 |
| A6 | unauth `/login` residual start → A 確立 → B late exchange 無言差し替え | **成立（I1）** | stop 非 abort + 無条件 setSession。**FAIL 根拠。** |
| A7 | last-wins 匿名 deposit 毒上書き | residual-intentional C4 | アカウント奪取ではない可用性 DoS。 |

### 偽緑リスク
- テストは C1/C2/C6 start ゲートと soft キー集合を固定。A6 の late swap は本 commit 時点のテストに無い → 偽緑で閉じたことにしない（I1）。
- C5 non-burn は gateway + page 双方テストあり。

**敵対判定:** **FAIL**（A6 = Important 合成 path が残る）

---

## 2次検証表

| ID | 出典 | 重大度(元) | 二次判定 | 二次重大度 | live evidence |
| --- | --- | --- | --- | --- | --- |
| I1 / A6 C-R1 | 1次・敵対 | Important | **CONFIRMED 後続閉鎖** | none（live） | `auth-provider.tsx` `applyAuthSession` + residual guard arm/pin/`EXCHANGE_IN_FLIGHT_TTL_MS`（`bfad919`）。テスト `C-R1: rejects late residual exchange…` |
| M1 C-R2 | 1次 | Minor | **CONFIRMED residual-intentional** | Minor | C5 non-burn 維持。TTL 収束。r2 residual-rejected |
| M2 C-R3 | 1次 | Minor | **CONFIRMED residual-intentional** | Minor | soft が pending 削除維持。C3 表裏 |
| M3 C-R4 | 1次 | Minor | **CONFIRMED 後続閉鎖** | none（live） | `readActiveTargetLeases` age&lt;0 で write 失敗でも remove しない（`bfad919`）。テスト C-R4 |
| C1/C2/C3/C5/C6/C9/C10 閉鎖 | re-review | — | **CONFIRMED** | n/a | live recovery 条件 L371–379; soft clear L121–126; gateway C5 L600–608; lease C9 L530–539 |
| A1–A5 緩和 | 敵対 | — | **CONFIRMED** | n/a | 同上 |
| residual-locked C4 等 | 1次 | — | **CONFIRMED 据え置き** | residual | last-wins / 平文 secret 等ロックコメント維持 |

### 2次総合
本 commit 単体の Important（C-R1）は **live HEAD では後続 commit で閉鎖済み**。意図的 Minor residual のみ。差し戻しブロッカーなし。

---

## ブロッカー / residual

| 区分 | 内容 |
| --- | --- |
| **本 SHA 時点ブロッカー** | C-R1（Important）— 後続 `bfad919` で解消 |
| **live residual** | C-R2/C-R3、C4/C7/C8/C11–C13、C-R5/6/7（時間床・null 解除・best-effort restore） |
| **製品破壊 / auth バイパス** | 無し |

---

## クローズ可否

- **本 SHA 単独クローズ:** 不可だった（I1）。  
- **系列（ca17622+bfad919）/ live HEAD:** **クローズ可**（residual 付き）。  
- 本レビュー文書は ca17622 を REQUEST_CHANGES と記録し、2次で live 救済を明記する。
