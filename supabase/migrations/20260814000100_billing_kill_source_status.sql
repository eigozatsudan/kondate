-- B3: kill 中 unpaid 投影の元 status を残し、BILLING_ENABLED 復帰後に webhook 無しで復元する。
-- RLS / GRANT は変えない。private 表の列追加と SECURITY DEFINER 関数の置換のみ。

alter table private.billing_subscriptions
  add column if not exists kill_source_status text null
  check (
    kill_source_status is null
    or kill_source_status in (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'paused'
    )
  );

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
        v_apply := true;
        v_outcome := 'applied';
      else
        v_new_rank := private.billing_status_terminality_rank(v_status);
        v_old_rank := private.billing_status_terminality_rank(v_row.status);
        if v_new_rank > v_old_rank
           or (
             v_period_end is not null
             and v_row.current_period_end is not null
             and v_period_end > v_row.current_period_end
           ) then
          v_apply := true;
          v_outcome := 'applied';
        else
          return 'same_second_skip';
        end if;
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

  if v_clear_past_due or v_status in ('active', 'trialing') then
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
  elsif v_has_row and not v_clear_past_due then
    v_past_due_since := coalesce(v_past_due_since, v_row.past_due_since);
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
  return v_json || jsonb_build_object('kill_source_status', v_row.kill_source_status);
end;
$function$;

-- GRANT は既存を維持（CREATE OR REPLACE は ACL を消さない）
