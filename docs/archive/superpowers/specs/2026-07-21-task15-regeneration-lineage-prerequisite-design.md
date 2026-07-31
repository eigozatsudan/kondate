# Task 15 regeneration lineage prerequisite 設計

## 目的

Plan 3 Task 14 correction Task 2のE2Eを、productionの成功finalizerを迂回せず
`succeeded`へ到達させる。正本Plan 3 Task 15が所有する前方互換hook
`private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)`だけを先行導入する。

## 背景と確認済みの問題

`public.finalize_ai_generation_success(...)` は、menu aggregateを保存した直後に
`private.assign_regeneration_lineage(...)` を呼ぶ。しかしtracked migrationとlocal DBには
このhookが存在しない。

Task 2の最小PostgREST再現では、先行導入済みのsafety fingerprint helperを通過した後、
HTTP 404 / `42883` / `function private.assign_regeneration_lineage(...) does not exist`
で失敗した。generation ledgerは`failed/internal_error`、`completed_menu_id`はNULLとなる。

finalizerがその後に呼ぶ`private.soft_delete_generation_draft(uuid,uuid,bigint)`は
tracked migrationとlocal DBの両方に存在する。finalizerのprivate依存を静的に照合した結果、
未導入の依存は`assign_regeneration_lineage`だけである。

対象migration `20260711002000_ai_control_and_quota.sql` は本番・共有Supabase環境へ
未適用であることをユーザーが確認済みである。このためforward migrationは作らず、
既存migration `020`を修正する。

## 採用案

既存migration `020`へ、Plan 3 Task 15の新規献立用no-op stubとREVOKEだけを追加する。
近接pgTAPで直接契約とfinalizerの呼出順を固定し、DB typesを正規generatorで再生成する。

次の案は採用しない。

- forward migration: 対象migrationが未適用であり、Plan 4の置換順序を不要に複雑化する。
- Plan 4の実lineage実装: version/group lockingを含む別Planの責務である。
- Task 15の完全transaction fixtureの先行: 最終14引数reservation、HMACなど未実装の
  Task 15 interfaceへ依存し、現行9引数reservationでは実行できない。

## Hook契約

追加するinterfaceは次の1つだけである。

```sql
private.assign_regeneration_lineage(
  p_user_id uuid,
  p_source_menu_id uuid,
  p_completed_menu_id uuid,
  p_change_reason text,
  p_change_reason_custom text
) returns void
```

動作契約は次のとおりとする。

- `p_source_menu_id`、`p_change_reason`、`p_change_reason_custom`がすべてNULLなら
  何もせずreturnする。
- 上記3値のどれか1つでも非NULLなら、`P0001/regeneration_not_implemented`を送出する。
- `p_user_id`と`p_completed_menu_id`は将来Plan 4が使用する署名を先に固定する引数であり、
  stubの分岐条件には使用しない。
- `VOLATILE`、`SECURITY INVOKER`、空の`search_path`を明示する。
- relationや別functionへ依存しない。alternate overloadや別hookを作らない。
- `public`、`anon`、`authenticated`、`service_role`から全権限を剥奪する。
- Plan 4は同じsignatureを`CREATE OR REPLACE`し、bodyだけを実lineage処理へ置換する。

推奨するSQL bodyは次のとおりである。Task 15正本には完全なSQL blockはないが、正本の
意味契約からbodyは一意に定まる。

```sql
create or replace function private.assign_regeneration_lineage(
  p_user_id uuid,
  p_source_menu_id uuid,
  p_completed_menu_id uuid,
  p_change_reason text,
  p_change_reason_custom text
) returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if p_source_menu_id is null
     and p_change_reason is null
     and p_change_reason_custom is null then
    return;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'regeneration_not_implemented';
end;
$function$;

revoke all on function private.assign_regeneration_lineage(
  uuid,uuid,uuid,text,text
) from public,anon,authenticated,service_role;
```

## Data flowとtransaction境界

現行finalizerの順序は変更しない。

1. requestを`FOR UPDATE`でlockする。
2. current safety fingerprintをlock/recheckする。
3. `private.persist_validated_menu(...)`でmenu aggregateを保存する。
4. `private.assign_regeneration_lineage(...)`を呼ぶ。
5. 対象draftがある場合だけrevision条件付きsoft-deleteを呼ぶ。
6. success quotaを更新する。
7. requestを`succeeded`へ更新する。

`new_menu` commandはrepositoryからlineage 3値をすべてNULLで渡すため、hookはno-opとなり
finalizerが継続する。provider outputからlineage値を導出しない。

