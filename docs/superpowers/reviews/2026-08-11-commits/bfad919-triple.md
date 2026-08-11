# Commit bfad919 三重レビュー

**subject:** fix: 認証 residual exchange 後着の session 差し替えを抑止する  
**SHA (full):** `bfad9195b10c621169e9e9683dcacad8b7d698f2`  
**parent:** `ca17622975ee87c32363d959607ac3bddd24b82c`  
**Worktree:** `/home/dev/projects/kondate`  
**手法:** 静的トレース（fix-report-r2 / rereview-r2 / residual verdict r2 + live `auth-provider.tsx` / `auth-continuation-recovery.ts`）。Docker 再実行なし。コード編集なし。

**判定(1次):** APPROVE_WITH_NITS  
**判定(敵対):** PASS_WITH_RESIDUALS  
**判定(2次総合):** APPROVE_WITH_NITS  
**C/I/M 最終:** Critical 0 / Important 0 / Minor residual-intentional 3（C-R5/6/7）+ prior residual-accepted 束

---

## 差分要約

`ca17622` 後に残った C-R1（Important）と C-R4（Minor）を閉じる。

| ID | 修正 |
| --- | --- |
| **C-R1** | residual recovery start で guard **arm** → 最初の non-null session の `user.id` を **pin** → 別 user の `applyAuthSession` を拒否 + pin token を `setSession` best-effort 復元。stop 後は pin 済みなら `guardUntilMs = now + EXCHANGE_IN_FLIGHT_TTL_MS`（120s） |
| **C-R4** | future lease 正規化の write 失敗時に **remove しない**。メモリ上 now 正規化で active 扱い |

**Files:** `auth-provider.tsx`, `auth-continuation-recovery.ts`, 各 test。  
**ロック export:** `AuthProvider` / `AuthProviderClient` は `setSession?` を optional 追加のみ。`AuthFlow` / `ContinuationApi` / `BrowserSupabaseClient` 再定義なし。

---

## 1次 Findings

### Critical
（なし）

### Important
（なし）— C-R1 記載 path（A 確立後の後着 B 無言差し替え）は pin + 120s guard + React 非適用で閉じる。テスト `C-R1: rejects late residual exchange session swap after another user already won` が user-a 維持と `setSession` 復元呼び出しを固定。

### Minor

#### M1. guard TTL（120s）経過後の超 late B settle（C-R5）
stop 後 pin は `EXCHANGE_IN_FLIGHT_TTL_MS` で解除。claim timeout 30s の 4 倍床。無限 pin / exchange abort は R2・再 login 契約と衝突。意図的時間床。

#### M2. `applyAuthSession(null)` で guard 全クリア後の後着 B（C-R6）
logout / 失効で pin 解除は **意図的アカウント切替は unauthenticated 経由** の契約。null 後も pin すると正当 re-login を阻害。

#### M3. pin token の `setSession` 復元失敗（C-R7）
主防衛は React 状態の別 user 拒否。復元は UI/API 乖離防止の best-effort。optional `setSession` はテスト注入許容。

#### M4. C-R2 / C-R3 は residual-locked のまま（本 diff 非対象）
C5/C3 表裏。再交渉なし。

### 1次総評
C-R1 主脅威を abort 不能 exchange 前提で最小防衛。ロック export を壊さない。**APPROVE_WITH_NITS**。

---

## 敵対 Findings

| # | シナリオ | 結果 | Evidence |
| --- | --- | --- | --- |
| A1 | residual start → A pin → B late SIGNED_IN | **遮断** | `applyAuthSession` 別 user 拒否 + setSession 復元。テスト C-R1 |
| A2 | A pin 後 TOKEN_REFRESHED 同一 user | **許可** | 同一 user は pin Session 更新（L243–246 相当） |
| A3 | recovery start 後 session 未確立のまま path 離脱 | **arm 解除** | pin 無し stop → clear guard。正当 |
| A4 | storage quota で future lease write 失敗 | **緩和** | C-R4: remove せず active 返却。orphan claim 窓閉鎖 |
| A5 | 120s 超 late B | **残 residual** | C-R5 時間床。稀エッジ |
| A6 | logout null 直後に late residual B | **残 residual** | C-R6。同一ブラウザ既進行 exchange の帰結。外部奪取窓ではない |
| A7 | setSession 復元失敗中の SDK 内部 B / UI A | **残 residual** | C-R7 DiD。UI は A 維持 |
| A8 | 攻撃者が guard を跨いで user.id を偽造 | **不可** | pin は SDK Session の user.id。偽 session を作るには既にその user の token が必要 |

**偽緑:** C-R1 テストは listener 経由の A→B を固定。TTL 経過・null 解除・restore 失敗は未演習だが intentional residual と明文一致。

**敵対判定:** **PASS_WITH_RESIDUALS**

---

## 2次検証表

| ID | 出典 | 重大度(元) | 二次判定 | 二次重大度 | live evidence |
| --- | --- | --- | --- | --- | --- |
| C-R1 閉鎖 | 1次 | — | **CONFIRMED** | n/a | `auth-provider.tsx` L26–70, L199–249, L383–421; test L375–439 |
| C-R4 閉鎖 | 1次 | — | **CONFIRMED** | n/a | `auth-continuation-recovery.ts` L530–546（write 失敗で remove なし） |
| M1 C-R5 | 1次・敵対 | Minor | **CONFIRMED residual-intentional** | Minor | コメント L26–38; cleanup L415–417; `isResidualGuardActive` 期限 clear |
| M2 C-R6 | 1次・敵対 | Minor | **CONFIRMED residual-intentional** | Minor | null で `clearResidualSessionGuard` L209–212 |
| M3 C-R7 | 1次・敵対 | Minor | **CONFIRMED residual-intentional** | Minor | restore `.catch` L237–239; optional setSession |
| A1 遮断 | 敵対 | — | **CONFIRMED** | n/a | 同上 C-R1 |
| ca17622 回帰 | — | — | **CONFIRMED 非退行** | n/a | recovery start ゲート C1/C2/C6 維持 L371–379 |

### 2次総合
**APPROVE_WITH_NITS**。Important/Critical なし。時間床・null 解除・best-effort は設計明文の intentional residual（r2 residual-adjudicator 全棄却と一致）。

---

## ブロッカー / residual

| 区分 | 内容 |
| --- | --- |
| **ブロッカー** | なし |
| **residual** | C-R5/6/7 Minor; prior C4/C7/C8/C11–C13; C-R2/C-R3 |
| **注意** | テスト注入で `setSession` 省略時は React ガードのみ（本番 BrowserSupabaseClient は常に持つ） |

---

## クローズ可否

**クローズ可**（residual 付き）。auth-session unit の fix_queue は本 SHA で 0。
