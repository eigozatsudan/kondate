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

1. **再生成（`regenerate_menu` / `regenerate_dish`）にも効く。** 段落は new_menu の system 組み立てと、
   再生成が使う base の system 組み立ての両方に載せる。値は共用の `preferences` payload に載せる
   （§4.3）。作り直した結果に揚げ物が出ると、この軸を選んだ意味が失われるためである。
2. **全役割（main / side / soup / staple）にかかる。** ひねりは main 限定だったが、手間は献立全体の
   負担で決まる。週献立は出力が主菜だけなので、主菜にかかる。

## 2. 目的と対象外

### 2.1 目的

「平日の夜に揚げ物や蒸し物は作りたくない」という利用者が、調理法を避ける意図を 1 タップで伝えられる
ようにする。既存の `timeLimitMinutes`（15/30/45 分以内）は所要時間しか縛らない。油の処理、蒸し器の準備、
包む・巻く工程など、**時間に表れにくい面倒さ**は既存軸では表現できない。

既存の【家庭キッチン】段落（`household-kitchen-prompt.ts`）は CORE に入っており、`easy` のときも
消えない。この段落は「蒸し器・オーブンなど専用器具を前提にしない」という**器具**の方針で、蒸し料理
そのものは残し、「ふた付きフライパンや電子レンジで蒸す手順で書け」と指示する。一方で本軸の目的
（平日の夜に蒸し物は作りたくない）は、ふた付きフライパンで蒸す案でも満たされない。

そのため両段落が同時に載ると、蒸し物を残す指示と消す指示が並ぶ。本設計では【手間】段落の中に
「料理の選択では本段落が【家庭キッチン】より優先し、蒸し物そのものを選ばない」と明記して解消する
（§4.1）。【家庭キッチン】段落の文言は変更しない。

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
4. `public.reserve_ai_generation` は **DROP せず `create or replace` で**本体だけを差し替え、
   draft → submission snapshot の写しに `effort_preference` を足す。**引数リストは変えない**
   （`identity_daily_quota.test.sql` が 20 引数シグネチャを固定している）。`create or replace` は既存の
   grant を保持するため、`20260920120000` と同じく revoke / grant は書かない。DROP すると service_role の
   EXECUTE が消える。**本体の正本は `20260920120000_reserve_ai_generation_null_member_filter.sql`** であり、
   novelty migration の本体をコピーしてはならない。
5. `public.get_ai_generation_submission_snapshot(uuid, uuid)` は戻り値の型が変わるため DROP → CREATE し、
   戻り値に `effort_preference` を追加する。正本は novelty migration の定義である。CREATE の直後に、
   novelty migration と同じ次の 2 文を必ず書く。

   ```sql
   revoke all on function public.get_ai_generation_submission_snapshot(uuid, uuid)
     from public, anon, authenticated;
   grant execute on function public.get_ai_generation_submission_snapshot(uuid, uuid)
     to service_role;
   ```

   この関数は security definer で、引数の `p_user_id` をそのまま信用する。revoke を忘れると PUBLIC の
   既定 EXECUTE が残り、公開スキーマ経由で他人の snapshot を読める状態になる。

実装時は、上の 3 関数について「最新 timestamp の migration が正本であること」を `grep -l` と migration
の並び順で再確認する。本 spec 作成後に別 migration が足されていれば、それを正本にする。

### 3.3 生成型と overlay

`src/shared/types/database.generated.ts` は手で編集しない。型生成手順（`docs/README.md` 参照）で再生成する。

生成型では nullable な text 引数が `string` になる。そのため `src/shared/types/database.ts` の
`NullableDraftArgs` で、`p_novelty_preference` と同じく `p_effort_preference` を null 許容へ戻す
（キー union と `| null` の上書きの両方）。これが無いと `planner-api.ts` が null を渡せない。
`src/shared/types/database.test.ts` の引数リテラル（`p_novelty_preference: null` を持つ 2 箇所）と
キー union にも `p_effort_preference` を足す。

