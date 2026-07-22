-- 献立作成の対象モード（household/idea）と人数を第一級のDB列にする。
-- clean reset前提のためUPDATE移行や一時defaultは追加しない。
-- household: 家族1〜20人・人数指定なし。idea: 家族0人・人数1〜20。
-- 質問途中のdraftだけ両方nullを許す。

-- 1. generation_drafts（質問途中）: target_mode/servingsはnullable。
alter table public.generation_drafts
  add column target_mode text,
  add column servings smallint;

-- 注: プラン原文の `servings between 1 and 20` はservings=nullのとき評価がNULLになり、
-- CHECKがNULLを違反と扱わないためidea+servings=nullをすり抜ける。servings is not null
-- を明示して意図どおりFALSEへ倒す（pgTAPの否定caseで実証済み）。
alter table public.generation_drafts
  add constraint generation_drafts_target_mode_servings_check
  check (
    (target_mode = 'household' and cardinality(target_member_ids) between 1 and 20 and servings is null)
    or (target_mode = 'idea' and cardinality(target_member_ids) = 0 and servings is not null and servings between 1 and 20)
    or (target_mode is null and cardinality(target_member_ids) = 0 and servings is null)
  );

-- 2. 凍結提出（private.generation_draft_submission_versions）: target_modeはNOT NULL、
--    servingsはmode条件付きnullable。target_member_idsは1次元・NULL要素なし・重複なし・
--    household 1〜20件・idea 0件を強制する（既存の cardinality between 1 and 20 だけの
--    無名CHECKはidea 0件を締め出すため、名前を動的に見つけて置き換える）。
create or replace function private.is_valid_submission_target_member_ids(
  p_value uuid[], p_target_mode text
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is not null
    and (pg_catalog.cardinality(p_value) = 0 or pg_catalog.array_ndims(p_value) = 1)
    and not exists (
      select 1 from pg_catalog.unnest(p_value) as values_(value) where value is null
    )
    and pg_catalog.cardinality(p_value) = (
      select pg_catalog.count(distinct value)::integer
      from pg_catalog.unnest(p_value) as values_(value)
    )
    and (
      (p_target_mode = 'household' and pg_catalog.cardinality(p_value) between 1 and 20)
      or (p_target_mode = 'idea' and pg_catalog.cardinality(p_value) = 0)
    );
$function$;

revoke all on function private.is_valid_submission_target_member_ids(uuid[], text)
  from public, anon, authenticated, service_role;

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'private.generation_draft_submission_versions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%target_member_ids%';
  if v_conname is not null then
    execute format(
      'alter table private.generation_draft_submission_versions drop constraint %I',
      v_conname
    );
  end if;
end;
$$;

alter table private.generation_draft_submission_versions
  add column target_mode text,
  add column servings smallint;

-- 注: idea枝の `servings between 1 and 20` だけでは servings=null のとき評価が
-- NULLになり CHECK が通ってしまう。draft と同じく servings is not null を明示する。
alter table private.generation_draft_submission_versions
  alter column target_mode set not null,
  add constraint generation_draft_submission_versions_target_mode_check
    check (target_mode in ('household', 'idea')),
  add constraint generation_draft_submission_versions_servings_check
    check (
      (target_mode = 'household' and servings is null)
      or (target_mode = 'idea' and servings is not null and servings between 1 and 20)
    ),
  add constraint generation_draft_submission_versions_target_member_ids_check
    check (private.is_valid_submission_target_member_ids(target_member_ids, target_mode));

-- 3. public.menus（実献立）: target_modeはNOT NULL。人数を保存する既存servingsは
--    両modeで1〜20のためNOT NULLを維持する。allergen_dictionary_version /
--    food_safety_rule_versionだけをmode条件付きnullableにする。
alter table public.menus
  alter column allergen_dictionary_version drop not null,
  alter column food_safety_rule_version drop not null,
  add column target_mode text;

alter table public.menus
  alter column target_mode set not null,
  add constraint menus_target_mode_check check (target_mode in ('household', 'idea')),
  add constraint menus_target_mode_versions_check
  check (
    (target_mode = 'household' and allergen_dictionary_version is not null and food_safety_rule_version is not null)
    or (target_mode = 'idea' and allergen_dictionary_version is null and food_safety_rule_version is null)
  );

-- 4. public.save_generation_draft: target_mode/servingsを明示引数に追加した新signatureへ
--    置換する（引数構成が変わるためCREATE OR REPLACEではなくDROP後にCREATE）。
drop function if exists public.save_generation_draft(
  bigint, text, text[], text, uuid[], smallint, text, text[], text, jsonb
);

create or replace function public.save_generation_draft(
  p_expected_revision bigint, p_meal_type text, p_main_ingredients text[],
  p_cuisine_genre text, p_target_mode text, p_target_member_ids uuid[], p_servings smallint,
  p_time_limit_minutes smallint, p_budget_preference text, p_avoid_ingredients text[],
  p_memo text, p_pantry_selections jsonb
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
        servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
        pantry_selections, revision
      ) values (
        v_user_id, p_meal_type, p_main_ingredients, p_cuisine_genre, p_target_mode,
        p_target_member_ids, p_servings, p_time_limit_minutes, p_budget_preference,
        p_avoid_ingredients, p_memo, p_pantry_selections, 1
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
  bigint, text, text[], text, text, uuid[], smallint, smallint, text, text[], text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint, text, text[], text, jsonb
) to authenticated;

-- 5. public.reserve_ai_generation: signatureは維持し、Task 3→4間の開発時ブリッジとして
--    household の下書きだけを受理する。idea・未選択はrequest/quota行を作る前に拒否する。
--    この経路はTask 4のv2専用予約へ原子的に置換される一時境界であり、リリース間互換
--    として残さない。set search_path = '' へ変更し、catalog/schema objectを完全修飾する。
drop function if exists public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer, integer, timestamptz
);

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
  p_user_limit integer,
  p_global_limit integer,
  p_stale_after_seconds integer default 180,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_day date := private.ai_jst_day(p_now);
  v_request private.ai_generation_requests;
  v_active private.ai_generation_requests;
  v_draft public.generation_drafts;
  v_user private.ai_user_daily_usage;
  v_global private.ai_global_daily_usage;
  v_attempts private.ai_user_daily_external_attempts;
