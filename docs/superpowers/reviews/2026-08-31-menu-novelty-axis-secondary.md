# 献立ひねり軸（noveltyPreference）設計 — 二次検証

- 日付: 2026-08-31
- 対象Spec: `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`
- 入力: 同日付の一次レビュー、敵対的レビュー
- 実施者: 両レビューと別スレッドの読み取り専用 Reviewer
- 判定: **REVISE — Critical 0、統合後の計画ブロッカーは Important 5 系統（snapshot 複写経路、クライアント永続面、DROP シグネチャ、PromptPreferences 共有、辞書照合）。仕様の骨格（fail-open / 再生成 system 非改変 / 安全・quota・fingerprint 非入力）は現行実装と矛盾しない。**

## 1. 総合 Verdict

仕様の製品判断（prompt 専用、`twist` のときだけ new_menu system へ段落、2 パス禁止、結果画面非表示）は現行コードと整合する。計画前に直す必要があるのは、`ingredientPreference` 導入の**実際の到達経路**を仕様が `save_generation_draft` と確認画面 UI に誤って閉じている点である。

独立に再読した結果:

- `save_generation_draft` は `generation_drafts` だけを更新し、submission snapshot へは写さない。
- snapshot を書く現行正本は `20260808120000` の `reserve_ai_generation` INSERT。それ以降に reserve を置き換える migration は無い。
- 現行 `save_generation_draft` は **13 引数**。`20260730120000` の DROP は当時の **12 引数**。Postgres の `DROP FUNCTION` はシグネチャ単位なので、古い DROP をなぞると 13 引数が残る。
- `snapshotRowSchema.strict()` 失敗は `invalidRequest()` → **422**。
- `PromptPreferences` は new_menu / 再生成で同一 builder。フィールド追加は再生成 user JSON を黙って変える。
- `normalizeFoodText("豚肉") !== normalizeFoodText("ぶた肉")`。仕様 §6 の吸収例は関数単体では成立しない。

これらを仕様へ固定するまで Plan に進めるべきではない。安全評価・quota・HMAC を壊す Critical は再現しなかった。

## 2. 再確認した事実

