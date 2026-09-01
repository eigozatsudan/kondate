# 献立ひねり軸（noveltyPreference）改訂仕様 — 敵対的再レビュー

- 日付: 2026-08-31
- 対象: `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`（commit `3a2e52d0`）
- 実施者: 読み取り専用 Reviewer（改訂そのものを攻撃。製品コード・仕様は編集しない）
- 判定: **REVISE — Critical 0 件、Important 1 件、Minor 5 件**

## 1. Verdict

F-01〜F-05 の到達経路・DROP・PromptPreferences 共有・辞書照合は、改訂本文に固定されており、初回の Important 5 系統は再開しない。安全評価・quota/HMAC・ログ allowlist・カタログのブラウザ混入・temperature/2 パスも、現行コードを前提にすると成立しない。

改訂が新たに開ける穴は **実装順序** にある。§3.3 / §8 は `snapshotRowSchema` と `mapSnapshot` を migration と同一 Task に閉じる一方、`submissionCommonShape` 追加（§8.2）をその Task の外に置いている。`mapSnapshot` は `plannerSubmissionSchema.parse` にオブジェクトリテラルを渡す。現行 schema は `.strict()` なので、契約より先に `noveltyPreference` を渡す commit は **twist に限らず new_menu 全体を 422** にする。§7 のサーバーテストは `snapshotRowSchema` の parse だけを要求し、この round-trip をロックしない。

GRANT 型リスト・overlay 識別子・kill-switch の `true as const`・user キー名は、literal に従うと migration / typecheck / 既存テストで落ちるか、効きの残差に留まる。計画停止は I-01 のみ。

## 2. 主要な攻撃シナリオ

1. PromptPreferences 禁止 + new_menu トップレベル注入が、キー名未指定のまま再生成へ漏れるか
2. `isEmptyPersistableInput` と `toDraftInputFields` の片方だけ更新で twist 専用下書きが空落ちするか
3. overlay 識別子が live と違い、snapshot Returns の non-null `string` が未選択 `null` を壊すか
4. DROP 13 引数型リストと GRANT / `rls_inventory` の本数が食い違うか
5. `reserve_ai_generation` の「再作成」が 20260808 以外の本体、または誤 DROP で quality monthly retry を巻き戻すか
6. `get_ai_generation_submission_snapshot` の DROP `(uuid, uuid)` 省略で RETURNS 変更に失敗するか
7. system 段落と user キーが独立条件、または既存 payload キーと衝突するか
8. alias 完全一致 + 20〜30 語の fail-open が、改訂と矛盾する新しい穴になるか
9. kill-switch を env default false にすると機能が死んだまま出荷されるか（`true as const` 欠落）
10. §3.3 同一 Task と §8 の契約を挟む順序で、RPC+旧 schema または mapSnapshot+旧契約を commit できるか
11. select 列だけ / overlay だけ、generated 再生成より前の overlay で型が割れるか
12. 14 引数 CREATE 後の GRANT が 13 引数のまま残り、`rls_inventory` exact が更新されないか

## 3. Critical

なし。改訂は novelty を `validate-generated-menu` / fingerprint / quota / HMAC に載せない判断を維持しており、現行ハードゲートと閉じたロガーを弱める攻撃は成立しない。

## 4. Important

### I-01: §8 が契約を migration + `mapSnapshot` の同一 Task から外し、`.strict()` が全 new_menu を 422 にする

根拠:

- 改訂 §3.3 は `snapshotRowSchema` と `mapSnapshot` を §3.2 の RPC と「同じ Task 内」に閉じる。§8.3 も「1 と同じ Task 内」「RPC が新しい列を返すのに strict schema が古いままの状態を commit してはならない」と書く。
- 同じ §8 の番号リストは **2. 契約（`planner.ts`）** を 1 と 3 のあいだに置き、2 を同一 Task に含めていない。末尾は「各段は … 日本語 Conventional Commit で閉じる」。
- 実装者が「1 と 3 を同一 commit（RPC+旧 snapshotRowSchema 禁止を満たす）し、2 は次の段」と読むのが、改訂の文言どおりの経路である。

```136:153:shared/contracts/planner.ts
export const plannerSubmissionSchema = z.discriminatedUnion("targetMode", [
  z
    .object({
      ...submissionCommonShape,
      targetMode: z.literal("household"),
      ...
    })
    .strict(),
  z
    .object({
      ...submissionCommonShape,
      targetMode: z.literal("idea"),
      ...
    })
    .strict(),
]);
```

