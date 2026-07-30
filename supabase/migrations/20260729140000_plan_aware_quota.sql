-- Plan: 2026-07-29 paid-plan-stripe Task 3
-- Plan-aware quota: CHECK 10/20/8, reserve/status/usage args, request snapshots.
-- global 上限は ENV のみ（SQL の p_global_limit 範囲拒否はしない）。
-- short window は mark-time のみ（A1）。entitlement 再読なし。quality_mode は Task6。

-- ---------------------------------------------------------------------------
-- 1. Identity / short CHECK 拡張（discovery drop → named re-add）
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname, t.relname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private'
      and t.relname in ('ai_identity_daily_usage', 'ai_identity_daily_external_attempts')
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%reserved_count%success_count%'
        or pg_get_constraintdef(c.oid) ilike '%reserved_count%sent_count%'
      )
  loop
    execute format(
      'alter table private.%I drop constraint %I',
      r.relname, r.conname
    );
  end loop;
end $$;

alter table private.ai_identity_daily_usage
  add constraint ai_identity_daily_usage_quota_check
    check (reserved_count + success_count <= 10);

alter table private.ai_identity_daily_external_attempts
  add constraint ai_identity_daily_external_attempts_quota_check
    check (reserved_count + sent_count <= 20);

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private' and t.relname = 'ai_user_rate_windows'
      and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%sent_count%'
  loop
    execute format('alter table private.ai_user_rate_windows drop constraint %I', r.conname);
  end loop;
end $$;

alter table private.ai_user_rate_windows
  add constraint ai_user_rate_windows_sent_count_check
    check (sent_count >= 0 and sent_count <= 8);

-- ---------------------------------------------------------------------------
-- 2. Request スナップショット列（Free 既定）
-- ---------------------------------------------------------------------------
alter table private.ai_generation_requests
  add column if not exists quota_success_limit integer not null default 3
    check (quota_success_limit in (3, 10)),
  add column if not exists quota_attempt_limit integer not null default 6
    check (quota_attempt_limit in (6, 20)),
  add column if not exists quota_short_limit integer not null default 4
    check (quota_short_limit in (4, 8));

-- ---------------------------------------------------------------------------
-- 3. Drop old signatures（overload 回避）
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, text,
  integer, integer, boolean, integer, timestamptz
);
drop function if exists public.get_ai_usage_today(uuid, text, timestamptz, integer);
drop function if exists public.get_ai_generation_status(uuid, uuid, integer, text, timestamptz);

-- ---------------------------------------------------------------------------
-- 4. reserve_ai_generation（plan-aware）
-- ---------------------------------------------------------------------------

