\ir 000_helpers.sql
begin;
select plan(60);
select has_table('public','shopping_lists','shopping_lists exists');
select has_table('public','shopping_items','shopping_items exists');
select has_table('public','shopping_list_sources','shopping_list_sources exists');
select has_table('public','shopping_item_sources','shopping_item_sources exists');
select has_table('public','shopping_label_confirmations','shopping_label_confirmations exists');
select has_table('public','shopping_current_label_warnings','shopping_current_label_warnings exists');
select has_index('public','dish_ingredients','dish_ingredients_id_user_unique',
  'shopping source owner FK has an exact referenced unique key');
select has_index('public','menu_label_confirmations','menu_label_confirmations_id_user_unique',
  'shopping label owner FK has an exact referenced unique key');
select has_table('private','shopping_mutations','shopping_mutations exists');
select ok((select bool_and(attnotnull) from pg_attribute
  where attrelid in ('public.shopping_lists'::regclass,'public.shopping_items'::regclass,
    'public.shopping_list_sources'::regclass,'public.shopping_item_sources'::regclass,
    'public.shopping_label_confirmations'::regclass,
    'public.shopping_current_label_warnings'::regclass)
    and attname='user_id' and not attisdropped), 'every public shopping table has non-null user_id');
select ok((select relrowsecurity from pg_class where oid = 'public.shopping_lists'::regclass),
  'shopping_lists has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shopping_items'::regclass),
  'shopping_items has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shopping_list_sources'::regclass),
  'shopping_list_sources has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shopping_item_sources'::regclass),
  'shopping_item_sources has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shopping_label_confirmations'::regclass),
  'shopping_label_confirmations has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shopping_current_label_warnings'::regclass),
  'shopping_current_label_warnings has RLS enabled');
select has_function('public','shopping_safety_fingerprint',array['uuid','uuid']);
select has_function('public','shopping_list_safety_fingerprint',array['uuid','uuid']);
select has_function('public','refresh_shopping_list_safety',array['uuid','uuid','text','jsonb']);
select has_function('public','apply_shopping_draft',
  array['uuid','uuid','text','uuid','integer','text','uuid','text','jsonb']);
select has_function('public','apply_shopping_reconciliation',
  array['uuid','uuid','integer','uuid','integer','text','uuid','text','jsonb']);
select has_function('public','get_shopping_mutation_replay',array['uuid','uuid','text']);
select has_function('public','mutate_shopping_item',
  array['uuid','integer','text','text','uuid','uuid','jsonb']);
select hasnt_function('private','apply_shopping_draft',
  array['uuid','uuid','text','uuid','integer','text','uuid','text','jsonb'],
  'callable draft RPC is not hidden in private');
select ok(not has_function_privilege('authenticated',
  'public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)','execute'),
  'authenticated cannot execute derived-write RPC');
select ok(has_function_privilege('service_role',
  'public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)','execute'),
  'service role can execute derived-write RPC');
select ok(has_function_privilege('authenticated',
  'public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)','execute'),
  'authenticated owner can execute versioned item RPC');
select col_is_null('public','shopping_list_sources','menu_id','live menu reference is nullable');
select col_is_null('public','shopping_item_sources','dish_ingredient_id','live ingredient reference is nullable');
select col_is_null('public','shopping_label_confirmations','menu_label_confirmation_id','live label reference is nullable');
select col_is_null('public','shopping_label_confirmations','source_confirmation_id_snapshot',
  'a current warning may have no historical confirmation row');
select has_column('public','shopping_label_confirmations','source_warning_key',
  'every warning has a canonical non-null identity independent of a confirmation UUID');
select has_column('public','shopping_current_label_warnings','warning_key',
  'current projection has its independent canonical warning identity');
select ok((select count(*)=3 from information_schema.columns where table_schema='public'
    and table_name='shopping_current_label_warnings'
    and column_name in ('source_display_name','allergen_display_name','member_display_name')),
  'current projection stores all bounded human display fields');
select ok((select count(*)=3 from pg_constraint where
    conrelid='public.shopping_current_label_warnings'::regclass and contype='f'
    and conname in ('shopping_current_label_warnings_list_owner_fk',
      'shopping_current_label_warnings_item_owner_fk',
      'shopping_current_label_warnings_menu_owner_fk')),
  'current projection uses exact composite owner foreign keys');
select ok(not has_table_privilege('authenticated','public.shopping_current_label_warnings','insert')
    and not has_table_privilege('authenticated','public.shopping_current_label_warnings','update')
    and not has_table_privilege('authenticated','public.shopping_current_label_warnings','delete'),
  'browser cannot mutate the latest current projection');
select ok((select count(*)=2 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename in ('household_members','member_allergies'))
    and (select count(*)=2 from pg_class where oid in
      ('public.household_members'::regclass,'public.member_allergies'::regclass)
      and relreplident='f'),
  'owner household safety tables publish full-row cross-device changes');
select ok(not has_table_privilege('authenticated','public.shopping_list_sources','insert'),
  'browser cannot insert source snapshots');
