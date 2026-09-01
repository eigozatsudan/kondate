# 献立ひねり軸 Implementation Plan — 指摘裁定

- 日付: 2026-08-31
- 裁定者: 親エージェント
- 対象: 一次、敵対的、二次、親の live 再照合
- 最終判定: **REVISE。Critical 0。確定 Important 6 系統を Plan へ反映するまで実装開始は禁止。**

## 1. 裁定方法

各指摘を live の migration / pgTAP / overlay / wizard UI / E2E / 契約テストへ当てた。一次・敵対的・二次は独立スレッド。同一原因は統合し、Spec が明示的に選んだ製品判断と、成立条件が現行コードですでに閉じている攻撃は偽陽性とした。

二次の Critical 3 件は欠陥として採用するが、severity は Important へ下げる。理由: 計画どおり実行すると Task GREEN が嘘になる・db-test が止まる、であり、安全評価や all-new_menu 422 や quota 破壊ではない。本リポジトリの Plan レビュー較正（admin 共有レシピ Plan 等）でも、未実行 SQL / 偽 GREEN は Important。

主要な再照合:

- `rls_inventory.test.sql:284` は 13 引数 identity。`:305–320` が `pg_get_function_identity_arguments` と突合。
- `03a:86–88` は `to_regprocedure(…,jsonb)`。`03a:2` と `ai_control:3` は `no_plan()`。
- `03_pantry_and_planner_drafts.test.sql:162–192`: idea `save(3)` → revision 4。続く throws_ok は expected 4 で CHECK 拒否。`finish()` 直前の現 revision は 4。
- `ai_control:1158–1253` の snapshot jsonb は `ingredient_preference = 'selected_only'`。novelty 列は選んでいない。
- `planner.ts:157–159` は `z.infer` 出力。`review-step.tsx:591–626` は `<select>`。空 option が null。
- `menu-domain-pantry.spec.ts` は「献立を作る」の enabled 確認のみ。生成成功は `full-journey.spec.ts:73–90`。
- `package.json:21` `db:types`。`docs/local-development.md:57` は `docker compose run --rm app npm run db:types`。script は `http://meta:8080`。
- `planner-api.ts:53–56` は明示 select。`plannerDraftSchema` は `draftShape` を spread し `.default(null)`。
- husky 無し。Task 1 の typecheck 赤 commit は git としては通る。

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | Plan へ書くこと |
| --- | --- | --- | --- | --- |
| P-01 | 一次 I-1 / 敵対 I-1 / 二次 C1 | Important | 14 引数再作成のあと 13 引数 GRANT を貼ると migrate 失敗。inventory と 03a `to_regprocedure` を放置すると db-test 失敗。計画の「変更不要」「grep が空」は live と矛盾する（`p_ingredient_preference` でヒットする） | 14 引数 `revoke all` / `grant execute` を本文に貼る（末尾 `, text`）。`rls_inventory:284` に `p_novelty_preference text`。03a `:86–88` は型リストへ `text`（`,null` ではない）。呼び出しだけが `,null` |
| P-02 | 一次 I-2 / 敵対 I-3 / 二次 C2・I5 | Important | Step 7 の `save(3,'twist')` は live revision 4 に衝突。wild を 4 のままにすると persist 成功後は conflict で `22023` を見ない。`ai_control` は `no_plan()`。既存 snapshot 往復へ twist assert を足すと null | persist は expected 4、wild は 5。`no_plan()` は触らない。twist は下書きへ保存してから予約する専用ケース。selected_only 往復の jsonb 列挙はそのまま |
| P-03 | 一次 I-3 / 敵対 I-2 / 二次 I3 | Important | Spec §7 の「14 引数の 1 つだけ」が無い。`has_function(14 型)` は 13 引数残留を見ない。計画自身が警告する overload がテストで閉じない | 13 引数 `hasnt_function` または `proname='save_generation_draft'` の `count(*)=1`。`plan()` を増やす |
| P-04 | 一次 I-4・I-5 / 敵対 I-4・I-5 / 二次 C3・I2・I6 | Important | 型再生成コマンドがプレースホルダ。`z.infer` 後 noveltyPreference は required。Task 1 の既存 toEqual / 共有 snapshot fixture 未更新。Task 2 Files だけでは `tsc -b` は緑にならない | コマンドはスタック起動後 `docker compose run --rm app npm run db:types`。`incompleteDraft` / `validBase` / `snapshot` / submission `toEqual` を Task 1 で更新。`noveltyPreference: null` を `ingredientPreference: null` がある PlannerDraftInput / PlannerSubmission / PlannerDraft literal へ足す（起点 `shared/testing/factories.ts`）。typecheck PASS をその sweep と同じ Task までずらす |
| P-05 | 一次 I-6 / 敵対 I-6 / 二次 I1 | Important | 材料の使い方は select。計画は「同じマークアップ」と radio テストと「再押下で null に戻さない」を同時に書く。E2E 対象 `menu-domain-pantry.spec.ts` は生成 success に到達しない | ウィジェットを 1 つに固定する。推奨は既存任意軸に合わせた `<select>`（ラベル「献立の雰囲気」、指定なし / いつもの / ひねりたい、`selectOptions`、指定なしで null）。E2E は `full-journey.spec.ts` の確認画面へ差し込み、「献立ができました」まで既存アサートを使う。radio を採るなら Task 5 JSX を radio で書き、E2E も radio。混在禁止 |
| P-06 | 敵対 I-7 | Important | `mapPlannerDraft` へ手組み行を通すテストは select 文字列をロックしない。列を足し忘れると GET がキーを欠き `.default(null)` が twist を消す。save は動くので F-02 のサイレント再発 | `getPlannerDraft` の `.select(...)` が `novelty_preference` を含むこと、またはキー欠落行では twist を保持できないことをテストする |

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| 二次 C1/C2/C3 を Critical のまま | **Severity 下げ** | 欠陥は P-01/P-02/P-04。本番 422・安全・quota 破壊ではない |
| 一次 I-1 と敵対 I-1 と二次 C1 | **Duplicate** | P-01 へ統合 |
| 一次 I-2 と敵対 I-3 と二次 C2/I5 | **Duplicate** | P-02 へ統合 |
| 一次 I-3 と敵対 I-2 と二次 I3 | **Duplicate** | P-03 へ統合 |
| 一次 I-4/I-5 と敵対 I-4/I-5 と二次 C3/I2/I6 | **Duplicate** | P-04 へ統合 |
| 一次 I-6 と敵対 I-6 と二次 I1 | **Duplicate** | P-05 へ統合 |
| 20260730 reserve を写す | **False positive** | 計画は 20260808 を指名している |
| 計画の DROP が 12 引数 | **False positive** | 貼ってあるのは現行 13 引数 |
| 単一 commit 内の mapSnapshot 422 | **False positive** | 分割禁止が Task 境界。R-01 は閉じたまま |
| PromptPreferences / 再生成 JSON | **False positive** | new_menu 分岐。preferences の exact keys テストが残る |
| payload キー衝突 | **False positive** | `noveltyExcludedDishes` は既存 6 キーと非衝突 |
| fingerprint / quota / validate / HMAC 漏れ | **False positive** | Spec §2.2 / §5.3 どおり入力にしない。現行パイプは novelty を読まない |
| 漢字かな畳みの誤認 | **False positive** | カタログテストが alias とカナ畳みを分けている |
| planner-route 4 箇所目 / keepalive 別組み立て | **False positive** | 3 箇所 + keepalive は `buildSaveGenerationDraftArgs` |
| `buildNewMenuSystemPrompt` 他 caller | **False positive** | 1 箇所 |
| draft-from-menu がメニュー表列を読む | **False positive** | 引数は `PlannerSubmission` |
| Task 1/2 の 14 vs 13 並走 | **Accepted residual** | 既知。P-01 が閉じれば migrate 後のサーバは 14 引数 |
| ai_control exact jsonb が新列で自動破綻 | **False positive** | 明示列挙。未選択列は jsonb に出ない |
| `run-e2e.sh` がファイル絞り不可 | **False positive** | `"$@"` 転送。省略はコスト |
| 二次 I4 public `has_column` | **Minor** | persist `select novelty_preference from generation_drafts` が列の存在をロックする。CHECK 定義まで必須にはしない。足すなら `plan()` も増やす |
| 二次 I7 Task 4 ヘルパー名 | **Minor** | 計画が「既存名へ読み替える。無ければ真似る」と書いてある。live 名は裁定に残す: `asNewMenuExecution` / `userPayload` / `systemText` |
| 二次 I8 reserve 全文未掲載 | **Accepted residual** | Spec も copy-delta。470 行の全文貼り付けは誤写リスク。P-01 の GRANT リストと INSERT 3 点変更は本文必須のまま |
| 一次 M-3 `wild` が実装前から throw | **Minor** | file 全体の RED は他テストで足りる。enum 拒否は実装後も throw するので害は小さい |
| `PlannerFieldName` / `ReviewFieldErrors` | **Minor** | 任意軸。field-local と details 強制オープンから外れるだけ。Task 5 で足してよいが一文で足りる |
| `git add` directory | **Minor** | 明示パスへ |
| E2E「118 行付近」 | **Minor** | 正は `updatePlannerAndAwaitAutosave`（32–55 行）。P-05 で対象ファイルが変わる |
| typecheck 赤 commit が hook で止まる | **False positive** | husky 無し。P-04 は検証の偽 GREEN として残す |
| overlay 名 `SaveDraftNullableArgKeys` | **False positive** | 計画は live の `NullableDraftArgs` |
| `NOVELTY_HINTS_ENABLED = true as const` / 上限 12 / DROP `(uuid,uuid)` / payload キー名 | **False positive** | R-01 裁定の Minor 吸収済み |