```211:226:netlify/functions/_shared/generation-context.ts
function mapSnapshot(row: z.infer<typeof snapshotRowSchema>) {
  return plannerSubmissionSchema.parse({
    mealType: row.meal_type,
    mainIngredients: row.main_ingredients,
    ...
    ingredientPreference: row.ingredient_preference,
    avoidIngredients: row.avoid_ingredients,
    memo: row.memo,
    pantrySelections: row.pantry_selections,
  });
}
```

```141:142:netlify/functions/_shared/generation-context.ts
const invalidRequest = () =>
  new HttpError(422, "invalid_request", "現在の入力内容を確認できませんでした。");
```

- `z.ZodType.parse` の引数は `unknown` なので、object literal に `noveltyPreference` を足しても **typecheck は通る**。落ちるのは実行時の `.strict()` だけである。
- §3.3 は `GenerationContext["submission"]` が `PlannerSubmission` そのものだと書いて契約との接続を認めつつ、契約追加を同一 Task の必須面に入れない。
- §7 のサーバーテストは「`snapshotRowSchema` が新しい列を含む行を parse できること」だけである。`mapSnapshot` → `plannerSubmissionSchema` の round-trip はロックされない。孤立した schema テストだけ GREEN にして 1+3 を commit できる。

成立手順:

1. §8.1+§8.3 を同一 commit にする。migration で RPC が `novelty_preference` を返し、`snapshotRowSchema` がそれを必須化し、`mapSnapshot` が `noveltyPreference: row.novelty_preference` を `plannerSubmissionSchema.parse` に渡す。
2. §8.2 の `submissionCommonShape` 追加はこの commit に含まれない。`.strict()` が未知キー `noveltyPreference` を拒否する。
3. `loadGenerationContext` は `safeParse` 失敗を `invalidRequest()` にする。**twist である必要はなく、すべての new_menu が HTTP 422** になる。
4. 逆順（契約だけ先、RPC は旧）は 422 にならないが、§8 の番号順と「3 は 1 と同じ Task」はこちらの安全順を指定していない。

修正:

- §8 の 1・2・3 を **同一 Task かつ同一 commit** にする。または順序を **2 → 1+3** に固定する。
- §3.3 の必須面に `submissionCommonShape` / `plannerSubmissionSchema` を明示する。`mapSnapshot` が渡すキーは契約が受け入れてからでなければ commit しない、と否定する。
- §7 に `mapSnapshot` が `novelty_preference: "twist"` の行を `PlannerSubmission` まで通す 1 本を足す（`snapshotRowSchema` 単体では不足）。

## 5. Minor

### M-01: kill-switch がまだ `true as const` ではない

改訂 §5.1 は `diversity-hints.ts` と同型と書き `NOVELTY_HINTS_ENABLED` を列挙するが、現行の `DIVERSITY_HINTS_ENABLED = true as const` / `HOUSEHOLD_KITCHEN_PROMPT_ENABLED = true as const` をリテラルで固定しない。F-04 / A-M-03 が求めた一文は落ちている。

`if (NOVELTY_HINTS_ENABLED)` を `true as const` のまま置くと `no-unnecessary-condition` が点灯し、実装者が env 分岐へ逃げられる。`process.env.NOVELTY_HINTS_ENABLED === "true"` は default-off で機能が死んだまま出荷される。`twist` on スナップショット（§7）が段落欠落で落ちるため完全な沈黙ではないが、仕様が default-on を固定していない。

### M-02: overlay 識別子が live と不一致。Returns overlay は不要

改訂 §3.4 は `SaveDraftNullableArgKeys` に `p_novelty_preference` を足せと書く。live は `NullableDraftArgs`（`src/shared/types/database.ts` 20–27 行）である。検索して見つからない実装者は、新規 union を切って `SaveDraftArgs` に繋がない、または既存の nullable キーを落とす overlay を作り得る。どちらも `p_meal_type: null` や `p_novelty_preference: null` で typecheck が落ち、出荷はしない。

snapshot Returns は現行 `ingredient_preference: string`（non-null、`database.generated.ts` 2941 行）で、overlay は `servings` だけを `| null` に戻している（`database.ts` 137–139 行）。実行時の正は `snapshotRowSchema` の `.nullable()` であり、novelty も Returns overlay は要らない。改訂が Returns に触れないのは正しい。攻撃が残るのは **Args overlay の識別子誤り** だけである。

