-- B-R3/B-R4/B-R5: incomplete_expired→canceled の第三 remap を deleted+同一 sub に狭め、
-- 行無し canceled remap を削除し、unpaid を incoming incomplete_expired で固定しない。
-- RLS / GRANT / 列定義は変えない。SECURITY DEFINER 関数の置換のみ。
-- 既存 migration 20260816140000 / 20260816150000 は書き換えない。

create or replace function private.project_billing_subscription(
  p_user_id uuid,
  p_payload jsonb,
  p_force_apply boolean default false
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.billing_subscriptions%rowtype;
  v_has_row boolean := false;
  v_event_created bigint;
  v_event_id text;
  v_event_type text;
  v_status text;
  v_price_id text;
  v_sub_id text;
  v_cancel boolean;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_trial_end timestamptz;
  v_past_due_since timestamptz;
  v_clear_past_due boolean;
  v_retrieved jsonb;
  v_new_rank integer;
  v_old_rank integer;
  v_apply boolean := false;
  v_outcome text;
  v_has_kill_source boolean := false;
  v_kill_source text;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  v_event_id := nullif(p_payload ->> 'stripe_event_id', '');
  v_event_created := coalesce((p_payload ->> 'stripe_event_created')::bigint, 0);
  v_event_type := coalesce(nullif(p_payload ->> 'event_type', ''), '');
  v_sub_id := nullif(p_payload ->> 'stripe_subscription_id', '');
  v_price_id := nullif(p_payload ->> 'stripe_price_id', '');
  v_status := nullif(p_payload ->> 'status', '');
  v_cancel := coalesce((p_payload ->> 'cancel_at_period_end')::boolean, false);
  v_period_start := private.billing_payload_timestamptz(p_payload -> 'current_period_start');
  v_period_end := private.billing_payload_timestamptz(p_payload -> 'current_period_end');
  v_trial_end := private.billing_payload_timestamptz(p_payload -> 'trial_end');
  v_past_due_since := private.billing_payload_timestamptz(p_payload -> 'past_due_since');
  v_clear_past_due := coalesce((p_payload ->> 'clear_past_due_since')::boolean, false);
  v_retrieved := p_payload -> 'retrieved_subscription';
  if v_retrieved is not null and v_retrieved = 'null'::jsonb then
    v_retrieved := null;
  end if;
  v_has_kill_source := p_payload ? 'kill_source_status';
  if v_has_kill_source then
    v_kill_source := nullif(p_payload ->> 'kill_source_status', '');
  end if;

  -- 行ロック（無ければ後続 insert）
  select * into v_row
  from private.billing_subscriptions
  where user_id = p_user_id
  for update;

  if found then
    v_has_row := true;
  end if;

  if not p_force_apply and v_has_row then
    if v_event_created < v_row.last_stripe_event_created then
      return 'stale_ignored';
    end if;

    if v_event_created = v_row.last_stripe_event_created then
      if v_event_id is not null and v_event_id = v_row.last_stripe_event_id then
        return 'duplicate_processed';
      end if;

      if v_retrieved is not null then
        v_status := coalesce(nullif(v_retrieved ->> 'status', ''), v_status);
        v_price_id := coalesce(nullif(v_retrieved ->> 'stripe_price_id', ''), v_price_id);
        v_sub_id := coalesce(nullif(v_retrieved ->> 'stripe_subscription_id', ''), v_sub_id);
        if v_retrieved ? 'cancel_at_period_end' then
          v_cancel := coalesce((v_retrieved ->> 'cancel_at_period_end')::boolean, v_cancel);
        end if;
        if v_retrieved ? 'current_period_start' then
          v_period_start := private.billing_payload_timestamptz(v_retrieved -> 'current_period_start');
        end if;
        if v_retrieved ? 'current_period_end' then
          v_period_end := private.billing_payload_timestamptz(v_retrieved -> 'current_period_end');
        end if;
        if v_retrieved ? 'trial_end' then
          v_trial_end := private.billing_payload_timestamptz(v_retrieved -> 'trial_end');
        end if;
      end if;

      -- B6: retrieved の有無に関わらず terminality。stale active で canceled を上書きしない。
      -- B3: period_end 増加だけでは低い rank を通さない。より終端な行を残す。
      v_new_rank := private.billing_status_terminality_rank(v_status);
      v_old_rank := private.billing_status_terminality_rank(v_row.status);
      if v_new_rank > v_old_rank
         or (
           v_new_rank >= v_old_rank
           and v_period_end is not null
           and v_row.current_period_end is not null
           and v_period_end > v_row.current_period_end
         ) then
        v_apply := true;
        v_outcome := 'applied';
      else
        return 'same_second_skip';
      end if;
    else
      v_apply := true;
      v_outcome := 'applied';
    end if;
  else
    v_apply := true;
    v_outcome := 'applied';
  end if;

  if not v_apply then
    return coalesce(v_outcome, 'same_second_skip');
  end if;

  if v_sub_id is null or v_price_id is null or v_status is null
     or v_period_start is null or v_period_end is null then
    raise exception using errcode = '22023', message = 'invalid_subscription_projection';
  end if;

  -- B1: 未払い incomplete 行を canceled にすると期間末まで Plus。A6 の incomplete=非 Plus を残す。
  if v_has_row
     and v_status = 'canceled'
     and v_row.status in ('incomplete', 'incomplete_expired') then
    v_status := 'incomplete_expired';
  -- B-R3: incoming incomplete_expired → canceled は同一 sub の deleted だけ。
  -- updated / invoice の未来 period で期限切れ canceled を再開しない。
  -- persist する current_period_* は既存行を残す。
  elsif v_has_row
     and v_status = 'incomplete_expired'
     and v_event_type = 'customer.subscription.deleted'
     and v_sub_id is not distinct from v_row.stripe_subscription_id
     and v_row.status in ('active', 'trialing', 'canceled', 'past_due') then
    v_status := 'canceled';
    v_period_start := v_row.current_period_start;
    v_period_end := v_row.current_period_end;
  -- B-R5: incoming incomplete_expired では unpaid を上げない（unknown-price を Plus にしない）。
  -- incomplete_expired に固定すると B1 が後続 deleted+canceled を飲み、支払済み回復が死ぬ。
  -- persist は unpaid のまま。period / sub も既存の支払済み行を残す。
  elsif v_has_row
     and v_status = 'incomplete_expired'
     and v_row.status = 'unpaid' then
    v_status := 'unpaid';
    v_sub_id := v_row.stripe_subscription_id;
    v_period_start := v_row.current_period_start;
    v_period_end := v_row.current_period_end;
  end if;

  if v_status in ('active', 'trialing') then
    v_past_due_since := null;
  elsif v_status = 'canceled' then
    -- B2: grace 失効証拠を消さない。deleted 経路の clear でも既存 since を残す。
    if v_has_row then
      v_past_due_since := coalesce(v_row.past_due_since, v_past_due_since);
    end if;
  elsif v_clear_past_due then
    v_past_due_since := null;
  elsif v_status = 'past_due' then
    if v_has_row then
      v_past_due_since := coalesce(
        v_row.past_due_since,
        v_past_due_since,
        clock_timestamp()
      );
    else
      v_past_due_since := coalesce(v_past_due_since, clock_timestamp());
    end if;
  elsif v_has_row then
    -- B-R6: unpaid（kill persist）でも既存 since を優先。payload の新しい
    -- event.created で grace 起点を伸ばさない。欠落時だけ payload を採用。
    v_past_due_since := coalesce(v_row.past_due_since, v_past_due_since);
  end if;

  if not v_has_kill_source then
    v_kill_source := case when v_has_row then v_row.kill_source_status else null end;
  -- B-R5: persist が unpaid のままなら payload の null で kill_source を消さない。
  -- 支払済み deleted+canceled が来たとき canceled 残存へ戻せる材料を残す。
  elsif v_has_row
     and v_status = 'unpaid'
     and v_kill_source is null
     and v_row.kill_source_status is not null then
    v_kill_source := v_row.kill_source_status;
  end if;

  if v_has_row then
    update private.billing_subscriptions set
      stripe_subscription_id = v_sub_id,
      stripe_price_id = v_price_id,
      status = v_status,
      cancel_at_period_end = v_cancel,
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      trial_end = v_trial_end,
      past_due_since = v_past_due_since,
      kill_source_status = v_kill_source,
      last_stripe_event_created = case
        when p_force_apply then greatest(coalesce(v_event_created, 0), last_stripe_event_created)
        when v_event_created > last_stripe_event_created then v_event_created
        else last_stripe_event_created
      end,
      last_stripe_event_id = coalesce(v_event_id, last_stripe_event_id),
      updated_at = clock_timestamp()
    where user_id = p_user_id;
  else
    insert into private.billing_subscriptions (
      user_id,
      stripe_subscription_id,
      stripe_price_id,
      status,
      cancel_at_period_end,
      current_period_start,
      current_period_end,
      trial_end,
      past_due_since,
      kill_source_status,
      last_stripe_event_created,
      last_stripe_event_id,
      updated_at
    ) values (
      p_user_id,
      v_sub_id,
      v_price_id,
      v_status,
      v_cancel,
      v_period_start,
      v_period_end,
      v_trial_end,
      v_past_due_since,
      v_kill_source,
      coalesce(v_event_created, 0),
      v_event_id,
      clock_timestamp()
    );
  end if;

  return coalesce(v_outcome, 'applied');
end;
$function$;

revoke all on function private.project_billing_subscription(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;