## 4. Plan が直すべき具体パッチ（実装はまだしない）

1. **Task 1 migration 末尾** — `save_generation_draft` の revoke/grant を 14 型で書く。reserve / snapshot は引数が増えないので現行コピーでよい。
2. **Task 1 Files** — `supabase/tests/database/rls_inventory.test.sql` を追加。Step 6 の「変更不要」を削除。
3. **Task 1 Step 7** — persist `save(4,…,'twist')`、`throws_ok(save(5,…,'wild'))`。`hasnt_function` または count=1。`plan()` を実数へ。`ai_control` は `no_plan()` のまま専用ケース。
4. **Task 1 Step 9** — `docker compose run --rm app npm run db:types`。Step 1/10/12 で `incompleteDraft` / `validBase` / `snapshot` / 既存 `toEqual` を更新。ヘルパー名は `arrangeLoader`。
5. **Task 2 Files** — `shared/testing/factories.ts` と「`ingredientPreference: null` がある typed literal 全部」。typecheck PASS をこの sweep のあとへ。
6. **Task 2 テスト** — `getPlannerDraft` の select 文字列、またはキー欠落で twist が消えること。
7. **Task 5/6** — select か radio を 1 つに固定。E2E は `e2e/specs/full-journey.spec.ts`。

## 5. 修正後判定

**REVISE。** Spec は APPROVE のまま。Plan だけを直す。P-01〜P-06 を本文に埋め込んだら、そのデルタだけを再レビューすればよい。実装開始は再 APPROVE のあと。
