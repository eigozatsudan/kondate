\ir 000_helpers.sql
-- Task 2: private billing 表 + SECURITY DEFINER RPC（A6 / lock / process 冪等・stale・crash-safe）

begin;
select plan(96);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000001'::uuid,
  'billing-entitlement@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000002'::uuid,
  'billing-process@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000003'::uuid,
  'billing-kill-since@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000004'::uuid,
  'billing-b1-incomplete@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000005'::uuid,
  'billing-b2-grace-cancel@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000006'::uuid,
  'billing-b3-terminality@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000007'::uuid,
  'billing-b3-same-rank@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000008'::uuid,
  'billing-br1-rowless-deleted@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000009'::uuid,
  'billing-br1-paid-remainder@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-00000000000a'::uuid,
  'billing-br2-rowless-pastdue@example.invalid'
);

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
select has_table('private', 'billing_customers', 'billing_customers exists');
select has_table('private', 'billing_subscriptions', 'billing_subscriptions exists');
select has_table('private', 'billing_webhook_events', 'billing_webhook_events exists');
select has_table('private', 'billing_trial_history', 'billing_trial_history exists');
select has_table('private', 'billing_checkout_locks', 'billing_checkout_locks exists');

-- ---------------------------------------------------------------------------
-- Grants: authenticated cannot execute billing RPCs
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_billing_entitlement_for_user(uuid,timestamptz)',
    'execute'
  ),
  'authenticated cannot execute get_billing_entitlement_for_user'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ensure_billing_customer(uuid,text)',
    'execute'
  ),
  'authenticated cannot execute ensure_billing_customer'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.process_billing_stripe_event(jsonb)',
    'execute'
  ),
  'authenticated cannot execute process_billing_stripe_event'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_billing_subscription_from_stripe(jsonb)',
    'execute'
  ),
  'authenticated cannot execute upsert_billing_subscription_from_stripe'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.insert_billing_trial_history(text)',
    'execute'
  ),
  'authenticated cannot execute insert_billing_trial_history'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.acquire_billing_checkout_lock(uuid,text,timestamptz)',
    'execute'
  ),
  'authenticated cannot execute acquire_billing_checkout_lock'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.bind_billing_checkout_session(uuid,text,text)',
    'execute'
  ),
  'authenticated cannot execute bind_billing_checkout_session'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.release_billing_checkout_lock(uuid,text,text)',
    'execute'
  ),
  'authenticated cannot execute release_billing_checkout_lock'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_billing_entitlement_for_user(uuid,timestamptz)',
    'execute'
  ),
  'service_role can execute get_billing_entitlement_for_user'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.process_billing_stripe_event(jsonb)',
    'execute'
  ),
  'service_role can execute process_billing_stripe_event'
);

-- 表への direct privilege が service_role にも無いこと
select ok(
  not has_table_privilege('service_role', 'private.billing_subscriptions', 'select'),
  'service_role has no direct SELECT on billing_subscriptions'
);
select ok(
  not has_table_privilege('authenticated', 'private.billing_subscriptions', 'select'),
  'authenticated has no direct SELECT on billing_subscriptions'
);

-- ---------------------------------------------------------------------------
-- A6 fixtures（固定 now）
-- ---------------------------------------------------------------------------
-- 行なし
select is(
  public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-29 12:00:00+00'::timestamptz
  ),
  jsonb_build_object(
    'plan', 'free',
    'status', 'none',
    'plus_entitled', false,
    'past_due_grace', false,
    'current_period_end', null,
    'cancel_at_period_end', false,
    'trial_end', null,
    'db_plus_entitled', false,
    'past_due_since', null
  ),
  'A6: no row → free / not entitled'
);

-- trialing
insert into private.billing_subscriptions (
  user_id, stripe_subscription_id, stripe_price_id, status,
  cancel_at_period_end, current_period_start, current_period_end, trial_end
) values (
  'f2000000-0000-4000-8000-000000000001'::uuid,
  'sub_trialing_a6', 'price_plus_m', 'trialing',
  false,
  '2026-07-22 12:00:00+00', '2026-08-05 12:00:00+00',
  '2026-07-29 12:00:00+00'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'A6: trialing → plus_entitled true'
);
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'past_due_grace')::boolean,
  false,
  'A6: trialing → past_due_grace false'
);

