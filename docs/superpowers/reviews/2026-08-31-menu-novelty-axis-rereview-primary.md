# 献立ひねり軸 — 改訂一次レビュー (3a2e52d0)

- 日付: 2026-08-31
- 対象: spec @ 3a2e52d0
- 判定: **REVISE — Critical 0, Important 4, Minor 4**

## 1. Verdict

F-01・F-03（DROP 本体）・F-04・F-05 の契約そのものは改訂 spec に固定され、現行正本と矛盾しない。
F-02 の 4 面（overlay / planner-api / autosave 空判定 / planner-route）も本文に入った。

ただし改訂が **現行に存在しない overlay 型名** を書き、裁決が §7 必須とした
**typecheck / db:test 面** を落とし、§8 の Task 分割が §3.1 と §3.3 を同時 commit しない読みを許す。
この 3 系統は計画に落とすと未選択 `null` が型で送れない、`db:test` が既存 13 引数呼び出しで落ちる、
中間 commit で全 new_menu が 422 になる、のいずれかになる。Implementation Plan 作成はまだ早い。

## 2. F-01〜F-05 閉じ確認

### F-01 生成到達経路 — **Closed**

- Spec §3.2 の 4（91–98 行）は snapshot 複写の正本を
  `20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql` の INSERT とし、
  `save_generation_draft` ではないと明記する。現行 INSERT は同ファイル 155–165 行。
  20260808 より後に `reserve_ai_generation` を再定義する migration は無い。
- Spec §3.2 の 5（99–100 行）は `get_ai_generation_submission_snapshot` の
  `RETURNS TABLE` と select 句へ `novelty_preference text` を足す。現行 RETURNS は
  `20260730120000_ingredient_preference.sql` 605–624 行。
- Spec §3.3（107–112 行）は `snapshotRowSchema` が `.strict()` であること、
  列追加と schema / `mapSnapshot` を同じ Task で閉じることを書く。現行 schema は
  `netlify/functions/_shared/generation-context.ts` 63–81 行（`.strict()`）、
  `mapSnapshot` は 211–226 行、RPC 呼び出しは 275–277 行。

DROP 引数 `(uuid, uuid)` は本文に無い（Minor）。到達経路の誤帰属自体は閉じている。

### F-02 クライアント永続面 — **Partial**

閉じた面:

- Spec §3.4 は overlay・`planner-api.ts` の select / `mapPlannerDraft` /
  `buildSaveGenerationDraftArgs`・autosave の明示コピーと空判定・`planner-route.tsx` の
  初期値 / hydrate / 送信コピーを列挙する。
- keepalive は helper 名で書いていないが、現行
  `src/features/planner/planner-api.ts` 110–127 行は
  `buildSaveGenerationDraftArgs` をそのまま POST する。helper 更新で届く。
- `isEmptyPersistableInput` は
  `src/features/planner/use-draft-autosave.ts` 130–146 行に実在する。
  `fields.ingredientPreference === null &&` と同型の連言であり、spec が書く
  「ひねりだけ選ぶと空扱いで保存されない」失敗は現行どおり成立する。
- `planner-route.tsx` の `emptyDraft` は 95–108 行、hydrate は
  `toPlannerDraftInput` 135–150 行、送信は `submissionCandidate` 1767–1780 行。

閉じきれていない面:

- Spec §3.4（123–125 行）の overlay 型名は `SaveDraftNullableArgKeys`。
  現行は `src/shared/types/database.ts` 20–27 行の `NullableDraftArgs`。
  テスト側の別名は `src/shared/types/database.test.ts` 170–177 行の `NullableDraftArg`。
  `SaveDraftNullableArgKeys` はリポジトリに存在しない。
- 裁決 F-02 が挙げた factories / emergency・revalidation ダミー /
  既存 `PlannerDraftInput` リテラルは §3.4 / §7 に無い。`z.infer` 出力は
  `.default(null)` でもキー必須のため、未列挙のまま typecheck が落ちる（後述 I-2）。