### M-03: user トップレベルキー名が未固定

改訂 §5.1 は「除外リストを payload のトップレベルキーとして足す」とだけ書く。現行 new_menu payload の閉集合は `preferences` / `members` / `pantry` / `validationVersions` / `seasonContext` / `recentDishHints`（`generation-prompt.test.ts` 212–219 行の `expectExactKeys`）である。キー名がこのどれかだと上書きになる。合理的な新規名なら衝突しない。

再生成不変の回帰（§7）は payload 全体比較でキー名なしでもロックできる。kill-switch off も「現行 6 キー以外が無い」で書ける。F-04 の再生成リーク自体は閉じている。残るのは、段落と dual-channel テストが実装者の選んだ名前に依存することと、`expectExactKeys` を §7 の契約に書いていないことである。

### M-04: 14 引数 GRANT 型リストと `rls_inventory` exact が仕様に無い

DROP 対象の 13 型

`(bigint, text, text[], text, text, uuid[], smallint, smallint, text, text, text[], text, jsonb)`

は現行 CREATE / GRANT（`20260730120000_ingredient_preference.sql` 23–27・120–125 行）および `rls_inventory.test.sql` 284 行の named 13 引数と一致する。ここは F-03 を閉じている。

改訂 §3.2.6 は「revoke / grant を **現行と同じ内容** で貼り直す」と書く。save の現行 GRANT は 13 型である。14 引数 CREATE の直後にこれを貼ると、対象関数が無く migration が失敗する。`rls_inventory` と `03a_pantry_and_planner_drafts_hardening.test.sql` 86–88 行の `to_regprocedure`、`03_pantry_and_planner_drafts.test.sql` 41–42 行の `has_function` 13 型配列は §7 に無い。既存 pgTAP が失敗して実装者に更新を強いるため、誤 GRANT のまま出荷はしない。14 引数 GRANT 型リスト（`p_ingredient_preference` の直後に `text` を 1 つ）を §3.2 にリテラルで書き、§7 に `rls_inventory` exact を戻すと足りる。

### M-05: 「隣に」配置と再生成 system の回帰がまだ緩い

- §4 は「材料の使い方の **隣に**」のまま。現行 `review-step.tsx` の追加条件は `.field` の縦積み。同一行の 2 択は 320 CSS px で横スクロールし得る（A-M-01 未反映）。
- §7 の再生成回帰は **user payload 不変** だけである。既存テスト `regenerate has no recentDishHints key and no marker` は `DIVERSITY_SYSTEM_MARKER` だけを見る。`buildSystemPrompt` へ `NOVELTY_SYSTEM_MARKER` を足すと、仕様本文（§5.1「再生成の system は変更しない」）に反しても必須テストは落ちない。

## 6. 成立しない攻撃（偽陽性にしないための記録）