-- active
update private.billing_subscriptions
set status = 'active', trial_end = null
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'A6: active → plus_entitled true'
);

-- past_due + past_due_since NULL → fail-closed
update private.billing_subscriptions
set status = 'past_due', past_due_since = null
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'A6: past_due + NULL since → plus_entitled false (fail-closed)'
);
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'past_due_grace')::boolean,
  false,
  'A6: past_due + NULL since → past_due_grace false'
);

-- past_due + within 72h
update private.billing_subscriptions
set past_due_since = '2026-07-24 12:00:00+00'::timestamptz
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'A6: past_due within 72h → plus_entitled true'
);
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'past_due_grace')::boolean,
  true,
  'A6: past_due within 72h → past_due_grace true'
);

-- past_due + > 72h
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-28 12:00:01+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'A6: past_due > 72h → plus_entitled false'
);

-- canceled + now < period_end
update private.billing_subscriptions
set status = 'canceled',
    past_due_since = null,
    current_period_end = '2026-08-05 12:00:00+00'::timestamptz
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'A6: canceled before period_end → plus_entitled true'
);

-- canceled + now >= period_end
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-08-05 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'A6: canceled at/after period_end → plus_entitled false'
);

-- B2: grace 失効後の canceled は期間が残っても再付与しない
update private.billing_subscriptions
set past_due_since = '2026-07-21 12:00:00+00'::timestamptz
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'B2: canceled after past_due grace expired → not entitled'
);

-- B2: grace 内の canceled は支払済み残存として期間内 Plus
update private.billing_subscriptions
set past_due_since = '2026-07-25 00:00:00+00'::timestamptz
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'B2: canceled within past_due grace and period → entitled'
);

update private.billing_subscriptions
set past_due_since = null
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

-- unpaid / incomplete / paused
update private.billing_subscriptions
set status = 'unpaid'
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'A6: unpaid → not entitled'
);

update private.billing_subscriptions
set status = 'incomplete'
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'A6: incomplete → not entitled'
);

update private.billing_subscriptions
set status = 'paused'
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;
select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'A6: paused → not entitled'
);

-- ISO-Z 正規化（current_period_end が …Z）
update private.billing_subscriptions
set status = 'active',
    current_period_end = '2026-08-05 12:00:00+00'::timestamptz
where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid;

select is(
  public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    '2026-07-25 12:00:00+00'::timestamptz
  ) ->> 'current_period_end',
  '2026-08-05T12:00:00.000Z',
  'entitlement timestamps are ISO-Z'
);

-- ---------------------------------------------------------------------------
-- Checkout lock: acquire / bind / release
-- ---------------------------------------------------------------------------
select is(
  public.acquire_billing_checkout_lock(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    'lock-token-1',
    now() + interval '30 minutes'
  ),
  jsonb_build_object('ok', true, 'lock_token', 'lock-token-1'),
  'acquire checkout lock succeeds'
);

select is(
  public.acquire_billing_checkout_lock(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    'lock-token-2',
    now() + interval '30 minutes'
  ),
  jsonb_build_object('ok', false, 'failure_code', 'billing_checkout_in_progress'),
  'second acquire while lock live fails with billing_checkout_in_progress'
);

select is(
  public.bind_billing_checkout_session(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    'lock-token-1',
    'cs_test_session_1'
  ),
  jsonb_build_object(
    'ok', true,
    'lock_token', 'lock-token-1',
    'stripe_checkout_session_id', 'cs_test_session_1'
  ),
  'bind session after acquire succeeds'
);

select is(
  (public.release_billing_checkout_lock(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    null,
    'cs_test_session_1'
  ) ->> 'released')::boolean,
  true,
  'release by session id succeeds'
);

select is(
  (select count(*)::integer from private.billing_checkout_locks
    where user_id = 'f2000000-0000-4000-8000-000000000001'::uuid),
  0,
  'lock row gone after release by session'
);