- `save_generation_draft` 最終定義は `supabase/migrations/20260730120000_ingredient_preference.sql` 23–116 行。INSERT/UPDATE 先は `public.generation_drafts` のみ。`generation_draft_submission_versions` への参照は無い。
- 同ファイル 19–21 行の DROP は 12 引数 `(bigint, text, text[], text, text, uuid[], smallint, smallint, text, text[], text, jsonb)`。CREATE は 13 引数（`p_ingredient_preference text` 込み、23–27 行）。GRANT も 13 引数（120–125 行）。
- 現行 Args は `src/shared/types/database.generated.ts` 3189–3204 行の 13 キー。`p_novelty_preference` は無い。
- pgTAP も 13 引数を正とする（`supabase/tests/database/03_pantry_and_planner_drafts.test.sql` 41–42 行、`rls_inventory.test.sql` 284 行、`03a_pantry_and_planner_drafts_hardening.test.sql` 86–88 行の `to_regprocedure`）。
- `reserve_ai_generation` を `create or replace` している最後の migration は `20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql`（25 行〜）。INSERT 列リストは 155–165 行で `ingredient_preference, avoid_ingredients, memo, pantry_selections` まで。20260808 より後に reserve を再定義する SQL は無い。
- snapshot 読取 RPC の最終 RETURNS TABLE は `20260730120000_ingredient_preference.sql` 605–651 行。引数は `(uuid, uuid)`。`novelty_preference` は無い。
- `netlify/functions/_shared/generation-context.ts` 63–81 行 `.strict()`。282–283 行で失敗すると `invalidRequest()`（141–142 行、HTTP 422）。`mapSnapshot`（211–226 行）は `ingredientPreference` まで。生成は `get_ai_generation_submission_snapshot` のみ（275–277 行）。`generation-context.test.ts` 209–213 行が `generation_drafts` 非参照を固定。
- pgTAP の snapshot exact JSON は `ai_control_and_quota.test.sql` 1168–1253 行。`ingredient_preference` まで。
- Postgres Meta は RPC の nullable 引数を非 null と誤る。`p_ingredient_preference: string`（generated 3195 行）に対し overlay が `| null`（`src/shared/types/database.ts` 20–36 行）。テーブル Row の `ingredient_preference` は generated 側でも既に `string | null`（1305 行）。overlay が要るのは **Args の null 送信**。
- 下書きクライアントは明示列: `planner-api.ts` 25–45 / 56 / 64–82 / keepalive 110–128 行。`toDraftInputFields`（`use-draft-autosave.ts` 66–80 行）。`emptyDraft` / `toPlannerDraftInput` / `submissionCandidate`（`planner-route.tsx` 96–108 / 135–149 / 1767–1780 行）。
- `PromptPreferences`（`generation-prompt.ts` 21–32 行）と `buildBaseGenerationMessages`（353–370・459 行付近）は kind 非依存。`buildGenerationMessages` は new_menu だけ system を差し替え（493–543 行）。再生成は `...base` の user JSON をそのまま使う。
- 多様性 kill-switch は `DIVERSITY_HINTS_ENABLED = true as const`（`diversity-hints.ts` 6 行）。off 時は段落も `recentDishHints` も空（`generation-prompt.ts` 498–505 行、`generation-prompt-diversity-off.test.ts` 62–76 行）。env ではない。`HOUSEHOLD_KITCHEN_PROMPT_ENABLED` も同型（`household-kitchen-prompt.ts` 7 行）。
- `normalizeFoodText`（`shared/safety-pure/normalize-food-text.ts` 16–28 行）は NFKC・カタカナ→ひらがな・小文字・Cf 除去・空白句読点除去。漢字とかなの相互畳みは無い。実測: `豚肉`→`豚肉`、`ぶた肉`→`ぶた肉`、`ブタ`→`ぶた`、`ブタ肉`→`ぶた肉`、`豚こま切れ`→`豚こま切れ`。`豚肉 === ぶた肉` は false。`ブタ === ぶた` は true。
- 確認画面の追加条件は縦積み（`review-step.tsx` 523–524・591 行）。材料の使い方は空 option「指定なし」（619 行、`ingredientPreferenceLabel(null)`）。
- `PlannerFieldName` / `stepByField` は `ingredientPreference` まで（`planner-wizard.ts` 16–28・109–146 行）。コンポーネントテストは `src/features/planner/components/planner-wizard.test.tsx` 920–958 行（一次のパス表記はファイル名ずれ。中身は存在する）。
- fingerprint はメンバー安全のみ（`shared/safety/fingerprint.ts` 42–72 行）。HMAC canonical は draftId/revision 等で下書きフィールド値を含めない（`generation-command-integrity.ts` 38–55 行）。integrity_context は target_mode / servings / member ids（`generation-integrity-context.ts` 9–16 行）。
- `validate-generated-menu.ts` 233–237 行は dinner で main/side/soup の**存在**のみ。`ingredientPreference` 参照は無い。
- `preference_snapshot` は submission 丸ごと（`generation-context.ts` 341・443 行）。
- `planner.ts` 92–94・127–128 行の `.default(null)` は仕様 §3.1 と同型。

## 3. 元指摘の二次判定

