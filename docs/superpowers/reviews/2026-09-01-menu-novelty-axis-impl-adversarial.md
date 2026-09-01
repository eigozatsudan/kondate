# 献立ひねり軸 実装 敵対的レビュー

- Date: 2026-09-01
- Range: 039c01a6..24234683
- Reviewer: adversarial

## Summary

Minor+ 候補なし。契約・14 引数 RPC・snapshot 写経・`.strict()` の mapSnapshot、kill-switch、再生成非注入、fingerprint/quota/validate 非入力、定番照合の正規化後完全一致、Vite edgeFunctions 無効化はいずれも実装と spec/plan が揃っており、new_menu 全体 422 や GRANT 抜け、twist の静かな null 化といった本計画の既知失敗モードはコード上閉じていた。残るのは文言の強さ・テスト名の言語・コメントの陳腐化といった Nit のみ。

## Candidates

Minor+ 候補なし

### A1
- Severity: Nit
- File: src/features/planner/model/planner-labels.ts:36
- Failure path: 確認画面の option 文言が「ひねりたい（主菜を定番から外す）」で、fail-open（定番を返してよい）より強い約束に読める。コードコメントは保証しないと書いてあるが、利用者向けヒントは無い。
- Evidence: `noveltyPreferenceLabels.twist` が plan Task 5 の指定どおり。`NOVELTY_PARAGRAPH` は「ひねりだけを理由に constraint_conflict にしない」と明記。材料の使い方には hint 段落があるが、ひねり軸には無い。アレルギー「安全」保証ではない。
- How to confirm: 320px の確認画面で option を開き、利用者が「定番は出ない」と読むか、隣の材料の使い方 hint の有無と比較する。
- In scope: yes
- Why it matters: 効きが弱いとき（spec §9）に期待外れになる。安全保証リークではない。

### A2
- Severity: Nit
- File: src/features/planner/use-draft-autosave.test.tsx:36
- Failure path: テスト名が日本語。AGENTS.md はテスト名を英語と定める。挙動自体は twist 単独保存を見ている。
- Evidence: `it("ひねりだけを選んだ下書きも空扱いにせず保存する", ...)`。plan の sample は English。
- How to confirm: 同ファイルの他テスト名が英語であるか目視。
- In scope: yes
- Why it matters: 規約逸脱。機能欠陥ではない。

### A3
- Severity: Nit
- File: supabase/tests/database/ai_control_and_quota.test.sql:1992 / netlify/functions/_shared/generation-prompt.ts:245
- Failure path: コメントが実装とずれる。canonical ブロックは「最終 13 引数」のまま。`buildNewMenuSystemPrompt` の JSDoc は DIVERSITY + SEASON だけで novelty を書いていない。
- Evidence: 呼び出しは 14 引数（末尾 `,null`）。本体は `${coreBody}${diversity}${novelty}${SEASON}${modeExtra}`。
- How to confirm: 当該コメントと直下の実装を並べて読む。
- In scope: yes
- Why it matters: 次の RPC 拡張で DROP シグネチャを取り違える誘因。現行動作は壊さない。

## Named-risk checks

1. Malicious / unexpected `noveltyPreference` payloads
   Inspected: `shared/contracts/planner.ts` の draft/submission 両枝 `.strict()` + `z.enum(["standard","twist"]).nullable().default(null)`。未知値 `"wild"` は契約テストと RPC `22023 invalid_draft_save` と CHECK で拒否。配列・オブジェクトは enum で落ちる。SQL は bound パラメータ。keepalive も `buildSaveGenerationDraftArgs` 経由。余剰キーは `.strict()` で 422。欠損キーは `.default(null)`。

2. RPC 14th argument / DROP leftover / GRANT / positional 13 args / null vs absent
   Inspected: migration は 13 引数 DROP のあと 14 引数 CREATE。`pg_proc` 本数を 1 にする pgTAP あり。hardening の `to_regprocedure(...jsonb,text)` と rls_inventory GRANT 台帳を 14 引数へ更新。`ai_control_and_quota.test.sql` の既存 positional 呼び出しは末尾 `,null` を足し、f9 帯で snapshot 往復を追加。`reserve_ai_generation` の INSERT に `v_draft.novelty_preference`。snapshot RPC は DROP `(uuid,uuid)` のあと RETURNS TABLE へ列追加し service_role GRANT。`snapshotRowSchema` は `.nullable()` 必須キー（`.optional()` なし）。既存の `ingredient_preference` / `budget_preference` と同型なので、PostgREST が null 列を省略するなら導入前から new_menu が死ぬ。現行はそのパターンで生きている。