### F-03 DROP シグネチャ — **Closed**（db:test 面は残る）

Spec §3.2 の 3（78–84 行）の DROP リテラル:

```
(bigint, text, text[], text, text, uuid[], smallint, smallint,
 text, text, text[], text, jsonb)
```

手元カウント 13。現行 GRANT / REVOKE も 13
（`20260730120000_ingredient_preference.sql` 120–125 行）。内訳は
`bigint, text, text[], text, text, uuid[], smallint, smallint, text, text, text[], text, jsonb`。
`20260730120000` の DROP（19–21 行）は 12 引数で、現行関数を落とさない。
generated Args も 13 キー
（`src/shared/types/database.generated.ts` 3189–3204 行。
`p_ingredient_preference: string` を含む。nullable ではない）。

DROP 本体の誤コピー問題は閉じた。裁決が §7 必須とした `rls_inventory` exact と
既存 pgTAP の 13 位置引数は改訂 §7 に無い（後述 I-3）。

### F-04 PromptPreferences 共有 — **Closed**

- Spec §5.1（154–160 行）は `PromptPreferences` を拡張せず、
  `recentDishHints` と同じ `kind === "new_menu"` 分岐で注入すると書く。
  現行注入点は `netlify/functions/_shared/generation-prompt.ts` 21–32 行
  （`PromptPreferences`）、353–370 / 453–462 行（base）、493–523 行（new_menu 再 serialize）。
- Spec §7（216 行）と §8 の 6（238–239 行）は再生成 user payload 不変の回帰テストを必須にする。
- kill-switch off で段落とキーの両方を落とす（164–166 行）。多様性の「off でも `[]`」とは意図的に違う。

キー名と `true as const` は本文に無い（Minor / 確認済み残差）。再生成を黙って変える設計は閉じた。

### F-05 辞書照合 — **Closed**

- Spec §6（197–201 行）は `normalizeFoodText` の完全一致、漢字・かな非畳み、
  alias 列挙を書く。現行 `shared/safety-pure/normalize-food-text.ts` 16–28 行は
  NFKC・カタカナ→ひらがな・小文字・Cf 除去・区切り除去のみ。漢字とかなは畳まない。
- 裁決の実測（`豚肉` ≠ `ぶた肉`、`ブタ` → `ぶた`）と一致する。部分一致も新しい正規化関数も禁止している。

件数上限の整数は未固定。裁定どおり Minor（Task 0）。

## 3. Critical / Important / Minor (new or remaining)

### Critical

なし。

### Important

#### I-1: overlay 型名が現行識別子と不一致（Omit 漏れで `null` が型として送れない）

- Spec §3.4（123–125 行）は `SaveDraftNullableArgKeys` に `"p_novelty_preference"` を足せと書く。
- 現行 overlay は `src/shared/types/database.ts` 20–36 行の `NullableDraftArgs` /
  `SaveDraftArgs`。一次・敵対的レビューは正しい名前を使っていた。改訂が別名を導入した。
- generated は `p_ingredient_preference: string`（`database.generated.ts` 3195 行）。
  `Omit` 対象に入れず `& { p_novelty_preference: string | null }` だけ足すと、
  `string & (string | null)` は `string` になり、未選択 `null` が型で送れない。
  これは F-02 が閉じたはずの失敗モードそのもの。
- 実装者は存在しない記号を探し、新しい union を横に作るか、Omit せずフィールドだけ足す。

必要な修正: 正本名 `NullableDraftArgs`（および test の `NullableDraftArg`）に直す。
`p_novelty_preference` を **Omit 対象と明示フィールドの両方** に入れると書く。

#### I-2: 契約キー追加後に typecheck が落ちるリテラル面が未列挙