select ok(not has_table_privilege('authenticated','public.shopping_label_confirmations','update'),
  'browser cannot alter warning snapshots');
select ok(not has_table_privilege('authenticated','public.shopping_items','insert'),
  'browser cannot insert shopping rows directly');
select ok(not has_table_privilege('authenticated','public.shopping_items','update')
  and not has_table_privilege('authenticated','public.shopping_items','delete'),
  'browser cannot update or delete shopping rows directly');

-- =============================================================================
-- 挙動系テスト（Plan 5 Task 2 Step 1 後半、続き）:
-- 不変provenance保存、current projection切替、履歴削除cascade。
-- 同一ファイル内は pg_prove が単一TAPストリームとして扱うため、
-- plan()/finish() は1ファイル1組（既存の repo 規約、他の *.test.sql と同様）。
-- =============================================================================

insert into auth.users (id,instance_id,aud,role,email) values
  ('f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','shopping-owner-a@example.test');

insert into public.household_members (
  id,user_id,status,display_name,age_band,portion_size,spice_level,
  allergy_status,unsupported_diet_status
) values (
  'f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
  'draft','子ども','age_6_8','regular','mild','registered','none'
);
insert into public.member_allergies (
  id,user_id,member_id,allergen_id,custom_name,custom_confirmed
) values (
  'f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001','wheat',null,false
);
update public.household_members set status='complete'
  where id='f2000000-0000-4000-8000-000000000001';

insert into public.menus (
  id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
  preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,
  food_safety_rule_version,output_schema_version,derivation_group_id,version
) values (
  'f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
  'dinner','japanese',2,30,'{}','{}',repeat('a',64),'allergens-v1','food-v1','menu-v1',
  'f5000000-0000-4000-8000-000000000001',1
);
insert into public.menu_target_members (
  id,menu_id,user_id,household_member_id,household_member_user_id,
  anonymous_ref,member_display_name_snapshot
) values (
  'f6000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001','member_1','子ども'
);
insert into public.dishes (
  id,menu_id,user_id,role,position,name,description,cooking_time_minutes
) values (
  'f8000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001','main',1,'煮物','買い物リスト検証用の煮物です',20
);
insert into public.dish_ingredients (
  id,menu_id,dish_id,user_id,position,name,quantity_value,quantity_text,unit,store_section
) values (
  'f7000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
  1,'にんじん',1,'1本','本','produce'
);

-- 安全フィンガープリントを取得してリストを作成する（apply_shopping_draft は service_role 専用）
do $test$
declare
  v_owner constant uuid := 'f1000000-0000-4000-8000-000000000001';
  v_menu constant uuid := 'f4000000-0000-4000-8000-000000000001';
  v_fingerprint text;
  v_draft jsonb;
  v_response jsonb;
  v_list_id uuid;
  v_warning_a jsonb;
  v_warning_b jsonb;
  v_saved_created_at timestamptz;
  v_saved_row record;