begin
  if p_request_hmac_version is distinct from 'generation-command.v1'
     or p_request_hmac is null
     or p_request_hmac !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_request_hmac';
  end if;
  if p_user_limit <> 5 then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  if p_global_limit is null or p_global_limit not between 1 and 45
     or p_stale_after_seconds < 30 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  if p_request_kind not in ('new_menu', 'regenerate_menu', 'regenerate_dish') then
    raise exception using errcode = '22023', message = 'invalid_request_kind';
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
    select * into v_draft
    from public.generation_drafts
    where id = p_draft_id and user_id = p_user_id and revision = p_draft_revision
      and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'draft_unavailable';
    end if;
    -- Task 3→4 開発時ブリッジ: household のロック済み下書き（対象1〜20件・servings is
    -- null）だけを受理する。idea・未選択はrequest/quota行を作る前に拒否する。
    if v_draft.target_mode is distinct from 'household'
       or v_draft.target_member_ids is null
       or pg_catalog.cardinality(v_draft.target_member_ids) not between 1 and 20
       or v_draft.servings is not null then
      raise exception using errcode = '22023', message = 'unsupported_target_mode';
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
  elsif p_draft_id is not null or p_draft_revision is not null then
    raise exception using errcode = '22023', message = 'invalid_draft_reference';
  end if;

  perform public.cleanup_stale_ai_generations(p_now);

  select * into v_active from private.ai_generation_requests
  where user_id = p_user_id and status = 'processing';
  if found then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'generation_in_progress',
      v_active.processing_expires_at, p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  insert into private.ai_user_daily_usage(user_id, usage_day)
  values (p_user_id, v_day) on conflict do nothing;
  insert into private.ai_global_daily_usage(usage_day)
  values (v_day) on conflict do nothing;
  insert into private.ai_user_daily_external_attempts(user_id, usage_day)
  values (p_user_id, v_day) on conflict do nothing;
  select * into v_user from private.ai_user_daily_usage
    where user_id = p_user_id and usage_day = v_day for update;
  select * into v_global from private.ai_global_daily_usage
    where usage_day = v_day for update;
  select * into v_attempts from private.ai_user_daily_external_attempts
    where user_id = p_user_id and usage_day = v_day for update;

  if v_user.success_count + v_user.reserved_count >= p_user_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'user_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if v_attempts.reserved_count + v_attempts.sent_count >= 12 then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'user_attempt_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if v_global.sent_count + v_global.reserved_count >= p_global_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'global_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  update private.ai_user_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
  where user_id = p_user_id and usage_day = v_day;
  update private.ai_user_daily_external_attempts
  set reserved_count = reserved_count + 1, updated_at = p_now
  where user_id = p_user_id and usage_day = v_day;
  update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
  where usage_day = v_day;
  insert into private.ai_generation_requests(
    user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
    source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    p_user_id, p_idempotency_key, p_request_kind, 'processing', p_draft_id,
    p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
    p_request_hmac_version, p_request_hmac,
    v_day, true, true, v_day,
    v_day, p_now + pg_catalog.make_interval(secs => p_stale_after_seconds), p_now
  ) returning * into v_request;
  perform public.cleanup_ai_generation_requests(
    p_now - interval '30 days',
    p_user_id
  );
  return private.ai_request_payload(v_request, false);
