\ir 000_helpers.sql
-- Plan 8: 旧 5/12 CHECK 上の合法行を seed し、upgrade_ai_daily_quota_checks_to_3_6 が
-- 失敗せず・当日超過を clamp せず・安全な過去日だけ掃除することを検証する。
-- lock 後 recheck / 日跨ぎ active reservation 保持 / success4·attempt7 並行 cutover も固定する。

begin;
select plan(20);

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
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000004'::uuid,
  'quota-upgrade-midnight@example.invalid'
);
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000005'::uuid,
  'quota-upgrade-cutover47@example.invalid'
);
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000006'::uuid,
  'quota-upgrade-ceiling@example.invalid'
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

-- 当日・予約なし: 旧合法上限 success=5 / attempt=12（投影 cap の境界）
insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
values (
  'a1000000-0000-4000-8000-000000000006'::uuid,
  private.ai_jst_day(now()),
  0,
  5
);

insert into private.ai_user_daily_external_attempts (user_id, usage_day, reserved_count, sent_count)
values (
  'a1000000-0000-4000-8000-000000000006'::uuid,
  private.ai_jst_day(now()),
  0,
  12
);

-- 当日・active reservation だが新上限内: reserved=1 success=2 → total 3 OK
insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
values (
  'a1000000-0000-4000-8000-000000000003'::uuid,
  private.ai_jst_day(now()),
  1,
  2
);

-- 過去日・active reservation（JST 日跨ぎ 23:59:59 相当）: reserved=1 success=0 を保持し live request が参照
insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
values (
  'a1000000-0000-4000-8000-000000000004'::uuid,
  private.ai_jst_day(now()) - 1,
  1,
  0
);
insert into private.ai_user_daily_external_attempts (user_id, usage_day, reserved_count, sent_count)
values (
  'a1000000-0000-4000-8000-000000000004'::uuid,
  private.ai_jst_day(now()) - 1,
  1,
  0
);
insert into private.ai_generation_requests (
  id, user_id, idempotency_key, request_kind, status,
  request_hmac_version, request_hmac,
  user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
  global_reserved_day, processing_expires_at, started_at
) values (
  'a2000000-0000-4000-8000-000000000004'::uuid,
  'a1000000-0000-4000-8000-000000000004'::uuid,
  'a3000000-0000-4000-8000-000000000004'::uuid,
  'regenerate_menu',
  'processing',
  'generation-command.v2',
  repeat('ab', 32),
  private.ai_jst_day(now()) - 1,
  true,
  true,
  private.ai_jst_day(now()) - 1,
  private.ai_jst_day(now()) - 1,
  now() + interval '180 seconds',
  now() - interval '1 second'
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
    select success_count
    from private.ai_user_daily_usage
    where user_id = 'a1000000-0000-4000-8000-000000000006'::uuid
      and usage_day = private.ai_jst_day(now())
  ),
  5,
  'today ceiling success_count=5 is preserved (no clamp)'
);

select is(
  (
    select sent_count
    from private.ai_user_daily_external_attempts
    where user_id = 'a1000000-0000-4000-8000-000000000006'::uuid
      and usage_day = private.ai_jst_day(now())
  ),
  12,
  'today ceiling sent_count=12 is preserved (no clamp)'
);

-- F2: 公開 projection は least(raw, limit)。raw DB は不変。reserve 拒否。翌 JST 日は 0 残。
do $f2_projection$
declare
  v_owner_4 constant uuid := 'a1000000-0000-4000-8000-000000000002';
  v_owner_5 constant uuid := 'a1000000-0000-4000-8000-000000000006';
  v_draft_id constant uuid := 'a4000000-0000-4000-8000-000000000002';
  v_now timestamptz := clock_timestamp();
  v_next_day timestamptz;
  v_usage jsonb;
  v_reserve jsonb;
  v_raw_success integer;
  v_raw_sent integer;