- **PromptPreferences 禁止後も再生成 user JSON へ漏れる**: 成立しない。`buildBaseGenerationMessages` は `PromptPreferences` の明示フィールドだけを載せ、`satisfies PromptPreferences` が object literal の余剰キーを拒否する（`generation-prompt.ts` 353–370・453–462 行）。再生成は `...base` をそのまま使う（537–542 行）。`recentDishHints` と同じ `kind === "new_menu"` 分岐（498–523 行）へ足す改訂は、この経路を物理的に外す。§7 の payload 不変回帰が F-04 を再発防止する。キー名未指定はテストの名前依存（M-03）であり、リークそのものではない。
- **`isEmptyPersistableInput` と `toDraftInputFields` の片方漏れ**: 仕様 §3.4 は「保存値の明示コピー」と「`ingredientPreference === null &&` と同型」の両方を同一箇条で要求している。片方だけ更新すると twist 専用下書きは空落ちするが、それは仕様違反であり改訂の穴ではない。`toDraftInputFields` の欠落は、契約追加後の `PlannerDraftInput` 不足プロパティで typecheck が落ちる。
- **snapshot Returns に `novelty_preference` overlay が要る**: 成立しない。現行 `ingredient_preference` も generated Returns は `string` で、runtime は `snapshotRowSchema` の `.nullable()`。novelty も同型で足りる。
- **DROP 13 型リストが GRANT と本数不一致**: DROP リストは現行 13 引数と一致する。12 引数 DROP の overload 再発（F-03）は閉じた。14 引数 GRANT の欠落は M-04（fail-closed）。
- **reserve の誤 DROP / 20260730 本体で quality monthly retry 退行**: 改訂 §3.2.4 は正本を `20260808120000` 本体に固定し、20260730 本体を禁止する。20260808 より後に `reserve_ai_generation` を置き換える migration は無い。引数は増えないので CREATE OR REPLACE で足り、20260808 の 20 引数 GRANT を「現行と同じ」で貼ってもシグネチャは正しい。INSERT 列に `novelty_preference` を足す指示も足りる。
- **`get_ai_generation_submission_snapshot` DROP `(uuid, uuid)` 省略**: 改訂は DROP → CREATE と書く。overload は `(uuid, uuid)` の 1 本だけ。CREATE OR REPLACE のまま RETURNS を変えると Postgres が失敗し、HINT が `(uuid, uuid)` を出す。fail-closed。
- **dual-channel が独立 on/off**: 改訂 §5.1 は system / user を同じ条件（`twist` かつ kill-switch on）に縛り、off では段落とキーの両方を落とす。多様性の「off でも `[]` を残す」契約から意図的に外している。独立フラグは仕様違反。
- **alias 完全一致の fail-open が新しい矛盾**: 改訂 §6 は正規化後の完全一致・alias 列挙・未収録はヒット 0 で段落だけ残ると書いており、F-05 と一致する。20〜30 語の隙間は §9 の受け入れ残差のまま。矛盾は無い。
- **select 無し overlay / overlay 無し generated 再生成**: §8 は型再生成を 1、overlay と `planner-api` を 4 に置く。overlay を再生成前に書くと `GeneratedSaveDraftArgs["p_novelty_preference"]` が無く typecheck が落ちる。select 文字列と overlay は同一段。出荷経路にならない。
- **安全ハードゲート迂回 / quota / HMAC / キー欠損 422 / プロンプト注入でカタログ汚染 / ログ漏洩 / ブラウザ import / temperature / 2 パス**: 初回 §6 と同じく成立しない。改訂はこれらの対象外判断を維持している。再掲しない。

## 7. 受け入れ残差になり得るもの

- 名指し除外は alias 手列挙の密度で決まる。完全一致でも「豚こま肉」等はヒット 0 で弱い段落へ縮退する（§6 / §9）。2 パスに進まない判断は維持してよい。
- 複数メイン食材の `stapleDishes` 和集合は F-05 の修正指示に含まれていたが、改訂 §6 は「1 リクエストあたり上限定数で切る」だけである。和集合でも先頭ヒットだけでも fail-open に縮退し、安全穴にはならない。Task 0 で「和集合のち上限 N」と整数を固定すれば実装が割れない。
- 再生成にひねり段落を載せないこと、結果画面にひねりを出さないことは製品判断として受理する。
- UI の 2 択（未選択がラベル上見えない）と `selected_only` + twist の二重指示は、初回どおり機能バグではない。
- `PlannerFieldName` / `stepByField` 未列挙は、nullable enum の select なら 422 になりにくい。確認画面の Zod issue 表示だけが欠ける。
- `shared/testing/factories.ts` と emergency のダミー submission は §3.4 の 4 箇所から落ちている。`PlannerSubmission` に必須キーが足されると typecheck が強制する。

## 8. 改訂が閉じた初回 Important（再開しない）

| 初回 | 改訂での閉じ方 |
| --- | --- |
| F-01 snapshot 誤帰属 | §3.2.4–5 が reserve INSERT（正本 20260808）と snapshot RPC を必須化。§3.3 が `.strict()` を説明する |
| F-02 クライアント永続面 | §3.4 が overlay / select / map / RPC / autosave 空判定 / route の hydrate・送信を列挙 |
| F-03 DROP 12 引数 | §3.2.3 が現行 13 引数型リストをリテラルで固定。12 引数コピーを禁止 |
| F-04 PromptPreferences 共有 | §5.1 がフィールド追加を禁止し、`recentDishHints` と同じ new_menu 分岐へ限定。off はキーごと削除。§7 に再生成 payload 不変回帰 |
| F-05 正規化の過大評価 | §6 が alias 列挙と正規化後の完全一致を固定。漢字↔かなを畳まないと明記 |
