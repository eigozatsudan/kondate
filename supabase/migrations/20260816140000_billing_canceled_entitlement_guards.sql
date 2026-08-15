-- B1/B2/B3: canceled 枝の過大 Plus と same-second の低い rank 上書きを閉じる。
-- RLS / GRANT / 列定義は変えない。SECURITY DEFINER 関数の置換のみ。

-- A6: 支払済み残存 canceled は期間内 Plus。
-- B2: grace 失効後の past_due を canceled にしても再付与しない（72h 終端排他）。
create or replace function private.billing_entitlement_json(
  p_status text,
  p_cancel_at_period_end boolean,
  p_current_period_end timestamptz,
  p_trial_end timestamptz,
  p_past_due_since timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, private
as $function$
declare
  v_plus boolean := false;
  v_grace boolean := false;
  v_status text;
begin
  if p_status is null then
    return jsonb_build_object(
      'plan', 'free',
      'status', 'none',
      'plus_entitled', false,
      'past_due_grace', false,
      'current_period_end', null,
      'cancel_at_period_end', false,
      'trial_end', null,
      'db_plus_entitled', false,
      'past_due_since', null
    );
  end if;

  v_status := p_status;

  if v_status in ('trialing', 'active') then
    v_plus := true;
    v_grace := false;
  elsif v_status = 'past_due' then
    -- A6: past_due_since NULL は fail-closed（無限 Plus を作らない）
    if p_past_due_since is null then
      v_plus := false;
      v_grace := false;
    elsif p_now < p_past_due_since + interval '72 hours' then
      v_plus := true;
      v_grace := true;
    else
      v_plus := false;
      v_grace := false;
    end if;
  elsif v_status = 'canceled' then
    -- 支払済み残存は期間末まで Plus。grace 失効証拠があるときは再付与しない。
    if p_current_period_end is not null and p_now < p_current_period_end then
      if p_past_due_since is not null
         and p_now >= p_past_due_since + interval '72 hours' then
        v_plus := false;
      else
        v_plus := true;
      end if;
    else
      v_plus := false;
    end if;
    v_grace := false;
  else
    -- unpaid / incomplete / incomplete_expired / paused
    v_plus := false;
    v_grace := false;
  end if;

  return jsonb_build_object(
    'plan', case when v_plus then 'plus' else 'free' end,
    'status', v_status,
    'plus_entitled', v_plus,
    'past_due_grace', v_grace,
    'current_period_end', private.billing_iso_z(p_current_period_end),
    'cancel_at_period_end', coalesce(p_cancel_at_period_end, false),
    'trial_end', private.billing_iso_z(p_trial_end),
    'db_plus_entitled', v_plus,
    'past_due_since', private.billing_iso_z(p_past_due_since)
  );
end;
$function$;

revoke all on function private.billing_entitlement_json(
  text, boolean, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

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
