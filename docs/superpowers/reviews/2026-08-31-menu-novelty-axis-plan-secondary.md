# 献立ひねり軸 Implementation Plan — 二次レビュー

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md`
- Spec: `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`
- 実施者: 一次・敵対的とは別スレッド（独立）
- 判定（二次本文）: **REVISE — Critical 3、Important 8、Minor 3**
- 注: Critical 3 件の severity は裁定で Important へ下げる（§「親照合」）。二次が見た欠陥そのものは採用する。

## 1. Verdict

Task 1 単一 commit、13 引数 DROP、reserve INSERT 正本、`NullableDraftArgs`、識別子チェーン（`noveltyPreferences` → `noveltyPreference` → `p_novelty_preference` → `NOVELTY_HINTS_ENABLED` / `noveltyExcludedDishes` / `lookupStapleDishes`）は live と一致する。引用行番号（planner-route 104/145/1776、autosave 76/141、generation-context 63–81 と 211–223、planner-api 25–45/56/63–83、`buildNewMenuSystemPrompt` 241–253 と caller 505）も現時点で正しい。`plan(43)` → `plan(46)` の +3 も、追加が本当に 3 本なら正しい。

RED テストが「計画が主張する理由」で落ちるか、GREEN が「計画が列挙したファイルだけ」で通るか、という二次レンズでは Task 1 pgTAP と Task 2 typecheck が偽 GREEN になる。

## 2. 二次が Critical としたもの（欠陥は本物、本番破壊ではない）

### C1. `rls_inventory` と 03a GRANT シグネチャ

`rls_inventory.test.sql:284` と `03a:86–88` は 13 引数 identity。計画は「変更不要」かつ呼び出しへ `,null`。`to_regprocedure` に `,null` は無効。Task 1 Step 8 の db-test は必ず赤。

### C2. Task 1 Step 7 の revision 3/4

live は idea save 後 revision 4。`save(3,'twist')` は conflict。ファイルが abort し persist assert は twist を見ない。

### C3. Task 2 の typecheck が列挙ファイルでは緑にならない

`z.infer` 出力は required。factories、emergency、revalidation、accessibility、planner-route.test、planner-wizard.test ほか。Task 2 Files に無い。実装者は未記載ファイルを編集するか赤を残す。

## 3. Important（二次独自の深掘り）

### I1. Task 5/6 UI が live `<select>` と矛盾

`review-step.tsx:591–626` は select。空 option が null。wizard は `getByLabelText` + `selectOptions`。計画の radio と「再押下で null に戻さない」は両方とも live と違う。

### I2. 既存 toEqual / snapshot fixture

`planner.test.ts:40–42` と `generation-context.test.ts:214–228` / 共有 `snapshot` 54–70 行。Step 12 の `.nullable()` に default が無いので、共有 fixture 未更新は loadGenerationContext 全件失敗。

### I3. Spec §7 uniqueness 未ロック

14 型 `has_function` は存在証明だけ。13 引数残留を見ない。

### I4. Spec §7「2 テーブルの列 check」が private 側だけ

`has_column` は `private.generation_draft_submission_versions` のみ。public は persist SELECT で間接ロック。CHECK 定義の assert は無い（同ファイルは pantry CHECK をパターンにしている）。

### I5. `ai_control` は `no_plan()`。twist を既存 selected_only 往復に足すと null

`:3` は `no_plan()`。`:1213–1253` の RPC jsonb は `ingredient_preference = selected_only`。twist 保存→予約の専用ケースが要る。

### I6. 型再生成が `package.json` 探索

正は `npm run db:types`。Meta 必須。`docker compose up -d --wait` のあと `docker compose run --rm app npm run db:types`。

### I7. Task 4 ヘルパー名がプレースホルダ

live: `asNewMenuExecution` / `userPayload` / `systemText`。再生成は inline（`:538–569`）。計画の `makeNewMenuContext` をそのまま貼ると RED がコンパイルしない。計画は読み替えを許している。

### I8. reserve 本体が「写して INSERT を足す」だけ

約 470 行。INSERT 列を 1 つ落とすと Spec F-01（下書き twist、snapshot 常時 null）。writing-plans は完全コードを要求する。Spec 自身も copy-delta を選んでおり、計画は INSERT 位置を強調している。

## 4. Minor

- M1: `wild` 拒否テストは実装前から `.strict()` で throw する。
- M2: E2E「118 行付近」は `clickWizardNext`。`waitForResponse` は `updatePlannerAndAwaitAutosave`（32–55 行）。
- M3: Task 1 の「typecheck 赤でも commit」。husky は無い。commit 自体は止まらない。AGENTS.md §8 の後段検証は赤のまま。

## 5. Spec §7 lock 表

| Spec §7 | Plan | 二次の判定 |
| --- | --- | --- |
| 契約 parse + 欠損 → null | Task 1 Step 1 | 部分。incompleteDraft 未更新 |
| overlay null | Task 2 Step 1 | 書いてある |
| 辞書 | Task 3 | 書いてある |
| プロンプト on/off | Task 4 | 挙動 assert。repo に prompt snapshot は元々無い |
| kill-switch 段落+キー | Task 4 off ファイル | 書いてある |
| 再生成 payload 不変 | Task 4 | 書いてある。ヘルパー名 GAP |
| 2 テーブル列 check | Task 1 Step 7 | public GAP |
| 14 引数 uniqueness + 不正値 | Task 1 | 不正値あり、uniqueness GAP |
| reserve → snapshot twist | Task 1 | 書いてあるが scenario 配線が曖昧 |
| snapshotRowSchema 新列 | Task 1 Step 10 | load 経路。fixture 必須 |
| mapSnapshot 3 値 round-trip | Task 1 Step 10 | `loadGenerationContext` 経由は正しい（mapSnapshot 非 export） |
| E2E ひねりたい → success | Task 6 | 書いてある。locator が radio |

## 6. Hook / command

- pre-commit で typecheck は走らない。Task 1 の「赤を記録して commit」は git としては通る。
- Step 8 `db-test` は C1/C2 未修正なら失敗する。
- Step 9 型再生成は Meta が要る。

## 7. Assessment

設計判断は維持してよい。実装者を Task 1 に入れる前に、inventory/GRANT、revision 4/5、fixture 一括、select UI、uniqueness、`db:types` を Plan 本文へ固定する。
