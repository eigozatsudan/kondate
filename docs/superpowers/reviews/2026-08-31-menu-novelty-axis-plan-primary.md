# 献立ひねり軸 Implementation Plan — 一次レビュー

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md`
- Spec: `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`
- 実施者: 読み取り専用 Reviewer（独立スレッド）
- 判定: **REVISE — Critical 0、Important 6、Minor 4**

## 1. Verdict

Task 1 を契約・migration・`snapshotRowSchema`・`mapSnapshot` の単一 commit に固定した点、overlay 名が live の `NullableDraftArgs` であること、13 引数 DROP、snapshot 正本が `20260808120000` の reserve INSERT であること、再生成と `PromptPreferences` を触らないことは Spec §3.3 / §8 と live に合う。

一方、Task 1 Step 8 の `db-test` 全 PASS と Task 2 Step 10 の typecheck PASS は、計画本文のままでは成立しない。GRANT / `rls_inventory` / `to_regprocedure` を「変更不要」と書いたこと、pgTAP 貼り付けが live の revision と `no_plan()` に合わないこと、`z.infer` 後の fixture 一括更新がどの Task にも無いこと、E2E が生成成功シナリオではないことが実装開始を止める。

## 2. Critical

なし。計画どおりに安全評価・quota・fingerprint・`validate-generated-menu`・OpenRouter 送信 body が壊れる経路は無い。Task 1 を分割しなければ all-new_menu 422 も中間 commit では出ない。

## 3. Important

### I-1: `rls_inventory` / 03a GRANT 検査を「変更不要」と書いた

計画 Task 1 Step 6: `rls_inventory.test.sql` は列を見ていないため変更不要。`grep novelty\|ingredient_preference` が空であることを確認する。

live:

- `supabase/tests/database/rls_inventory.test.sql:284` は 13 引数の identity 文字列そのもの。`:305–320` で `pg_get_function_identity_arguments` と突合する。
- その grep は空ではない（`p_ingredient_preference`）。
- `03a_pantry_and_planner_drafts_hardening.test.sql:86–88` は `to_regprocedure('public.save_generation_draft(…,jsonb)')`。呼び出しではない。`,null` を足す指示はここには使えない。

14 引数再作成のあと、この 2 本は extra/missing で落ちる。R-01 裁定が Plan に吸収する Minor として挙げた「14 引数 GRANT / `rls_inventory`」が落ちている。

修正: identity に `p_novelty_preference text` を足す。`to_regprocedure` / `has_function` には 14 番目の **型 `text`** を足す。GRANT/REVOKE も 14 引数リストを本文に書く。13 引数 GRANT を CREATE 14 のあとに貼ると `function does not exist` で migrate が止まる。

### I-2: pgTAP 貼り付けが live ファイル状態と食い違う

- `03_pantry_and_planner_drafts.test.sql`: idea の `save(3)` のあと revision は 4。続く `throws_ok` は expected 4 で CHECK 拒否するので revision は 4 のまま。計画の `save(3,…,'twist')` は `draft_revision_conflict`。persist を 4 に直しただけでは、その直後の `throws_ok(4,'wild')` も conflict になり `22023` を見ない。正: persist は 4、wild は 5。
- `ai_control_and_quota.test.sql:3` は `select no_plan();`。「`plan(...)` の数も +1」は誤り。
- 同ファイル 1158–1253 の snapshot 往復は `ingredient_preference = selected_only` で novelty は無い。その直後へ `is(…, 'twist')` を足すと null で落ちる。twist を保存してから予約する専用ケースが要る。

### I-3: Spec §7 の「14 引数の 1 つだけ」がロックされていない

`has_function(…, 14 型配列)` は 14 引数版の存在だけを見る。12 引数 DROP を誤写して 13 引数が残っても通る。overload は計画自身が警告する本番故障であり、Spec §7 が uniqueness を要求している。

修正: 13 引数 `hasnt_function` または `proname = 'save_generation_draft'` の `count(*) = 1`。`plan()` をそれに合わせて増やす。

### I-4: 型再生成コマンドがプレースホルダ、`z.infer` fixture 一括が Task に無い

Step 9 は `grep -n "types" package.json`。正本は `package.json` の `db:types` → `scripts/generate-database-types.sh`（`http://meta:8080/...`）。`docs/local-development.md:57` は `docker compose run --rm app npm run db:types`（`--no-deps` ではない）。

