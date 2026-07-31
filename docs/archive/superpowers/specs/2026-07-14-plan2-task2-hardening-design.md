# Plan 2 Task 2 保存境界強化設計

## 目的

Plan 2 Task 2のパントリー・献立下書き保存基盤について、楽観ロック、DB入力境界、RLSテスト、TypeScript RPC型の不整合を解消する。対象migrationは破棄可能なローカル環境以外へ適用されていないため、追補migrationは作らず、既存の`20260711001000_pantry_and_planner_drafts.sql`を直接修正する。

## 対象範囲

- `pantry_items`の数量と文字列保存契約
- `generation_drafts`の配列、revision、削除、復元契約
- `save_generation_draft`と新しい削除RPC
- ブラウザ用Supabase Database型のnullable RPC補正
- Task 2のpgTAPと生成DB型
- Plan 2 Task 2/4/7およびPlan 3の下書き削除・予約契約

Task 2と無関係なテーブル、UI、献立生成処理は変更しない。

## パントリー境界

`pantry_items.quantity`はscaleを固定しない`numeric`とし、`0`より大きく`999999`以下、かつ`quantity = round(quantity, 3)`を満たす値だけを許可する。これにより`1.2300`のような同値表現は許可しつつ、`1.2345`を暗黙変換せず拒否する。PostgreSQLの`numeric NaN`は上限CHECKで拒否する。数量がNULLの場合は従来どおりunitもNULLとする。Plan 2 Task 4のZod数量契約にも小数部3桁以下の制約を追加する。

`name`、非NULLの`unit`、`memo`、下書きtext配列要素は保存時点でcanonical trim済みでなければならない。trim対象はECMAScript `String.prototype.trim()`と同じU+0009〜U+000D、U+0020、U+00A0、U+1680、U+2000〜U+200A、U+2028、U+2029、U+202F、U+205F、U+3000、U+FEFFとする。authenticatedが直接CRUDするpantryのname/unitは、revoke済みprivate関数による権限エラーを避けるためtable CHECKへ同じ条件をインラインで記述する。SECURITY DEFINER RPCだけが書くdraftのmemo/text配列はprivate immutable helperを使う。TypeScript側は同じ集合を扱う共有schema helperをPlan 2 Task 4で定義する。

文字数はUnicode code point数で数える。DBは`char_length`、TypeScriptは`Array.from(value).length`を使う。`name`は1〜80 code point、`unit`は1〜24、`memo`は0〜200とし、astral文字でDBとZodの判定がずれないようにする。入力を暗黙に変換せず、不正な直接API入力はCHECK違反として拒否する。

## 下書き配列境界

private schemaにcanonical text検証関数とimmutableな配列検証関数を置き、次をDB境界で強制する。

- `main_ingredients`と`avoid_ingredients`は空配列または一次元配列
- text配列の全要素は非NULL、trim済み、1〜80文字
- `target_member_ids`は空配列または一次元配列で、全要素が非NULL
- 既存の件数上限はmain 8件、target 20件、avoid 20件のまま

多次元配列、NULL要素、空白だけの文字列、過大な単一要素を拒否する。`pantry_selections`は既存の厳密な二キーJSON検証、50件上限、32KiB上限を維持する。

## revisionと削除

`generation_drafts`へnullableな`deleted_at`を追加する。物理DELETEをauthenticatedへ公開せず、所有者の有効な行だけをSELECT可能にする。private helperが対象行をソフト削除してrevisionを1増やす。helperは有効行がなければNULLを返し、内部finalizerではno-op成功として扱う。`delete_generation_draft(p_expected_revision bigint)` SECURITY DEFINER RPCは認証ユーザーとexpected revisionをhelperへ渡し、NULL結果だけを`draft_revision_conflict`へ変換する。

`save_generation_draft`は次の状態遷移を実装する。

1. 行が存在しない初回保存はexpected revision 0でrevision 1を作る。
2. 有効な行の保存は現在revisionとの一致を要求し、1増やす。
3. ソフト削除済み行の再作成はexpected revision 0を受け付けるが、revisionを1へ戻さず、削除時revisionからさらに1増やす。
4. stale revision、存在中の行に対するexpected 0、不一致削除は`draft_revision_conflict`とする。
5. NULLまたは負のexpected revisionは`invalid_draft_save`とする。

