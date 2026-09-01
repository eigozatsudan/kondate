# 献立ひねり軸 — 改訂二次検証 (3a2e52d0)

- 日付: 2026-08-31
- 対象: spec @ `3a2e52d0`（`docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`）
- 入力: 改訂一次レビュー、改訂敵対的レビュー、初回裁決（F-01〜F-05 閉じ済み）
- 実施者: 両レビューと別スレッドの読み取り専用 Reviewer（製品コード・仕様は編集しない）
- 判定: **REVISE — Critical 0、Important 1**（計画ブロッカーは §8 の契約抜けだけ）

## 1. Verdict

F-01〜F-05 は改訂本文に固定されたまま再開しない。一次が Important とした overlay 型名（P-I-1）、
未列挙リテラル（P-I-2）、既存 13 引数 pgTAP（P-I-3）はいずれも **出荷経路にならない fail-closed** であり、
重大度は Minor へ落とす。残る計画停止は **A-I-01 / P-I-4 の同一根** だけである。

`plannerSubmissionSchema` は両ユニオン枝が `.strict()`。`mapSnapshot` は
`plannerSubmissionSchema.parse(object)` にキーを直渡し、Zod 4 の `parse(data: unknown)` は
余剰キーを型では落とさない。§8 が契約（段 2）を migration + `mapSnapshot`（1+3）の同一 Task から外す読みは、
**twist に限らず new_menu 全体を HTTP 422** にする。typecheck も §7 のサーバー必須テストもこの round-trip を
ロックしない。

APPROVE しない。Critical 0 だが Important が 1 件残る。

## 2. F-01〜F-05 は閉じたまま

独立に live を再読した。初回裁決の 5 系統は再開しない。

| 統合ID | 判定 | 根拠（live） |
| --- | --- | --- |
| F-01 | **Closed** | snapshot 複写の正本は `20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql` 155–165 行の `reserve_ai_generation` INSERT。`save_generation_draft` 最終定義（`20260730120000` 23–116 行）は `generation_drafts` のみ。20260808 より後に reserve を再定義する migration は無い。読取は `get_ai_generation_submission_snapshot`（`generation-context.ts` 275–277 行）。`snapshotRowSchema` は `.strict()`（63–81 行）。spec §3.2.4–5 / §3.3 がこの経路を本文に固定 |
| F-02 | **Closed**（残差は識別子 Minor） | spec §3.4 が overlay / select / map / RPC 引数 / autosave 空判定 / route の emptyDraft・hydrate・送信を列挙。keepalive は `buildSaveGenerationDraftArgs` 経由（`planner-api.ts` 110–127 行）。`isEmptyPersistableInput` は `ingredientPreference === null &&` と同型の連言（`use-draft-autosave.ts` 130–146 行）。`toDraftInputFields` は「保存値の明示コピー」に含まれる。generated 手編集禁止は維持 |
| F-03 | **Closed**（残差は GRANT/pgTAP 列挙 Minor） | spec §3.2.3 の DROP 13 型リストは現行 GRANT（`20260730120000` 120–125 行）と一致。`20260730120000` の DROP（19–21 行）は 12 引数で現行を落とさない。12 引数コピー禁止は本文にある |
| F-04 | **Closed**（残差はキー名 / `true as const` Minor） | spec §5.1 は `PromptPreferences` 拡張を禁止し、`kind === "new_menu"` 分岐へ限定。off は段落とキーの両方を落とす。再生成 user payload 不変回帰は §7 必須。現行 builder は base を再生成がそのまま使う（`generation-prompt.ts` 353–370 / 453–462 / 537–542 行） |
| F-05 | **Closed**（残差は件数上限整数 Minor） | spec §6 は `normalizeFoodText` 後の完全一致、漢字・かな非畳み、alias 列挙。現行 `shared/safety-pure/normalize-food-text.ts` 16–28 行は NFKC・カタカナ→ひらがな・小文字・Cf・区切り除去のみ |

## 3. 元指摘の二次判定

`P-*` は改訂一次、`A-*` は改訂敵対的レビュー。初回裁決の F-01〜F-05 は上表。