`PlannerDraftInput` / `PlannerSubmission` は `z.infer` 出力なので、
`.default(null)` でも `noveltyPreference` は必須キーになる。Spec §3.4 が列挙するのは
`planner-route.tsx` の本番 `emptyDraft` まで。次は未記載のまま `npm run typecheck` が落ちる。

- `shared/testing/factories.ts` 237–249 行 / 285–297 行の `submission`
- `netlify/functions/_shared/revalidation-adapter.ts` 126–139 行（本番ダミー）
- `shared/emergency/filter-emergency-menus.ts`（`ingredientPreference: null` ダミー）
- `src/features/planner/components/audience-step.tsx` 151–165 行の `draftLike`
- 既存テストの `PlannerDraftInput` リテラル
  （`planner-wizard.test.tsx` 22 行、`use-draft-autosave.test.tsx` 7 行、
  `planner-api.test.ts` 86–98 / 110–123 行、`accessibility.test.tsx` 99 行 ほか）
- overlay テスト `database.test.ts` 170–177 行の `NullableDraftArg` と
  192–196 行の generated との一致アサーション

裁決 F-02 は factories / emergency / revalidation を必須面にしていた。改訂 §7 は
`planner.test.ts` と `database.test.ts` の null 通るテストだけ。
focused typecheck を指定検証にしている以上、未列挙のまま Plan に落とすと Task が RED で止まる。

#### I-3: `db:test` が落ちる現行 13 引数面が §7 に無い

14 引数 CREATE のあと、既存呼び出しは引数個数で関数が解決できず失敗する。

- `supabase/tests/database/rls_inventory.test.sql` 284 行は
  13 引数 exact シグネチャを `authenticated EXECUTE` として固定。
- `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql`
  86–88 行の `to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text,text[],text,jsonb)')`
  と、195 行以降の 13 位置引数呼び出し。
- `supabase/tests/database/03_pantry_and_planner_drafts.test.sql` 65–67 行ほか同様。
- `supabase/tests/database/ai_control_and_quota.test.sql` の
  `save_generation_draft(...)` 呼び出し（1993 行ほか）。

Spec §7（217–222 行）は新規 pgTAP（列 check・14 引数が 1 本・不正値・reserve が
`twist` を返す）だけ。裁決 F-03 が「GRANT/REVOKE、pgTAP 位置引数、`rls_inventory`
exact を §7 必須」とした面は改訂で落ちた。§7 が
`docker compose --profile test run --rm db-test` を指定しているので、未列挙は計画停止。

既存 snapshot exact JSON
（`ai_control_and_quota.test.sql` 1168–1253 行）は明示 `jsonb_build_object` のため、
列追加だけでは落ちない。新規 twist テストは §7 にある。ここは問題にしない。

#### I-4: §8 の段分けが §3.3 の same-Task 制約と食い違い、中間 commit で全 new_menu が 422 し得る

- Spec §3.3（107–112 行）は RPC 列追加と `snapshotRowSchema` / `mapSnapshot` を
  同じ Task で閉じ、`mapSnapshot` に `noveltyPreference: row.novelty_preference` を足す。
- Spec §3.1 の `submissionCommonShape` は `.strict()`
  （`shared/contracts/planner.ts` 136–153 行）。`mapSnapshot` は
  `plannerSubmissionSchema.parse({...})`（`generation-context.ts` 211–226 行）。
- Spec §8（229–237 行）は 1=migration、2=契約、3=schema/map（**1 と同じ Task**）。
  2 を 1+3 に含めるとは書いていない。「各段は commit で閉じる」。

1+3 を契約より先に commit すると、RPC は新列を返し schema は通すが、
`mapSnapshot` が `.strict()` な submission へ未知キーを渡して `invalidRequest()` → HTTP 422
（`generation-context.ts` 141–142、282 行）。これは F-01 が閉じた「全 new_menu 422」と
同じクラスで、改訂の Task 分割が再導入する。

