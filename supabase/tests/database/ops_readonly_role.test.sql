-- kondate_ops_readonly: SELECT のみ・user_feedback は RLS 下で行可視
-- 8 GRANT 表（jobs + recipes + origins を含む）すべてで INSERT/UPDATE/DELETE privilege が無いことを固定する
\ir 000_helpers.sql
begin;
select plan(50);

select ok(
  exists (select 1 from pg_roles where rolname = 'kondate_ops_readonly'),
  'kondate_ops_readonly role exists'
);

select is(
  (select rolsuper from pg_roles where rolname = 'kondate_ops_readonly'),
  false,
  'ops role is not superuser'
);

select is(
  (select rolbypassrls from pg_roles where rolname = 'kondate_ops_readonly'),
  false,
  'ops role does not bypass RLS'
);

select is(
  (select rolinherit from pg_roles where rolname = 'kondate_ops_readonly'),
  false,
  'ops role is NOINHERIT'
);

-- 6 ops 表: SELECT 可 / INSERT・UPDATE・DELETE 不可
select ok(
  has_table_privilege('kondate_ops_readonly', 'public.user_feedback', 'SELECT'),
  'ops has SELECT grant on user_feedback'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'public.user_feedback', 'INSERT'),
  'ops has no INSERT on user_feedback'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'public.user_feedback', 'UPDATE'),
  'ops has no UPDATE on user_feedback'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'public.user_feedback', 'DELETE'),
  'ops has no DELETE on user_feedback'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.ai_generation_requests', 'SELECT'),
  'ops has SELECT grant on ai_generation_requests'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.ai_generation_requests', 'INSERT'),
  'ops has no INSERT on ai_generation_requests'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.ai_generation_requests', 'UPDATE'),
  'ops has no UPDATE on ai_generation_requests'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.ai_generation_requests', 'DELETE'),
  'ops has no DELETE on ai_generation_requests'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.ai_global_daily_usage', 'SELECT'),
  'ops has SELECT grant on ai_global_daily_usage'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.ai_global_daily_usage', 'INSERT'),
  'ops has no INSERT on ai_global_daily_usage'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.ai_global_daily_usage', 'UPDATE'),
  'ops has no UPDATE on ai_global_daily_usage'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.ai_global_daily_usage', 'DELETE'),
  'ops has no DELETE on ai_global_daily_usage'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.billing_subscriptions', 'SELECT'),
  'ops has SELECT grant on billing_subscriptions'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.billing_subscriptions', 'INSERT'),
  'ops has no INSERT on billing_subscriptions'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.billing_subscriptions', 'UPDATE'),
  'ops has no UPDATE on billing_subscriptions'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.billing_subscriptions', 'DELETE'),
  'ops has no DELETE on billing_subscriptions'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.billing_webhook_events', 'SELECT'),
  'ops has SELECT grant on billing_webhook_events'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.billing_webhook_events', 'INSERT'),
  'ops has no INSERT on billing_webhook_events'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.billing_webhook_events', 'UPDATE'),
  'ops has no UPDATE on billing_webhook_events'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.billing_webhook_events', 'DELETE'),
  'ops has no DELETE on billing_webhook_events'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.share_generalization_jobs', 'SELECT'),
  'ops has SELECT grant on share_generalization_jobs'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.share_generalization_jobs', 'INSERT'),
  'ops has no INSERT on share_generalization_jobs'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.share_generalization_jobs', 'UPDATE'),
  'ops has no UPDATE on share_generalization_jobs'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.share_generalization_jobs', 'DELETE'),
  'ops has no DELETE on share_generalization_jobs'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'SELECT'),
  'ops has SELECT grant on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'INSERT'),
  'ops has no INSERT on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'UPDATE'),
  'ops has no UPDATE on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'DELETE'),
  'ops has no DELETE on shared_emergency_recipes'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'SELECT'),
  'ops has SELECT grant on shared_emergency_recipe_origins'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'INSERT'),
  'ops has no INSERT on shared_emergency_recipe_origins'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'UPDATE'),
  'ops has no UPDATE on shared_emergency_recipe_origins'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'DELETE'),
  'ops has no DELETE on shared_emergency_recipe_origins'
);