| 元ID | 判定 | 最終severity | 統合判断 |
| --- | --- | --- | --- |
| P-I-1 | **Confirmed** | **Minor へ変更** | overlay 識別子誤りは真。ただし仕様どおり実装しても typecheck / §7 overlay テストが fail-closed。出荷しない。A-M-02 へ統合 |
| P-I-2 | **Confirmed** | **Minor へ変更**（計画ファイルリスト） | `z.infer` は `.default(null)` でも出力キー必須。未列挙は `tsc -b` が全部拾う。仕様ブロッカーではない |
| P-I-3 | **Confirmed** | **Minor へ変更** | 既存 13 引数 pgTAP / `rls_inventory` は更新必須。spec が `db:test` を指定しているので未更新のまま出荷できない。A-M-04 へ統合 |
| P-I-4 | **Confirmed** | **Important** | A-I-01 と同一根。残すのは A-I-01 |
| P-M-1 | **Confirmed** | Minor | snapshot RPC の DROP `(uuid, uuid)` は本文に無い。overload 1 本なので fail-closed。Task 0 |
| P-M-2 | **Confirmed** | Minor | user トップレベルキー名未固定。再生成不変回帰は名前なしでロックできる。A-M-03 へ統合 |
| P-M-3 | **Confirmed** | Minor | 除外件数上限の整数。F-05 の照合契約とは別。Task 0 |
| P-M-4 | **Confirmed** | Minor | kill-switch が `true as const` と書いていない。A-M-01 へ統合 |
| A-I-01 | **Confirmed** | **Important** | 唯一の計画ブロッカー。§8 が契約を 1+3 から外し、`.strict()` が全 new_menu を 422 にする |
| A-M-01 | **Confirmed** | Minor | `true as const` 欠落。off スナップショットが完全沈黙は防ぐ。env default-off は残差 |
| A-M-02 | **Confirmed** | Minor | `SaveDraftNullableArgKeys` はリポジトリに無い。正本は `NullableDraftArgs`。Returns overlay 不要は正しい |
| A-M-03 | **Confirmed** | Minor | キー名未固定。再生成リーク自体は F-04 で閉じている |
| A-M-04 | **Confirmed** | Minor | 14 引数 GRANT リテラルと `rls_inventory` exact が本文に無い。migration / `db:test` が fail-closed |
| A-M-05 | **Confirmed** | Minor | 「隣に」と再生成 system マーカー回帰。受け入れ残差 / テスト穴。Important に上げない |

新規の独立 Important / Critical は無い。

## 4. 重大度を落とした理由（P-I-1 / P-I-2 / P-I-3）

### P-I-1: overlay 名 `SaveDraftNullableArgKeys` — 交差は `string` だが出荷しない

live の正本は `src/shared/types/database.ts` 20–36 行の `NullableDraftArgs` /
`SaveDraftArgs = Omit<GeneratedSaveDraftArgs, NullableDraftArgs> & { ... | null }`。
テスト側別名は `NullableDraftArg`（`database.test.ts` 170–177 行）。
`SaveDraftNullableArgKeys` はリポジトリに存在しない。

generated は `p_ingredient_preference: string`（`database.generated.ts` 3195 行）。novelty も再生成後は
同じ `string` になる。Omit せず `& { p_novelty_preference: string | null }` だけ足すと

`string & (string | null)` → `string`

となり、未選択 `null` は型として送れない。一次が言う「F-02 の失敗モード」そのものは、
**型の式としては正しい**。

ただし仕様に従う実装はここで止まって出荷できない。

1. spec §7 は `p_novelty_preference: null` が型として通ることを必須にしている。交差が `string` なら RED。
2. `buildSaveGenerationDraftArgs`（`planner-api.ts` 64–82 行）は
   `Database["public"]["Functions"]["save_generation_draft"]["Args"]` を返し、
   `p_ingredient_preference: input.ingredientPreference` と同型で null を渡す。
   Args が `string` のままなら `string | null` 代入で `tsc -b` が落ちる。
