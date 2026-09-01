# 献立ひねり軸 実装 二次レビュー（偽陽性チェック）

- Date: 2026-09-01
- Range: 039c01a6..24234683
- Reviewer: secondary / finding-adjudicator

## Verdicts

### P1
- 判定: 成立
- 最終 severity: Nit（一次の Minor から下げた。実行時失敗経路は一次自身が「なし」と書いており、静的に確認しても無い）
- 根拠: `netlify/functions/_shared/generation-prompt.ts:243-246`（`buildNewMenuSystemPrompt` の案内が「CORE_BODY + (flag on なら DIVERSITY) + SEASON + mode extra」のまま）、同ファイル `:499-502`（`buildGenerationMessages` の new_menu 案内が「CORE_BODY + 多様性? + SEASON + idea?」のまま）。実装は `:254-260` が `${coreBody}${diversity}${novelty}${GENERATION_SYSTEM_PROMPT_SEASON}${modeExtra}`、`:518-542` が twist かつ flag on のときだけ `noveltyExcludedDishes` を載せる。
- 失敗経路の反証または確認: 実行時不具合は無い。コメントと合成式の不一致は静的に確認できる。誘発し得る将来の誤編集は仮説であり、現行の new_menu / 再生成分岐とテストが正。Minor に足る失敗経路は無い。

### P-N1
- 判定: 棄却
- 最終 severity: （対象外）
- 根拠: `netlify/functions/_shared/generation-context.ts:76` は `z.enum(["standard", "twist"]).nullable()`。これは spec §3.3 と plan Task 1 Step 12 が指定したリテラルそのもの。`:75` の `ingredient_preference` と同じ既存パターン。契約側 `shared/contracts/planner.ts:18,103,140` の `noveltyPreferences` とは別層。
- 失敗経路の反証または確認: 直書きは仕様どおりの実装であり、欠陥経路ではない。enum ドリフトは未発生の仮説。

### P-N2
- 判定: 棄却
- 最終 severity: （対象外）
- 根拠: `src/features/planner/components/planner-wizard.test.tsx:999-1005` は controlled `<select>` の DOM 値を見る。同ファイルの「材料の使い方」テスト `:962-969` と同一手法。plan Task 5 は sample に `latestDraftValue()` を書きつつ、「既存の『材料の使い方』テストが同じ `<select>` を扱っているので、その取得方法をそのまま真似ること」（plan 1180 行付近）と指示している。当該ヘルパーは同ファイルに存在しない。`review-step.tsx:641-653` は `value={value.noveltyPreference ?? ""}` と `onChange` で親 draft を更新する制御コンポーネント。
- 失敗経路の反証または確認: `selectOptions` 後に DOM が `"twist"` のまま残るのは親 state 更新が起きたときに限る。計画指示どおり既存テストを真似ており、draft 非反映の抜けは無い。

### P-N3
- 判定: 成立
- 最終 severity: Nit
- 根拠: `src/shared/types/database.generated.ts:2951` の `get_ai_generation_submission_snapshot.Returns.novelty_preference` は非 null `string`。overlay `src/shared/types/database.ts:139-141` は `servings` だけ null 復元。`ingredient_preference` も生成 Returns では非 null `string`（`:2947`）。実行時は `generation-context.ts:76` の `.nullable()` と `:284` の `snapshotRowSchema.safeParse` が読む。
- 失敗経路の反証または確認: 実行時の null 行は Zod が受け、new_menu 422 にはならない。型の不正確さは Meta の既存癖の踏襲。spec §3.4 の overlay 対象は `p_*` Args であり snapshot Returns は対象外。失敗経路は無いが、生成型と実行時 null の食い違いは静的に存在する。

### A1
- 判定: 成立
- 最終 severity: Nit
- 根拠: `src/features/planner/model/planner-labels.ts:36` の option が「ひねりたい（主菜を定番から外す）」。開発者コメント `:32` は保証しないと書くが利用者向けではない。`netlify/functions/_shared/novelty-hints.ts:21-22` の `NOVELTY_PARAGRAPH` は定番返却を明示する fail-open。`review-step.tsx:630-632` に材料の使い方 hint がある一方、`:638-660` のひねり `<select>` には hint / `aria-describedby` が無い。plan Task 5 の JSX スニペットも hint 無しでこの option 文言を指定している。
- 失敗経路の反証または確認: 安全保証リークではない。効きの弱さは spec §9 の既知残件。文言が fail-open より強く読める点は静的に確認できる。実行時の誤誘導を利用者テスト無しで証明はできないが、欠陥の本体はコピー強度であり Nit のまま据える。

### A2
- 判定: 成立
- 最終 severity: Nit
- 根拠: `src/features/planner/use-draft-autosave.test.tsx:46` が `it("ひねりだけを選んだ下書きも空扱いにせず保存する", ...)`。AGENTS.md はテスト名を英語と定める。plan Global Constraints も「識別子とテスト名は英語」。同 Task の sample は `it("saves a draft whose only filled field is the novelty preference", ...)`（plan 641 行付近）。挙動アサート自体は twist 単独保存を見ており正しい。
- 失敗経路の反証または確認: 機能欠陥ではない。同ファイルの既存テスト名も日本語が多く、ファイル内一貫性はあるが、新規テストは plan sample と AGENTS.md の英語規則に反する。規約逸脱は静的に成立。

### A3
- 判定: 成立
- 最終 severity: Nit
- 根拠: `supabase/tests/database/ai_control_and_quota.test.sql:1992` が「最終 13 引数」のまま。直下 `:1993-1994` の `save_generation_draft(...)` は末尾 `,null` を含む 14 引数。`netlify/functions/_shared/generation-prompt.ts:243-246` は P1 と同じ `buildNewMenuSystemPrompt` 案内コメント。
- 失敗経路の反証または確認: 現行呼び出しは 14 引数で通る。コメントが DROP シグネチャ取り違えの誘因になり得る、という保守リスクだけ。実行時失敗は無い。

## Overlaps

P1 vs A3: partial

共有指紋は `generation-prompt.ts:243-246` の `buildNewMenuSystemPrompt` JSDoc。P1 だけが同ファイル `:499-502` の `buildGenerationMessages` 案内を含む。A3 だけが `ai_control_and_quota.test.sql:1992` の「最終 13 引数」を含む。

## New candidates from deep-dive

NEW-1: `src/features/planner/components/review-step.tsx:192-193` のコンポーネント案内コメントが任意条件の列挙に「献立の雰囲気」を足していない（A1 で review-step を辿ったときに表面化）。実行時非影響。未判定。

## Merge-blocking defect missed by both

なし

## Counts

- 成立 Minor+: 0
- 成立 Nit: 5
- 棄却: 2
- 未確定: 0
