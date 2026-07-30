-- user_feedback: service_role のみ書き込み、5 件/24h rate limit、authenticated deny
\ir 000_helpers.sql
begin;
select plan(4);

select has_function(
  'public',
  'insert_user_feedback_rate_limited',
  array['uuid', 'text', 'text', 'text', 'integer', 'integer']
);

select has_function(
  'public',
  'get_ai_usage_today',
  array['uuid', 'text', 'integer', 'integer', 'integer', 'integer', 'timestamp with time zone']
);

-- 旧 overload が残っていないこと（identity_key / p_global_limit 無視回帰の防止）
select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_ai_usage_today'
      and pg_get_function_identity_arguments(p.oid) in (
        'p_user_id uuid, p_now timestamp with time zone',
        'p_user_id uuid, p_now timestamp with time zone, p_global_limit integer'
      )
  ),
  0,
  'get_ai_usage_today has no pre-identity overload without p_identity_key'
);

do $body$
declare
  v_owner uuid := 'a1000000-0000-4000-8000-0000000000fb';
  v_other uuid := 'a1000000-0000-4000-8000-0000000000fc';
  v_result jsonb;
  v_i integer;
  v_count integer;
begin
  perform tests.create_supabase_user(v_owner, 'feedback-owner@example.invalid');
  perform tests.create_supabase_user(v_other, 'feedback-other@example.invalid');

  -- authenticated は grant 無し + deny policy で拒否（superuser のままでは RLS をすり抜ける）
  perform tests.authenticate_as(v_owner);
  set local role authenticated;
  begin
    insert into public.user_feedback (user_id, category, body)
    values (v_owner, 'other', 'authenticated からの直接 insert は拒否されるはず。');
    raise exception 'authenticated insert on user_feedback should fail';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlstate in ('42501', 'P0001') then null;
      -- RLS policy deny は 42501 以外になる場合がある
      elsif sqlerrm like '%policy%' or sqlerrm like '%permission%' then null;
      else raise;
      end if;
  end;
  begin
    perform 1 from public.user_feedback where user_id = v_owner limit 1;
    -- SELECT も grant 無しなら permission denied
    raise exception 'authenticated select on user_feedback should fail';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlstate = '42501' then null;
      else raise;
      end if;
  end;
  reset role;
  perform tests.clear_authentication();

  if exists (
    select 1
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name = 'user_feedback'
  ) then
    raise exception 'authenticated must not have table grants on user_feedback';
  end if;

  -- 5 件まで成功、6 件目は feedback_rate_limited
  for v_i in 1..5 loop
    v_result := public.insert_user_feedback_rate_limited(
      v_owner,
      'bug_report',
      'rate-limit body number ' || v_i::text || ' xxxxxxxx',
      null,
      5,
      86400
    );
    if coalesce(v_result ->> 'ok', 'false') <> 'true' then
      raise exception 'insert #% should succeed: %', v_i, v_result;
    end if;
  end loop;

  v_result := public.insert_user_feedback_rate_limited(
    v_owner,
    'bug_report',
    'rate-limit body number 6 should fail x',
    null,
    5,
    86400
  );
  if v_result is distinct from jsonb_build_object('ok', false, 'code', 'feedback_rate_limited') then
    raise exception '6th insert should rate-limit: %', v_result;
  end if;

  select count(*)::integer into v_count
  from public.user_feedback
  where user_id = v_owner;
  if v_count <> 5 then
    raise exception 'expected 5 rows after rate limit, got %', v_count;
  end if;

  -- 他利用者の枠は独立
  v_result := public.insert_user_feedback_rate_limited(
    v_other,
    'feature_request',
    'other user first feedback body xx',
    '/settings',
    5,
    86400
  );
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'other user insert should succeed: %', v_result;
  end if;

  -- 窓外（window_seconds=1）にすれば再送信できる
  perform pg_sleep(1.1);
  v_result := public.insert_user_feedback_rate_limited(
    v_owner,
    'other',
    'after window reset feedback body xx',
    null,
    5,
    1
  );
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'insert after window should succeed: %', v_result;
  end if;

  -- p_global_limit が usage today に効く。
  -- 共有 DB の当日 global 台帳に依存しないよう、行の無い固定日を p_now で指定する。
  v_result := public.get_ai_usage_today(v_owner, tests.quota_identity_key(v_owner), 3, 6, 4, 1, '2000-01-01 00:00:00+00'::timestamptz);
  if (v_result ->> 'globalAvailable') is distinct from 'true' then
    raise exception 'empty ledger should be globalAvailable with limit 1: %', v_result;
  end if;

  -- global 上限は ENV のみ。SQL は p_global_limit=0 でも raise せず globalAvailable=false。
  v_result := public.get_ai_usage_today(
    v_owner, tests.quota_identity_key(v_owner), 3, 6, 4, 0, '2000-01-01 00:00:00+00'::timestamptz
  );
  if (v_result ->> 'globalAvailable') is distinct from 'false' then
    raise exception 'p_global_limit=0 should report globalAvailable false without raise: %', v_result;
  end if;
end
$body$;

select pass('authenticated cannot read/write user_feedback; rate limit 5/24h; window reset; global limit env-only');

select * from finish();
rollback;