create or replace function public.reserve_ai_generation(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_request_kind text,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_source_menu_id uuid,
  p_replace_dish_id uuid,
  p_change_reason text,
  p_request_hmac_version text,
  p_request_hmac text,
  p_integrity_context jsonb,
  p_identity_key text,
  p_user_limit integer,
  p_attempt_limit integer,
  p_short_window_limit integer,
  p_global_limit integer,
  p_quota_disabled boolean default false,
  p_stale_after_seconds integer default 180,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_day date := private.ai_jst_day(p_now);
  v_request private.ai_generation_requests;
  v_active private.ai_generation_requests;
  v_draft public.generation_drafts;
  v_menu public.menus;
  v_user private.ai_identity_daily_usage;
  v_global private.ai_global_daily_usage;
  v_attempts private.ai_identity_daily_external_attempts;
  v_member_ids uuid[];
  v_expected_mode text;
  v_expected_servings integer;
  v_expected_source_version integer;
  v_dish_id uuid;
  v_quota_disabled boolean := coalesce(p_quota_disabled, false);
  v_remaining integer;
begin
  if p_identity_key is null or p_identity_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_identity_key';
  end if;
  if p_request_hmac_version is distinct from 'generation-command.v2'
     or p_request_hmac is null
     or p_request_hmac !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_request_hmac';
  end if;
  if p_user_limit is null or p_user_limit not in (3, 10)
     or p_attempt_limit is null or p_attempt_limit not in (6, 20)
     or p_short_window_limit is null or p_short_window_limit not in (4, 8) then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  -- p_global_limit の範囲は ENV のみが正本。SQL では拒否しない。
  if p_stale_after_seconds < 30 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  if p_request_kind not in ('new_menu', 'regenerate_menu', 'regenerate_dish') then
    raise exception using errcode = '22023', message = 'invalid_request_kind';
  end if;
  if not private.is_valid_generation_integrity_context(p_integrity_context, p_request_kind) then
    raise exception using errcode = '22023', message = 'invalid_integrity_context';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_request from private.ai_generation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hmac_version is distinct from p_request_hmac_version
       or v_request.request_hmac is distinct from p_request_hmac then
      raise exception using errcode = '22023', message = 'idempotency_payload_mismatch';
    end if;
    return private.ai_request_payload(v_request, true);
  end if;

  if p_request_kind = 'new_menu' then
    if p_source_menu_id is not null or p_replace_dish_id is not null
       or p_change_reason is not null then
      raise exception using errcode = '22023', message = 'invalid_request_kind';
    end if;
    select * into v_draft
    from public.generation_drafts
    where id = p_draft_id and user_id = p_user_id and revision = p_draft_revision
      and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'draft_unavailable';
    end if;
    if v_draft.target_mode is null
       or v_draft.target_mode is distinct from (p_integrity_context->>'target_mode') then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;
    if v_draft.target_mode = 'household' then
      if v_draft.servings is not null
         or p_integrity_context->'servings' is distinct from 'null'::jsonb then
        raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
      end if;
    else
      if v_draft.servings is distinct from (p_integrity_context->>'servings')::integer then
        raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
      end if;
    end if;
    if v_draft.target_member_ids is distinct from (
      select coalesce(
        (
          select pg_catalog.array_agg(elem::uuid order by ordinality)
          from pg_catalog.jsonb_array_elements_text(p_integrity_context->'target_member_ids')
            with ordinality as elements(elem, ordinality)
        ),
        array[]::uuid[]
      )
    ) then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;
    if not private.is_valid_generation_target_member_ids(
      v_draft.target_member_ids, v_draft.target_mode
    ) then
      raise exception using errcode = '22023', message = 'invalid_integrity_context';
    end if;
    insert into private.generation_draft_submission_versions(
      draft_id, user_id, draft_revision, meal_type, main_ingredients, cuisine_genre,
      target_mode, target_member_ids, servings, time_limit_minutes, budget_preference,
      avoid_ingredients, memo, pantry_selections, captured_at
    ) values (
      v_draft.id, v_draft.user_id, v_draft.revision, v_draft.meal_type,
      v_draft.main_ingredients, v_draft.cuisine_genre,
      v_draft.target_mode, v_draft.target_member_ids, v_draft.servings,
      v_draft.time_limit_minutes, v_draft.budget_preference,
      v_draft.avoid_ingredients, v_draft.memo, v_draft.pantry_selections, p_now
    ) on conflict (draft_id, user_id, draft_revision) do nothing;
  else
    if p_draft_id is not null or p_draft_revision is not null then
      raise exception using errcode = '22023', message = 'invalid_draft_reference';
    end if;
    if p_source_menu_id is null then
      raise exception using errcode = 'P0002', message = 'source_menu_not_found';
    end if;
    select * into v_menu
    from public.menus
    where id = p_source_menu_id and user_id = p_user_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'source_menu_not_found';
    end if;
    v_expected_mode := p_integrity_context->>'target_mode';
    v_expected_servings := (p_integrity_context->>'servings')::integer;
    v_expected_source_version := (p_integrity_context->>'source_menu_version')::integer;
    if v_menu.target_mode is distinct from v_expected_mode
       or v_menu.servings is distinct from v_expected_servings
       or v_menu.version is distinct from v_expected_source_version then
      raise exception using errcode = 'P0001', message = 'source_menu_changed';
    end if;

    select coalesce(
      (
        select pg_catalog.array_agg(mid order by mid)
        from (
          select mtm.household_member_id as mid
          from public.menu_target_members mtm
          where mtm.menu_id = v_menu.id and mtm.user_id = p_user_id
        ) members
      ),
      array[]::uuid[]
    ) into v_member_ids;
    if v_member_ids is distinct from (
      select coalesce(
        (
          select pg_catalog.array_agg(mid order by mid)
          from (
            select elem::uuid as mid
            from pg_catalog.jsonb_array_elements_text(p_integrity_context->'target_member_ids')
              as elements(elem)
          ) payload
        ),
        array[]::uuid[]
      )
    ) then
      raise exception using errcode = 'P0001', message = 'source_menu_changed';
    end if;

    if p_request_kind = 'regenerate_dish' then
      if p_replace_dish_id is null then
        raise exception using errcode = 'P0002', message = 'replace_dish_not_found';
      end if;
      select d.id into v_dish_id
      from public.dishes d
      where d.id = p_replace_dish_id
        and d.menu_id = p_source_menu_id
        and d.user_id = p_user_id;
      if v_dish_id is null then
        raise exception using errcode = 'P0002', message = 'replace_dish_not_found';
      end if;
    elsif p_replace_dish_id is not null then
      raise exception using errcode = '22023', message = 'invalid_request_kind';
    end if;
  end if;

  perform public.cleanup_stale_ai_generations(p_now);

  select * into v_active from private.ai_generation_requests
  where user_id = p_user_id and status = 'processing';
  if found then
    if not v_quota_disabled then
      select * into v_user from private.ai_identity_daily_usage
      where identity_key = p_identity_key and usage_day = v_day;
    end if;
    v_remaining := case
      when v_quota_disabled then p_user_limit
      else greatest(
        p_user_limit
          - coalesce(v_user.success_count, 0)
          - coalesce(v_user.reserved_count, 0),
        0
      )
    end;
    return pg_catalog.jsonb_build_object(
      'request_id', v_active.id,
      'idempotency_key', p_idempotency_key,
      'status', 'failed',
      'failure_code', 'generation_in_progress',
      'retry_at', v_active.processing_expires_at,
      'processing_expires_at', v_active.processing_expires_at,
      'completed_menu_id', null,
      'started_at', v_active.started_at,
      'completed_at', p_now,
      'remaining', v_remaining,
      'user_daily_limit', p_user_limit,
      'consumed', false,
      'replayed', false
    );
  end if;

  if not v_quota_disabled then
    insert into private.ai_identity_daily_usage(identity_key, usage_day)
    values (p_identity_key, v_day) on conflict do nothing;
    insert into private.ai_identity_daily_external_attempts(identity_key, usage_day)
    values (p_identity_key, v_day) on conflict do nothing;
  end if;
  insert into private.ai_global_daily_usage(usage_day)
  values (v_day) on conflict do nothing;

  if not v_quota_disabled then
    select * into v_user from private.ai_identity_daily_usage
      where identity_key = p_identity_key and usage_day = v_day for update;
    select * into v_attempts from private.ai_identity_daily_external_attempts
      where identity_key = p_identity_key and usage_day = v_day for update;
  end if;
  select * into v_global from private.ai_global_daily_usage
    where usage_day = v_day for update;

  if not v_quota_disabled and v_user.success_count + v_user.reserved_count >= p_user_limit then
    insert into private.ai_generation_requests(
      user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
      draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      quota_success_limit, quota_attempt_limit, quota_short_limit,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_identity_key, false, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit,
      v_day, 'user_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if not v_quota_disabled and v_attempts.reserved_count + v_attempts.sent_count >= p_attempt_limit then
    insert into private.ai_generation_requests(
      user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
      draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      quota_success_limit, quota_attempt_limit, quota_short_limit,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_identity_key, false, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit,
      v_day, 'user_attempt_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if v_global.sent_count + v_global.reserved_count >= p_global_limit then
    insert into private.ai_generation_requests(
      user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
      draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      quota_success_limit, quota_attempt_limit, quota_short_limit,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_identity_key, v_quota_disabled, p_idempotency_key, p_request_kind, 'failed',
      p_draft_id, p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit,
      v_day, 'global_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  begin
    if not v_quota_disabled then
      update private.ai_identity_daily_usage
      set reserved_count = reserved_count + 1, updated_at = p_now
      where identity_key = p_identity_key and usage_day = v_day;
      update private.ai_identity_daily_external_attempts
      set reserved_count = reserved_count + 1, updated_at = p_now
      where identity_key = p_identity_key and usage_day = v_day;
    end if;
    update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
    where usage_day = v_day;

    insert into private.ai_generation_requests(
      user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
      draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      quota_success_limit, quota_attempt_limit, quota_short_limit,
      user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
      global_reserved_day, processing_expires_at, started_at
    ) values (
      p_user_id, p_identity_key, v_quota_disabled, p_idempotency_key, p_request_kind, 'processing',
      p_draft_id, p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit,
      v_day,
      (not v_quota_disabled),
      (not v_quota_disabled),
      case when v_quota_disabled then null else v_day end,
      v_day, p_now + pg_catalog.make_interval(secs => p_stale_after_seconds), p_now
    ) returning * into v_request;

    if p_request_kind in ('regenerate_menu', 'regenerate_dish') then
      insert into private.generation_regeneration_snapshots(
        request_id, user_id, kind, source_menu_id, source_menu_version,
        replace_dish_id, target_mode, servings, target_member_ids, created_at
      ) values (
        v_request.id, p_user_id, p_request_kind, p_source_menu_id,
        (p_integrity_context->>'source_menu_version')::integer,
        p_replace_dish_id,
        p_integrity_context->>'target_mode',
        (p_integrity_context->>'servings')::integer,
        coalesce(
          (
            select pg_catalog.array_agg(elem::uuid order by ordinality)
            from pg_catalog.jsonb_array_elements_text(p_integrity_context->'target_member_ids')
              with ordinality as elements(elem, ordinality)
          ),
          array[]::uuid[]
        ),
        p_now
      );
    end if;
  exception
    when unique_violation then
      select * into v_active from private.ai_generation_requests
      where user_id = p_user_id and status = 'processing';
      if not v_quota_disabled then
        select * into v_user from private.ai_identity_daily_usage
        where identity_key = p_identity_key and usage_day = v_day;
      end if;
      v_remaining := case
        when v_quota_disabled then p_user_limit
        else greatest(
          p_user_limit
            - coalesce(v_user.success_count, 0)
            - coalesce(v_user.reserved_count, 0),
          0
        )
      end;
      return pg_catalog.jsonb_build_object(
        'request_id', coalesce(v_active.id, p_idempotency_key),
        'idempotency_key', p_idempotency_key,
        'status', 'failed',
        'failure_code', 'generation_in_progress',
        'retry_at', v_active.processing_expires_at,
        'processing_expires_at', v_active.processing_expires_at,
        'completed_menu_id', null,
        'started_at', coalesce(v_active.started_at, p_now),
        'completed_at', p_now,
        'remaining', v_remaining,
        'user_daily_limit', p_user_limit,
        'consumed', false,
        'replayed', false
      );
  end;

  perform public.cleanup_ai_generation_requests(
    p_now - interval '30 days',
    p_user_id
  );
  return private.ai_request_payload(v_request, false);
end;
$function$;

revoke all on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, text, integer, integer, integer, integer, boolean, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, text, integer, integer, integer, integer, boolean, integer, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. reserve_ai_repair_call（attempt snapshot。global 上限は ENV のみ）
-- ---------------------------------------------------------------------------
create or replace function public.reserve_ai_repair_call(
  p_request_id uuid,
  p_global_limit integer,
  p_quota_disabled boolean default false,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_request private.ai_generation_requests;
  v_usage private.ai_global_daily_usage;
  v_attempts private.ai_identity_daily_external_attempts;
  v_day date := private.ai_jst_day(p_now);
  v_quota_disabled boolean := coalesce(p_quota_disabled, false);
begin
  -- p_global_limit の範囲は ENV のみが正本。SQL では拒否しない。
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing' or v_request.repair_attempted
     or v_request.global_reserved_day is not null
     or v_request.user_attempt_reserved then
    raise exception using errcode = '55000', message = 'repair_not_available';
  end if;

  -- request に永続化された無効化を優先（引数はローカル gate の補助）
  v_quota_disabled := v_quota_disabled or v_request.personal_quota_disabled;

  insert into private.ai_global_daily_usage(usage_day) values (v_day) on conflict do nothing;
  if not v_quota_disabled then
    insert into private.ai_identity_daily_external_attempts(identity_key, usage_day)
    values (v_request.identity_key, v_day) on conflict do nothing;
  end if;
  select * into v_usage from private.ai_global_daily_usage where usage_day = v_day for update;
  if not v_quota_disabled then
    select * into v_attempts from private.ai_identity_daily_external_attempts
      where identity_key = v_request.identity_key and usage_day = v_day for update;
  end if;

  update private.ai_generation_requests set repair_attempted = true, updated_at = p_now
    where id = p_request_id;

  if not v_quota_disabled and v_attempts.reserved_count + v_attempts.sent_count >= coalesce(v_request.quota_attempt_limit, 6) then
    return jsonb_build_object(
      'reserved', false,
      'retry_at', private.ai_next_jst_midnight(p_now)
    );
  end if;
  if v_usage.sent_count + v_usage.reserved_count >= p_global_limit then
    return jsonb_build_object('reserved', false, 'retry_at', private.ai_next_jst_midnight(p_now));
  end if;
  update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
    where usage_day = v_day;
  if not v_quota_disabled then
    update private.ai_identity_daily_external_attempts
    set reserved_count = reserved_count + 1, updated_at = p_now
    where identity_key = v_request.identity_key and usage_day = v_day;
  end if;
  update private.ai_generation_requests
  set global_reserved_day = v_day,
      user_attempt_reserved = (not v_quota_disabled),
      user_attempt_day = case when v_quota_disabled then null else v_day end,
      updated_at = p_now
    where id = p_request_id;
  return jsonb_build_object('reserved', true, 'retry_at', null);
end;
$function$;

revoke all on function public.reserve_ai_repair_call(uuid, integer, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_repair_call(uuid, integer, boolean, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. get_ai_generation_status
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_generation_status(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_user_limit integer,
  p_attempt_limit integer,
  p_short_window_limit integer,
  p_identity_key text,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_request private.ai_generation_requests;
  v_success integer := 0;
  v_reserved integer := 0;
  v_day date := private.ai_jst_day(p_now);
begin
  if p_user_limit is null or p_user_limit not in (3, 10)
     or p_attempt_limit is null or p_attempt_limit not in (6, 20)
     or p_short_window_limit is null or p_short_window_limit not in (4, 8) then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  if p_identity_key is null or p_identity_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_identity_key';
  end if;
  perform public.cleanup_stale_ai_generations(p_now);
  select * into v_request from private.ai_generation_requests
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  select coalesce(success_count,0), coalesce(reserved_count,0) into v_success, v_reserved
    from private.ai_identity_daily_usage
    where identity_key = p_identity_key and usage_day = v_day;
  if not found then v_success := 0; v_reserved := 0; end if;
  if v_request.id is null then
    return jsonb_build_object('status','not_started','idempotency_key',p_idempotency_key,
      'remaining',greatest(p_user_limit-v_success-v_reserved,0),'user_daily_limit',p_user_limit,
      'consumed',false,'retry_at',null);
  end if;
  return private.ai_request_payload(v_request,false) || jsonb_build_object(
    'remaining',greatest(p_user_limit-v_success-v_reserved,0),
    'user_daily_limit',p_user_limit,'consumed',v_request.status='succeeded',
    'terminal_details',v_request.terminal_details,'actual_model_ids',v_request.actual_model_ids,
    'started_at',v_request.started_at,'completed_at',v_request.completed_at
  );
end;
$function$;

revoke all on function public.get_ai_generation_status(uuid, uuid, integer, integer, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_ai_generation_status(uuid, uuid, integer, integer, integer, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. get_ai_usage_today（plan limits 投影。plan/plusEntitled は返さない）
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
-- 8. mark_ai_global_sent（short は request.quota_short_limit スナップショット）
-- ---------------------------------------------------------------------------
create or replace function public.mark_ai_global_sent(
  p_request_id uuid, p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_request private.ai_generation_requests;
  v_window_started_at timestamptz;
  v_window private.ai_user_rate_windows;
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing'
     or v_request.global_reserved_day is null then
    raise exception using errcode = '55000', message = 'global_call_not_reserved';
  end if;

  -- personal 無効時は attempt 予約なし。通常時は attempt 予約必須
  if not v_request.personal_quota_disabled then
    if not v_request.user_attempt_reserved or v_request.user_attempt_day is null then
      raise exception using errcode = '55000', message = 'global_call_not_reserved';
    end if;
  end if;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from p_now) / 600.0) * 600.0
  );

  -- 個人枠無効時は短時間窓を検査しない
  if not v_request.personal_quota_disabled then
    insert into private.ai_user_rate_windows(user_id, window_started_at)
    values (v_request.user_id, v_window_started_at) on conflict do nothing;
    select * into v_window from private.ai_user_rate_windows
      where user_id = v_request.user_id and window_started_at = v_window_started_at
      for update;

    if v_window.sent_count >= coalesce(v_request.quota_short_limit, 4) then
      perform private.release_request_quota_reservations(v_request, p_now);
      update private.ai_generation_requests set
        status = 'failed',
        failure_code = 'user_short_window_limit',
        retry_at = v_window_started_at + interval '10 minutes',
        user_quota_reserved = false,
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
      return private.ai_request_payload(v_request, false)
        || jsonb_build_object('sent', false, 'code', 'user_short_window_limit');
    end if;
  end if;

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

    update private.ai_user_rate_windows
    set sent_count = sent_count + 1, updated_at = p_now
    where user_id = v_request.user_id and window_started_at = v_window_started_at;
  end if;

  update private.ai_generation_requests
  set global_reserved_day = null,
      user_attempt_reserved = false,
      user_attempt_day = null,
      global_sent_calls = global_sent_calls + 1,
      updated_at = p_now
  where id = p_request_id
  returning * into v_request;
  return private.ai_request_payload(v_request, false)
    || jsonb_build_object('sent', true);
end;
$function$;

revoke all on function public.mark_ai_global_sent(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_ai_global_sent(uuid, timestamptz)
  to service_role;
