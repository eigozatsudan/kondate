# 献立ひねり軸 実装 一次レビュー

- Date: 2026-09-01
- Range: 039c01a6..24234683
- Reviewer: primary

## Spec Compliance

- verdict: PASS
- Missing: なし。Tasks 1–6（契約+migration+snapshot 読み取りの単一 commit、下書き読み戻し、定番辞書、new_menu プロンプト、確認画面 UI、E2E）は揃っている。
- Extra: `vite.config.ts` の `edgeFunctions: { enabled: false }`（commit `a11f6273`）。計画外だがローカル Vite が Deno Edge Functions で落ちる既知障害の修正で、本番 Netlify ランタイムとは別経路。`tests/tooling/project-config.test.mjs` で固定している。機能退行ではない。
- Misunderstood: なし。フィールド見出し「献立の雰囲気」はコンポーネント直書きだが、計画 Task 5 の JSX スニペットおよび既存「材料の使い方」と同じ形。選択肢文言は `planner-labels.ts` に置いてある。
- pgTAP `plan(48)` は計画文面の `plan(47)` より 1 多い。`public.generation_drafts` と `private.generation_draft_submission_versions` の両方に `has_column` を足しており、仕様 §7 の「2 テーブルの列 check」に合う正当な増分。

## Strengths

- Task 1 を単一 commit（`20263505`）に閉じ、`.strict()` の `plannerSubmissionSchema`・RPC 新列・`mapSnapshot` を同時に通している。F-01 / F-03 / R-01 の 422 全面落ちを構造的に避けた。
- `noveltyPreference` は `PromptPreferences` に足さず、`recentDishHints` と同じ new_menu 分岐だけで段落と `noveltyExcludedDishes` を注入している。再生成不変の回帰テストがある。
- 定番辞書は Functions 専用。照合は `normalizeFoodText` の完全一致 + alias 列挙。未収録は空配列で fail-open。kill-switch off は段落とキーを両方落とす。
- 永続面は overlay（`p_novelty_preference | null`）、select 列ロック、autosave 空判定、route の写経、履歴引き継ぎまで `ingredientPreference` と同型。
- DROP は現行 13 引数、CREATE/GRANT/pgTAP/`to_regprocedure`/GRANT 台帳は 14 引数。overload 数を直接数えるアサートと snapshot 往復（`reserve` → `get_ai_generation_submission_snapshot` が `twist`）がある。
- UI は既存 `.field select`（`min-height: 48px`、`width: 100%`）。option 値は契約 enum と一致。

## Issues

### Critical

なし

### Important

なし

### Minor

- ID: P1
- File: `netlify/functions/_shared/generation-prompt.ts:243-246` および `:499-502`
- What's wrong: `buildNewMenuSystemPrompt` と `buildGenerationMessages` の案内コメントが、実際の合成（`coreBody + diversity + novelty + SEASON + modeExtra`、twist 時だけ user に `noveltyExcludedDishes`）をまだ「多様性 + SEASON」のまま書いている。
- Why it matters: 再生成と new_menu の差、kill-switch、ひねりの挿入位置を後から読むときの誤誘導になる。挙動そのものはコードとテストが正。
- How to fix: コメントを実装に合わせて「多様性? + ひねり? + SEASON」と書く。
- Failure path: なし（実行時不具合ではない）。保守時に再生成へ novelty を誤って足す、または new_menu から落とす変更を誘発し得る。

### Nit

- `snapshotRowSchema` が `noveltyPreferences` を import せず `z.enum(["standard", "twist"])` を直書きしている。`ingredient_preference` と同じ既存パターン。
- 確認画面テストは controlled `<select>` の DOM 値で draft 反映を見ており、計画文面の `latestDraftValue().noveltyPreference` ヘルパーは使っていない。制御コンポーネントなので同等。
- 生成型 `get_ai_generation_submission_snapshot.Returns.novelty_preference` は非 null `string` のまま。overlay は `servings` だけ null 復元。`ingredient_preference` と同型で、実行時は `snapshotRowSchema.nullable()` が読む。

## Checks performed

