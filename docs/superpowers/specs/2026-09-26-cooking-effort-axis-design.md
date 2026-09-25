# 「手間のかかる料理は避ける」軸（effortPreference）設計

- 日付: 2026-09-26
- 状態: **人間レビュー待ち**
- 対象: planner draft / submission 契約、`generation_drafts` と submission snapshot、献立ウィザードと
  確認画面、new_menu と再生成の system/payload、週献立の契約・snapshot・プロンプト・フォーム
- 種別: 任意入力軸の追加。**安全評価・quota・fingerprint・検証には一切触れない**
- 先行事例: `2026-08-31-menu-novelty-axis-design.md`（`noveltyPreference`）。本設計は同じ経路をなぞり、
  差分だけを明記する。

---

## 1. 結論

献立生成に任意軸 `effortPreference`（`standard` / `easy` / 未指定）を 1 本追加する。`easy` のときだけ
system プロンプトへ【手間】段落を載せ、揚げ物・蒸し物など手間のかかる料理を避けるようモデルへ依頼する。

段落は既存の `DIVERSITY_PARAGRAPH` / `NOVELTY_PARAGRAPH` と同じ **prompt 専用・fail-open** の規約に
従う。避けきれない場合でもモデルは `outcome=success` を返してよく、この軸だけを理由に
`constraint_conflict` にしてはならない。生成後の料理名・手順の検査（キーワードによる弾き）は行わない。

ひねり軸との違いは次の 2 点だけである。

1. **再生成（`regenerate_menu` / `regenerate_dish`）にも効く。** 段落は new_menu 専用の組み立てではなく、
   再生成と共用の system 組み立てに置く。値は共用の `preferences` payload に載せる。作り直した結果に
   揚げ物が出ると、この軸を選んだ意味が失われるためである。
2. **全役割（main / side / soup / staple）にかかる。** ひねりは main 限定だったが、手間は献立全体の
   負担で決まる。

## 2. 目的と対象外

### 2.1 目的

「平日の夜に揚げ物や蒸し物は作りたくない」という利用者が、調理法を避ける意図を 1 タップで伝えられる
ようにする。既存の `timeLimitMinutes`（15/30/45 分以内）は所要時間しか縛らない。油の処理、蒸し器の準備、
包む・巻く工程など、**時間に表れにくい面倒さ**は既存軸では表現できない。

既存の【家庭キッチン】段落（`household-kitchen-prompt.ts`）は「蒸し器・オーブンなど専用器具を前提に
しない」という**器具**の方針である。蒸し料理そのもの（ふた付きフライパンで蒸す、など）は避けない。
本軸は**料理の選び方**の方針であり、役割が重ならない。

### 2.2 対象外

- 生成後の検証・再試行（料理名や手順のキーワード検査）。誤判定（「唐揚げ風焼き」など）と試行予算の
  消費を避けるためである。
- 献立結果画面・週献立結果画面での注記表示。入力側のみを対象にする。
- 調理法ごとの個別選択（揚げ物のみ、蒸し物のみ等）と、手間の段階（3 段以上）。
- アレルギー評価、food-rules、`validate-generated-menu`、生成ハードゲート、
  `generation-quality-review-entry` の判定条件。
- fingerprint、quota、provider attempt 予算。この軸はどれの入力にもならない。
- `temperature` など送信 body のパラメータ変更。

## 3. 契約とデータ

### 3.1 `shared/contracts/planner.ts`

```ts
/**
 * 調理の手間。standard=指定どおり / easy=手間のかかる料理は避ける。
 * null は未指定で、挙動は standard と同一（プロンプト段落なし）。
 * null を残すのは導入前 snapshot の互換読み込みのためだけ。
 */
export const effortPreferences = ["standard", "easy"] as const;
export type EffortPreference = (typeof effortPreferences)[number];
```

`draftShape` と `submissionCommonShape` の両方へ次を追加する。

```ts
effortPreference: z.enum(effortPreferences).nullable().default(null),
```

`.default(null)` は必須である。導入前の下書き JSON と `preference_snapshot` にはこのキーが無く、
`.default(null)` が無いと履歴からの条件引き継ぎと再生成が 422 になる。`noveltyPreference` と同じ扱いにする。

