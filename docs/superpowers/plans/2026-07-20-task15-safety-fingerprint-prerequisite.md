# Task 15 Safety Fingerprint Prerequisite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task 15正本のprivate安全fingerprint helper 2関数を先行導入し、Task 14 correction E2Eがproduction finalizer経由で `succeeded` へ到達できるDB前提を完成させる。

**Architecture:** 未適用の既存migration `020` へ、正本Task 15のcanonical fingerprint builderとlocking/recheck helperをconsumerであるsuccess finalizerの直前に追加する。既存AI quota pgTAPへTypeScript互換hash、入力拒否、権限、lock順序の回帰証拠を追加し、public RPCやtest-only bypassは作らない。

**Tech Stack:** PostgreSQL、PL/pgSQL、Supabase local stack、pgTAP、Docker Compose。

## Global Constraints

- 対象migration `20260711002000_ai_control_and_quota.sql` は本番・共有Supabase環境へ未適用である。forward migrationを新規作成せず、既存migrationを修正する。
- 正本 `docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md` の2 helper bodyとREVOKEを文字単位で使用し、alternate serializerや別builderを作らない。
- `private.current_safety_fingerprint(uuid,uuid[])` と `private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)` だけを先行する。`public.confirm_menu_label_confirmation` とその他Task 15要素を含めない。
- 両関数は `SECURITY INVOKER`、空の `search_path`、完全修飾object名を維持し、`public`、`anon`、`authenticated`、`service_role` から全権限を剥奪する。
- 実二セッションlocking競合テストは正規Task 15へ残す。今回はstatic lock-order assertionとcurrent/stale fingerprint動作を検証する。
- コードコメントとcommit messageは日本語にする。
- Node/npm commandはDocker経由で実行し、すべてのcommandを `&&` や `;` で結合せず独立実行する。
- `./scripts/reset-local-db.sh` はlocal DB全データを破棄してstackを再作成する。実行前にscript/calleeの未確認差分がないことを確認する。
- 保持中の次の3 unstaged filesを破棄、stash、reset、checkout、stage、またはこのTaskのcommitへ混入しない。
  - `e2e/specs/generation-recovery-results.spec.ts`
  - `tools/e2e-function-server.mjs`
  - `tools/e2e-function-server.test.mjs`
- Execution gate: `AGENTS.md` のclean baseline要件と保持必須3 dirty filesは同時に満たせない。Implementer、VerifierのDocker実行前に、ユーザーがこの3差分をimmutable baselineとして扱う例外を明示承認していなければ開始しない。

---

## File Structure

- `supabase/tests/database/ai_control_and_quota.test.sql`: helperのsignature、metadata、ACL、canonical hash、不正入力、変更検出、lock順序をpgTAPで固定する。
- `supabase/migrations/20260711002000_ai_control_and_quota.sql`: 正本Task 15の2 private helperとREVOKEをfinalizer直前へ追加する。
- `.superpowers/sdd/task-15-safety-fingerprint-prerequisite-report.md`: RED/GREEN、baseline比較、verification、review結果を記録する。gitignore対象でcommitしない。

### Task 1: Install and prove the private safety fingerprint prerequisite

**Files:**
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Modify: `supabase/migrations/20260711002000_ai_control_and_quota.sql`
- Report: `.superpowers/sdd/task-15-safety-fingerprint-prerequisite-report.md`

**Interfaces:**
- Consumes: `public.household_members`、`public.member_allergies`、`public.allergen_catalog`、`public.allergen_aliases`、`public.food_safety_rules`、`extensions.digest(bytea,text)`、TypeScript `createCurrentSafetyFingerprint()` のcanonical key/sort契約。
- Produces: `private.current_safety_fingerprint(uuid,uuid[]) returns text`、`private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text) returns void`。既存 `public.finalize_ai_generation_success(...)` が同一transaction内で後者を呼ぶ。

- [ ] **Step 1: Authorityとimmutable dirty baselineを固定する**

作業開始baseを記録する。計画commit後の実装baseは、この計画をcommitしたHEADをcontrollerが明示し、`HEAD~1` で推定しない。

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