begin
  v_fingerprint := public.shopping_safety_fingerprint(v_owner, v_menu);
  v_draft := jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'key','carrot-1','displayName','にんじん','normalizedName','にんじん',
      'storeSection','produce','quantityValue',1,'quantityText','1本','unit','本',
      'pantryCheckRequired',false,
      'sourceIngredients', jsonb_build_array(jsonb_build_object(
        'ingredientId','f7000000-0000-4000-8000-000000000001',
        'dishId','f8000000-0000-4000-8000-000000000001','dishName','煮物','name','にんじん',
        'quantityValue',1,'quantityText','1本','unit','本','storeSection','produce'
      )),
      'labelWarnings', jsonb_build_array(jsonb_build_object(
        'confirmationId',null,'warningKey',repeat('a',64),
        'sourceMenuId',v_menu,'sourceDerivationGroupId','f5000000-0000-4000-8000-000000000001',
        'sourceType','ingredient','sourceId','f7000000-0000-4000-8000-000000000001',
        'sourcePath','dishes.0.ingredients.0','allergenId','wheat','allergenDisplayName','小麦',
        'anonymousMemberRef','member_1','memberDisplayName','子ども','sourceDisplayName','にんじん',
        'dictionaryVersion','allergen-v1','confirmationStatus','pending'
      ))
    )),
    'listLabelWarnings', '[]'::jsonb
  );
  v_response := public.apply_shopping_draft(
    v_owner, v_menu, 'new', null, null, v_fingerprint,
    'f9000000-0000-4000-8000-000000000001'::uuid,
    encode(extensions.digest(convert_to('creation-a','UTF8'),'sha256'),'hex'),
    v_draft
  );
  v_list_id := (v_response->>'listId')::uuid;
  if v_list_id is null then
    raise exception 'list creation did not return a listId';
  end if;
  perform set_config('tests.shopping_list_id', v_list_id::text, false);

  -- 不変provenanceが保存されたことを確認（warning A）
  select created_at into v_saved_created_at from public.shopping_label_confirmations
    where list_id = v_list_id and source_warning_key = repeat('a',64);
  if v_saved_created_at is null then
    raise exception 'immutable warning A was not persisted at creation';
  end if;

  -- current projection A へ refresh。refresh_shopping_list_safety が比較するのは
  -- リスト単位のフィンガープリント（shopping_list_safety_fingerprint）であり、
  -- apply_shopping_draft に渡したメニュー単位のフィンガープリントとは別物。
  v_warning_a := jsonb_build_object(
    'itemId',null,'warningKey',repeat('a',64),'sourceMenuId',v_menu,
    'sourceDerivationGroupId','f5000000-0000-4000-8000-000000000001','sourceType','ingredient',
    'sourceId','f7000000-0000-4000-8000-000000000001','sourcePath','dishes.0.ingredients.0',
    'sourceDisplayName','にんじん','allergenId','wheat','allergenDisplayName','小麦',
    'anonymousMemberRef','member_1','memberDisplayName','子ども','dictionaryVersion','allergen-v1'
  );
  perform public.refresh_shopping_list_safety(
    v_owner, v_list_id, public.shopping_list_safety_fingerprint(v_owner, v_list_id),
    jsonb_build_array(v_warning_a)
  );
  if (select count(*)::integer from public.shopping_current_label_warnings
        where list_id = v_list_id) <> 1 then
    raise exception 'current projection A did not contain exactly one warning';
  end if;
  if (select warning_key from public.shopping_current_label_warnings
        where list_id = v_list_id) <> repeat('a',64) then
    raise exception 'current projection A did not persist warning key a';
  end if;

  -- current projection を B に切替（A の provenance は変更しない）
  v_warning_b := jsonb_build_object(
    'itemId',null,'warningKey',repeat('b',64),'sourceMenuId',v_menu,
    'sourceDerivationGroupId','f5000000-0000-4000-8000-000000000001','sourceType','ingredient',
    'sourceId','f7000000-0000-4000-8000-000000000001','sourcePath','dishes.0.ingredients.0',
    'sourceDisplayName','にんじん','allergenId','soy','allergenDisplayName','大豆',
    'anonymousMemberRef','member_1','memberDisplayName','子ども','dictionaryVersion','allergen-v1'
  );
  perform public.refresh_shopping_list_safety(
    v_owner, v_list_id, public.shopping_list_safety_fingerprint(v_owner, v_list_id),
    jsonb_build_array(v_warning_b)
  );
  if (select count(*)::integer from public.shopping_current_label_warnings
        where list_id = v_list_id) <> 1
    or (select warning_key from public.shopping_current_label_warnings
          where list_id = v_list_id) <> repeat('b',64) then
    raise exception 'current projection did not switch from A to B';
  end if;

  -- immutable provenance A は byte-identical のまま
  select created_at into v_saved_created_at from public.shopping_label_confirmations
    where list_id = v_list_id and source_warning_key = repeat('a',64);
  if v_saved_created_at is null then
    raise exception 'immutable warning A was lost after current projection switched to B';
  end if;
end;
$test$;