3. spec §3.4 は「union に足す **かつ** 明示フィールドを宣言する」と書いており、live の Omit パターンそのもの
   である。識別子さえ直せば交差は `string | null` になる。間違えて新規 union を横に切っても 1–2 で止まる。

仕様をなぞって `null` を黙って送れない成果物が出る経路は無い。敵対的 M-02 の Minor が正しい。

### P-I-2: factories / テストリテラル未列挙 — `z.infer` はキー必須、typecheck が全部拾う

Zod 4 の `.default(null)` は

- 入力（`z.input`）: キー省略可（`undefined`）
- 出力（`z.infer`）: キー必須（`NoUndefined<output>`。`$ZodDefaultInternals` が
  `$ZodTypeInternals<util.NoUndefined<core.output<T>>, core.input<T> | undefined>`）

`PlannerDraftInput` / `PlannerSubmission` はどちらも `z.infer`（`planner.ts` 157–159 行）。
現行 `ingredientPreference` がすでに同じ形で、`emptyDraft: PlannerDraftInput`（`planner-route.tsx` 96–108 行）
も factories の `submission`（`shared/testing/factories.ts` 237–249 / 285–297 行）もキーを書いている。
契約に `noveltyPreference` を足した瞬間、未列挙リテラルは **プロパティ不足で typecheck RED**。

一次が挙げた面（factories、`revalidation-adapter.ts` 126–139 行、
`filter-emergency-menus.ts` 145 行、`audience-step.tsx` 151–165 行の `draftLike`、
既存 `PlannerDraftInput` リテラル、`database.test.ts` overlay アサーション）は実在する。
裁決 F-02 が factories / emergency / revalidation を必須面にしていたのも事実。
しかしこれは **計画のファイルリスト項目** であって、仕様が列挙しないと誤動作が出荷される穴ではない。
`parse()` に渡す入力リテラル（キー欠損の互換テスト）は `z.input` 側なので、`.default(null)` のまま通る。
ここは問題にしない。

### P-I-3: 既存 13 引数 pgTAP — `db:test` が落ち、誤 GRANT も migration で止まる

live の 13 引数面は一次・敵対的の列挙どおり実在する。

- `rls_inventory.test.sql` 284 行: named 13 引数 exact + `authenticated EXECUTE`
- `03a_pantry_and_planner_drafts_hardening.test.sql` 86–88 行: 13 型 `to_regprocedure`
- `03_pantry_and_planner_drafts.test.sql` 41–42 行: `has_function` 13 型配列。65–67 行ほか位置 13 引数
- `ai_control_and_quota.test.sql` 1993 行ほか: 位置 13 引数

14 引数 CREATE のあとこれらを放置すると、`to_regprocedure` は NULL、位置呼びは
`function does not exist`、`rls_inventory` exact は不一致。**`db:test` は失敗する。**

spec §7 は新規 pgTAP（14 引数が 1 本、不正値、reserve が twist を返す）に加え、検証コマンドとして
`docker compose --profile test run --rm db-test` を指定している。未列挙のまま GREEN にはならない。

GRANT も fail-closed である。spec §3.2.6 は「現行と同じ内容で貼り直す」。現行 GRANT は 13 型
（`20260730120000` 120–125 行）。14 引数 CREATE の直後にこれを貼ると、対象関数が無く
Postgres の `GRANT/REVOKE ON FUNCTION` は失敗し、**migration 自体が止まる**。
誤 GRANT のまま 13 引数が残って出荷される経路は、正しい 13 引数 DROP（F-03 で閉じた）と両立しない。

裁決 F-03 が §7 必須とした面を本文から落としたのは計画の書き漏れだが、仕様ブロッカーではない。
14 引数 GRANT 型リストを §3.2 にリテラルで書き、§7 に `rls_inventory` exact を戻すのは Task 0 /
計画ファイルリストで足りる。敵対的 M-04 の Minor が正しい。

## 5. 残る Important — A-I-01 / P-I-4（同一根）

### 証明: `.strict()` + 契約より先の `mapSnapshot` は全 new_menu 422

`shared/contracts/planner.ts` 136–153 行。`plannerSubmissionSchema` は `discriminatedUnion` の
**両枝** が `.strict()`。

