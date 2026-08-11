# Commit f7e2218 三重レビュー

**subject:** fix: オンボーディング draft の CAS 衝突後に form をサーバ正本へ戻す  
**SHA (full):** `f7e2218e3f64892506e724ae1a72b627d6905360`  
**parent:** `2025a74e4633317eabbd360b4eee8375d842d2fe`  
**Worktree:** `/home/dev/projects/kondate`  
**手法:** 静的トレース（household-safety H8 fix-report / re-review / residual verdict + live onboarding page）。Docker 再実行なし。コード編集なし。

**判定(1次):** APPROVE_WITH_NITS  
**判定(敵対):** PASS_WITH_RESIDUALS  
**判定(2次総合):** APPROVE_WITH_NITS  
**C/I/M 最終:** Critical 0 / Important 0 / Minor residual（refetch 失敗 soft = H-R1）

---

## 差分要約

| ID | 問題 | 修正 |
| --- | --- | --- |
| **H8** | onboarding `save` の CAS miss 時 `setSaveState("failed")` のみ → `draftUpdatedAtRef` が T0 固定 → dual-tab 再衝突ループ | settings H9 同型: ConflictError 時 `refetchQueries(members exact)` → cache の `updated_at` を ref に反映 → 最新 save 版なら `pendingSavePatch` 空にして楽観 form をサーバ正本へ |

**Files:** `household-onboarding-page.tsx`, `household-onboarding-page.test.tsx`。  
**非変更:** draft CAS 本体、settings、planner/auth/safety。

---

## 1次 Findings

### Critical
（なし）— CAS 自体は false-safe のまま。サーバ上書き窓を開かない。

### Important
（なし）— dual-tab 可用性ループの主 path を settings と同型で閉じる。テストが T0 miss → form 正本化 → 新 CAS で再 save 成功を固定。

### Minor

#### M1. refetch 失敗時 CAS 非前進（H-R1）
refetch throw / cache 空で `latest === undefined` のとき `draftUpdatedAtRef` が進まない。コメント「次操作で再取得を期待」。settings H9 同型 soft。通信障害下の再 Conflict 可能性。false-safe（サーバ上書きは CAS が防ぐ）。

#### M2. onboarding は settings と異なり error.message を出さない
status 三値（saving/saved/failed）維持の最小方針。UX nit。製品破壊ではない。

### 1次総評
非対称（settings のみ回復）を閉じる最小・正しい fix。**APPROVE_WITH_NITS**。

---

## 敵対 Findings

| # | シナリオ | 結果 | Evidence |
| --- | --- | --- | --- |
| A1 | タブA/B が同一 draft を交互保存 | **回復** | Conflict → refetch → CAS 前進 → 再試行成功。テスト H8 |
| A2 | Conflict 後も楽観 form が古い allergy のまま生成へ | **緩和** | pending clear + members が form ソース → サーバ正本表示 |
| A3 | 攻撃者が古い expectedUpdatedAt で上書き | **不可** | サーバ CAS が拒否。クライアント ref 更新は攻撃面を広げない |
| A4 | refetch 中に別 patch を積む | **キュー直列** | saveQueue。最新 saveVersion のみ pending clear |
| A5 | refetch 失敗 + 再操作 | **残 residual** | M1。failed 表示。サーバは false-safe |
| A6 | Conflict を装った別例外で pending clear | **しない** | `instanceof HouseholdMemberVersionConflictError` のみ |

**偽緑:** H8 テストは成功 refetch を固定。refetch 失敗枝は settings 同型 intentional で未必須化。

**敵対判定:** **PASS_WITH_RESIDUALS**

---

## 2次検証表

| ID | 出典 | 重大度(元) | 二次判定 | 二次重大度 | live evidence |
| --- | --- | --- | --- | --- | --- |
| H8 閉鎖 | 1次 | — | **CONFIRMED** | n/a | `household-onboarding-page.tsx` L413–437 |
| M1 H-R1 | 1次・敵対 | Minor | **CONFIRMED residual-intentional** | Minor | L421–422 empty catch; residual verdict 棄却 |
| M2 文言 | 1次 | Minor | **CONFIRMED 設計最小** | Minor | saveState 三値のまま |
| A1/A2 | 敵対 | — | **CONFIRMED 緩和** | n/a | 同上 + H8 テスト存在 |
| CAS false-safe | 敵対 A3 | — | **CONFIRMED** | n/a | サーバ expectedUpdatedAt 契約非変更 |

### 2次総合
**APPROVE_WITH_NITS**。Important+ なし。refetch 失敗は H9 同型 residual。

---

## ブロッカー / residual

| 区分 | 内容 |
| --- | --- |
| **ブロッカー** | なし |
| **residual** | H-R1 refetch 失敗 soft; prior H1–H7/H9–H15 residual-accepted |

---

## クローズ可否

**クローズ可**（residual 付き）。
