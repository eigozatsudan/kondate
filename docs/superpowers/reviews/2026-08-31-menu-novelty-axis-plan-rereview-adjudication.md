# 献立ひねり軸 Implementation Plan — 再レビュー裁定（66a5d0fc）

- 日付: 2026-08-31
- 裁定者: 親エージェント
- 対象: 再レビュー一次・敵対的・二次、親の live 再照合
- 最終判定: **REVISE。Critical 0。P-01 / P-03 / P-05 は閉じた。P-06 は要求として閉じた。残 Important は 2 系統（P-04 の type/commit 境界、P-02 の ai_control 独立往復）。実装開始は禁止。**

## 1. 裁定方法

`66a5d0fc` の計画本文だけを、前回裁定の P-01〜P-06 と live へ当てた。Spec は触っていないので製品判断は再開しない。一次・敵対的・二次は独立。親は GRANT ロール、`03_pantry` revision、`ai_control` JWT / DO パターン、generated Args、`planner-api.test.ts`、`session.ts` pin no-op、`review-step` 初期 open を再読した。

## 2. P-01〜P-06

| ID | 裁定 | 理由 |
| --- | --- | --- |
| P-01 | **Closed** | 14 引数 GRANT、inventory `:284`、03a `to_regprocedure(...,text)`、呼び出し `,null`。REVOKE 例から `authenticated` 欠は「元ファイルのロールを正」と書いてある。EXECUTE 集合は PUBLIC revoke + GRANT authenticated で inventory と一致する |
| P-02 | **部分 Closed** | `03_pantry` persist 4 / wild 5 / idea CHECK 形 / `no_plan()` は live と一致。ai_control は「既存往復へ足すな」と書いた直後にプレースホルダと「直前シナリオの値へ置換」があり、selected_only 往復（`:1158–1253`、draft `3000…0001`、revision 1、JWT 無し）へ戻る。`:1990` / `:3185` の新 owner DO が正しい手本 |
| P-03 | **Closed** | `pg_proc` count = 1。`has_function(14 型)` だけでは足りない理由も書いてある |
| P-04 | **Open** | `db:types` コマンドと z.infer 説明と sweep 方針は入った。ただし (1) overlay は Task 2 のまま Task 1 が typecheck 全緑を要求する (2) Step 14 `git add` が factories 等を含まない (3) Step 4 PASS が `incompleteDraft` 更新より前 |
| P-05 | **Closed** | `<select>`、空 option で null、E2E `full-journey.spec.ts:73–90`。`additionalOpen` 初期 true。`selectOption("twist")` は option value |
| P-06 | **Closed** | select 文字列を `stringContaining("novelty_preference")` でロックする要求がある。live に `from().select()` ヘルパーが無いのは実装時のスタブ自作であり、要求欠落ではない（Minor） |

二次の Critical 相当の言い方は使わない。残件は Task GREEN の嘘であり、all-new_menu 422 や安全破壊ではない。

## 3. 残 Important（Plan へ書くこと）

### R-01 — P-04 の typecheck / commit 境界

live:

- `database.generated.ts` の `p_ingredient_preference: string` と同型で、regen 後は `p_novelty_preference: string` が Args 必須になる。
- overlay `NullableDraftArgs`（`database.ts:20–37`）が `| null` を復元するまで、`buildSaveGenerationDraftArgs`（`planner-api.ts:64–82`）と `database.test.ts` の `satisfies SaveDraftArgs`（119–164 行）は欠キーで赤。
- Step 13 の「`noveltyPreference: null` を足して planner-api を緑に」は RPC キーを直さない。
- Task 2 Step 2 は overlay 前に `p_novelty_preference: null` が `string` へ入らず FAIL することを期待している。Task 1 で overlay するとこの RED が消える。
- `planner.test.ts:40–41` の `toEqual(incompleteDraft)` は default 注入で Step 4 時点から落ちる。
- Step 14 `git add` に `shared/testing/factories.ts` が無い。dirty worktree だけ緑、commit tree は赤。

Plan が採るべき境界はどちらか一方:

**案 A（推奨）** overlay と `p_novelty_preference: input.noveltyPreference` と `database.test.ts` の Args fixture を Task 1 に移す。Task 2 Step 2 の「新しい FAIL」は削除し、Task 2 は select / map / autosave 空判定 / route に残す。

**案 B** overlay は Task 2 のまま。Task 1 は「`tsc` の Args 欠キー（`planner-api.ts` / `database.test.ts`）は overlay まで既知の赤」と明示し、Step 9b は `PlannerDraftInput` / `PlannerSubmission` literal と `toEqual` だけを緑にする。Step 13 の「赤のまま次へ進まない」を撤回する。

どちらでも、Step 1 または 3 で `incompleteDraft` / `validBase` に `noveltyPreference: null` を足して Step 4 を成立させ、Step 9b が触ったパスを Task 1 Files と `git add` に列挙する（最低 `shared/testing/factories.ts`）。

### R-02 — P-02 の ai_control 独立往復

live `ai_control_and_quota.test.sql`:

- `:3` `no_plan()`（触らない。これは閉じた）。
- `:1158–1253` は `selected_only`、novelty 無し、JWT 無し。
- 後続が同じ draft を `p_draft_revision = 1` で予約する。
- 独立ケースの手本は `:1990–2003` および `:3185–3235`（新 owner、`set_config` JWT、`save(0, …)`、新しい idempotency）。

プレースホルダと「直前シナリオの値へ置換」を削除する。完全な `DO` ブロックを本文に貼る。draft `30000000-0000-4000-8000-000000000001` / key `20000000-0000-4000-8000-000000000001` を使わない。14 番目は `'twist'`。

## 4. 偽陽性・Minor・再開しないもの

| 項目 | 裁定 |
| --- | --- |
| GRANT 例の revoke から `authenticated` 欠 | **Minor**。本文が live ロールを正としている。スニペットを live と同じ 4 ロールに直すとより安全 |
| `plan(46)` と任意 `has_column` の `plan(47)` | **Minor**。やるなら数字を 1 つに固定。public 列は persist SELECT でロック済み |
| P-06 スタブが live に無い | **Minor**。`getPlannerDraft` を import し `from().select()` を自作。pin 無しなら session assert は no-op（`session.ts:122`） |
| Task 5 `renderWizardAtReviewStep` | **Minor**。live は `<Harness initialStep="review">` + `getByLabelText` |
| Task 4 ヘルパー名 | **残差**。前回どおり読み替え |
| Task 2 Step 10「Task 1 の typecheck 赤をここで解消」 | R-01 に吸収。残すなら案 B と一致させる |
| PromptPreferences が grep で汚染 | **False positive**。typecheck が正。`expectExactKeys` が保険 |
| E2E が閉じた details | **False positive**。`additionalOpen` 初期 true |
| 13 引数 DROP / reserve 正本 / 単一 commit / radio 混在 / fingerprint | **再開しない** |

## 5. 修正後判定

**REVISE。** Spec は APPROVE のまま。R-01 と R-02 を Plan 本文に埋め込んだら、その 2 点だけの再レビューでよい。実装開始は再 APPROVE のあと。