select ok(
  has_function_privilege(
    'kondate_ops_readonly',
    'private.share_recipe_title_from_payload(jsonb)',
    'EXECUTE'
  ),
  'ops can execute share_recipe_title_from_payload'
);

-- 製品境界: service_role に表 SELECT を広げない
select ok(
  not has_table_privilege('service_role', 'private.shared_emergency_recipes', 'SELECT'),
  'service_role still has no SELECT on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('service_role', 'private.shared_emergency_recipe_origins', 'SELECT'),
  'service_role still has no SELECT on shared_emergency_recipe_origins'
);

select lives_ok(
  $$
    set local role kondate_ops_readonly;
    select id, status, meal_type from private.shared_emergency_recipes limit 1;
    reset role;
  $$,
  'ops can select shared_emergency_recipes columns'
);

select ok(
  not has_schema_privilege('kondate_ops_readonly', 'auth', 'USAGE'),
  'ops has no USAGE on auth schema'
);

select ok(
  not has_function_privilege(
    'kondate_ops_readonly',
    'public.run_kondate_maintenance(timestamptz, integer)',
    'EXECUTE'
  ),
  'ops cannot execute run_kondate_maintenance'
);

-- seed + RLS 行可視（lives_ok だけでは 0 行を見逃す）
do $seed$
declare
  v_owner uuid := 'a1000000-0000-4000-8000-0000000000aa';
  v_id uuid := 'b1000000-0000-4000-8000-0000000000aa';
begin
  perform tests.create_supabase_user(v_owner, 'ops-readonly-seed@example.invalid');
  insert into public.user_feedback (id, user_id, category, body)
  values (
    v_id,
    v_owner,
    'bug_report',
    'ops readonly seed body for row visibility test xx'
  )
  on conflict (id) do nothing;
end
$seed$;

-- isnt_empty は multi-statement 不可。SET ROLE 中は pgtap 関数も呼べない
-- （ops に EXECUTE が無い）。DO 内で role 切替→件数を GUC に載せて外側で is()。
do $vis$
declare
  n integer;
begin
  set local role kondate_ops_readonly;
  select count(*)::integer into n
  from public.user_feedback
  where id = 'b1000000-0000-4000-8000-0000000000aa';
  reset role;
  perform set_config('test.ops_feedback_visible', n::text, true);
end
$vis$;

select is(
  current_setting('test.ops_feedback_visible', true),
  '1',
  'ops role sees user_feedback rows under RLS'
);

select throws_ok(
  $$
    set local role kondate_ops_readonly;
    insert into public.user_feedback (user_id, category, body)
    values (
      'a1000000-0000-4000-8000-0000000000aa',
      'other',
      'ops must not insert feedback body text here'
    );
  $$,
  '42501',
  null,
  'ops cannot insert user_feedback'
);

select throws_ok(
  $$
    set local role kondate_ops_readonly;
    select id from auth.users limit 1;
  $$,
  '42501',
  null,
  'ops cannot select auth.users'
);

select lives_ok(
  $$
    set local role kondate_ops_readonly;
    select id from private.ai_generation_requests limit 1;
    reset role;
  $$,
  'ops can select ai_generation_requests (may be empty)'
);

select lives_ok(
  $$
    set local role kondate_ops_readonly;
    select usage_day from private.ai_global_daily_usage limit 1;
    reset role;
  $$,
  'ops can select ai_global_daily_usage'
);

select lives_ok(
  $$
    set local role kondate_ops_readonly;
    select user_id from private.billing_subscriptions limit 1;
    reset role;
  $$,
  'ops can select billing_subscriptions'
);

select lives_ok(
  $$
    set local role kondate_ops_readonly;
    select stripe_event_id from private.billing_webhook_events limit 1;
    reset role;
  $$,
  'ops can select billing_webhook_events (column exists; app must not expose IDs)'
);

select lives_ok(
  $$
    set local role kondate_ops_readonly;
    select id from private.share_generalization_jobs limit 1;
    reset role;
  $$,
  'ops can select share_generalization_jobs'
);

select * from finish();
rollback;