- `plannerSubmissionSchema` は両枝 `.strict()`。`mapSnapshot` は `noveltyPreference: row.novelty_preference` を渡し、契約側にも同キーがある。`standard` / `twist` / `null` の round-trip テストあり。キー欠落は `.default(null)`。未更新契約へキーを足して unrecognized_keys になる経路は閉じている。
- `save_generation_draft`: DROP は 13 引数 `(..., jsonb)`。CREATE は 14 番目 `p_novelty_preference text`。GRANT/revoke も 14 引数。pgTAP の positional / `has_function` 型配列 / `to_regprocedure` / `rls_inventory` 台帳を 14 引数へ更新。overload 数 = 1 をアサート。現行テスト SQL に 13 引数呼び出しは残っていない（履歴 migration は対象外）。
- Overlay: `NullableDraftArgs` と `SaveDraftArgs` に `p_novelty_preference | null`。`buildSaveGenerationDraftArgs` が `input.noveltyPreference` を渡す。`database.test.ts` の `satisfies SaveDraftArgs` が `null` を通す。生成型 Args は非 null `string` のまま（Meta の既知の誤り）で、overlay が復元している。
- Fingerprint / quota / `validate-generated-menu` / ハードゲート: `shared/safety` と `validate-generated-menu` に novelty 参照なし。`createCurrentSafetyFingerprint` は `CurrentSafetyContext` のみ。quota SQL は snapshot 往復テストを足しただけで判定入力には使っていない。
- 再生成 / `PromptPreferences`: 型に novelty フィールドなし。`buildBaseGenerationMessages` は明示フィールドだけをコピー。`buildSystemPrompt`（再生成）は未変更。user 注入は `kind === "new_menu"` のみ。再生成 payload に `noveltyExcludedDishes` / `noveltyPreference` が無いテストあり。
- 定番辞書: `netlify/functions/_shared/staple-dish-catalog.ts` のみ。import は `generation-prompt.ts` と辞書テスト。`shared/` 経由のブラウザ import なし。`normalizeFoodText` を Functions から読むのは所有境界どおり。
- Kill-switch: `noveltyEnabled = readNoveltyHintsEnabledFlag() && noveltyPreference === "twist"`。false なら段落もキーも出さない。`generation-prompt-novelty-off.test.ts` が twist 選択でも両方消えることを固定。辞書ミス時は段落残り + `noveltyExcludedDishes: []`。
- UI: option 値 `"standard"` / `"twist"` / `""` → `null`。ラベルは `noveltyPreferenceLabels` / `noveltyPreferenceLabel(null)`（「いつもの」「ひねりたい（主菜を定番から外す）」「指定なし」）。契約 enum と一致。
- E2E: `postData.includes('"p_novelty_preference":"twist"')`。keepalive は `JSON.stringify(buildSaveGenerationDraftArgs(...))`、supabase-js RPC も default `JSON.stringify`（コロン後ろに空白なし）。matcher は実 JSON と一致する。`waitForResponse` は `selectOption` より前に張っている。
- Vite `edgeFunctions: { enabled: false }`: 計画外 Extra。コメントどおりローカル Deno クラッシュ回避。リポジトリに `netlify/edge-functions` は無い。本番 Functions には触れない。
- Migration 正本: `save_generation_draft` は `20260730120000` 本体 + 検証句/列。`reserve_ai_generation` は `20260808120000` の INSERT へ `novelty_preference` / `v_draft.novelty_preference` を追加（それ以降に reserve を再定義する migration は本変更まで無い）。snapshot 関数は DROP `(uuid, uuid)` のあと RETURNS TABLE / SELECT に列追加。grant は元ファイルと同じロール。
- 後方互換: 列は NULL 可。契約 `.default(null)`。空下書き初期値は定数 `null`。写経 3 箇所（autosave / hydrate / submit）は値コピー。ひねりだけの下書きは空判定から除外。
- `openrouter.ts` は本 range の変更ファイルに含まれない（temperature 非送信を維持）。

## Assessment

- Ready to merge: Yes
- Reasoning: 契約・14 引数 RPC・snapshot 読み取り・プロンプト注入・所有境界・再生成非接触が仕様どおりで、named risk の 422 / overload / リークはコード上閉じている。残るのは案内コメントの陳腐化と計画外のローカル Vite 修正だけで、マージを止める欠陥はない。
