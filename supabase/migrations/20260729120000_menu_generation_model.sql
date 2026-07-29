-- 献立結果画面で「生成に使ったモデル」を所有者だけに返す。
-- 実体は private.ai_generation_requests.actual_model_ids（service 専用台帳）。
-- メニューに紐づく succeeded 行は cleanup 対象外のため、献立が残る間は参照できる。
-- ブラウザが private 台帳を直接読めないため、所有者検証付き SECURITY DEFINER で投影する。

create or replace function public.get_menu_generation_model(p_menu_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_model text;
begin
  if v_uid is null or p_menu_id is null then
    return null;
  end if;

  -- 所有者以外には存在も漏らさない（null 返却）
  if not exists (
    select 1
    from public.menus menu
    where menu.id = p_menu_id
      and menu.user_id = v_uid
  ) then
    return null;
  end if;

  -- repair で複数モデルが載る場合は配列末尾＝最終成功モデルを採用する
  select request.actual_model_ids[cardinality(request.actual_model_ids)]
  into v_model
  from private.ai_generation_requests request
  where request.completed_menu_id = p_menu_id
    and request.user_id = v_uid
    and request.status = 'succeeded'
    and cardinality(request.actual_model_ids) > 0
  order by request.completed_at desc nulls last, request.id desc
  limit 1;

  if v_model is null or btrim(v_model) = '' or length(v_model) > 200 then
    return null;
  end if;

  return v_model;
end;
$function$;

revoke all on function public.get_menu_generation_model(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_menu_generation_model(uuid)
  to authenticated, service_role;

comment on function public.get_menu_generation_model(uuid) is
  '所有者セッション向け: 献立を生成した最終 OpenRouter model ID（無ければ null）';
