# 献立ひねり軸 Implementation Plan — 敵対的レビュー

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md`
- Spec: `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`
- 姿勢: 計画本文を忠実に実行した実装者が、silent no-op・all-new_menu 422・overload・再生成汚染・false-green テストを出す経路を探す
- 判定: **REVISE — Critical 0、Important 7、Minor 3**

## 1. Verdict

Spec レビューで潰した 422 / PromptPreferences / 正本取り違え / 12 引数 DROP は、計画側では閉じている。残るのは「計画をそのまま実行すると Task 1–2 の GREEN が嘘になる」系と、Spec §7 のロック穴である。

## 2. 成立しなかった攻撃（偽陽性候補）

| # | 攻撃 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | 20260730 の reserve 本体を写して quality retry を巻き戻す | 不成立 | 計画は `20260808120000:25` を正本に指名。INSERT は 156–165 行 |
| 2 | 計画の DROP が 12 引数 | 不成立 | 貼ってある DROP は現行 13 引数 identity |
| 3 | 単一 commit でも mapSnapshot 余剰キー 422 | 不成立 | 同一 commit 内で契約が先。分割禁止が Task 境界 |
| 4 | PromptPreferences 追加で再生成 JSON が変わる | 不成立 | new_menu 分岐 + `recentDishHints` 同型。`expectExactKeys` が preferences を固定 |
| 5 | `noveltyExcludedDishes` が既存トップレベルキーと衝突 | 不成立 | 現行は preferences / members / pantry / validationVersions / seasonContext / recentDishHints |
| 6 | fingerprint / quota / validate / HMAC へ漏れる | 不成立 | fingerprint は CurrentSafetyContext。`collectPlannerRequestText` は食材・回避・memo。HMAC canonical は下書き値を含めない |
| 7 | 正規化が漢字かなを畳むと計画が誤認 | 不成立 | カタログテストが `ぶた肉` alias と `ブタニク`/`ぶたにく` を分けている |
| 8 | planner-route が 3 箇所より多い / keepalive が別組み立て | 不成立 | 104 / 145 / 1776 のみ。keepalive は `buildSaveGenerationDraftArgs` |
| 9 | `buildNewMenuSystemPrompt` の arity 変更が他 caller を壊す | 不成立 | caller は 505 行の 1 箇所 |
| 10 | 件数上限 12 が未使用 | 不成立 | `lookupStapleDishes(..., NOVELTY_EXCLUDED_DISHES_MAX)` |
| 11 | `run-e2e.sh` がファイル絞り不可 | 不成立 | `"$@"` を Playwright へ転送する。省略はコストであり正しさの欠陥ではない |
| 12 | draft-from-menu がメニュー表に無い列を読む | 不成立 | 引数は `PlannerSubmission`。`.default(null)` が旧 snapshot をカバー |
| 13 | Task 1/2 の 14 引数 RPC と旧 13 引数ブラウザの並走 | 受容残差 | 既知。今回の束ねが新規に開けた穴ではない |
| 14 | ai_control の exact jsonb が新列で自動破綻 | 不成立 | 列を明示列挙しており、未選択の新列は jsonb に出ない |

## 3. Important

### I-1: GRANT / inventory / 03a `to_regprocedure` を計画が「同じ内容で貼る」「変更不要」と書いた

攻撃: DROP 13 + CREATE 14 のあと、13 引数 GRANT を貼ると migrate が `function does not exist`。inventory を放置すると `db-test` が extra/missing。03a の `to_regprocedure(…jsonb)` に `,null` を足すと無効 SQL、足さないと privilege 検査が NULL。

live: `rls_inventory.test.sql:284`、`03a:86–88`、`20260730120000:120–125`。計画自身の grep 指示は `ingredient_preference` でヒットする。

### I-2: Spec §7「13 引数版が残っていない」テストが無い

攻撃: 20260730 の 12 引数 DROP コメントを誤って写し、14 引数 CREATE だけ足す。13 引数が残る。PostgREST 名前付き RPC は candidate 曖昧で下書き保存が全面停止。pgTAP の位置 14 引数呼び出しと `has_function(14 型)` は通る。

### I-3: Task 1 Step 7 の expected_revision 3/4 は消費済み

攻撃: 計画どおり `save(3,'twist')` を `finish()` 直前へ貼る。live は idea `save(3)` で revision 4。conflict でファイル全体が abort。persist だけ 4 に直すと `throws_ok(4,'wild')` が `P0001` になり `22023` を見ない。

### I-4: 型再生成が host/`grep` 任せで Meta に届かない

攻撃: `grep types package.json` のあとホストで `npm run db:types`。script は `http://meta:8080`。解決しない。再生成を飛ばすと Task 2 overlay の `GeneratedSaveDraftArgs["p_novelty_preference"]` が無い。手編集したくなる（禁止）。

正: スタック起動後 `docker compose run --rm app npm run db:types`。

### I-5: `z.infer` で noveltyPreference は required。Task 2 の file リストでは typecheck が緑にならない

攻撃: Task 1 が契約を足した瞬間、factories / revalidation-adapter / filter-emergency-menus / 多数テスト literal が欠キー。Task 2 は overlay と planner persist だけを直し、Step 10 で `tsc -b` PASS と書く。実装者は未記載ファイルを独断編集するか、赤のまま先へ進む。

`exactOptionalPropertyTypes` が on。欠キーは error。

### I-6: E2E 対象が生成せず、radio が live select と衝突する

攻撃: `menu-domain-pantry.spec.ts` に click を差し込む。autosave は見えても生成 success は見ない。Spec §7 が false-green。並行して Task 5 が select コピーと radio テストを両方指示するので、どちらかが残赤。

生成成功は `full-journey.spec.ts:73–90`（`献立を作る` → `/menus/:uuid` → 「献立ができました」）。

### I-7: `getPlannerDraft` の select 文字列がテストでロックされない

攻撃: Step 4 は手組み行を `mapPlannerDraft` に通すだけ。select 列を増やさなくても GREEN。実行時 GET は `novelty_preference` を返さず、`plannerDraftSchema` の `.default(null)` が twist を未指定にする。リロード後サイレント no-op（Spec F-02 の再発）。keepalive/save は値を送れるので「保存は動いている」ように見える。

修正: `.select(...)` の列文字列に `novelty_preference` が含まれること、またはキー欠落行が twist を保持できないことをテストする。

## 4. Minor

- M-1: `git add` が directory 単位。
- M-2: `ai_control` は `no_plan()`。「plan +1」は誤指示。
- M-3: Task 5 が `PlannerFieldName` / `ReviewFieldErrors` を触らない。任意軸の field-local / details 強制オープンから外れる。

## 5. Assessment

422 系の設計欠陥は計画に落ちている。実装開始を止めるのは、GRANT/inventory、pgTAP 貼り付け、型/fixture、E2E 対象、select 文字列のテストロック。これらを Plan 本文に書いてから再レビューする。
