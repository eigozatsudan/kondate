-- supabase/migrations/20260903121000_weekly_plan_intents.sql
-- sticky 再生と insert 再試行で「当時の条件」を body に頼らず復元するための AI 制御テーブル。
-- private schema に置き、PostgREST の露出スキーマ（public,graphql_public）には出さない。
-- 表 GRANT は付けない（service_role にも付けない）。SECURITY DEFINER RPC 3 本だけが触る。

create table private.weekly_plan_intents (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  preference_snapshot jsonb not null,
  safety_fingerprint text not null check (safety_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create or replace function public.put_weekly_plan_intent(
  p_request_id uuid,
  p_user_id uuid,
  p_snapshot jsonb,
  p_fingerprint text
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_fingerprint';
  end if;
  insert into private.weekly_plan_intents (request_id, user_id, preference_snapshot, safety_fingerprint)
  values (p_request_id, p_user_id, p_snapshot, p_fingerprint)
  on conflict (request_id) do update
    set user_id = excluded.user_id,
        preference_snapshot = excluded.preference_snapshot,
        safety_fingerprint = excluded.safety_fingerprint;
end;
$function$;

create or replace function public.get_weekly_plan_intent(
  p_request_id uuid,
  p_user_id uuid
) returns table (
  request_id uuid,
  user_id uuid,
  preference_snapshot jsonb,
  safety_fingerprint text,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select request_id, user_id, preference_snapshot, safety_fingerprint, created_at
  from private.weekly_plan_intents
  where request_id = p_request_id and user_id = p_user_id;
$function$;

create or replace function public.delete_weekly_plan_intent(
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from private.weekly_plan_intents where request_id = p_request_id;
end;
$function$;

revoke all on function public.put_weekly_plan_intent(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.put_weekly_plan_intent(uuid, uuid, jsonb, text) to service_role;

revoke all on function public.get_weekly_plan_intent(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_weekly_plan_intent(uuid, uuid) to service_role;

revoke all on function public.delete_weekly_plan_intent(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_weekly_plan_intent(uuid) to service_role;