end;
$$;

revoke all on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer, integer, timestamptz
) to service_role;

-- 6. private.persist_validated_menu: menus.target_modeへこのTask 3ブリッジが唯一扱う
--    'household'を明示保存する引数を追加する。set search_path = ''へ変更し完全修飾する。
drop function if exists private.persist_validated_menu(
  private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb
);

create or replace function private.persist_validated_menu(
  p_request private.ai_generation_requests,
  p_menu jsonb,
  p_preference_snapshot jsonb,
  p_safety_snapshot jsonb,
  p_safety_fingerprint text,
  p_allergen_version text,
  p_food_rule_version text,
  p_target_mode text,
  p_target_members jsonb,
  p_expired_checks jsonb
) returns uuid language plpgsql set search_path = ''
as $$
declare
  v_menu_id uuid := (p_menu->>'menuId')::uuid;
  v_dish jsonb;
  v_item jsonb;
  v_step jsonb;
  v_timeline jsonb;
  v_adaptation jsonb;
  v_action jsonb;
  v_action_position bigint;
  v_label jsonb;
  v_usage jsonb;
  v_checked_at timestamptz;
begin
  insert into public.menus(
    id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
    preference_snapshot,safety_snapshot,safety_fingerprint,
    target_mode,allergen_dictionary_version,food_safety_rule_version,output_schema_version,
    derivation_group_id,parent_menu_id,change_reason,change_reason_custom
  ) values (
    v_menu_id,p_request.user_id,p_menu->>'mealType',p_menu->>'cuisineGenre',
    (p_menu->>'servings')::integer,(p_menu->>'totalElapsedMinutes')::integer,
    p_preference_snapshot,p_safety_snapshot,p_safety_fingerprint,
    p_target_mode,p_allergen_version,p_food_rule_version,p_menu->>'schemaVersion',
    v_menu_id,null,null,null
  );

  for v_item in select value from pg_catalog.jsonb_array_elements(p_target_members) loop
    insert into public.menu_target_members(
      menu_id,user_id,household_member_id,household_member_user_id,
      anonymous_ref,member_display_name_snapshot
    ) values (
      v_menu_id,p_request.user_id,(v_item->>'householdMemberId')::uuid,p_request.user_id,
      v_item->>'anonymousRef',v_item->>'displayNameSnapshot'
    );
  end loop;

  for v_usage in select value from pg_catalog.jsonb_array_elements(p_menu->'pantryUsage') loop
    select nullif(check_->>'checkedAt','')::timestamptz
      into v_checked_at
    from pg_catalog.jsonb_array_elements(p_expired_checks) as checks(check_)
    where check_->>'pantryItemId'=v_usage->>'pantryItemId'
    limit 1;
    insert into public.generation_pantry_selections(
      id,menu_id,user_id,pantry_item_id,pantry_name_snapshot,priority,idempotency_key,
      expired_item_checked_at,expired_item_check_jst_date,usage_status,
      planned_quantity,inventory_quantity_snapshot,shortage_quantity,unit,unused_reason
    ) values (
      (v_usage->>'selectionId')::uuid,v_menu_id,p_request.user_id,
      nullif(v_usage->>'pantryItemId','')::uuid,v_usage->>'pantryItemName',v_usage->>'priority',
      p_request.idempotency_key,
      v_checked_at,
      (v_checked_at at time zone 'Asia/Tokyo')::date,
      v_usage->>'usageStatus',nullif(v_usage->>'plannedQuantity','')::numeric,
      nullif(v_usage->>'inventoryQuantity','')::numeric,
      nullif(v_usage->>'shortageQuantity','')::numeric,nullif(v_usage->>'unit',''),
      nullif(v_usage->>'unusedReason','')
    );
  end loop;

  for v_dish in select value from pg_catalog.jsonb_array_elements(p_menu->'dishes') loop
    insert into public.dishes(id,menu_id,user_id,role,position,name,description,cooking_time_minutes)
    values((v_dish->>'id')::uuid,v_menu_id,p_request.user_id,v_dish->>'role',
      (v_dish->>'position')::integer,v_dish->>'name',v_dish->>'description',
      (v_dish->>'cookingTimeMinutes')::integer);
    for v_item in select value from pg_catalog.jsonb_array_elements(v_dish->'ingredients') loop
      insert into public.dish_ingredients(
        id,menu_id,dish_id,user_id,position,name,quantity_value,quantity_text,unit,
        store_section,pantry_selection_id,label_confirmation_required
      ) values (
        (v_item->>'id')::uuid,v_menu_id,(v_dish->>'id')::uuid,p_request.user_id,
        (v_item->>'position')::integer,v_item->>'name',nullif(v_item->>'quantityValue','')::numeric,
        v_item->>'quantityText',nullif(v_item->>'unit',''),v_item->>'storeSection',
        nullif(v_item->>'pantrySelectionId','')::uuid,
        (v_item->>'labelConfirmationRequired')::boolean
      );
    end loop;
    for v_step in select value from pg_catalog.jsonb_array_elements(v_dish->'steps') loop
      insert into public.recipe_steps(id,menu_id,dish_id,user_id,position,instruction)
      values((v_step->>'id')::uuid,v_menu_id,(v_dish->>'id')::uuid,p_request.user_id,
        (v_step->>'position')::integer,v_step->>'instruction');
    end loop;
  end loop;

  for v_timeline in select value from pg_catalog.jsonb_array_elements(p_menu->'timeline') loop
    insert into public.menu_timeline_steps(
      id,menu_id,user_id,position,start_minute,duration_minutes,instruction,dish_id,recipe_step_id
    ) values (
      (v_timeline->>'id')::uuid,v_menu_id,p_request.user_id,
      (v_timeline->>'position')::integer,(v_timeline->>'startMinute')::integer,
      (v_timeline->>'durationMinutes')::integer,v_timeline->>'instruction',
      nullif(v_timeline->>'dishId','')::uuid,nullif(v_timeline->>'recipeStepId','')::uuid
    );
  end loop;

  for v_adaptation in select value from pg_catalog.jsonb_array_elements(p_menu->'adaptations') loop
    insert into public.menu_member_adaptations(
      id,menu_id,dish_id,user_id,anonymous_member_ref,portion_text,
      branch_before_recipe_step_id,additional_cutting,additional_heating,
      additional_seasoning,serving_check,safety_tags
    ) values (
      (v_adaptation->>'id')::uuid,v_menu_id,(v_adaptation->>'dishId')::uuid,p_request.user_id,
      v_adaptation->>'anonymousMemberRef',v_adaptation->>'portionText',
      (v_adaptation->>'branchBeforeRecipeStepId')::uuid,
      nullif(v_adaptation->>'additionalCutting',''),nullif(v_adaptation->>'additionalHeating',''),
      nullif(v_adaptation->>'additionalSeasoning',''),v_adaptation->>'servingCheck',
      array(select pg_catalog.jsonb_array_elements_text(v_adaptation->'safetyTags'))
    );
    for v_action, v_action_position in
      select action, ordinality
      from pg_catalog.jsonb_array_elements(v_adaptation->'safetyActions')
        with ordinality as actions(action, ordinality)
    loop
      insert into public.menu_safety_actions(
        menu_id,dish_id,ingredient_id,user_id,anonymous_member_ref,before_recipe_step_id,
        position,kind,instruction
      ) values (
        v_menu_id,(v_action->>'dishId')::uuid,(v_action->>'ingredientId')::uuid,p_request.user_id,
        v_action->>'anonymousMemberRef',(v_action->>'beforeRecipeStepId')::uuid,
        v_action_position::smallint,v_action->>'kind',v_action->>'instruction'
      );
    end loop;
  end loop;

  if (select pg_catalog.count(*) from public.menu_safety_actions where menu_id = v_menu_id)
     <> (select pg_catalog.count(*) from pg_catalog.jsonb_path_query(
       p_menu, '$.adaptations[*].safetyActions[*]'::jsonpath)) then
    raise exception using errcode = '23514', message = 'menu_safety_action_count_mismatch';
  end if;

  for v_label in select value from pg_catalog.jsonb_array_elements(p_menu->'labelConfirmations') loop
    insert into public.menu_label_confirmations(
      menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,allergen_id,
      anonymous_member_ref,dictionary_version,requirement_safety_fingerprint,
      is_current,confirmation_status
    ) values (
      v_menu_id,p_request.user_id,v_label->>'sourceType',(v_label->>'sourceId')::uuid,
      v_label->>'sourcePath',v_label->>'sourceText',v_label->>'allergenId',
      v_label->>'anonymousMemberRef',
      v_label->>'dictionaryVersion',p_safety_fingerprint,true,v_label->>'confirmationStatus'
    );
  end loop;
  return v_menu_id;
