-- SHOP5: write / add_manual が shoppingItemsMax(500) を超えると parse 不能になる。
-- 契約値は変えない。件数超過は shopping_items_limit_exceeded で拒否する。
-- SHOP6: 他 live source の lock を自己一致 FP から、service が撮った FP へ変える。
-- 欠落は safety_fingerprint_changed で fail-closed。署名 / grants は変えない。

create or replace function private.assert_shopping_items_within_max(
  p_user_id uuid,p_list_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
begin
  -- shoppingItemsMax（shared/contracts/shopping.ts）と同期。値は変えない。
  if (select count(*) from public.shopping_items
        where user_id=p_user_id and list_id=p_list_id) > 500 then
    raise exception using errcode='P0001',message='shopping_items_limit_exceeded';
  end if;
end;
$function$;

revoke all on function private.assert_shopping_items_within_max(uuid,uuid)
  from public,anon,authenticated;

create or replace function private.expected_source_safety_fingerprint(
  p_captured jsonb,p_menu_id uuid
) returns text language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $function$
declare v_expected text;
begin
  if p_captured is null or jsonb_typeof(p_captured) is distinct from 'object' then
    raise exception using errcode='P0001',message='safety_fingerprint_changed';
  end if;
  v_expected:=p_captured->>p_menu_id::text;
  if v_expected is null or length(v_expected)=0 then
    raise exception using errcode='P0001',message='safety_fingerprint_changed';
  end if;
  return v_expected;
end;
$function$;

revoke all on function private.expected_source_safety_fingerprint(jsonb,uuid)
  from public,anon,authenticated;

create or replace function private.write_shopping_items(
  p_user_id uuid,p_list_id uuid,p_items jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_item jsonb; v_source jsonb; v_label jsonb; v_item_id uuid;
begin
  if jsonb_typeof(p_items)<>'array' then
    raise exception using errcode='22023',message='invalid_shopping_items';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_id:=coalesce(nullif(v_item->>'existingItemId','')::uuid,gen_random_uuid());
    insert into public.shopping_items(id,user_id,list_id,display_name,normalized_name,store_section,
      quantity_value,quantity_text,unit,pantry_check_required)
    values(v_item_id,p_user_id,p_list_id,v_item->>'displayName',v_item->>'normalizedName',
      v_item->>'storeSection',nullif(v_item->>'quantityValue','')::numeric,
      v_item->>'quantityText',nullif(v_item->>'unit',''),(v_item->>'pantryCheckRequired')::boolean)
    on conflict(id) do update set
      display_name=excluded.display_name,normalized_name=excluded.normalized_name,
      store_section=excluded.store_section,quantity_value=excluded.quantity_value,
      quantity_text=excluded.quantity_text,unit=excluded.unit,
      pantry_check_required=excluded.pantry_check_required,updated_at=now()
    where public.shopping_items.user_id=p_user_id and public.shopping_items.list_id=p_list_id
      and not(public.shopping_items.is_checked or public.shopping_items.is_manual
        or public.shopping_items.is_manually_edited or public.shopping_items.is_removed_by_user);
    if not found then raise exception using errcode='P0001',message='protected_item_conflict'; end if;
    delete from public.shopping_item_sources where item_id=v_item_id and user_id=p_user_id;
    delete from public.shopping_label_confirmations where item_id=v_item_id and user_id=p_user_id;
    for v_source in select value from jsonb_array_elements(v_item->'sourceIngredients') loop
      insert into public.shopping_item_sources(user_id,item_id,dish_ingredient_id,
        source_ingredient_id_snapshot,source_dish_id_snapshot,source_dish_name,source_name,
        source_quantity_value,source_quantity_text,source_unit)
      values(p_user_id,v_item_id,(v_source->>'ingredientId')::uuid,
        (v_source->>'ingredientId')::uuid,(v_source->>'dishId')::uuid,
        v_source->>'dishName',v_source->>'name',nullif(v_source->>'quantityValue','')::numeric,
        v_source->>'quantityText',nullif(v_source->>'unit',''));
    end loop;
    for v_label in select value from jsonb_array_elements(v_item->'labelWarnings') loop
      insert into public.shopping_label_confirmations(user_id,list_id,item_id,
        menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
        source_menu_id_snapshot,
        source_derivation_group_id,source_type,source_id_snapshot,
        source_path,source_display_name,allergen_id,allergen_display_name,
        anonymous_member_ref,member_display_name,dictionary_version,confirmation_status)
      values(p_user_id,p_list_id,v_item_id,nullif(v_label->>'confirmationId','')::uuid,
        nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
        (v_label->>'sourceMenuId')::uuid,
        (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
        (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
        v_label->>'allergenId',v_label->>'allergenDisplayName',
        v_label->>'anonymousMemberRef',v_label->>'memberDisplayName',v_label->>'dictionaryVersion',
        'pending');
    end loop;
  end loop;
  perform private.assert_shopping_items_within_max(p_user_id,p_list_id);
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
    -- SHOP10: early replay でも list safety を再解釈。invalid なら shopping_safety_fingerprint_changed。
    -- write はしない（保存応答の返すだけ）が、現行 safety が崩れている再生を 200 で通さない。
    perform private.lock_and_check_shopping_list_safety(
      v_user_id,p_list_id,p_expected_safety_fingerprint
    );
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
    -- SHOP5: 既存 500 件への手追加を拒否（契約 shoppingItemsMax）。
    if (select count(*) from public.shopping_items
          where user_id=v_user_id and list_id=p_list_id) >= 500 then
      raise exception using errcode='P0001',message='shopping_items_limit_exceeded';
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
  v_source_id uuid; v_existing record; v_expected text;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_request_hash';
  end if;
  v_hash:=p_request_hash;

  -- 1) 有効期限内 mutation replay を read-only で判定（write/cleanup/row lock なし）
  -- 現行 safety の再解釈は service 層 (SHOP1) が担当する。SQL は冪等応答のみ返す。
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found and v_saved.created_at >= pg_catalog.now() - interval '30 days' then
    if v_saved.request_hash<>v_hash then
      raise exception using errcode='22023',message='idempotency_payload_mismatch';
    end if;
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

  -- 6) shopping safety locks
  -- append: 既存 live source を service が撮った FP で lock。自己一致だと service 後の
  -- allergen 追加を検出できない（SHOP6）。追加 menu は client 期待値で lock。
  if p_mode='append' then
    if v_active.id is null or v_active.id is distinct from p_active_list_id
      or v_active.version is distinct from p_expected_list_version then
      raise exception using errcode='P0001',message='list_version_conflict';
    end if;
    -- SP-3: 出典削除で menu_id が null の source がある active list への append を拒否
    if exists (
      select 1 from public.shopping_list_sources
      where list_id = v_active.id
        and user_id = p_user_id
        and menu_id is null
    ) then
      raise exception using errcode='P0001',message='list_unverifiable';
    end if;
    -- SHOP2: multi-source 全 live source を source_menu_id_snapshot 昇順で lock
    for v_existing in
      select menu_id
      from public.shopping_list_sources
      where list_id = v_active.id
        and user_id = p_user_id
      order by source_menu_id_snapshot
      for share
    loop
      if v_existing.menu_id is null then
        raise exception using errcode='P0001',message='list_unverifiable';
      end if;
      v_expected:=private.expected_source_safety_fingerprint(
        p_draft->'sourceSafetyFingerprints',v_existing.menu_id);
      perform private.lock_and_check_shopping_safety(p_user_id,v_existing.menu_id,v_expected);
    end loop;
  end if;

  -- 追加対象 menu は client が読んだ fingerprint と突き合わせる
  perform private.lock_and_check_shopping_safety(p_user_id,p_menu_id,p_safety_fingerprint);

  -- write phase: 期限切れ cleanup / 同一 key 削除 / list 更新
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<pg_catalog.now()-interval '30 days';

  if p_mode='append' then
    -- version / fingerprint 更新（list 行は step 4 で FOR UPDATE 済み）
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

revoke all on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  to service_role;

create or replace function public.apply_shopping_reconciliation(
  p_user_id uuid,p_list_id uuid,p_expected_list_version integer,p_source_menu_id uuid,
  p_source_menu_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_resolved_diff jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_hash text; v_saved private.shopping_mutations; v_list public.shopping_lists;
  v_menu public.menus; v_id uuid; v_source_id uuid; v_label jsonb; v_response jsonb;
  v_stamp boolean; v_existing record; v_expected text;
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

  -- SHOP5: dead source 拒否 + 他 live source を snapshot 順で lock（append と同型）
  if exists (
    select 1 from public.shopping_list_sources
    where list_id = p_list_id
      and user_id = p_user_id
      and menu_id is null
  ) then
    raise exception using errcode='P0001',message='list_unverifiable';
  end if;
  for v_existing in
    select menu_id
    from public.shopping_list_sources
    where list_id = p_list_id
      and user_id = p_user_id
    order by source_menu_id_snapshot
    for share
  loop
    if v_existing.menu_id is null then
      raise exception using errcode='P0001',message='list_unverifiable';
    end if;
    -- 対象 menu は client expected FP で後段 lock。他 source は service 撮影 FP（SHOP6）。
    if v_existing.menu_id is distinct from p_source_menu_id then
      v_expected:=private.expected_source_safety_fingerprint(
        p_resolved_diff->'sourceSafetyFingerprints',v_existing.menu_id);
      perform private.lock_and_check_shopping_safety(p_user_id,v_existing.menu_id,v_expected);
    end if;
  end loop;

  perform private.lock_and_check_shopping_safety(p_user_id,p_source_menu_id,p_safety_fingerprint);

  -- write phase
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<pg_catalog.now()-interval '30 days';

  -- R1: stampSourceVersion=false（未承認 remove 残存）のとき版刻印を延期。
  -- 欠落時は true（fail-closed で従来どおり刻印）。
  v_stamp:=coalesce((p_resolved_diff->>'stampSourceVersion')::boolean,true);
  if v_stamp then
    insert into public.shopping_list_sources(user_id,list_id,menu_id,source_menu_id_snapshot,
      source_menu_version,source_derivation_group_id)
    values(p_user_id,p_list_id,v_menu.id,v_menu.id,v_menu.version,v_menu.derivation_group_id)
    on conflict(list_id,source_menu_id_snapshot,source_menu_version) do nothing
    returning id into v_source_id;
    if v_source_id is null then
      -- 既刻印: add/replace を含む再 reconcile は拒否（SHOP2）。
      -- remove のみの追従は旧実装残差（remove 未選択のまま刻印）を閉じるために許可。
      if coalesce(pg_catalog.jsonb_array_length(p_resolved_diff->'add'),0)=0
         and coalesce(pg_catalog.jsonb_array_length(p_resolved_diff->'replace'),0)=0
         and coalesce(pg_catalog.jsonb_array_length(p_resolved_diff->'removeIds'),0)>0 then
        null;
      else
        raise exception using errcode='23505',message='menu_version_already_in_list';
      end if;
    end if;
  end if;
  -- SHOP7: 対象 derivation group の current projection のみ消す（他 source を温存）
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id
      and source_derivation_group_id=v_menu.derivation_group_id;
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

revoke all on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  to service_role;