- branchは `main`。
- stagedとuntrackedは空。
- unstagedはGlobal Constraints記載のTask 2対象3 filesだけ。
- controllerはstaged、unstaged、untrackedの完全な内容をbaselineとして保存する。

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
git diff --quiet -- compose.yaml
```

Expected: all exit 0。非0なら該当diffを読み、破壊的操作、外部送信、secret参照を再評価するまでreset/Dockerを開始しない。

- [ ] **Step 2: Helper契約を固定するpgTAPを先に追加する**

`supabase/tests/database/ai_control_and_quota.test.sql` の先頭を次へ変更する。

```sql
\ir 000_helpers.sql
begin;
select no_plan();
```

既存2件の `generation_drafts` fixture直後、最初の `has_table(...)` より前へ次を追加する。

```sql
select tests.create_supabase_user(
  '15000000-0000-4000-8000-000000000001',
  'fingerprint-owner-a@example.invalid'
);
select tests.create_supabase_user(
  '15000000-0000-4000-8000-000000000002',
  'fingerprint-owner-b@example.invalid'
);

-- UUID順と逆順で作成し、物理的な挿入順へ依存しないことを固定する。
insert into public.household_members (
  id, user_id, status, display_name, age_band, allergy_status,
  required_safety_constraints, unsupported_diet_status, unsupported_diet_kinds
) values
  (
    '15100000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001',
    'complete', '大人', 'adult', 'none',
    '{}', 'none', '{}'
  ),
  (
    '15100000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    'complete', '子ども', 'age_3_5', 'registered',
    array['remove_bones', 'cut_small'],
    'present',
    array['therapeutic_diet', 'swallowing_concern']
  ),
  (
    '15100000-0000-4000-8000-000000000003',
    '15000000-0000-4000-8000-000000000001',
    'draft', '下書き', null, null,
    '{}', null, '{}'
  ),
  (
    '15200000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000002',
    'complete', '別世帯', 'adult', 'none',
    '{}', 'none', '{}'
  );

-- allergen ID順と異なる順序で作成する。
insert into public.member_allergies (
  id, user_id, member_id, allergen_id,
  custom_name, custom_aliases, custom_confirmed
) values
  (
    '15300000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'wheat', null, '{}', false
  ),
  (
    '15300000-0000-4000-8000-000000000003',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    null, '独自食材', array['独自別名'], true
  ),
  (
    '15300000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'egg', null, '{}', false
  );

select has_function(
  'private',
  'current_safety_fingerprint',
  array['uuid', 'uuid[]'],
  'current fingerprint helper has the exact input signature'
);
select function_returns(
  'private',
  'current_safety_fingerprint',
  array['uuid', 'uuid[]'],
  'text',
  'current fingerprint helper returns text'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'private'
      and procedure_.proname = 'current_safety_fingerprint'
  ),
  1,
  'current fingerprint helper has no overload'
);

select has_function(
  'private',
  'lock_and_assert_current_safety_fingerprint',
  array['uuid', 'uuid[]', 'text'],
  'locking fingerprint helper has the exact input signature'
);
select function_returns(
  'private',
  'lock_and_assert_current_safety_fingerprint',
  array['uuid', 'uuid[]', 'text'],
  'void',
  'locking fingerprint helper returns void'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'private'
      and procedure_.proname = 'lock_and_assert_current_safety_fingerprint'
  ),
  1,
  'locking fingerprint helper has no overload'
);

select ok(
  not (
    select procedure_.prosecdef
    from pg_catalog.pg_proc procedure_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
  ),
  'current fingerprint helper is SECURITY INVOKER'
);
select ok(
  not (
    select procedure_.prosecdef
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
    )
  ),
  'locking fingerprint helper is SECURITY INVOKER'
);
select is(
  (
    select procedure_.provolatile::text
    from pg_catalog.pg_proc procedure_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
  ),
  's',
  'current fingerprint helper is STABLE'
);
select is(
  (
    select procedure_.proconfig
    from pg_catalog.pg_proc procedure_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
  ),
  array['search_path=""']::text[],
  'current fingerprint helper has an empty search_path'
);
select is(
  (
    select procedure_.proconfig
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
    )
  ),
  array['search_path=""']::text[],
  'locking fingerprint helper has an empty search_path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc procedure_
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_.proacl,
        pg_catalog.acldefault('f', procedure_.proowner)
      )
    ) privilege_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
      and privilege_.grantee = 0
      and privilege_.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'private.current_safety_fingerprint(uuid,uuid[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.current_safety_fingerprint(uuid,uuid[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.current_safety_fingerprint(uuid,uuid[])',
    'EXECUTE'
  ),
  'PUBLIC and every external role cannot execute the current helper'
);
select ok(
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
      'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
    )
      and privilege_.grantee = 0
      and privilege_.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)',
    'EXECUTE'
  ),
  'PUBLIC and every external role cannot execute the locking helper'
);