end;
$$;

revoke all on function private.persist_validated_menu(
  private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,text,jsonb,jsonb
) from public,anon,authenticated,service_role;

-- 7. public.finalize_ai_generation_success: signature・HMAC・quota・lock順は変えず、
--    凍結提出からhouseholdを確認してからmenus.target_mode='household'を保存する。
--    set search_path = ''へ変更し完全修飾する。
create or replace function public.finalize_ai_generation_success(
  p_request_id uuid,p_menu jsonb,p_preference_snapshot jsonb,p_safety_snapshot jsonb,
  p_safety_fingerprint text,p_allergen_version text,p_food_rule_version text,
  p_target_members jsonb,p_expired_checks jsonb,
  p_source_menu_id uuid,p_change_reason text,p_change_reason_custom text,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_request private.ai_generation_requests;
  v_menu_id uuid;
  v_submission_target_mode text;
begin
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'request_not_found'; end if;
  if v_request.status <> 'processing' then return private.ai_request_payload(v_request, true); end if;
  if not v_request.user_quota_reserved then
    raise exception using errcode = '23514', message = 'user_reservation_missing';
  end if;
  -- Task 3→4 開発時ブリッジ: この経路が扱う凍結提出は household だけ。
  if v_request.draft_id is not null and v_request.draft_revision is not null then
    select target_mode into v_submission_target_mode
    from private.generation_draft_submission_versions
    where draft_id = v_request.draft_id
      and user_id = v_request.user_id
      and draft_revision = v_request.draft_revision;
    if v_submission_target_mode is distinct from 'household' then
      raise exception using errcode = '22023', message = 'unsupported_target_mode';
    end if;
  end if;
  perform private.lock_and_assert_current_safety_fingerprint(
    v_request.user_id,
    array(select (target->>'householdMemberId')::uuid
      from pg_catalog.jsonb_array_elements(p_target_members) as targets(target)),
    p_safety_fingerprint
  );
  v_menu_id := private.persist_validated_menu(
    v_request,p_menu,p_preference_snapshot,p_safety_snapshot,p_safety_fingerprint,
    p_allergen_version,p_food_rule_version,'household',p_target_members,p_expired_checks
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
  update private.ai_user_daily_usage set
    reserved_count = reserved_count - 1, success_count = success_count + 1, updated_at = p_now
  where user_id = v_request.user_id and usage_day = v_request.user_usage_day and reserved_count > 0;
  if not found then raise exception using errcode = '23514', message = 'user_reservation_corrupt'; end if;
  if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
    update private.ai_user_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where user_id = v_request.user_id and usage_day = v_request.user_attempt_day;
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
$$;

revoke all on function public.finalize_ai_generation_success(
  uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.finalize_ai_generation_success(
  uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz
) to service_role;

-- 8. public.get_ai_generation_submission_snapshot: 戻り値shapeへtarget_mode/servingsを
--    追加する（戻り値が変わるためDROP後にCREATE）。set search_path = ''へ変更し完全修飾する。
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
