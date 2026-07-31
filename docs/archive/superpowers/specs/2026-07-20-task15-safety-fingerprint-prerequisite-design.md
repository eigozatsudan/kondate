# Task 15 安全fingerprint前提の先行導入設計

## 目的

Plan 3 Task 14 correctionのE2Eを、productionの成功finalizerを迂回せず
`succeeded`へ到達させる。正本Plan 3 Task 15が所有する安全fingerprint helperのうち、
現行finalizerがすでに呼び出しているprivate helper 2関数だけを先行導入する。

## 背景と確認済みの問題

`public.finalize_ai_generation_success(...)` は、menu永続化と成功状態更新より前に
`private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)` を呼ぶ。
しかしtracked migrationとlocal DBにはこのhelperが存在せず、固定success fixtureが
validatorを通過するとDB成功永続化で `internal_error` になる。

正本Plan 3は、このlocking helperと、それが使用する
`private.current_safety_fingerprint(uuid,uuid[])` のexact bodyをTask 15へ割り当てている。
対象migration `20260711002000_ai_control_and_quota.sql` は本番・共有Supabase環境へ未適用で
あることをユーザーが確認済みである。このためforward migrationは作らず、正本Planどおり
既存migration `020` を修正する。

## 採用する変更

`private.persist_validated_menu(...)` の定義後、
`public.finalize_ai_generation_success(...)` の定義前へ、正本Plan 3 Task 15記載の次の
2関数とREVOKEをそのまま追加する。

- `private.current_safety_fingerprint(uuid,uuid[]) returns text`
- `private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text) returns void`
- 上記両関数について、`public`、`anon`、`authenticated`、`service_role` から
  すべての権限を剥奪する。

alternate JSON serialization、別fingerprint builder、test-only fingerprint、finalizerの
fallbackや例外握り潰しは追加しない。

## Canonical fingerprint契約

`current_safety_fingerprint` は次の契約を持つ。

- ownerに属し、`status='complete'` の対象memberだけを受け入れる。
- NULL owner、NULL/空member配列、NULL要素、重複、missing/foreign/draft memberを
  `22023/invalid_target_members` で拒否する。
- `anonymousRef` は入力配列のordinalityから `member_N` として決める。
- member出力はUUID文字列順、allergen ID、安全制約、未対応diet種類は各配列内で
  決定論的にsortする。
- TypeScript `createCurrentSafetyFingerprint` と同じキー順のcompact JSON textを構築する。
- dictionary versionは `jp-caa-2026-04.v1`、food rule versionは
  `jp-caa-child-shape-2026-07.v1` とする。
- `extensions.digest(..., 'sha256')` のhex文字列を返す。

catalog、alias、ruleの同一version内の行内容はhash payloadへ直接含めない。これは
TypeScript正本と一致する。これらの変更はlocking helperのtable lockでfinalizationと
直列化する。

## Lockingとエラー契約

`lock_and_assert_current_safety_fingerprint` は、正本どおり次の順序でlockする。

1. 対象 `household_members` をUUID順に `FOR UPDATE`。
2. 対象 `member_allergies` をmember ID、allergy ID順に `FOR SHARE`。
3. `allergen_catalog` をtable `SHARE` lock。
4. `allergen_aliases` をtable `SHARE` lock。
5. `food_safety_rules` をtable `SHARE` lock。
6. 現在fingerprintを再計算してexpectedと比較。

expectedがNULLなら `22023/current_safety_changed`、再計算値が異なる場合は
`P0001/current_safety_changed` とする。lock取得順は正本から変更せず、同じresourceを
扱う後続Task 15処理もこの順序へ揃える。

## Security境界

両関数は `private` schema、`SECURITY INVOKER`、空の `search_path` を使用し、参照する
schema objectを完全修飾する。外部roleへEXECUTEを付与しない。public finalizerだけが
同一DB transaction内でlocking helperを使用する。

この設計は、Supabase公式の「可能なら `SECURITY INVOKER` を使い、functionの
`search_path` とEXECUTE権限を明示する」というDatabase Functionsガイドに従う。

- https://supabase.com/docs/guides/database/functions

## テスト設計

`supabase/tests/database/ai_control_and_quota.test.sql` を既存のTask 15集約先として使い、
`plan(64)` は後続assertion追加と両立する `no_plan()` へ切り替える。新しいpgTAP fileや
test-local fingerprint helperは作らない。

先にpgTAPを追加し、fresh DB reset後のfocused実行がhelper不存在でREDになることを確認する。
次にmigrationへexact SQLを追加し、もう一度fresh resetしてGREENを確認する。

最低限、次を検証する。

- 2関数のexact signature、不要overload不在。
- `SECURITY INVOKER`、current helperの `STABLE`、空 `search_path`。
- PUBLIC、anon、authenticated、service_roleのEXECUTE不在。
- TypeScript正本と同じcanonical JSONから算出した既知SHA-256との一致。
- member/allergyの挿入順に依存しない決定性。
- NULL、空、NULL要素、重複、missing、foreign、draft memberの拒否。
- allergy変更でfingerprintが変化すること。
- exact expectedでlocking helperが成功し、NULL/stale expectedを所定のSQLSTATEと
  messageで拒否すること。
- `pg_get_functiondef` により、member、allergy、catalog、alias、rule、再計算の
  lock順序が正本どおりであること。

実二セッションでlock競合を発生させるconcurrency testは、commit済みfixture、別session、
確実なcleanupが必要なため、この先行変更には含めない。正規Task 15でfinalizer全体の
atomicityとともに検証する。

focused verificationは、各コマンドを独立して実行する。

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test supabase/tests/database/ai_control_and_quota.test.sql
```

DB helperのfocused gate、独立Verifier、一次Reviewer、別Reviewerによる二次検証がcleanに
なった後、保持中のTask 2 E2E実装へ戻る。そこで正規finalizer経由のgeneration
`succeeded` と、Task 15に残る `/menus/:menuId` router未結線を分離して確認する。

## 変更範囲

- `supabase/migrations/20260711002000_ai_control_and_quota.sql`
- `supabase/tests/database/ai_control_and_quota.test.sql`
- 本設計書と、この後に作成する実装計画・workspace report/progress

保持中の次のTask 2未コミット差分は破棄、stash、reset、checkout、またはDB helper
commitへ混入しない。

- `e2e/specs/generation-recovery-results.spec.ts`
- `tools/e2e-function-server.mjs`
- `tools/e2e-function-server.test.mjs`

## 非対象

- `public.confirm_menu_label_confirmation(uuid,uuid,text)` とそのHTTP/UI。
- Task 15のHMAC、quota/attempt、deadline、conflict persistence、usage、recovery、
  pantry action、result action。
- finalizer、materializer、validator、schema、table、RLS policyの仕様変更。
- catalog/rule内容をhash payloadへ追加する独自拡張。
- 実二セッションlocking競合テスト。
- `/menus/:menuId` router結線。

## 完了条件

- exact 2 helperとREVOKEだけがmigrationへ追加されている。
- focused pgTAPがfresh reset後にPASSし、権限・fingerprint・入力拒否・lock順を固定する。
- DB変更commitに保持中Task 2の3ファイルが含まれない。
- 独立Verifierと二段階reviewに未解決Critical/Important findingがない。
- Task 2 E2Eが `invalid_ai_response` またはhelper未定義由来 `internal_error` ではなく、
  正規finalizer経由で `succeeded` へ到達する。