UI の選択肢は「指定なし（null）」と「手間のかかる料理は避ける（easy）」の 2 つだけである。`standard` は
UI から書き込まれない。それでも enum に残すのは `noveltyPreferences` と形を揃え、将来「指定どおり」を
明示する余地を残すためである。サーバーは `standard` を受け取れば null と同じに扱う。

ラベルは `src/features/planner/model/planner-labels.ts` に `effortPreferenceLabels` /
`effortPreferenceLabel(value)` を追加する。

- `null` / `standard`: 「指定なし」
- `easy`: 「手間のかかる料理は避ける」

### 3.2 migration

新規 migration `supabase/migrations/<timestamp>_effort_preference.sql` を 1 本足し、次をすべて行う。

1. `public.generation_drafts` に `effort_preference text` を追加する。check は
   `effort_preference is null or effort_preference in ('standard','easy')`。
2. `private.generation_draft_submission_versions` に同じ列と check を追加する。
3. `public.save_generation_draft` を DROP → CREATE する。
   **DROP するのは現行の 14 引数シグネチャ**（`20260831120000_novelty_preference.sql` で定義）である。
   13 引数版を DROP すると 14 引数版が残り、15 引数版との overload が曖昧になって下書き保存が全面的に
   失敗する（novelty migration 冒頭のコメントと同じ事故）。新しい引数 `p_effort_preference text` は末尾に置く。
   revoke / grant は現行と同じにする。
4. `public.reserve_ai_generation` を再作成し、draft → submission snapshot の写しに `effort_preference` を
   足す。**本体の正本は `20260920120000_reserve_ai_generation_null_member_filter.sql`** であり、
   novelty migration の本体をコピーしてはならない。
5. `public.get_ai_generation_submission_snapshot` を DROP → CREATE し、戻り値に `effort_preference` を
   追加する。正本は novelty migration の定義である。

実装時は、上の 3 関数について「最新 timestamp の migration が正本であること」を `grep -l` と migration
の並び順で再確認する。本 spec 作成後に別 migration が足されていれば、それを正本にする。

`src/shared/types/database.generated.ts` は手で編集しない。型生成手順（`docs/README.md` 参照）で再生成する。

### 3.3 Function 側の読み込み

- `netlify/functions/_shared/generation-context.ts`: snapshot 行の `effort_preference` を
  `submission.effortPreference` へ写す。行型の zod は `nullable` で読み、範囲外の値は既存の
  `novelty_preference` と同じ扱い（契約 parse で拒否）にする。
- submission を手組みしている箇所には `effortPreference: null` を足す。対象は `noveltyPreference: null` を
  持つ `revalidation-adapter.ts`、`shared/emergency/filter-emergency-menus.ts`、
  `staple-dish-catalog.ts`、`generation-quality-review-entry.ts`、
  `paid-openrouter-benchmark-harness.ts`、`benchmark-app-response-gate.ts`、`shared/testing/factories.ts`。
  実装時は `grep -rn noveltyPreference` で漏れがないことを確認する。

### 3.4 週献立 `shared/contracts/weekly-plan.ts`

- `weeklyPlanRequestSchema` に `effortPreference: z.enum(effortPreferences).nullable().default(null)`。
  `default(null)` は、導入前に sessionStorage に保持された試行メタデータの再送を落とさないためである
  （`priorityIngredients` の `default([])` と同じ理由）。
- レスポンス側で `noveltyPreference` をエコーしている strict schema にも同じフィールドを足す。
  デプロイ／rollback をまたいでも旧 Function のレスポンスを落とさないよう、`.default(null)` を付ける。
- `netlify/functions/_shared/weekly-plan-service.ts` の `weeklyPlanRowSchema` / `intentRowSchema` の
  `preference_snapshot` に `effortPreference: z.enum(effortPreferences).nullable().catch(null)` を足す。
  導入前の行と intent にはキーが無いためである。snapshot の書き込み・エコー・再試行時の復元
  （`noveltyPreference` を運んでいる全箇所）に同じフィールドを通す。
- `weekly_plans.preference_snapshot` と `private.weekly_plan_intents.preference_snapshot` は jsonb の
  ため、DB 変更は不要である。