| 元ID | 判定 | 最終severity | 統合判断 |
| --- | --- | --- | --- |
| P-I-1 | Confirmed | Important | snapshot 複写・読取 RPC・`.strict()` が仕様から欠け、実装どおり進めると twist が常に null、または全 new_menu が 422。正本は 20260808 reserve の INSERT 列追加。 |
| P-I-2 | Duplicate | — | A-I-02 と同じクライアント永続面。A-I-02 の方が route の hydrate/送信列挙まで含む。 |
| P-I-3 | Confirmed | Important | DROP 対象は現行 13 引数。20260730 の 12 引数 DROP をなぞると overload。reserve 本体の再利用禁止もここに固定。 |
| P-M-1 | Confirmed | Minor | 除外件数の整数が無い。Task 0 で固定すれば足り、単独では計画停止理由にしない。 |
| P-M-2 | Duplicate | — | A-I-05 の照合アルゴリズム（正規化後の完全一致）に包含。 |
| P-M-3 | Confirmed | Minor | field 名前空間と wizard テストは仕様 §4/§7 に無い。パスは `components/planner-wizard.test.tsx`。未登録でも enum select なら 422 にはなりにくい。 |
| P-M-4 | Duplicate | — | A-I-04 の kill-switch dual-channel に包含。 |
| A-I-01 | Duplicate | — | P-I-1 と同じ根。save が snapshot を書かない事実は P-I-1 の成立条件の根拠として採用。 |
| A-I-02 | Confirmed | Important | SELECT 文字列・RPC 引数・autosave 写し・overlay。generated 再生成だけでは `null` 未選択を型で送れない。 |
| A-I-03 | Duplicate | — | P-I-3 と同じ根。本文の「現行 14 引数」は誤カウント（live は 13）。引用した DROP リスト自体は 12 引数で正しい。 |
| A-I-04 | Confirmed | Important | `PromptPreferences` 追加は再生成 user JSON を変える。§2.2「触らない」と §5.1「user payload にも載せる」は現行 builder では両立しない。kill-switch off は多様性と同型で user 側も落とす必要がある。 |
| A-I-05 | Confirmed | Important | 仕様の「豚肉／ぶた肉／ブタを吸収」は `normalizeFoodText` 単体では偽。alias 列挙が唯一の吸収手段。完全一致と複数メインの和集合も未固定。 |
| A-M-01 | Confirmed | Minor | 「隣に」を同一行と読むと 320px を割り得る。現行は縦積み。仕様は「材料の使い方の次の `.field`」と書く。 |
| A-M-02 | Confirmed | Minor | 2 択だけだと未選択がラベル上見えない。挙動は `null === standard` なので機能バグではない。 |
| A-M-03 | Confirmed | Minor | kill-switch を env と読むと default-off が混入し得る。現行同型は `true as const`。一文で足りる。 |
| A-M-04 | Accepted residual | — | role 付け替えは現行 hard gate 対象外。仕様の fail-open / 効きの弱さと一致。矛盾は無い。 |
| A-M-05 | Confirmed | Minor | `selected_only` と twist の同時指示はモデル任せ。§5.2.5 の staple success が勝つなら安全穴ではない。preferences 内の優先を一文あると実装が割れない。 |

## 4. 統合すべき根本原因

1. **生成到達経路の誤帰属** — 「submission snapshot へ写す」は `save_generation_draft` ではなく、現行 `reserve_ai_generation`（20260808120000）の INSERT 列リストと `get_ai_generation_submission_snapshot(uuid, uuid)` の RETURNS TABLE。Functions 側は `snapshotRowSchema` / `mapSnapshot`。`.strict()` は余剰キーを 422 にする。20260730 の reserve 本体で置き換えない。
2. **下書きクライアント永続面** — overlay `NullableDraftArgs` に `p_novelty_preference`、`planner-api` の select / map / RPC / keepalive、`toDraftInputFields`、`planner-route` の emptyDraft / toPlannerDraftInput / submissionCandidate、factories、emergency ダミー。`database.generated.ts` は再生成のみ（手編集禁止は維持）。
3. **DROP シグネチャは現行 13 引数** — `(..., p_budget_preference text, p_ingredient_preference text, p_avoid_ingredients text[], p_memo text, p_pantry_selections jsonb)`。12 引数 DROP は overload を残す。GRANT/REVOKE、pgTAP 位置引数、`rls_inventory` の exact シグネチャを §7 必須にする。
4. **PromptPreferences は再生成と共有** — 載せるなら「再生成 user JSON に値が残っても段落は効かない」と製品として書くか、再生成 payload から明示的に落とす。kill-switch off は system 段落と user キーの両方を落とす（多様性と同型）。`expectExactKeys` をテスト契約にする。
5. **辞書照合** — `normalizeFoodText` は漢字↔かなを畳まない。吸収は `ingredientAliases` に正規化後の別表記を列挙すること。照合は各メイン食材と各 alias の正規化後**完全一致**（部分一致禁止）。複数メインは `stapleDishes` の和集合、その後に件数上限。上限整数は仕様か Task 0 で固定。

## 5. 偽陽性・重複

