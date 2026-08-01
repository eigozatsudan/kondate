-- SHOP2: append 時に active list の全 live source を safety lock する。
-- 従来は p_menu_id 単一だけ lock しており、他 source が current-safety invalid
-- 相当でも append が通り得た。dead source (menu_id is null) 拒否は維持。
-- 最新定義ベース: 20260730130000_shopping_undo_edited_and_dead_append.sql

create or replace function public.apply_shopping_draft(
  p_user_id uuid,p_menu_id uuid,p_mode text,p_active_list_id uuid,
  p_expected_list_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_draft jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_hash text; v_saved private.shopping_mutations; v_active public.shopping_lists;
  v_list public.shopping_lists; v_menu public.menus; v_label jsonb; v_response jsonb;
  v_source_id uuid; v_existing record; v_current text;
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
  -- append: 既存 live source を現行 fingerprint でロックしてから、追加 menu を client 期待値でロック
  -- new: 単一 source = この menu のみ
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
      v_current:=public.shopping_safety_fingerprint(p_user_id,v_existing.menu_id);
      perform private.lock_and_check_shopping_safety(p_user_id,v_existing.menu_id,v_current);
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
