# Commit 2025a74 三重レビュー

**subject:** fix: プランナー leave-flush 漏れと saving 無言ブロックを直す  
**SHA (full):** `2025a74e4633317eabbd360b4eee8375d842d2fe`  
**parent:** `bfad9195b10c621169e9e9683dcacad8b7d698f2`  
**Worktree:** `/home/dev/projects/kondate`  
**手法:** 静的トレース（planner-guided fix-report / re-review / residual verdict + live planner 系）。Docker 再実行なし。コード編集なし。

**判定(1次):** APPROVE_WITH_NITS  
**判定(敵対):** PASS_WITH_RESIDUALS  
**判定(2次総合):** APPROVE_WITH_NITS  
**C/I/M 最終:** Critical 0 / Important 0 / Minor residual（履歴戻る・flyer 休眠 flag）

---

## 差分要約

| ID | 修正 |
| --- | --- |
| **P1** | 下ナビ以外の SPA 離脱を leave-flush 経由化: ホーム冷蔵庫 / 直近献立、確認 Plus Link、硬上限 Plus CTA capture、pending 再開 `/generation?resumed=1`。`shouldInterceptPlannerLeaveClick` / `navigateAfterPlannerLeaveFlush` 追加 |
| **P2** | leave handler を **mount 時 1 回** register。`hasDraftConflictRef` 等で stale クロージャ解消。conflict 武装は setState 前に ref |
| **P4** | privacy/settings/emergency の `autosave.state==="saving"` 無言 early-return 削除。wizard `isSaving` から debounce saving を外し無言 disable を止める |

**Files:** `planner-leave-flush.ts` (+test), `planner-route.tsx` (+test), `review-step.tsx`, `home-expiring-pantry.tsx` (+test), `home-recent-menus.tsx` (+test)。

**残 residual（fix-report 明文）:** ブラウザ履歴戻る / アドレスバー直接入力は unmount best-effort のまま（`useBlocker` 非導入）。

---

## 1次 Findings

### Critical
（なし）— 安全ゲートや hard flush 契約を緩めない。Incomplete proceed は既存製品契約。

### Important
（なし）— 候補 SPA 離脱口は leave-flush 経由。mount-only register で null 窓閉鎖。saving 中は queue join。

### Minor

#### M1. ブラウザ履歴戻る / アドレスバー（P1 意図的縮退）
`useBlocker` 非導入。unmount best-effort 握りつぶしが残る。製品許容として fix-report 明記。

#### M2. flyer footer の素 Plus Link（P-R1 / 休眠）
`FLYER_WEEKLY_UI_ENABLED === false` 既定で UI 非表示。flag ON 時は leave-flush 非経由がコード上残る可能性。現行到達不能。

#### M3. navigate 戻り型（後続 follow-up）
`navigateAfterPlannerLeaveFlush` の navigate が `void | Promise<void>` を取る形は後続 `89c89bf` で型整理。本 SHA 時点の type nit は非製品。

### 1次総評
P1/P2/P4 は可用性・データ損失（サーバ旧 revision 黙殺）向けの正しい最小修正。**APPROVE_WITH_NITS**。

---

## 敵対 Findings

| # | シナリオ | 結果 | Evidence |
| --- | --- | --- | --- |
| A1 | dirty debounce 中にホーム「冷蔵庫」Link | **flush 後 navigate** | home-expiring-pantry intercept + leave-flush |
| A2 | dirty 中に下ナビ → 他タブ | **既存 leave-flush** | app-shell + mount handler |
| A3 | saving 中に「家族設定」連打 | **join flush（無言 return なし）** | P4; isSaving から debounce saving 除外 |
| A4 | conflict 中に leave | **blocked** | handler が `hasDraftConflictRef` を読む（false-safe） |
| A5 | Incomplete draft の leave | **proceed** | IncompleteDraftSaveError → proceed（通信封鎖しない契約） |
| A6 | deps 更新で register cleanup が null の一瞬 | **閉鎖** | mount-only `useEffect(..., [])` |
| A7 | ブラウザ Back | **残 residual** | unmount best-effort。M1 |
| A8 | 修飾キー / 中クリック | **素の Link 動作** | shouldIntercept が false → 新規タブ等を妨げない（正しい） |
| A9 | handler 未登録（/planner 外）で runPlannerLeaveFlush | **proceed** | モジュール null 時 proceed。想定内 |

**偽緑:** intercept/navigate/home/route の focused テストあり。Back ボタン E2E は意図的 residual で未強制。

**敵対判定:** **PASS_WITH_RESIDUALS**

---

## 2次検証表

| ID | 出典 | 重大度(元) | 二次判定 | 二次重大度 | live evidence |
| --- | --- | --- | --- | --- | --- |
| P1 閉鎖 | 1次 | — | **CONFIRMED** | n/a | `planner-leave-flush.ts` L33–65; home pantry/menus; review-step Plus; route pending leave |
| P2 閉鎖 | 1次 | — | **CONFIRMED** | n/a | `planner-route.tsx` L1028–1061 mount-only register + refs |
| P4 閉鎖 | 1次 | — | **CONFIRMED** | n/a | `runPrivacyNavigation` に saving ガード無し L769+; isSaving L1215–1225 |
| M1 Back | 1次・敵対 | Minor | **CONFIRMED residual-intentional** | Minor | useBlocker 未使用 |
| M2 flyer | 1次 | Minor | **CONFIRMED residual / 到達不能** | Minor | `FLYER_WEEKLY_UI_ENABLED=false` 既定（residual verdict） |
| A4 conflict blocked | 敵対 | — | **CONFIRMED** | n/a | handler L1029–1039 |
| A5 Incomplete proceed | 敵対 | — | **CONFIRMED 契約** | residual-intentional | L1047–1048 |
| navigate 型 | M3 | Minor | **CONFIRMED 後続緩和** | none | live `void \| Promise<void>` L55–59 |

### 2次総合
**APPROVE_WITH_NITS**。Important+ なし。履歴戻る・flag 休眠は intentional / 到達不能 residual。

---

## ブロッカー / residual

| 区分 | 内容 |
| --- | --- |
| **ブロッカー** | なし |
| **residual** | Back/アドレスバー; flyer flag ON 時の配線; Incomplete/conflict 製品契約（P3/P9 等 residual-accepted） |

---

## クローズ可否

**クローズ可**（residual 付き）。