### 3.4 Function 側の読み込み

- `netlify/functions/_shared/generation-context.ts`: snapshot 行の `effort_preference` を
  `submission.effortPreference` へ写す。行型の zod は `nullable` で読み、範囲外の値は既存の
  `novelty_preference` と同じ扱い（契約 parse で拒否）にする。
- submission を手組みしている箇所には `effortPreference: null` を足す。対象は `noveltyPreference: null` を
  持つ `revalidation-adapter.ts`、`shared/emergency/filter-emergency-menus.ts`、
  `staple-dish-catalog.ts`、`generation-quality-review-entry.ts`、
  `paid-openrouter-benchmark-harness.ts`、`benchmark-app-response-gate.ts`、`shared/testing/factories.ts`。
  実装時は `grep -rn noveltyPreference` で漏れがないことを確認する。

### 3.5 週献立

- **リクエスト契約**（`shared/contracts/weekly-plan.ts` の `weeklyPlanRequestSchema`）:
  `effortPreference: z.enum(effortPreferences).nullable().default(null)`。キー欠損は null に読み、
  範囲外の値は拒否する（現行の `priorityIngredients` と同じ分け方）。`default(null)` は、導入前に
  sessionStorage に保持された試行メタデータの再送を落とさないためである。
- **レスポンス契約**: `noveltyPreference` をエコーしている strict schema にも同じフィールドを足す。
  デプロイや rollback をまたいでも旧 Function のレスポンスを落とさないよう、`.default(null)` を付ける。
- **snapshot 行**（`netlify/functions/_shared/weekly-plan-service.ts` の `weeklyPlanRowSchema` /
  `intentRowSchema`）: `preference_snapshot` に
  `effortPreference: z.enum(effortPreferences).nullable().catch(null)` を足す。導入前の行と intent には
  キーが無く、範囲外の値でも GET を恒久的な 500 にしないためである。
- **写しの全箇所**: サービス内で `noveltyPreference` を個別に写しているのは次の箇所である。すべてに
  `effortPreference` を足す。どれか 1 つでも漏れると、保存されても応答で値が落ちる。
  - `snapshotFromRequest`（リクエスト → snapshot）
  - `buildResultFromRow`（行 → 結果）
  - intent の replay（再試行時の復元。現行 2 箇所）
  - 成功レスポンスの組み立て

  実装時は `grep -n noveltyPreference weekly-plan-service.ts` の全行と 1 対 1 で対応を取る。
- `weekly_plans.preference_snapshot` と `private.weekly_plan_intents.preference_snapshot` は jsonb の
  ため、DB 変更は不要である。
- **冪等性の比較対象には足さない。** 週献立は snapshot の等値比較を持たない。同じ `idempotencyKey` で
  `effortPreference` だけを変えて再送すると前の結果が返るが、`noveltyPreference` と同じ既存の振る舞い
  であり、本設計では変えない。
- `src/features/weekly-plan/weekly-plan-draft-handoff.ts` の引き継ぎ対象（`Pick<...>` と写し）に
  `effortPreference` を足す。週献立から単品の下書きへ移るときに条件が落ちないようにするためである。

## 4. プロンプト

### 4.1 段落

新規ファイル `netlify/functions/_shared/effort-hints.ts` に、kill-switch と段落と週献立用の 1 文を置く。

