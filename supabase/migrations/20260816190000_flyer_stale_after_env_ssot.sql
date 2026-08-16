-- SC12: flyer processing 孤児解放秒を generation と同じ ENV / mjs SSOT から渡す。
-- 値は 180 のまま緩めない。既存シグネチャの位置引数互換のため default 180 を末尾に足す。

drop function if exists public.reserve_flyer_weekly(
  uuid, text, text, integer, integer, integer, boolean, timestamptz
);

create function public.reserve_flyer_weekly(
  p_user_id uuid,
  p_identity_key text,
  p_idempotency_key text,
  p_attempt_limit integer,
  p_short_window_limit integer,
  p_global_limit integer,
  p_quota_disabled boolean default false,
  p_now timestamptz default pg_catalog.clock_timestamp(),
  p_stale_after_seconds integer default 180
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
  -- SC12: stale 秒の正本は AI_PROCESSING_STALE_SECONDS。短すぎる値だけ閉じる。
  if p_stale_after_seconds is null or p_stale_after_seconds < 30 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;

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
    p_now + make_interval(secs => p_stale_after_seconds), p_now
  ) returning * into v_request;

  return private.flyer_weekly_request_payload(v_request, false);
end;
$function$;

revoke all on function public.reserve_flyer_weekly(
  uuid, text, text, integer, integer, integer, boolean, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.reserve_flyer_weekly(
  uuid, text, text, integer, integer, integer, boolean, timestamptz, integer
) to service_role;