begin
  -- success=4 / attempt=7 → 公開 3/3/0・6/6/0
  v_usage := public.get_ai_usage_today(v_owner_4, v_now, 20);
  if (v_usage->'success'->>'consumed')::integer <> 3
     or (v_usage->'success'->>'limit')::integer <> 3
     or (v_usage->'success'->>'remaining')::integer <> 0 then
    raise exception 'raw4 projection success expected 3/3/0, got %', v_usage->'success';
  end if;
  if (v_usage->'attempts'->>'sent')::integer <> 6
     or (v_usage->'attempts'->>'limit')::integer <> 6
     or (v_usage->'attempts'->>'remaining')::integer <> 0 then
    raise exception 'raw7 projection attempts expected 6/6/0, got %', v_usage->'attempts';
  end if;
  if (v_usage->>'retryAt') is null then
    raise exception 'over-limit projection must set retryAt (next JST midnight): %', v_usage;
  end if;

  -- success=5 / attempt=12 も同じ cap
  v_usage := public.get_ai_usage_today(v_owner_5, v_now, 20);
  if (v_usage->'success'->>'consumed')::integer <> 3
     or (v_usage->'success'->>'remaining')::integer <> 0
     or (v_usage->'attempts'->>'sent')::integer <> 6
     or (v_usage->'attempts'->>'remaining')::integer <> 0 then
    raise exception 'raw5/12 projection expected capped 3/0 and 6/0, got %', v_usage;
  end if;

  -- RPC 後も raw は 4/7・5/12 のまま
  select success_count into v_raw_success
  from private.ai_user_daily_usage
  where user_id = v_owner_4 and usage_day = private.ai_jst_day(v_now);
  select sent_count into v_raw_sent
  from private.ai_user_daily_external_attempts
  where user_id = v_owner_4 and usage_day = private.ai_jst_day(v_now);
  if v_raw_success <> 4 or v_raw_sent <> 7 then
    raise exception 'raw counters for owner_4 mutated after usage RPC: success=% sent=%',
      v_raw_success, v_raw_sent;
  end if;
  select success_count into v_raw_success
  from private.ai_user_daily_usage
  where user_id = v_owner_5 and usage_day = private.ai_jst_day(v_now);
  select sent_count into v_raw_sent
  from private.ai_user_daily_external_attempts
  where user_id = v_owner_5 and usage_day = private.ai_jst_day(v_now);
  if v_raw_success <> 5 or v_raw_sent <> 12 then
    raise exception 'raw counters for owner_5 mutated after usage RPC: success=% sent=%',
      v_raw_success, v_raw_sent;
  end if;

  -- 新規 reserve は raw 基準で拒否（枠復活なし）
  insert into public.generation_drafts (
    id, user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
    servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
    pantry_selections, revision
  ) values (
    v_draft_id, v_owner_4, 'dinner', array['鶏肉'], 'japanese', 'household',
    array[v_owner_4], null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1
  );

  v_reserve := public.reserve_ai_generation(
    v_owner_4,
    'a5000000-0000-4000-8000-000000000002'::uuid,
    'new_menu',
    v_draft_id,
    1,
    null,
    null,
    null,
    'generation-command.v2',
    repeat('cd', 32),
    jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', 'household',
      'servings', null,
      'target_member_ids', jsonb_build_array(v_owner_4::text),
      'source_menu_version', null
    ),
    3,
    20,
    180,
    v_now
  );
  if v_reserve->>'status' is distinct from 'failed'
     or v_reserve->>'failure_code' is distinct from 'user_daily_limit' then
    raise exception 'over-limit reserve must fail user_daily_limit, got %', v_reserve;
  end if;

  select success_count, reserved_count into v_raw_success, v_raw_sent
  from private.ai_user_daily_usage
  where user_id = v_owner_4 and usage_day = private.ai_jst_day(v_now);
  if v_raw_success <> 4 or v_raw_sent <> 0 then
    raise exception 'reserve must not mutate over-limit success row: success=% reserved=%',
      v_raw_success, v_raw_sent;
  end if;

  -- 翌 JST 日は新しい day row が無いので 0/3・0/6
  v_next_day :=
    ((private.ai_jst_day(v_now) + 1)::timestamp at time zone 'Asia/Tokyo')
    + interval '1 hour';
  v_usage := public.get_ai_usage_today(v_owner_4, v_next_day, 20);
  if (v_usage->'success'->>'consumed')::integer <> 0
     or (v_usage->'success'->>'limit')::integer <> 3
     or (v_usage->'success'->>'remaining')::integer <> 3 then
    raise exception 'next JST day success expected 0/3/3, got %', v_usage->'success';
  end if;
  if (v_usage->'attempts'->>'sent')::integer <> 0
     or (v_usage->'attempts'->>'limit')::integer <> 6
     or (v_usage->'attempts'->>'remaining')::integer <> 6 then
    raise exception 'next JST day attempts expected 0/6/6, got %', v_usage->'attempts';
  end if;