```ts
export const EFFORT_HINTS_ENABLED = true as const;
export const EFFORT_SYSTEM_MARKER = "【手間】" as const;

/** 避ける料理の列挙。日次の段落と週献立の 1 文で共用し、両者の範囲を揃える */
const EFFORT_AVOID_EXAMPLES =
  "揚げ物（揚げ焼きを含む）、蒸し物、長時間の煮込み、オーブン料理、" +
  "生地や衣から作る料理、包む・巻く・詰めるなどの成形工程が多い料理";

export const EFFORT_PARAGRAPH =
  EFFORT_SYSTEM_MARKER +
  "preferences.effortPreferenceがeasyのため、主菜・副菜・汁物・主食のすべてで手間のかかる料理を避けてください。" +
  `避ける例: ${EFFORT_AVOID_EXAMPLES}。` +
  "料理の選択では本段落が【家庭キッチン】より優先します。蒸し物は、ふた付きフライパンや電子レンジで蒸す手順に" +
  "置き換えるのではなく、蒸し物そのものを選ばないでください。" +
  "焼く・炒める・短時間で煮る・和える・電子レンジで済む料理に寄せてください。" +
  "安全条件・アレルギーが常に優先です。" +
  "寄せきれなくてもoutcome=successで構いません。手間の方針だけではconstraint_conflictにしないでください。";

export const WEEKLY_EFFORT_SENTENCE =
  "preferences.effortPreferenceがeasyのため、7日分の主菜で手間のかかる料理を避けてください。" +
  `避ける例: ${EFFORT_AVOID_EXAMPLES}。` +
  "寄せきれなくても7日分の出力を続けてください。";
```

文言は実装時に既存段落の書式（句点・全角記号・英字キー名の書き方）へ合わせて調整してよい。ただし次の
要素は必ず残す。

- 日次は全役割に適用すること。週献立は出力が主菜だけなので主菜に適用すること。
- 避ける例の列挙を日次と週献立で共用すること。揚げ物・蒸し物・生地から作る料理・包む/巻く/詰める料理
  （餃子・春巻など）を含むこと。
- 料理の選択では【家庭キッチン】より優先し、蒸し物そのものを選ばないこと（日次のみ。週献立の system には
  【家庭キッチン】段落が無い）。
- 安全条件が優先であること。
- fail-open（`outcome=success` 可・`constraint_conflict` 禁止、週献立は出力継続）であること。

### 4.2 優先順位の文への追加

多様性段落と学習段落は優先順位の文を持ち、2 番目を「当日の preferences（メイン食材・避けたい等）」と
書いている（`taste-hints.ts` の `TASTE_PARAGRAPH`、`diversity-hints.ts` の `DIVERSITY_PARAGRAPH`）。
この例示に手間を足し、「メイン食材・避けたい・手間等」とする。本軸は preferences の一部として 2 番目の段に
入り、直近の献立との被り回避や学習ヒントより優先することを明示するためである。優先順位の文は 1 つの
system 文に 1 回だけ載る既存の規約（学習が載る版では多様性側から外す）はそのまま保つ。

### 4.3 載せる場所

`generation-prompt.ts` の組み立ては次の 3 経路に分かれており、すべてに手を入れる。

- **payload**: `buildBaseGenerationMessages` の idea 分岐と household 分岐は、それぞれ別の `preferences`
  オブジェクトを組み立てている。`PromptPreferences` 型に `effortPreference` を足せば両方で必須になるので、
  両方に `effortPreference: context.submission.effortPreference` を足す。この base は new_menu と
  再生成の両方で使われるため、再生成にも値が載る。
- **再生成の system**: `buildSystemPrompt` は現在 `targetMode` しか受け取らない。段落を載せるかどうかを
  判断できるよう、引数に `effortEnabled: boolean`（または submission）を足す。呼び出しは
  `buildBaseGenerationMessages` の idea 分岐と household 分岐の 2 つで、両方から同じ判定結果を渡す。
  段落の位置は `GENERATION_SYSTEM_PROMPT_SEASON` の直前とする。
- **new_menu の system**: new_menu は base の system を捨て、`buildNewMenuSystemPrompt` の結果で置き換える。
  そのため、こちらにも `effortEnabled` を足し、段落を novelty の後、`GENERATION_SYSTEM_PROMPT_SEASON` の直前に
  置く。
