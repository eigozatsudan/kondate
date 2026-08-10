-- SHOP7 の live-FP early-replay は SHOP10 と衝突するため撤回する。
-- 適用済み mutation の early replay は client expected FP で safety を再確認し、
-- 世帯変更後の同一 key 再送を shopping_safety_fingerprint_changed で fail-closed する（SHOP10）。
-- sticky 失応答の復旧はクライアント側（safety 変化で clear / revalidate）に任せる。
-- ベース: 20260801180000_mutate_shopping_item_replay_safety.sql

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
