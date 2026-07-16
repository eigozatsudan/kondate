# Plan 2 完了条件修正設計

## 目的

Plan 2 の敵対的レビューで検証された安全性・競合・緊急献立・医療対象外入力・完了証跡の問題をすべて解消し、Plan 3 が依存する境界を fail-closed にする。

## 対象

- 緊急献立用の current-safety snapshot
- 緊急献立遷移前の authoritative draft 保存
- 医療・離乳食・嚥下・治療食依頼の全入力境界
- household required safety constraint と structured action の食材結合
- 下書き revision 競合後の明示的な再同期
- 初回下書きが存在しない利用者の緊急献立導線
- Plan 2 の correction gate、E2E実行経路、format、pgTAP、進捗証跡

Plan 3 の生成、quota、OpenRouter 呼び出し自体は先行実装しない。Plan 3 設計書は、今回確定する共有 helper とDB境界を消費するよう同期する。

## 1. 一貫した current-safety snapshot

新しい migration `supabase/migrations/20260716000300_current_safety_snapshot.sql` に、service-role 限定の `public.get_current_safety_snapshot(p_user_id uuid, p_target_member_ids uuid[]) returns jsonb` を追加する。

関数は `SECURITY DEFINER`、空の `search_path`、完全修飾名を使用する。`public`、`anon`、`authenticated` から実行権限を剥奪し、`service_role` だけに付与する。ブラウザからは呼び出せない。

1回の関数実行内で次を読み、1つのJSON objectとして返す。

- 指定利用者が所有する `complete` household member
- age band、portion、spice、ease、required safety constraints、unsupported-diet状態
- standard/custom allergies と確認済みaliases
- member display-name snapshot
- current allergen catalog、alias dictionary、food-safety rule set と各version

入力 member ID は重複不可、1〜20件とする。要求したIDの一部が不存在、別所有者、draft、allergy/unsupported-diet未確認の場合はデータを部分返却せず、閉じた unavailable 結果を返す。SQL関数1回のstatement snapshotで全情報を組み立てるため、別々のPostgREST requestから mixed snapshotを作らない。

`netlify/functions/_shared/current-safety.ts` はRPC応答をstrict Zod schemaで検証し、既存の `CurrentSafetyContext` と人間向け member labelsへ変換する。緊急献立handlerはこのloaderだけを使う。RPC失敗、shape不一致、対象者不足は候補ゼロではなく閉じたserver errorとして扱い、古いcontextへfallbackしない。

pgTAPは権限、owner isolation、重複/空/foreign/draft member拒否と、同じsnapshot内のmember・allergy・catalog version整合を証明する。TypeScript testはRPCが1回だけ呼ばれ、旧multi-read経路を使わないことを証明する。

## 2. 緊急献立遷移と初回下書き

`PlannerForm` の通常anchorを、キーボード操作可能な遷移buttonへ置き換える。押下時は生成開始と同じ `useDraftAutosave().flush()` をawaitし、DBが返したdraft row/revisionを確認してからReact Routerで `/emergency-menus` へ遷移する。

初回利用で `generation_drafts` が存在しなくても、eligible memberを含む初期値を `flush()` が revision 0 で保存するため、空の `targetMemberIds` を送らない。保存失敗または `draft_revision_conflict` の場合は遷移せず、入力を保持してエラーを表示する。連打中はbuttonを無効化する。

緊急献立pageは依然として下書きをserverから読み直す。下書き不在を空queryへ変換せず、`draft_unavailable` としてplannerへ戻れる明示表示にする。API clientは空の target member配列を送信しない。

component testは初回無編集、debounce中のmeal/member/pantry変更、保存失敗、競合、二重押下を覆う。Playwrightはsave RPCを遅延させ、緊急献立requestが保存完了より先に発生しないことを証明する。

## 3. Canonical medical-scope request projection

`shared/contracts/planner.ts` に `collectPlannerRequestText(input: Pick<PlannerDraftInput, "mainIngredients" | "avoidIngredients" | "memo">): string` を追加する。順序は main ingredients、avoid ingredients、memo とし、各値を既存canonical trim後に改行で連結する。この関数だけを、AI promptへ入り得る自由入力の medical-scope projection とする。

Plan 2 UIはmemo単独ではなく、このprojectionを `detectUnsupportedMedicalRequest` へ渡す。`shared/safety/validate-generated-menu.ts` の `context.safety.requestText` も同じprojectionから構築された値を受け取る。

Plan 3 設計書のcontext loader、preflight、prompt DTO生成を同期し、projection検査を通過する前にprompt構築・reservation送信境界へ進めない。`mainIngredients` または `avoidIngredients` だけに「離乳食」「嚥下」「治療食」等がある場合も `unsupported_diet` で外部送信前に拒否する。

