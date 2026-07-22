begin;
select plan(42);

select has_table('public', 'pantry_items', 'pantry item table exists');
select has_table('public', 'generation_drafts', 'generation draft table exists');
select has_column('public', 'pantry_items', 'expiration_type',
  'pantry item has an expiration type');
select has_column('public', 'pantry_items', 'opened_state',
  'pantry item has an opened state');
select has_column('public', 'generation_drafts', 'pantry_selections',
  'generation draft has pantry selections');
select has_column('public', 'generation_drafts', 'target_mode',
  'generation draft has a target mode');
select has_column('public', 'generation_drafts', 'servings',
  'generation draft has a servings count');
select has_column('public', 'generation_drafts', 'revision',
  'generation draft has a revision');
select has_column('public', 'generation_drafts', 'deleted_at',
  'generation draft has a deletion tombstone');
select is(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.generation_drafts'::regclass
      and conname = 'generation_drafts_pantry_selections_size_check'
  ),
  'CHECK ((pg_column_size(pantry_selections) <= 32768))',
  'generation draft has a physical 32 KiB pantry selections check'
);
select has_function('public', 'delete_generation_draft', array['bigint']);
select ok((select relrowsecurity from pg_class where oid = 'public.pantry_items'::regclass),
  'pantry item RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.generation_drafts'::regclass),
  'generation draft RLS is enabled');
select has_function('public','save_generation_draft',
  array['bigint','text','text[]','text','text','uuid[]','smallint','smallint','text','text[]','text','jsonb']);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner1@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner2@example.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

insert into public.pantry_items (user_id, name, quantity, unit, expires_on, expiration_type, opened_state)
values ('10000000-0000-0000-0000-000000000001', 'にんじん', 2, '本', current_date - 1, 'use_by', 'opened');

select is((select count(*)::integer from public.pantry_items), 1, 'owner reads own pantry row');
select throws_ok(
  $$insert into public.pantry_items (user_id, name) values ('10000000-0000-0000-0000-000000000002', 'たまねぎ')$$,
  '42501', null, 'owner cannot insert for another user'
);
select throws_ok(
  $$insert into public.pantry_items (user_id, name, quantity, unit) values ('10000000-0000-0000-0000-000000000001', '牛乳', -1, 'ml')$$,
  '23514', null, 'quantity must be positive'
);

select public.save_generation_draft(0,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
  30::smallint,'standard',array[]::text[],'',
  '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb);

select is((select count(*)::integer from public.generation_drafts), 1, 'owner reads one draft');
select is((select revision from public.generation_drafts),1::bigint,
  'first authoritative save creates revision one');
select public.save_generation_draft(1,'dinner',array['鶏肉','白菜'],'japanese',null,array[]::uuid[],null::smallint,
  30::smallint,'standard',array[]::text[],'更新', '[]'::jsonb);
select is((select revision from public.generation_drafts),2::bigint,
  'each serialized save increments revision exactly once');
select throws_ok($$select public.save_generation_draft(1,'dinner',array[]::text[],
  'japanese',null,array[]::uuid[],null::smallint,30::smallint,'standard',array[]::text[],'stale','[]'::jsonb)$$,
  'P0001','draft_revision_conflict','a stale save cannot overwrite a newer draft');
select throws_ok($$insert into public.generation_drafts(user_id)
  values('10000000-0000-0000-0000-000000000001')$$,
  '42501',null,'browser cannot bypass the monotonic save RPC');
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use","checkedAt":"2026-07-11T00:00:00Z"}]'::jsonb)$$,
  '23514', null, 'expired confirmation cannot be persisted'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"not-a-uuid","priority":"must_use"}]'::jsonb)$$,
  '23514', null, 'pantry item ID must be a UUID'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"optional"}]'::jsonb)$$,
  '23514', null, 'pantry priority must be a declared value'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'','[{"priority":"must_use"}]'::jsonb)$$,
  '23514', null, 'pantry selection requires a pantry item ID'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001"}]'::jsonb)$$,
  '23514', null, 'pantry selection requires a priority'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use","note":"x"}]'::jsonb)$$,
  '23514', null, 'pantry selection rejects undeclared keys'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'','["invalid"]'::jsonb)$$,
  '23514', null, 'pantry selection must be an object'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'',(
      select jsonb_agg(jsonb_build_object(
        'pantryItemId', format(
          '20000000-0000-4000-8000-%s', lpad(generate_series::text, 12, '0')
        ),
        'priority', 'must_use'
      ))
      from generate_series(1, 51)
    ))$$,
  '23514', null, 'a draft cannot persist more than 50 pantry selections'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
    30::smallint,'standard',array[]::text[],'',jsonb_build_array(jsonb_build_object(
      'pantryItemId', '20000000-0000-4000-8000-000000000001',
      'priority', repeat('must_use', 5000)
    )))$$,
  '23514', null, 'a draft cannot persist pantry selections larger than 32 KiB'
);

-- 質問途中のdraftはtarget_mode/servingsがnullのままでも他条件を保持する
select is((select meal_type from public.generation_drafts), 'dinner',
  'incomplete target draft keeps the meal type');
select is((select target_mode from public.generation_drafts), null,
  'incomplete target draft keeps target_mode null');
select is((select servings from public.generation_drafts), null,
  'incomplete target draft keeps servings null');

-- household: 家族1〜20人・servings null
select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese','household',
  array['20000000-0000-4000-8000-000000000099']::uuid[],null::smallint,
  30::smallint,'standard',array[]::text[],'', '[]'::jsonb);
select is((select target_mode from public.generation_drafts), 'household',
  'household save persists target_mode');
select is((select servings from public.generation_drafts), null,
  'household save keeps servings null');

-- idea: 家族0人・servings 1〜20
select public.save_generation_draft(3,'dinner',array['鶏肉'],'japanese','idea',
  array[]::uuid[],2::smallint,
  30::smallint,'standard',array[]::text[],'', '[]'::jsonb);
select is((select target_mode from public.generation_drafts), 'idea',
  'idea save persists target_mode');
select is((select servings from public.generation_drafts), 2::smallint,
  'idea save persists servings');

-- 矛盾する組み合わせはCHECKで拒否する
select throws_ok(
  $$select public.save_generation_draft(4,'dinner',array['鶏肉'],'japanese','household',
    array[]::uuid[],null::smallint,30::smallint,'standard',array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'household with no target members is rejected'
);
select throws_ok(
  $$select public.save_generation_draft(4,'dinner',array['鶏肉'],'japanese','household',
    array['20000000-0000-4000-8000-000000000099']::uuid[],2::smallint,
    30::smallint,'standard',array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'household with servings set is rejected'
);
select throws_ok(
  $$select public.save_generation_draft(4,'dinner',array['鶏肉'],'japanese','idea',
    array['20000000-0000-4000-8000-000000000099']::uuid[],2::smallint,
    30::smallint,'standard',array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'idea with target members is rejected'
);
select throws_ok(
  $$select public.save_generation_draft(4,'dinner',array['鶏肉'],'japanese','idea',
    array[]::uuid[],null::smallint,30::smallint,'standard',array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'idea without servings is rejected'
);

select * from finish();
rollback;
