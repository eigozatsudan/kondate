-- 敵対的レビュー (2026-07-25) 対応:
-- C-1: user_feedback に明示 deny ポリシー
-- I-5: user_feedback の 30 日保持をメンテナンスに追加
-- I-7: feedback 用 advisory lock の名前空間衝突を解消
-- Minor: p_window_seconds / p_global_limit の検証を厳格化

-- ---------------------------------------------------------------------------
-- C-1: RLS 有効 + ポリシー無しは inventory と衝突するため、明示 deny を置く。
-- authenticated/anon は grant も無いが、using(false) で意図をカタログに固定する。
-- ---------------------------------------------------------------------------
create policy user_feedback_deny_all
  on public.user_feedback
  for all
  to authenticated, anon
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- I-7 + Minor: rate-limited insert の lock キーと引数検証
-- ---------------------------------------------------------------------------
create or replace function public.insert_user_feedback_rate_limited(
  p_user_id uuid,
  p_category text,
  p_body text,
  p_client_path text,
  p_limit integer default 5,
  p_window_seconds integer default 86400
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_since timestamptz;
  v_count integer;
  v_id uuid;
begin
  if p_limit is null or p_limit < 1 then
    raise exception using errcode = '22023', message = 'invalid_feedback_limit';
  end if;
  -- 0 以下や null だと v_since が未来/unknown になり制限が無効化されるため拒否する
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception using errcode = '22023', message = 'invalid_feedback_window';
  end if;

  v_since := clock_timestamp() - make_interval(secs => p_window_seconds);

  -- save_generation_draft は hashtextextended(user_id, 0) を使う。
  -- 衝突を避けるため feedback 専用のプレフィックスを付ける。
  perform pg_advisory_xact_lock(
    hashtextextended('user_feedback:' || p_user_id::text, 0)
  );

  select count(*)::integer into v_count
  from public.user_feedback
  where user_id = p_user_id
    and created_at >= v_since;

  if v_count >= p_limit then
    return jsonb_build_object('ok', false, 'code', 'feedback_rate_limited');
  end if;

  insert into public.user_feedback (user_id, category, body, client_path)
  values (p_user_id, p_category, p_body, p_client_path)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.insert_user_feedback_rate_limited(uuid, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.insert_user_feedback_rate_limited(uuid, text, text, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Minor: get_ai_usage_today の p_global_limit を reserve 側と同じ 1..45 に揃える
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_usage_today(
  p_user_id uuid,
  p_now timestamptz default clock_timestamp(),
  p_global_limit integer default 45
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
begin
  if p_global_limit is null or p_global_limit not between 1 and 45 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  v_global_limit := p_global_limit;

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_success_count, v_success_reserved
  from private.ai_user_daily_usage
  where user_id = p_user_id and usage_day = v_day;
  if not found then
    v_success_count := 0;
    v_success_reserved := 0;
  end if;

  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_attempt_sent, v_attempt_reserved
  from private.ai_user_daily_external_attempts
  where user_id = p_user_id and usage_day = v_day;
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
  v_success_remaining := greatest(5 - v_success_consumed, 0);
  v_attempt_remaining := greatest(12 - v_attempt_used, 0);
  v_window_remaining := greatest(4 - v_window_sent, 0);
  v_global_available := (v_global_sent + v_global_reserved) < v_global_limit;

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
      'consumed', v_success_consumed,
      'limit', 5,
      'remaining', v_success_remaining
    ),
    'attempts', jsonb_build_object(
      'sent', v_attempt_used,
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

revoke all on function public.get_ai_usage_today(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_today(uuid, timestamptz, integer) to service_role;

-- ---------------------------------------------------------------------------
-- I-5: free-form フィードバック本文を 30 日で削除（他台帳と同じ保持方針）
-- ---------------------------------------------------------------------------
create or replace function private.cleanup_user_feedback(
  p_before timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  deleted_count integer;
begin
  if p_before is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  with doomed as (
    select id
    from public.user_feedback
    where created_at < p_before
    order by created_at asc, id asc
    limit p_limit
    for update skip locked
  )
  delete from public.user_feedback feedback
  using doomed
  where feedback.id = doomed.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.cleanup_user_feedback(timestamptz, integer)
  from public, anon, authenticated, service_role, kondate_maintenance_executor;
-- バッチ本体は SECURITY DEFINER の run_kondate_maintenance 経由のみ（個別 EXECUTE 無し）

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
  v_before timestamptz;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  v_before := p_now - interval '30 days';

  v_stale := public.cleanup_stale_ai_generations_batch(p_now, p_limit);
  v_ledgers := public.cleanup_ai_generation_requests_batch(v_before, p_limit);
  v_shopping := private.cleanup_shopping_mutations(v_before, p_limit);
  v_auth := public.cleanup_auth_continuations_batch(p_now, p_limit);
  v_feedback := private.cleanup_user_feedback(v_before, p_limit);

  return jsonb_build_object(
    'staleReservationsFinalized', v_stale,
    'generationLedgersDeleted', v_ledgers,
    'shoppingMutationsDeleted', v_shopping,
    'authContinuationsDeleted', v_auth,
    'userFeedbackDeleted', v_feedback
  );
end;
$function$;

revoke all on function public.run_kondate_maintenance(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_kondate_maintenance(timestamptz, integer)
  to kondate_maintenance_executor;
