# 実装レビュー 擬陽性再検証・修正記録

- **日付:** 2026-08-12
- **対象 HEAD（レビュー時点）:** `672628c1`
- **修正後:** 本記録と同 PR の fix コミット
- **入力:**
  - [1次](./2026-08-12-admin-shared-recipes-viewer-impl-primary.md) **REVISE** (Important 2)
  - [敵対](./2026-08-12-admin-shared-recipes-viewer-impl-adversarial.md) **PROCEED_WITH_CONDITIONS** (Important 3)
  - [2次](./2026-08-12-admin-shared-recipes-viewer-impl-secondary.md) **REVISE_IMPL** (MF-R1…R5)
- **クリーン adjudicator:**  
  `.superpowers/sdd/impl-review-shared-recipes-8ad0a9d1/verdict.md`  
  `.superpowers/sdd/impl-review-shared-recipes-8ad0a9d1/verdict-second.md`

---

## 統合 fingerprint と裁定

| ID | 1次 / 敵対 / 2次 | Adjudicator-1 | Adjudicator-2 | **最終** |
| --- | --- | --- | --- | --- |
| C-DATE | F1 / I1 / MF-R2 | 成立 Important | 成立 Important | **成立 Important → 修正** |
| C-COUNTS | F2 / — / MF-R3 | 成立 Important | 成立 Important | **成立 Important → 修正** |
| C-UUID | M2 / M1 / MF-R1 | 成立 Important | 成立 Minor | **成立 Minor+ → 修正** |
| C-UI-404 | — / — / MF-R4 | 成立 Minor | 成立 Minor | **成立 Minor → 修正** |
| C-API-RAW | — / I2 / — | **棄却** | 成立 Minor | **棄却（Important）** — unit/schema で strip 済み。route 成功パスは follow-up 可 |
| C-SQL-GUARD | — / I3 / — | **棄却** | **棄却** | **棄却** — queries は flat、現行 evasion なし |
| C-AUTH-ANON | — / — / MF-R5 | **棄却** | **棄却** | **棄却** — `rls_inventory` + `share_community_emergency` で既カバー |

Critical: **0**（三者 + 両 adjudicator 一致）

---

## 実施した修正

1. **C-DATE** — `register.ts` 共有レシピ一覧で `from`/`to` 欠落を `date_range_required` 400。親 jst の双方省略デフォルトを共有レシピでは使わない。`app.test.ts` で `error.code` を assert（`db_unavailable` 偽 green 解消）。
2. **C-UUID** — `:id` を `8-4-4-4-12` hex UUID に厳格化。`------------------------------------` 等 → `invalid_id` 400。
3. **C-COUNTS** — `sharedRecipes.test.ts` で status 付き list 時に counts params/SQL に status フィルタが無いことを固定。
4. **C-UI-404** — `formatApiError(err, "list"|"detail")`。詳細 404 は「対象が見つかりません」、一覧 404 は token 無効案内。

---

## 棄却理由（記録）

- **C-API-RAW:** mapper / Zod FORBIDDEN / list dirty parse で raw 経路を反証。Important としての route 成功パス必須は過剰（Minor 残差は任意）。
- **C-SQL-GUARD:** 非再帰 readdir は理論穴だが現行 tree は flat。実害 failure path なし。
- **C-AUTH-ANON:** ops_readonly 重複 assert 不要。他 pgTAP が anon/auth の private 表 GRANT を固定。

---

## 検証

```text
cd admin && npm test -- --run server/src/app.test.ts server/src/queries/sharedRecipes.test.ts \
  server/src/lib/map-shared-recipe.test.ts shared/schemas.test.ts
# 25 passed
```

---

## 判定（修正後）

| レビュー | 修正前 | 修正後見込み |
| --- | --- | --- |
| 1次 | REVISE | **PROCEED**（F1/F2 クローズ） |
| 敵対 | PROCEED_WITH_CONDITIONS | **PROCEED**（I1 クローズ、I2/I3 棄却または follow-up） |
| 2次 | REVISE_IMPL | **ACCEPT**（MF-R1–R4 クローズ、R5 棄却） |