テストは3フィールドそれぞれ、複合入力、無関係な通常語、NFKC/空白差を覆い、UIとserver計画テストが同じhelperを参照することを静的検索でも固定する。

## 4. Required safety constraint の適用対象

年齢別 `FoodSafetyRule` が特定食材へ要求するactionは、従来どおり該当した各 sourceの `dishId` と `ingredientId` に完全一致するactionを要求する。

household `requiredSafetyConstraints` は、献立全体の任意action 1件では満たさない。

- 同じmember/constraintに対応する source-driven rule が1件以上該当する場合、該当した各 ingredient sourceに、その料理・食材・工程へ結合したactionを要求する。
- `remove_bones` は source-driven ruleに該当する骨リスク食材にだけ適用する。骨リスクがない献立へ架空の骨除去actionを要求しない。
- `cut_small` のような一般的な取り分け制約は、対象memberの各dishについて少なくとも1つ、実在するingredientへ結合し、本文証拠と矛盾しないactionを要求する。
- action instructionとadaptation/recipe本文は対象ingredient名とaction evidenceを含み、contradiction scanを通過しなければならない。

`bones_for_young_and_senior` のcatalog/TypeScript seedへ、固定fixtureと通常献立が使用する具体的な魚名を追加し、DB seed・current TypeScript catalog・完全一致テストを同期する。単なる `safetyTags` や、にんじん等へ付けた意味不明な骨除去actionは証拠にならない。

回帰テストは「鮭とにんじん＋にんじんの骨除去」をREDにし、鮭へ正しく結合したactionをGREENにする。複数該当食材では各食材を処理し、別dish・別member・別stepのactionでは代用できないことを証明する。

## 5. Draft revision conflict の明示的解決

revision conflictを、新しいrevisionが届いただけで自動解除しない。`useDraftAutosave` はconflict errorを保持し、通常の`initialRevision` prop変化では古い表示値を新revisionへ再baseしない。

routeはconflict発生時にowner draftをrefetchして `latestDraft` として保持するが、利用者が編集中の `value` は維持する。保存と生成は停止し、次を表示する。

- 競合説明
- `最新の下書きを読み込む` button
- 必要なら再読み込みを促す失敗表示

利用者がbuttonを押した場合だけ、表示値とautosave baselineを同じserver row/revisionへ原子的に切り替える。`PlannerForm` とautosave controllerには明示的なreset tokenを渡し、同じtoken変更でフォーム内部state、latest ref、baseline、conflict flagを同期する。refetch中にTanStack Queryが保持するcached rowはreset対象として採用せず、refetchの戻り値だけを使用する。

テストは実QueryClientのretained cacheと遅延refetchを使い、競合後に自動上書きしないこと、利用者入力が表示されたままなこと、明示button後だけ最新rowへ切り替わること、切替前にGenerateできないことを証明する。

## 6. 完了ゲートと証跡

Plan 2 correction gateのE2Eコマンドは、通常app imageで直接Playwrightを起動する記述を削除し、正式な `./scripts/run-e2e.sh e2e/specs/menu-domain-pantry.spec.ts` に統一する。

標準E2E 22件のlogin要素timeoutは、`scripts/run-e2e.sh`、app/function server、fixture reset、base URL、route guardの各境界をログで切り分け、最初に再現した根本原因だけを修正する。timeout延長やselector緩和では直さない。

`AGENTS.md` はPrettierに合わせる。pgTAP failureはclean DB reset後に再現し、migration order、RLS policy、fixture roleのどこで失敗したかを確定してから最小修正する。

`.superpowers/sdd/progress.md` にPlan 2 Tasks 4〜10、今回の修正commit、各review、raw gate結果を追記する。Plan 2文書のhuman-ratified pull-forward注記は、存在するprogress entryだけを参照する形でcommitする。

## 7. テストと終了条件

各修正はfocused failing testを先に実行し、期待するREDを保存してからproduction codeを変更する。各taskはfocused GREEN、task review、必要なfix/re-reviewを完了する。

最終的に次を別々のコマンドで実行する。

- `docker compose run --rm --no-deps app npm run format:check`
- `docker compose run --rm --no-deps app npm run lint`
- `docker compose run --rm --no-deps app npm run typecheck`
- `docker compose run --rm --no-deps app npx vitest run`
- `./scripts/reset-local-db.sh`
- `docker compose --profile test run --rm db-test`
- `./scripts/run-e2e.sh`
- `docker compose run --rm --no-deps app npm run build`
- `git diff --check`

さらに、修正担当とは異なるreviewerが設計整合、security、競合、安全fail-open、Plan 3 handoffを敵対的に再レビューする。新しいCritical/Importantが0件で、上記全コマンドがexit 0になり、progressと設計書がcurrent HEADを参照した場合だけPlan 2をcompleteとする。
