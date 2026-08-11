# Commit fc33edd 三重レビュー

**subject:** fix: 世帯 soft invalidate の history revalidation キーを menu-revalidation に合わせる  
**SHA (full):** `fc33edd52068f131e8fd3982c31f72938f6629b3`  
**parent:** `f7e2218e3f64892506e724ae1a72b627d6905360`  
**Worktree:** `/home/dev/projects/kondate`  
**手法:** 静的トレース（HR3 fix-report / re-review + live household-queries / use-menu-revalidation）。Docker 再実行なし。コード編集なし。

**判定(1次):** APPROVE  
**判定(敵対):** PASS  
**判定(2次総合):** APPROVE  
**C/I/M 最終:** Critical 0 / Important 0 / Minor 0（命名 nit のみ記録）

---

## 差分要約

| ID | 問題 | 修正 |
| --- | --- | --- |
| **HR3** | `householdSafetyQueryPrefixes.historyRevalidation = ["history-revalidation"]` が実キー `["menu-revalidation", menuId]` と不一致。リポジトリ内に旧キー消費者なし → soft invalidate DiD が死んでいた | prefix を `["menu-revalidation"]` に修正。`menuRevalidationQueryKey` が同 prefix を spread して単一点共有 |

**Files:** `household-queries.ts`, `use-menu-revalidation.ts`, `household-queries.test.ts`。  
**非変更:** hard/soft recheck 契約、Realtime、poll、accept RPC。

---

## 1次 Findings

### Critical
（なし）

### Important
（なし）— 死んだ DiD 配線の修正。主 path（settings/onboarding CustomEvent + storage → hook hard）は元から閉じるが、Queries-only / event 欠落タブでの revalidation LKG 残存窓を RQ 経路で塞ぐ。

### Minor

#### M1. 定数名 `historyRevalidation` が中身 `menu-revalidation`（命名 nit）
歴史的命名。脅威なし。リネームはノイズ大で必須でない。

### 1次総評
最小・正しい・再乖離しにくい（キー工場が prefix 共有）。**APPROVE**。

---

## 敵対 Findings

| # | シナリオ | 結果 | Evidence |
| --- | --- | --- | --- |
| A1 | settings 更新後 app-shell が Queries-only invalidate | **ヒット** | prefix `menu-revalidation` が RQ partial match で `["menu-revalidation", menuId]` に効く |
| A2 | 旧 `history-revalidation` ゴミ cache が残る | **無害** | 消費者なし。invalidate 対象外は意図どおり |
| A3 | prefix と工場が再び乖離 | **低減** | 工場が prefix を spread。テストが一致を固定 |
| A4 | 他 user の cache を誤 invalidate | **しない** | 本 diff は revalidation prefix のみ。members 等の userId 束縛は別 |
| A5 | hard/soft 契約を緩める | **しない** | recheck ロジック非変更 |
| A6 | 偽緑: 旧キー文字列だけ assert | **反証** | テストは実キー invalidate true + 旧 dead key false |

**敵対判定:** **PASS**（残 residual なしに近い。命名 nit のみ）

---

## 2次検証表

| ID | 出典 | 重大度(元) | 二次判定 | 二次重大度 | live evidence |
| --- | --- | --- | --- | --- | --- |
| HR3 閉鎖 | 1次 | — | **CONFIRMED** | n/a | `household-queries.ts` L48–50; `use-menu-revalidation.ts` L19–22; test L64–80 |
| A1 ヒット | 敵対 | — | **CONFIRMED** | n/a | `invalidateHouseholdSafetyQueries` が `Object.values(prefixes)` を invalidate |
| M1 命名 | 1次 | Minor | **CONFIRMED nit** | none（任意） | 定数名のみ |
| 新規 failure path | re-review | — | **CONFIRMED 空** | n/a | re-review 新規候補 0 |

### 2次総合
**APPROVE**。live も HR3 閉鎖維持。後続 magic-link / e2e 系はこのキー配線を壊していない。

---

## ブロッカー / residual

| 区分 | 内容 |
| --- | --- |
| **ブロッカー** | なし |
| **residual** | 命名 nit のみ。prior HR1–2/HR4–16 residual-accepted は本 fix 非対象 |

---

## クローズ可否

**クローズ可**。
