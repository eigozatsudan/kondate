# Plan 2 Task 3 ラベル確認境界強化設計

## 目的

Plan 2 Task 3 の献立ラベル確認基盤を、承認済みMVP設計の次の契約へ一致させる。

- 現在の安全条件と期待するfingerprintが一致するときだけ、本人が確認行を`confirmed`へ遷移できる。
- 各確認行は、監査と人間向け表示に使う不変の発生源テキストsnapshotを保持する。
- Plan 2、Plan 3、Plan 4の間に、危険な2引数RPCや存在しないRPCを前提とする中間状態を作らない。

## 根因

Task 3 migrationは、`authenticated`へ2引数の`confirm_menu_label_confirmation`を公開している。この関数は行の所有者、`is_current`、`pending`だけを検査し、家族設定変更後の現在の安全fingerprintを再計算しない。そのため、古い行がreconciliation前に`is_current`のまま残る期間は、利用者がHTTP境界を迂回して古い要件を確認済みにできる。

また、`menu_label_confirmations`は`source_type`、`source_id`、`source_path`だけを保存し、承認済み設計が要求する人間向けsnapshotを保存していない。Plan 3/4の動的なsource text再構築は、不変の監査記録を代替しない。

## 責務分割

### Plan 2 Task 3

Task 3は正規化スキーマと所有者境界だけを提供する。

- `menu_label_confirmations.source_text_snapshot text not null`を作成する。
- snapshotはECMAScript `String.prototype.trim()`と同じ文字集合でcanonical trim済み、1〜500文字に制限する。
- 2引数`confirm_menu_label_confirmation`を作成せず、`authenticated`へ確認遷移能力を付与しない。
- 直接UPDATE禁止、owner SELECT、polymorphic source ownership、pending/confirmed provenance制約は維持する。

Task 3時点では献立確認行を本人が遷移できない。これは、現在の安全条件をDB内で再計算するcanonical helperがまだ存在しない状態で、不完全な権限を公開しないためのfail-closedな中間状態である。

### Plan 3

Plan 3は現在安全fingerprintのDB helperを導入するmigrationと同じmigration内で、次のRPCを初めて作成する。

```sql
public.confirm_menu_label_confirmation(
  p_menu_id uuid,
  p_confirmation_id uuid,
  p_expected_safety_fingerprint text
)
```

RPCは同一トランザクション内で次を行う。

1. owner menuと現在リンクされている対象メンバーを確定する。
2. regex制約済み`anonymous_ref`の数値suffix昇順で対象UUIDを並べ、fingerprint builderの入力ordinalと保存済み`member_N`を一致させる。
3. `private.lock_and_assert_current_safety_fingerprint`で対象メンバーと安全設定をロックし、現在値と期待値を比較する。
4. 確認行の`user_id`、`menu_id`、`is_current`、`pending`、`requirement_safety_fingerprint = p_expected_safety_fingerprint`を検査する。
5. すべて一致した1行だけを、サーバー時刻と`auth.uid()`で`confirmed`へ更新する。

2引数overloadは存在させない。`authenticated`へのEXECUTE付与は、この3引数関数の完成後にだけ行う。

Plan 3の永続化処理は、validatorが確定したcanonical source textを`source_text_snapshot`へ保存する。結果表示はsnapshotを唯一の発生源表示として使用し、正規化子行から再構築しない。

### Plan 4

Plan 4は3引数RPCを置換しない。現在ラベル要件のreconciliationを追加し、同じfingerprint helperと既存RPCを利用する。

reconciliationは新しいcanonical要件を保存するときに`source_text_snapshot`も保存する。同一fingerprint・同一要件の確認済み行を維持する場合も、保存済みsnapshotを監査記録として保持する。履歴表示と現在警告表示はどちらも保存済みsnapshotを使用する。Plan 4のSQLも数値suffixをinteger化して並べ、stored loaderもTypeScriptで数値sortするため、DB返却順や`member_10`/`member_2`の文字列順へ依存しない。

## データ契約

`source_text_snapshot`は次の契約を持つ。

- `text not null`
- canonical trim済み
- `char_length`が1以上500以下
- 確認行のexact/current uniquenessには含めない
- browserから更新できない
- source rowやhousehold memberの後続変更では書き換えない

source identityは従来どおり`source_type`、`source_id`、`source_path`で表す。snapshotはidentityや安全判定には使わず、人間向け表示と監査のみに使う。

## エラーと外部契約

- 未認証、別owner、別menu、unknown、archived、replay、stale fingerprintはすべて0行更新とし、HTTP層では同じ`confirmation_not_found`へ閉じる。
- 現在fingerprintの再計算失敗または不一致では更新を行わない。
- クライアントが保存行と同じ古いfingerprintを送るだけでは成功しない。DBが現在値を再計算して比較する。
- 2引数RPCへの互換性は提供しない。公開前の未完成契約であり、維持すると安全境界を迂回できるためである。

## テスト戦略

### Task 3の実装テスト

- 2引数・3引数の確認RPCがまだ存在せず、`authenticated`が確認遷移能力を持たないこと。
- `source_text_snapshot`が必須であること。
- 空文字、前後空白、501文字を拒否し、canonicalな1文字と500文字を受理すること。
- owner RLS、直接UPDATE禁止、cross-owner source拒否、member/pantry unlink、root cascadeが従来どおり成立すること。
- 生成したDatabase型に`source_text_snapshot`が含まれ、確認RPCがまだ含まれないこと。

### Plan 3/4の計画テスト

- 3引数RPCだけが存在し、2引数overloadが存在しないこと。
- ownerのcurrent pending行は、現在値と一致する期待fingerprintで1回だけ成功すること。
- 家族設定変更後、旧IDと旧fingerprintによる直接RPC呼び出しが0行になること。
- stale fingerprint、wrong owner/menu、archived、unknown、replayを同じ空結果にすること。
- fingerprint変更との競合がトランザクション全体を失敗させること。
- persistence、reconciliation、result readbackが同じ`source_text_snapshot`を保持すること。
- 複数メンバーを逆順挿入し、`member_10`と`member_2`を含めても、Plan 3 confirmationとPlan 4 loader/reconciliationが数値suffix順の同じfingerprint入力を復元すること。

## 変更範囲

実装で変更するファイルは、Task 3 migration、2本のpgTAP、生成Database型に限定する。計画同期ではPlan 2 Task 3、Plan 3の永続化・結果表示・確認境界、Plan 4のreconciliation・結果表示・確認境界を更新する。将来migrationの実コードや未着手のPlan 3/4アプリケーションコードは作成しない。

## 非目標

- Plan 3/4機能の先行実装
- ラベル要件の導出ロジック変更
- source identityやunique keyの変更
- shopping list側のsnapshot契約変更
- Task 3以外のRLSや献立スキーマの再設計