-- acquire → release by lock_token without bind
select is(
  (public.acquire_billing_checkout_lock(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    'lock-token-3',
    now() + interval '30 minutes'
  ) ->> 'ok')::boolean,
  true,
  're-acquire after release succeeds'
);

select is(
  (public.release_billing_checkout_lock(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    'lock-token-3',
    null
  ) ->> 'released')::boolean,
  true,
  'release by lock_token without bind succeeds'
);

select is(
  (public.release_billing_checkout_lock(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    null,
    null
  ) ->> 'released')::boolean,
  false,
  'release with both token and session null is no-op'
);

-- ---------------------------------------------------------------------------
-- process_billing_stripe_event: apply / duplicate / stale / crash-safe
-- ---------------------------------------------------------------------------
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_apply_active_1',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 2000,
    'user_id', 'f2000000-0000-4000-8000-000000000002',
    'stripe_subscription_id', 'sub_process_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true
  )),
  jsonb_build_object('ok', true, 'outcome', 'applied'),
  'process applies active subscription'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000002'::uuid,
    '2026-07-15 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'after apply active → plus_entitled true'
);

select is(
  (select count(*)::integer from private.billing_webhook_events
    where stripe_event_id = 'evt_apply_active_1'),
  1,
  'event row exists after applied process'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_apply_active_1',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 2000,
    'user_id', 'f2000000-0000-4000-8000-000000000002',
    'stripe_subscription_id', 'sub_process_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z'
  )),
  jsonb_build_object('ok', true, 'outcome', 'duplicate_processed'),
  'same stripe_event_id → duplicate_processed'
);

-- cancel projection then older active → stale_ignored, stays not entitled after period_end cancel
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_cancel_later',
    'event_type', 'customer.subscription.deleted',
    'stripe_event_created', 3000,
    'user_id', 'f2000000-0000-4000-8000-000000000002',
    'stripe_subscription_id', 'sub_process_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'canceled',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-07-10T00:00:00.000Z'
  )) ->> 'outcome',
  'applied',
  'cancel projection applied'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_old_active_delayed',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 1500,
    'user_id', 'f2000000-0000-4000-8000-000000000002',
    'stripe_subscription_id', 'sub_process_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z'
  )) ->> 'outcome',
  'stale_ignored',
  'older event.created after cancel → stale_ignored'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000002'::uuid,
    '2026-07-15 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'stale active does not re-entitle after canceled past period_end'
);

select is(
  (select status from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000002'::uuid),
  'canceled',
  'status remains canceled after stale ignore'
);

-- crash-safe: 途中例外で claim も ROLLBACK → 再送で apply 可
do $crash$
begin
  perform public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_crash_safe_1',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 4000,
    'user_id', 'f2000000-0000-4000-8000-000000000002',
    'stripe_subscription_id', 'sub_process_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-09-01T00:00:00.000Z'
  ));
  raise exception 'simulated_crash';
exception
  when raise_exception then
    null;
end;
$crash$;

select is(
  (select count(*)::integer from private.billing_webhook_events
    where stripe_event_id = 'evt_crash_safe_1'),
  0,
  'crash simulation rolls back event claim row'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_crash_safe_1',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 4000,
    'user_id', 'f2000000-0000-4000-8000-000000000002',
    'stripe_subscription_id', 'sub_process_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-09-01T00:00:00.000Z'
  )) ->> 'outcome',
  'applied',
  're-process after crash still applies'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000002'::uuid,
    '2026-08-01 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'after crash-safe reprocess → plus_entitled true'
);

-- event_only path
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_customer_only',
    'event_type', 'customer.updated',
    'stripe_event_created', 5000,
    'skip_subscription_projection', true
  )) ->> 'outcome',
  'event_only',
  'skip_subscription_projection → event_only'
);

-- ---------------------------------------------------------------------------
-- trial history / customer helpers
-- ---------------------------------------------------------------------------
select is(
  (public.insert_billing_trial_history(repeat('ab', 32)) ->> 'ok')::boolean,
  true,
  'insert_billing_trial_history succeeds'
);

select is(
  public.has_billing_trial_history(repeat('ab', 32)),
  true,
  'has_billing_trial_history true after insert'
);

