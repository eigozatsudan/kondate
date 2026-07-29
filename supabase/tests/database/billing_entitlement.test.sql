\ir 000_helpers.sql
-- Task 2: private billing 表 + SECURITY DEFINER RPC（A6 / lock / process 冪等・stale・crash-safe）

begin;
select plan(61);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000001'::uuid,
  'billing-entitlement@example.invalid'
);
select tests.create_supabase_user(
  'f2000000-0000-4000-8000-000000000002'::uuid,
  'billing-process@example.invalid'
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
