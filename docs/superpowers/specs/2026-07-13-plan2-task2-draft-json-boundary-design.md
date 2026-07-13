# Plan 2 Task 2 下書きJSON境界補正設計

## 目的

Plan 2 Task 2の実装計画を、`generation_drafts.pantry_selections` が宣言済みの保存契約をデータベース境界で強制する内容へ補正する。合わせてpgTAP件数とコミット例の不整合を解消する。

## 対象範囲

- `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md` のTask 2だけを変更する。
- Task 1の進捗台帳、既存マイグレーション、既存テスト、英語コメントは変更しない。
- Task 2のproduction migrationやpgTAPファイルはこの補正では作成しない。

## データベース境界

Task 2の予定マイグレーションに、`private.is_valid_draft_pantry_selections(p_value jsonb)` を追加する。PostgreSQL 15には `pg_input_is_valid` がないため、関数はPL/pgSQLで各配列要素を検査し、UUIDキャストの `invalid_text_representation` を捕捉して`false`を返す。

関数は次をすべて満たす場合だけ`true`を返す。

- 値全体がJSON配列である。
- 各要素がJSONオブジェクトである。
- 各要素のキーが `pantryItemId` と `priority` の2つだけである。
- 両方の値がJSON文字列である。
- `pantryItemId` をPostgreSQLの`uuid`へ変換できる。
- `priority` が `must_use` または `prefer_use` である。

関数は`immutable`、`set search_path = pg_catalog`とし、`public`、`anon`、`authenticated`から直接実行できないようrevokeする。`generation_drafts.pantry_selections` のCHECK制約はこの関数を呼び、既存の配列件数上限50件、32KiB上限、期限切れ確認情報の非永続化制約も維持する。

## pgTAP補正

既存18アサーションに次の6件を追加し、`select plan(24)`と最終期待値`1..24`を使用する。

1. UUIDでない `pantryItemId` を拒否する。
2. `must_use` / `prefer_use` 以外の `priority` を拒否する。
3. `pantryItemId` のない要素を拒否する。
4. `priority` のない要素を拒否する。
5. 任意の追加キーを持つ要素を拒否する。
6. オブジェクトでない配列要素を拒否する。

既存の正常保存、空配列、`checkedAt`の拒否、revision競合、RLS検証は維持する。失敗ケースはすべてRPCを通してCHECK違反`23514`になることを検証し、ブラウザ入力経路と同じ境界を通す。

## 文書整合性

Task 2 Step 4の期待件数を`1..24`へ更新する。Task 2のコミット例はリポジトリ規約に従い、`feat: パントリーと献立下書きの保存基盤を追加`とする。

## 完了条件

- Task 2のInterface記述、予定マイグレーション、pgTAP、検証コマンドの期待値が同じJSON契約と24件の計画数を示す。
- PostgreSQL 15で利用できない関数や未定義helperを参照しない。
- Task 2以外に差分がない。
