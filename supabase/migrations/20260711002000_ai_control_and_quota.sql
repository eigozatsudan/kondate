-- 衝突コードの閉じた集合。1〜12 件かつ重複なし（台帳制約と conflict RPC の共通判定）
create or replace function private.ai_conflict_codes_valid(p_codes text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select
    p_codes is not null
    and cardinality(p_codes) between 1 and 12
    and cardinality(p_codes) = (
      select count(distinct code) from unnest(p_codes) as codes(code)
    )
    and not exists (
      select 1
      from unnest(p_codes) as codes(code)
      where code is null
         or code not in (
           'must_use_conflict',
           'allergen_pantry_conflict',
           'dish_count_conflict',
           'mandatory_safety_conflict',
           'current_safety_changed'
         )
    )
$$;

-- non-conflict 行は terminal_details null、conflict 行は {conflictCodes:[...]} のみ
create or replace function private.ai_generation_terminal_details_valid(
  p_status text,
  p_terminal_details jsonb
) returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_status is distinct from 'constraint_conflict' then
      p_terminal_details is null
    when p_terminal_details is null
      or jsonb_typeof(p_terminal_details) is distinct from 'object'
      or (
        select count(*)::integer
        from jsonb_object_keys(p_terminal_details) as keys(key)
      ) <> 1
      or not (p_terminal_details ? 'conflictCodes')
      or jsonb_typeof(p_terminal_details->'conflictCodes') is distinct from 'array'
    then false
    else private.ai_conflict_codes_valid(
      array(
        select jsonb_array_elements_text(p_terminal_details->'conflictCodes')
      )
    )
  end
$$;

create table private.generation_draft_submission_versions (
  draft_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_revision bigint not null check (draft_revision > 0),
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner')),
  main_ingredients text[] not null,
  cuisine_genre text not null check (cuisine_genre in ('japanese','western','chinese','any')),
  target_member_ids uuid[] not null,
  time_limit_minutes smallint check (
    time_limit_minutes is null or time_limit_minutes in (15,30,45)
  ),
  budget_preference text check (
    budget_preference is null or budget_preference in ('economy','standard')
  ),
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
  replace_dish_id uuid,
  change_reason text check (
    change_reason is null
    or change_reason in (
      'simpler',
      'different_ingredient',
      'child_friendly',
      'different_flavor',
      'custom'
    )
  ),
  -- 台帳は正規化コマンドの HMAC のみを保持し、生リクエスト本文や自由記述は載せない
  request_hmac_version text not null
    check (request_hmac_version = 'generation-command.v1'),
  request_hmac text not null check (request_hmac ~ '^[a-f0-9]{64}$'),
  completed_menu_id uuid references public.menus(id) on delete set null,
  user_usage_day date not null,
  user_quota_reserved boolean not null default false,
  -- 未送信の利用者外部 call attempt 予約。markSent で sent へ確定し、failBeforeSend で返却する
  user_attempt_reserved boolean not null default false,
  -- attempt 予約日（repair が success 予約日と異なる JST 日に跨る場合に備える）
  user_attempt_day date,
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
  check (private.ai_generation_terminal_details_valid(status, terminal_details))
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

-- Plan 6 運用/cleanup が参照する固定名。本 session は DDL のみ（markSent 結合は C6）
create table private.ai_user_daily_external_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_day),
  check (reserved_count + sent_count <= 12)
);

create table private.ai_user_rate_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  sent_count integer not null default 0 check (sent_count between 0 and 4),
  updated_at timestamptz not null default now(),
  primary key (user_id, window_started_at),
  check ((extract(epoch from window_started_at)::bigint % 600) = 0)
);

revoke all on private.ai_generation_requests from public, anon, authenticated;
revoke all on private.generation_draft_submission_versions from public, anon, authenticated;
revoke all on private.ai_user_daily_usage from public, anon, authenticated;
revoke all on private.ai_global_daily_usage from public, anon, authenticated;
revoke all on private.ai_user_daily_external_attempts from public, anon, authenticated;
revoke all on private.ai_user_rate_windows from public, anon, authenticated;
revoke all on function private.ai_conflict_codes_valid(text[]) from public, anon, authenticated, service_role;
revoke all on function private.ai_generation_terminal_details_valid(text, jsonb)
  from public, anon, authenticated, service_role;

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
    -- 未送信 attempt 予約だけを返却する（送信済みは返さない）
    if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
      update private.ai_user_daily_external_attempts
      set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where user_id = v_request.user_id and usage_day = v_request.user_attempt_day;
    end if;
    if v_request.global_reserved_day is not null then
      update private.ai_global_daily_usage
      set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where usage_day = v_request.global_reserved_day;
    end if;
    update private.ai_generation_requests set
      status = 'failed', failure_code = 'generation_timeout',
      user_quota_reserved = false, user_attempt_reserved = false, user_attempt_day = null,
      global_reserved_day = null,
      retry_at = p_now, completed_at = p_now, updated_at = p_now,
      duration_ms = greatest(0, floor(extract(epoch from (p_now - started_at)) * 1000)::integer)
    where id = v_request.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 終端行だけを 30 日超で削除する。processing と menu 参照行は残す。