非NULL lineageはmenu insert後の同一finalizer statement内で例外になる。このためmenu、
draft、quota、requestの変更はPostgreSQL transactionによってrollbackされる。今回のstubは
副作用を持たず、例外を捕捉または別errorへ変換しない。

## Security境界

hookは`private` schemaに置き、呼出し元finalizerの権限で動く`SECURITY INVOKER`とする。
空の`search_path`を固定し、PUBLICを含む外部roleへEXECUTEを付与しない。権限エラーを
解消するために`SECURITY DEFINER`へ変更しない。

SupabaseのDatabase Functionsガイドも、空の`search_path`使用時の完全修飾と、functionの
EXECUTE権限を明示的に制限することを求めている。

- https://supabase.com/docs/guides/database/functions

2026年のData API自動公開default変更はpublic table/functionのgrantに関するものであり、
外部公開しないprivate hookへ新しいgrantを要求しない。

## テスト設計

`supabase/tests/database/ai_control_and_quota.test.sql`へ次を追加する。

- exact 5引数signature、`returns void`、overload不在。
- `SECURITY INVOKER`、`VOLATILE`、空の`search_path`。
- PUBLIC、anon、authenticated、service_roleのEXECUTE不在。
- user/completed menu UUIDが非NULLで、lineage 3値が全NULLの`lives_ok`。
- source-only、reason-only、custom-onlyが、それぞれexact
  `P0001/regeneration_not_implemented`を返すこと。
- `pg_get_functiondef`により、finalizer内の
  `persist → assign → draft → quota → request`順序を固定すること。

最初にpgTAPを追加し、fresh DB reset後にhook不存在を原因とするREDを確認する。次に
migrationへhookを追加し、再度fresh resetしてGREENを確認する。

実finalizerで非NULL lineageを渡し、menu、draft、quota、requestがすべて不変であることを
証明するcanonical fixtureは今回へコピーしない。このfixtureはTask 15最終14引数reservation、
HMACなどに依存するため、正規Task 15でのみ実施する。今回のstatic順序検証は、そのfixtureの
代替として完全atomicityを証明したとは扱わない。

hook導入後、保持中Task 2をfresh Implementerで再開し、focused E2Eで実finalizerのall-null
経路が`failed/internal_error`ではなく`succeeded`へ到達することを確認する。
`/menus/:menuId`未結線によるresult page failureは別の既知blockerとして分離する。

## 生成types

fresh DBへmigrationを適用した後、repository既定のgeneratorを実行する。

```bash
docker compose run --rm --no-deps app npm run db:types
```

`src/shared/types/database.generated.ts`は手編集しない。generatorは`public,private`両schemaを
対象とするため、今回のhookに加え、前回先行導入したprivate safety fingerprint 2関数も
機械的に現れる可能性がある。public finalizer signatureは不変であり、
`src/shared/types/database.ts`とそのtestは変更不要である。これ以外の予期しない生成差分は
調査完了までblockerとする。

## 変更範囲

- `supabase/migrations/20260711002000_ai_control_and_quota.sql`
- `supabase/tests/database/ai_control_and_quota.test.sql`
- `src/shared/types/database.generated.ts`
- 本設計書、後続の実装計画、workspace report/progress

保持中の次のTask 2差分は破棄、stash、reset、checkout、またはhook commitへ混入しない。

- `e2e/specs/generation-recovery-results.spec.ts`
- `tools/e2e-function-server.mjs`
- `tools/e2e-function-server.test.mjs`

## 非対象

- Plan 4の実lineage更新、version/group locking、history regeneration。
- Task 15最終14引数reservation、HMAC、attempt/window quota、retention。
- canonical finalizer transaction fixture。
- `public.confirm_menu_label_confirmation`。
- runtime二session concurrency。
- finalizer、repository、validator、materializer、table、RLSの仕様変更。
- `/menus/:menuId` router結線。
- 保持中Task 2の3ファイルへの追加変更。

## 完了条件

- exact hookとREVOKEだけが既存migrationへ追加される。
- focused pgTAPがfresh reset後にPASSし、signature、metadata、ACL、null/non-null動作、
  finalizer呼出順を固定する。
- generated typesがfresh DBと一致し、手編集されていない。
- 独立Verifierと二段階Reviewerに未解決Critical/Important findingがない。
- hook commitに保持中Task 2の3ファイルが含まれない。
- Task 2 focused E2Eのgeneration ledgerが正規finalizer経由で`succeeded`へ到達し、
  `assign_regeneration_lineage`欠落由来のHTTP 404 / `42883`が消える。
