-- Plan: 2026-07-29 paid-plan-stripe Task 7
-- チラシ週間 success+try 台帳 + reserve_flyer_weekly (S0–S4) + release 対称 + usage 投影 + 12 週 retention

-- ---------------------------------------------------------------------------
-- 1. JST 月曜始まりの週初日
-- ---------------------------------------------------------------------------
create or replace function private.ai_jst_week_start(p_now timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  -- date_trunc('week') は ISO 月曜始まり。JST 壁時計で切る。
  select date_trunc('week', (p_now at time zone 'Asia/Tokyo'))::date;
$$; -- JST 壁時計で週を切る

revoke all on function private.ai_jst_week_start(timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 台帳: flyer success (≤2) / try (≤6)
-- ---------------------------------------------------------------------------
create table private.ai_identity_flyer_weekly (
  identity_key text not null check (identity_key ~ '^[a-f0-9]{64}$'),
  week_start date not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (identity_key, week_start),
  check (reserved_count + success_count <= 2)
);

create table private.ai_identity_flyer_weekly_tries (
  identity_key text not null check (identity_key ~ '^[a-f0-9]{64}$'),
  week_start date not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (identity_key, week_start),
  check (reserved_count + sent_count <= 6)
);

revoke all on table private.ai_identity_flyer_weekly
  from public, anon, authenticated, service_role;
revoke all on table private.ai_identity_flyer_weekly_tries
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 処理行（release 対称・stale cleanup 用）
-- ---------------------------------------------------------------------------
create table private.flyer_weekly_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_key text not null check (identity_key ~ '^[a-f0-9]{64}$'),
  personal_quota_disabled boolean not null default false,
  -- reserve 署名は text。クライアント UUID 文字列を想定
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  status text not null check (status in ('processing', 'succeeded', 'failed')),
  week_start date not null,
  -- 予約フラグ（S4 で true。S8 解放 / mark で try→sent / finalize で success→success）
  flyer_success_reserved boolean not null default false,
  flyer_try_reserved boolean not null default false,
  flyer_try_sent boolean not null default false,
  user_attempt_reserved boolean not null default false,
  user_attempt_day date,
  global_reserved_day date,
  global_sent_calls smallint not null default 0 check (global_sent_calls between 0 and 2),
  quota_attempt_limit integer check (quota_attempt_limit is null or quota_attempt_limit in (6, 20)),
  quota_short_limit integer check (quota_short_limit is null or quota_short_limit in (4, 8)),
  failure_code text,
  retry_at timestamptz,
  processing_expires_at timestamptz,
  result_payload jsonb,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (user_id, idempotency_key)
);

create unique index flyer_weekly_requests_one_processing_per_user
  on private.flyer_weekly_requests(user_id) where status = 'processing';
create index flyer_weekly_requests_stale
  on private.flyer_weekly_requests(processing_expires_at) where status = 'processing';

revoke all on table private.flyer_weekly_requests
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. release helper（S8: 未送信 reserved 全解放）
-- ---------------------------------------------------------------------------
create or replace function private.release_flyer_weekly_reservations(
  p_request private.flyer_weekly_requests,
  p_now timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_request.flyer_success_reserved then
    update private.ai_identity_flyer_weekly
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where identity_key = p_request.identity_key
      and week_start = p_request.week_start;
  end if;

  -- try は sent 済みなら返却しない（S9）
  if p_request.flyer_try_reserved and not p_request.flyer_try_sent then
    update private.ai_identity_flyer_weekly_tries
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where identity_key = p_request.identity_key
      and week_start = p_request.week_start;
  end if;

  if p_request.user_attempt_reserved and p_request.user_attempt_day is not null then
    update private.ai_identity_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where identity_key = p_request.identity_key
      and usage_day = p_request.user_attempt_day;
  end if;

  if p_request.global_reserved_day is not null then
    update private.ai_global_daily_usage
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where usage_day = p_request.global_reserved_day;
  end if;
end;
$function$;

revoke all on function private.release_flyer_weekly_reservations(private.flyer_weekly_requests, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. payload builder
-- ---------------------------------------------------------------------------
create or replace function private.flyer_weekly_request_payload(
  p_request private.flyer_weekly_requests,
  p_replayed boolean default false
) returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'request_id', p_request.id,
    'idempotency_key', p_request.idempotency_key,
    'status', p_request.status,
    'failure_code', p_request.failure_code,
    'retry_at', p_request.retry_at,
    'processing_expires_at', p_request.processing_expires_at,
    'started_at', p_request.started_at,
    'completed_at', p_request.completed_at,
    'week_start', p_request.week_start,
    'result', p_request.result_payload,
    'replayed', p_replayed,
    'flyer_try_sent', p_request.flyer_try_sent,
    'global_sent_calls', p_request.global_sent_calls
  );
$$;

revoke all on function private.flyer_weekly_request_payload(private.flyer_weekly_requests, boolean)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. reserve_flyer_weekly — S0→S1→S2→S3→S4
-- ---------------------------------------------------------------------------
create or replace function public.reserve_flyer_weekly(
  p_user_id uuid,
  p_identity_key text,
  p_idempotency_key text,
  p_attempt_limit integer,
  p_short_window_limit integer,
  p_global_limit integer,
  p_quota_disabled boolean default false,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_day date := private.ai_jst_day(p_now);
  v_week date := private.ai_jst_week_start(p_now);
  v_request private.flyer_weekly_requests;
  v_active private.flyer_weekly_requests;
  v_flyer private.ai_identity_flyer_weekly;
  v_tries private.ai_identity_flyer_weekly_tries;
  v_attempts private.ai_identity_daily_external_attempts;
  v_global private.ai_global_daily_usage;
  v_quota_disabled boolean := coalesce(p_quota_disabled, false);
  v_stale_after integer := 180;
begin
  if p_identity_key is null or p_identity_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_identity_key';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1
     or char_length(p_idempotency_key) > 128 then
    raise exception using errcode = '22023', message = 'invalid_idempotency_key';
  end if;
  if p_attempt_limit is null or p_attempt_limit not in (6, 20)
     or p_short_window_limit is null or p_short_window_limit not in (4, 8) then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  -- p_global_limit の範囲は ENV のみが正本。SQL では拒否しない。

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':flyer:' || p_idempotency_key, 0)
  );

  -- generation の cleanup_stale_ai_generations 対称: 期限切れ processing を先に解放し
  -- reserved ピン留めと恒久 generation_in_progress を防ぐ（maintenance 待ちにしない）
  perform public.cleanup_stale_flyer_weekly_batch(p_now, 50);

  -- 冪等 hit
  select * into v_request from private.flyer_weekly_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return private.flyer_weekly_request_payload(v_request, true);
  end if;

  -- 同一 user の processing が残っていれば in_progress 相当（台帳非変異）
  select * into v_active from private.flyer_weekly_requests
  where user_id = p_user_id and status = 'processing';
  if found then
    return jsonb_build_object(
      'request_id', v_active.id,
      'idempotency_key', p_idempotency_key,
      'status', 'failed',
      'failure_code', 'generation_in_progress',
      'retry_at', v_active.processing_expires_at,
      'processing_expires_at', v_active.processing_expires_at,
      'started_at', v_active.started_at,
      'completed_at', p_now,
      'week_start', v_week,
      'result', null,
      'replayed', false,
      'flyer_try_sent', false,
      'global_sent_calls', 0
    );
  end if;

  -- S0: flyer success 行 FOR UPDATE（無ければ insert 0）
  if not v_quota_disabled then
    insert into private.ai_identity_flyer_weekly(identity_key, week_start)
    values (p_identity_key, v_week) on conflict do nothing;
    select * into v_flyer from private.ai_identity_flyer_weekly
      where identity_key = p_identity_key and week_start = v_week for update;

    -- S1: 成功枠満 → flyer_weekly_limit。try/attempt/global 一切なし
    if v_flyer.success_count + v_flyer.reserved_count >= 2 then
      return jsonb_build_object(
        'request_id', null,
        'idempotency_key', p_idempotency_key,
        'status', 'failed',
        'failure_code', 'flyer_weekly_limit',
        'retry_at', null,
        'processing_expires_at', null,
        'started_at', p_now,
        'completed_at', p_now,
        'week_start', v_week,
        'result', null,
        'replayed', false,
        'flyer_try_sent', false,
        'global_sent_calls', 0
      );
    end if;

    -- S2: try 行 FOR UPDATE。満 → flyer_weekly_try_limit（attempt/global 非接触）
    insert into private.ai_identity_flyer_weekly_tries(identity_key, week_start)
    values (p_identity_key, v_week) on conflict do nothing;
    select * into v_tries from private.ai_identity_flyer_weekly_tries
      where identity_key = p_identity_key and week_start = v_week for update;

    if v_tries.sent_count + v_tries.reserved_count >= 6 then
      return jsonb_build_object(
        'request_id', null,
        'idempotency_key', p_idempotency_key,
        'status', 'failed',
        'failure_code', 'flyer_weekly_try_limit',
        'retry_at', null,
        'processing_expires_at', null,
        'started_at', p_now,
        'completed_at', p_now,
        'week_start', v_week,
        'result', null,
        'replayed', false,
        'flyer_try_sent', false,
        'global_sent_calls', 0
      );
    end if;

    insert into private.ai_identity_daily_external_attempts(identity_key, usage_day)
    values (p_identity_key, v_day) on conflict do nothing;
    select * into v_attempts from private.ai_identity_daily_external_attempts
      where identity_key = p_identity_key and usage_day = v_day for update;

    -- S3a: attempt 上限
    if v_attempts.reserved_count + v_attempts.sent_count >= p_attempt_limit then
      return jsonb_build_object(
        'request_id', null,
        'idempotency_key', p_idempotency_key,
        'status', 'failed',
        'failure_code', 'user_attempt_limit',
        'retry_at', private.ai_next_jst_midnight(p_now),
        'processing_expires_at', null,
        'started_at', p_now,
        'completed_at', p_now,
        'week_start', v_week,
        'result', null,
        'replayed', false,
        'flyer_try_sent', false,
        'global_sent_calls', 0
      );
    end if;
  end if;

  insert into private.ai_global_daily_usage(usage_day)
  values (v_day) on conflict do nothing;
  select * into v_global from private.ai_global_daily_usage
    where usage_day = v_day for update;

  -- S3b: global 上限
  if v_global.sent_count + v_global.reserved_count >= p_global_limit then
    return jsonb_build_object(
      'request_id', null,
      'idempotency_key', p_idempotency_key,
      'status', 'failed',
      'failure_code', 'global_daily_limit',
      'retry_at', private.ai_next_jst_midnight(p_now),
      'processing_expires_at', null,
      'started_at', p_now,
      'completed_at', p_now,
      'week_start', v_week,
      'result', null,
      'replayed', false,
      'flyer_try_sent', false,
      'global_sent_calls', 0
    );
  end if;

  -- S4: reserved++ flyer success + try + attempt + global
  if not v_quota_disabled then
    update private.ai_identity_flyer_weekly
    set reserved_count = reserved_count + 1, updated_at = p_now
    where identity_key = p_identity_key and week_start = v_week;
    update private.ai_identity_flyer_weekly_tries
    set reserved_count = reserved_count + 1, updated_at = p_now
    where identity_key = p_identity_key and week_start = v_week;
    update private.ai_identity_daily_external_attempts
    set reserved_count = reserved_count + 1, updated_at = p_now
    where identity_key = p_identity_key and usage_day = v_day;
  end if;
  update private.ai_global_daily_usage
  set reserved_count = reserved_count + 1, updated_at = p_now
  where usage_day = v_day;

  insert into private.flyer_weekly_requests(
    user_id, identity_key, personal_quota_disabled, idempotency_key, status, week_start,
    flyer_success_reserved, flyer_try_reserved, flyer_try_sent,
    user_attempt_reserved, user_attempt_day, global_reserved_day,
    quota_attempt_limit, quota_short_limit,
    processing_expires_at, started_at
  ) values (
    p_user_id, p_identity_key, v_quota_disabled, p_idempotency_key, 'processing', v_week,
    not v_quota_disabled, not v_quota_disabled, false,
    not v_quota_disabled, case when v_quota_disabled then null else v_day end, v_day,
    p_attempt_limit, p_short_window_limit,
    p_now + make_interval(secs => v_stale_after), p_now
  ) returning * into v_request;

  return private.flyer_weekly_request_payload(v_request, false);
end;
$function$;

revoke all on function public.reserve_flyer_weekly(
  uuid, text, text, integer, integer, integer, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_flyer_weekly(
  uuid, text, text, integer, integer, integer, boolean, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. mark_flyer_weekly_sent — short 検査 + try reserved→sent + attempt/global sent
-- ---------------------------------------------------------------------------
create or replace function public.mark_flyer_weekly_sent(
  p_request_id uuid,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_request private.flyer_weekly_requests;
  v_window_started_at timestamptz;
  v_window private.ai_user_rate_windows;
begin
  select * into v_request from private.flyer_weekly_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing'
     or v_request.global_reserved_day is null then
    raise exception using errcode = '55000', message = 'global_call_not_reserved';
  end if;

  if not v_request.personal_quota_disabled then
    if not v_request.user_attempt_reserved or v_request.user_attempt_day is null then
      raise exception using errcode = '55000', message = 'global_call_not_reserved';
    end if;
    if not v_request.flyer_try_reserved or v_request.flyer_try_sent then
      raise exception using errcode = '55000', message = 'flyer_try_not_reserved';
    end if;
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from p_now) / 600.0) * 600.0
  );

  if not v_request.personal_quota_disabled then
    insert into private.ai_user_rate_windows(user_id, window_started_at)
    values (v_request.user_id, v_window_started_at) on conflict do nothing;
    select * into v_window from private.ai_user_rate_windows
      where user_id = v_request.user_id and window_started_at = v_window_started_at
      for update;

    if v_window.sent_count >= coalesce(v_request.quota_short_limit, 4) then
      -- short 上限: 未送信 reserved を全解放（S8 対称）
      perform private.release_flyer_weekly_reservations(v_request, p_now);
      update private.flyer_weekly_requests set
        status = 'failed',
        failure_code = 'user_short_window_limit',
        retry_at = v_window_started_at + interval '10 minutes',
        flyer_success_reserved = false,
        flyer_try_reserved = false,
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
      return private.flyer_weekly_request_payload(v_request, false)
        || jsonb_build_object('sent', false, 'code', 'user_short_window_limit');
    end if;
  end if;

  -- global reserved → sent
  update private.ai_global_daily_usage
  set reserved_count = reserved_count - 1, sent_count = sent_count + 1, updated_at = p_now
  where usage_day = v_request.global_reserved_day and reserved_count > 0;
  if not found then raise exception using errcode = '23514', message = 'global_reservation_corrupt'; end if;

  if not v_request.personal_quota_disabled then
    update private.ai_identity_daily_external_attempts
    set reserved_count = reserved_count - 1, sent_count = sent_count + 1, updated_at = p_now
    where identity_key = v_request.identity_key
      and usage_day = v_request.user_attempt_day
      and reserved_count > 0;
    if not found then raise exception using errcode = '23514', message = 'attempt_reservation_corrupt'; end if;

    -- try reserved → sent（返却しない）
    update private.ai_identity_flyer_weekly_tries
    set reserved_count = reserved_count - 1, sent_count = sent_count + 1, updated_at = p_now
    where identity_key = v_request.identity_key
      and week_start = v_request.week_start
      and reserved_count > 0;
    if not found then raise exception using errcode = '23514', message = 'flyer_try_reservation_corrupt'; end if;

    update private.ai_user_rate_windows
    set sent_count = sent_count + 1, updated_at = p_now
    where user_id = v_request.user_id and window_started_at = v_window_started_at;
  end if;

  update private.flyer_weekly_requests
  set global_reserved_day = null,
      user_attempt_reserved = false,
      user_attempt_day = null,
      flyer_try_sent = true,
      flyer_try_reserved = false,
      global_sent_calls = global_sent_calls + 1,
      updated_at = p_now
  where id = p_request_id
  returning * into v_request;

  return private.flyer_weekly_request_payload(v_request, false)
    || jsonb_build_object('sent', true);
end;
$function$;

revoke all on function public.mark_flyer_weekly_sent(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_flyer_weekly_sent(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. finalize success — flyer success reserved→success（日次 success 非消費）
-- ---------------------------------------------------------------------------
create or replace function public.finalize_flyer_weekly_success(
  p_request_id uuid,
  p_result jsonb,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request private.flyer_weekly_requests;
begin
  select * into v_request from private.flyer_weekly_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing' then
    raise exception using errcode = '55000', message = 'flyer_request_not_processing';
  end if;

  if v_request.flyer_success_reserved then
    update private.ai_identity_flyer_weekly
    set reserved_count = reserved_count - 1,
        success_count = success_count + 1,
        updated_at = p_now
    where identity_key = v_request.identity_key
      and week_start = v_request.week_start
      and reserved_count > 0;
    if not found then
      raise exception using errcode = '23514', message = 'flyer_success_reservation_corrupt';
    end if;
  end if;

  -- 正常経路は mark 済み（try/attempt/global は sent）。万一未 mark の reserved が残れば解放する。
  -- success は上で reserved→success 変換済みのため、解放時に二重減算しないようフラグを落としてから呼ぶ。
  if v_request.user_attempt_reserved or v_request.global_reserved_day is not null
     or (v_request.flyer_try_reserved and not v_request.flyer_try_sent) then
    v_request.flyer_success_reserved := false;
    perform private.release_flyer_weekly_reservations(v_request, p_now);
  end if;

  update private.flyer_weekly_requests set
    status = 'succeeded',
    result_payload = p_result,
    flyer_success_reserved = false,
    flyer_try_reserved = false,
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

  return private.flyer_weekly_request_payload(v_request, false);
end;
$function$;

revoke all on function public.finalize_flyer_weekly_success(uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_flyer_weekly_success(uuid, jsonb, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. finalize failure
--   p_sent=false (S8): reserved 全解放
--   p_sent=true  (S9): try は sent のまま、success reserved 解放、attempt/global は sent 済み
-- ---------------------------------------------------------------------------
create or replace function public.finalize_flyer_weekly_failure(
  p_request_id uuid,
  p_failure_code text,
  p_sent boolean,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request private.flyer_weekly_requests;
begin
  select * into v_request from private.flyer_weekly_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing' then
    raise exception using errcode = '55000', message = 'flyer_request_not_processing';
  end if;

  if not coalesce(p_sent, false) then
    -- S8: 未送信 → 全 reserved 解放
    perform private.release_flyer_weekly_reservations(v_request, p_now);
  else
    -- S9: success reserved のみ解放。try は sent のまま（flyer_try_sent 済み）
    if v_request.flyer_success_reserved then
      update private.ai_identity_flyer_weekly
      set reserved_count = greatest(reserved_count - 1, 0),
          updated_at = p_now
      where identity_key = v_request.identity_key
        and week_start = v_request.week_start;
    end if;
    -- attempt/global は mark 済みならフラグ null で noop。未 mark のまま p_sent=true は不正だが
    -- 念のため残 reserved があれば解放しない（sent 扱いを維持）
  end if;

  update private.flyer_weekly_requests set
    status = 'failed',
    failure_code = p_failure_code,
    flyer_success_reserved = false,
    flyer_try_reserved = false,
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

  return private.flyer_weekly_request_payload(v_request, false);
end;
$function$;

revoke all on function public.finalize_flyer_weekly_failure(uuid, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_flyer_weekly_failure(uuid, text, boolean, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 10. stale cleanup for flyer processing rows
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_stale_flyer_weekly_batch(
  p_now timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row private.flyer_weekly_requests;
  v_count integer := 0;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  for v_row in
    select *
    from private.flyer_weekly_requests
    where status = 'processing'
      and processing_expires_at is not null
      and processing_expires_at <= p_now
    order by processing_expires_at
    limit p_limit
    for update skip locked
  loop
    -- 未送信 reserved のみ解放（try sent 済みは返さない）
    perform private.release_flyer_weekly_reservations(v_row, p_now);
    update private.flyer_weekly_requests set
      status = 'failed',
      failure_code = 'generation_timeout',
      flyer_success_reserved = false,
      flyer_try_reserved = false,
      user_attempt_reserved = false,
      user_attempt_day = null,
      global_reserved_day = null,
      completed_at = p_now,
      updated_at = p_now
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.cleanup_stale_flyer_weekly_batch(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_flyer_weekly_batch(timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 11. get_ai_usage_today — flyerWeekly 投影を追加
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_usage_today(
  p_user_id uuid,
  p_identity_key text,
  p_user_limit integer,
  p_attempt_limit integer,
  p_short_window_limit integer,
  p_global_limit integer,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
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
  v_success_consumed integer;
  v_attempt_used integer;
  v_success_remaining integer;
  v_attempt_remaining integer;
  v_window_remaining integer;
  v_global_available boolean;
  v_success_retry timestamptz;
  v_attempt_retry timestamptz;
  v_window_retry timestamptz;
  v_global_retry timestamptz;
  v_retry_at timestamptz;
  v_global_limit integer;
  v_month date := private.ai_jst_month_start(p_now);
  v_q_day_success integer := 0;
  v_q_day_reserved integer := 0;
  v_q_month_success integer := 0;
  v_q_month_reserved integer := 0;
  v_q_day_consumed integer;
  v_q_month_consumed integer;
  v_q_day_remaining integer;
  v_q_month_remaining integer;
  v_week date := private.ai_jst_week_start(p_now);
  v_f_success integer := 0;
  v_f_success_reserved integer := 0;
  v_f_try_sent integer := 0;
  v_f_try_reserved integer := 0;
  v_f_success_consumed integer;
  v_f_try_consumed integer;
  v_f_success_remaining integer;
  v_f_try_remaining integer;
begin
  if p_identity_key is null or p_identity_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_identity_key';
  end if;
  if p_user_limit is null or p_user_limit not in (3, 10)
     or p_attempt_limit is null or p_attempt_limit not in (6, 20)
     or p_short_window_limit is null or p_short_window_limit not in (4, 8) then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  -- p_global_limit の範囲は ENV のみが正本。SQL では拒否しない。
  v_global_limit := p_global_limit;

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_success_count, v_success_reserved
  from private.ai_identity_daily_usage
  where identity_key = p_identity_key and usage_day = v_day;
  if not found then
    v_success_count := 0;
    v_success_reserved := 0;
  end if;

  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_attempt_sent, v_attempt_reserved
  from private.ai_identity_daily_external_attempts
  where identity_key = p_identity_key and usage_day = v_day;
  if not found then
    v_attempt_sent := 0;
    v_attempt_reserved := 0;
  end if;

  select coalesce(sent_count, 0) into v_window_sent
  from private.ai_user_rate_windows
  where user_id = p_user_id and window_started_at = v_window_started_at;
  if not found then
    v_window_sent := 0;
  end if;

  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_global_sent, v_global_reserved
  from private.ai_global_daily_usage
  where usage_day = v_day;
  if not found then
    v_global_sent := 0;
    v_global_reserved := 0;
  end if;

  v_success_consumed := v_success_count + v_success_reserved;
  v_attempt_used := v_attempt_sent + v_attempt_reserved;
  v_success_remaining := greatest(p_user_limit - v_success_consumed, 0);
  v_attempt_remaining := greatest(p_attempt_limit - v_attempt_used, 0);
  v_window_remaining := greatest(p_short_window_limit - v_window_sent, 0);
  v_global_available := (v_global_sent + v_global_reserved) < v_global_limit;

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_q_day_success, v_q_day_reserved
  from private.ai_identity_quality_daily
  where identity_key = p_identity_key and usage_day = v_day;
  if not found then
    v_q_day_success := 0;
    v_q_day_reserved := 0;
  end if;

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_q_month_success, v_q_month_reserved
  from private.ai_identity_quality_monthly
  where identity_key = p_identity_key and usage_month = v_month;
  if not found then
    v_q_month_success := 0;
    v_q_month_reserved := 0;
  end if;

  v_q_day_consumed := least(v_q_day_success + v_q_day_reserved, 3);
  v_q_month_consumed := least(v_q_month_success + v_q_month_reserved, 20);
  v_q_day_remaining := greatest(3 - (v_q_day_success + v_q_day_reserved), 0);
  v_q_month_remaining := greatest(20 - (v_q_month_success + v_q_month_reserved), 0);

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_f_success, v_f_success_reserved
  from private.ai_identity_flyer_weekly
  where identity_key = p_identity_key and week_start = v_week;
  if not found then
    v_f_success := 0;
    v_f_success_reserved := 0;
  end if;

  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_f_try_sent, v_f_try_reserved
  from private.ai_identity_flyer_weekly_tries
  where identity_key = p_identity_key and week_start = v_week;
  if not found then
    v_f_try_sent := 0;
    v_f_try_reserved := 0;
  end if;

  -- usage-today: reserved は consumed 側に含めない現行方針（quality は含めているが flyer success も success 側に合わせ reserved 含む）
  -- quality と同型: reserved を consumed に含めて remaining を計算
  v_f_success_consumed := least(v_f_success + v_f_success_reserved, 2);
  v_f_try_consumed := least(v_f_try_sent + v_f_try_reserved, 6);
  v_f_success_remaining := greatest(2 - (v_f_success + v_f_success_reserved), 0);
  v_f_try_remaining := greatest(6 - (v_f_try_sent + v_f_try_reserved), 0);

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
      'consumed', least(v_success_consumed, p_user_limit),
      'limit', p_user_limit,
      'remaining', v_success_remaining
    ),
    'attempts', jsonb_build_object(
      'sent', least(v_attempt_used, p_attempt_limit),
      'limit', p_attempt_limit,
      'remaining', v_attempt_remaining
    ),
    'shortWindow', jsonb_build_object(
      'sent', least(v_window_sent, p_short_window_limit),
      'limit', p_short_window_limit,
      'remaining', v_window_remaining,
      'retryAt', v_window_retry
    ),
    'quality', jsonb_build_object(
      'day', jsonb_build_object(
        'consumed', v_q_day_consumed,
        'limit', 3,
        'remaining', v_q_day_remaining
      ),
      'month', jsonb_build_object(
        'consumed', v_q_month_consumed,
        'limit', 20,
        'remaining', v_q_month_remaining
      )
    ),
    'flyerWeekly', jsonb_build_object(
      'successConsumed', v_f_success_consumed,
      'successLimit', 2,
      'successRemaining', v_f_success_remaining,
      'triesConsumed', v_f_try_consumed,
      'triesLimit', 6,
      'triesRemaining', v_f_try_remaining,
      'weekStartJst', to_char(v_week, 'YYYY-MM-DD')
    ),
    'globalAvailable', v_global_available,
    'retryAt', v_retry_at
  );
end;
$function$;

revoke all on function public.get_ai_usage_today(uuid, text, integer, integer, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_today(uuid, text, integer, integer, integer, integer, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 12. maintenance: flyer 台帳 12 週 retention + stale flyer
--     返却キーは既存 6 個のまま（件数は generationLedgers 等に混ぜない）
-- ---------------------------------------------------------------------------
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
  v_before timestamptz;
  v_identity_cutoff date;
  v_flyer_week_cutoff date;
  v_flyer_stale integer;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  v_before := p_now - interval '30 days';
  v_identity_cutoff := private.ai_jst_day(p_now) - 40;
  v_flyer_week_cutoff := private.ai_jst_week_start(p_now) - 84; -- 12 週 × 7 日

  v_stale := public.cleanup_stale_ai_generations_batch(p_now, p_limit);
  v_flyer_stale := public.cleanup_stale_flyer_weekly_batch(p_now, p_limit);
  v_stale := v_stale + v_flyer_stale;
  v_ledgers := public.cleanup_ai_generation_requests_batch(v_before, p_limit);
  v_shopping := private.cleanup_shopping_mutations(v_before, p_limit);
  v_auth := public.cleanup_auth_continuations_batch(p_now, p_limit);
  v_feedback := private.cleanup_user_feedback(v_before, p_limit);
  v_submissions := private.cleanup_generation_draft_submission_versions(v_before, p_limit);

  delete from private.ai_identity_daily_usage
  where usage_day < v_identity_cutoff;
  delete from private.ai_identity_daily_external_attempts
  where usage_day < v_identity_cutoff;

  -- flyer 台帳 12 週より古い週を削除
  delete from private.ai_identity_flyer_weekly
  where week_start < v_flyer_week_cutoff;
  delete from private.ai_identity_flyer_weekly_tries
  where week_start < v_flyer_week_cutoff;
  -- 終端 flyer request も 30 日 retention（generation と同型）
  delete from private.flyer_weekly_requests
  where status <> 'processing'
    and completed_at is not null
    and completed_at < v_before;

  return jsonb_build_object(
    'staleReservationsFinalized', v_stale,
    'generationLedgersDeleted', v_ledgers,
    'shoppingMutationsDeleted', v_shopping,
    'authContinuationsDeleted', v_auth,
    'userFeedbackDeleted', v_feedback,
    'draftSubmissionsDeleted', v_submissions
  );
end;
$function$;

revoke all on function public.run_kondate_maintenance(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_kondate_maintenance(timestamptz, integer)
  to kondate_maintenance_executor;