select is(
  private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[]
  ),
  'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69',
  'fingerprint matches the canonical TypeScript-compatible SHA-256'
);

select throws_ok($$
  select private.current_safety_fingerprint(
    null::uuid,
    array['15100000-0000-4000-8000-000000000001']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a null owner is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001', null::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a null member array is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001', '{}'::uuid[]
  )
$$, '22023', 'invalid_target_members', 'an empty member array is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001', array[null]::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a null member element is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000001'
    ]::uuid[]
  )
$$, '22023', 'invalid_target_members', 'duplicate members are rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array['15900000-0000-4000-8000-000000000001']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a missing member is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array['15200000-0000-4000-8000-000000000001']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a foreign member is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array['15100000-0000-4000-8000-000000000003']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a draft member is rejected');

delete from public.member_allergies
where member_id = '15100000-0000-4000-8000-000000000001';

-- 同じlogical setを異なる順序で再作成し、row insertion order非依存を固定する。
insert into public.member_allergies (
  id, user_id, member_id, allergen_id,
  custom_name, custom_aliases, custom_confirmed
) values
  (
    '15300000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'egg', null, '{}', false
  ),
  (
    '15300000-0000-4000-8000-000000000003',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    null, '独自食材', array['独自別名'], true
  ),
  (
    '15300000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'wheat', null, '{}', false
  );

select is(
  private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[]
  ),
  'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69',
  'member and allergy insertion order does not change the fingerprint'
);

select lives_ok($$
  select private.lock_and_assert_current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[],
    'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69'
  )
$$, 'the locking helper accepts the exact current fingerprint');
select throws_ok($$
  select private.lock_and_assert_current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[], null
  )
$$, '22023', 'current_safety_changed',
  'the locking helper rejects a null expected fingerprint');

delete from public.member_allergies
where id = '15300000-0000-4000-8000-000000000001';

select isnt(
  private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[]
  ),
  'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69',
  'an allergy mutation changes the fingerprint'
);
select throws_ok($$
  select private.lock_and_assert_current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[],
    'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69'
  )
$$, 'P0001', 'current_safety_changed',
  'the locking helper rejects a stale expected fingerprint');

select ok(
  (
    select
      pg_catalog.strpos(definition_, 'from public.household_members member') > 0
      and pg_catalog.strpos(
        definition_, 'from public.member_allergies allergy'
      ) > pg_catalog.strpos(
        definition_, 'from public.household_members member'
      )
      and pg_catalog.strpos(
        definition_, 'lock table public.allergen_catalog in share mode'
      ) > pg_catalog.strpos(
        definition_, 'from public.member_allergies allergy'
      )
      and pg_catalog.strpos(
        definition_, 'lock table public.allergen_aliases in share mode'
      ) > pg_catalog.strpos(
        definition_, 'lock table public.allergen_catalog in share mode'
      )
      and pg_catalog.strpos(
        definition_, 'lock table public.food_safety_rules in share mode'
      ) > pg_catalog.strpos(
        definition_, 'lock table public.allergen_aliases in share mode'
      )
      and pg_catalog.strpos(
        definition_, 'v_actual:=private.current_safety_fingerprint'
      ) > pg_catalog.strpos(
        definition_, 'lock table public.food_safety_rules in share mode'
      )
    from (
      select pg_catalog.pg_get_functiondef(
        to_regprocedure(
          'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
        )
      ) as definition_
    ) function_
  ),
  'locking helper keeps member, allergy, catalog, alias, rule, recalculation order'
);
```

末尾の `select * from finish();` と `rollback;` は維持する。既存64 assertionに28 assertionが加わり、GREEN時は92/92 PASSとなる。

- [ ] **Step 3: Fresh resetでexpected REDを観測する**

Step 1で保存したstaged、unstaged、untracked baselineを再取得し、pgTAP以外の差分が変わっていないことを確認する。その後、各commandを独立実行する。

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test supabase/tests/database/ai_control_and_quota.test.sql
```

Expected RED:

- resetはexit 0。
- focused pgTAPは非0。
- 最初のhelper existence assertionが `not ok` になり、後続の直接参照は `function ... does not exist` で失敗する。
- helper不存在以外のmigration、fixture、script failureならRED成立扱いにせず、test setupを修正して再実行する。
- reset前後で、Step 2のpgTAP差分と保持中Task 2の3差分を除く意図しないhost変更がない。