これにより、削除と再作成を挟んでも同じrevisionが再利用されず、古いタブによるABA上書きを防ぐ。auth.users削除時のCASCADEだけはDB内部の物理削除として維持する。

## 後続タスクとの契約

Plan 2 Task 7の`deletePlannerDraft`は現在revisionを必須引数として受け、新しい削除RPCを呼ぶ。競合は保存と同じ`draft_revision_conflict`として扱う。通常のSELECTではソフト削除行がRLSで見えないため、`getPlannerDraft`は従来どおり`null`を返す。

Plan 3の成功finalizerは`generation_drafts`を物理DELETEせず、同じprivate helperを所有者とdraft IDで呼ぶ。Plan 3は予約後のautosaveを許可し、成功時にはその時点の有効な下書きを削除する既存契約なので、この内部呼び出しはexpected revisionを要求しない。手動削除が先に完了してhelperがNULLを返した場合もfinalizerは成功を継続する。有効行を削除する場合は現在revisionを必ず1増やす。予約済みrevisionのスナップショット契約は変更しない。

Plan 3の予約処理はSECURITY DEFINERでRLSを迂回するため、authoritative draft lookupへ`deleted_at is null`を必須条件として追加する。削除済みdraft ID/revisionは`draft_unavailable`となり、request ledger、snapshot、quota/counterを一切変更しない。

全private helperは`SECURITY INVOKER`、固定された安全な`search_path`、完全修飾したDB objectを使い、`PUBLIC`、`anon`、`authenticated`からEXECUTEをrevokeする。public SECURITY DEFINER RPCも固定`search_path`と完全修飾名を使い、作成直後に全roleからrevokeしてから`authenticated`だけへgrantする。pgTAPで各権限境界を検証する。

Postgres Metaが関数引数のNULL許容性を生成型へ反映しないため、`database.generated.ts`は手編集しない。アプリ所有のDatabase型overlayを追加し、`save_generation_draft`の`meal_type`、`cuisine_genre`、`time_limit_minutes`、`budget_preference`だけを`null`許容へ広げる。ブラウザclientはoverlay型を使い、生成型のテーブル・戻り値・他RPC契約はそのまま継承する。

## テスト

pgTAPは実際のauthenticatedロール境界で次を検証する。

- NaN、数量上限超過、非trim name/unitの拒否
- 4桁以上の小数、NBSP/BOM padding、astral文字境界、非canonical memoの拒否
- text/UUID配列のNULL要素、多次元、Unicode空白、長さ超過の拒否
- pantryはowner 2の実在行に対するowner 1のSELECT不可とUPDATE/DELETE 0行、own mutation成功
- draftはforeign SELECT不可と、own/foreignを問わない直接INSERT/UPDATE/DELETEの`42501`
- create/updateの全payload round-trip
- 各件数・文字数上限の境界値
- NULL/負数expected revisionの入力エラー
- stale保存とstale削除の競合
- 削除後の不可視性、再作成時のrevision継続、旧revisionによるABA上書き拒否
- finalizerと手動削除の両順序、および削除済みdraft予約のzero-side-effect拒否
- private/public functionのEXECUTE権限

TypeScript側では、未完成下書きのnullable 4項目をRPC Argsへ渡せることを型検査で固定する。生成型を再生成した後もoverlayテストと全体typecheckが通ることを確認する。

## 検証

最低限、次を実行する。

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/03_pantry_and_planner_drafts.test.sql
docker compose --profile test run --rm db-test
docker compose run --rm app npm run db:types
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run build
```

Node/npm/npxは必ずDocker Composeの`app` service内で実行する。`db:reset`と`db:test`のnpm wrapperは内部でDockerを呼ぶためapp container内では使わず、reset scriptと`db-test` serviceを直接実行する。

テストはTDDで追加し、各反例が修正前に意図した理由で失敗することを確認してからmigrationを変更する。
