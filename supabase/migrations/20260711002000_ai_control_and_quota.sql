create table private.generation_draft_submission_versions (
  draft_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_revision bigint not null check (draft_revision > 0),
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner')),
  main_ingredients text[] not null,
  cuisine_genre text not null check (cuisine_genre in ('japanese','western','chinese','any')),
  target_member_ids uuid[] not null,
  time_limit_minutes smallint not null check (time_limit_minutes in (15,30,45)),
  budget_preference text not null check (budget_preference in ('economy','standard')),
  avoid_ingredients text[] not null,
  memo text not null check (char_length(memo) <= 200),
  pantry_selections jsonb not null check (jsonb_typeof(pantry_selections) = 'array'),
  captured_at timestamptz not null default now(),
  primary key (draft_id,user_id,draft_revision),
  check (cardinality(main_ingredients) between 1 and 8),
  check (cardinality(target_member_ids) between 1 and 20),
  check (cardinality(avoid_ingredients) <= 20),
  check (jsonb_array_length(pantry_selections) <= 50),
  check (pg_column_size(pantry_selections) <= 32768)
);

create table private.ai_generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_kind text not null check (request_kind in ('new_menu', 'regenerate_menu', 'regenerate_dish')),
  status text not null check (status in ('processing', 'succeeded', 'failed', 'constraint_conflict')),
  draft_id uuid,
  draft_revision bigint,
  source_menu_id uuid references public.menus(id) on delete set null,
  completed_menu_id uuid references public.menus(id) on delete set null,
  user_usage_day date not null,
  user_quota_reserved boolean not null default false,
  global_reserved_day date,
  global_sent_calls smallint not null default 0 check (global_sent_calls between 0 and 2),
  repair_attempted boolean not null default false,
  actual_model_ids text[] not null default '{}',
  failure_code text,
  terminal_details jsonb,
  retry_at timestamptz,
  processing_expires_at timestamptz,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (draft_id,user_id,draft_revision)
    references private.generation_draft_submission_versions(draft_id,user_id,draft_revision),
  check ((request_kind = 'new_menu') = (draft_id is not null and draft_revision is not null)),
  check (terminal_details is null or jsonb_typeof(terminal_details) = 'object')
);

create unique index ai_generation_requests_one_processing_per_user
  on private.ai_generation_requests(user_id) where status = 'processing';
create index ai_generation_requests_stale
  on private.ai_generation_requests(processing_expires_at) where status = 'processing';

create table private.ai_user_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_day),
  check (reserved_count + success_count <= 5)
);

create table private.ai_global_daily_usage (
  usage_day date primary key,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on private.ai_generation_requests from public, anon, authenticated;
revoke all on private.generation_draft_submission_versions from public, anon, authenticated;
revoke all on private.ai_user_daily_usage from public, anon, authenticated;
revoke all on private.ai_global_daily_usage from public, anon, authenticated;

create or replace function private.ai_jst_day(p_now timestamptz)
returns date language sql immutable parallel safe
set search_path = pg_catalog
as $$ select (p_now at time zone 'Asia/Tokyo')::date $$;

create or replace function private.ai_next_jst_midnight(p_now timestamptz)
returns timestamptz language sql stable parallel safe
set search_path = pg_catalog
as $$
  select make_timestamptz(
    extract(year from ((p_now at time zone 'Asia/Tokyo')::date + 1))::integer,
    extract(month from ((p_now at time zone 'Asia/Tokyo')::date + 1))::integer,
    extract(day from ((p_now at time zone 'Asia/Tokyo')::date + 1))::integer,
    0, 0, 0, 'Asia/Tokyo'
  )
$$;

create or replace function private.ai_request_payload(
  p_request private.ai_generation_requests,
  p_replayed boolean default false
) returns jsonb language sql stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'request_id', p_request.id,
    'idempotency_key', p_request.idempotency_key,
    'status', p_request.status,
    'failure_code', p_request.failure_code,
    'retry_at', p_request.retry_at,
    'processing_expires_at', p_request.processing_expires_at,
    'completed_menu_id', p_request.completed_menu_id,
    'replayed', p_replayed
  )
$$;