- 週献立の冪等性（同一 `idempotencyKey` の再送判定）が snapshot の比較を含む場合は、`effortPreference`
  も比較対象に入れる。含まない場合は触らない。実装時に `weekly-plan-service.ts` で確認する。
- `src/features/weekly-plan/weekly-plan-draft-handoff.ts` の引き継ぎ対象（`Pick<...>` と写し）に
  `effortPreference` を足す。週献立から単品の下書きへ移るときに条件が落ちないようにするためである。

## 4. プロンプト

### 4.1 段落

新規ファイル `netlify/functions/_shared/effort-hints.ts` に、kill-switch と段落を置く。

```ts
export const EFFORT_HINTS_ENABLED = true as const;
export const EFFORT_SYSTEM_MARKER = "【手間】" as const;
export const EFFORT_PARAGRAPH =
  EFFORT_SYSTEM_MARKER +
  "preferences.effortPreferenceがeasyのときは、主菜・副菜・汁物・主食のすべてで手間のかかる料理を避けてください。" +
  "避ける例: 揚げ物（揚げ焼きを含む）、蒸し物、長時間の煮込み、オーブン料理、" +
  "生地や衣から作る料理、包む・巻く・詰めるなどの成形工程が多い料理。" +
  "焼く・炒める・煮る（短時間）・和える・電子レンジで済む料理に寄せてください。" +
  "安全条件・アレルギー・preferencesの他の条件が常に優先です。" +
  "寄せきれなくてもoutcome=successで構いません。手間の方針だけではconstraint_conflictにしないでください。";
```

文言は実装時に既存段落の書式（句点・全角記号・英字キー名の書き方）へ合わせて調整してよい。ただし次の
4 要素は必ず残す。

- 全役割に適用すること。
- 避ける例の列挙に揚げ物と蒸し物を含むこと。
- 安全条件が優先であること。
- fail-open（`outcome=success` 可・`constraint_conflict` 禁止）であること。

### 4.2 載せる場所

- **payload**: `generation-prompt.ts` の `preferences` 組み立て（`timeLimitMinutes` などと並ぶ箇所）に
  `effortPreference: context.submission.effortPreference` を足し、`PromptPreferences` 型も広げる。
  この組み立ては new_menu と再生成の両方の base で共用されているため、再生成にも自動で載る。
- **system**: 段落は `effortPreference === "easy"` かつ kill-switch が on のときだけ載せる。
  `buildNewMenuSystemPrompt` と、再生成が使う `buildSystemPrompt` の**両方**で同じ条件を使う。
  判定は 1 関数（例: `shouldIncludeEffortParagraph(submission)`）にまとめ、2 か所から呼ぶ。
  段落の位置は両方とも `GENERATION_SYSTEM_PROMPT_SEASON` の直前とする（new_menu では novelty の後）。
- **repair 経路**: repair が system を組み直す場合は、再生成と同じ builder を通って段落が載ることを
  テストで固定する。repair が system を組み直さない場合は何もしない。
- **週献立**: `weekly-plan-prompt.ts` の `preferences` に `effortPreference` を足し、`easy` のときだけ
  system 文へ「7日分の主菜で手間のかかる料理（揚げ物・蒸し物・長時間の煮込み・オーブン料理など）を避け、
  寄せきれなくても出力を続ける」という 1 文を足す。週献立の kill-switch も `EFFORT_HINTS_ENABLED` を共用する。

### 4.3 触らないもの

`validate-generated-menu`、生成ハードゲート、`generation-quality-review-entry` の合否条件、fingerprint、
quota、`diversity-hints` / `novelty-hints` の除外リストは変更しない。

## 5. 画面

### 5.1 献立ウィザード（`planner-wizard.tsx`）

- `plannerSteps` の `timeLimit` の直後に `effort` を挿入する。`optionalPlannerSteps` にも加え、任意の段は
  5 つになる。
- タイトルは「6. 調理の手間」とする。後続の段は「7. 予算」「8. 材料の使い方」「9. 献立の雰囲気」へ
  番号を振り直す。進み具合の総数は `plannerSteps` の実長から出る（直書きしない）ため、自動で増える。