- **判定**: `effortPreference === "easy"` かつ kill-switch が on のときだけ真とする。1 関数
  （例: `shouldIncludeEffortParagraph(submission)`）にまとめ、上の呼び出し元すべてから使う。
- **repair 経路**: repair は system を組み直さず、初回のメッセージをそのまま使う。初回に段落が入っていれば
  repair にも残るので、repair 側には何もしない。
- **週献立**: `weekly-plan-prompt.ts` の `preferences` に `effortPreference` を足し、`easy` かつ kill-switch
  が on のときだけ system 文へ `WEEKLY_EFFORT_SENTENCE` を足す。

### 4.4 触らないもの

`validate-generated-menu`、生成ハードゲート、`generation-quality-review-entry` の合否条件、fingerprint、
quota、`diversity-hints` / `novelty-hints` の除外リスト、【家庭キッチン】段落の文言は変更しない。

## 5. 画面

### 5.1 献立ウィザード（`planner-wizard.tsx`）

- `plannerSteps` の `timeLimit` の直後に `effort` を挿入する。`optionalPlannerSteps` にも加え、任意の段は
  5 つになる。段の総数は 9 から 10 になる。
- タイトルは「6. 調理の手間」とする。後続の段は「7. 予算」「8. 材料の使い方」「9. 献立の雰囲気」へ
  番号を振り直す。進み具合の総数は `plannerSteps` の実長から出る（直書きしない）ため、自動で増える。
  `optionalPlannerSteps` 直上のコメント「4問（timeLimit〜novelty）」は「5問」に直す。
- 部品は既存の `OptionalChoiceStep` をそのまま使う。選択肢は「指定なし（""）」と
  「手間のかかる料理は避ける（"easy"）」の 2 つで、`onSelect` は `"easy"` 以外を null にする。
- 遷移: `timeLimit` の次へ → `effort`、`effort` の次へ → `budget`、`budget` の戻る → `effort`、
  `effort` の戻る → `timeLimit`。確認画面からの編集往復（`advanceFromEditOr` / `backFromEditOr`）も
  既存の任意段と同じ規約に乗せる。
- **確認画面の「戻る」は変えない。** 最後の任意段は引き続き `novelty` なので、`goToStep("novelty")` は
  そのままにする。
- `skipRestOfOptionalSteps` は現在 4 フィールドを明示的に null にしている。`effortPreference: null` を
  足して 5 フィールドにする。
- 下書きの初期値（`planner-wizard.tsx`、`audience-step.tsx`、`planner-route.tsx` で
  `noveltyPreference: null` を置いている全箇所）に `effortPreference: null` を足す。
- 下書きの保存と読み戻し（`planner-api.ts`、`planner-route.tsx`）と、履歴からの条件引き継ぎ
  （`model/draft-from-menu.ts`）に同じフィールドを通す。
- `use-draft-autosave.ts` では `toDraftInputFields` だけでなく `isEmptyPersistableInput` にも
  `effortPreference === null` の条件を足す。足さないと、手間だけを選んだ下書きが空扱いになって保存されない。

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

### 6.1 新しく固定する内容

