-- Plan: 2026-07-29 paid-plan-stripe Task 6
-- Quality mode ledgers + generation-command.v3 DB cutover + atomic multi-ledger reserve.
-- L12: pre-prod truncate of in-flight requests (no dual-read of v2).

-- ---------------------------------------------------------------------------
-- 0. Truncate in-flight generation rows (L12)
-- ---------------------------------------------------------------------------
delete from private.generation_regeneration_snapshots;
delete from private.ai_generation_requests;

-- ---------------------------------------------------------------------------
-- 1. Quality ledgers
-- ---------------------------------------------------------------------------
create table private.ai_identity_quality_daily (
  identity_key text not null check (identity_key ~ '^[a-f0-9]{64}$'),
  usage_day date not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (identity_key, usage_day),
  check (reserved_count + success_count <= 3)
);

create table private.ai_identity_quality_monthly (
  identity_key text not null check (identity_key ~ '^[a-f0-9]{64}$'),
  usage_month date not null, -- JST 月初日
  reserved_count integer not null default 0 check (reserved_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (identity_key, usage_month),
  check (reserved_count + success_count <= 20),
  -- 月初日のみ（YYYY-MM-01）
  check (usage_month = date_trunc('month', usage_month::timestamp)::date)
);

revoke all on table private.ai_identity_quality_daily
  from public, anon, authenticated, service_role;
revoke all on table private.ai_identity_quality_monthly
  from public, anon, authenticated, service_role;

-- JST 月初日 helper
create or replace function private.ai_jst_month_start(p_now timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select date_trunc('month', (p_now at time zone 'Asia/Tokyo'))::date;
$$;

revoke all on function private.ai_jst_month_start(timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Request quality_mode snapshot + HMAC v3 CHECK
-- ---------------------------------------------------------------------------
alter table private.ai_generation_requests
  add column if not exists quality_mode boolean not null default false;

alter table private.ai_generation_requests
  drop constraint if exists ai_generation_requests_request_hmac_version_check;

alter table private.ai_generation_requests
  add constraint ai_generation_requests_request_hmac_version_check
  check (request_hmac_version = 'generation-command.v3');

-- ---------------------------------------------------------------------------
-- 3. Drop Task3 reserve overload（quality 無し）
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, text,
  integer, integer, integer, integer, boolean, integer, timestamptz
);

-- ---------------------------------------------------------------------------
-- 4. release_request_quota_reservations — quality reserved 対称
-- ---------------------------------------------------------------------------
create or replace function private.release_request_quota_reservations(
  p_request private.ai_generation_requests,
  p_now timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_month date;
begin
  if p_request.user_quota_reserved then
    update private.ai_identity_daily_usage
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where identity_key = p_request.identity_key
      and usage_day = p_request.user_usage_day;
  end if;
  if p_request.user_attempt_reserved and p_request.user_attempt_day is not null then
    update private.ai_identity_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where identity_key = p_request.identity_key
      and usage_day = p_request.user_attempt_day;
  end if;
  if p_request.global_reserved_day is not null then
    update private.ai_global_daily_usage
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where usage_day = p_request.global_reserved_day;
  end if;
  -- quality は通常 success と共消費。user_quota_reserved が true のときのみ戻す
  if p_request.quality_mode and p_request.user_quota_reserved then
    update private.ai_identity_quality_daily
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where identity_key = p_request.identity_key
      and usage_day = p_request.user_usage_day;
    v_month := private.ai_jst_month_start(p_now);
    -- request 開始日の月で戻す（user_usage_day の月初）
    if p_request.user_usage_day is not null then
      v_month := date_trunc('month', p_request.user_usage_day::timestamp)::date;
    end if;
    update private.ai_identity_quality_monthly
    set reserved_count = greatest(reserved_count - 1, 0),
        updated_at = p_now
    where identity_key = p_request.identity_key
      and usage_month = v_month;
  end if;
end;
$function$;

revoke all on function private.release_request_quota_reservations(private.ai_generation_requests, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. lookup_ai_generation_request — v3 only
-- ---------------------------------------------------------------------------
create or replace function public.lookup_ai_generation_request(
  p_user_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.ai_generation_requests;
  v_submission private.generation_draft_submission_versions;
  v_snapshot private.generation_regeneration_snapshots;
  v_integrity jsonb;
begin
  select * into v_request
  from private.ai_generation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if not found then
    return pg_catalog.jsonb_build_object('kind', 'miss');
  end if;

  if v_request.request_hmac_version is distinct from 'generation-command.v3' then
    raise exception using errcode = '22023', message = 'invalid_request_hmac';
  end if;

  if v_request.request_kind = 'new_menu' then
    select * into v_submission
    from private.generation_draft_submission_versions
    where draft_id = v_request.draft_id
      and user_id = v_request.user_id
      and draft_revision = v_request.draft_revision;
    if not found then
      raise exception using errcode = 'P0002', message = 'submission_snapshot_missing';
    end if;
    v_integrity := pg_catalog.jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', v_submission.target_mode,
      'servings', to_jsonb(v_submission.servings),
      'target_member_ids', to_jsonb(v_submission.target_member_ids),
      'source_menu_version', 'null'::jsonb
    );
  else
    select * into v_snapshot
    from private.generation_regeneration_snapshots
    where request_id = v_request.id and user_id = v_request.user_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'regeneration_snapshot_missing';
    end if;
    v_integrity := pg_catalog.jsonb_build_object(
      'kind', v_snapshot.kind,
      'target_mode', v_snapshot.target_mode,
      'servings', v_snapshot.servings,
      'target_member_ids', to_jsonb(v_snapshot.target_member_ids),
      'source_menu_version', v_snapshot.source_menu_version
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'kind', 'hit',
    'request_id', v_request.id,
    'request_hmac_version', v_request.request_hmac_version,
    'integrity', v_integrity
  );
end;
$$;

revoke all on function public.lookup_ai_generation_request(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.lookup_ai_generation_request(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. reserve_ai_generation（v3 + p_quality_mode）
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
  p_quality_mode boolean default false,
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
  v_quality_mode boolean := coalesce(p_quality_mode, false);
  v_remaining integer;
  v_q_day private.ai_identity_quality_daily;
  v_q_month private.ai_identity_quality_monthly;
  v_month date;
begin
  v_month := private.ai_jst_month_start(p_now);
  if p_identity_key is null or p_identity_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_identity_key';
  end if;
  if p_request_hmac_version is distinct from 'generation-command.v3'
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
      quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_identity_key, false, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit, v_quality_mode,
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
      quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_identity_key, false, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit, v_quality_mode,
      v_day, 'user_attempt_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;


  -- 品質モード: day/month を同一 TX で検査（M8: 通常台帳と共に）
  if v_quality_mode and not v_quota_disabled then
    insert into private.ai_identity_quality_daily(identity_key, usage_day)
    values (p_identity_key, v_day) on conflict do nothing;
    insert into private.ai_identity_quality_monthly(identity_key, usage_month)
    values (p_identity_key, v_month) on conflict do nothing;
    select * into v_q_day from private.ai_identity_quality_daily
      where identity_key = p_identity_key and usage_day = v_day for update;
    select * into v_q_month from private.ai_identity_quality_monthly
      where identity_key = p_identity_key and usage_month = v_month for update;

    if v_q_day.success_count + v_q_day.reserved_count >= 3 then
      insert into private.ai_generation_requests(
        user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
        draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
        request_hmac_version, request_hmac,
        quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
        user_usage_day, failure_code, retry_at, started_at, completed_at
      ) values (
        p_user_id, p_identity_key, false, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
        p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
        p_request_hmac_version, p_request_hmac,
        p_user_limit, p_attempt_limit, p_short_window_limit, true,
        v_day, 'quality_daily_limit',
        private.ai_next_jst_midnight(p_now), p_now, p_now
      ) returning * into v_request;
      return private.ai_request_payload(v_request, false);
    end if;

    if v_q_month.success_count + v_q_month.reserved_count >= 20 then
      insert into private.ai_generation_requests(
        user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
        draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
        request_hmac_version, request_hmac,
        quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
        user_usage_day, failure_code, retry_at, started_at, completed_at
      ) values (
        p_user_id, p_identity_key, false, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
        p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
        p_request_hmac_version, p_request_hmac,
        p_user_limit, p_attempt_limit, p_short_window_limit, true,
        v_day, 'quality_monthly_limit',
        private.ai_next_jst_midnight(p_now), p_now, p_now
      ) returning * into v_request;
      return private.ai_request_payload(v_request, false);
    end if;
  end if;

  if v_global.sent_count + v_global.reserved_count >= p_global_limit then
    insert into private.ai_generation_requests(
      user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
      draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_identity_key, v_quota_disabled, p_idempotency_key, p_request_kind, 'failed',
      p_draft_id, p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit, v_quality_mode,
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
    -- M8: quality 成功予約は通常 success/attempt/global と同一 TX で quality day/month も reserved++
    if v_quality_mode and not v_quota_disabled then
      update private.ai_identity_quality_daily
      set reserved_count = reserved_count + 1, updated_at = p_now
      where identity_key = p_identity_key and usage_day = v_day;
      update private.ai_identity_quality_monthly
      set reserved_count = reserved_count + 1, updated_at = p_now
      where identity_key = p_identity_key and usage_month = v_month;
    end if;

    insert into private.ai_generation_requests(
      user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
      draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
      user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
      global_reserved_day, processing_expires_at, started_at
    ) values (
      p_user_id, p_identity_key, v_quota_disabled, p_idempotency_key, p_request_kind, 'processing',
      p_draft_id, p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      p_user_limit, p_attempt_limit, p_short_window_limit, v_quality_mode,
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
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, text, integer, integer, integer, integer, boolean, boolean, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, text, integer, integer, integer, integer, boolean, boolean, integer, timestamptz
) to service_role;


-- ---------------------------------------------------------------------------
-- 8. finalize_ai_generation_success — quality reserved → success 共消費
--    現行 finalize 本体を再定義し、quality 変換を挿入する。
-- ---------------------------------------------------------------------------
create or replace function public.finalize_ai_generation_success(
  p_request_id uuid,p_menu jsonb,p_preference_snapshot jsonb,p_safety_snapshot jsonb,
  p_safety_fingerprint text,p_allergen_version text,p_food_rule_version text,
  p_target_members jsonb,p_expired_checks jsonb,
  p_source_menu_id uuid,p_change_reason text,p_change_reason_custom text,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_request private.ai_generation_requests;
  v_menu_id uuid;
  v_submission_target_mode text;
  v_submission_servings integer;
  v_snapshot private.generation_regeneration_snapshots;
  v_source public.menus;
  v_target_count integer;
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'request_not_found'; end if;
  if v_request.status <> 'processing' then return private.ai_request_payload(v_request, true); end if;
  -- 個人枠無効時は user_reservation_missing を出さない
  if not v_request.personal_quota_disabled and not v_request.user_quota_reserved then
    raise exception using errcode = '23514', message = 'user_reservation_missing';
  end if;

  if v_request.request_kind = 'new_menu' then
    if v_request.draft_id is not null and v_request.draft_revision is not null then
      select target_mode, servings
        into v_submission_target_mode, v_submission_servings
      from private.generation_draft_submission_versions
      where draft_id = v_request.draft_id
        and user_id = v_request.user_id
        and draft_revision = v_request.draft_revision;
      if v_submission_target_mode is null then
        raise exception using errcode = 'P0002', message = 'submission_snapshot_missing';
      end if;
    else
      raise exception using errcode = 'P0002', message = 'submission_snapshot_missing';
    end if;
  elsif v_request.request_kind in ('regenerate_menu', 'regenerate_dish') then
    select * into v_snapshot
    from private.generation_regeneration_snapshots
    where request_id = v_request.id and user_id = v_request.user_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'regeneration_snapshot_missing';
    end if;
    select * into v_source
    from public.menus
    where id = v_snapshot.source_menu_id
      and user_id = v_request.user_id
      and version = v_snapshot.source_menu_version
    for share;
    if not found then
      return public.finalize_ai_generation_failure(
        p_request_id, 'source_menu_changed', null, p_now
      );
    end if;
    if p_source_menu_id is distinct from v_snapshot.source_menu_id then
      raise exception using errcode = 'P0001', message = 'source_menu_changed';
    end if;
    v_submission_target_mode := v_snapshot.target_mode;
    v_submission_servings := v_snapshot.servings;
  else
    raise exception using errcode = '22023', message = 'unsupported_request_kind';
  end if;

  if jsonb_typeof(p_target_members) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_target_members';
  end if;
  v_target_count := pg_catalog.jsonb_array_length(p_target_members);

  if v_submission_target_mode = 'idea' then
    if p_allergen_version is not null or p_food_rule_version is not null then
      raise exception using errcode = '22023', message = 'idea_safety_versions_must_be_null';
    end if;
    if v_target_count <> 0 then
      raise exception using errcode = '22023', message = 'idea_target_members_must_be_empty';
    end if;
    if p_safety_fingerprint is distinct from private.idea_safety_fingerprint() then
      raise exception using errcode = '22023', message = 'idea_safety_fingerprint_mismatch';
    end if;
    if p_safety_snapshot is distinct from
         '{"assurance":"none","members":[],"mode":"idea"}'::jsonb then
      raise exception using errcode = '22023', message = 'idea_safety_snapshot_mismatch';
    end if;
    if v_submission_servings is null
       or (p_menu->>'servings')::integer is distinct from v_submission_servings then
      raise exception using errcode = '22023', message = 'idea_servings_mismatch';
    end if;
    if coalesce(pg_catalog.jsonb_array_length(p_menu->'adaptations'), -1) <> 0
       or coalesce(pg_catalog.jsonb_array_length(p_menu->'labelConfirmations'), -1) <> 0 then
      raise exception using errcode = '22023', message = 'idea_family_rows_forbidden';
    end if;
  elsif v_submission_target_mode = 'household' then
    if p_allergen_version is null or p_food_rule_version is null then
      raise exception using errcode = '22023', message = 'household_safety_versions_required';
    end if;
    if v_target_count < 1 or v_target_count > 20 then
      raise exception using errcode = '22023', message = 'invalid_target_members';
    end if;
    begin
      perform private.lock_and_assert_current_safety_fingerprint(
        v_request.user_id,
        array(select (target->>'householdMemberId')::uuid
          from pg_catalog.jsonb_array_elements(p_target_members) as targets(target)),
        p_safety_fingerprint
      );
    exception
      when sqlstate 'P0001' then
        if sqlerrm is distinct from 'current_safety_changed' then
          raise;
        end if;
        return public.finalize_ai_generation_conflict(
          p_request_id, array['current_safety_changed']::text[], p_now
        );
      when sqlstate '22023' then
        if sqlerrm is distinct from 'current_safety_changed' then
          raise;
        end if;
        return public.finalize_ai_generation_conflict(
          p_request_id, array['current_safety_changed']::text[], p_now
        );
    end;
  else
    raise exception using errcode = '22023', message = 'unsupported_target_mode';
  end if;

  begin
    perform private.lock_and_assert_selected_pantry_rows(
      v_request.user_id,
      p_menu->'pantryUsage'
    );
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'current_safety_changed' then
        raise;
      end if;
      return public.finalize_ai_generation_conflict(
        p_request_id, array['current_safety_changed']::text[], p_now
      );
  end;

  v_menu_id := private.persist_validated_menu(
    v_request,p_menu,p_preference_snapshot,p_safety_snapshot,p_safety_fingerprint,
    p_allergen_version,p_food_rule_version,v_submission_target_mode,p_target_members,p_expired_checks
  );
  perform private.assign_regeneration_lineage(
    v_request.user_id,p_source_menu_id,v_menu_id,p_change_reason,p_change_reason_custom
  );
  if v_request.draft_id is not null and v_request.draft_revision is not null then
    perform private.soft_delete_generation_draft(
      v_request.user_id,
      v_request.draft_id,
      v_request.draft_revision
    );
  end if;

  if not v_request.personal_quota_disabled then
    update private.ai_identity_daily_usage set
      reserved_count = reserved_count - 1, success_count = success_count + 1, updated_at = p_now
    where identity_key = v_request.identity_key
      and usage_day = v_request.user_usage_day
      and reserved_count > 0;
    if not found then raise exception using errcode = '23514', message = 'user_reservation_corrupt'; end if;
    if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
      update private.ai_identity_daily_external_attempts
      set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
      where identity_key = v_request.identity_key and usage_day = v_request.user_attempt_day;
    end if;
    -- 品質モード成功: day/month も reserved → success（通常 success と共消費）
    if v_request.quality_mode then
      update private.ai_identity_quality_daily set
        reserved_count = reserved_count - 1, success_count = success_count + 1, updated_at = p_now
      where identity_key = v_request.identity_key
        and usage_day = v_request.user_usage_day
        and reserved_count > 0;
      if not found then raise exception using errcode = '23514', message = 'quality_daily_reservation_corrupt'; end if;
      update private.ai_identity_quality_monthly set
        reserved_count = reserved_count - 1, success_count = success_count + 1, updated_at = p_now
      where identity_key = v_request.identity_key
        and usage_month = date_trunc('month', v_request.user_usage_day::timestamp)::date
        and reserved_count > 0;
      if not found then raise exception using errcode = '23514', message = 'quality_monthly_reservation_corrupt'; end if;
    end if;
  end if;
  if v_request.global_reserved_day is not null then
    update private.ai_global_daily_usage set reserved_count = reserved_count - 1, updated_at = p_now
    where usage_day = v_request.global_reserved_day and reserved_count > 0;
  end if;
  update private.ai_generation_requests set
    status = 'succeeded',completed_menu_id = v_menu_id,user_quota_reserved = false,
    user_attempt_reserved = false,user_attempt_day = null,global_reserved_day = null,
    completed_at = p_now,updated_at = p_now,
    duration_ms = greatest(
      0, pg_catalog.floor(extract(epoch from (p_now - started_at)) * 1000)::integer
    )
  where id = p_request_id returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$function$;

revoke all on function public.finalize_ai_generation_success(
  uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.finalize_ai_generation_success(
  uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz
) to service_role;



-- ---------------------------------------------------------------------------
-- 9. get_ai_usage_today — quality 投影（plan/available は Function merge）
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
  v_month date := private.ai_jst_month_start(p_now);
  v_q_day_success integer := 0;
  v_q_day_reserved integer := 0;
  v_q_month_success integer := 0;
  v_q_month_reserved integer := 0;
  v_q_day_consumed integer;
  v_q_month_consumed integer;
  v_q_day_remaining integer;
  v_q_month_remaining integer;
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

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_q_day_success, v_q_day_reserved
  from private.ai_identity_quality_daily
  where identity_key = p_identity_key and usage_day = v_day;
  if not found then
    v_q_day_success := 0;
    v_q_day_reserved := 0;
  end if;

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_q_month_success, v_q_month_reserved
  from private.ai_identity_quality_monthly
  where identity_key = p_identity_key and usage_month = v_month;
  if not found then
    v_q_month_success := 0;
    v_q_month_reserved := 0;
  end if;

  v_q_day_consumed := least(v_q_day_success + v_q_day_reserved, 3);
  v_q_month_consumed := least(v_q_month_success + v_q_month_reserved, 20);
  v_q_day_remaining := greatest(3 - (v_q_day_success + v_q_day_reserved), 0);
  v_q_month_remaining := greatest(20 - (v_q_month_success + v_q_month_reserved), 0);

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
    -- available は Function が plusEntitled と合成する。RPC は残数のみ投影（常に false を出さない）
    'quality', jsonb_build_object(
      'day', jsonb_build_object(
        'consumed', v_q_day_consumed,
        'limit', 3,
        'remaining', v_q_day_remaining
      ),
      'month', jsonb_build_object(
        'consumed', v_q_month_consumed,
        'limit', 20,
        'remaining', v_q_month_remaining
      )
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


