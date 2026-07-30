-- SP-1: undo は is_removed_by_user のみ戻す（is_manually_edited は単調 provenance）。
-- SP-3: append は既存 source の menu_id null（出典削除）がある active list を拒否する。
-- 最新定義ベース: 20260728142000 (mutate) / 20260722234554 (apply_shopping_draft)

create or replace function private.enforce_shopping_item_provenance()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $function$
begin
  if old.is_manual <> new.is_manual then
    raise exception using errcode='22023',message='shopping_provenance_is_monotonic';
  end if;
  -- is_manually_edited は単調。false への遷移を拒否する。
  -- remove は is_manually_edited を立てないため、undo でクリアする必要はない。
  if old.is_manually_edited and not new.is_manually_edited then
    raise exception using errcode='22023',message='shopping_provenance_is_monotonic';
  end if;
  return new;
end;
$function$;

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

  select * into v_saved from private.shopping_mutations
    where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if found and v_saved.created_at >= pg_catalog.now() - interval '30 days' then
    if v_saved.request_hash<>v_hash then
      raise exception using errcode='22023',message='idempotency_payload_mismatch';
    end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;

  perform private.lock_and_check_shopping_list_safety(
    v_user_id,p_list_id,p_expected_safety_fingerprint
  );
  select * into v_list from public.shopping_lists
    where id=p_list_id and user_id=v_user_id and status='active' for update;
  if v_list.id is null or v_list.version<>p_expected_list_version then
    raise exception using errcode='P0001',message='list_version_conflict';
  end if;

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
      when 'remove', 'mark_at_home' then
        -- SP-I5: 手動も soft-delete。SP-I4: is_manually_edited は立てない（is_removed_by_user で保護）。
        update public.shopping_items set is_removed_by_user=true,updated_at=pg_catalog.now()
          where id=v_item.id and user_id=v_user_id;
      when 'undo' then
        if not v_item.is_removed_by_user then
          raise exception using errcode='22023',message='invalid_item_mutation';
        end if;
        -- SP-1: 編集済み provenance は単調。remove 取り消しでは is_removed_by_user のみ戻す。
        update public.shopping_items
          set is_removed_by_user=false,
              updated_at=pg_catalog.now()
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
    -- SP-3: 出典削除で menu_id が null の source がある active list への append を拒否。
    -- 回復は mode=new（archive + create）のみ。
    if exists (
      select 1 from public.shopping_list_sources
      where list_id = v_active.id
        and user_id = p_user_id
        and menu_id is null
    ) then
      raise exception using errcode='P0001',message='list_unverifiable';
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
