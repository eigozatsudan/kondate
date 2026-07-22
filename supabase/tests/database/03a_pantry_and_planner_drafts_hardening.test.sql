begin;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email)
values
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-owner1@example.invalid'),
  ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-owner2@example.invalid');

select has_function('private', 'is_canonical_bounded_text', array['text','integer','integer']);
select has_function('private', 'is_valid_draft_pantry_selections', array['jsonb']);
select has_function('private', 'is_valid_draft_text_array', array['text[]','integer','integer']);
select has_function('private', 'is_valid_draft_uuid_array', array['uuid[]','integer']);
select has_function('private', 'touch_updated_at', array[]::text[]);
select has_function('private', 'soft_delete_generation_draft', array['uuid','uuid','bigint']);

select ok(
  to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'), 'EXECUTE'), false),
  'canonical text helper is private'
);
select ok(
  to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'), 'EXECUTE'), false),
  'draft text-array helper is private'
);
select ok(
  to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'), 'EXECUTE'), false),
  'draft UUID-array helper is private'
);
select ok(
  to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)'), 'EXECUTE'), false),
  'soft-delete helper is private'
);
select ok(
  to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'), 'EXECUTE'), false),
  'draft pantry-selection helper is private'
);
select ok(
  to_regprocedure('private.touch_updated_at()') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.touch_updated_at()'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.touch_updated_at()'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.touch_updated_at()'), 'EXECUTE'), false),
  'updated-at trigger helper is private'
);
select ok(
  6 = (
    select count(*)
    from pg_proc as p
    where p.oid = any (array_remove(array[
      to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'),
      to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'),
      to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'),
      to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'),
      to_regprocedure('private.touch_updated_at()'),
      to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)')
    ], null))
  ) and not exists (
    select 1
    from pg_proc as p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where p.oid = any (array_remove(array[
      to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'),
      to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'),
      to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'),
      to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'),
      to_regprocedure('private.touch_updated_at()'),
      to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)')
    ], null)) and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execute grant on private draft helpers'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text[],text,jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text[],text,jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text[],text,jsonb)'), 'EXECUTE'), false),
  'only authenticated can execute the save RPC'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.delete_generation_draft(bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.delete_generation_draft(bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('public.delete_generation_draft(bigint)'), 'EXECUTE'), false),
  'only authenticated can execute the delete RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000012', true);
