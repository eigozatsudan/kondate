create schema if not exists tests;

create or replace function tests.create_supabase_user(
  p_user_id uuid,
  p_email text default 'test@example.invalid'
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    p_user_id,
    'authenticated',
    'authenticated',
    p_email,
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do nothing;
$function$;

create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
end;
$function$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = ''
as $function$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end;
$function$;

-- テスト用: user uuid から決定的な identity_key（64 hex）を作る
create or replace function tests.quota_identity_key(p_user_id uuid)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  select lpad(replace(p_user_id::text, '-', ''), 64, '0');
$function$;

-- ローカル永続 DB / 先行 E2E が当日の ai_global_daily_usage.sent_count を
-- 製品 GLOBAL_DAILY_AI_LIMIT（20）超まで積むと、now() 向け reserve が
-- global_daily_limit で静かに失敗する。GHA は空 DB だがローカル CI は
-- スタックを落とさない。呼び出し側 TX 内で実行し rollback する前提。
create or replace function tests.isolate_local_ai_global_usage(
  p_now timestamptz default now()
)
returns void
language sql
set search_path = ''
as $function$
  update private.ai_global_daily_usage
  set reserved_count = 0,
      sent_count = 0
  where usage_day = private.ai_jst_day(p_now);
$function$;