select is(
  (public.insert_billing_trial_history(repeat('ab', 32)) ->> 'inserted')::boolean,
  false,
  'insert_billing_trial_history on conflict do nothing'
);

select is(
  public.ensure_billing_customer(
    'f2000000-0000-4000-8000-000000000001'::uuid,
    'cus_test_1'
  ),
  jsonb_build_object(
    'ok', true,
    'user_id', 'f2000000-0000-4000-8000-000000000001',
    'stripe_customer_id', 'cus_test_1'
  ),
  'ensure_billing_customer upserts'
);

select is(
  public.get_billing_customer_by_user('f2000000-0000-4000-8000-000000000001'::uuid),
  jsonb_build_object('stripe_customer_id', 'cus_test_1'),
  'get_billing_customer_by_user returns stripe_customer_id only'
);

select is(
  public.get_billing_customer_by_stripe_id('cus_test_1') ->> 'user_id',
  'f2000000-0000-4000-8000-000000000001',
  'get_billing_customer_by_stripe_id resolves user'
);

-- dual-cancel keep
select is(
  (public.mark_billing_subscription_dual_cancel_keep(
    'f2000000-0000-4000-8000-000000000002'::uuid,
    'sub_keep_older'
  ) ->> 'ok')::boolean,
  true,
  'mark_billing_subscription_dual_cancel_keep succeeds'
);

select is(
  (select stripe_subscription_id from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000002'::uuid),
  'sub_keep_older',
  'dual-cancel keep aligns stripe_subscription_id'
);

-- ---------------------------------------------------------------------------
-- B-R6 / B-R7: kill unpaid の past_due_since は既存優先、clear は persist unpaid でも効く
-- ---------------------------------------------------------------------------
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_kill_since_t0',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 6000,
    'user_id', 'f2000000-0000-4000-8000-000000000003',
    'stripe_subscription_id', 'sub_kill_since_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'unpaid',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false,
    'kill_source_status', 'past_due',
    'past_due_since', '2026-07-01T00:00:00.000Z'
  )) ->> 'outcome',
  'applied',
  'B-R6 first kill unpaid past_due persist applies T0'
);

select is(
  (select past_due_since from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000003'::uuid),
  '2026-07-01 00:00:00+00'::timestamptz,
  'B-R6 first kill unpaid persist stores payload since'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_kill_since_t1',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 7000,
    'user_id', 'f2000000-0000-4000-8000-000000000003',
    'stripe_subscription_id', 'sub_kill_since_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'unpaid',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false,
    'kill_source_status', 'past_due',
    'past_due_since', '2026-07-04T00:00:00.000Z'
  )) ->> 'outcome',
  'applied',
  'B-R6 later kill unpaid past_due persist applies'
);

select is(
  (select past_due_since from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000003'::uuid),
  '2026-07-01 00:00:00+00'::timestamptz,
  'B-R6 later payload T1 does not extend existing since T0'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_kill_since_clear_active',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 8000,
    'user_id', 'f2000000-0000-4000-8000-000000000003',
    'stripe_subscription_id', 'sub_kill_since_1',
    'stripe_price_id', 'price_plus_m',
    'status', 'unpaid',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true,
    'kill_source_status', 'active'
  )) ->> 'outcome',
  'applied',
  'B-R7 kill unpaid clear persist applies'
);

select is(
  (select past_due_since from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000003'::uuid),
  null,
  'B-R7 clear_past_due_since nulls since even when persist status is unpaid'
);

-- ---------------------------------------------------------------------------
-- B1: 未払い incomplete への deleted(canceled) は incomplete_expired のまま非 Plus
-- ---------------------------------------------------------------------------
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b1_incomplete',
    'event_type', 'customer.subscription.created',
    'stripe_event_created', 10000,
    'user_id', 'f2000000-0000-4000-8000-000000000004',
    'stripe_subscription_id', 'sub_b1_incomplete',
    'stripe_price_id', 'price_plus_m',
    'status', 'incomplete',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false
  )) ->> 'outcome',
  'applied',
  'B1 incomplete created applies'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b1_incomplete_deleted',
    'event_type', 'customer.subscription.deleted',
    'stripe_event_created', 11000,
    'user_id', 'f2000000-0000-4000-8000-000000000004',
    'stripe_subscription_id', 'sub_b1_incomplete',
    'stripe_price_id', 'price_plus_m',
    'status', 'canceled',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true
  )) ->> 'outcome',
  'applied',
  'B1 incomplete deleted payload applies'
);