end
$f2_projection$;
select pass(
  'F2: over-limit raw projects to 3/3/0 and 6/6/0; raw unchanged; reserve denied; next day full remaining'
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

select is(
  (
    select reserved_count
    from private.ai_user_daily_usage
    where user_id = 'a1000000-0000-4000-8000-000000000004'::uuid
      and usage_day = private.ai_jst_day(now()) - 1
  ),
  1,
  'past-day active success reservation survives cutover (no unconditional midnight purge)'
);

select is(
  (
    select reserved_count
    from private.ai_user_daily_external_attempts
    where user_id = 'a1000000-0000-4000-8000-000000000004'::uuid
      and usage_day = private.ai_jst_day(now()) - 1
  ),
  1,
  'past-day active attempt reservation survives cutover'
);

-- finalize 相当: reserved→success の同一合計更新が cutover 後も可能
select lives_ok(
  $$
    update private.ai_user_daily_usage
    set reserved_count = reserved_count - 1,
        success_count = success_count + 1
    where user_id = 'a1000000-0000-4000-8000-000000000004'::uuid
      and usage_day = private.ai_jst_day(now()) - 1
      and reserved_count > 0
  $$,
  'post-cutover finalize-shaped success update on past-day reservation succeeds'
);

select lives_ok(
  $$
    update private.ai_user_daily_external_attempts
    set reserved_count = reserved_count - 1,
        sent_count = sent_count + 1
    where user_id = 'a1000000-0000-4000-8000-000000000004'::uuid
      and usage_day = private.ai_jst_day(now()) - 1
      and reserved_count > 0
  $$,
  'post-cutover finalize-shaped attempt update on past-day reservation succeeds'
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

-- 並行 cutover: success total 4 / attempt total 7 が active（reserved>0）なら fail-closed
do $cutover47$
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
    add constraint ai_user_daily_usage_reserved_success_le_5_test3
    check (reserved_count + success_count <= 5);
  alter table private.ai_user_daily_external_attempts
    add constraint ai_user_daily_external_attempts_reserved_sent_le_12_test3
    check (reserved_count + sent_count <= 12);

  delete from private.ai_generation_requests
  where user_id = 'a1000000-0000-4000-8000-000000000005'::uuid;
  delete from private.ai_user_daily_usage
  where user_id = 'a1000000-0000-4000-8000-000000000005'::uuid;
  delete from private.ai_user_daily_external_attempts
  where user_id = 'a1000000-0000-4000-8000-000000000005'::uuid;

  -- 旧合法 5/12 上で concurrent writer が作る境界: total success 4 / attempt 7 with reserved
  insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count)
  values (
    'a1000000-0000-4000-8000-000000000005'::uuid,
    private.ai_jst_day(now()),
    1,
    3
  );
  insert into private.ai_user_daily_external_attempts (user_id, usage_day, reserved_count, sent_count)
  values (
    'a1000000-0000-4000-8000-000000000005'::uuid,
    private.ai_jst_day(now()),
    1,
    6
  );
end
$cutover47$;

select throws_ok(
  $$ select private.upgrade_ai_daily_quota_checks_to_3_6() $$,
  'P0001',
  'quota_upgrade_blocked_active_success_reservation',
  'concurrent cutover with success total 4 active reservation is blocked under lock recheck'
);

-- 後続テスト汚染防止: 制約を 3/6 に戻し、seed 行を消す
do $cleanup$
declare
  r record;
begin
  delete from private.ai_generation_requests
  where user_id in (
    'a1000000-0000-4000-8000-000000000004'::uuid,
    'a1000000-0000-4000-8000-000000000005'::uuid
  );
  delete from private.ai_generation_requests
  where user_id = 'a1000000-0000-4000-8000-000000000002'::uuid;
  delete from private.generation_draft_submission_versions
  where user_id = 'a1000000-0000-4000-8000-000000000002'::uuid;
  delete from public.generation_drafts
  where id = 'a4000000-0000-4000-8000-000000000002'::uuid;
  delete from private.ai_user_daily_usage
  where user_id in (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000003'::uuid,
    'a1000000-0000-4000-8000-000000000004'::uuid,
    'a1000000-0000-4000-8000-000000000005'::uuid,
    'a1000000-0000-4000-8000-000000000006'::uuid
  );
  delete from private.ai_user_daily_external_attempts
  where user_id in (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000003'::uuid,
    'a1000000-0000-4000-8000-000000000004'::uuid,
    'a1000000-0000-4000-8000-000000000005'::uuid,
    'a1000000-0000-4000-8000-000000000006'::uuid
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
