# Task 15 Regeneration Lineage Prerequisite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task 15正本の前方互換lineage hookを先行導入し、Task 14 correction E2Eのnew-menu生成をproduction finalizer経由で`succeeded`へ到達可能にする。

**Architecture:** 未適用の既存migration `020`へ、副作用を持たないprivate lineage stubをconsumerであるsuccess finalizerの直前に追加する。近接pgTAPでsignature、metadata、ACL、null/non-null動作、finalizer call orderを固定し、fresh DBからpublic/private database typesを正規生成する。

**Tech Stack:** PostgreSQL、PL/pgSQL、Supabase local stack、pgTAP、Postgres Meta TypeScript generator、Docker Compose。

## Global Constraints

- 対象migration `20260711002000_ai_control_and_quota.sql` は本番・共有Supabase環境へ未適用である。forward migrationを新規作成せず、既存migrationを修正する。
- 追加するinterfaceは `private.assign_regeneration_lineage(uuid,uuid,uuid,text,text) returns void` だけとする。overloadや別hookを作らない。
- `p_source_menu_id`、`p_change_reason`、`p_change_reason_custom`がすべてNULLならreturnし、どれか1つでも非NULLならexact `P0001/regeneration_not_implemented`を送出する。
- hookは`VOLATILE`、`SECURITY INVOKER`、空の`search_path`を明示し、`public`、`anon`、`authenticated`、`service_role`から全権限を剥奪する。
- `p_user_id`と`p_completed_menu_id`は将来Plan 4が使用するsignature固定用引数であり、stubの分岐条件に使用しない。
- finalizer、repository、validator、materializer、table、RLS、public RPC signatureを変更しない。Plan 4の実lineage更新を先行しない。
- Task 15最終14引数reservation/HMACに依存するcanonical transaction fixtureは正規Task 15へ残す。今回のstatic call-order testを完全atomicityの証明とは扱わない。
- `src/shared/types/database.generated.ts`は手編集せず、fresh DBへmigrationを適用した後に`npm run db:types`で生成する。
- コードコメントとcommit messageは日本語にする。
- Node/npm commandはDocker経由で実行し、すべてのcommandを`&&`や`;`で結合せず独立実行する。
- `./scripts/reset-local-db.sh`はlocal DB全データを破棄してstackを再作成する。実行前にscript/calleeの未確認差分がないことを確認する。
- 保持中の次の3 unstaged filesを破棄、stash、reset、checkout、stage、編集、またはこのTaskのcommitへ混入しない。
  - `e2e/specs/generation-recovery-results.spec.ts`
  - `tools/e2e-function-server.mjs`
  - `tools/e2e-function-server.test.mjs`
- Execution gate: `AGENTS.md`のclean baseline要件と保持必須3 dirty filesは同時に満たせない。この新TaskのImplementer、VerifierがDockerを実行する前に、ユーザーが3差分をimmutable baselineとして扱う例外を改めて明示承認していなければ開始しない。以前のprerequisiteに対する承認を流用しない。

---

## File Structure

- `supabase/tests/database/ai_control_and_quota.test.sql`: lineage hookのsignature、metadata、ACL、null/non-null契約、finalizer call orderをpgTAPで固定する。
- `supabase/migrations/20260711002000_ai_control_and_quota.sql`: Plan 3のnew-menu no-op lineage stubとREVOKEをfinalizer直前へ追加する。
- `src/shared/types/database.generated.ts`: fresh local DBのpublic/private schemaから正規generatorで再生成する。
- `.superpowers/sdd/task-15-regeneration-lineage-prerequisite-report.md`: RED/GREEN、生成types、baseline比較、verification、review結果を記録する。gitignore対象でcommitしない。

### Task 1: Install and prove the regeneration lineage prerequisite

**Files:**
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Modify: `supabase/migrations/20260711002000_ai_control_and_quota.sql`
- Regenerate: `src/shared/types/database.generated.ts`
- Report: `.superpowers/sdd/task-15-regeneration-lineage-prerequisite-report.md`

**Interfaces:**
- Consumes: 現行`public.finalize_ai_generation_success(...)`の`persist → lineage → draft → quota → request` transaction順、`new_menu` commandの`sourceMenuId/changeReason/changeReasonCustom = null`契約、Plan 4が置換する同一5引数signature。
- Produces: `private.assign_regeneration_lineage(uuid,uuid,uuid,text,text) returns void`。new-menu all-null lineageではno-op、それ以外は`P0001/regeneration_not_implemented`。

- [ ] **Step 1: Authorityとimmutable dirty baselineを固定する**

作業開始baseを記録する。計画commit後の実装baseはcontrollerが明示し、`HEAD~1`で推定しない。