3. `.strict()` mapSnapshot extra key → 422 for all new_menu
   Inspected: `submissionCommonShape` に `noveltyPreference` を追加し、`mapSnapshot` が `noveltyPreference: row.novelty_preference` を渡す。`loadGenerationContext` の round-trip テストが standard/twist/null を通す。契約と mapSnapshot は同一 commit `20263505`。

4. Race: review select vs autosave vs generate; E2E quoting
   Inspected: generate は `value.noveltyPreference` を submissionCandidate に写し、既存 `flushAutosave` が latest を書く。E2E は `waitForResponse` を `selectOption` より先に張り、`JSON.stringify` と同型の `"p_novelty_preference":"twist"` を見る。keepalive テストが同じキー名で body を固定。debounce 600ms は wait が吸収。pending pin 中に flush が live を返す挙動は既存の再開契約。

5. Regeneration / history-from-menu / draft-from-menu
   Inspected: `PromptPreferences` に novelty を足していない。注入は `kind === "new_menu"` のみ。再生成テストは system マーカーも user の `noveltyExcludedDishes` / `noveltyPreference` も無いことを見る。`createPlannerDraftFromMenu` は `submission.noveltyPreference` を写す（spec §4）。`preferenceSnapshot: { submission, ... }` に full PlannerSubmission が入るので履歴コピーの入力は残る。再生成は保存済み submission を持っても prompt には出さない。revalidation / emergency は `noveltyPreference: null` の合成 submission。結果画面にひねり表示は無い。

6. Prompt injection via household/pantry × novelty; staple matching
   Inspected: 段落は静的定数で利用者文字列を埋め込まない。除外リストは `STAPLE_DISH_CATALOG` の料理名。照合は `normalizeFoodText` 後の `Set.has`（完全一致）。`src/` から catalog を import していない。括弧付き入力（`豚肉（国産）` → `豚肉国産`）はヒットせず fail-open。spec §6 の意図。

7. Kill-switch; empty catalog still claims exclusion
   Inspected: off 専用テストが段落マーカーと `noveltyExcludedDishes` キーの両方欠落を見る。twist + 未収録食材は段落あり・キーは `[]`。spec §6 の縮退。空配列への「使うな」指示は空集合で真空的。

8. Leak into fingerprint / quota / validate-generated-menu / hard gates / logs / quality-review / emergency
   Inspected: `shared/safety/fingerprint.ts` は `CurrentSafetyContext` のみ。`validate-generated-menu.ts` は mealType/cuisine/time/main/avoid/pantry/servings/targetMembers のみで novelty 非参照。preflight issue リスト非変更。`openrouter.ts` は本 diff に無い。quality-review / emergency / factories は型波及の `null`。`collectPlannerRequestText` は main/avoid/memo のみ。`preference_snapshot` への保存は履歴コピー用で safety_fingerprint には入らない。

9. RLS / ownership
   Inspected: RLS ポリシー変更なし。列追加のみ。`save_generation_draft` GRANT は authenticated のみ（revoke に public/anon/authenticated/service_role）。snapshot / reserve は service_role。他ユーザーが下書き novelty を読む経路はこの diff では増えていない。

10. Browser importing `@shared/safety` or staple catalog
    Inspected: `src/` の import は `@shared/safety-pure/*` のみ。`staple-dish-catalog` は `netlify/functions/_shared/` のみ。

11. UI: unlabeled select, values, 44px, 320px, safety copy
    Inspected: wrapping `<label className="field">献立の雰囲気`。値は `standard` / `twist` / `""`→null。`.field select` は `min-height: 48px`。既存の長い ingredient option より短い。wizard テストがラベル取得と option 文言を固定。安全保証コピーではない（A1 の効き文言は Nit）。

12. Vite `edgeFunctions: { enabled: false }`
    Inspected: `vite.config.ts` の `@netlify/vite-plugin` のみ。コメントどおり `netlify/edge-functions` ディレクトリは無い。`netlify.toml` の functions は `netlify/functions`。本番 Edge 無効化ではない。ローカル Deno `--allow-scripts` 落ちの修正。project-config テストがフラグ文字列を固定。

## Notes

- spec §5.1 は DIVERSITY 直後への挿入、§5.2 は「2 の内側・履歴より上位に置かない」。実装/plan は `diversity + novelty + season`。履歴より文書上後ろなので「上位に置かない」とは両立し、判定対象にしない。
- `get_ai_generation_submission_snapshot` の generated Returns は `novelty_preference: string`（非 null）。`ingredient_preference` と同じ Meta の癖。実行時は Zod `.nullable()`。overlay 対象外。
- audience-step の `noveltyPreference: null` は `...value` より前のダミー。mode 変更は audience 3 フィールドだけを `onChange` する。wipe ではない。
- 判定者は A1–A3 を Nit のまま扱うこと。効きの弱さ（辞書網羅）は spec §9 の既知残件であり、本実装の欠陥としては挙げない。
