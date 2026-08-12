# 2次検証: admin 共有レシピ閲覧 Implementation Plan

- **役割:** secondary verifier（1次・敵対を live で再照合。擬陽性除外）
- **日付:** 2026-08-12
- **Plan:** [`../plans/2026-08-12-admin-shared-recipes-viewer.md`](../plans/2026-08-12-admin-shared-recipes-viewer.md)
- **入力:**
  - 1次: `...-plan-primary.md`（**REVISE** / C0 I5 M3）
  - 敵対: `...-plan-adversarial.md`（**BLOCK_WITH_CONDITIONS** / C0 I4 M3）
- **手法:** 静的再照合。Plan 未修正時点の判定。must-fix 反映後は APPROVE_WITH_RESIDUALS へ下げられる。

---

## Summary

1次・敵対は **同じ根因**（Task 3 SQL/テスト未完成、plan 件数、detail title）を突いており、二次はこれを **CONFIRMED** する。

**擬陽性として棄却:**

| 候補 | 判定 | 理由 |
| --- | --- | --- |
| private 表 RLS で 0 行（親 plan の C1 再発） | **棄却** | matrix: recipes/origins RLS **off**。GRANT SELECT で行可視。policy 不要。 |
| token 無しで本文 API が常に開く | **棄却（設計どおりなら）** | Plan は `localToken` 時のみ register。middleware は token 設定時全 API に Bearer。両方揃う。未完成なのは **回帰テスト**側。 |
| has_function_privilege 形式が常に壊れる | **棄却** | 他 pgTAP で同形式が使用中。失敗しても lives_ok で補完可能。 |
| migrate コマンドが存在しない | **棄却** | `compose.yaml` に `migrate` / `db-test` あり。 |
| Task 5 UI 全文必須 | **DOWNGRADE → residual** | FeedbackPage が正本パターン。Important にしない。 |

**最終: `REVISE_PLAN`**

Critical must-fix: **0**  
Important must-fix（統合）: **4**（MF-P1…P4）

---

## Cross-walk

| ID | 出典 | 二次 | 統合 |
| --- | --- | --- | --- |
| Pri F1 / Adv I1 | SQL 未記載 | **CONFIRMED** Important | **MF-P1** |
| Pri F2 / Adv I2 | 未完成テスト・plan N | **CONFIRMED** Important | **MF-P2** |
| Pri F5 / Adv I3 | detail title | **CONFIRMED** Important | **MF-P3** |
| Pri F4 | ルート受け入れテスト不足 | **CONFIRMED** Important | **MF-P2 に吸収**（テスト束） |
| Pri F3 | plan(50) | **CONFIRMED** | **MF-P2** |
| Adv I4 | sql-guard 最終形 | **CONFIRMED 低** — Plan に最終形あり。MF-P1 埋め込み時に再掲で足りる | **MF-P1 付帯** |
| Pri F6 UI | Minor/residual | **DOWNGRADE residual** | residual |
| RLS 0 行 | （潜在） | **棄却** | — |

---

## Merged must-fix（Plan 改訂用）

### MF-P1 — list/detail 完全 SQL（Pri F1 ∪ Adv I1 ∪ I3）

`listSharedRecipes` / `getSharedRecipe` に bind 付き完全実装を Plan に書く。

- counts: `created_at` 範囲 + optional meal_type。status 別 `count(*) filter (where status = 'active')` 等。**status クエリは counts に使わない。**
- items: 範囲 + optional meal_type + optional status。  
  `private.share_recipe_title_from_payload(r.menu_payload) AS title`。  
  **SELECT リストに `menu_payload` 列を載せない**（引数参照のみ）。
- detail: メタ + title 関数 + `menu_payload`（mapper 専用）。0 行 null。

### MF-P2 — テスト完成と plan(50)（Pri F2/F3/F4 ∪ Adv I2）

1. `select plan(50);` を明示（38+12）。
2. mapper 成功 fixture + `JSON.stringify` に `menu_payload`/`menuPayload` 無し。
3. Bearer 無し → 401（token 設定時）。
4. 不正 status/mealType → 400; from/to 欠落 → 400; detail 不存在 → 404。
5. 一覧レスポンスに `preview` キーが無い（schema parse または handler テスト）。

### MF-P3 — detail title（Pri F5）

detail SELECT に title 関数を含める（MF-P1 に包含可）。

### MF-P4 — 運用コメント更新（Minor 昇格なし・推奨）

ops テスト先頭「6 GRANT 表」→ 8、register コメント「6 画面」→ 7 を Task 1/4 に一行。

---

## Residuals

- UI 全文なし（Feedback 踏襲）
- rls_inventory 非更新
- 本番 apply は人間
- scrape / jsonb 負荷は設計残差

---

## 結論（レビュー時点）

| 項目 | 結果 |
| --- | --- |
| 判定 | **REVISE_PLAN** |
| Critical | 0 |
| Important must-fix | MF-P1…P4（P3 は P1 に含めてよい） |
| 次 | Plan 本文へ MF 反映 → 実装開始可（APPROVE_WITH_RESIDUALS） |

---

## クリーンコンテキスト再チェック（MF 反映後）

Plan 改訂後に二次が再照合した要点（擬陽性は再発させない）:

| MF | 反映確認 | 擬陽性再燃 |
| --- | --- | --- |
| MF-P1 | Task 3 Step 4 に counts/items/detail の bind SQL 全文。一覧 SELECT リストに `menu_payload` 列なし（関数引数のみ）。 | なし |
| MF-P2 | `plan(50)` 明示。mapper 成功 fixture + stringify 禁止。Bearer 401 / 日付欠落 400 / 不正 enum 400。response schema に preview 無し。 | なし |
| MF-P3 | detail SELECT に title 関数あり。 | なし |
| MF-P4 | 8 表・7 画面コメント指示あり。 | なし |

**棄却維持:** private 表 RLS 0 行問題、migrate サービス不在、token 設計欠落（ルート非登録 + middleware の二重）。

**残差維持:** UI 全文省略、rls_inventory 任意、本番 apply は人間。

**改訂後判定: `APPROVE_WITH_RESIDUALS`** — 実装 Task 開始可。