Run independently:

```bash
git branch --show-current
```

```bash
git rev-parse HEAD
```

```bash
git status --short
```

```bash
git diff --cached --binary
```

```bash
git diff --binary
```

```bash
git ls-files --others --exclude-standard
```

Expected:

- branchは`main`。
- stagedとuntrackedは空。
- unstagedはGlobal Constraints記載のTask 2対象3 filesだけ。
- controllerは3 filesのworktree blob hashと、staged、unstaged、untrackedの完全な内容をbaselineとして保存する。

次の実行経路に未確認差分がないことを確認する。

```bash
git diff --quiet -- scripts/reset-local-db.sh
```

```bash
git diff --quiet -- scripts/apply-migrations.sh
```

```bash
git diff --quiet -- scripts/run-pgtap.sh
```

```bash
git diff --quiet -- scripts/generate-database-types.sh
```

```bash
git diff --quiet -- compose.yaml
```

Expected: all exit 0。非0なら該当diffを読み、破壊的操作、外部送信、secret参照、生成先変更を再評価するまでreset/Dockerを開始しない。

- [ ] **Step 2: Lineage hook契約を固定するpgTAPを先に追加する**

`supabase/tests/database/ai_control_and_quota.test.sql`の既存locking helper row-lock assertions直後、最初の`select has_table('private'...)`より前へ次を追加する。

```sql
select has_function(
  'private',
  'assign_regeneration_lineage',
  array['uuid', 'uuid', 'uuid', 'text', 'text'],
  'lineage hook has the exact input signature'
);
select function_returns(
  'private',
  'assign_regeneration_lineage',
  array['uuid', 'uuid', 'uuid', 'text', 'text'],
  'void',
  'lineage hook returns void'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'private'
      and procedure_.proname = 'assign_regeneration_lineage'
  ),
  1,
  'lineage hook has no overload'
);
select ok(
  not (
    select procedure_.prosecdef
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
    )
  ),
  'lineage hook is SECURITY INVOKER'
);
select is(
  (
    select procedure_.provolatile::text
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
    )
  ),
  'v',
  'lineage hook is VOLATILE'
);
select is(
  (
    select procedure_.proconfig
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
    )
  ),
  array['search_path=""']::text[],
  'lineage hook has an empty search_path'
);
select ok(
  coalesce(
    not exists (
      select 1
      from pg_catalog.pg_proc procedure_
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure_.proacl,
          pg_catalog.acldefault('f', procedure_.proowner)
        )
      ) privilege_
      where procedure_.oid = to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      )
        and privilege_.grantee = 0
        and privilege_.privilege_type = 'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      ),
      'EXECUTE'
    ),
    false
  ),
  'PUBLIC and every external role cannot execute the lineage hook'
);
select lives_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    null::text
  )
$$, 'the lineage hook accepts an all-null new-menu lineage');
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000003'::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    null::text
  )
$$, 'P0001', 'regeneration_not_implemented',
  'the lineage hook rejects a source-only lineage');
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    'simpler'::text,
    null::text
  )
$$, 'P0001', 'regeneration_not_implemented',
  'the lineage hook rejects a reason-only lineage');
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    '自由記述'::text
  )
$$, 'P0001', 'regeneration_not_implemented',
  'the lineage hook rejects a custom-reason-only lineage');
select ok(
  (
    select
      pg_catalog.strpos(
        definition_, 'v_menu_id := private.persist_validated_menu('
      ) > 0
      and pg_catalog.strpos(
        definition_, 'perform private.assign_regeneration_lineage('
      ) > pg_catalog.strpos(
        definition_, 'v_menu_id := private.persist_validated_menu('
      )
      and pg_catalog.strpos(
        definition_, 'perform private.soft_delete_generation_draft('
      ) > pg_catalog.strpos(
        definition_, 'perform private.assign_regeneration_lineage('
      )
      and pg_catalog.strpos(
        definition_, 'update private.ai_user_daily_usage set'
      ) > pg_catalog.strpos(
        definition_, 'perform private.soft_delete_generation_draft('
      )
      and pg_catalog.strpos(
        definition_, 'update private.ai_generation_requests set'
      ) > pg_catalog.strpos(
        definition_, 'update private.ai_user_daily_usage set'
      )
    from (
      select pg_catalog.pg_get_functiondef(
        to_regprocedure(
          'public.finalize_ai_generation_success(uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz)'
        )
      ) as definition_
    ) function_
  ),
  'success finalization keeps persist, lineage, draft, quota, request order'
);
```

既存95 assertionsへ12 assertionsが加わり、GREEN時は107/107 PASSとなる。fixture rowは追加しない。直接呼出しUUIDはstubが参照しない予約済みtest値である。

