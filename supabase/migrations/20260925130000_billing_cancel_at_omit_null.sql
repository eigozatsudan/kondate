-- UX 残り R2 修正 I-1: get_billing_entitlement_for_user の cancel_at を、null のときは出さない。
--
-- 20260925120000 は行ありのとき常に "cancel_at": null を返していた。R2 以前の Function は RPC を
-- strict に解析するため、未知キー cancel_at で失敗し、請求の行を持つ全員の entitlement（生成・
-- 週間献立・チラシ・使用量も含む）が 503 になる。この migration で、予約中でない行の JSON を
-- R2 以前のキー集合と完全に同じにする。
--
-- 20260925120000 はローカルで適用済みのため書き換えず、関数だけを再定義する。本体は
-- 20260925120000 の定義の写しで、変えたのは cancel_at の出し方（null ならキーを出さない）だけ。
-- billing_entitlement_json（判定の正本）・GRANT（CREATE OR REPLACE は ACL を消さない）は変えない。
--
-- 配備順（docs/deployment/README.md §5 の注記）: 解約予約中（cancel_at あり）の利用者は、
-- この migration の後でも "cancel_at" キーを受け取る。R2 以前の Function はそれを未知キーとして
-- 503 にするため、20260925120000 / 本 migration を含む配備では「Functions が先、migration が後」
-- にする。新 Function は cancel_at を optional に受けるので、旧 DB でも動く。

create or replace function public.get_billing_entitlement_for_user(
  p_user_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.billing_subscriptions%rowtype;
  v_json jsonb;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  select * into v_row
  from private.billing_subscriptions
  where user_id = p_user_id;

  if not found then
    -- 行無し JSON は既存キー集合のまま（pgTAP 完全一致）
    return private.billing_entitlement_json(
      null, false, null, null, null, coalesce(p_now, clock_timestamp())
    );
  end if;

  v_json := private.billing_entitlement_json(
    v_row.status,
    v_row.cancel_at_period_end,
    v_row.current_period_end,
    v_row.trial_end,
    v_row.past_due_since,
    coalesce(p_now, clock_timestamp())
  );
  -- R2-6: cancel_at は行ありのときだけ足す（行無し JSON のキー集合は変えない）。表示専用
  -- R2 修正 I-1: 予約が無い（null）ときはキーごと出さない。旧 Function の strict 解析が
  -- 未知キーで落ちないよう、予約中でない行の JSON は R2 以前のキー集合と完全に同じにする
  v_json := v_json || jsonb_build_object('kill_source_status', v_row.kill_source_status);
  if v_row.cancel_at is not null then
    v_json := v_json || jsonb_build_object('cancel_at', private.billing_iso_z(v_row.cancel_at));
  end if;
  return v_json;
end;
$function$;

-- GRANT は既存を維持（CREATE OR REPLACE は ACL を消さない）
