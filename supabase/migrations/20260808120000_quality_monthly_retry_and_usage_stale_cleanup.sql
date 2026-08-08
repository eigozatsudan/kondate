-- G1: quality_monthly_limit の retry_at を翌 JST 月初へ（日次 midnight だと UI が「再開: 明日」と誤誘導）
-- G4: get_ai_usage_today 先頭で cleanup_stale_ai_generations を実行し、orphan 期限後の remaining 過少を防ぐ
-- 正本関数本体は 20260730120000 (reserve) / 20260729160000 (usage) を継承し差分のみ適用

-- 翌 JST 月初 0:00。ai_next_jst_midnight と対称。private 内専用（execute は付与しない）
create or replace function private.ai_next_jst_month_start(p_now timestamptz)
returns timestamptz
language sql
stable
parallel safe
set search_path = pg_catalog
as $$
  select make_timestamptz(
    extract(year from (date_trunc('month', (p_now at time zone 'Asia/Tokyo')) + interval '1 month'))::integer,
    extract(month from (date_trunc('month', (p_now at time zone 'Asia/Tokyo')) + interval '1 month'))::integer,
    1,
    0, 0, 0, 'Asia/Tokyo'
  )
$$;

revoke all on function private.ai_next_jst_month_start(timestamptz)
  from public, anon, authenticated, service_role;


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
  -- p_global_limit の範囲は ENV（GLOBAL_DAILY_AI_LIMIT）のみが正本。SQL では拒否しない。
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
      ingredient_preference, avoid_ingredients, memo, pantry_selections, captured_at
    ) values (
      v_draft.id, v_draft.user_id, v_draft.revision, v_draft.meal_type,
      v_draft.main_ingredients, v_draft.cuisine_genre,
      v_draft.target_mode, v_draft.target_member_ids, v_draft.servings,
      v_draft.time_limit_minutes, v_draft.budget_preference, v_draft.ingredient_preference,
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
        -- 月次枠は翌 JST 月初まで解放されない。日次 midnight を stamp すると UI が「再開: 明日」と誤る
        private.ai_next_jst_month_start(p_now), p_now, p_now
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
  v_week date := private.ai_jst_week_start(p_now);
  v_f_success integer := 0;
  v_f_success_reserved integer := 0;
  v_f_try_sent integer := 0;
  v_f_try_reserved integer := 0;
  v_f_success_consumed integer;
  v_f_try_consumed integer;
  v_f_success_remaining integer;
  v_f_try_remaining integer;
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

  -- G4: status/reserve と同様、期限切れ processing を先に解放し reserved 残差で remaining を過少表示しない
  perform public.cleanup_stale_ai_generations(p_now);

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

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_f_success, v_f_success_reserved
  from private.ai_identity_flyer_weekly
  where identity_key = p_identity_key and week_start = v_week;
  if not found then
    v_f_success := 0;
    v_f_success_reserved := 0;
  end if;

  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_f_try_sent, v_f_try_reserved
  from private.ai_identity_flyer_weekly_tries
  where identity_key = p_identity_key and week_start = v_week;
  if not found then
    v_f_try_sent := 0;
    v_f_try_reserved := 0;
  end if;

  -- usage-today: reserved は consumed 側に含めない現行方針（quality は含めているが flyer success も success 側に合わせ reserved 含む）
  -- quality と同型: reserved を consumed に含めて remaining を計算
  v_f_success_consumed := least(v_f_success + v_f_success_reserved, 2);
  v_f_try_consumed := least(v_f_try_sent + v_f_try_reserved, 6);
  v_f_success_remaining := greatest(2 - (v_f_success + v_f_success_reserved), 0);
  v_f_try_remaining := greatest(6 - (v_f_try_sent + v_f_try_reserved), 0);

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
    'flyerWeekly', jsonb_build_object(
      'successConsumed', v_f_success_consumed,
      'successLimit', 2,
      'successRemaining', v_f_success_remaining,
      'triesConsumed', v_f_try_consumed,
      'triesLimit', 6,
      'triesRemaining', v_f_try_remaining,
      'weekStartJst', to_char(v_week, 'YYYY-MM-DD')
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