`netlify/functions/_shared/generation-context.ts`:

- 211–226 行 `mapSnapshot` は `plannerSubmissionSchema.parse({ ... ingredientPreference ... })`
- spec §3.3 はここに `noveltyPreference: row.novelty_preference` を足せと書く（値は `null` でもキーは常に付く）
- 141–142 行 `invalidRequest()` は HTTP 422 `invalid_request`
- 291–294 行 `mapSnapshot` の throw を `invalidRequest()` に写す
- 268 行以降 `loadGenerationContext` は new_menu 予約の提出スナップショットを読む唯一の入口

Zod 4 runtime: `.strict()` は未知キーを `unrecognized_keys` で拒否する（手元再現:
`{ a: "x", noveltyPreference: "twist" }` → `success: false`）。`null` でもキーがあれば拒否する。
twist である必要は無い。

Zod 4 型: `node_modules/zod/v4/classic/schemas.d.ts` 25 行
`parse(data: unknown, ...): core.output<this>`。object literal にキーを足しても **typecheck は通る**。
`GenerationContext["submission"]` は `PlannerSubmission` だが、`parse` の戻りは旧 schema の出力型のままなので
代入も通る。spec §3.3 が「§3.1 の追加がそのまま型として流れる」と書いているのは型の話であり、
runtime の `.strict()` 拒否とは別である。

§8 の文言どおりの経路:

1. 段 1 = migration + 型再生成。段 3 = `snapshotRowSchema` と `mapSnapshot`。**「1 と同じ Task 内」**。
   「RPC が新しい列を返すのに strict schema が古いままの状態を commit してはならない」は
   **snapshotRowSchema** だけを禁じており、`plannerSubmissionSchema` には触れていない。
2. 段 2 = 契約（`planner.ts`）は番号リストのあいだに置かれ、同一 Task に含まれていない。
3. 「各段は … Conventional Commit で閉じる」。

1+3 を契約より先に commit すると、RPC は新列を返し `snapshotRowSchema` は通り、`mapSnapshot` が
`.strict()` な submission へ未知キー `noveltyPreference` を渡す。**すべての new_menu が 422**。
これは閉じた F-01（RPC 列追加 vs 古い `snapshotRowSchema`）と同クラスで、改訂の Task 分割が
`mapSnapshot` 側に再導入する。

§7 のサーバー必須は「`snapshotRowSchema` が新しい列を含む行を parse できること」だけ。
`mapSnapshot` → `plannerSubmissionSchema` の round-trip はロックされない。孤立した schema テストだけ
GREEN にして 1+3 を commit できる。

併設の `generation-context.test.ts` は `loadGenerationContext` を通る（198 行〜）。fixture `snapshot`
（54–70 行）に `novelty_preference` が無く、schema 必須化だけで RED、fixture を足せば次に
`mapSnapshot` の `.strict()` で RED になる。**走らせれば止まる。** しかしそれは仕様の必須面ではなく、
焦点検証を schema 単体に狭めた読みを §7 / §8 が許している。typecheck も助けない。ここを Important に残す。

逆順（契約だけ先、RPC は旧）は 422 にならない。仕様はこちらの安全順を指定していない。

## 6. キー名は再生成不変をロックできる（P-M-2 / A-M-03）

現行 new_menu exact keys は `generation-prompt.test.ts` 212–219 行
（`preferences` / `members` / `pantry` / `validationVersions` / `seasonContext` / `recentDishHints`）。
再生成は `...base` を使い `recentDishHints` も載せない（537–542 行、テスト 538 行）。

再生成不変回帰は payload 全体比較、または「現行再生成キー集合以外が無い」で名前なしにロックできる。
kill-switch off も「現行 6 キー以外が無い」で書ける。F-04 のリーク再発防止にキー名は不要。

残るのは new_menu 正のスナップショットと dual-channel テストが実装者の選んだ名前に依存すること、
既存キーとの衝突（`preferences` 等を再利用すると上書き）である。合理的な新規名なら衝突しない。
名前 1 語は Task 0。Important に上げない。