insert into public.pantry_items (id, user_id, name, quantity, unit)
values ('11000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000012', '所有者2の食材', 1, '個');
select public.save_generation_draft(
  0, 'lunch', array['所有者2の食材'], 'western', null, array[]::uuid[], null::smallint,
  15::smallint, 'economy', array[]::text[], '', '[]'::jsonb
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000011', true);
insert into public.pantry_items (id, user_id, name, quantity, unit)
values
  ('11000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '所有者1の食材', 1.234, '個'),
  ('11000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000011', repeat('🍳', 80), 1.2300, repeat('🍳', 24)),
  ('11000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000011', '数量上限', 999999, 'g');
select is((select count(*)::integer from public.pantry_items), 3, 'owner sees only own pantry rows');
select is(
  (select quantity from public.pantry_items where id = '11000000-0000-0000-0000-000000000013'),
  1.23::numeric,
  'equivalent trailing-zero precision round-trips without rejection'
);
select is((select count(*)::integer from public.pantry_items where id = '11000000-0000-0000-0000-000000000012'), 0, 'foreign pantry row is hidden');
select throws_ok(
  $$insert into public.pantry_items(user_id,name) values ('10000000-0000-0000-0000-000000000012','越境追加')$$,
  '42501', null, 'authenticated cannot insert a pantry row for another owner'
);
with changed as (
  update public.pantry_items set name = '侵害' where id = '11000000-0000-0000-0000-000000000012' returning 1
) select is((select count(*)::integer from changed), 0, 'foreign pantry update affects zero rows');
with removed as (
  delete from public.pantry_items where id = '11000000-0000-0000-0000-000000000012' returning 1
) select is((select count(*)::integer from removed), 0, 'foreign pantry delete affects zero rows');
update public.pantry_items set name = '所有者1の更新' where id = '11000000-0000-0000-0000-000000000011';
select is((select name from public.pantry_items where id = '11000000-0000-0000-0000-000000000011'), '所有者1の更新', 'owner can update own pantry row');
select throws_ok(
  $$update public.pantry_items set user_id = '10000000-0000-0000-0000-000000000012' where id = '11000000-0000-0000-0000-000000000013'$$,
  '42501', null, 'owner cannot transfer a pantry row to another user'
);
delete from public.pantry_items where id = '11000000-0000-0000-0000-000000000011';
select is((select count(*)::integer from public.pantry_items where id = '11000000-0000-0000-0000-000000000011'), 0, 'owner can delete own pantry row');
select is((select count(*)::integer from public.generation_drafts), 0, 'foreign active draft is hidden');

select throws_ok(
  $$insert into public.generation_drafts(user_id) values ('10000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'authenticated cannot directly insert own draft'
);
select throws_ok(
  $$insert into public.generation_drafts(user_id) values ('10000000-0000-0000-0000-000000000012')$$,
  '42501', null, 'authenticated cannot directly insert foreign draft'
);
select throws_ok(
  $$update public.generation_drafts set memo = '侵害' where user_id = '10000000-0000-0000-0000-000000000011'$$,
  '42501', null, 'authenticated cannot directly update own draft'
);
select throws_ok(
  $$update public.generation_drafts set memo = '侵害' where user_id = '10000000-0000-0000-0000-000000000012'$$,
  '42501', null, 'authenticated cannot directly update foreign draft'
);
select throws_ok(
  $$delete from public.generation_drafts where user_id = '10000000-0000-0000-0000-000000000011'$$,
  '42501', null, 'authenticated cannot directly delete own draft'
);
select throws_ok(
  $$delete from public.generation_drafts where user_id = '10000000-0000-0000-0000-000000000012'$$,
  '42501', null, 'authenticated cannot directly delete foreign draft'
);

select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','NaN','NaN'::numeric,'g')$$,
  '23514', null, 'quantity rejects numeric NaN'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','上限超過',1000000,'g')$$,
  '23514', null, 'quantity rejects values above 999999'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','小数4桁',1.2345,'g')$$,
  '23514', null, 'quantity rejects more than three decimal places'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name) values ('10000000-0000-0000-0000-000000000011',U&'\00A0padding\FEFF')$$,
  '23514', null, 'pantry name rejects ECMAScript Unicode padding'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','単位',1,U&'\FEFFg\00A0')$$,
  '23514', null, 'pantry unit rejects ECMAScript Unicode padding'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name) values ('10000000-0000-0000-0000-000000000011',repeat('🍳',81))$$,
  '23514', null, 'pantry name counts astral characters as code points'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','単位超過',1,repeat('🍳',25))$$,
  '23514', null, 'pantry unit counts astral characters as code points'
);

select throws_ok(
  $$select public.save_generation_draft(null,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '22023', 'invalid_draft_save', 'NULL expected revision is invalid'
);
select throws_ok(
  $$select public.save_generation_draft(-1,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '22023', 'invalid_draft_save', 'negative expected revision is invalid'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[null::text],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject NULL elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[['鶏肉']]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject multidimensional arrays'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array['   ']::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject blank elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[U&'\00A0鶏肉\FEFF']::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject Unicode padding'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[repeat('🍳',81)]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject elements above 80 code points'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,'household',array[null::uuid],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'target members reject NULL elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,'household',array[['20000000-0000-0000-0000-000000000001'::uuid]],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'target members reject multidimensional arrays'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[null::text],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject NULL elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[['乳']]::text[],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject multidimensional arrays'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[U&'\2028乳']::text[],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject Unicode padding'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[repeat('x',81)]::text[],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject overlong elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],U&'\FEFFmemo','[]'::jsonb)$$,
  '23514', null, 'memo rejects non-canonical padding'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],repeat('🍳',201),'[]'::jsonb)$$,
  '23514', null, 'memo rejects more than 200 code points'
);