create or replace function public.cleanup_ai_generation_requests(
  p_before timestamptz
) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_count integer;
begin
  if p_before is null then
    raise exception using errcode = '22023', message = 'invalid_cleanup_before';
  end if;
  delete from private.ai_generation_requests request
  where request.status in ('succeeded', 'failed', 'constraint_conflict')
    and request.completed_at is not null
    and request.completed_at < p_before
    and not exists (
      select 1 from public.menus menu where menu.id = request.completed_menu_id
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 暫定 9 引数は DROP してから最終 14 引数のみを作成する（CREATE OR REPLACE ではシグネチャ置換不可）
drop function if exists public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, integer, integer, integer, timestamptz
);

create or replace function public.reserve_ai_generation(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_request_kind text,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_source_menu_id uuid,
  p_replace_dish_id uuid,
  p_change_reason text,
  p_request_hmac_version text,
  p_request_hmac text,
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
  v_draft public.generation_drafts;
  v_user private.ai_user_daily_usage;
  v_global private.ai_global_daily_usage;
  v_attempts private.ai_user_daily_external_attempts;
begin
  -- HMAC 検証は冪等キー照合・quota 参照より先。不正形式は台帳を触らない
  if p_request_hmac_version is distinct from 'generation-command.v1'
     or p_request_hmac is null
     or p_request_hmac !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_request_hmac';
  end if;
  -- release-locked 成功上限 5 は idempotency lookup より前に拒否する
  if p_user_limit <> 5 then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  if p_global_limit is null or p_global_limit not between 1 and 45
     or p_stale_after_seconds < 30 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  if p_request_kind not in ('new_menu', 'regenerate_menu', 'regenerate_dish') then
    raise exception using errcode = '22023', message = 'invalid_request_kind';
  end if;

  -- 同一 user+key の競合を直列化し、HMAC 比較を cleanup/quota より先に確定する
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_request from private.ai_generation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hmac_version is distinct from p_request_hmac_version
       or v_request.request_hmac is distinct from p_request_hmac then
      raise exception using errcode = '22023', message = 'idempotency_payload_mismatch';
    end if;
    return private.ai_request_payload(v_request, true);
  end if;

  -- 本当に新しい key だけが draft ゲート・stale cleanup・active lookup・quota へ進む
  if p_request_kind = 'new_menu' then
    select * into v_draft
    from public.generation_drafts
    where id = p_draft_id and user_id = p_user_id and revision = p_draft_revision
      and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'draft_unavailable';
    end if;
    insert into private.generation_draft_submission_versions(
      draft_id, user_id, draft_revision, meal_type, main_ingredients, cuisine_genre,
      target_member_ids, time_limit_minutes, budget_preference, avoid_ingredients,
      memo, pantry_selections, captured_at
    ) values (
      v_draft.id, v_draft.user_id, v_draft.revision, v_draft.meal_type,
      v_draft.main_ingredients, v_draft.cuisine_genre, v_draft.target_member_ids,
      v_draft.time_limit_minutes, v_draft.budget_preference,
      v_draft.avoid_ingredients, v_draft.memo, v_draft.pantry_selections, p_now
    ) on conflict (draft_id, user_id, draft_revision) do nothing;
  elsif p_draft_id is not null or p_draft_revision is not null then
    raise exception using errcode = '22023', message = 'invalid_draft_reference';
  end if;

  perform public.cleanup_stale_ai_generations(p_now);

  select * into v_active from private.ai_generation_requests
  where user_id = p_user_id and status = 'processing';
  if found then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'generation_in_progress',
      v_active.processing_expires_at, p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  insert into private.ai_user_daily_usage(user_id, usage_day)
  values (p_user_id, v_day) on conflict do nothing;
  insert into private.ai_global_daily_usage(usage_day)
  values (v_day) on conflict do nothing;
  insert into private.ai_user_daily_external_attempts(user_id, usage_day)
  values (p_user_id, v_day) on conflict do nothing;
  select * into v_user from private.ai_user_daily_usage
    where user_id = p_user_id and usage_day = v_day for update;
  select * into v_global from private.ai_global_daily_usage
    where usage_day = v_day for update;
  select * into v_attempts from private.ai_user_daily_external_attempts
    where user_id = p_user_id and usage_day = v_day for update;

  if v_user.success_count + v_user.reserved_count >= p_user_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'user_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  -- release-locked 12 回/日の外部 call attempt 上限
  if v_attempts.reserved_count + v_attempts.sent_count >= 12 then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'user_attempt_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if v_global.sent_count + v_global.reserved_count >= p_global_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'global_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  update private.ai_user_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
  where user_id = p_user_id and usage_day = v_day;
  update private.ai_user_daily_external_attempts
  set reserved_count = reserved_count + 1, updated_at = p_now
  where user_id = p_user_id and usage_day = v_day;
  update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
  where usage_day = v_day;
  insert into private.ai_generation_requests(
    user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
    source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    p_user_id, p_idempotency_key, p_request_kind, 'processing', p_draft_id,
    p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
    p_request_hmac_version, p_request_hmac,
    v_day, true, true, v_day,
    v_day, p_now + make_interval(secs => p_stale_after_seconds), p_now
  ) returning * into v_request;
  -- 予約後に本人の 30 日超終端行を opportunistic に掃除（processing / menu 参照は残す）
  perform public.cleanup_ai_generation_requests(
    p_now - interval '30 days'
  );
  return private.ai_request_payload(v_request, false);
end;
$$;

create or replace function public.mark_ai_global_sent(
  p_request_id uuid, p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_request private.ai_generation_requests;
  v_window_started_at timestamptz;
  v_window private.ai_user_rate_windows;
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing'
     or v_request.global_reserved_day is null
     or not v_request.user_attempt_reserved
     or v_request.user_attempt_day is null then
    raise exception using errcode = '55000', message = 'global_call_not_reserved';
  end if;

  -- 固定 600 秒窓。非整列は table check で拒否される
  v_window_started_at := to_timestamp(
    floor(extract(epoch from p_now) / 600.0) * 600.0
  );
  insert into private.ai_user_rate_windows(user_id, window_started_at)
  values (v_request.user_id, v_window_started_at) on conflict do nothing;
  select * into v_window from private.ai_user_rate_windows
    where user_id = v_request.user_id and window_started_at = v_window_started_at
    for update;

  -- 短期 4 回上限。拒否時は未送信の success / attempt / global 予約をまとめて解放する
  if v_window.sent_count >= 4 then
    if v_request.user_quota_reserved then
      update private.ai_user_daily_usage
      set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where user_id = v_request.user_id and usage_day = v_request.user_usage_day;
    end if;
    update private.ai_user_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where user_id = v_request.user_id and usage_day = v_request.user_attempt_day;
    update private.ai_global_daily_usage
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where usage_day = v_request.global_reserved_day;
    update private.ai_generation_requests set
      status = 'failed',
      failure_code = 'user_short_window_limit',
      retry_at = v_window_started_at + interval '10 minutes',
      user_quota_reserved = false,
      user_attempt_reserved = false,
      user_attempt_day = null,
      global_reserved_day = null,
      completed_at = p_now,
      updated_at = p_now,
      duration_ms = greatest(
        0,
        floor(extract(epoch from (p_now - started_at)) * 1000)::integer
      )
    where id = p_request_id
    returning * into v_request;
    return private.ai_request_payload(v_request, false)
      || jsonb_build_object('sent', false, 'code', 'user_short_window_limit');
  end if;

  update private.ai_global_daily_usage
  set reserved_count = reserved_count - 1, sent_count = sent_count + 1, updated_at = p_now
  where usage_day = v_request.global_reserved_day and reserved_count > 0;
  if not found then raise exception using errcode = '23514', message = 'global_reservation_corrupt'; end if;

  update private.ai_user_daily_external_attempts
  set reserved_count = reserved_count - 1, sent_count = sent_count + 1, updated_at = p_now
  where user_id = v_request.user_id
    and usage_day = v_request.user_attempt_day
    and reserved_count > 0;
  if not found then raise exception using errcode = '23514', message = 'attempt_reservation_corrupt'; end if;

  update private.ai_user_rate_windows
  set sent_count = sent_count + 1, updated_at = p_now
  where user_id = v_request.user_id and window_started_at = v_window_started_at;

  update private.ai_generation_requests
  set global_reserved_day = null,
      user_attempt_reserved = false,
      user_attempt_day = null,
      global_sent_calls = global_sent_calls + 1,
      updated_at = p_now
  where id = p_request_id
  returning * into v_request;
  return private.ai_request_payload(v_request, false)
    || jsonb_build_object('sent', true);
end;
$$;

create or replace function public.reserve_ai_repair_call(
  p_request_id uuid, p_global_limit integer,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_request private.ai_generation_requests;
  v_usage private.ai_global_daily_usage;
  v_attempts private.ai_user_daily_external_attempts;
  v_day date := private.ai_jst_day(p_now);
begin
  if p_global_limit is null or p_global_limit not between 1 and 45 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing' or v_request.repair_attempted
     or v_request.global_reserved_day is not null
     or v_request.user_attempt_reserved then
    raise exception using errcode = '55000', message = 'repair_not_available';
  end if;
  insert into private.ai_global_daily_usage(usage_day) values (v_day) on conflict do nothing;
  insert into private.ai_user_daily_external_attempts(user_id, usage_day)
  values (v_request.user_id, v_day) on conflict do nothing;
  select * into v_usage from private.ai_global_daily_usage where usage_day = v_day for update;
  select * into v_attempts from private.ai_user_daily_external_attempts
    where user_id = v_request.user_id and usage_day = v_day for update;
  -- repair_attempted は枠不足でも立て、二重 repair を防ぐ
  update private.ai_generation_requests set repair_attempted = true, updated_at = p_now
    where id = p_request_id;
  if v_attempts.reserved_count + v_attempts.sent_count >= 12 then
    return jsonb_build_object(
      'reserved', false,
      'retry_at', private.ai_next_jst_midnight(p_now),
      'code', 'user_attempt_limit'
    );
  end if;
  if v_usage.sent_count + v_usage.reserved_count >= p_global_limit then
    return jsonb_build_object('reserved', false, 'retry_at', private.ai_next_jst_midnight(p_now));
  end if;
  update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
    where usage_day = v_day;
  update private.ai_user_daily_external_attempts
  set reserved_count = reserved_count + 1, updated_at = p_now
  where user_id = v_request.user_id and usage_day = v_day;
  update private.ai_generation_requests
  set global_reserved_day = v_day,
      user_attempt_reserved = true,
      user_attempt_day = v_day,
      updated_at = p_now
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
  -- 未送信 attempt 予約のみ返却。markSent 済みの sent_count は触らない
  if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
    update private.ai_user_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where user_id = v_request.user_id and usage_day = v_request.user_attempt_day;
  end if;
  if v_request.global_reserved_day is not null then
    update private.ai_global_daily_usage set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where usage_day = v_request.global_reserved_day;
  end if;
  update private.ai_generation_requests set
    status = 'failed', failure_code = p_failure_code, retry_at = p_retry_at,
    user_quota_reserved = false, user_attempt_reserved = false, user_attempt_day = null,
    global_reserved_day = null,
    completed_at = p_now, updated_at = p_now,
    duration_ms = greatest(0, floor(extract(epoch from (p_now - started_at)) * 1000)::integer)
  where id = p_request_id returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$$;

-- 旧 jsonb overload を完全に落とし、codes-only text[] を唯一の永続化境界にする
drop function if exists public.finalize_ai_generation_conflict(uuid, jsonb, timestamptz);

create or replace function public.finalize_ai_generation_conflict(
  p_request_id uuid,
  p_conflict_codes text[],
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_request private.ai_generation_requests;
begin
  -- 無効・重複・12 超は request を変更せず拒否する
  if not private.ai_conflict_codes_valid(p_conflict_codes) then
    raise exception using errcode = '22023', message = 'invalid_terminal_details';
  end if;

  select * into v_request from private.ai_generation_requests
  where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'request_not_found';
  end if;
  -- 既に終端なら immutable replay（succeeded/failed/timeout を書き直さない）
  if v_request.status is distinct from 'processing' then
    return private.ai_request_payload(v_request, true);
  end if;

  -- 未解放の success / attempt / global 予約を同じ transaction で解放する
  if v_request.user_quota_reserved then
    update private.ai_user_daily_usage
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where user_id = v_request.user_id and usage_day = v_request.user_usage_day;
  end if;
  if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
    update private.ai_user_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where user_id = v_request.user_id and usage_day = v_request.user_attempt_day;
  end if;
  if v_request.global_reserved_day is not null then
    update private.ai_global_daily_usage
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where usage_day = v_request.global_reserved_day;
  end if;

  update private.ai_generation_requests set
    status = 'constraint_conflict',
    failure_code = null,
    terminal_details = jsonb_build_object('conflictCodes', to_jsonb(p_conflict_codes)),
    user_quota_reserved = false,
    user_attempt_reserved = false,
    user_attempt_day = null,
    global_reserved_day = null,
    completed_at = p_now,
    updated_at = p_now,
    duration_ms = greatest(
      0,
      floor(extract(epoch from (p_now - started_at)) * 1000)::integer
    )
  where id = p_request_id
  returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$$;

create or replace function private.persist_validated_menu(
  p_request private.ai_generation_requests,
  p_menu jsonb,
  p_preference_snapshot jsonb,
  p_safety_snapshot jsonb,
  p_safety_fingerprint text,
  p_allergen_version text,
  p_food_rule_version text,
  p_target_members jsonb,
  p_expired_checks jsonb
) returns uuid language plpgsql set search_path = pg_catalog, pg_temp
as $$
declare
  v_menu_id uuid := (p_menu->>'menuId')::uuid;
  v_dish jsonb;
  v_item jsonb;
  v_step jsonb;
  v_timeline jsonb;
  v_adaptation jsonb;
  v_action jsonb;
  v_action_position bigint;
  v_label jsonb;
  v_usage jsonb;
  v_checked_at timestamptz;
begin
  insert into public.menus(
    id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
    preference_snapshot,safety_snapshot,safety_fingerprint,
    allergen_dictionary_version,food_safety_rule_version,output_schema_version,
    derivation_group_id,parent_menu_id,change_reason,change_reason_custom
  ) values (
    v_menu_id,p_request.user_id,p_menu->>'mealType',p_menu->>'cuisineGenre',
    (p_menu->>'servings')::integer,(p_menu->>'totalElapsedMinutes')::integer,
    p_preference_snapshot,p_safety_snapshot,p_safety_fingerprint,
    p_allergen_version,p_food_rule_version,p_menu->>'schemaVersion',
    v_menu_id,null,null,null
  );

  for v_item in select value from jsonb_array_elements(p_target_members) loop
    insert into public.menu_target_members(
      menu_id,user_id,household_member_id,household_member_user_id,
      anonymous_ref,member_display_name_snapshot
    ) values (
      v_menu_id,p_request.user_id,(v_item->>'householdMemberId')::uuid,p_request.user_id,
      v_item->>'anonymousRef',v_item->>'displayNameSnapshot'
    );
  end loop;

  for v_usage in select value from jsonb_array_elements(p_menu->'pantryUsage') loop
    select nullif(check_->>'checkedAt','')::timestamptz
      into v_checked_at
    from jsonb_array_elements(p_expired_checks) as checks(check_)
    where check_->>'pantryItemId'=v_usage->>'pantryItemId'
    limit 1;
    insert into public.generation_pantry_selections(
      id,menu_id,user_id,pantry_item_id,pantry_name_snapshot,priority,idempotency_key,
      expired_item_checked_at,expired_item_check_jst_date,usage_status,
      planned_quantity,inventory_quantity_snapshot,shortage_quantity,unit,unused_reason
    ) values (
      (v_usage->>'selectionId')::uuid,v_menu_id,p_request.user_id,
      nullif(v_usage->>'pantryItemId','')::uuid,v_usage->>'pantryItemName',v_usage->>'priority',
      p_request.idempotency_key,
      v_checked_at,
      (v_checked_at at time zone 'Asia/Tokyo')::date,
      v_usage->>'usageStatus',nullif(v_usage->>'plannedQuantity','')::numeric,
      nullif(v_usage->>'inventoryQuantity','')::numeric,
      nullif(v_usage->>'shortageQuantity','')::numeric,nullif(v_usage->>'unit',''),
      nullif(v_usage->>'unusedReason','')
    );
  end loop;

  for v_dish in select value from jsonb_array_elements(p_menu->'dishes') loop
    insert into public.dishes(id,menu_id,user_id,role,position,name,description,cooking_time_minutes)
    values((v_dish->>'id')::uuid,v_menu_id,p_request.user_id,v_dish->>'role',
      (v_dish->>'position')::integer,v_dish->>'name',v_dish->>'description',
      (v_dish->>'cookingTimeMinutes')::integer);
    for v_item in select value from jsonb_array_elements(v_dish->'ingredients') loop
      insert into public.dish_ingredients(
        id,menu_id,dish_id,user_id,position,name,quantity_value,quantity_text,unit,
        store_section,pantry_selection_id,label_confirmation_required
      ) values (
        (v_item->>'id')::uuid,v_menu_id,(v_dish->>'id')::uuid,p_request.user_id,
        (v_item->>'position')::integer,v_item->>'name',nullif(v_item->>'quantityValue','')::numeric,
        v_item->>'quantityText',nullif(v_item->>'unit',''),v_item->>'storeSection',
        nullif(v_item->>'pantrySelectionId','')::uuid,
        (v_item->>'labelConfirmationRequired')::boolean
      );
    end loop;
    for v_step in select value from jsonb_array_elements(v_dish->'steps') loop
      insert into public.recipe_steps(id,menu_id,dish_id,user_id,position,instruction)
      values((v_step->>'id')::uuid,v_menu_id,(v_dish->>'id')::uuid,p_request.user_id,
        (v_step->>'position')::integer,v_step->>'instruction');
    end loop;
  end loop;

  for v_timeline in select value from jsonb_array_elements(p_menu->'timeline') loop
    insert into public.menu_timeline_steps(
      id,menu_id,user_id,position,start_minute,duration_minutes,instruction,dish_id,recipe_step_id
    ) values (
      (v_timeline->>'id')::uuid,v_menu_id,p_request.user_id,
      (v_timeline->>'position')::integer,(v_timeline->>'startMinute')::integer,
      (v_timeline->>'durationMinutes')::integer,v_timeline->>'instruction',
      nullif(v_timeline->>'dishId','')::uuid,nullif(v_timeline->>'recipeStepId','')::uuid
    );
  end loop;

  for v_adaptation in select value from jsonb_array_elements(p_menu->'adaptations') loop
    insert into public.menu_member_adaptations(
      id,menu_id,dish_id,user_id,anonymous_member_ref,portion_text,
      branch_before_recipe_step_id,additional_cutting,additional_heating,
      additional_seasoning,serving_check,safety_tags
    ) values (
      (v_adaptation->>'id')::uuid,v_menu_id,(v_adaptation->>'dishId')::uuid,p_request.user_id,
      v_adaptation->>'anonymousMemberRef',v_adaptation->>'portionText',
      (v_adaptation->>'branchBeforeRecipeStepId')::uuid,
      nullif(v_adaptation->>'additionalCutting',''),nullif(v_adaptation->>'additionalHeating',''),
      nullif(v_adaptation->>'additionalSeasoning',''),v_adaptation->>'servingCheck',
      array(select jsonb_array_elements_text(v_adaptation->'safetyTags'))
    );
    for v_action, v_action_position in
      select action, ordinality
      from jsonb_array_elements(v_adaptation->'safetyActions')
        with ordinality as actions(action, ordinality)
    loop
      insert into public.menu_safety_actions(
        menu_id,dish_id,ingredient_id,user_id,anonymous_member_ref,before_recipe_step_id,
        position,kind,instruction
      ) values (
        v_menu_id,(v_action->>'dishId')::uuid,(v_action->>'ingredientId')::uuid,p_request.user_id,
        v_action->>'anonymousMemberRef',(v_action->>'beforeRecipeStepId')::uuid,
        v_action_position::smallint,v_action->>'kind',v_action->>'instruction'
      );
    end loop;
  end loop;

  if (select count(*) from public.menu_safety_actions where menu_id = v_menu_id)
     <> (select count(*) from jsonb_path_query(
       p_menu, '$.adaptations[*].safetyActions[*]'::jsonpath)) then
    raise exception using errcode = '23514', message = 'menu_safety_action_count_mismatch';
  end if;

  for v_label in select value from jsonb_array_elements(p_menu->'labelConfirmations') loop
    insert into public.menu_label_confirmations(
      menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,allergen_id,
      anonymous_member_ref,dictionary_version,requirement_safety_fingerprint,
      is_current,confirmation_status
    ) values (
      v_menu_id,p_request.user_id,v_label->>'sourceType',(v_label->>'sourceId')::uuid,
      v_label->>'sourcePath',v_label->>'sourceText',v_label->>'allergenId',
      v_label->>'anonymousMemberRef',
      v_label->>'dictionaryVersion',p_safety_fingerprint,true,v_label->>'confirmationStatus'
    );
  end loop;
  return v_menu_id;
end;
$$;

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

-- Plan 3 唯一のラベル確認遷移。fingerprint helper revoke 直後に置き、helper 呼出し前に
-- expected fingerprint の Unicode whitespace / 1〜200 文字境界を空結果で拒否する。
create or replace function public.confirm_menu_label_confirmation(
  p_menu_id uuid,
  p_confirmation_id uuid,
  p_expected_safety_fingerprint text
) returns setof public.menu_label_confirmations
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_target_member_ids uuid[];
begin
  if v_user_id is null then return; end if;
  if p_expected_safety_fingerprint is null
     or p_expected_safety_fingerprint is distinct from btrim(
       p_expected_safety_fingerprint,
       U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
     )
     or char_length(p_expected_safety_fingerprint) not between 1 and 200 then
    return;
  end if;
  select array_agg(
    target.household_member_id
    order by substring(target.anonymous_ref from '^member_([1-9][0-9]*)$')::integer
  )
    into v_target_member_ids
  from public.menu_target_members target
  where target.menu_id = p_menu_id and target.user_id = v_user_id
    and target.household_member_id is not null;
  if coalesce(cardinality(v_target_member_ids), 0) = 0 then return; end if;
  begin
    perform private.lock_and_assert_current_safety_fingerprint(
      v_user_id, v_target_member_ids, p_expected_safety_fingerprint
    );
  exception
    when sqlstate 'P0001' then return;
  end;
  return query
    update public.menu_label_confirmations confirmation
    set confirmation_status = 'confirmed',
        confirmed_at = statement_timestamp(),
        confirmed_by = v_user_id
    where confirmation.id = p_confirmation_id
      and confirmation.menu_id = p_menu_id
      and confirmation.user_id = v_user_id
      and confirmation.is_current
      and confirmation.confirmation_status = 'pending'
      and confirmation.requirement_safety_fingerprint = p_expected_safety_fingerprint
    returning confirmation.*;
end;
$function$;
revoke all on function public.confirm_menu_label_confirmation(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_menu_label_confirmation(uuid,uuid,text)
  to authenticated;

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

create or replace function public.finalize_ai_generation_success(
  p_request_id uuid,p_menu jsonb,p_preference_snapshot jsonb,p_safety_snapshot jsonb,
  p_safety_fingerprint text,p_allergen_version text,p_food_rule_version text,
  p_target_members jsonb,p_expired_checks jsonb,
  p_source_menu_id uuid,p_change_reason text,p_change_reason_custom text,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_request private.ai_generation_requests; v_menu_id uuid;
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'request_not_found'; end if;
  if v_request.status <> 'processing' then return private.ai_request_payload(v_request, true); end if;
  if not v_request.user_quota_reserved then
    raise exception using errcode = '23514', message = 'user_reservation_missing';
  end if;
  perform private.lock_and_assert_current_safety_fingerprint(
    v_request.user_id,
    array(select (target->>'householdMemberId')::uuid
      from jsonb_array_elements(p_target_members) as targets(target)),
    p_safety_fingerprint
  );
  v_menu_id := private.persist_validated_menu(
    v_request,p_menu,p_preference_snapshot,p_safety_snapshot,p_safety_fingerprint,
    p_allergen_version,p_food_rule_version,p_target_members,p_expired_checks
  );
  perform private.assign_regeneration_lineage(
    v_request.user_id,p_source_menu_id,v_menu_id,p_change_reason,p_change_reason_custom
  );
  if v_request.draft_id is not null and v_request.draft_revision is not null then
    perform private.soft_delete_generation_draft(
      v_request.user_id,
      v_request.draft_id,
      v_request.draft_revision
    );
  end if;
  update private.ai_user_daily_usage set
    reserved_count = reserved_count - 1, success_count = success_count + 1, updated_at = p_now
  where user_id = v_request.user_id and usage_day = v_request.user_usage_day and reserved_count > 0;
  if not found then raise exception using errcode = '23514', message = 'user_reservation_corrupt'; end if;
  if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
    update private.ai_user_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where user_id = v_request.user_id and usage_day = v_request.user_attempt_day;
  end if;
  if v_request.global_reserved_day is not null then
    update private.ai_global_daily_usage set reserved_count = reserved_count - 1, updated_at = p_now
    where usage_day = v_request.global_reserved_day and reserved_count > 0;
  end if;
  update private.ai_generation_requests set
    status = 'succeeded',completed_menu_id = v_menu_id,user_quota_reserved = false,
    user_attempt_reserved = false,user_attempt_day = null,global_reserved_day = null,
    completed_at = p_now,updated_at = p_now,
    duration_ms = greatest(0, floor(extract(epoch from (p_now - started_at)) * 1000)::integer)
  where id = p_request_id returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$$;

create or replace function public.get_ai_generation_status(
  p_user_id uuid,p_idempotency_key uuid,p_user_limit integer,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_request private.ai_generation_requests; v_success integer := 0; v_reserved integer := 0;
  v_day date := private.ai_jst_day(p_now);
begin
  if p_user_limit <> 5 then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  perform public.cleanup_stale_ai_generations(p_now);
  select * into v_request from private.ai_generation_requests
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  select coalesce(success_count,0),coalesce(reserved_count,0) into v_success,v_reserved
    from private.ai_user_daily_usage where user_id = p_user_id and usage_day = v_day;
  if not found then v_success := 0; v_reserved := 0; end if;
  if v_request.id is null then
    return jsonb_build_object('status','not_started','idempotency_key',p_idempotency_key,
      'remaining',greatest(p_user_limit-v_success-v_reserved,0),'user_daily_limit',p_user_limit,
      'consumed',false,'retry_at',null);
  end if;
  return private.ai_request_payload(v_request,false) || jsonb_build_object(
    'remaining',greatest(p_user_limit-v_success-v_reserved,0),
    'user_daily_limit',p_user_limit,'consumed',v_request.status='succeeded',
    'terminal_details',v_request.terminal_details,'actual_model_ids',v_request.actual_model_ids,
    'started_at',v_request.started_at,'completed_at',v_request.completed_at
  );
end;
$$;

-- 生成行を作らず現在の成功 / attempt / 短期窓 / 全体受付を返す
create or replace function public.get_ai_usage_today(
  p_user_id uuid,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_day date := private.ai_jst_day(p_now);
  v_window_started_at timestamptz := to_timestamp(
    floor(extract(epoch from p_now) / 600.0) * 600.0
  );
  v_success_count integer := 0;
  v_success_reserved integer := 0;
  v_attempt_sent integer := 0;
  v_attempt_reserved integer := 0;
  v_window_sent integer := 0;
  v_global_sent integer := 0;
  v_global_reserved integer := 0;
  v_success_remaining integer;
  v_attempt_remaining integer;
  v_window_remaining integer;
  v_global_available boolean;
  v_success_retry timestamptz;
  v_attempt_retry timestamptz;
  v_window_retry timestamptz;
  v_global_retry timestamptz;
  v_retry_at timestamptz;
begin
  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_success_count, v_success_reserved
  from private.ai_user_daily_usage
  where user_id = p_user_id and usage_day = v_day;
  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_attempt_sent, v_attempt_reserved
  from private.ai_user_daily_external_attempts
  where user_id = p_user_id and usage_day = v_day;
  select coalesce(sent_count, 0) into v_window_sent
  from private.ai_user_rate_windows
  where user_id = p_user_id and window_started_at = v_window_started_at;
  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_global_sent, v_global_reserved
  from private.ai_global_daily_usage
  where usage_day = v_day;

  v_success_remaining := greatest(5 - v_success_count - v_success_reserved, 0);
  v_attempt_remaining := greatest(12 - v_attempt_sent - v_attempt_reserved, 0);
  v_window_remaining := greatest(4 - v_window_sent, 0);
  v_global_available := (v_global_sent + v_global_reserved) < 45;

  v_success_retry := case when v_success_remaining = 0
    then private.ai_next_jst_midnight(p_now) else null end;
  v_attempt_retry := case when v_attempt_remaining = 0
    then private.ai_next_jst_midnight(p_now) else null end;
  v_window_retry := case when v_window_remaining = 0
    then v_window_started_at + interval '10 minutes' else null end;
  v_global_retry := case when not v_global_available
    then private.ai_next_jst_midnight(p_now) else null end;

  select min(candidate) into v_retry_at
  from (values (v_success_retry), (v_attempt_retry), (v_window_retry), (v_global_retry))
    as retries(candidate)
  where candidate is not null;

  return jsonb_build_object(
    'success', jsonb_build_object(
      'consumed', v_success_count,
      'limit', 5,
      'remaining', v_success_remaining
    ),
    'attempts', jsonb_build_object(
      'sent', v_attempt_sent,
      'limit', 12,
      'remaining', v_attempt_remaining
    ),
    'shortWindow', jsonb_build_object(
      'sent', v_window_sent,
      'limit', 4,
      'remaining', v_window_remaining,
      'retryAt', v_window_retry
    ),
    'globalAvailable', v_global_available,
    'retryAt', v_retry_at
  );
end;
$$;

create or replace function public.get_ai_generation_submission_snapshot(
  p_request_id uuid,
  p_user_id uuid
) returns table (
  draft_id uuid,
  draft_revision bigint,
  meal_type text,
  main_ingredients text[],
  cuisine_genre text,
  target_member_ids uuid[],
  time_limit_minutes smallint,
  budget_preference text,
  avoid_ingredients text[],
  memo text,
  pantry_selections jsonb,
  captured_at timestamptz
) language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    snapshot.draft_id,
    snapshot.draft_revision,
    snapshot.meal_type,
    snapshot.main_ingredients,
    snapshot.cuisine_genre,
    snapshot.target_member_ids,
    snapshot.time_limit_minutes,
    snapshot.budget_preference,
    snapshot.avoid_ingredients,
    snapshot.memo,
    snapshot.pantry_selections,
    snapshot.captured_at
  from private.ai_generation_requests as request
  join private.generation_draft_submission_versions as snapshot
    on snapshot.draft_id = request.draft_id
   and snapshot.user_id = request.user_id
   and snapshot.draft_revision = request.draft_revision
  where request.id = p_request_id
    and request.user_id = p_user_id
    and request.request_kind = 'new_menu'
$$;

revoke all on function private.persist_validated_menu(
  private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb
) from public,anon,authenticated,service_role;

revoke all on function public.cleanup_stale_ai_generations(timestamptz) from public, anon, authenticated;
revoke all on function public.cleanup_ai_generation_requests(timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.reserve_ai_repair_call(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_ai_global_sent(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_ai_generation_model(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_ai_generation_failure(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_ai_generation_conflict(uuid, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_ai_generation_success(uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.get_ai_generation_status(uuid,uuid,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.get_ai_usage_today(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.get_ai_generation_submission_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cleanup_stale_ai_generations(timestamptz) to service_role;
grant execute on function public.cleanup_ai_generation_requests(timestamptz) to service_role;
grant execute on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer, integer, timestamptz
) to service_role;
grant execute on function public.reserve_ai_repair_call(uuid, integer, timestamptz) to service_role;
grant execute on function public.mark_ai_global_sent(uuid, timestamptz) to service_role;
grant execute on function public.record_ai_generation_model(uuid, text, timestamptz) to service_role;
grant execute on function public.finalize_ai_generation_failure(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.finalize_ai_generation_conflict(uuid, text[], timestamptz) to service_role;
grant execute on function public.finalize_ai_generation_success(uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz) to service_role;
grant execute on function public.get_ai_generation_status(uuid,uuid,integer,timestamptz) to service_role;
grant execute on function public.get_ai_usage_today(uuid,timestamptz) to service_role;
grant execute on function public.get_ai_generation_submission_snapshot(uuid,uuid) to service_role;
