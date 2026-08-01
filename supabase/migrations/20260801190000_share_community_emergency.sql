-- Task 3: 匿名緊急共有 — consent / jobs / pool / origins / 日次台帳 / public SECURITY DEFINER RPC
-- 不変条件: private 表に service_role / authenticated の TABLE GRANT を付けない。
-- jobs / origins の寄稿者列は contributor_user_id（user_id 禁止。account-deletion CASCADE ガード回避）。
-- 定数は shared/contracts/share-*.ts と同期（lottery 20% / attempt 2 / success 1 / app 200·500 / lease 15 / running 4·1）。

-- ---------------------------------------------------------------------------
-- 0. 共有同意（public・RPC 専用。TABLE GRANT は service_role ALL のみ）
-- ---------------------------------------------------------------------------
create table public.user_share_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  consent_version text not null
    check (char_length(btrim(consent_version)) between 1 and 50),
  accepted_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (revoked_at is null or revoked_at >= accepted_at)
);

create trigger user_share_consents_set_updated_at
before update on public.user_share_consents
for each row execute function private.set_updated_at();

alter table public.user_share_consents enable row level security;

-- Data API 直触り禁止（browser は definer RPC のみ）。user_feedback と同型の明示 deny。
create policy user_share_consents_deny_all
  on public.user_share_consents
  for all
  to authenticated, anon
  using (false)
  with check (false);

revoke all on table public.user_share_consents from public, anon, authenticated;
grant all on table public.user_share_consents to service_role;

-- ---------------------------------------------------------------------------
-- 1. private jobs / pool / origins / 日次台帳
-- ---------------------------------------------------------------------------

create table private.share_generalization_jobs (
  id uuid primary key default gen_random_uuid(),
  -- unique により同一 source_menu の再 enqueue 不可（terminal 後も v1 はリトライなし）
  source_menu_id uuid null unique references public.menus (id) on delete set null,
  contributor_user_id uuid null references auth.users (id) on delete set null,
  status text not null
    check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  skip_reason text null
    check (
      skip_reason is null
      or skip_reason in (
        'not_emergency_duration',
        'pantry_bound',
        'consent_revoked',
        'ineligible_structure'
      )
    ),
  failure_code text null
    check (
      failure_code is null
      or failure_code in (
        'lease_expired',
        'server_gate_failed',
        'openrouter_failed'
      )
    ),
  pass1_model text null,
  pass2_model text null,
  claimed_at timestamptz null,
  heartbeat_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz null,
  check (
    (status = 'skipped') = (skip_reason is not null)
  ),
  check (
    (status = 'failed') = (failure_code is not null)
  ),
  check (
    status not in ('succeeded', 'failed', 'skipped') or finished_at is not null
  ),
  check (
    status <> 'running' or (claimed_at is not null and heartbeat_at is not null)
  )
);

create index share_generalization_jobs_pending_created_idx
  on private.share_generalization_jobs (created_at)
  where status = 'pending';

create index share_generalization_jobs_running_heartbeat_idx
  on private.share_generalization_jobs (heartbeat_at)
  where status = 'running';

create index share_generalization_jobs_contributor_status_idx
  on private.share_generalization_jobs (contributor_user_id, status)
  where contributor_user_id is not null;

create table private.shared_emergency_recipes (
  id uuid primary key default gen_random_uuid(),
  menu_payload jsonb not null
    check (jsonb_typeof(menu_payload) = 'object'),
  meal_type text not null
    check (meal_type in ('breakfast', 'lunch', 'dinner')),
  total_elapsed_minutes smallint not null
    check (total_elapsed_minutes between 1 and 15),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  standard_allergen_ids text[] not null default '{}',
  eligible_age_bands text[] not null
    check (cardinality(eligible_age_bands) >= 1),
  created_at timestamptz not null default clock_timestamp()
);

create index shared_emergency_recipes_active_meal_idx
  on private.shared_emergency_recipes (meal_type, created_at)
  where status = 'active';

