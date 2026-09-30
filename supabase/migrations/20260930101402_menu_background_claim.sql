-- command/JWT は永続化せず、内部呼出だけの token と一度だけの claim を保存する。
alter table private.ai_generation_requests
  add column background_dispatch_token uuid,
  add column background_claimed_at timestamptz;

create function public.register_menu_background_dispatch(p_user_id uuid, p_request_id uuid, p_token uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_request private.ai_generation_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_user_id is null or p_request_id is null or p_token is null then raise invalid_parameter_value; end if;
  select * into v_request from private.ai_generation_requests where id = p_request_id and user_id = p_user_id for update;
  if not found or v_request.request_kind not in ('new_menu', 'regenerate_menu') then
    return jsonb_build_object('token', null, 'claimed', false);
  end if;
  if v_request.status <> 'processing' or v_request.started_at > now() or v_request.processing_expires_at <= now() then
    return jsonb_build_object('token', null, 'claimed', false);
  end if;
  if v_request.background_claimed_at is not null then return jsonb_build_object('token', null, 'claimed', true); end if;
  update private.ai_generation_requests set background_dispatch_token = coalesce(background_dispatch_token, p_token)
    where id = p_request_id returning * into v_request;
  return jsonb_build_object('token', v_request.background_dispatch_token, 'claimed', false);
end;
$$;

create function public.claim_menu_background_dispatch(p_user_id uuid, p_request_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_user_id is null or p_request_id is null or p_token is null then raise invalid_parameter_value; end if;
  -- 単一 UPDATE の行ロックにより再試行と同時 dispatch の双方を一回へ閉じる。
  update private.ai_generation_requests set background_claimed_at = now()
    where id = p_request_id and user_id = p_user_id and background_dispatch_token = p_token
      and background_claimed_at is null and status = 'processing'
      and request_kind in ('new_menu', 'regenerate_menu')
      and started_at <= now() and started_at + interval '120 seconds' > now()
      and processing_expires_at > now();
  return found;
end;
$$;

revoke all on function public.register_menu_background_dispatch(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_menu_background_dispatch(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_menu_background_dispatch(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_menu_background_dispatch(uuid, uuid, uuid) to service_role;