select is(
  (select status from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000004'::uuid),
  'incomplete_expired',
  'B1 deleted canceled over incomplete persists incomplete_expired'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000004'::uuid,
    '2026-07-15 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'B1 incomplete deleted remains not entitled inside period'
);

-- ---------------------------------------------------------------------------
-- B2: grace 切れ past_due のあと canceled しても since を残し非 Plus
-- ---------------------------------------------------------------------------
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b2_past_due',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 12000,
    'user_id', 'f2000000-0000-4000-8000-000000000005',
    'stripe_subscription_id', 'sub_b2_grace',
    'stripe_price_id', 'price_plus_m',
    'status', 'past_due',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false,
    'past_due_since', '2026-07-10T00:00:00.000Z'
  )) ->> 'outcome',
  'applied',
  'B2 past_due with expired since applies'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000005'::uuid,
    '2026-07-14 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'B2 past_due > 72h is not entitled'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b2_deleted',
    'event_type', 'customer.subscription.deleted',
    'stripe_event_created', 13000,
    'user_id', 'f2000000-0000-4000-8000-000000000005',
    'stripe_subscription_id', 'sub_b2_grace',
    'stripe_price_id', 'price_plus_m',
    'status', 'canceled',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true
  )) ->> 'outcome',
  'applied',
  'B2 deleted after grace applies'
);

select is(
  (select past_due_since from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000005'::uuid),
  '2026-07-10 00:00:00+00'::timestamptz,
  'B2 canceled keeps expired past_due_since even if payload clears'
);

select is(
  (select status from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000005'::uuid),
  'canceled',
  'B2 deleted past_due persists canceled'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000005'::uuid,
    '2026-07-14 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'B2 canceled after grace remains not entitled'
);

-- ---------------------------------------------------------------------------
-- B3: same-second で低い rank は period_end 増加でも canceled を上書きしない
-- ---------------------------------------------------------------------------
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b3_canceled',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 14000,
    'user_id', 'f2000000-0000-4000-8000-000000000006',
    'stripe_subscription_id', 'sub_b3_term',
    'stripe_price_id', 'price_plus_m',
    'status', 'canceled',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-07-10T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false
  )) ->> 'outcome',
  'applied',
  'B3 first canceled applies'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b3_later_active',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 14000,
    'user_id', 'f2000000-0000-4000-8000-000000000006',
    'stripe_subscription_id', 'sub_b3_term',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-09-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true
  )) ->> 'outcome',
  'same_second_skip',
  'B3 later active with later period_end does not override canceled'
);

select is(
  (select status from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000006'::uuid),
  'canceled',
  'B3 status remains canceled after same-second active'
);

-- 同 rank の period 増加は従来どおり apply（更新後 period の投影）
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b3_same_rank_a',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 15000,
    'user_id', 'f2000000-0000-4000-8000-000000000007',
    'stripe_subscription_id', 'sub_b3_rank',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true
  )) ->> 'outcome',
  'applied',
  'B3 same-rank first active applies'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_b3_same_rank_b',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 15000,
    'user_id', 'f2000000-0000-4000-8000-000000000007',
    'stripe_subscription_id', 'sub_b3_rank',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-08-01T00:00:00.000Z',
    'current_period_end', '2026-09-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true
  )) ->> 'outcome',
  'applied',
  'B3 same-rank later period_end still applies'
);

select is(
  (select current_period_end from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000007'::uuid),
  '2026-09-01 00:00:00+00'::timestamptz,
  'B3 same-rank period increase is stored'
);

-- ---------------------------------------------------------------------------
-- B-R1: 行無しの初回 deleted(canceled) は incomplete_expired / 非 Plus
-- ---------------------------------------------------------------------------
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_br1_rowless_deleted',
    'event_type', 'customer.subscription.deleted',
    'stripe_event_created', 16000,
    'user_id', 'f2000000-0000-4000-8000-000000000008',
    'stripe_subscription_id', 'sub_br1_rowless',
    'stripe_price_id', 'price_plus_m',
    'status', 'canceled',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false
  )) ->> 'outcome',
  'applied',
  'B-R1 rowless deleted canceled applies'
);

