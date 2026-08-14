-- PE11: finalize 失敗時に processing + reserved のまま 200 すると、
-- 180s cleanup が reserved を解放し success_count を踏まず週次 200 を繰り返せる。
-- 検証済み本文を stash し、finalize は reserved→success を fail-closed に確定する。
-- stale cleanup は本文がある行を解放せず succeeded に promote する。

create or replace function public.stash_flyer_weekly_result(
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
  if p_request_id is null or p_result is null then
    raise exception using errcode = '22023', message = 'invalid_flyer_stash';
  end if;

  select * into v_request
  from private.flyer_weekly_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'flyer_request_not_processing';
  end if;

  -- 既 terminal の本文は壊さない。processing だけ stash する。
  if v_request.status = 'succeeded' then
    return private.flyer_weekly_request_payload(v_request, true);
  end if;
  if v_request.status <> 'processing' then
    raise exception using errcode = '55000', message = 'flyer_request_not_processing';
  end if;

  update private.flyer_weekly_requests
  set result_payload = p_result,
      updated_at = p_now
  where id = p_request_id
  returning * into v_request;

  return private.flyer_weekly_request_payload(v_request, false);
end;
$function$;

revoke all on function public.stash_flyer_weekly_result(uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.stash_flyer_weekly_result(uuid, jsonb, timestamptz)
  to service_role;

-- finalize: 既 succeeded は再加算しない。reserved=0 でも success 枠を消費する。
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
  if not found then
    raise exception using errcode = '55000', message = 'flyer_request_not_processing';
  end if;

  -- 同一キー再入場: 既に reserved→success 済みなら再加算しない。
  if v_request.status = 'succeeded' then
    return private.flyer_weekly_request_payload(v_request, true);
  end if;

  if v_request.status <> 'processing' then
    raise exception using errcode = '55000', message = 'flyer_request_not_processing';
  end if;

  if v_request.flyer_success_reserved then
    -- reserved>0 なら reserved→success。reserved=0（corrupt / cleanup 前解放）でも
    -- 上限未満なら success を足し、cleanup が枠を空ける穴を閉じる。
    update private.ai_identity_flyer_weekly
    set reserved_count = case when reserved_count > 0 then reserved_count - 1 else 0 end,
        success_count = success_count + 1,
        updated_at = p_now
    where identity_key = v_request.identity_key
      and week_start = v_request.week_start
      and (
        reserved_count > 0
        or reserved_count + success_count < 2
      );
    if not found then
      -- 台帳行が無いときだけ success=1 を作る。既に上限なら加算しない。
      insert into private.ai_identity_flyer_weekly (
        identity_key, week_start, reserved_count, success_count, updated_at
      ) values (
        v_request.identity_key, v_request.week_start, 0, 1, p_now
      )
      on conflict (identity_key, week_start) do nothing;
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
    if v_row.result_payload is not null then
      -- PE11: 検証済み本文がある stale は reserved を解放せず success に確定する。
      begin
        perform public.finalize_flyer_weekly_success(v_row.id, v_row.result_payload, p_now);
      exception
        when others then
          -- promote 失敗でも reserved は解放しない（枠を空けて 200 再入場させない）。
          null;
      end;
    else
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
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.cleanup_stale_flyer_weekly_batch(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_flyer_weekly_batch(timestamptz, integer)
  to service_role;