`PlannerDraftInput` / `PlannerSubmission` は `z.infer` 出力型。`.default(null)` でもキーは required。`ingredientPreference: null` を持つ typed literal は factories、emergency、revalidation、wizard/autosave/route テストなどに散在する。Task 2 Files は overlay と persist 面だけ。Step 10 の typecheck PASS は成立しない。

### I-5: Task 1 が「契約テスト PASS / context テスト PASS」と書くが既存 `toEqual` が落ちる

- `shared/contracts/planner.test.ts:40–41`: `parse(incompleteDraft).toEqual(incompleteDraft)`。default がキーを足すと fail。`incompleteDraft` / `validBase` へ `noveltyPreference: null` が要る。
- `generation-context.test.ts:54–70` の共有 `snapshot` に `novelty_preference` が無い。Step 12 は `.nullable()` で default 無し。共有 fixture を直さないと `loadGenerationContext` 全件が `.strict()` で落ちる。`:214` の `submission.toEqual` にも `noveltyPreference` が無い。ヘルパー名は `arrangeLoader` であり、計画の `loadGenerationContextWithSnapshot` ではない。

### I-6: Task 5/6 の radio と E2E 対象ファイルが live と食い違う

live の「材料の使い方」は `<select>`（`review-step.tsx:591–626`）。空 option で `null` に戻せる。wizard テストは `getByLabelText` + `selectOptions`（`planner-wizard.test.tsx:942–960`）。

計画は「同じマークアップ」と言いながら RED と E2E が `getByRole("radio", { name: "ひねりたい" })`、かつ「再押下で null に戻さない」。コピー先を select にするとテストが残赤、radio にすると既存任意軸と違う。

`e2e/specs/menu-domain-pantry.spec.ts` に生成成功パスは無い。「献立を作る」は enabled/disabled の確認だけ。成功見出しまで行くのは `e2e/specs/full-journey.spec.ts:73–90`。Spec §7 の「ひねりたい → generation success」をこのファイル拡張ではロックできない。

## 4. Minor

- M-1: Task 1 `git add supabase/tests/database/`、Task 2/5 `git add src/features/planner/` は無関係 dirty を巻き込む。
- M-2: `planner-wizard.ts` の `PlannerFieldName` / `stepByField`、`ReviewFieldErrors` / `forceAdditionalOpen` が未記載。任意軸なので 422 にはなりにくい。
- M-3: 「rejects `wild`」は実装前でも `.strict()` の unrecognized_keys で throw する。file 全体の RED は他 2 本で足りる。
- M-4: Task 4 の `makeNewMenuContext` 等はプレースホルダ。live は `asNewMenuExecution` / `userPayload` / `systemText`。再生成はヘルパーが無く inline。計画は「既存名へ読み替える」と書いてあるので stall にはしにくい。

## 5. Spec coverage

| Spec | Plan | 穴 |
| --- | --- | --- |
| §3.1 契約 `.default(null)` | Task 1 | 既存 toEqual 未更新（I-5） |
| §3.2 2 テーブル + 3 関数 + GRANT | Task 1 | 14 引数 GRANT 本文と inventory（I-1） |
| §3.3 snapshotRowSchema / mapSnapshot 同一 Task | Task 1 | 単一 commit は正しい |
| §3.4 overlay / select / autosave / route | Task 2 | factories 他の literal（I-4） |
| §4 UI | Task 5 | ウィジェット未固定（I-6） |
| §5 プロンプト / PromptPreferences 禁止 | Task 4 | 方向は正しい |
| §6 辞書 / 完全一致 / alias | Task 3 | 足りる |
| §7 14 引数 uniqueness | Task 1 | GAP（I-3） |
| §7 reserve→snapshot twist | Task 1 | 貼り付けが selected_only 往復に乗る（I-2） |
| §7 E2E success | Task 6 | 対象ファイルが生成しない（I-6） |
| §8 Task 1 単一 commit | Task 1 | 足りる |
| §9 2 パス禁止 | 全体検証 | 足りる |

## 6. Assessment

骨格は実装してよい。GRANT/inventory、pgTAP の live 整合、fixture/typecheck、UI/E2E の 4 系統を Plan に埋めるまで実装開始はしない。