create table private.shared_emergency_recipe_origins (
  recipe_id uuid primary key
    references private.shared_emergency_recipes (id) on delete cascade,
  contributor_user_id uuid null references auth.users (id) on delete set null,
  source_menu_id uuid null references public.menus (id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);

create index shared_emergency_recipe_origins_contributor_idx
  on private.shared_emergency_recipe_origins (contributor_user_id, created_at desc)
  where contributor_user_id is not null;

-- ユーザー日次: attempt 予約数・掲載 success 数（通常 generate 台帳と独立）
create table private.share_user_daily_usage (
  contributor_user_id uuid not null references auth.users (id) on delete cascade,
  usage_day date not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (contributor_user_id, usage_day),
  -- perUserDailyAttemptCap=2 / perUserDailySuccessCap=1
  check (attempt_count <= 2),
  check (success_count <= 1)
);

-- アプリ日次: 掲載 success・AI Pass 呼び出し回数
create table private.share_app_daily_usage (
  usage_day date primary key,
  success_count integer not null default 0 check (success_count >= 0),
  ai_call_count integer not null default 0 check (ai_call_count >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  -- appDailyAiSuccessCap=200 / appDailyAiCallCap=500
  check (success_count <= 200),
  check (ai_call_count <= 500)
);

revoke all on table private.share_generalization_jobs
  from public, anon, authenticated, service_role;
revoke all on table private.shared_emergency_recipes
  from public, anon, authenticated, service_role;
revoke all on table private.shared_emergency_recipe_origins
  from public, anon, authenticated, service_role;
revoke all on table private.share_user_daily_usage
  from public, anon, authenticated, service_role;
revoke all on table private.share_app_daily_usage
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Private helpers
-- ---------------------------------------------------------------------------

-- 現行共有同意版（TS shareConsentVersion と一致。旧版は未同意）
create or replace function private.share_current_consent_version()
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  select '2026-08-01.v1'::text;
$function$;

revoke all on function private.share_current_consent_version()
  from public, anon, authenticated, service_role;

create or replace function private.share_consent_is_valid(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.user_share_consents c
    where c.user_id = p_user_id
      and c.consent_version = private.share_current_consent_version()
      and c.revoked_at is null
  );
$function$;

revoke all on function private.share_consent_is_valid(uuid)
  from public, anon, authenticated, service_role;

-- 管理一覧用タイトル: main 優先、無ければ position 順で dish name を '・' 連結
create or replace function private.share_recipe_title_from_payload(p_payload jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_main text;
  v_joined text;
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    return '共有レシピ';
  end if;

  select d ->> 'name'
  into v_main
  from jsonb_array_elements(coalesce(p_payload -> 'dishes', '[]'::jsonb)) as d
  where d ->> 'role' = 'main'
    and nullif(btrim(coalesce(d ->> 'name', '')), '') is not null
  order by coalesce((d ->> 'position')::integer, 0)
  limit 1;

  if v_main is not null then
    return left(v_main, 80);
  end if;

  select string_agg(name, '・' order by pos)
  into v_joined
  from (
    select
      nullif(btrim(coalesce(d ->> 'name', '')), '') as name,
      coalesce((d ->> 'position')::integer, 0) as pos
    from jsonb_array_elements(coalesce(p_payload -> 'dishes', '[]'::jsonb)) as d
  ) dishes
  where name is not null;

  if v_joined is null or length(v_joined) = 0 then
    return '共有レシピ';
  end if;
  return left(v_joined, 80);
end;
$function$;

revoke all on function private.share_recipe_title_from_payload(jsonb)
  from public, anon, authenticated, service_role;

-- AI Pass 呼び出し回数をアプリ日次台帳へ加算（1 回の finish/publish あたり最大 2）
create or replace function private.share_increment_ai_calls(
  p_usage_day date,
  p_ai_call_count integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_current integer;
begin
  if p_ai_call_count is null or p_ai_call_count <= 0 then
    return;
  end if;
  if p_ai_call_count > 2 then
    raise exception using errcode = '22023', message = 'invalid_share_ai_call_count';
  end if;

  insert into private.share_app_daily_usage (usage_day, success_count, ai_call_count, updated_at)
  values (p_usage_day, 0, 0, clock_timestamp())
  on conflict (usage_day) do nothing;

  select ai_call_count into v_current
  from private.share_app_daily_usage
  where usage_day = p_usage_day
  for update;

  if v_current + p_ai_call_count > 500 then
    -- cap 超過分は計上しない（job 終端自体は続行）
    return;
  end if;

  update private.share_app_daily_usage
  set ai_call_count = ai_call_count + p_ai_call_count,
      updated_at = clock_timestamp()
  where usage_day = p_usage_day;
end;
$function$;

revoke all on function private.share_increment_ai_calls(date, integer)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Public RPCs — consent（authenticated）
-- ---------------------------------------------------------------------------

create or replace function public.upsert_my_share_consent(
  p_version text,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_row public.user_share_consents%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_accept is null or p_version is null or length(btrim(p_version)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_share_consent_args';
  end if;

  if p_accept then
    if btrim(p_version) is distinct from private.share_current_consent_version() then
      raise exception using errcode = '22023', message = 'stale_share_consent_version';
    end if;

    insert into public.user_share_consents (
      user_id, consent_version, accepted_at, revoked_at, created_at, updated_at
    ) values (
      v_uid, btrim(p_version), v_now, null, v_now, v_now
    )
    on conflict (user_id) do update
      set consent_version = excluded.consent_version,
          accepted_at = excluded.accepted_at,
          revoked_at = null,
          updated_at = excluded.updated_at
    returning * into v_row;
  else
    -- revoke: 行が無ければ「現行版で accept 済み→即 revoke」相当を作らず no-op 的に空応答
    update public.user_share_consents
    set revoked_at = coalesce(revoked_at, v_now),
        updated_at = v_now
    where user_id = v_uid
      and revoked_at is null
    returning * into v_row;

    if not found then
      select * into v_row from public.user_share_consents where user_id = v_uid;
      if not found then
        return jsonb_build_object(
          'ok', true,
          'consent_version', null,
          'accepted_at', null,
          'revoked_at', null
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'consent_version', v_row.consent_version,
    'accepted_at', v_row.accepted_at,
    'revoked_at', v_row.revoked_at
  );
end;
$function$;

create or replace function public.get_my_share_consent()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.user_share_consents%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_row from public.user_share_consents where user_id = v_uid;
  if not found then
    return jsonb_build_object(
      'consent_version', null,
      'accepted_at', null,
      'revoked_at', null
    );
  end if;

  return jsonb_build_object(
    'consent_version', v_row.consent_version,
    'accepted_at', v_row.accepted_at,
    'revoked_at', v_row.revoked_at
  );
end;
$function$;

revoke all on function public.upsert_my_share_consent(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_share_consent()
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_my_share_consent(text, boolean) to authenticated;
grant execute on function public.get_my_share_consent() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. try_enqueue_share_job（service_role）
-- ---------------------------------------------------------------------------

create or replace function public.try_enqueue_share_job(p_menu_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_menu public.menus%rowtype;
  v_contributor uuid;
  v_day date;
  v_user_attempt integer := 0;
  v_user_success integer := 0;
  v_app_success integer := 0;
  v_app_ai integer := 0;
  v_job_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_menu_id is null then
    raise exception using errcode = '22023', message = 'invalid_menu_id';
  end if;

  select * into v_menu from public.menus where id = p_menu_id;
  if not found then
    return jsonb_build_object('enqueued', false, 'reason', 'menu_not_found');
  end if;

  v_contributor := v_menu.user_id;
  v_day := private.ai_jst_day(v_now);

  -- 同意（現行版・未 revoke）
  if not private.share_consent_is_valid(v_contributor) then
    return jsonb_build_object('enqueued', false, 'reason', 'no_consent');
  end if;

  -- ユーザー日次 cap（行ロックで競合シリアライズ）
  insert into private.share_user_daily_usage (
    contributor_user_id, usage_day, attempt_count, success_count, updated_at
  ) values (v_contributor, v_day, 0, 0, v_now)
  on conflict (contributor_user_id, usage_day) do nothing;

  select attempt_count, success_count
  into v_user_attempt, v_user_success
  from private.share_user_daily_usage
  where contributor_user_id = v_contributor and usage_day = v_day
  for update;

  if v_user_attempt >= 2 or v_user_success >= 1 then
    return jsonb_build_object('enqueued', false, 'reason', 'user_cap');
  end if;

  -- アプリ日次 cap
  insert into private.share_app_daily_usage (usage_day, success_count, ai_call_count, updated_at)
  values (v_day, 0, 0, v_now)
  on conflict (usage_day) do nothing;

  select success_count, ai_call_count
  into v_app_success, v_app_ai
  from private.share_app_daily_usage
  where usage_day = v_day
  for update;

  if v_app_success >= 200 or v_app_ai >= 500 then
    return jsonb_build_object('enqueued', false, 'reason', 'app_cap');
  end if;

  -- 抽選 20%（外れは attempt 不消費）
  if (random() * 100.0) >= 20.0 then
    return jsonb_build_object('enqueued', false, 'reason', 'lottery');
  end if;

  -- unique job insert → 成功後に attempt++
  begin
    insert into private.share_generalization_jobs (
      source_menu_id,
      contributor_user_id,
      status,
      created_at
    ) values (
      p_menu_id,
      v_contributor,
      'pending',
      v_now
    )
    returning id into v_job_id;
  exception
    when unique_violation then
      return jsonb_build_object('enqueued', false, 'reason', 'duplicate');
  end;

  update private.share_user_daily_usage
  set attempt_count = attempt_count + 1,
      updated_at = v_now
  where contributor_user_id = v_contributor and usage_day = v_day;

  return jsonb_build_object(
    'enqueued', true,
    'job_id', v_job_id,
    'contributor_user_id', v_contributor
  );
end;
$function$;

revoke all on function public.try_enqueue_share_job(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.try_enqueue_share_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. claim / heartbeat / finish
-- ---------------------------------------------------------------------------

create or replace function public.claim_share_generalization_jobs(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_limit integer;
  v_global_running integer;
  v_claimed jsonb := '[]'::jsonb;
  v_row private.share_generalization_jobs%rowtype;
  v_user_running integer;
  v_now timestamptz := clock_timestamp();
  -- shareQuota.maxGlobalRunning / maxPerUserRunning
  v_max_global constant integer := 4;
  v_max_per_user constant integer := 1;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'invalid_claim_limit';
  end if;
  v_limit := p_limit;

  select count(*)::integer into v_global_running
  from private.share_generalization_jobs
  where status = 'running';

  if v_global_running >= v_max_global then
    return jsonb_build_object('jobs', v_claimed);
  end if;

  for v_row in
    select *
    from private.share_generalization_jobs
    where status = 'pending'
    order by created_at asc
    for update skip locked
  loop
    exit when jsonb_array_length(v_claimed) >= v_limit;
    exit when v_global_running >= v_max_global;

    if v_row.contributor_user_id is not null then
      select count(*)::integer into v_user_running
      from private.share_generalization_jobs
      where status = 'running'
        and contributor_user_id = v_row.contributor_user_id;

      if v_user_running >= v_max_per_user then
        continue;
      end if;
    end if;

    update private.share_generalization_jobs
    set status = 'running',
        claimed_at = v_now,
        heartbeat_at = v_now
    where id = v_row.id
      and status = 'pending'
    returning * into v_row;

    if not found then
      continue;
    end if;

    v_global_running := v_global_running + 1;
    v_claimed := v_claimed || jsonb_build_array(
      jsonb_build_object(
        'id', v_row.id,
        'source_menu_id', v_row.source_menu_id,
        'contributor_user_id', v_row.contributor_user_id,
        'status', v_row.status,
        'claimed_at', v_row.claimed_at,
        'heartbeat_at', v_row.heartbeat_at,
        'created_at', v_row.created_at
      )
    );
  end loop;

  return jsonb_build_object('jobs', v_claimed);
end;
$function$;

create or replace function public.heartbeat_share_generalization_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_row private.share_generalization_jobs%rowtype;
begin
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'invalid_job_id';
  end if;

  update private.share_generalization_jobs
  set heartbeat_at = v_now
  where id = p_job_id
    and status = 'running'
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_running');
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', v_row.id,
    'heartbeat_at', v_row.heartbeat_at
  );
end;
$function$;

create or replace function public.finish_share_generalization_job(
  p_job_id uuid,
  p_status text,
  p_code text default null,
  p_ai_call_count integer default 0,
  p_pass1_model text default null,
  p_pass2_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_row private.share_generalization_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_day date;
begin
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'invalid_job_id';
  end if;
  if p_status is null or p_status not in ('failed', 'skipped') then
    raise exception using errcode = '22023', message = 'invalid_finish_status';
  end if;
  if p_status = 'failed' and (
    p_code is null
    or p_code not in ('lease_expired', 'server_gate_failed', 'openrouter_failed')
  ) then
    raise exception using errcode = '22023', message = 'invalid_failure_code';
  end if;
  if p_status = 'skipped' and (
    p_code is null
    or p_code not in (
      'not_emergency_duration',
      'pantry_bound',
      'consent_revoked',
      'ineligible_structure'
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_skip_reason';
  end if;
  if p_ai_call_count is null or p_ai_call_count < 0 or p_ai_call_count > 2 then
    raise exception using errcode = '22023', message = 'invalid_share_ai_call_count';
  end if;

  select * into v_row
  from private.share_generalization_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_row.status is distinct from 'running' then
    return jsonb_build_object('ok', false, 'reason', 'not_running', 'status', v_row.status);
  end if;

  update private.share_generalization_jobs
  set status = p_status,
      skip_reason = case when p_status = 'skipped' then p_code else null end,
      failure_code = case when p_status = 'failed' then p_code else null end,
      pass1_model = coalesce(p_pass1_model, pass1_model),
      pass2_model = coalesce(p_pass2_model, pass2_model),
      finished_at = v_now
  where id = p_job_id
  returning * into v_row;

  v_day := private.ai_jst_day(v_now);
  perform private.share_increment_ai_calls(v_day, p_ai_call_count);

  return jsonb_build_object(
    'ok', true,
    'job_id', v_row.id,
    'status', v_row.status,
    'code', p_code
  );
end;
$function$;

revoke all on function public.claim_share_generalization_jobs(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.heartbeat_share_generalization_job(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_share_generalization_job(uuid, text, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_share_generalization_jobs(integer) to service_role;
grant execute on function public.heartbeat_share_generalization_job(uuid) to service_role;
grant execute on function public.finish_share_generalization_job(uuid, text, text, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. publish（同一 TX で consent 再確認 + pool + origin + success 台帳）
-- ---------------------------------------------------------------------------

create or replace function public.publish_shared_emergency_recipe(
  p_job_id uuid,
  p_payload jsonb,
  p_meal_type text,
  p_total_elapsed integer,
  p_standard_allergen_ids text[],
  p_eligible_age_bands text[],
  p_ai_call_count integer default 0,
  p_pass1_model text default null,
  p_pass2_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_job private.share_generalization_jobs%rowtype;
  v_recipe_id uuid;
  v_now timestamptz := clock_timestamp();
  v_day date;
  v_contributor uuid;
begin
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'invalid_job_id';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid_share_payload';
  end if;
  if p_meal_type is null or p_meal_type not in ('breakfast', 'lunch', 'dinner') then
    raise exception using errcode = '22023', message = 'invalid_meal_type';
  end if;
  if p_total_elapsed is null or p_total_elapsed < 1 or p_total_elapsed > 15 then
    raise exception using errcode = '22023', message = 'invalid_total_elapsed';
  end if;
  if p_standard_allergen_ids is null then
    raise exception using errcode = '22023', message = 'invalid_standard_allergen_ids';
  end if;
  if p_eligible_age_bands is null or cardinality(p_eligible_age_bands) < 1 then
    raise exception using errcode = '22023', message = 'invalid_eligible_age_bands';
  end if;
  if p_ai_call_count is null or p_ai_call_count < 0 or p_ai_call_count > 2 then
    raise exception using errcode = '22023', message = 'invalid_share_ai_call_count';
  end if;

  select * into v_job
  from private.share_generalization_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_job.status is distinct from 'running' then
    return jsonb_build_object('ok', false, 'reason', 'not_running', 'status', v_job.status);
  end if;

  v_contributor := v_job.contributor_user_id;
  v_day := private.ai_jst_day(v_now);

  -- TOCTOU: INSERT 直前に consent 再確認
  if v_contributor is null or not private.share_consent_is_valid(v_contributor) then
    update private.share_generalization_jobs
    set status = 'skipped',
        skip_reason = 'consent_revoked',
        failure_code = null,
        pass1_model = coalesce(p_pass1_model, pass1_model),
        pass2_model = coalesce(p_pass2_model, pass2_model),
        finished_at = v_now
    where id = p_job_id;

    perform private.share_increment_ai_calls(v_day, p_ai_call_count);

    return jsonb_build_object(
      'ok', true,
      'published', false,
      'reason', 'consent_revoked',
      'job_id', p_job_id
    );
  end if;

  insert into private.shared_emergency_recipes (
    menu_payload,
    meal_type,
    total_elapsed_minutes,
    status,
    standard_allergen_ids,
    eligible_age_bands,
    created_at
  ) values (
    p_payload,
    p_meal_type,
    p_total_elapsed::smallint,
    'active',
    p_standard_allergen_ids,
    p_eligible_age_bands,
    v_now
  )
  returning id into v_recipe_id;

  insert into private.shared_emergency_recipe_origins (
    recipe_id,
    contributor_user_id,
    source_menu_id,
    created_at
  ) values (
    v_recipe_id,
    v_contributor,
    v_job.source_menu_id,
    v_now
  );

  -- success 台帳（ユーザー + アプリ）
  insert into private.share_user_daily_usage (
    contributor_user_id, usage_day, attempt_count, success_count, updated_at
  ) values (v_contributor, v_day, 0, 1, v_now)
  on conflict (contributor_user_id, usage_day) do update
    set success_count = private.share_user_daily_usage.success_count + 1,
        updated_at = excluded.updated_at
  where private.share_user_daily_usage.success_count < 1;

  insert into private.share_app_daily_usage (
    usage_day, success_count, ai_call_count, updated_at
  ) values (v_day, 1, 0, v_now)
  on conflict (usage_day) do update
    set success_count = private.share_app_daily_usage.success_count + 1,
        updated_at = excluded.updated_at
  where private.share_app_daily_usage.success_count < 200;

  perform private.share_increment_ai_calls(v_day, p_ai_call_count);

  update private.share_generalization_jobs
  set status = 'succeeded',
      skip_reason = null,
      failure_code = null,
      pass1_model = coalesce(p_pass1_model, pass1_model),
      pass2_model = coalesce(p_pass2_model, pass2_model),
      finished_at = v_now
  where id = p_job_id;

  return jsonb_build_object(
    'ok', true,
    'published', true,
    'recipe_id', v_recipe_id,
    'job_id', p_job_id
  );
end;
$function$;

revoke all on function public.publish_shared_emergency_recipe(
  uuid, jsonb, text, integer, text[], text[], integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.publish_shared_emergency_recipe(
  uuid, jsonb, text, integer, text[], text[], integer, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. list_active / list_my
-- ---------------------------------------------------------------------------

create or replace function public.list_active_shared_emergency_recipes(
  p_meal_type text,
  p_limit integer,
  p_salt text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_limit integer;
  v_salt text;
begin
  if p_meal_type is null or p_meal_type not in ('breakfast', 'lunch', 'dinner') then
    raise exception using errcode = '22023', message = 'invalid_meal_type';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = '22023', message = 'invalid_share_pool_limit';
  end if;
  -- salt は順序攪拌用。空は拒否（newest 固定順へのフォールバックを避ける）
  if p_salt is null or length(p_salt) < 1 or length(p_salt) > 128 then
    raise exception using errcode = '22023', message = 'invalid_share_salt';
  end if;
  v_limit := p_limit;
  v_salt := p_salt;

  return coalesce(
    (
      select jsonb_agg(row_to_json(x)::jsonb)
      from (
        select
          r.id,
          r.menu_payload,
          r.meal_type,
          r.total_elapsed_minutes,
          r.standard_allergen_ids,
          r.eligible_age_bands,
          r.created_at
        from private.shared_emergency_recipes r
        where r.status = 'active'
          and r.meal_type = p_meal_type
        order by md5(v_salt || r.id::text)
        limit v_limit
      ) x
    ),
    '[]'::jsonb
  );
end;
$function$;

-- 返却は title + shared_on(date) のみ（source_menu_id / recipe_id は出さない）
create or replace function public.list_my_shared_emergency_recipes()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'title', x.title,
          'shared_on', x.shared_on
        )
        order by x.shared_on desc, x.sort_created desc
      )
      from (
        select
          private.share_recipe_title_from_payload(r.menu_payload) as title,
          (r.created_at at time zone 'Asia/Tokyo')::date as shared_on,
          r.created_at as sort_created
        from private.shared_emergency_recipe_origins o
        join private.shared_emergency_recipes r on r.id = o.recipe_id
        where o.contributor_user_id = v_uid
        order by r.created_at desc
        limit 100
      ) x
    ),
    '[]'::jsonb
  );
end;
$function$;

revoke all on function public.list_active_shared_emergency_recipes(text, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_shared_emergency_recipes()
  from public, anon, authenticated, service_role;
grant execute on function public.list_active_shared_emergency_recipes(text, integer, text)
  to service_role;
grant execute on function public.list_my_shared_emergency_recipes() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. reaper + maintenance 接続（件数キーは Task 7a で追加。戻り JSON 形状は維持）
-- ---------------------------------------------------------------------------

create or replace function public.reap_stale_share_jobs(
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_now timestamptz;
  v_limit integer;
  v_threshold timestamptz;
  v_count integer := 0;
begin
  v_now := coalesce(p_now, clock_timestamp());
  if p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_reap_limit';
  end if;
  v_limit := p_limit;
  -- jobLeaseMinutes = 15
  v_threshold := v_now - interval '15 minutes';

  with stale as (
    select id
    from private.share_generalization_jobs
    where status = 'running'
      and coalesce(heartbeat_at, claimed_at) < v_threshold
    order by coalesce(heartbeat_at, claimed_at) asc
    for update skip locked
    limit v_limit
  )
  update private.share_generalization_jobs j
  set status = 'failed',
      failure_code = 'lease_expired',
      skip_reason = null,
      finished_at = v_now
  from stale
  where j.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.reap_stale_share_jobs(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reap_stale_share_jobs(timestamptz, integer) to service_role;

-- run_kondate_maintenance: 既存 8 キーを維持しつつ reaper を副作用で実行
create or replace function public.run_kondate_maintenance(
  p_now timestamptz,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stale integer;
  v_ledgers integer;
  v_shopping integer;
  v_auth bigint;
  v_feedback integer;
  v_submissions integer;
  v_identity integer := 0;
  v_flyer integer := 0;
  v_chunk integer;
  v_before timestamptz;
  v_identity_cutoff date;
  v_quality_month_cutoff date;
  v_flyer_week_cutoff date;
  v_flyer_stale integer;
  v_share_reaped integer;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  v_before := p_now - interval '30 days';
  v_identity_cutoff := private.ai_jst_day(p_now) - 40;
  v_quality_month_cutoff := (
    date_trunc('month', private.ai_jst_day(p_now)::timestamp) - interval '1 month'
  )::date;
  v_flyer_week_cutoff := private.ai_jst_week_start(p_now) - 84;

  v_stale := public.cleanup_stale_ai_generations_batch(p_now, p_limit);
  v_flyer_stale := public.cleanup_stale_flyer_weekly_batch(p_now, p_limit);
  v_stale := v_stale + v_flyer_stale;
  -- 共有 job reaper（件数は Task 7a で JSON キー化。ここでは副作用のみ）
  v_share_reaped := public.reap_stale_share_jobs(p_now, p_limit);
  v_stale := v_stale + v_share_reaped;
  v_ledgers := public.cleanup_ai_generation_requests_batch(v_before, p_limit);
  v_shopping := private.cleanup_shopping_mutations(v_before, p_limit);
  v_auth := public.cleanup_auth_continuations_batch(p_now, p_limit);
  v_feedback := private.cleanup_user_feedback(v_before, p_limit);
  v_submissions := private.cleanup_generation_draft_submission_versions(v_before, p_limit);

  delete from private.ai_identity_daily_usage
  where ctid in (
    select ctid from private.ai_identity_daily_usage
    where usage_day < v_identity_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_daily_external_attempts
  where ctid in (
    select ctid from private.ai_identity_daily_external_attempts
    where usage_day < v_identity_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_quality_daily
  where ctid in (
    select ctid from private.ai_identity_quality_daily
    where usage_day < v_identity_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_quality_monthly
  where ctid in (
    select ctid from private.ai_identity_quality_monthly
    where usage_month < v_quality_month_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_flyer_weekly
  where ctid in (
    select ctid from private.ai_identity_flyer_weekly
    where week_start < v_flyer_week_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_flyer := v_flyer + v_chunk;

  delete from private.ai_identity_flyer_weekly_tries
  where ctid in (
    select ctid from private.ai_identity_flyer_weekly_tries
    where week_start < v_flyer_week_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_flyer := v_flyer + v_chunk;

  delete from private.flyer_weekly_requests
  where ctid in (
    select ctid from private.flyer_weekly_requests
    where status <> 'processing'
      and completed_at is not null
      and completed_at < v_before
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_flyer := v_flyer + v_chunk;

  return jsonb_build_object(
    'staleReservationsFinalized', v_stale,
    'generationLedgersDeleted', v_ledgers,
    'shoppingMutationsDeleted', v_shopping,
    'authContinuationsDeleted', v_auth,
    'userFeedbackDeleted', v_feedback,
    'draftSubmissionsDeleted', v_submissions,
    'identityLedgersDeleted', v_identity,
    'flyerLedgersDeleted', v_flyer
  );
end;
$function$;

revoke all on function public.run_kondate_maintenance(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_kondate_maintenance(timestamptz, integer)
  to kondate_maintenance_executor;