create or replace function public.cleanup_stale_ai_generations(
  p_now timestamptz default clock_timestamp()
) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_request private.ai_generation_requests; v_count integer := 0;
begin
  for v_request in
    select * from private.ai_generation_requests
    where status = 'processing' and processing_expires_at <= p_now
    for update skip locked
  loop
    if v_request.user_quota_reserved then
      update private.ai_user_daily_usage
      set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where user_id = v_request.user_id and usage_day = v_request.user_usage_day;
    end if;
    if v_request.global_reserved_day is not null then
      update private.ai_global_daily_usage
      set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where usage_day = v_request.global_reserved_day;
    end if;
    update private.ai_generation_requests set
      status = 'failed', failure_code = 'generation_timeout',
      user_quota_reserved = false, global_reserved_day = null,
      retry_at = p_now, completed_at = p_now, updated_at = p_now,
      duration_ms = greatest(0, floor(extract(epoch from (p_now - started_at)) * 1000)::integer)
    where id = v_request.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.reserve_ai_generation(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_request_kind text,
  p_draft_id uuid,
  p_user_limit integer,
  p_global_limit integer,
  p_stale_after_seconds integer default 180,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_day date := private.ai_jst_day(p_now);
  v_request private.ai_generation_requests;
  v_active private.ai_generation_requests;
  v_user private.ai_user_daily_usage;
  v_global private.ai_global_daily_usage;
begin
  if p_user_limit <> 5 then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  if p_global_limit < 1 or p_stale_after_seconds < 30 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  if p_request_kind not in ('new_menu', 'regenerate_menu', 'regenerate_dish') then
    raise exception using errcode = '22023', message = 'invalid_request_kind';
  end if;

  perform public.cleanup_stale_ai_generations(p_now);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_request from private.ai_generation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then return private.ai_request_payload(v_request, true); end if;

  select * into v_active from private.ai_generation_requests
  where user_id = p_user_id and status = 'processing';
  if found then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, user_usage_day,
      failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id, v_day,
      'generation_in_progress', v_active.processing_expires_at, p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  insert into private.ai_user_daily_usage(user_id, usage_day)
  values (p_user_id, v_day) on conflict do nothing;
  insert into private.ai_global_daily_usage(usage_day)
  values (v_day) on conflict do nothing;
  select * into v_user from private.ai_user_daily_usage
    where user_id = p_user_id and usage_day = v_day for update;
  select * into v_global from private.ai_global_daily_usage
    where usage_day = v_day for update;

  if v_user.success_count + v_user.reserved_count >= p_user_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, user_usage_day,
      failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id, v_day,
      'user_daily_limit', private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if v_global.sent_count + v_global.reserved_count >= p_global_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, user_usage_day,
      failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id, v_day,
      'global_daily_limit', private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  update private.ai_user_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
  where user_id = p_user_id and usage_day = v_day;
  update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
  where usage_day = v_day;
  insert into private.ai_generation_requests(
    user_id, idempotency_key, request_kind, status, draft_id, user_usage_day,
    user_quota_reserved, global_reserved_day, processing_expires_at, started_at
  ) values (
    p_user_id, p_idempotency_key, p_request_kind, 'processing', p_draft_id, v_day,
    true, v_day, p_now + make_interval(secs => p_stale_after_seconds), p_now
  ) returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$$;

create or replace function public.mark_ai_global_sent(
  p_request_id uuid, p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_request private.ai_generation_requests;
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing' or v_request.global_reserved_day is null then
    raise exception using errcode = '55000', message = 'global_call_not_reserved';
  end if;
  update private.ai_global_daily_usage
  set reserved_count = reserved_count - 1, sent_count = sent_count + 1, updated_at = p_now
  where usage_day = v_request.global_reserved_day and reserved_count > 0;
  if not found then raise exception using errcode = '23514', message = 'global_reservation_corrupt'; end if;
  update private.ai_generation_requests
  set global_reserved_day = null, global_sent_calls = global_sent_calls + 1, updated_at = p_now
  where id = p_request_id returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$$;

create or replace function public.reserve_ai_repair_call(
  p_request_id uuid, p_global_limit integer,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_request private.ai_generation_requests; v_usage private.ai_global_daily_usage;
  v_day date := private.ai_jst_day(p_now);
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing' or v_request.repair_attempted
     or v_request.global_reserved_day is not null then
    raise exception using errcode = '55000', message = 'repair_not_available';
  end if;
  insert into private.ai_global_daily_usage(usage_day) values (v_day) on conflict do nothing;
  select * into v_usage from private.ai_global_daily_usage where usage_day = v_day for update;
  update private.ai_generation_requests set repair_attempted = true, updated_at = p_now
    where id = p_request_id;
  if v_usage.sent_count + v_usage.reserved_count >= p_global_limit then
    return jsonb_build_object('reserved', false, 'retry_at', private.ai_next_jst_midnight(p_now));
  end if;
  update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
    where usage_day = v_day;
  update private.ai_generation_requests set global_reserved_day = v_day, updated_at = p_now
    where id = p_request_id;
  return jsonb_build_object('reserved', true, 'retry_at', null);
end;
$$;

create or replace function public.record_ai_generation_model(
  p_request_id uuid, p_model_id text, p_now timestamptz default clock_timestamp()
) returns void language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if p_model_id is null or length(p_model_id) > 200 then
    raise exception using errcode = '22023', message = 'invalid_model_id';
  end if;
  update private.ai_generation_requests
  set actual_model_ids = array_append(actual_model_ids, p_model_id), updated_at = p_now
  where id = p_request_id and status = 'processing';
  if not found then raise exception using errcode = '55000', message = 'request_not_processing'; end if;
end;
$$;

create or replace function public.finalize_ai_generation_failure(
  p_request_id uuid, p_failure_code text, p_retry_at timestamptz default null,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_request private.ai_generation_requests;
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'request_not_found'; end if;
  if v_request.status <> 'processing' then return private.ai_request_payload(v_request, true); end if;
  if v_request.user_quota_reserved then
    update private.ai_user_daily_usage set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where user_id = v_request.user_id and usage_day = v_request.user_usage_day;
  end if;
  if v_request.global_reserved_day is not null then
    update private.ai_global_daily_usage set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where usage_day = v_request.global_reserved_day;
  end if;
  update private.ai_generation_requests set
    status = 'failed', failure_code = p_failure_code, retry_at = p_retry_at,
    user_quota_reserved = false, global_reserved_day = null,
    completed_at = p_now, updated_at = p_now,
    duration_ms = greatest(0, floor(extract(epoch from (p_now - started_at)) * 1000)::integer)
  where id = p_request_id returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$$;

create or replace function public.finalize_ai_generation_conflict(
  p_request_id uuid, p_conflicts jsonb,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_payload jsonb;
begin
  if jsonb_typeof(p_conflicts) <> 'array' or jsonb_array_length(p_conflicts) = 0 then
    raise exception using errcode = '22023', message = 'invalid_conflicts';
  end if;
  v_payload := public.finalize_ai_generation_failure(p_request_id, 'constraint_conflict', null, p_now);
  update private.ai_generation_requests
  set status = 'constraint_conflict', failure_code = null,
      terminal_details = jsonb_build_object('conflicts', p_conflicts)
  where id = p_request_id;
  select private.ai_request_payload(r, false) into v_payload
    from private.ai_generation_requests r where id = p_request_id;
  return v_payload;
end;
$$;

revoke all on function public.cleanup_stale_ai_generations(timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_ai_generation(uuid, uuid, text, uuid, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_ai_repair_call(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_ai_global_sent(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_ai_generation_model(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_ai_generation_failure(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_ai_generation_conflict(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_stale_ai_generations(timestamptz) to service_role;
grant execute on function public.reserve_ai_generation(uuid, uuid, text, uuid, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.reserve_ai_repair_call(uuid, integer, timestamptz) to service_role;
grant execute on function public.mark_ai_global_sent(uuid, timestamptz) to service_role;
grant execute on function public.record_ai_generation_model(uuid, text, timestamptz) to service_role;
grant execute on function public.finalize_ai_generation_failure(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.finalize_ai_generation_conflict(uuid, jsonb, timestamptz) to service_role;