- [ ] **Step 3: Fresh resetでexpected REDを観測する**

Step 1のbaselineを再取得し、pgTAP以外の差分が変わっていないことを確認する。その後、各commandを独立実行する。

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test supabase/tests/database/ai_control_and_quota.test.sql
```

Expected RED:

- resetはexit 0。PL/pgSQL finalizer bodyの未解決hookはmigration適用時ではなく実行時に解決される。
- focused pgTAPは非0。新規static call-order assertionだけは既存finalizer本文にcallがあるためPASSする。
- 残る新規11 assertionsはhook不存在だけを理由にFAILする。signature/returnはfunction不存在、overload countは0、metadataはNULL、ACLはfalse、直接呼出しは`42883`となる。
- 既存95 assertionsのfailure、migration/fixture/script failure、またはhook不存在以外のfailureならRED成立扱いにしない。
- reset前後で、pgTAP差分と保持中Task 2の3差分を除く意図しないhost変更がない。

RED command、exit code、relevant excerpt、期待どおりである理由をreportへ記録する。

- [ ] **Step 4: Exact lineage stubとREVOKEだけをmigrationへ追加する**

`supabase/migrations/20260711002000_ai_control_and_quota.sql`のfingerprint 2 helperのREVOKE直後、`public.finalize_ai_generation_success(...)`定義前へ次をそのまま追加する。

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

このStepではfinalizer body、public RPC、repository、schema/table/RLS、fingerprint helpersを変更しない。

- [ ] **Step 5: Fresh resetとfocused pgTAPでGREENを確認する**

各commandを独立実行する。

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test supabase/tests/database/ai_control_and_quota.test.sql
```

Expected GREEN:

- resetはexit 0。
- focused pgTAPは107/107 PASS、skip 0、warning/errorなし。
- reset前後で、migration/test差分と保持中Task 2の3差分を除く意図しないhost変更がない。

GREEN command、exit code、107/107、output noise有無をreportへ記録する。

- [ ] **Step 6: Fresh DBからdatabase typesを正規生成する**

このStepはgenerated fileを意図的に書き換えるためImplementerだけが実行する。開始前にbaselineを保存し、生成先以外の差分が変わらないことを確認する。

```bash
docker compose run --rm --no-deps app npm run db:types
```

```bash
rg -n 'assign_regeneration_lineage|current_safety_fingerprint|lock_and_assert_current_safety_fingerprint' src/shared/types/database.generated.ts
```

```bash
git diff -- src/shared/types/database.generated.ts
```

Expected:

- generatorは`Generated src/shared/types/database.generated.ts`を出力してexit 0。
- private `Functions`へ次の3 entriesが機械生成される。
  - `assign_regeneration_lineage`: 5 args、`Returns: undefined`。
  - `current_safety_fingerprint`: `p_user_id: string`、`p_target_member_ids: string[]`、`Returns: string`。
  - `lock_and_assert_current_safety_fingerprint`: 上記2 argsと`p_expected: string`、`Returns: undefined`。
- `assign_regeneration_lineage`のgenerated argsは`p_user_id`、`p_source_menu_id`、`p_completed_menu_id`、`p_change_reason`、`p_change_reason_custom`を含む。
- 前回未生成のfingerprint 2 entriesを含むことは期待差分である。
- public finalizer signature、table types、`src/shared/types/database.ts`、そのtestは変更されない。
- 上記3 function entries以外の予期しないgenerated diffがあれば、正本との照合が終わるまでblockerとする。
- 生成前後で、generated file、migration/test差分、保持中Task 2の3差分以外のhost変更がない。

- [ ] **Step 7: Task scopeのstatic/full DB gatesを実行する**

各Docker command前後でstaged、unstaged、untracked、保持3 filesのhashを比較し、許可済み6 files以外のhost変更がないことを確認する。

Run independently:

```bash
docker compose config --quiet
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose --profile test run --rm db-test
```

```bash
git diff --check
```

Expected: all exit 0。full pgTAPは全database testsがPASSする。full Vitest、E2E、buildは保持中Task 2 correction完了後の最終gateへ残す。

- [ ] **Step 8: Self-reviewして3 implementation filesだけをcommitする**

次を行単位で照合する。

- migration diffはexact hook 1つとREVOKEだけ。
- test diffは12 assertionsだけ。
- generated diffはprivate function entries 3つだけで、手編集されていない。
- all-null以外を許可するfallback、Plan 4 lineage write、public RPC、test-local helper、finalizer変更がない。
- 保持中Task 2の3 filesはStep 1 baselineと同一。

Run independently:

```bash
git diff --check -- supabase/migrations/20260711002000_ai_control_and_quota.sql supabase/tests/database/ai_control_and_quota.test.sql src/shared/types/database.generated.ts
```

```bash
git add supabase/migrations/20260711002000_ai_control_and_quota.sql supabase/tests/database/ai_control_and_quota.test.sql src/shared/types/database.generated.ts
```

```bash
git diff --cached --name-status
```

Expected: stagedは上記3 implementation filesだけ。

```bash
git diff --cached --check
```

```bash
git commit -m "fix: lineage前提hookを先行導入"
```

```bash
git show --name-status --format= --no-renames HEAD
```

Expected: commitは3 implementation filesだけ。保持中Task 2の3 filesはunstagedのまま残る。

commit後、freshnessを証明するため生成を再実行する。

```bash
docker compose run --rm --no-deps app npm run db:types
```

```bash
git diff --exit-code HEAD -- src/shared/types/database.generated.ts
```

Expected: 両commandはexit 0。再生成後のgenerated typeはcommit済みHEADとbyte-for-byte一致する。保持中3 files以外の新しい差分はない。

Implementerは`.superpowers/sdd/task-15-regeneration-lineage-prerequisite-report.md`に次を記録し、commitしない。

- RED command、hook不存在のrelevant excerpt、期待どおりである理由。
- GREEN 107/107と全Task gates。
- generated function entriesとpost-commit freshness。
- reset/Docker前後のbaseline一致。
- commit hashと対象3 files。
- self-reviewと懸念。

## Controller Review and Verification Gate

Task 1 commit後、controllerは記録済みbaseから実装HEADまでreview packageを生成する。

1. fresh Verifierが`docker compose config --quiet`、fresh reset、focused pgTAP、format、lint、typecheck、full pgTAP、generated typeのread-only `rg`、diff-checkを再実行し、全command前後のimmutable dirty baseline一致を報告する。Verifierはhost generated fileを書き換える`npm run db:types`を実行しない。
2. controllerはImplementerのpost-commit `npm run db:types`と`git diff --exit-code HEAD -- src/shared/types/database.generated.ts`のfreshness evidenceを確認する。
3. fresh read-only Reviewerがsignature、all-null/non-null contract、SQLSTATE/message、ACL、empty search_path、SECURITY INVOKER、VOLATILE、finalizer call order、generated types、scope leakageを一次reviewする。
4. 一次Reviewerとコンテキストを共有しない別Reviewerがfindingと見落としを二次検証する。
5. Critical/Importantがあればcombined findingsをfresh fix Implementerへ渡し、covering testsとgenerated freshnessを再実行し、Verifierと両Reviewerを新HEADで反復する。
6. clean後、`.superpowers/sdd/progress.md`へ`Plan 3 Task 15 regeneration lineage prerequisite: complete (...)`と追記する。Plan 3 Task 15全体をcompleteとは記録しない。

このprerequisite planは1 Taskだけなので内部handoffを作成しない。完了後は、Git正本からworktree rootを解決し、全祖先が実directoryかつ非symlink、leaf不存在、canonical pathがworktree内であることを確認してから、次の一意なwrite-once handoffを新規発行する。

producerは`git rev-parse --short=7 HEAD`で実装commitのlowercase 7-char HEADを取得し、
`.superpowers/sdd/handoff-plan-3-task-15-to-task-2-`の直後へその実値を連結してleaf名を作る。
次Taskへは、作成に成功したそのexact pathだけを渡す。

既存`handoff-plan-3-task-15-to-task-2-c9765e8.md`は変更、削除、再利用しない。fresh Task 2 Implementerには新handoffのexact pathだけを渡す。

## Post-plan Task 2 Continuation

fresh Task 2 Implementerは`.superpowers/sdd/invalid-ai-response-task-2-brief.md`を正本として保持中3 filesを再開する。Node focused test 6/6を再確認後、次を実行する。

```bash
./scripts/run-e2e.sh e2e/specs/generation-recovery-results.spec.ts --project=desktop-chromium
```

Expected:

- generation ledgerはproduction finalizer経由で`succeeded`となる。
- `assign_regeneration_lineage`欠落由来のHTTP 404 / `42883`と`failed/internal_error`はない。
- invalid fixture由来の`invalid_ai_response`はない。
- `/menus/:menuId`未結線によるresult heading failureだけが残る場合は、Task 15の別blockerとして分離する。

Task 2のfocused E2E、static gates、Verifier、一次Reviewer、独立二次Reviewer、commitが完了するまで、設計全体のend-to-end目的達成を主張しない。AGENTS.mdのfull Vitest、full E2E、buildを含む最終9-step gateはTask 2および既知route blocker解消後の最終提出前に実行する。