- **A-I-01 = P-I-1**: 根は snapshot 経路の欠落。save 非複写は成立するが別 ID にしない。
- **P-I-2 = A-I-02**: クライアント列挙漏れ。A-I-02 を残す。
- **A-I-03 = P-I-3**: DROP 対象の誤り。A-I-03 の「14 引数」だけが誤記で、overload リスク自体は真。P-I-3 を残す。
- **P-M-2 / P-M-4**: それぞれ A-I-05 / A-I-04 に包含。
- **A-M-04**: 効きの残差として仕様 §9 が既に受容。Important に上げない。
- **overlay 不要、という反論は不成立**: テーブル Row は nullable で出るが、RPC Args の `p_ingredient_preference` は generated が `string`。未選択 `null` を送るには overlay が要る。
- **`.strict()` が余剰キーを落とす、は不成立**: Zod `.strict()` は未知キーを拒否し、`loadGenerationContext` は 422 にする。
- **後続 migration が reserve を置き換えた、は不成立**: 20260808 が最終。
- **kill-switch が既に env、は不成立**: 現行同型は `true as const`。仕様が関数名だけだと env 実装が混入し得る、という Minor は残す。
- 安全 fingerprint / quota / HMAC 混入、novelty-only で他ゲート無効化、温度送信、2 パス、カタログのブラウザ混入は、両レビューどおり現行コードでは成立しない。

## 6. 新規指摘

計画を止める Important 以上の新規は無い。両レビューが列挙した必須面の外側で、実装が黙って壊れる経路は確認できなかった。

参考（Minor、仕様一文で足りる）:

- `planner-wizard.ts` 11 行の「11フィールド」コメントは軸追加で陳腐化する。
- `planner-api.test.ts` 144–158 行の keepalive JSON 閉集合は新キーで落ちる（A-I-02 のテスト面）。
- e2e の `save_generation_draft` mock は部分 assert が多く、キー追加だけでは壊れない（敵対的 §7 のとおり攻撃ではない）。

## 7. 計画前に Spec へ書くべき修正（確定）

1. §3.2: `generation_drafts` / `generation_draft_submission_versions` の列 CHECK に加え、**現行 13 引数** `save_generation_draft` を DROP→CREATE（14 引数目として `p_novelty_preference`）。値検証は `p_ingredient_preference` と同型（`22023` / `invalid_draft_save`）。save 本文は draft 列のみ、と否定する。
2. §3.2 / §8: `reserve_ai_generation` は **20260808120000 の INSERT/SELECT リストに `novelty_preference` を 1 列足す**。20260730120000 の reserve 本体を再利用しない。
3. §3.2: `get_ai_generation_submission_snapshot(uuid, uuid)` を DROP→CREATE し RETURNS に `novelty_preference` を足す。
4. §5 / §8: `snapshotRowSchema` と `mapSnapshot` を必須面にする。RPC が増やした列を `.strict()` が 422 にすることは明記する。
5. §3 / §4 / §8: クライアント必須面（`database.ts` overlay、`planner-api` select/map/RPC/keepalive、`toDraftInputFields`、`planner-route` の emptyDraft / toPlannerDraftInput / submissionCandidate、factories、emergency ダミー、`PlannerFieldName`）。
6. §7: pgTAP の列 CHECK、13→14 引数、位置引数呼び出し、`rls_inventory` シグネチャ、`ai_control_and_quota.test.sql` の snapshot exact JSON。
7. §5.1: 再生成 user JSON の扱いを二者択一で固定。kill-switch は `true as const`（env ではない）。off 時は段落も preferences キーも落とす。
8. §6: 照合は正規化後の alias **完全一致**。漢字かなの吸収は alias 列挙。複数メインは和集合のち件数上限。上限整数を書く。仕様例「豚肉／ぶた肉／ブタ」を関数能力だと言わない。
9. §4: 配置は追加条件スタックの縦積み次フィールド。未選択ラベル（「指定なし」）を材料の使い方に合わせるか、2 択のまま未選択をどう見せるかを書く。
10. 変更しないもの: fingerprint / quota / validate-generated-menu / 生成ハードゲート非入力、temperature 非送信、2 パス禁止、結果画面非表示、`database.generated.ts` 手編集禁止、fail-open（ひねりだけを理由に `constraint_conflict` にしない）。
