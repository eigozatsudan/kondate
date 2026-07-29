-- Task 8 residual: account delete 時に flyer weekly reserved を解放する
-- identity/global の release_identity_and_global_for_user_processing と同型。
-- success/sent は残し、reserved のみ戻す。Auth CASCADE 前に呼ぶ想定 + BEFORE DELETE 二重経路。

-- ---------------------------------------------------------------------------
-- 1. bulk release for processing flyer requests (delete-account 用)
-- ---------------------------------------------------------------------------
create or replace function private.release_flyer_weekly_for_user_processing(
  p_user_id uuid,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request private.flyer_weekly_requests;
  v_count integer := 0;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  for v_request in
    select *
    from private.flyer_weekly_requests
    where user_id = p_user_id
      and status = 'processing'
    order by started_at, id
    for update
  loop
    -- 未送信 reserved を台帳へ返却（try sent 済みは返さない）
    perform private.release_flyer_weekly_reservations(v_request, p_now);
    update private.flyer_weekly_requests set
      status = 'failed',
      failure_code = 'account_deleted',
      flyer_success_reserved = false,
      flyer_try_reserved = false,
      user_attempt_reserved = false,
      user_attempt_day = null,
      global_reserved_day = null,
      retry_at = null,
      completed_at = p_now,
      updated_at = p_now,
      duration_ms = greatest(
        0,
        floor(extract(epoch from (p_now - started_at)) * 1000)::integer
      )
    where id = v_request.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

create or replace function public.release_flyer_weekly_for_user_processing(
  p_user_id uuid,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return private.release_flyer_weekly_for_user_processing(p_user_id, p_now);
end;
$function$;

revoke all on function public.release_flyer_weekly_for_user_processing(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_flyer_weekly_for_user_processing(uuid, timestamptz)
  to service_role;

revoke all on function private.release_flyer_weekly_for_user_processing(uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. BEFORE DELETE: Auth CASCADE でも reserved orphan を防ぐ第二経路
-- ---------------------------------------------------------------------------
create or replace function private.trg_flyer_weekly_requests_before_delete_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'processing'
     and (
       old.flyer_success_reserved
       or old.flyer_try_reserved
       or old.user_attempt_reserved
       or old.global_reserved_day is not null
     ) then
    perform private.release_flyer_weekly_reservations(old, pg_catalog.clock_timestamp());
  end if;
  return old;
end;
$function$;

drop trigger if exists flyer_weekly_requests_before_delete_release
  on private.flyer_weekly_requests;
create trigger flyer_weekly_requests_before_delete_release
  before delete on private.flyer_weekly_requests
  for each row
  execute function private.trg_flyer_weekly_requests_before_delete_release();

revoke all on function private.trg_flyer_weekly_requests_before_delete_release()
  from public, anon, authenticated, service_role;
