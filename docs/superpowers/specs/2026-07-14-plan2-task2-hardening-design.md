# Plan 2 Task 2 保存境界強化設計

## 目的

Plan 2 Task 2のパントリー・献立下書き保存基盤について、楽観ロック、DB入力境界、RLSテスト、TypeScript RPC型の不整合を解消する。対象migrationは破棄可能なローカル環境以外へ適用されていないため、追補migrationは作らず、既存の`20260711001000_pantry_and_planner_drafts.sql`を直接修正する。

## 対象範囲

- `pantry_items`の数量と文字列保存契約
- `generation_drafts`の配列、revision、削除、復元契約
- `save_generation_draft`と新しい削除RPC
- ブラウザ用Supabase Database型のnullable RPC補正
- Task 2のpgTAPと生成DB型
- Plan 2 Task 2/7およびPlan 3の下書き削除契約

Task 2と無関係なテーブル、UI、献立生成処理は変更しない。

## パントリー境界

`pantry_items.quantity`は`0`より大きく`999999`以下の値だけを許可する。PostgreSQLの`numeric NaN`は大小比較の特殊な順序を持つため、この上限との組み合わせでNaNと正の無限大を拒否する。数量がNULLの場合は従来どおりunitもNULLとする。

`name`と非NULLの`unit`は保存時点でtrim済みでなければならない。`name`は1〜80文字、`unit`は1〜24文字とし、大量の前後空白による保存量増幅と、DB値とZod正規化結果の差を防ぐ。入力を暗黙に変換せず、不正な直接API入力はCHECK違反として拒否する。

## 下書き配列境界

private schemaにimmutableな配列検証関数を置き、次をDB境界で強制する。

- `main_ingredients`と`avoid_ingredients`は空配列または一次元配列
- text配列の全要素は非NULL、trim済み、1〜80文字
- `target_member_ids`は空配列または一次元配列で、全要素が非NULL
- 既存の件数上限はmain 8件、target 20件、avoid 20件のまま

多次元配列、NULL要素、空白だけの文字列、過大な単一要素を拒否する。`pantry_selections`は既存の厳密な二キーJSON検証、50件上限、32KiB上限を維持する。

## revisionと削除

`generation_drafts`へnullableな`deleted_at`を追加する。物理DELETEをauthenticatedへ公開せず、所有者の有効な行だけをSELECT可能にする。private helperが対象行をソフト削除してrevisionを1増やし、`delete_generation_draft(p_expected_revision bigint)` SECURITY DEFINER RPCは認証ユーザーとexpected revisionをそのhelperへ渡す。

`save_generation_draft`は次の状態遷移を実装する。

1. 行が存在しない初回保存はexpected revision 0でrevision 1を作る。
2. 有効な行の保存は現在revisionとの一致を要求し、1増やす。
3. ソフト削除済み行の再作成はexpected revision 0を受け付けるが、revisionを1へ戻さず、削除時revisionからさらに1増やす。
4. stale revision、存在中の行に対するexpected 0、不一致削除は`draft_revision_conflict`とする。
5. NULLまたは負のexpected revisionは`invalid_draft_save`とする。

これにより、削除と再作成を挟んでも同じrevisionが再利用されず、古いタブによるABA上書きを防ぐ。auth.users削除時のCASCADEだけはDB内部の物理削除として維持する。

## 後続タスクとの契約

Plan 2 Task 7の`deletePlannerDraft`は現在revisionを必須引数として受け、新しい削除RPCを呼ぶ。競合は保存と同じ`draft_revision_conflict`として扱う。通常のSELECTではソフト削除行がRLSで見えないため、`getPlannerDraft`は従来どおり`null`を返す。

Plan 3の成功finalizerは`generation_drafts`を物理DELETEせず、同じprivate helperを所有者とdraft IDで呼ぶ。Plan 3は予約後のautosaveを許可し、成功時にはその時点の有効な下書きを削除する既存契約なので、この内部呼び出しはexpected revisionを要求しない。ただしソフト削除時には現在revisionを必ず1増やす。予約済みrevisionのスナップショット契約は変更しない。

Postgres Metaが関数引数のNULL許容性を生成型へ反映しないため、`database.generated.ts`は手編集しない。アプリ所有のDatabase型overlayを追加し、`save_generation_draft`の`meal_type`、`cuisine_genre`、`time_limit_minutes`、`budget_preference`だけを`null`許容へ広げる。ブラウザclientはoverlay型を使い、生成型のテーブル・戻り値・他RPC契約はそのまま継承する。

## テスト

pgTAPは実際のauthenticatedロール境界で次を検証する。

- NaN、数量上限超過、非trim name/unitの拒否
- text/UUID配列のNULL要素、多次元、空白、長さ超過の拒否
- owner 2の実在行に対するowner 1のSELECT/UPDATE/DELETE分離
- create/updateの全payload round-trip
- 各件数・文字数上限の境界値
- NULL/負数expected revisionの入力エラー
- stale保存とstale削除の競合
- 削除後の不可視性、再作成時のrevision継続、旧revisionによるABA上書き拒否

TypeScript側では、未完成下書きのnullable 4項目をRPC Argsへ渡せることを型検査で固定する。生成型を再生成した後もoverlayテストと全体typecheckが通ることを確認する。

## 検証

最低限、次を実行する。

```bash
npm run db:reset
npm run db:types
npm run db:test -- supabase/tests/database/03_pantry_and_planner_drafts.test.sql
npm run db:test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

テストはTDDで追加し、各反例が修正前に意図した理由で失敗することを確認してからmigrationを変更する。
