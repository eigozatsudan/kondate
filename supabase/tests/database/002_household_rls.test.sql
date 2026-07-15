\ir 000_helpers.sql
begin;
select plan(34);

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

insert into public.member_allergies(
  id, user_id, member_id, custom_name, custom_confirmed
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'えんどう豆たんぱく', true
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
    select public.delete_member_allergy('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  $sql$,
  '23514',
  'member_registered_allergy_required',
  'deletion RPC cannot delete the last allergy of a complete registered member'
);
insert into public.member_allergies(
  id, user_id, member_id, custom_name, custom_aliases, custom_confirmed
) values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '  Ｐｅａたんぱく  ', array['  ｐｅａ protein  ', '  pea isolate  '], true
);
select is(
  (select custom_name from public.member_allergies where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'Peaたんぱく',
  'custom allergy name is stored as the NFKC-trimmed canonical value'
);
select is(
  (select custom_aliases from public.member_allergies where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  array['pea protein', 'pea isolate'],
  'custom allergy aliases are stored as NFKC-trimmed canonical values'
);
select lives_ok(
  $sql$
    select public.delete_member_allergy('dddddddd-dddd-dddd-dddd-dddddddddddd')
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
    insert into public.member_allergies(user_id, member_id, custom_name, custom_aliases, custom_confirmed)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array['  '], true)
  $sql$,
  '23514',
  'invalid_custom_allergy_aliases',
  'custom aliases cannot contain blanks'
);
select throws_ok(
  $sql$
    insert into public.member_allergies(user_id, member_id, custom_name, custom_aliases, custom_confirmed)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array['same', ' same '], true)
  $sql$,
  '23514',
  'invalid_custom_allergy_aliases',
  'custom aliases must be unique after canonical trimming'
);
select throws_ok(
  $sql$
    insert into public.member_allergies(user_id, member_id, custom_name, custom_aliases, custom_confirmed)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array_fill('alias'::text, array[11]), true)
  $sql$,
  '23514',
  'invalid_custom_allergy_aliases',
  'custom aliases are limited to ten entries'
);
select throws_ok(
  $sql$
    insert into public.member_allergies(user_id, member_id, custom_name, custom_aliases, custom_confirmed)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom', array[repeat('a', 81)], true)
  $sql$,
  '23514',
  'invalid_custom_allergy_aliases',
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
    select public.delete_member_allergy('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
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
  not has_function_privilege('anon', 'public.delete_member_allergy(uuid)', 'execute'),
  'anonymous users cannot execute the allergy deletion RPC'
);

select * from finish();
rollback;