select is(
  (select status from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000008'::uuid),
  'incomplete_expired',
  'B-R1 rowless deleted canceled persists incomplete_expired'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000008'::uuid,
    '2026-07-15 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'B-R1 rowless deleted canceled is not entitled inside period'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_br1_same_second_incomplete',
    'event_type', 'customer.subscription.created',
    'stripe_event_created', 16000,
    'user_id', 'f2000000-0000-4000-8000-000000000008',
    'stripe_subscription_id', 'sub_br1_rowless',
    'stripe_price_id', 'price_plus_m',
    'status', 'incomplete',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-09-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false
  )) ->> 'outcome',
  'same_second_skip',
  'B-R1 later same-second incomplete created does not override'
);

-- B-R1: 既存の支払済み行は incoming incomplete_expired でも canceled 残存
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_br1_paid_active',
    'event_type', 'customer.subscription.updated',
    'stripe_event_created', 17000,
    'user_id', 'f2000000-0000-4000-8000-000000000009',
    'stripe_subscription_id', 'sub_br1_paid',
    'stripe_price_id', 'price_plus_m',
    'status', 'active',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', true
  )) ->> 'outcome',
  'applied',
  'B-R1 paid active applies first'
);

select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_br1_paid_deleted',
    'event_type', 'customer.subscription.deleted',
    'stripe_event_created', 18000,
    'user_id', 'f2000000-0000-4000-8000-000000000009',
    'stripe_subscription_id', 'sub_br1_paid',
    'stripe_price_id', 'price_plus_m',
    'status', 'incomplete_expired',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false
  )) ->> 'outcome',
  'applied',
  'B-R1 paid remainder deleted applies'
);

select is(
  (select status from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-000000000009'::uuid),
  'canceled',
  'B-R1 paid remainder stays canceled not incomplete_expired'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-000000000009'::uuid,
    '2026-07-15 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  true,
  'B-R1 paid remainder stays entitled inside period'
);

-- ---------------------------------------------------------------------------
-- B-R2: 行無し deleted + past_due_since は canceled のまま B2 読取枝が発火
-- ---------------------------------------------------------------------------
select is(
  public.process_billing_stripe_event(jsonb_build_object(
    'stripe_event_id', 'evt_br2_rowless_deleted',
    'event_type', 'customer.subscription.deleted',
    'stripe_event_created', 19000,
    'user_id', 'f2000000-0000-4000-8000-00000000000a',
    'stripe_subscription_id', 'sub_br2_rowless',
    'stripe_price_id', 'price_plus_m',
    'status', 'canceled',
    'cancel_at_period_end', false,
    'current_period_start', '2026-07-01T00:00:00.000Z',
    'current_period_end', '2026-08-01T00:00:00.000Z',
    'trial_end', null,
    'clear_past_due_since', false,
    'past_due_since', '2026-07-10T00:00:00.000Z'
  )) ->> 'outcome',
  'applied',
  'B-R2 rowless deleted with since applies'
);

select is(
  (select status from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-00000000000a'::uuid),
  'canceled',
  'B-R2 rowless deleted with since persists canceled'
);

select is(
  (select past_due_since from private.billing_subscriptions
    where user_id = 'f2000000-0000-4000-8000-00000000000a'::uuid),
  '2026-07-10 00:00:00+00'::timestamptz,
  'B-R2 rowless deleted keeps payload past_due_since'
);

select is(
  (public.get_billing_entitlement_for_user(
    'f2000000-0000-4000-8000-00000000000a'::uuid,
    '2026-07-14 00:00:00+00'::timestamptz
  ) ->> 'plus_entitled')::boolean,
  false,
  'B-R2 rowless deleted after grace is not entitled'
);

-- 禁止: insert_billing_webhook_event を public に export しない
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'insert_billing_webhook_event'
  ),
  'public.insert_billing_webhook_event is not exported'
);

select * from finish();
rollback;
