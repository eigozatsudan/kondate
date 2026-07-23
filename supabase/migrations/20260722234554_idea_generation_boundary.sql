-- Task 5: アイデア生成の安全境界
-- - private.idea_safety_fingerprint(): 固定 canonical JSON の SHA-256
-- - finalize_ai_generation_success: v2 snapshot mode 分岐（idea は家族 lock なし）
-- - shopping apply/reconcile: replay-first → lockなし identity → idea 拒否 → lock 順統一

-- ---------------------------------------------------------------------------
-- 1. idea 固定 fingerprint helper（家族表・catalog を読まない）
-- ---------------------------------------------------------------------------
create or replace function private.idea_safety_fingerprint()
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      pg_catalog.convert_to('{"assurance":"none","members":[],"mode":"idea"}', 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.idea_safety_fingerprint() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. finalize_ai_generation_success: mode 別不変条件
--    signature / 戻り値は維持。search_path は空へ固定。
-- ---------------------------------------------------------------------------
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
    perform private.lock_and_assert_current_safety_fingerprint(
      v_request.user_id,
      array(select (target->>'householdMemberId')::uuid
        from pg_catalog.jsonb_array_elements(p_target_members) as targets(target)),
      p_safety_fingerprint
    );
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

-- ---------------------------------------------------------------------------
-- 3. shopping list safety helper: active list → sources FOR SHARE → safety 昇順
-- ---------------------------------------------------------------------------
create or replace function private.lock_and_check_shopping_list_safety(
  p_user_id uuid,p_list_id uuid,p_expected text
) returns void language plpgsql security definer set search_path = ''
as $function$
declare v_source record;v_current text;
begin
  -- active list を先に FOR UPDATE（呼出し手ごとに source 先行させない）
  perform 1 from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active' for update;
  if not found then raise exception using errcode='P0002',message='shopping_list_not_found'; end if;
  for v_source in
    select menu_id
    from public.shopping_list_sources
    where list_id=p_list_id and user_id=p_user_id
    order by source_menu_id_snapshot
    for share
  loop
    if v_source.menu_id is null then
      raise exception using errcode='P0001',message='shopping_safety_fingerprint_changed';
    end if;
    -- menu id 昇順で safety lock（source_menu_id_snapshot 順）
    v_current:=public.shopping_safety_fingerprint(p_user_id,v_source.menu_id);
    perform private.lock_and_check_shopping_safety(p_user_id,v_source.menu_id,v_current);
  end loop;
  if public.shopping_list_safety_fingerprint(p_user_id,p_list_id) is distinct from p_expected then
    raise exception using errcode='P0001',message='shopping_safety_fingerprint_changed';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. apply_shopping_draft: replay → identity owner/version/mode → locks → writes
-- ---------------------------------------------------------------------------
create or replace function public.apply_shopping_draft(
  p_user_id uuid,p_menu_id uuid,p_mode text,p_active_list_id uuid,
  p_expected_list_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_draft jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_hash text; v_saved private.shopping_mutations; v_active public.shopping_lists;
  v_list public.shopping_lists; v_menu public.menus; v_label jsonb; v_response jsonb;
  v_source_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_request_hash';
  end if;
  v_hash:=p_request_hash;

  -- 1) 有効期限内 mutation replay を read-only で判定（write/cleanup/row lock なし）
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found and v_saved.created_at >= pg_catalog.now() - interval '30 days' then
    if v_saved.request_hash<>v_hash then
      raise exception using errcode='22023',message='idempotency_payload_mismatch';
    end if;
    -- live mode を再解釈せず保存済み成功を返す
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;

  if p_mode not in('new','append') or jsonb_typeof(p_draft->'items')<>'array'
    or jsonb_typeof(p_draft->'listLabelWarnings')<>'array' then
    raise exception using errcode='22023',message='invalid_shopping_draft';
  end if;

  -- 2) lock なし identity: owner / mode（version は draft では現行を採用）
  select * into v_menu from public.menus where id=p_menu_id and user_id=p_user_id;
  if not found then
    raise exception using errcode='P0002',message='menu_not_found';
  end if;
  -- 3) idea は write/row lock 前に拒否
  if v_menu.target_mode <> 'household' then
    raise exception using errcode='22023',message='idea_menu_not_supported';
  end if;

  -- 4) active list FOR UPDATE（存在時）。初回 new list の直列化もこの位置で維持
  select * into v_active from public.shopping_lists
    where user_id=p_user_id and status='active' for update;

  -- 5) menu FOR SHARE 再確認 + mode 再検査
  select * into v_menu from public.menus where id=p_menu_id and user_id=p_user_id for share;
  if not found then
    raise exception using errcode='P0002',message='menu_not_found';
  end if;
  if v_menu.target_mode <> 'household' then
    raise exception using errcode='22023',message='idea_menu_not_supported';
  end if;

  -- 6) shopping safety locks（単一 source = この menu）
  perform private.lock_and_check_shopping_safety(p_user_id,p_menu_id,p_safety_fingerprint);

  -- write phase: 期限切れ cleanup / 同一 key 削除 / list 更新
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<pg_catalog.now()-interval '30 days';

  if p_mode='append' then
    if v_active.id is null or v_active.id is distinct from p_active_list_id
      or v_active.version is distinct from p_expected_list_version then
      raise exception using errcode='P0001',message='list_version_conflict';
    end if;
    update public.shopping_lists set version=version+1,safety_fingerprint=p_safety_fingerprint,
      updated_at=pg_catalog.now() where id=v_active.id returning * into v_list;
  else
    if v_active.id is null then
      if p_active_list_id is not null or p_expected_list_version is not null then
        raise exception using errcode='P0001',message='list_version_conflict';
      end if;
    else
      if v_active.id is distinct from p_active_list_id
        or v_active.version is distinct from p_expected_list_version then
        raise exception using errcode='P0001',message='list_version_conflict';
      end if;
      update public.shopping_lists set status='archived',updated_at=pg_catalog.now()
        where id=v_active.id;
    end if;
    insert into public.shopping_lists(user_id,safety_fingerprint)
      values(p_user_id,p_safety_fingerprint) returning * into v_list;
  end if;
  insert into public.shopping_list_sources(user_id,list_id,menu_id,source_menu_id_snapshot,
    source_menu_version,source_derivation_group_id)
  values(p_user_id,v_list.id,v_menu.id,v_menu.id,v_menu.version,v_menu.derivation_group_id)
  on conflict(list_id,source_menu_id_snapshot,source_menu_version) do nothing
  returning id into v_source_id;
  if v_source_id is null then
    raise exception using errcode='23505',message='menu_version_already_in_list';
  end if;
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=v_list.id;
  perform private.write_shopping_items(p_user_id,v_list.id,p_draft->'items');
  for v_label in select value from pg_catalog.jsonb_array_elements(p_draft->'listLabelWarnings') loop
    insert into public.shopping_label_confirmations(user_id,list_id,item_id,
      menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
      source_menu_id_snapshot,
      source_derivation_group_id,source_type,source_id_snapshot,
      source_path,source_display_name,allergen_id,allergen_display_name,
      anonymous_member_ref,member_display_name,dictionary_version,confirmation_status)
    values(p_user_id,v_list.id,null,nullif(v_label->>'confirmationId','')::uuid,
      nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
      (v_label->>'sourceMenuId')::uuid,
      (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
      (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
      v_label->>'allergenId',v_label->>'allergenDisplayName',v_label->>'anonymousMemberRef',
      v_label->>'memberDisplayName',v_label->>'dictionaryVersion','pending');
  end loop;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,'replayed',false);
  insert into private.shopping_mutations values(p_user_id,p_idempotency_key,v_hash,v_response,pg_catalog.now());
  return v_response;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. apply_shopping_reconciliation: 同じ global lock 順
-- ---------------------------------------------------------------------------
create or replace function public.apply_shopping_reconciliation(
  p_user_id uuid,p_list_id uuid,p_expected_list_version integer,p_source_menu_id uuid,
  p_source_menu_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_resolved_diff jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_hash text; v_saved private.shopping_mutations; v_list public.shopping_lists;
  v_menu public.menus; v_id uuid; v_source_id uuid; v_label jsonb; v_response jsonb;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_request_hash';
  end if;
  v_hash:=p_request_hash;

  -- read-only replay
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found and v_saved.created_at >= pg_catalog.now() - interval '30 days' then
    if v_saved.request_hash<>v_hash then
      raise exception using errcode='22023',message='idempotency_payload_mismatch';
    end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;

  -- lock なし identity: owner + expected version + mode
  select * into v_menu from public.menus
    where id=p_source_menu_id and user_id=p_user_id;
  if not found then
    raise exception using errcode='P0002',message='source_menu_version_conflict';
  end if;
  if v_menu.version is distinct from p_source_menu_version then
    raise exception using errcode='P0002',message='source_menu_version_conflict';
  end if;
  if v_menu.target_mode <> 'household' then
    raise exception using errcode='22023',message='idea_menu_not_supported';
  end if;

  -- active list FOR UPDATE
  select * into v_list from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active' for update;
  if v_list.id is null or v_list.version<>p_expected_list_version then
    raise exception using errcode='P0001',message='list_version_conflict';
  end if;

  -- source menu FOR SHARE 再確認
  select * into v_menu from public.menus
    where id=p_source_menu_id and user_id=p_user_id and version=p_source_menu_version for share;
  if not found then
    raise exception using errcode='P0002',message='source_menu_version_conflict';
  end if;
  if v_menu.target_mode <> 'household' then
    raise exception using errcode='22023',message='idea_menu_not_supported';
  end if;

  perform private.lock_and_check_shopping_safety(p_user_id,p_source_menu_id,p_safety_fingerprint);

  -- write phase
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<pg_catalog.now()-interval '30 days';

  insert into public.shopping_list_sources(user_id,list_id,menu_id,source_menu_id_snapshot,
    source_menu_version,source_derivation_group_id)
  values(p_user_id,p_list_id,v_menu.id,v_menu.id,v_menu.version,v_menu.derivation_group_id)
  on conflict(list_id,source_menu_id_snapshot,source_menu_version) do nothing
  returning id into v_source_id;
  if v_source_id is null then
    raise exception using errcode='23505',message='menu_version_already_in_list';
  end if;
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  for v_id in select (value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_resolved_diff->'removeIds') loop
    if exists(select 1 from public.shopping_items where id=v_id and user_id=p_user_id
      and (is_checked or is_manual or is_manually_edited or is_removed_by_user)) then
      raise exception using errcode='P0001',message='protected_item_conflict';
    end if;
    delete from public.shopping_items where id=v_id and user_id=p_user_id and list_id=p_list_id;
  end loop;
  perform private.write_shopping_items(p_user_id,p_list_id,p_resolved_diff->'replace');
  perform private.write_shopping_items(p_user_id,p_list_id,p_resolved_diff->'add');
  delete from public.shopping_label_confirmations
    where user_id=p_user_id and list_id=p_list_id and item_id is null
      and source_derivation_group_id=v_menu.derivation_group_id;
  for v_label in select value from pg_catalog.jsonb_array_elements(p_resolved_diff->'listLabelWarnings') loop
    insert into public.shopping_label_confirmations(user_id,list_id,item_id,
      menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
      source_menu_id_snapshot,
      source_derivation_group_id,source_type,source_id_snapshot,source_path,source_display_name,
      allergen_id,allergen_display_name,anonymous_member_ref,member_display_name,
      dictionary_version,confirmation_status)
    values(p_user_id,p_list_id,null,nullif(v_label->>'confirmationId','')::uuid,
      nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
      (v_label->>'sourceMenuId')::uuid,
      (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
      (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
      v_label->>'allergenId',v_label->>'allergenDisplayName',v_label->>'anonymousMemberRef',
      v_label->>'memberDisplayName',v_label->>'dictionaryVersion','pending');
  end loop;
  update public.shopping_lists set version=version+1,safety_fingerprint=p_safety_fingerprint,
    updated_at=pg_catalog.now() where id=p_list_id returning * into v_list;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,'replayed',false);
  insert into private.shopping_mutations values(p_user_id,p_idempotency_key,v_hash,v_response,pg_catalog.now());
  return v_response;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. refresh_shopping_list_safety: list lock → sources → safety → write
--    （cleanup なし。replay なし）
-- ---------------------------------------------------------------------------
create or replace function public.refresh_shopping_list_safety(
  p_user_id uuid,p_list_id uuid,p_expected_fingerprint text,p_warnings jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_warning jsonb;v_item_user uuid;v_projection jsonb;
begin
  if jsonb_typeof(p_warnings) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_shopping_warnings';
  end if;
  if jsonb_array_length(p_warnings)>300 then
    raise exception using errcode='22023',message='invalid_shopping_warnings';
  end if;
  -- helper が active list FOR UPDATE → sources FOR SHARE → safety 昇順
  perform private.lock_and_check_shopping_list_safety(
    p_user_id,p_list_id,p_expected_fingerprint);
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  for v_warning in select value from pg_catalog.jsonb_array_elements(p_warnings) loop
    if jsonb_typeof(v_warning) is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    if not (v_warning ?& array['warningKey','sourceMenuId','sourceDerivationGroupId',
      'sourceType','sourceId','sourcePath','sourceDisplayName','allergenId',
      'allergenDisplayName','anonymousMemberRef','memberDisplayName','dictionaryVersion','itemId'])
      or v_warning-array['warningKey','sourceMenuId','sourceDerivationGroupId',
        'sourceType','sourceId','sourcePath','sourceDisplayName','allergenId',
        'allergenDisplayName','anonymousMemberRef','memberDisplayName','dictionaryVersion','itemId']
          <> '{}'::jsonb then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    if nullif(v_warning->>'itemId','') is not null then
      select user_id into v_item_user from public.shopping_items
        where id=(v_warning->>'itemId')::uuid and list_id=p_list_id and user_id=p_user_id for share;
      if v_item_user is distinct from p_user_id then
        raise exception using errcode='22023',message='invalid_shopping_warnings';
      end if;
    end if;
    if not exists(select 1 from public.shopping_list_sources where user_id=p_user_id
      and list_id=p_list_id and menu_id=(v_warning->>'sourceMenuId')::uuid for share) then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    insert into public.shopping_current_label_warnings(user_id,list_id,item_id,
      warning_key,source_menu_id,source_derivation_group_id,source_type,source_id,
      source_path,source_display_name,allergen_id,allergen_display_name,
      anonymous_member_ref,member_display_name,dictionary_version)
    values(p_user_id,p_list_id,nullif(v_warning->>'itemId','')::uuid,
      v_warning->>'warningKey',
      (v_warning->>'sourceMenuId')::uuid,(v_warning->>'sourceDerivationGroupId')::uuid,
      v_warning->>'sourceType',(v_warning->>'sourceId')::uuid,v_warning->>'sourcePath',
      v_warning->>'sourceDisplayName',v_warning->>'allergenId',
      v_warning->>'allergenDisplayName',v_warning->>'anonymousMemberRef',
      v_warning->>'memberDisplayName',v_warning->>'dictionaryVersion');
  end loop;
  update public.shopping_lists set safety_fingerprint=p_expected_fingerprint,updated_at=pg_catalog.now()
    where id=p_list_id and user_id=p_user_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId',item_id,'warningKey',warning_key,'sourceMenuId',source_menu_id,
      'sourceDerivationGroupId',source_derivation_group_id,'sourceType',source_type,
      'sourceId',source_id,'sourcePath',source_path,'sourceDisplayName',source_display_name,
      'allergenId',allergen_id,'allergenDisplayName',allergen_display_name,
      'anonymousMemberRef',anonymous_member_ref,'memberDisplayName',member_display_name,
      'dictionaryVersion',dictionary_version
    ) order by warning_key,item_id nulls first),'[]'::jsonb) into v_projection
    from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  return jsonb_build_object('listId',p_list_id,'safetyFingerprint',p_expected_fingerprint,
    'currentLabelWarnings',v_projection);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. mutate_shopping_item: replay → list safety order → write（cleanup は write 側）
-- ---------------------------------------------------------------------------
create or replace function public.mutate_shopping_item(
  p_list_id uuid,p_expected_list_version integer,p_expected_safety_fingerprint text,
  p_operation text,p_item_id uuid,
  p_idempotency_key uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid:=(select auth.uid());v_saved private.shopping_mutations;
  v_list public.shopping_lists;v_item public.shopping_items;v_item_id uuid;v_response jsonb;v_hash text;
begin
  if v_user_id is null then raise exception using errcode='42501',message='auth_required'; end if;
  if jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023',message='invalid_item_mutation';
  end if;
  v_hash:=encode(extensions.digest(pg_catalog.convert_to(jsonb_build_object('listId',p_list_id,
    'expectedListVersion',p_expected_list_version,
    'expectedSafetyFingerprint',p_expected_safety_fingerprint,'operation',p_operation,
    'itemId',p_item_id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');

  -- read-only replay
  select * into v_saved from private.shopping_mutations
    where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if found and v_saved.created_at >= pg_catalog.now() - interval '30 days' then
    if v_saved.request_hash<>v_hash then
      raise exception using errcode='22023',message='idempotency_payload_mismatch';
    end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;

  -- list → sources → safety（helper 内）
  perform private.lock_and_check_shopping_list_safety(
    v_user_id,p_list_id,p_expected_safety_fingerprint
  );
  select * into v_list from public.shopping_lists
    where id=p_list_id and user_id=v_user_id and status='active' for update;
  if v_list.id is null or v_list.version<>p_expected_list_version then
    raise exception using errcode='P0001',message='list_version_conflict';
  end if;

  -- write phase
  perform private.cleanup_expired_shopping_mutations(v_user_id,100);
  delete from private.shopping_mutations where user_id=v_user_id
    and idempotency_key=p_idempotency_key and created_at<pg_catalog.now()-interval '30 days';

  if p_operation='add_manual' then
    if p_item_id is not null or not (p_payload ?& array[
      'displayName','normalizedName','storeSection','quantityText','pantryCheckRequired']) then
      raise exception using errcode='22023',message='invalid_item_mutation';
    end if;
    insert into public.shopping_items(user_id,list_id,display_name,normalized_name,store_section,
      quantity_value,quantity_text,unit,pantry_check_required,is_manual)
    values(v_user_id,p_list_id,p_payload->>'displayName',p_payload->>'normalizedName',
      p_payload->>'storeSection',nullif(p_payload->>'quantityValue','')::numeric,
      p_payload->>'quantityText',nullif(p_payload->>'unit',''),
      (p_payload->>'pantryCheckRequired')::boolean,true) returning id into v_item_id;
  else
    select * into v_item from public.shopping_items
      where id=p_item_id and list_id=p_list_id and user_id=v_user_id for update;
    if v_item.id is null then raise exception using errcode='P0002',message='shopping_item_not_found'; end if;
    v_item_id:=v_item.id;
    case p_operation
      when 'set_checked' then
        update public.shopping_items set is_checked=(p_payload->>'isChecked')::boolean,updated_at=pg_catalog.now()
          where id=v_item.id and user_id=v_user_id;
      when 'edit' then
        update public.shopping_items set display_name=p_payload->>'displayName',
          normalized_name=p_payload->>'normalizedName',store_section=p_payload->>'storeSection',
          quantity_value=nullif(p_payload->>'quantityValue','')::numeric,
          quantity_text=p_payload->>'quantityText',unit=nullif(p_payload->>'unit',''),
          is_manually_edited=true,updated_at=pg_catalog.now()
          where id=v_item.id and user_id=v_user_id;
      when 'remove' then
        if v_item.is_manual then
          delete from public.shopping_items where id=v_item.id and user_id=v_user_id;
        else
          update public.shopping_items set is_removed_by_user=true,is_manually_edited=true,
            updated_at=pg_catalog.now() where id=v_item.id and user_id=v_user_id;
        end if;
      when 'mark_at_home' then
        if v_item.is_manual then
          delete from public.shopping_items where id=v_item.id and user_id=v_user_id;
        else
          update public.shopping_items set is_removed_by_user=true,is_manually_edited=true,
            updated_at=pg_catalog.now() where id=v_item.id and user_id=v_user_id;
        end if;
      when 'undo' then
        if v_item.is_manual or not v_item.is_removed_by_user then
          raise exception using errcode='22023',message='invalid_item_mutation';
        end if;
        update public.shopping_items set is_removed_by_user=false,updated_at=pg_catalog.now()
          where id=v_item.id and user_id=v_user_id;
      else raise exception using errcode='22023',message='invalid_item_mutation';
    end case;
  end if;
  update public.shopping_lists set version=version+1,updated_at=pg_catalog.now()
    where id=p_list_id and user_id=v_user_id returning * into v_list;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,
    'itemId',v_item_id,'replayed',false);
  insert into private.shopping_mutations values(v_user_id,p_idempotency_key,v_hash,v_response,pg_catalog.now());
  return v_response;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. revoke/grant 再宣言（signature 維持）
-- ---------------------------------------------------------------------------
revoke all on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.refresh_shopping_list_safety(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)
  from public,anon;
grant execute on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  to service_role;
grant execute on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  to service_role;
grant execute on function public.refresh_shopping_list_safety(uuid,uuid,text,jsonb)
  to service_role;
grant execute on function public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)
  to authenticated;
revoke all on function private.lock_and_check_shopping_list_safety(uuid,uuid,text)
  from public,anon,authenticated,service_role;