必要な修正: §8 の migration Task に §3.1 契約（`draftShape` /
`submissionCommonShape`）を含める、または 3 を「1 と 2 のあと、同じ commit」と書く。

### Minor

#### M-1: `get_ai_generation_submission_snapshot` の DROP シグネチャ `(uuid, uuid)` が本文に無い

Spec §3.2 の 5（99–100 行）は DROP → CREATE と RETURNS 追加だけ。
現行は `drop function if exists public.get_ai_generation_submission_snapshot(uuid, uuid)`
（`20260730120000_ingredient_preference.sql` 603 行）。Args は
`database.generated.ts` 2932–2933 行どおり `p_request_id` / `p_user_id`。
overload は 1 本なので `DROP FUNCTION name` でも落ちるが、RETURNS 変更には DROP が必要で、
正本リテラルを書いておけば足りる。Task 0。

#### M-2: user payload のトップレベルキー名が未固定

Spec §5.1（164 行）は「除外リストを payload のトップレベルキーとして足す」とだけ書く。
現行 new_menu の exact keys は
`netlify/functions/_shared/generation-prompt.test.ts` 212–219 行
（`preferences` / `members` / `pantry` / `validationVersions` / `seasonContext` /
`recentDishHints`）。キー名が無いとテスト契約が割れる。名前を 1 語ロックすれば足りる。

#### M-3: 除外リスト件数上限の整数が未固定

Spec §5.1（152 行）と §6（203 行）は「上限定数」のみ。裁定 P-M-1 どおり Task 0。
照合契約（F-05）とは別。

#### M-4: kill-switch が `true as const` と書いていない

Spec §5.1（149 行）は `NOVELTY_HINTS_ENABLED` とだけ。現行多様性は
`netlify/functions/_shared/diversity-hints.ts` 6 行 `true as const`（env ではない）。
off テストは const を mock する
（`generation-prompt-diversity-off.test.ts`）。一文あれば env 読みを防げる。裁定 A-M-03。

## 4. 確認したが問題にしない事項

- 安全ハードゲート・fingerprint / quota / HMAC 非混入、導入前 snapshot の
  `.default(null)`、カタログの Functions 閉じ、temperature / 2 パス対象外。
  偽陽性のまま。改訂は対象外判断を維持している。
- A-M-04 `role=side` 付け替え、結果画面非表示、辞書の隙間（豚こま肉 等）。
  受け入れ残差。Important に上げない。
- §4「材料の使い方の隣に」（136 行）対現行縦積み。
  `review-step.tsx` 523–627 行は `.field` を `stack wizard-details-body` に縦に並べ、
  コメント（523 行）が「横に流れないよう縦積み」と固定。`src/styles.css` 1224–1227 行は
  `.field { display: grid }`。320px 非スクロール制約（spec 141 行）があるので、
  「隣に」を横並び必須とは読まない。裁定 A-M-01 どおり Minor 相当で、今回は再掲しない。
- 未選択を視覚化しない 2 択（§4）。`null === standard` で機能バグではない。裁定 A-M-02。
- `PlannerFieldName` / wizard テストパス未記載。
  `src/features/planner/model/planner-wizard.ts` 16–28 / 109–146 行。
  nullable enum は未知 path を fail-closed で握る。裁定 P-M-3。typecheck は落とさない。
- snapshot exact JSON の既存アサーションは明示キーのため列追加だけでは落ちない。
  twist 複写は §7 の新規 pgTAP でカバーされる。
- `NOVELTY_HINTS_ENABLED` を env と読むこと自体は、off 時 dual-channel を §5.1 が閉じたので
  F-04 の再発ではない（M-4 に分離）。
- `isEmptyPersistableInput` の関数名を spec が書いていないこと。条件式の失敗モードは正しい。
- keepalive を planner-api helper 経由と読めること。
- generated `database.generated.ts` 手編集禁止（spec 103 行）は現行どおり。
