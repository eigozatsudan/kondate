-- get_ai_usage_today: 台帳 0 行時の SELECT INTO が変数を NULL 上書きする不具合を修正する。
--
-- PL/pgSQL では SELECT INTO が 0 行だと、宣言時の `:= 0` を破棄して対象を NULL にする。
-- その結果 consumed/sent が null、remaining が誤って 0、globalAvailable が null になり、
-- usageTodayDataSchema が reject → GET /api/usage/today が 500 になっていた。
-- get_ai_generation_status と同じ `if not found then … := 0` で空台帳を 0 消費として扱う。

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
  -- usageTodayDataSchema は consumed+remaining===limit / sent+remaining===limit を要求する
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
begin
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

  -- reserved もスロット占有として consumed/sent に含め、スキーマ balance を保つ
  v_success_consumed := v_success_count + v_success_reserved;
  v_attempt_used := v_attempt_sent + v_attempt_reserved;
  v_success_remaining := greatest(5 - v_success_consumed, 0);
  v_attempt_remaining := greatest(12 - v_attempt_used, 0);
  -- shortWindow は markSent 後の sent のみ（予約中は未計上）
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

-- CREATE OR REPLACE は権限を保持するが、service_role 専用契約を再固定する
revoke all on function public.get_ai_usage_today(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_today(uuid, timestamptz) to service_role;