REDのcommand、exit code、relevant excerpt、期待どおりである理由をreportへ記録する。

- [ ] **Step 4: Exact 2 helperとREVOKEだけをmigrationへ追加する**

`supabase/migrations/20260711002000_ai_control_and_quota.sql` の
`private.persist_validated_menu(...)` 終端後、`public.finalize_ai_generation_success(...)` 定義前へ次をそのまま追加する。

```sql
create or replace function private.current_safety_fingerprint(
  p_user_id uuid,p_target_member_ids uuid[]
) returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_requested_count integer;
  v_member_count integer;
  v_members text;
  v_payload text;
begin
  if p_user_id is null or p_target_member_ids is null
     or pg_catalog.cardinality(p_target_member_ids)=0
     or pg_catalog.array_position(p_target_member_ids,null::uuid) is not null then
    raise exception using errcode='22023',message='invalid_target_members';
  end if;
  select pg_catalog.count(distinct requested.member_id)::integer
    into v_requested_count
  from pg_catalog.unnest(p_target_member_ids) as requested(member_id);
  if v_requested_count<>pg_catalog.cardinality(p_target_member_ids) then
    raise exception using errcode='22023',message='invalid_target_members';
  end if;

  with requested as (
    select target.member_id,target.ordinality
    from pg_catalog.unnest(p_target_member_ids) with ordinality
      as target(member_id,ordinality)
  ), canonical_members as (
    select member.id,
      'member_'||requested.ordinality::text as anonymous_ref,
      member.age_band,member.allergy_status,
      coalesce(array(select allergy.allergen_id
        from public.member_allergies allergy
        where allergy.user_id=p_user_id and allergy.member_id=member.id
          and allergy.allergen_id is not null
        order by allergy.allergen_id),array[]::text[]) as allergen_ids,
      exists(select 1 from public.member_allergies allergy
        where allergy.user_id=p_user_id and allergy.member_id=member.id
          and allergy.allergen_id is null) as has_unmapped_custom_allergy,
      array(select value from pg_catalog.unnest(member.required_safety_constraints)
        as constraints_(value) order by value) as required_constraints,
      member.unsupported_diet_status,
      array(select value from pg_catalog.unnest(member.unsupported_diet_kinds)
        as diets(value) order by value) as unsupported_diet_kinds
    from requested
    join public.household_members member
      on member.id=requested.member_id and member.user_id=p_user_id
     and member.status='complete'
  ), encoded as (
    select id,
      '{"householdMemberId":'||pg_catalog.to_json(id::text)::text||
      ',"anonymousRef":'||pg_catalog.to_json(anonymous_ref)::text||
      ',"ageBand":'||pg_catalog.to_json(age_band)::text||
      ',"allergyStatus":'||pg_catalog.to_json(allergy_status)::text||
      ',"allergenIds":'||pg_catalog.to_json(allergen_ids)::text||
      ',"hasUnmappedCustomAllergy":'||
        pg_catalog.to_json(has_unmapped_custom_allergy)::text||
      ',"requiredSafetyConstraints":'||pg_catalog.to_json(required_constraints)::text||
      ',"unsupportedDietStatus":'||pg_catalog.to_json(unsupported_diet_status)::text||
      ',"unsupportedDietKinds":'||pg_catalog.to_json(unsupported_diet_kinds)::text||'}'
      as encoded_member
    from canonical_members
  )
  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.string_agg(encoded_member,',' order by id::text),'')
    into v_member_count,v_members
  from encoded;
  if v_member_count<>v_requested_count then
    raise exception using errcode='22023',message='invalid_target_members';
  end if;

  v_payload := '{"dictionaryVersion":"jp-caa-2026-04.v1"'
    ||',"foodRuleVersion":"jp-caa-child-shape-2026-07.v1"'
    ||',"members":['||v_members||']}';
  return pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_payload,'UTF8'),'sha256'),'hex');
end
$function$;

create or replace function private.lock_and_assert_current_safety_fingerprint(
  p_user_id uuid,p_target_member_ids uuid[],p_expected text
) returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare v_actual text;
begin
  if p_expected is null then
    raise exception using errcode='22023',message='current_safety_changed';
  end if;
  -- 親行のFOR UPDATEで、新しい外部キー子行が取得するKEY SHAREと競合させる。
  perform 1 from public.household_members member
    where member.user_id=p_user_id
      and member.id=any(p_target_member_ids)
      and member.status='complete'
    order by member.id for update;
  perform 1 from public.member_allergies allergy
    where allergy.user_id=p_user_id
      and allergy.member_id=any(p_target_member_ids)
    order by allergy.member_id,allergy.id for share;
  lock table public.allergen_catalog in share mode;
  lock table public.allergen_aliases in share mode;
  lock table public.food_safety_rules in share mode;
  v_actual:=private.current_safety_fingerprint(p_user_id,p_target_member_ids);
  if v_actual is distinct from p_expected then
    raise exception using errcode='P0001',message='current_safety_changed';
  end if;
end
$function$;

revoke all on function private.current_safety_fingerprint(uuid,uuid[])
  from public,anon,authenticated,service_role;
revoke all on function private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)
  from public,anon,authenticated,service_role;
```