- 部品は既存の `OptionalChoiceStep` をそのまま使う。選択肢は「指定なし（""）」と
  「手間のかかる料理は避ける（"easy"）」の 2 つで、`onSelect` は `"easy"` 以外を null にする。
- 遷移: `timeLimit` の次へ → `effort`、`effort` の次へ → `budget`、`budget` の戻る → `effort`、
  `effort` の戻る → `timeLimit`。確認画面からの編集往復（`advanceFromEditOr` / `backFromEditOr`）と
  「残りをスキップ」（`skipRestOfOptionalSteps`）も既存の任意段と同じ規約に乗せる。
- 下書きの初期値（`planner-wizard.tsx`、`audience-step.tsx`、`planner-route.tsx` で
  `noveltyPreference: null` を置いている全箇所）に `effortPreference: null` を足す。
- 下書きの保存と読み戻し（`planner-api.ts`、`use-draft-autosave.ts`、`planner-route.tsx`）と、
  履歴からの条件引き継ぎ（`model/draft-from-menu.ts`）に同じフィールドを通す。

### 5.2 確認画面（`review-step.tsx`）

「調理時間」の行の直後に「調理の手間」の行を足す。表示は `effortPreferenceLabel(value.effortPreference)`、
変更ボタンは `onEditStep("effort")` とする。

### 5.3 週献立フォーム（`weekly-plan-form-page.tsx`）

「目新しさ」の fieldset の直後に `<legend>調理の手間</legend>` の fieldset を足す。中身は同じ形の
radio 2 択（「指定なし」／「手間のかかる料理は避ける」、`name="weekly-effort"`、`min-h-11`、
`requestActive` 中は disabled）である。送信 payload に `effortPreference` を載せる。

### 5.4 共通制約

320 CSS px で横スクロールが出ないこと、touch target が 44×44 CSS px 以上であることを保つ。文言はすべて
日本語にする。

## 6. テスト

| 層 | 固定する内容 |
| --- | --- |
| 契約 (`planner.test.ts`, `weekly-plan.test.ts`) | キー欠損を null に読む。`easy` / `standard` / null を受け付ける。enum 外の値を拒否する。週献立の snapshot 行の範囲外値は `catch(null)` で null になる |
| プロンプト (`generation-prompt.test.ts`, `regeneration-prompt.test.ts`) | `easy` のときだけ【手間】段落と payload 値が載る。null / `standard` では段落が無い。`regenerate_menu` と `regenerate_dish` にも載る。段落が SEASON の直前にある |
| kill-switch (`generation-prompt-effort-off.test.ts` 新設) | flag off なら `easy` でも段落が載らない（`generation-prompt-novelty-off.test.ts` と同型） |
| 週献立プロンプト (`weekly-plan-prompt.test.ts`) | `easy` のときだけ 1 文と payload 値が載る |
| 週献立サービス | snapshot 書き込み・エコー・再試行復元で値が落ちない。導入前 snapshot（キー無し）で GET が 500 にならない |
| ウィザード (`planner-wizard.test.tsx`, `model/planner-wizard.test.ts`) | 段の順序、前後遷移、確認画面からの編集往復、スキップ、下書き保存・読み戻し |
| 確認画面・週献立フォーム | 行や fieldset の表示と、選択が送信 payload に載ること |
| pgTAP (`03_pantry_and_planner_drafts.test.sql`, `ai_control_and_quota.test.sql`) | 列の check。`save_generation_draft` の 15 引数版だけが存在すること。reserve → snapshot で値が保持されること。`rls_inventory.test.sql` の関数シグネチャ一覧を更新する |
| e2e | 「手間のかかる料理は避ける」を選んだ献立生成が mock で成功すること（ひねりの e2e と同型） |

## 7. ロールアウトと戻し方

- migration と契約更新は同じ commit に入れる（ひねり軸 spec の教訓。片方だけでは下書き保存が壊れる）。
- 不具合時は `EFFORT_HINTS_ENABLED` を false にすると、段落と週献立の 1 文が消える。payload の
  `effortPreference` 値は残るため、モデルが値から意図を汲む余地はあり、完全な無効化ではない。
  完全に止める必要が出た場合は、flag off のとき payload へ null を載せる変更を別途行う。UI は残る。
