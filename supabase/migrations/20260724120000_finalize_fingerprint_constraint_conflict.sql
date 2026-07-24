-- P3#1: finalize 時の current safety fingerprint 不一致を
-- failed/internal_error ではなく constraint_conflict/current_safety_changed として
-- 同一 transaction で終端化する（献立未作成・成功予約のみ解放・sent 枠は返還しない）。

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
  v_submission_servings integer;
  v_snapshot private.generation_regeneration_snapshots;
  v_source public.menus;
  v_target_count integer;
begin
  -- lock 順: request FOR UPDATE → snapshot mode → mode 別不変条件 → source → persist → quota
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'request_not_found'; end if;
  if v_request.status <> 'processing' then return private.ai_request_payload(v_request, true); end if;
  if not v_request.user_quota_reserved then
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
    -- idea: 対象 0 件、version null、固定 snapshot/fingerprint、人数一致、家族子行 0
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
    -- fingerprint 不一致は raise のまま abort せず、成功予約解放 + constraint_conflict へ原子的遷移
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