このStepでは他のmigration body、finalizer、public RPC、schema/table/RLSを変更しない。

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
- focused pgTAPは92/92 PASS、skip 0、warning/errorなし。
- reset前後で、migration/test差分と保持中Task 2の3差分を除く意図しないhost変更がない。

GREENのcommand、exit code、92/92、output noise有無をreportへ記録する。

- [ ] **Step 6: Task scopeのstatic/full DB gatesを実行する**

各Docker/reset command前後でstaged、unstaged、untracked baselineを再取得し、許可済み5 files以外のhost変更がないことを確認する。

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

Expected: all exit 0。full pgTAPは全database testがPASSする。full Vitest、E2E、buildはTask 2 correction完了後の最終gateへ残す。

- [ ] **Step 7: Self-reviewして2 SQL filesだけをcommitする**

次を行単位で照合する。

- migration diffはexact 2 helperと2 REVOKEだけ。
- test diffは `\ir 000_helpers.sql`、`no_plan()`、fixture、28 assertionsだけ。
- known hashは `afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69`。
- `public.confirm_menu_label_confirmation`、alternate serializer、test-local builder、runtime concurrency test、router変更がない。
- 保持中Task 2の3 filesはStep 1 baselineと同一。

Run independently:

```bash
git diff --check -- supabase/migrations/20260711002000_ai_control_and_quota.sql supabase/tests/database/ai_control_and_quota.test.sql
```

```bash
git add supabase/migrations/20260711002000_ai_control_and_quota.sql supabase/tests/database/ai_control_and_quota.test.sql
```

```bash
git diff --cached --name-status
```

Expected: stagedは上記2 SQL filesだけ。

```bash
git diff --cached --check
```

```bash
git commit -m "fix: 安全fingerprint検証を先行導入"
```

```bash
git show --name-status --format= --no-renames HEAD
```

Expected: commitは2 SQL filesだけ。保持中Task 2の3 filesはunstagedのまま残る。

Implementerは `.superpowers/sdd/task-15-safety-fingerprint-prerequisite-report.md` に次を記録し、commitしない。

- RED command、helper不存在のrelevant excerpt、期待どおりである理由。
- GREEN 92/92と全Task gates。
- reset/Docker前後のbaseline一致。
- commit hashと対象2 files。
- self-reviewと懸念。

## Controller Review and Verification Gate

Task 1 commit後、controllerは記録済みbaseから実装HEADまでreview packageを生成する。

1. fresh Verifierがreset、focused pgTAP、format、lint、typecheck、full pgTAP、diff-checkを再実行し、全command前後のimmutable dirty baseline一致を報告する。
2. fresh read-only Reviewerがexact Task 15 SQL、canonical serialization、SQLSTATE/message、ACL、empty search_path、SECURITY INVOKER、lock順、不正入力coverage、scope leakageを一次reviewする。
3. 一次Reviewerとコンテキストを共有しない別Reviewerがfindingと見落としを二次検証する。
4. Critical/Importantがあればcombined findingsをfresh fix Implementerへ渡し、focused testを再実行してreportへ追記し、Verifierと両Reviewerを新HEADで反復する。
5. clean後、`.superpowers/sdd/progress.md` へ `Plan 3 Task 15 safety fingerprint prerequisite: complete (...)` と追記する。Plan 3 Task 15全体をcompleteとは記録しない。

このprerequisite planは1 Taskだけなので内部handoffを作成しない。完了後は既存
`.superpowers/sdd/invalid-ai-response-task-2-brief.md` のblocked Task 2へfresh Implementerで戻り、DB helper commitを確定interfaceとして渡す。