select ok(
  exists(select 1 from public.shopping_label_confirmations
    where list_id = current_setting('tests.shopping_list_id')::uuid
      and source_warning_key = repeat('a',64)),
  'immutable warning A remains after current projection moved to B'
);
select is(
  (select count(*)::integer from public.shopping_current_label_warnings
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  1, 'current projection contains exactly one active warning'
);
select is(
  (select warning_key from public.shopping_current_label_warnings
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  repeat('b',64), 'current projection holds only warning B after refresh'
);
select is(
  (select count(*)::integer from public.shopping_lists
    where id = current_setting('tests.shopping_list_id')::uuid),
  1, 'list row count is unchanged by projection refresh'
);
select is(
  (select count(*)::integer from public.shopping_items
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  1, 'item row count is unchanged by projection refresh'
);

-- 履歴（derivation group）削除: cascade を確認
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select is(
  public.delete_menu_group('f5000000-0000-4000-8000-000000000001'::uuid),
  1, 'owner can delete the source menu group'
);
reset role;

select is(
  (select count(*)::integer from public.shopping_lists
    where id = current_setting('tests.shopping_list_id')::uuid),
  1, 'shopping list row count is unchanged after source menu deletion'
);
select is(
  (select count(*)::integer from public.shopping_items
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  1, 'shopping item row count is unchanged after source menu deletion'
);
select is(
  (select menu_id from public.shopping_list_sources
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  null, 'live menu reference becomes null after history deletion'
);
select is(
  (select source_menu_id_snapshot from public.shopping_list_sources
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  'f4000000-0000-4000-8000-000000000001'::uuid,
  'source_menu_id_snapshot remains after live menu deletion'
);
select ok(
  exists(select 1 from public.shopping_label_confirmations
    where list_id = current_setting('tests.shopping_list_id')::uuid
      and source_warning_key = repeat('a',64)
      and source_display_name = 'にんじん'),
  'immutable warning A human fields remain unchanged after live-menu deletion'
);
select is(
  (select count(*)::integer from public.shopping_current_label_warnings
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  0, 'current projection is empty after its live source menu cascades away'
);

-- 失敗/フィンガープリント競合の refresh はロールバックし、以前の current projection と
-- immutable provenance を変更しない（メニューが削除済みのため fingerprint 比較前に安全チェックで失敗する）
select throws_ok(
  format(
    $$select public.refresh_shopping_list_safety(%L::uuid,%L::uuid,%L,'[]'::jsonb)$$,
    'f1000000-0000-4000-8000-000000000001'::uuid,
    current_setting('tests.shopping_list_id')::uuid,
    repeat('a',64)
  ),
  'P0001',
  'shopping_safety_fingerprint_changed',
  'a refresh after the only source menu is gone fails closed with no fingerprint token'
);
select is(
  (select count(*)::integer from public.shopping_current_label_warnings
    where list_id = current_setting('tests.shopping_list_id')::uuid),
  0, 'failed refresh leaves current projection empty (unchanged) rather than partially written'
);
select ok(
  exists(select 1 from public.shopping_label_confirmations
    where list_id = current_setting('tests.shopping_list_id')::uuid
      and source_warning_key = repeat('a',64)),
  'failed refresh does not touch immutable provenance'
);

-- -----------------------------------------------------------------------------
-- 30日retention境界値テスト:
-- ユーザーA: 期限切れ150件 + 新鮮2件。ユーザーB: 期限切れ1件。
-- 依頼されたキー（期限切れ）は最も古い100件より新しい位置にあるものを選ぶ。
-- 1回目のA所有の replay lookup は、その100件 + 明示的に指定されたそのキー
-- （合計最大101件）だけを削除し、依頼されたキーはreplayせず、他user/新鮮な行は
-- 一切変更しない。2回目のlookupは残りの期限切れA所有行（最大49件）を削除する。
-- ぴったり30日前の行はcutoff未満（strictly older）でない限り残る。
-- 物理削除は無制限DELETEを一切使わない。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_user_a constant uuid := 'c1000000-0000-4000-8000-000000000001';
  v_user_b constant uuid := 'c1000000-0000-4000-8000-000000000002';
  v_boundary_key constant uuid := 'c2000000-0000-4000-8000-000000000030'; -- 31番目に古い（100件目より新しい）
  v_requested_key uuid;
  v_i integer;
  v_response jsonb;
  v_remaining_a integer;
  v_remaining_b integer;
  v_fresh_count integer;
  v_boundary_exact_created_at timestamptz;
begin
  insert into auth.users (id,instance_id,aud,role,email) values
    (v_user_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'shopping-retention-a@example.test'),
    (v_user_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'shopping-retention-b@example.test');

  -- ユーザーA: 期限切れ150件（created_atを古い順に1秒ずつずらし、順序を一意にする）
  for v_i in 1..150 loop
    insert into private.shopping_mutations (user_id,idempotency_key,request_hash,response,created_at)
    values (
      v_user_a,
      ('c2000000-0000-4000-8000-' || lpad(v_i::text,12,'0'))::uuid,
      repeat('a',64),
      jsonb_build_object('listId',v_user_a,'version',1,'replayed',false),
      now() - interval '31 days' - (v_i || ' seconds')::interval
    );
  end loop;
  -- ユーザーA: 新鮮2件
  insert into private.shopping_mutations (user_id,idempotency_key,request_hash,response,created_at)
  values
    (v_user_a,'c3000000-0000-4000-8000-000000000001',repeat('1',64),
      jsonb_build_object('listId',v_user_a,'version',1,'replayed',false), now()),
    (v_user_a,'c3000000-0000-4000-8000-000000000002',repeat('2',64),
      jsonb_build_object('listId',v_user_a,'version',1,'replayed',false), now());
  -- ユーザーB: 期限切れ1件
  insert into private.shopping_mutations (user_id,idempotency_key,request_hash,response,created_at)
  values
    (v_user_b,'c4000000-0000-4000-8000-000000000001',repeat('3',64),
      jsonb_build_object('listId',v_user_b,'version',1,'replayed',false),
      now() - interval '31 days');

  -- 依頼するキーは「最も古い100件」に含まれない位置にする。created_atは
  -- now()-31日-(v_i秒)なので、v_iが大きいほど過去（古い）。つまり
  -- v_i=150が最も古く、v_i=1が最も新しい（期限切れの中では）。
  -- 「最も古い100件」は v_i=51..150 に対応するため、それに含まれない
  -- v_i=50（101番目に古い、すなわち50番目に新しい）を依頼キーにする。
  v_requested_key := ('c2000000-0000-4000-8000-' || lpad('50',12,'0'))::uuid;

  -- 1回目の replay lookup: 依頼されたキー(v_i=50)を対象に呼ぶ。
  -- cleanup_expired_shopping_mutations(v_user_a,100) が最も古い100件
  -- （v_i=51..150）を削除し、続けて「依頼されたキーが期限切れなら削除」する
  -- 個別deleteが v_i=50 の行を追加で消す。
  -- 結果: 依頼されたキーはreplayされず（nullが返る）、新鮮な行とBの行は無傷。
  -- 残るのは v_i=1..49 の49件。
  v_response := public.get_shopping_mutation_replay(v_user_a, v_requested_key, repeat('a',64));
  if v_response is not null then
    raise exception 'retention: an expired requested key must not be replayed';
  end if;

  select count(*)::integer into v_remaining_a from private.shopping_mutations
    where user_id = v_user_a and idempotency_key <> 'c3000000-0000-4000-8000-000000000001'::uuid
      and idempotency_key <> 'c3000000-0000-4000-8000-000000000002'::uuid;
  if v_remaining_a <> 49 then
    raise exception 'retention: first lookup should leave exactly 49 expired A-owned rows '
      '(150-100-1 explicitly requested key), got %', v_remaining_a;
  end if;

  select count(*)::integer into v_fresh_count from private.shopping_mutations
    where user_id = v_user_a and idempotency_key in (
      'c3000000-0000-4000-8000-000000000001'::uuid,'c3000000-0000-4000-8000-000000000002'::uuid
    );
  if v_fresh_count <> 2 then
    raise exception 'retention: fresh A-owned rows must remain untouched, got %', v_fresh_count;
  end if;

  select count(*)::integer into v_remaining_b from private.shopping_mutations where user_id = v_user_b;
  if v_remaining_b <> 1 then
    raise exception 'retention: B-owned expired row must remain untouched by an A-owned lookup, got %', v_remaining_b;
  end if;

  -- 2回目の A所有 lookup: 残り49件の期限切れA行のうち、最大100件（今回は49件全部）を
  -- 削除する。依頼するキーは新鮮な行にして、この呼び出し自体は成功して
  -- replayを返すことを確認する（新鮮な行はcutoffの対象外）。
  v_response := public.get_shopping_mutation_replay(
    v_user_a, 'c3000000-0000-4000-8000-000000000001'::uuid, repeat('1',64)
  );
  if v_response is null or (v_response->>'replayed')::boolean is distinct from true then
    raise exception 'retention: a fresh saved mutation must still replay successfully';
  end if;

  select count(*)::integer into v_remaining_a from private.shopping_mutations
    where user_id = v_user_a and idempotency_key not in (
      'c3000000-0000-4000-8000-000000000001'::uuid,'c3000000-0000-4000-8000-000000000002'::uuid
    );
  if v_remaining_a <> 0 then
    raise exception 'retention: second lookup should remove all remaining expired A-owned rows, got %', v_remaining_a;
  end if;

  select count(*)::integer into v_fresh_count from private.shopping_mutations
    where user_id = v_user_a and idempotency_key in (
      'c3000000-0000-4000-8000-000000000001'::uuid,'c3000000-0000-4000-8000-000000000002'::uuid
    );
  if v_fresh_count <> 2 then
    raise exception 'retention: fresh A-owned rows must still remain after the second lookup, got %', v_fresh_count;
  end if;

  select count(*)::integer into v_remaining_b from private.shopping_mutations where user_id = v_user_b;
  if v_remaining_b <> 1 then
    raise exception 'retention: B-owned expired row must remain untouched throughout, got %', v_remaining_b;
  end if;

  -- ちょうど30日前の行は cutoff（now()-30日より厳密に古い）未満でない限り残る。
  insert into private.shopping_mutations (user_id,idempotency_key,request_hash,response,created_at)
  values (
    v_user_a,'c5000000-0000-4000-8000-000000000001',repeat('4',64),
    jsonb_build_object('listId',v_user_a,'version',1,'replayed',false),
    now() - interval '30 days'
  );
  v_response := public.get_shopping_mutation_replay(
    v_user_a, 'c5000000-0000-4000-8000-000000000001'::uuid, repeat('4',64)
  );
  if v_response is null then
    raise exception 'retention: a row exactly 30 days old must not be treated as expired';
  end if;
end;
$test$;
select pass('retention: bounded owner-scoped cleanup removes at most 100 expired rows per lookup, '
  || 'never touches another owner or fresh rows, and a row exactly 30 days old is not expired');

-- 無制限DELETEが実装に一切含まれていないことをソースレベルで確認する。
-- （private.cleanup_expired_shopping_mutationsはp_limitを1..100に制限し、
-- private.shopping_mutationsに対するdeleteは全てowner+created_at境界の
-- where句を伴う。ここではRPCのソーステキストにその境界がない
-- "delete from private.shopping_mutations"単独文が無いことを確認する。）
select ok(
  (select prosrc from pg_proc
    where pronamespace = 'private'::regnamespace
      and proname = 'cleanup_expired_shopping_mutations') !~ 'delete from private\.shopping_mutations\s*;',
  'the bounded cleanup helper contains no unbounded delete statement'
);

-- -----------------------------------------------------------------------------
-- idempotency二重送信検証（mutate_shopping_item, 2-tabバージョン競合）:
-- 同一キーでの二重送信は保存済みレスポンスを返す（version不一致チェックより前）。
-- 別キー・別payloadでの再送はidempotency_payload_mismatchで拒否する。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_owner constant uuid := 'c6000000-0000-4000-8000-000000000001';
  v_member constant uuid := 'c6000000-0000-4000-8000-000000000002';
  v_menu constant uuid := 'c6000000-0000-4000-8000-000000000003';
  v_dish constant uuid := 'c6000000-0000-4000-8000-000000000004';
  v_ingredient constant uuid := 'c6000000-0000-4000-8000-000000000005';
  v_list_id uuid;
  v_fingerprint text;
  v_list_fingerprint text;
  v_draft jsonb;
  v_response jsonb;
  v_key constant uuid := 'c6000000-0000-4000-8000-000000000006';
  v_payload jsonb;
begin
  insert into auth.users (id,instance_id,aud,role,email) values
    (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'shopping-idem-owner@example.test');
  insert into public.household_members (
    id,user_id,status,display_name,age_band,portion_size,spice_level,
    allergy_status,unsupported_diet_status
  ) values (
    v_member,v_owner,'draft','子ども','age_6_8','regular','mild','registered','none'
  );
  insert into public.member_allergies (
    id,user_id,member_id,allergen_id,custom_name,custom_confirmed
  ) values (
    'c6000000-0000-4000-8000-000000000007',v_owner,v_member,'wheat',null,false
  );
  update public.household_members set status='complete' where id=v_member;
  insert into public.menus (
    id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
    preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,
    food_safety_rule_version,output_schema_version,derivation_group_id,version
  ) values (
    v_menu,v_owner,'dinner','japanese',2,30,'{}','{}',repeat('a',64),
    'allergens-v1','food-v1','menu-v1','c6000000-0000-4000-8000-000000000008',1
  );
  insert into public.menu_target_members (
    id,menu_id,user_id,household_member_id,household_member_user_id,
    anonymous_ref,member_display_name_snapshot
  ) values (
    'c6000000-0000-4000-8000-000000000009',v_menu,v_owner,v_member,v_owner,'member_1','子ども'
  );
  insert into public.dishes (
    id,menu_id,user_id,role,position,name,description,cooking_time_minutes
  ) values (
    v_dish,v_menu,v_owner,'main',1,'煮物','idempotency検証用の煮物です',20
  );
  insert into public.dish_ingredients (
    id,menu_id,dish_id,user_id,position,name,quantity_value,quantity_text,unit,store_section
  ) values (
    v_ingredient,v_menu,v_dish,v_owner,1,'にんじん',1,'1本','本','produce'
  );

  v_fingerprint := public.shopping_safety_fingerprint(v_owner, v_menu);
  v_draft := jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'key','carrot-idem','displayName','にんじん','normalizedName','にんじん',
      'storeSection','produce','quantityValue',1,'quantityText','1本','unit','本',
      'pantryCheckRequired',false,
      'sourceIngredients', jsonb_build_array(jsonb_build_object(
        'ingredientId',v_ingredient,'dishId',v_dish,'dishName','煮物','name','にんじん',
        'quantityValue',1,'quantityText','1本','unit','本','storeSection','produce'
      )),
      'labelWarnings','[]'::jsonb
    )),
    'listLabelWarnings','[]'::jsonb
  );
  v_response := public.apply_shopping_draft(
    v_owner, v_menu, 'new', null, null, v_fingerprint,
    'c6000000-0000-4000-8000-000000000010'::uuid,
    encode(extensions.digest(convert_to('creation-idem','UTF8'),'sha256'),'hex'),
    v_draft
  );
  v_list_id := (v_response->>'listId')::uuid;
  v_list_fingerprint := public.shopping_list_safety_fingerprint(v_owner, v_list_id);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  v_payload := jsonb_build_object('isChecked', true);
  v_response := public.mutate_shopping_item(
    v_list_id, 1, v_list_fingerprint, 'set_checked',
    (select id from public.shopping_items where list_id = v_list_id limit 1),
    v_key, v_payload
  );
  if (v_response->>'version')::integer <> 2 then
    raise exception 'idempotency: first mutation should advance the list version to 2, got %',
      v_response->>'version';
  end if;

  -- 同一キー・同一payloadでの再送: 保存済みレスポンス（version=2, replayed=true）を
  -- 返す。expectedListVersionを古い値(1)のまま渡しても、まずreplay一致が
  -- チェックされ、version不一致チェックより前にreplayとして返る。
  v_response := public.mutate_shopping_item(
    v_list_id, 1, v_list_fingerprint, 'set_checked',
    (select id from public.shopping_items where list_id = v_list_id limit 1),
    v_key, v_payload
  );
  if (v_response->>'replayed')::boolean is distinct from true
    or (v_response->>'version')::integer <> 2 then
    raise exception 'idempotency: same-key same-payload replay must return the saved version 2 response, got %',
      v_response;
  end if;

  -- 同一キー・別payloadでの再送: idempotency_payload_mismatchで拒否する
  -- （version不一致チェックより前）。
  begin
    perform public.mutate_shopping_item(
      v_list_id, 1, v_list_fingerprint, 'set_checked',
      (select id from public.shopping_items where list_id = v_list_id limit 1),
      v_key, jsonb_build_object('isChecked', false)
    );
    raise exception 'idempotency: same-key different-payload retry unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'idempotency_payload_mismatch' then
      raise;
    end if;
  end;

  reset role;
end;
$test$;
select pass('idempotency: same-key replay returns the saved response before stale-version checks, '
  || 'and same-key different-payload retry fails with idempotency_payload_mismatch');

-- -----------------------------------------------------------------------------
-- idempotency二重送信検証（apply_shopping_reconciliation）:
-- 差分整合を適用してversion 4を記録したあと、同じキー/ハッシュでの再送は
-- 「古い期待version 3」を渡したままでも保存済みレスポンスを返す（version不一致
-- チェックより前にreplayが返る）。同じキーで承認内容だけ変えた再送は
-- idempotency_payload_mismatchで拒否する（これもversionエラーより前）。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_owner constant uuid := 'c7000000-0000-4000-8000-000000000001';
  v_member constant uuid := 'c7000000-0000-4000-8000-000000000002';
  v_menu_a constant uuid := 'c7000000-0000-4000-8000-000000000003';
  v_dish_a constant uuid := 'c7000000-0000-4000-8000-000000000004';
  v_ingredient_a constant uuid := 'c7000000-0000-4000-8000-000000000005';
  v_menu_b constant uuid := 'c7000000-0000-4000-8000-000000000013';
  v_dish_b constant uuid := 'c7000000-0000-4000-8000-000000000014';
  v_ingredient_b constant uuid := 'c7000000-0000-4000-8000-000000000015';
  v_key constant uuid := 'c7000000-0000-4000-8000-000000000020';
  v_list_id uuid;
  v_fingerprint text;
  v_hash text;
  v_draft jsonb;
  v_diff jsonb;
  v_response jsonb;
begin
  insert into auth.users (id,instance_id,aud,role,email) values
    (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'shopping-reconcile-idem-owner@example.test');
  insert into public.household_members (
    id,user_id,status,display_name,age_band,portion_size,spice_level,
    allergy_status,unsupported_diet_status
  ) values (
    v_member,v_owner,'draft','子ども','age_6_8','regular','mild','registered','none'
  );
  insert into public.member_allergies (
    id,user_id,member_id,allergen_id,custom_name,custom_confirmed
  ) values (
    'c7000000-0000-4000-8000-000000000006',v_owner,v_member,'wheat',null,false
  );
  update public.household_members set status='complete' where id=v_member;

  insert into public.menus (
    id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
    preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,
    food_safety_rule_version,output_schema_version,derivation_group_id,version
  ) values
    (v_menu_a,v_owner,'dinner','japanese',2,30,'{}','{}',repeat('a',64),
      'allergens-v1','food-v1','menu-v1','c7000000-0000-4000-8000-000000000007',1),
    (v_menu_b,v_owner,'dinner','japanese',2,30,'{}','{}',repeat('b',64),
      'allergens-v1','food-v1','menu-v1','c7000000-0000-4000-8000-000000000017',1);
  insert into public.menu_target_members (
    id,menu_id,user_id,household_member_id,household_member_user_id,
    anonymous_ref,member_display_name_snapshot
  ) values
    ('c7000000-0000-4000-8000-000000000008',v_menu_a,v_owner,v_member,v_owner,'member_1','子ども'),
    ('c7000000-0000-4000-8000-000000000018',v_menu_b,v_owner,v_member,v_owner,'member_1','子ども');
  insert into public.dishes (
    id,menu_id,user_id,role,position,name,description,cooking_time_minutes
  ) values
    (v_dish_a,v_menu_a,v_owner,'main',1,'煮物','reconcile検証用の煮物です',20),
    (v_dish_b,v_menu_b,v_owner,'main',1,'炒め物','reconcile検証用の炒め物です',15);
  insert into public.dish_ingredients (
    id,menu_id,dish_id,user_id,position,name,quantity_value,quantity_text,unit,store_section
  ) values
    (v_ingredient_a,v_menu_a,v_dish_a,v_owner,1,'にんじん',1,'1本','本','produce'),
    (v_ingredient_b,v_menu_b,v_dish_b,v_owner,1,'たまねぎ',1,'1個','個','produce');

  -- 献立Aで買い物リストを作る（version 1）。
  v_fingerprint := public.shopping_safety_fingerprint(v_owner, v_menu_a);
  v_draft := jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'key','carrot-reconcile','displayName','にんじん','normalizedName','にんじん',
      'storeSection','produce','quantityValue',1,'quantityText','1本','unit','本',
      'pantryCheckRequired',false,
      'sourceIngredients', jsonb_build_array(jsonb_build_object(
        'ingredientId',v_ingredient_a,'dishId',v_dish_a,'dishName','煮物','name','にんじん',
        'quantityValue',1,'quantityText','1本','unit','本','storeSection','produce'
      )),
      'labelWarnings','[]'::jsonb
    )),
    'listLabelWarnings','[]'::jsonb
  );
  v_response := public.apply_shopping_draft(
    v_owner, v_menu_a, 'new', null, null, v_fingerprint,
    'c7000000-0000-4000-8000-000000000021'::uuid,
    encode(extensions.digest(convert_to('reconcile-idem-create','UTF8'),'sha256'),'hex'),
    v_draft
  );
  v_list_id := (v_response->>'listId')::uuid;

  -- 設計書の「version 4 を記録する」条件を満たすため、整合適用の直前にリストを
  -- version 3 まで進めておく（apply_shopping_reconciliation は +1 する）。
  update public.shopping_lists set version = 3 where id = v_list_id and user_id = v_owner;

  v_fingerprint := public.shopping_safety_fingerprint(v_owner, v_menu_b);
  v_hash := encode(extensions.digest(convert_to('reconcile-idem-approval','UTF8'),'sha256'),'hex');
  v_diff := jsonb_build_object(
    'add', jsonb_build_array(jsonb_build_object(
      'key','onion-reconcile','displayName','たまねぎ','normalizedName','たまねぎ',
      'storeSection','produce','quantityValue',1,'quantityText','1個','unit','個',
      'pantryCheckRequired',false,
      'sourceIngredients', jsonb_build_array(jsonb_build_object(
        'ingredientId',v_ingredient_b,'dishId',v_dish_b,'dishName','炒め物','name','たまねぎ',
        'quantityValue',1,'quantityText','1個','unit','個','storeSection','produce'
      )),
      'labelWarnings','[]'::jsonb
    )),
    'replace','[]'::jsonb,
    'removeIds','[]'::jsonb,
    'listLabelWarnings','[]'::jsonb
  );

  v_response := public.apply_shopping_reconciliation(
    v_owner, v_list_id, 3, v_menu_b, 1, v_fingerprint, v_key, v_hash, v_diff
  );
  if (v_response->>'version')::integer <> 4 then
    raise exception 'reconcile idempotency: the first reconciliation should record version 4, got %',
      v_response->>'version';
  end if;
  if (v_response->>'replayed')::boolean is distinct from false then
    raise exception 'reconcile idempotency: the first reconciliation must not be marked replayed';
  end if;

  -- 同じキー/ハッシュでのreplay照会は保存済みレスポンス（version 4）を返す。
  -- get_shopping_mutation_replay はversionを引数に取らないため、呼び出し側が
  -- 古い期待version 3 を持ったままでも保存済みレスポンスが優先される。
  v_response := public.get_shopping_mutation_replay(v_owner, v_key, v_hash);
  if v_response is null then
    raise exception 'reconcile idempotency: the saved reconciliation must replay';
  end if;
  if (v_response->>'version')::integer <> 4
    or (v_response->>'replayed')::boolean is distinct from true
    or (v_response->>'listId')::uuid <> v_list_id then
    raise exception 'reconcile idempotency: replay must return the saved version 4 response, got %',
      v_response;
  end if;

  -- RPC自体の再送も同じ。古い期待version 3 を渡したままでも、
  -- list_version_conflict より前にreplayが返る（現在のリストは version 4）。
  v_response := public.apply_shopping_reconciliation(
    v_owner, v_list_id, 3, v_menu_b, 1, v_fingerprint, v_key, v_hash, v_diff
  );
  if (v_response->>'version')::integer <> 4
    or (v_response->>'replayed')::boolean is distinct from true then
    raise exception 'reconcile idempotency: a stale-version retry with the same key/hash must '
      'return the saved response, got %', v_response;
  end if;

  -- 同じキーで承認内容（=request hash）だけ変えた再送は、versionエラーではなく
  -- idempotency_payload_mismatch で拒否する。
  begin
    perform public.apply_shopping_reconciliation(
      v_owner, v_list_id, 3, v_menu_b, 1, v_fingerprint, v_key,
      encode(extensions.digest(convert_to('reconcile-idem-approval-changed','UTF8'),'sha256'),'hex'),
      jsonb_set(v_diff,'{removeIds}',jsonb_build_array(to_jsonb(gen_random_uuid())))
    );
    raise exception 'reconcile idempotency: same-key changed-approval retry unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'idempotency_payload_mismatch' then
      raise;
    end if;
  end;

  -- 拒否された再送はリストを進めていない。
  if (select version from public.shopping_lists where id = v_list_id) <> 4 then
    raise exception 'reconcile idempotency: a rejected retry must not advance the list version';
  end if;
end;
$test$;
select pass('reconcile idempotency: apply_shopping_reconciliation records version 4, the same '
  || 'key/hash replays the saved response even with the old expected version 3, and a changed '
  || 'approval under the same key raises idempotency_payload_mismatch before any version error');

select * from finish();
rollback;
