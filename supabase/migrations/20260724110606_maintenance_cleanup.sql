-- Plan 6 Task 8: 時間メンテナンス用の境界付きバッチ RPC と
-- NOLOGIN 実行ロール。LOGIN / パスワードはマイグレーションに含めない
-- （scripts/provision-maintenance-role.sh がホスト側 Compose 経由で用意する）。
--
-- 既存の service-role 互換ラッパはそのまま残し、スケジューラ専用の
-- *_batch / cleanup_shopping_mutations を別シグネチャで追加する。
-- cleanup_ai_generation_requests(timestamptz,uuid) への (timestamptz,integer)
-- オーバーロードは曖昧解決を起こすため禁止し、_batch 名を使う。
--
-- private.cleanup_expired_shopping_mutations(uuid,integer) はリクエスト経路
-- の per-user 掃除、private.cleanup_shopping_mutations(timestamptz,integer)
-- は時間スイープ。30 日境界（未満のみ削除）は両者で一致させる。
-- generation_regeneration_snapshots は第5カテゴリにせず、終端台帳削除の
-- ON DELETE CASCADE で暗黙に消える。

-- ---------------------------------------------------------------------------
-- 1. 境界付きバッチ: stale processing 予約の正規遷移
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_stale_ai_generations_batch(
  p_now timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request private.ai_generation_requests;
  v_count integer := 0;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  for v_request in
    select *
    from private.ai_generation_requests
    where status = 'processing'
      and processing_expires_at <= p_now
    order by processing_expires_at, id
    for update skip locked
    limit p_limit
  loop
    if v_request.user_quota_reserved then
      update private.ai_user_daily_usage
      set reserved_count = greatest(reserved_count - 1, 0),
          updated_at = p_now
      where user_id = v_request.user_id
        and usage_day = v_request.user_usage_day;
    end if;
    -- 未送信 attempt 予約だけを返却する（送信済みは返さない）
    if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
      update private.ai_user_daily_external_attempts
      set reserved_count = greatest(reserved_count - 1, 0),
          updated_at = p_now
      where user_id = v_request.user_id
        and usage_day = v_request.user_attempt_day;
    end if;
    if v_request.global_reserved_day is not null then
      update private.ai_global_daily_usage
      set reserved_count = greatest(reserved_count - 1, 0),
          updated_at = p_now
      where usage_day = v_request.global_reserved_day;
    end if;
    update private.ai_generation_requests set
      status = 'failed',
      failure_code = 'generation_timeout',
      user_quota_reserved = false,
      user_attempt_reserved = false,
      user_attempt_day = null,
      global_reserved_day = null,
      retry_at = p_now,
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

-- 既存 1 引数ラッパ: 呼び出し側を壊さないよう同一遷移を固定上限で委譲する
create or replace function public.cleanup_stale_ai_generations(
  p_now timestamptz default clock_timestamp()
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  return public.cleanup_stale_ai_generations_batch(p_now, 250);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. 終端生成台帳の境界付き削除（completed_at 基準・menu 参照は残す）
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_ai_generation_requests_batch(
  p_before timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if p_before is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  with locked as (
    select candidate.ctid
    from private.ai_generation_requests candidate
    where candidate.status in ('succeeded', 'failed', 'constraint_conflict')
      and candidate.completed_at is not null
      and candidate.completed_at < p_before
      and not exists (
        select 1
        from public.menus menu
        where menu.id = candidate.completed_menu_id
      )
    order by candidate.completed_at, candidate.id
    for update of candidate skip locked
    limit p_limit
  )
  delete from private.ai_generation_requests request
  using locked
  where request.ctid = locked.ctid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- 既存 (timestamptz, uuid) は触らない（opportunistic / service_role 経路）

-- ---------------------------------------------------------------------------
-- 3. 買い物 mutation 台帳のアカウント横断スイープ
--    private.cleanup_expired_shopping_mutations はリクエスト経路専用のまま
-- ---------------------------------------------------------------------------
create or replace function private.cleanup_shopping_mutations(
  p_before timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if p_before is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  with locked as (
    select candidate.ctid
    from private.shopping_mutations candidate
    where candidate.created_at < p_before
    order by candidate.created_at, candidate.user_id, candidate.idempotency_key
    for update of candidate skip locked
    limit p_limit
  )
  delete from private.shopping_mutations target
  using locked
  where target.ctid = locked.ctid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. auth continuation: 期限切れのみ（claimed でも expires_at 経過で削除）
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_auth_continuations_batch(
  p_now timestamptz,
  p_limit integer
) returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  deleted_count bigint;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  with locked as (
    select candidate.ctid
    from private.auth_continuations candidate
    where candidate.expires_at <= p_now
    order by candidate.expires_at, candidate.id
    for update of candidate skip locked
    limit p_limit
  )
  delete from private.auth_continuations continuation
  using locked
  where continuation.ctid = locked.ctid;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

-- 既存 1 引数ラッパは期限切れのみ・上限 100 の意味を維持する
create or replace function public.cleanup_auth_continuations(p_now timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare deleted_count bigint;
begin
  with expired as (
    select id
    from private.auth_continuations
    where expires_at <= p_now
    order by expires_at, id
    limit 100
  )
  delete from private.auth_continuations continuation
  using expired
  where continuation.id = expired.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. 単一エントリ RPC: 4 カテゴリ固定順・最大 250 行/カテゴリ
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

  return jsonb_build_object(
    'staleReservationsFinalized', v_stale,
    'generationLedgersDeleted', v_ledgers,
    'shoppingMutationsDeleted', v_shopping,
    'authContinuationsDeleted', v_auth
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. NOLOGIN 実行ロールと最小権限
-- ---------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kondate_maintenance_executor') then
    create role kondate_maintenance_executor
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  else
    alter role kondate_maintenance_executor
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end;
$role$;

revoke all on function public.run_kondate_maintenance(timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_stale_ai_generations_batch(timestamptz, integer)
  from public, anon, authenticated, service_role, kondate_maintenance_executor;
revoke all on function public.cleanup_ai_generation_requests_batch(timestamptz, integer)
  from public, anon, authenticated, service_role, kondate_maintenance_executor;
revoke all on function public.cleanup_auth_continuations_batch(timestamptz, integer)
  from public, anon, authenticated, service_role, kondate_maintenance_executor;
revoke all on function private.cleanup_shopping_mutations(timestamptz, integer)
  from public, anon, authenticated, service_role, kondate_maintenance_executor;
revoke all on function private.cleanup_expired_shopping_mutations(uuid, integer)
  from kondate_maintenance_executor;
revoke all on function public.cleanup_stale_ai_generations(timestamptz)
  from kondate_maintenance_executor;
revoke all on function public.cleanup_ai_generation_requests(timestamptz, uuid)
  from kondate_maintenance_executor;
revoke all on function public.cleanup_auth_continuations(timestamptz)
  from kondate_maintenance_executor;

grant usage on schema public to kondate_maintenance_executor;
grant execute on function public.run_kondate_maintenance(timestamptz, integer)
  to kondate_maintenance_executor;

-- バッチヘルパは SECURITY DEFINER の run_kondate_maintenance 経由のみ
-- （executor に個別 EXECUTE は付けない）
revoke all on schema private from kondate_maintenance_executor;

-- 既存互換ラッパの service_role 権限は維持
grant execute on function public.cleanup_stale_ai_generations(timestamptz)
  to service_role;
grant execute on function public.cleanup_ai_generation_requests(timestamptz, uuid)
  to service_role;
grant execute on function public.cleanup_auth_continuations(timestamptz)
  to service_role;
