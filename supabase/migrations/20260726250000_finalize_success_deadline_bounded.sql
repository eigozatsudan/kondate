-- I1: finalize_ai_generation_success を残 deadline 付きで呼ぶ薄い wrapper。
-- 同一 RPC セッション（同一 transaction）で SET LOCAL statement_timeout を張り、
-- finalizer 本体が予算超過しても成功保存を確定させない。
-- 既存 finalize の署名・本体は変更しない。

create or replace function public.finalize_ai_generation_success_deadline_bounded(
  p_timeout_ms integer,
  p_request_id uuid,
  p_menu jsonb,
  p_preference_snapshot jsonb,
  p_safety_snapshot jsonb,
  p_safety_fingerprint text,
  p_allergen_version text,
  p_food_rule_version text,
  p_target_members jsonb,
  p_expired_checks jsonb,
  p_source_menu_id uuid,
  p_change_reason text,
  p_change_reason_custom text,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 残 0 以下は DB 作業に入らず即 cancel（入口ゲート漏れの二重防御）
  if p_timeout_ms is null or p_timeout_ms <= 0 then
    raise exception using
      errcode = '57014',
      message = 'generation_timeout';
  end if;

  -- is_local=true: この RPC トランザクションだけに効く。共有プールの他接続へは漏れない。
  perform pg_catalog.set_config(
    'statement_timeout',
    p_timeout_ms::text || 'ms',
    true
  );

  return public.finalize_ai_generation_success(
    p_request_id,
    p_menu,
    p_preference_snapshot,
    p_safety_snapshot,
    p_safety_fingerprint,
    p_allergen_version,
    p_food_rule_version,
    p_target_members,
    p_expired_checks,
    p_source_menu_id,
    p_change_reason,
    p_change_reason_custom,
    p_now
  );
end;
$$;

revoke all on function public.finalize_ai_generation_success_deadline_bounded(
  integer, uuid, jsonb, jsonb, jsonb, text, text, text, jsonb, jsonb, uuid, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.finalize_ai_generation_success_deadline_bounded(
  integer, uuid, jsonb, jsonb, jsonb, text, text, text, jsonb, jsonb, uuid, text, text, timestamptz
) to service_role;
