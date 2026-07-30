-- ingredient_preference: 材料の使い方（多め/少な目/selected_only/おまかせ）
-- 後方互換は不要。save_generation_draft の引数を拡張し、submission snapshot へ写す。

alter table public.generation_drafts
  add column ingredient_preference text
  check (
    ingredient_preference is null
    or ingredient_preference in ('more', 'less', 'selected_only', 'auto')
  );

alter table private.generation_draft_submission_versions
  add column ingredient_preference text
  check (
    ingredient_preference is null
    or ingredient_preference in ('more', 'less', 'selected_only', 'auto')
  );

-- save_generation_draft: 引数が増えるため DROP 後 CREATE
drop function if exists public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint, text, text[], text, jsonb
);

create or replace function public.save_generation_draft(
  p_expected_revision bigint, p_meal_type text, p_main_ingredients text[],
  p_cuisine_genre text, p_target_mode text, p_target_member_ids uuid[], p_servings smallint,
  p_time_limit_minutes smallint, p_budget_preference text, p_ingredient_preference text,
  p_avoid_ingredients text[], p_memo text, p_pantry_selections jsonb
) returns public.generation_drafts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_saved public.generation_drafts;
  v_has_existing boolean;
begin
  if v_user_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;

  if p_ingredient_preference is not null
     and p_ingredient_preference not in ('more', 'less', 'selected_only', 'auto') then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );
  select * into v_saved
  from public.generation_drafts
  where user_id = v_user_id
  for update;
  v_has_existing := found;

  if p_expected_revision = 0 then
    if v_has_existing and v_saved.deleted_at is null then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;

    if not v_has_existing then
      insert into public.generation_drafts (
        user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
        servings, time_limit_minutes, budget_preference, ingredient_preference,
        avoid_ingredients, memo, pantry_selections, revision
      ) values (
        v_user_id, p_meal_type, p_main_ingredients, p_cuisine_genre, p_target_mode,
        p_target_member_ids, p_servings, p_time_limit_minutes, p_budget_preference,
        p_ingredient_preference, p_avoid_ingredients, p_memo, p_pantry_selections, 1
      )
      returning * into v_saved;
    else
      update public.generation_drafts
      set meal_type = p_meal_type,
        main_ingredients = p_main_ingredients,
        cuisine_genre = p_cuisine_genre,
        target_mode = p_target_mode,
        target_member_ids = p_target_member_ids,
        servings = p_servings,
        time_limit_minutes = p_time_limit_minutes,
        budget_preference = p_budget_preference,
        ingredient_preference = p_ingredient_preference,
        avoid_ingredients = p_avoid_ingredients,
        memo = p_memo,
        pantry_selections = p_pantry_selections,
        revision = revision + 1,
        deleted_at = null
      where id = v_saved.id
      returning * into v_saved;
    end if;
    return v_saved;
  else
    if not v_has_existing
      or v_saved.deleted_at is not null
      or v_saved.revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;

    update public.generation_drafts
    set meal_type = p_meal_type,
      main_ingredients = p_main_ingredients,
      cuisine_genre = p_cuisine_genre,
      target_mode = p_target_mode,
      target_member_ids = p_target_member_ids,
      servings = p_servings,
      time_limit_minutes = p_time_limit_minutes,
      budget_preference = p_budget_preference,
      ingredient_preference = p_ingredient_preference,
      avoid_ingredients = p_avoid_ingredients,
      memo = p_memo,
      pantry_selections = p_pantry_selections,
      revision = revision + 1
    where id = v_saved.id
    returning * into v_saved;
    return v_saved;
  end if;
end;
$function$;

revoke all on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint, text, text, text[], text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint, text, text, text[], text, jsonb
) to authenticated;

-- reserve: submission snapshot へ ingredient_preference を写す
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
  if p_global_limit is null or p_global_limit not between 1 and 200
     or p_stale_after_seconds < 30 then
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

-- submission snapshot 戻り値に ingredient_preference を追加
drop function if exists public.get_ai_generation_submission_snapshot(uuid, uuid);

create or replace function public.get_ai_generation_submission_snapshot(
  p_request_id uuid,
  p_user_id uuid
) returns table (
  draft_id uuid,
  draft_revision bigint,
  meal_type text,
  main_ingredients text[],
  cuisine_genre text,
  target_mode text,
  target_member_ids uuid[],
  servings smallint,
  time_limit_minutes smallint,
  budget_preference text,
  ingredient_preference text,
  avoid_ingredients text[],
  memo text,
  pantry_selections jsonb,
  captured_at timestamptz
) language sql stable security definer
set search_path = ''
as $$
  select
    snapshot.draft_id,
    snapshot.draft_revision,
    snapshot.meal_type,
    snapshot.main_ingredients,
    snapshot.cuisine_genre,
    snapshot.target_mode,
    snapshot.target_member_ids,
    snapshot.servings,
    snapshot.time_limit_minutes,
    snapshot.budget_preference,
    snapshot.ingredient_preference,
    snapshot.avoid_ingredients,
    snapshot.memo,
    snapshot.pantry_selections,
    snapshot.captured_at
  from private.ai_generation_requests as request
  join private.generation_draft_submission_versions as snapshot
    on snapshot.draft_id = request.draft_id
   and snapshot.user_id = request.user_id
   and snapshot.draft_revision = request.draft_revision
  where request.id = p_request_id
    and request.user_id = p_user_id
    and request.request_kind = 'new_menu'
$$;

revoke all on function public.get_ai_generation_submission_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_ai_generation_submission_snapshot(uuid, uuid)
  to service_role;