select is(
  (public.save_generation_draft(
    0, null, array_fill(repeat('🍳',80), array[8]), null, 'household',
    array(select ('20000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,20) as values_(i)),
    null::smallint,
    null, null, array(select '避ける' || i from generate_series(1,20) as values_(i)), repeat('🍳',200),
    (select jsonb_agg(jsonb_build_object('pantryItemId',('21000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'priority','prefer_use')) from generate_series(1,50) as values_(i))
  )).revision,
  1::bigint,
  'all declared count and code-point maxima are accepted'
);
select is(
  (select jsonb_build_object(
    'mealType',meal_type,'mainIngredients',main_ingredients,'cuisineGenre',cuisine_genre,
    'targetMemberIds',target_member_ids,'timeLimitMinutes',time_limit_minutes,
    'budgetPreference',budget_preference,'avoidIngredients',avoid_ingredients,
    'memo',memo,'pantrySelections',pantry_selections,'revision',revision
  ) from public.generation_drafts),
  jsonb_build_object(
    'mealType',null,'mainIngredients',array_fill(repeat('🍳',80), array[8]),'cuisineGenre',null,
    'targetMemberIds',array(select ('20000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,20) as values_(i)),
    'timeLimitMinutes',null,'budgetPreference',null,
    'avoidIngredients',array(select '避ける' || i from generate_series(1,20) as values_(i)),
    'memo',repeat('🍳',200),
    'pantrySelections',(select jsonb_agg(jsonb_build_object('pantryItemId',('21000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'priority','prefer_use')) from generate_series(1,50) as values_(i)),
    'revision',1
  ),
  'create round-trips every nullable and collection payload field'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array(select '食材' || i from generate_series(1,9) as values_(i)),null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredient count rejects nine'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,'household',array(select ('22000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,21) as values_(i)),null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'target member count rejects twenty-one'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array(select '回避' || i from generate_series(1,21) as values_(i)),'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredient count rejects twenty-one'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'', (select jsonb_agg(jsonb_build_object('pantryItemId',('23000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'priority','must_use')) from generate_series(1,51) as values_(i)))$$,
  '23514', null, 'pantry selection count rejects fifty-one'
);

select is(
  (public.save_generation_draft(
    1, 'dinner', array['鶏肉','白菜'], 'japanese', 'household',
    array['20000000-0000-0000-0000-000000000001'::uuid], null::smallint, 30::smallint,
    'standard', array['乳'], '更新',
    '[{"pantryItemId":"21000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb
  )).revision,
  2::bigint,
  'valid update increments revision'
);
select is(
  (select jsonb_build_object(
    'mealType',meal_type,'mainIngredients',main_ingredients,'cuisineGenre',cuisine_genre,
    'targetMemberIds',target_member_ids,'timeLimitMinutes',time_limit_minutes,
    'budgetPreference',budget_preference,'avoidIngredients',avoid_ingredients,
    'memo',memo,'pantrySelections',pantry_selections,'revision',revision
  ) from public.generation_drafts),
  jsonb_build_object(
    'mealType','dinner','mainIngredients',array['鶏肉','白菜'],'cuisineGenre','japanese',
    'targetMemberIds',array['20000000-0000-0000-0000-000000000001'::uuid],
    'timeLimitMinutes',30,'budgetPreference','standard','avoidIngredients',array['乳'],
    'memo','更新','pantrySelections','[{"pantryItemId":"21000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb,
    'revision',2
  ),
  'update round-trips the complete payload'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,null,null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  'P0001', 'draft_revision_conflict',
  'expected revision zero conflicts with an active draft before payload validation'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,null,array[]::uuid[],null::smallint,null,null,array[]::text[],'','[]'::jsonb)$$,
  'P0001', 'draft_revision_conflict', 'stale save is rejected'
);
select is(public.delete_generation_draft(2), 3::bigint, 'delete increments the authoritative revision');
select is((select count(*)::integer from public.generation_drafts), 0, 'soft-deleted draft is hidden from its owner');
select throws_ok(
  $$select public.delete_generation_draft(2)$$,
  'P0001', 'draft_revision_conflict', 'stale delete is rejected'
);
select throws_ok(
  $$select public.delete_generation_draft(null)$$,
  '22023', 'invalid_draft_save', 'NULL delete revision is invalid'
);
select throws_ok(
  $$select public.delete_generation_draft(-1)$$,
  '22023', 'invalid_draft_save', 'negative delete revision is invalid'
);
select is(
  (public.save_generation_draft(0,'dinner',array['再作成'],'japanese',null,array[]::uuid[],null::smallint,30::smallint,'standard',array[]::text[],'','[]'::jsonb)).revision,
  4::bigint,
  'recreation continues the tombstone revision'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['古い画面'],'japanese',null,array[]::uuid[],null::smallint,30::smallint,'standard',array[]::text[],'','[]'::jsonb)$$,
  'P0001', 'draft_revision_conflict', 'pre-delete revision cannot overwrite recreation'
);

reset role;
select is(
  (select count(*)::integer from public.pantry_items where id = '11000000-0000-0000-0000-000000000012' and name = '所有者2の食材'),
  1,
  'foreign pantry mutation attempts leave the row unchanged'
);
select is(
  (select revision from public.generation_drafts where user_id = '10000000-0000-0000-0000-000000000011'),
  4::bigint,
  'tombstone lineage remains monotonic after recreation'
);

select * from finish();
rollback;
