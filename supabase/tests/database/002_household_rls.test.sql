\ir 000_helpers.sql
begin;
select plan(40);

select tests.create_supabase_user('11111111-1111-1111-1111-111111111111', 'one@example.invalid');
select tests.create_supabase_user('22222222-2222-2222-2222-222222222222', 'two@example.invalid');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select lives_ok(
  $sql$
    insert into public.household_members (
      id, user_id, age_band, allergy_status, unsupported_diet_status
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111',
      'adult', 'none', 'none'
    )
  $sql$,
  'owner can insert a draft member'
);
select is(
  (select count(*)::integer from public.household_members),
  1,
  'owner sees their member'
);
select throws_ok(
  $sql$
    insert into public.household_members (user_id)
    values ('22222222-2222-2222-2222-222222222222')
  $sql$,
  '42501',
  null,
  'owner cannot insert for another user'
);
select lives_ok(
  $sql$select public.complete_household_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$sql$,
  'required fields permit completion'
);
select is(
  (
    select status
    from public.household_members
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'complete',
  'completion RPC writes complete status'
);
select throws_ok(
  $sql$
    update public.household_members
    set allergy_status = 'registered'
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$,
  '23514',
  'member_registered_allergy_required',
  'complete registered member requires an allergy at the table boundary'
);

-- allergies_insert_own は allergen_id is not null を要求するため、カスタムアレルギーの
-- 直接 INSERT はもはや許可されない（20260715000200 以降）。以下はすべて RPC 経由で登録する。
select lives_ok(
  $sql$
    select public.add_custom_member_allergy(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'えんどう豆たんぱく', array[]::text[]
    )
  $sql$,
  'the custom allergy RPC stores a first allergy for the member'
);
select lives_ok(
  $sql$
    update public.household_members
    set allergy_status = 'registered'
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$,
  'member can become registered after an allergy is stored'
);
select throws_ok(
  $sql$
    select public.delete_member_allergy(
      (select id from public.member_allergies
       where member_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and custom_name = 'えんどう豆たんぱく')
    )
  $sql$,
  '23514',
  'member_registered_allergy_required',
  'deletion RPC cannot delete the last allergy of a complete registered member'
);
select lives_ok(
  $sql$
    select public.add_custom_member_allergy(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '  Ｐｅａたんぱく  ',
      array['  ｐｅａ protein  ', '  pea isolate  ']
    )
  $sql$,
  'the custom allergy RPC stores a second allergy for the member'
);
select is(
  (select custom_name from public.member_allergies
   where member_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and custom_name = 'Peaたんぱく'),
  'Peaたんぱく',
  'custom allergy name is stored as the NFKC-trimmed canonical value'
);
select is(
  (select custom_aliases from public.member_allergies
   where member_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and custom_name = 'Peaたんぱく'),
  array['pea protein', 'pea isolate'],
  'custom allergy aliases are stored as NFKC-trimmed canonical values'
);
select lives_ok(
  $sql$
    select public.delete_member_allergy(
      (select id from public.member_allergies
       where member_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and custom_name = 'Peaたんぱく')
    )
  $sql$,
  'deletion RPC removes an allergy when another allergy remains'
);
select is(
  (select count(*)::integer from public.member_allergies where member_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'deletion RPC removes only the requested allergy'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array['  ']
    )
  $sql$,
  '23514',
  'invalid_custom_allergy',
  'custom aliases cannot contain blanks'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array['same', ' same ']
    )
  $sql$,
  '23514',
  'invalid_custom_allergy',
  'custom aliases must be unique after canonical trimming'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array_fill('alias'::text, array[11])
    )
  $sql$,
  '23514',
  'invalid_custom_allergy',
  'custom aliases are limited to ten entries'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array[repeat('a', 81)]
    )
  $sql$,
  '23514',
  'invalid_custom_allergy',
  'each custom alias is limited to eighty characters'
);
select lives_ok(
  $sql$
    update public.household_members
    set allergy_status = 'none'
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  $sql$,
  'member can leave registered status before removing the final allergy'
);
select lives_ok(
  $sql$
    select public.delete_member_allergy(
      (select id from public.member_allergies
       where member_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and custom_name = 'えんどう豆たんぱく')
    )
  $sql$,
  'deletion RPC removes the final allergy after registered status is cleared'
);
select is(
  (select count(*)::integer from public.member_allergies where member_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'clearing registered status permits an empty allergy set'
);
insert into public.member_dislikes(id, user_id, member_id, ingredient_name) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ねぎ'
);

reset role;
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select is(
  (select count(*)::integer from public.household_members),
  0,
  'second user cannot read first user member'
);
with changed as (
  update public.household_members set display_name = 'x' returning 1
)
select is((select count(*)::integer from changed), 0, 'second user cannot update first user member');
with removed as (
  delete from public.household_members returning 1
)
select is((select count(*)::integer from removed), 0, 'second user cannot delete first user member');
select throws_ok(
  $sql$update public.member_allergies set custom_name = 'other'$sql$,
  '42501',
  null,
  'browser cannot update allergies directly'
);
select throws_ok(
  $sql$delete from public.member_allergies$sql$,
  '42501',
  null,
  'browser cannot delete allergies directly'
);
with changed as (
  update public.member_dislikes set ingredient_name = 'other' returning 1
)
select is((select count(*)::integer from changed), 0, 'second user cannot update first user dislike');
with removed as (
  delete from public.member_dislikes returning 1
)
select is((select count(*)::integer from removed), 0, 'second user cannot delete first user dislike');
select is(
  (select count(*)::integer from public.profiles),
  1,
  'auth trigger created only the current visible profile'
);
select ok(
  has_table_privilege('authenticated', 'public.privacy_consents', 'select'),
  'authenticated has explicit privacy select grant'
);
select ok(
  not has_table_privilege('anon', 'public.household_members', 'select'),
  'anon has no household select grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'delete'),
  'browser cannot delete profiles'
);
select ok(
  not has_table_privilege('authenticated', 'public.member_allergies', 'delete'),
  'browser cannot bypass serialized allergy deletion'
);
select ok(
  not has_table_privilege('authenticated', 'public.member_allergies', 'update'),
  'browser cannot move an allergy around the serialized boundary'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_member_allergy(uuid)', 'execute'),
  'authenticated users can execute the serialized allergy deletion RPC'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'member_allergies' and policyname = 'allergies_update_own'
  ),
  'the dead owner-scoped update policy was removed, not just made unreachable by revoke'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'member_allergies' and policyname = 'allergies_delete_own'
  ),
  'the dead owner-scoped delete policy was removed, not just made unreachable by revoke'
);
select ok(
  not has_function_privilege('anon', 'public.delete_member_allergy(uuid)', 'execute'),
  'anonymous users cannot execute the allergy deletion RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.set_onboarding_status(text)', 'execute'),
  'authenticated users can execute set_onboarding_status'
);
select ok(
  not has_function_privilege('anon', 'public.set_onboarding_status(text)', 'execute'),
  'anonymous users cannot execute set_onboarding_status'
);

select * from finish();
rollback;
