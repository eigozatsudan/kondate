# 献立ひねり軸 Implementation Plan — 再々レビュー裁定（6455863a）

- 日付: 2026-08-31
- 裁定者: 親エージェント
- 対象: 再々レビュー一次・二次・敵対的、親の live 再照合
- 最終判定: **REVISE。Critical 0。案 A の Task 配置と ai_control DO の骨格は入った。残 Important は 3 系統（9b/9c の PASS 順とコピー関数、UUID `…f7`、P-06 スタブ禁止）。実装開始は禁止。**

## 1. 裁定方法

`6455863a` の計画本文だけを、前回裁定の R-01 / R-02 と live へ当てた。Spec は触っていないので製品判断は再開しない。一次・二次・敵対的は独立。親は overlay、`buildSaveGenerationDraftArgs`、`planner-api.test.ts`、`toDraftInputFields`、`emptyDraft` / `toPlannerDraftInput` / `submissionCandidate`、`ai_control` の f5–f8、GRANT、`plan(43)`、snapshot RPC の GRANT と `auth.uid()` を再読した。

## 2. 前回残件

| ID | 裁定 | 理由 |
| --- | --- | --- |
| R-01 案 A 配置 | **Closed** | overlay と RPC 送信引数と Args fixture は Task 1 Step 9c。Task 2 overlay RED は無い。`incompleteDraft` は Step 1。Step 14 は factories + overlay パス + status sandwich |
| R-01 実行ゲート | **Open** | Step 9b が 9c より前に typecheck 全 PASS を書く。9c は「`noveltyPreference: null` では直らない」と自分で言っている。Step 13 は「9b で緑」「配線は Task 2」のまま |
| R-02 DO 骨格 | **Closed** | 自己完結、JWT、`save(0,…,'twist')`、専用キー、`reserve` 20 引数は live `:1995` / idea_finalize `:3223` と一致。`:1158` 非接触。禁止 UUID `3000…0001` 不使用 |
| R-02 貼り付け | **Open** | `…f7` は live `$pantry_recheck$` `:3663` / `:3756`。衝突確認コマンドは escape hatch であり、スニペットは実行不能 |
| GRANT Minor | **Closed** | live 4 ロールと一致 |
| plan(47) Minor | **Closed** | `plan(43)` + persist `is` + `throws_ok` + overload `is` + `has_column`。bare save は TAP ではない |
| P-06 要求 | **Closed のまま** | select 文字列ロックは残っている |
| P-06 実行文 | **新規 Open** | 「自作しない、既存スタブを再利用」は live にそのスタブが無い。前回 Minor を閉じようとして偽の禁止になった |

二次の Critical 相当の言い方は使わない。残件は Task GREEN の嘘と db-test unique と GET テスト不能であり、all-new_menu 422 や安全破壊ではない。

## 3. 残 Important（Plan へ書くこと）

### R-01 — 9b/9c を一つの緑ゲートにし、コピーは null 固定しない

live:

- 生成 Args は `p_ingredient_preference: string` と同型。regen 後 `p_novelty_preference: string` 必須。
- overlay `NullableDraftArgs`（`database.ts:20-37`）が `| null` を復元するまで、`buildSaveGenerationDraftArgs` と `database.test.ts` の `satisfies SaveDraftArgs` は欠キーで赤。
- `emptyDraft`（`planner-route.tsx:95`）は初期値なので `null` でよい。
- `toPlannerDraftInput`（`:135`）、`submissionCandidate`（`:1768`）、`toDraftInputFields`（`use-draft-autosave.ts:66`）は値を写す関数である。ここに 9b が `noveltyPreference: null` を植えると hydrate / persist / submit が twist を潰す。
- Task 2 Step 6 は同じキーを「足す」。重複は TS1117。キーがあるからスキップすると定数 null が残る。

Plan が書くこと:

1. Step 9（`db:types`）の直後に現行 9c（overlay + `p_novelty_preference: input.noveltyPreference` + Args fixture）。
2. そのあと現行 9b（z.infer リテラルと factories）。typecheck 全 PASS は overlay 後に一度だけ。
3. 9b の処方を分ける: フィクスチャと `emptyDraft` は `noveltyPreference: null`。コピー関数は `ingredientPreference` と同じく `value.noveltyPreference` / `draft.noveltyPreference`。
4. Task 2 は「キーが既にあれば足さない。定数 null なら写経へ置き換える」。残作業は select 列、`mapPlannerDraft`、空判定。
5. Step 13 の「9b で全体が緑」「`noveltyPreference: null` で planner-api を緑、配線は Task 2」を削除。Task 1 `Files:` に `database.ts` / `database.test.ts` / `planner-api.ts` / `factories.ts` を足す。

### R-02 — UUID 帯を未使用のものへ固定

live `ai_control_and_quota.test.sql` の使用済み: f5（idea_finalize）、f6（fp_mismatch）、f7/f8（pantry_recheck）。`auth.users.id` と `(user_id, idempotency_key)` が unique。

本文の owner / idempotency / `select is` のキーを、そのファイルに無い帯へ書き換える（例: `…f9`）。「衝突しない前提」「衝突したら grep」は削除する。貼る位置は `$idea_finalize$` **ブロック終端**の後ろ（行 3185 の直後ではない）。

`repeat('f',64)` は `:1092` の request が削除されるので unique にはならない。変えなくてよい。

### R-03 — P-06 はスタブを自作してよい

live `planner-api.test.ts` は `clientWithRpc` と `incompleteTargetDraft` だけ。`getPlannerDraft` 未 import。`from().select()` チェーンも `makeBrowserClientStub` も無い。pin 無しなら `assertBrowserDataPlaneAligned` は no-op（`session.ts:122`）。

「スタブのチェーンを自作しない」を撤回する。`getPlannerDraft` を import し、`from().select().eq().maybeSingle()` をこのファイルへ最小限足し、`select` 引数だけ観測する。既存ヘルパー名へ読み替える、でよい。select 文字列ロック自体は残す。

## 4. 偽陽性・Minor・再開しないもの

| 項目 | 裁定 |
| --- | --- |
| JWT が DO 内、`select is` が DO 外 | **False positive**。snapshot は `p_user_id`。既存 `:1230` が同じ呼び方 |
| HMAC `repeat('f',64)` unique | **False positive**。`:1092` は直後 delete。unique は idempotency |
| Task 1 Files 欠で 9c スキップ | **Minor**。全文抽出が正。Files ヘッダは直した方がよい |
| Step 1 の `incompleteDraft` 更新 | **Closed**。既存 toEqual の RED は Step 2 の期待と一致 |
| snapshot 列が migrate 前 | **False positive**。Step 8 が migrate してから db-test |
| `03_pantry` revision 4 | **Closed**。throws_ok は revision を進めない |
| `reserve` 引数ずれ | **False positive**。20 引数は live canonical / idea_finalize と一致 |
| GRANT / plan(47) | **Closed** |
| 安全 / quota / HMAC 入力 / PromptPreferences / 2-pass / temperature / 漢字畳み / radio / 13 引数 DROP / reserve 正本 | **再開しない** |

## 5. 修正後判定

**REVISE。** Spec は APPROVE のまま。R-01 の実行順とコピー関数、R-02 の UUID 帯、R-03（P-06 スタブ）を Plan 本文に埋め込んだら、その 3 点だけの再レビューでよい。実装開始は再 APPROVE のあと。
