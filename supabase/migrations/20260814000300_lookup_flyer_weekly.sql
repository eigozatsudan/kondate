-- PE2: Plus / kill switch 短絡でも既 terminal succeeded を再生するため、
-- 新規 reserve しない read-only lookup を追加する。miss は行を作らない。
-- GRANT は service_role のみ（reserve_flyer_weekly と同型）。

create or replace function public.lookup_flyer_weekly(
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request private.flyer_weekly_requests;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) < 1
     or char_length(p_idempotency_key) > 128 then
    raise exception using errcode = '22023', message = 'invalid_idempotency_key';
  end if;

  select * into v_request
  from private.flyer_weekly_requests
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key;
  if not found then
    return pg_catalog.jsonb_build_object('kind', 'miss');
  end if;

  return private.flyer_weekly_request_payload(v_request, true)
    || pg_catalog.jsonb_build_object('kind', 'hit');
end;
$function$;

revoke all on function public.lookup_flyer_weekly(uuid, text)
  from public, anon, authenticated;
grant execute on function public.lookup_flyer_weekly(uuid, text)
  to service_role;