## 7. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| P-I-4 | **Duplicate** | A-I-01 と同一根。残すのは A-I-01 |
| P-I-1 | **Duplicate（Minor）** | A-M-02。交差 `string` は型として真だが出荷しない |
| P-I-3 | **Duplicate（Minor）** | A-M-04。`db:test` / migration が強制する |
| P-M-2 | **Duplicate（Minor）** | A-M-03 |
| P-M-4 | **Duplicate（Minor）** | A-M-01 |
| snapshot Returns に novelty overlay が要る | **False positive** | 現行 `ingredient_preference` も generated Returns は `string`。runtime は `snapshotRowSchema` の `.nullable()`。改訂が Returns overlay に触れないのは正しい（A-M-02） |
| 1+3 は typecheck で止まる | **False positive（反論側）** | `parse(data: unknown)`。余剰キーは型エラーにならない |
| `.strict()` は余剰キーを落とすだけ | **False positive（反論側）** | Zod `.strict()` は拒否し、422 になる。初回裁決どおり |
| overlay 不要 | **False positive（反論側）** | Args は generated が `string`。未選択 `null` 送信に overlay が要る。F-02 は閉じた。識別子誤りは Minor |
| F-01 の 422 が再開 | **False positive** | RPC vs `snapshotRowSchema` は §3.3 同一 Task で閉じた。残るのは `mapSnapshot` vs `plannerSubmissionSchema` という別段 |
| 安全ハードゲート / fingerprint / quota / HMAC / カタログブラウザ混入 / temperature / 2 パス | **False positive のまま** | 改訂は対象外判断を維持。再掲しない |
| A-M-04 `role=side` / 辞書の隙間 / 結果画面非表示 / 未選択 2 択 | **Accepted residual** | 初回どおり Important に上げない |
| 既存 snapshot exact JSON | **問題にしない** | 明示 `jsonb_build_object` のため列追加だけでは落ちない。twist 複写は §7 の新規 pgTAP |

## 8. 計画ブロッカー（一意な根）

**1 件だけ。**

1. **§8 が契約を migration + `mapSnapshot` から外している**（A-I-01 / P-I-4）
   - §8 の 1・2・3 を **同一 Task かつ同一 commit** にする。または順序を **2 → 1+3** に固定する。
   - §3.3 の必須面に `submissionCommonShape` / `plannerSubmissionSchema` を明示する。
     `mapSnapshot` が渡すキーは契約が受け入れてからでなければ commit しない、と否定する。
   - §7 に `mapSnapshot` が `novelty_preference: "twist"`（および `null`）の行を
     `PlannerSubmission` まで通す 1 本を足す。`snapshotRowSchema` 単体では不足。

これ以外を仕様ブロッカーにしない。

### 計画ファイルリスト / Task 0（ブロッカーではない）

- overlay 正本名 `NullableDraftArgs`（テスト `NullableDraftArg`）。Omit 対象と明示フィールドの両方へ
  `p_novelty_preference`（A-M-02）
- 14 引数 GRANT 型リストを §3.2 にリテラルで書く。`rls_inventory` exact、`to_regprocedure`、
  位置 13 引数呼び出しを計画のテスト面へ（A-M-04）
- `z.infer` 必須化で落ちる factories / emergency / revalidation / テストリテラル
  （typecheck が強制。計画にファイルを書けば足りる）
- user payload キー名 1 語（A-M-03）
- 除外リスト件数上限の整数（P-M-3）
- `NOVELTY_HINTS_ENABLED = true as const`（A-M-01）
- `get_ai_generation_submission_snapshot(uuid, uuid)` DROP リテラル（P-M-1）
- 再生成 system に `NOVELTY_SYSTEM_MARKER` が混入しない回帰（A-M-05）。user payload 不変だけでは不足

## 9. 修正後判定

A-I-01 を spec §3.3 / §7 / §8 に固定するまで Implementation Plan 作成は禁止。
それが入れば Critical 0・Important 0 で APPROVE してよい。
F-01〜F-05、安全評価・quota・fingerprint・temperature・2 パス・結果画面非表示は、
現行 Spec の対象外判断のまま維持する。
