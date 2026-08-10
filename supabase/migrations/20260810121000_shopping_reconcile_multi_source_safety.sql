-- SHOP5: apply_shopping_reconciliation で active list の全 live source を append と同型 lock する。
-- 従来は p_source_menu_id 単一だけ lock しており、service assert 後〜SQL commit 間に
-- 他 source が invalid 化しても reconcile 200 になり得た。dead source (menu_id null) も拒否。
-- 最新定義ベース: 20260801170000_shopping_reconcile_defer_version_stamp.sql
-- grants / 署名 / RLS は変更しない（create or replace + 再 grant のみ）。

create or replace function public.apply_shopping_reconciliation(
  p_user_id uuid,p_list_id uuid,p_expected_list_version integer,p_source_menu_id uuid,
  p_source_menu_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_resolved_diff jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_hash text; v_saved private.shopping_mutations; v_list public.shopping_lists;
  v_menu public.menus; v_id uuid; v_source_id uuid; v_label jsonb; v_response jsonb;
  v_stamp boolean; v_existing record; v_current text;
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
    -- 対象 menu は client expected FP で後段 lock。他 source は live FP で自己一致 lock。
    if v_existing.menu_id is distinct from p_source_menu_id then
      v_current:=public.shopping_safety_fingerprint(p_user_id,v_existing.menu_id);
      perform private.lock_and_check_shopping_safety(p_user_id,v_existing.menu_id,v_current);
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