| 層 | 固定する内容 |
| --- | --- |
| 契約 (`planner.test.ts`, `weekly-plan.test.ts`) | キー欠損を null に読む。`easy` / `standard` / null を受け付ける。enum 外の値を拒否する（リクエスト契約） |
| 型 overlay (`src/shared/types/database.test.ts`) | `p_effort_preference: null` を渡せる。キー union に含まれる |
| プロンプト (`generation-prompt.test.ts`, `regeneration-prompt.test.ts`) | `easy` のときだけ【手間】段落と payload 値が載る。null / `standard` では段落が無い。idea / household の両分岐、`regenerate_menu` / `regenerate_dish` にも載る。段落が SEASON の直前（new_menu では novelty の後）にある。【家庭キッチン】より優先する旨の文を含む。優先順位の文が「手間」を含む |
| kill-switch (`generation-prompt-effort-off.test.ts` 新設) | flag off なら `easy` でも段落が載らない（`generation-prompt-novelty-off.test.ts` と同型） |
| 週献立プロンプト (`weekly-plan-prompt.test.ts`) | `easy` のときだけ `WEEKLY_EFFORT_SENTENCE` と payload 値が載る。文に「生地」「包む」を含む |
| 週献立サービス (`weekly-plan-service` のテスト) | snapshot 書き込み・`buildResultFromRow`・replay・成功レスポンスで値が落ちない。導入前 snapshot（キー無し）と範囲外値は `catch(null)` で null になり、GET が 500 にならない |
| ウィザード (`planner-wizard.test.tsx`, `model/planner-wizard.test.ts`) | 段の順序、前後遷移、確認画面からの編集往復、スキップで `effortPreference` が null になること、確認画面の戻るが novelty のままであること |
| 下書き保存 (`use-draft-autosave` のテスト) | 手間だけを選んだ下書きが空扱いされず保存される |
| 確認画面・週献立フォーム | 行や fieldset の表示と、選択が送信 payload に載ること |
| pgTAP (`03_pantry_and_planner_drafts.test.sql`, `ai_control_and_quota.test.sql`) | 列の check。`save_generation_draft` の 15 引数版だけが存在すること。reserve → snapshot で値が保持されること。`get_ai_generation_submission_snapshot` が anon / authenticated から EXECUTE できず、service_role だけが EXECUTE できること |
| e2e | 「手間のかかる料理は避ける」を選んだ献立生成が mock で成功すること（ひねりの e2e と同型） |

### 6.2 追随が必要な既存の固定値

段の追加とシグネチャ変更で、次の既存テストはそのままでは落ちるか、意味を失う。同じ commit で更新する。

- **pgTAP**
  - `03a_pantry_and_planner_drafts_hardening.test.sql`: 14 引数の `save_generation_draft` 呼び出しと、
    同じ 14 型の `to_regprocedure` 権限チェック。15 引数・15 型へ直す。
  - `rls_inventory.test.sql`: 関数シグネチャ一覧。
  - `identity_daily_quota.test.sql`: `reserve_ai_generation` のシグネチャは変えないので**更新不要**である。
    変更が必要になった場合は、§3.2 の 4 に違反しているということなので実装を見直す。
- **進み具合の分母（9 → 10）と段の番号**
  - `planner-wizard.test.tsx`: 「1 / 9」「5 / 9・任意」「9 / 9」など。
  - `model/planner-wizard.test.ts`: `plannerSteps` の完全一致。
  - `src/app/accessibility.test.tsx`、`planner-route-history.test.tsx`。
  - `home-generate-card.test.tsx`、`planner-route.test.tsx`: 「8 / 9」を否定する assert。否定形なので
    落ちはしないが、意味を保つよう「9 / 10」へ直す。
- **e2e の見出し「8. 献立の雰囲気」**（→「9. 献立の雰囲気」）
  - `e2e/specs/full-journey.spec.ts`、`mobile-accessibility.spec.ts`、`generation-recovery-results.spec.ts`。

実装時は `grep -rnE "/ 9|[0-9]\. (調理時間|予算|材料の使い方|献立の雰囲気)" src e2e` で漏れがないことを確認する。

## 7. ロールアウトと戻し方

- migration、契約更新、型 overlay、pgTAP の追随は同じ commit に入れる（ひねり軸 spec の教訓。片方だけでは
  下書き保存か `db:test` が壊れる）。
- 不具合時は `EFFORT_HINTS_ENABLED` を false にすると、段落と週献立の 1 文が消える。payload の
  `effortPreference` 値は残るため、モデルが値から意図を汲む余地はあり、完全な無効化ではない。
  完全に止める必要が出た場合は、flag off のとき payload へ null を載せる変更を別途行う。UI は残る。
