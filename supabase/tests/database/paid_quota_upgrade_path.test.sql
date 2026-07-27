-- Plan 8: 旧 5/12 CHECK 上の合法行を seed し、upgrade_ai_daily_quota_checks_to_3_6 が
-- 失敗せず・当日超過を clamp せず・過去日を掃除することを検証する。

begin;
select plan(12);

create extension if not exists pgtap with schema extensions;

-- ---------------------------------------------------------------------------
-- 前提: 現行 DB は既に 3/6。旧スキーマ状態を一時再現して upgrade 関数を再実行する。
-- ---------------------------------------------------------------------------
do $setup$
declare
  r record;
begin
  -- 現行の reserved+success / reserved+sent 合計 CHECK をすべて外し、旧 5/12 を載せる
  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_usage'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%reserved_count%success_count%'
  loop
    execute format(
      'alter table private.ai_user_daily_usage drop constraint %I',
      r.conname
    );
  end loop;

  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_external_attempts'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%reserved_count%sent_count%'
  loop
    execute format(
      'alter table private.ai_user_daily_external_attempts drop constraint %I',
      r.conname
    );
  end loop;

  alter table private.ai_user_daily_usage
    add constraint ai_user_daily_usage_reserved_success_le_5_test
    check (reserved_count + success_count <= 5);

  alter table private.ai_user_daily_external_attempts
    add constraint ai_user_daily_external_attempts_reserved_sent_le_12_test
    check (reserved_count + sent_count <= 12);
end
$setup$;

select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'quota-upgrade-past@example.invalid'
);
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000002'::uuid,
  'quota-upgrade-today@example.invalid'
);
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000003'::uuid,
  'quota-upgrade-active@example.invalid'
);

-- 過去日: 旧合法 success=5 / attempt=12
insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
values (
  'a1000000-0000-4000-8000-000000000001'::uuid,
  private.ai_jst_day(now()) - 1,
  0,
  5
);

insert into private.ai_user_daily_external_attempts (user_id, usage_day, reserved_count, sent_count)
values (
  'a1000000-0000-4000-8000-000000000001'::uuid,
  private.ai_jst_day(now()) - 1,
  0,
  12
);

-- 当日・予約なし: 旧合法 success=4 / attempt=7（clamp 禁止の対象）
insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
values (
  'a1000000-0000-4000-8000-000000000002'::uuid,
  private.ai_jst_day(now()),
  0,
  4
);

insert into private.ai_user_daily_external_attempts (user_id, usage_day, reserved_count, sent_count)
values (
  'a1000000-0000-4000-8000-000000000002'::uuid,
  private.ai_jst_day(now()),
  0,
  7
);

-- 当日・active reservation だが新上限内: reserved=1 success=2 → total 3 OK
insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
values (
  'a1000000-0000-4000-8000-000000000003'::uuid,
  private.ai_jst_day(now()),
  1,
  2
);

select lives_ok(
  $$ select private.upgrade_ai_daily_quota_checks_to_3_6() $$,
  'upgrade succeeds with past overage + today overage (no active over-limit reservation)'
);

select is(
  (
    select count(*)::integer
    from private.ai_user_daily_usage
    where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  ),
  0,
  'past-day success usage rows are deleted (not a same-day quota reset)'
);

select is(
  (
    select count(*)::integer
    from private.ai_user_daily_external_attempts
    where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  ),
  0,
  'past-day attempt rows are deleted'
);

select is(
  (
    select success_count
    from private.ai_user_daily_usage
    where user_id = 'a1000000-0000-4000-8000-000000000002'::uuid
      and usage_day = private.ai_jst_day(now())
  ),
  4,
  'today over-limit success_count is preserved (no clamp / no free slots)'
);

select is(
  (
    select sent_count
    from private.ai_user_daily_external_attempts
    where user_id = 'a1000000-0000-4000-8000-000000000002'::uuid
      and usage_day = private.ai_jst_day(now())
  ),
  7,
  'today over-limit sent_count is preserved (no clamp)'
);

select is(
  (
    select reserved_count + success_count
    from private.ai_user_daily_usage
    where user_id = 'a1000000-0000-4000-8000-000000000003'::uuid
  ),
  3,
  'in-limit active reservation row is kept intact'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_usage'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*success_count.*<=[[:space:]]*3'
  ),
  'success CHECK <= 3 exists after upgrade'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_external_attempts'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*sent_count.*<=[[:space:]]*6'
  ),
  'attempt CHECK <= 6 exists after upgrade'
);

-- 新 INSERT で上限超過は拒否される（NOT VALID でも新規行は検査）
select throws_ok(
  $$
    insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
    values (
      'a1000000-0000-4000-8000-000000000001'::uuid,
      private.ai_jst_day(now()),
      0,
      4
    )
  $$,
  '23514',
  null,
  'new rows cannot exceed success CHECK 3'
);

-- active reservation が新上限超過なら upgrade は fail-closed
do $active_block$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_usage'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%reserved_count%success_count%'
  loop
    execute format(
      'alter table private.ai_user_daily_usage drop constraint %I',
      r.conname
    );
  end loop;
  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_external_attempts'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%reserved_count%sent_count%'
  loop
    execute format(
      'alter table private.ai_user_daily_external_attempts drop constraint %I',
      r.conname
    );
  end loop;

  alter table private.ai_user_daily_usage
    add constraint ai_user_daily_usage_reserved_success_le_5_test2
    check (reserved_count + success_count <= 5);
  alter table private.ai_user_daily_external_attempts
    add constraint ai_user_daily_external_attempts_reserved_sent_le_12_test2
    check (reserved_count + sent_count <= 12);

  delete from private.ai_user_daily_usage;
  delete from private.ai_user_daily_external_attempts;

  insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
  values (
    'a1000000-0000-4000-8000-000000000003'::uuid,
    private.ai_jst_day(now()),
    1,
    3
  );
end
$active_block$;

select throws_ok(
  $$ select private.upgrade_ai_daily_quota_checks_to_3_6() $$,
  'P0001',
  'quota_upgrade_blocked_active_success_reservation',
  'upgrade blocks when active reservation exceeds new success limit'
);

-- 後続テスト汚染防止: 制約を 3/6 に戻し、seed 行を消す
do $cleanup$
declare
  r record;
begin
  delete from private.ai_user_daily_usage
  where user_id in (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000003'::uuid
  );
  delete from private.ai_user_daily_external_attempts
  where user_id in (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000003'::uuid
  );

  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_usage'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%reserved_count%success_count%'
  loop
    execute format(
      'alter table private.ai_user_daily_usage drop constraint %I',
      r.conname
    );
  end loop;

  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_external_attempts'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%reserved_count%sent_count%'
  loop
    execute format(
      'alter table private.ai_user_daily_external_attempts drop constraint %I',
      r.conname
    );
  end loop;

  alter table private.ai_user_daily_usage
    add constraint ai_user_daily_usage_reserved_success_le_3
    check (reserved_count + success_count <= 3);
  alter table private.ai_user_daily_external_attempts
    add constraint ai_user_daily_external_attempts_reserved_sent_le_6
    check (reserved_count + sent_count <= 6);
end
$cleanup$;

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_usage'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*success_count.*<=[[:space:]]*3'
  ),
  'cleanup restores success CHECK <= 3'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_external_attempts'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*sent_count.*<=[[:space:]]*6'
  ),
  'cleanup restores attempt CHECK <= 6'
);

select * from finish();
rollback;
