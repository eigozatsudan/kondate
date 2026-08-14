-- AP1: アカウント削除の user 単位ロック（並行 DELETE の cancel/deleteUser 二重実行を防ぐ）
-- AP3: フィードバックの短窓 content 冪等（同一 category+body の dual-tab 二重 insert を閉じる）

-- ---------------------------------------------------------------------------
-- AP1: account delete lock（billing_checkout_locks と同型・TTL 付き）
-- ---------------------------------------------------------------------------
create table private.account_delete_locks (
  user_id uuid primary key
    references auth.users (id) on delete cascade,
  lock_token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.account_delete_locks
  from public, anon, authenticated, service_role;

create or replace function public.acquire_account_delete_lock(
  p_user_id uuid,
  p_lock_token text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_existing private.account_delete_locks%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null
     or p_lock_token is null
     or length(trim(p_lock_token)) = 0
     or p_expires_at is null then
    raise exception using errcode = '22023', message = 'invalid_account_delete_lock';
  end if;

  select * into v_existing
  from private.account_delete_locks
  where user_id = p_user_id
  for update;

  if found then
    if v_existing.expires_at > v_now then
      return jsonb_build_object(
        'ok', false,
        'failure_code', 'account_delete_in_progress'
      );
    end if;
    delete from private.account_delete_locks where user_id = p_user_id;
  end if;

  begin
    insert into private.account_delete_locks (
      user_id, lock_token, expires_at, created_at
    ) values (
      p_user_id, p_lock_token, p_expires_at, v_now
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'failure_code', 'account_delete_in_progress'
      );
  end;

  return jsonb_build_object('ok', true, 'lock_token', p_lock_token);
end;
$function$;

revoke all on function public.acquire_account_delete_lock(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.acquire_account_delete_lock(uuid, text, timestamptz)
  to service_role;

create or replace function public.release_account_delete_lock(
  p_user_id uuid,
  p_lock_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.account_delete_locks%rowtype;
begin
  if p_user_id is null
     or p_lock_token is null
     or length(trim(p_lock_token)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_account_delete_lock_release';
  end if;

  select * into v_row
  from private.account_delete_locks
  where user_id = p_user_id
  for update;

  if not found then
    -- 成功後 CASCADE 済み / 既解放は idempotent ok
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  if v_row.lock_token is distinct from p_lock_token then
    return jsonb_build_object('ok', false, 'failure_code', 'account_delete_lock_mismatch');
  end if;

  delete from private.account_delete_locks where user_id = p_user_id;
  return jsonb_build_object('ok', true, 'released', true);
end;
$function$;

revoke all on function public.release_account_delete_lock(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_account_delete_lock(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- AP3: 同一 category+body の短窓冪等（advisory lock 下で既存行を返す）
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
  -- dual-tab 同時 POST 用の短窓（rate 窓より短い。本文完全一致のみ）
  v_idempotency_since timestamptz;
begin
  if p_limit is null or p_limit < 1 then
    raise exception using errcode = '22023', message = 'invalid_feedback_limit';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception using errcode = '22023', message = 'invalid_feedback_window';
  end if;

  v_since := clock_timestamp() - make_interval(secs => p_window_seconds);
  -- 5 分: sticky 前 dual-tab を閉じつつ、意図的再送（文言変更なし）を過度に封じない
  v_idempotency_since := clock_timestamp() - interval '5 minutes';

  -- save_generation_draft は hashtextextended(user_id, 0)。feedback 専用 prefix。
  perform pg_advisory_xact_lock(
    hashtextextended('user_feedback:' || p_user_id::text, 0)
  );

  -- AP3: 同一 category+body が短窓内にあれば既存 id を返す（201 相当の冪等）
  select id into v_id
  from public.user_feedback
  where user_id = p_user_id
    and category = p_category
    and body = p_body
    and created_at >= v_idempotency_since
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object('ok', true, 'id', v_id, 'deduped', true);
  end if;

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
