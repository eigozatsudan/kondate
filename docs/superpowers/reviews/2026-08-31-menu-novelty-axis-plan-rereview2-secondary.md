# 献立ひねり軸 Implementation Plan — 再々レビュー（二次）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `6455863a`
- 一次・敵対的とは独立。live 照合。
- 判定: **REVISE。R-01 / R-02 は配置と形だけ Closed。実行ゲートは開いたまま。**

## 確認して閉じたもの

- overlay は Task 1 Step 9c。Task 2 は読み取りと保持。開始時 typecheck 緑のはず、という宣言は正しい方向。
- Step 1 の `incompleteDraft` 更新。`planner.test.ts:40-41` の `toEqual` は `.strict()` + `.default(null)` のあとキー必須。
- Step 14 `git add` に factories / `database.ts` / `planner-api.ts`。`git status --short` 前後。
- ai_control は `:1158` selected_only に足さない。JWT `set_config`、`save(0)`、`reserve` 20 引数は live `:1995` / `:3223` と一致。
- snapshot RPC は `security definer`、`p_user_id` 照合、GRANT は `service_role`。このファイルは postgres で既存 `:1230` が DO 外から呼んでいる。`select is` の位置は JWT ローカル性では壊れない。
- GRANT 4 ロール、`plan(47)`、`03_pantry` revision 4（162 行 idea 保存のあと throws_ok は revision を進めない）。

## まだ開いているもの

### R-01 — Step 9b の PASS が 9c より前

live `database.generated.ts` の Args は nullable text を `string` 必須にする。live overlay `database.ts:20-37` は `p_ingredient_preference` まで。regen 直後 `SaveDraftArgs` に `p_novelty_preference: string` が載る。

`buildSaveGenerationDraftArgs`（`planner-api.ts:64-82`）と `database.test.ts:119-164` は欠キーで赤。9b は「全部へ `noveltyPreference: null`、typecheck PASS」。9c は「それは直らない」。同じ Task 内で矛盾している。

Task 1 `Files:`（計画 `:68-77`）は overlay / factories / `planner-api` をまだ書いていない。ステップ本文と `git add` にはある。

Step 13 は「9b で全体を緑」「`noveltyPreference: null` で planner-api を緑、配線は Task 2」。9c のあとでは偽。

### R-01 派生 — コピー関数へ定数 null

typed `PlannerDraftInput` を返す live:

- `planner-route.tsx:95-108` `emptyDraft`（ここは null で正しい）
- `planner-route.tsx:135-149` `toPlannerDraftInput`
- `planner-route.tsx:1768-1780` `submissionCandidate`
- `use-draft-autosave.ts:66-80` `toDraftInputFields`

9b はエラー箇所すべてへ null。hydrate / persist / submit が twist を潰す。Task 2 Step 6 は同じキーを「足す」。重複は TS1117、スキップは wipe 出荷。リポジトリに `no-dupe-keys` は無いが TS は重複プロパティを落とす。スキップ経路が本番バグ。

### R-02 — UUID 帯 `f7` は使用済み

`$pantry_recheck$` live `:3663` owner `…f7`、`:3756` idempotency `3000…f7`。使用済み: f5 idea_finalize、f6 fp_mismatch、f7/f8 pantry_recheck。`repeat('f',64)` は `:1092` だがその request は `:1096` で削除。HMAC 衝突は不成立。owner/idempotency は成立。

「衝突しない前提」「衝突したら grep」は貼り付け成果物が実行不能なことの言い換え。

### P-06 — 既存スタブは無い

`planner-api.test.ts` は `clientWithRpc` と `incompleteTargetDraft` と keepalive の `toEqual` だけ。`from(` / `select(` / `makeBrowserClientStub` / `getPlannerDraft` import はゼロ。select 列ロックの要求自体は残すべき。ヘルパーが有るという文は削除すべき。

## 二次として一次へ足すもの

一次が 9b/9c 順と UUID と P-06 を上げるなら同意。コピー関数への null は独立に残す。git add サンドウィッチだけでは 9b PASS の嘘を消さない。
