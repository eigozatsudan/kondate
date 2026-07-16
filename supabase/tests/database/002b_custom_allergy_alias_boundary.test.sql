\ir 000_helpers.sql
begin;
select plan(9);

select tests.create_supabase_user(
  '44444444-4444-4444-4444-444444444444',
  'custom-allergy@example.invalid'
);
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
set local role authenticated;

insert into public.household_members (id, user_id)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '44444444-4444-4444-4444-444444444444'
);

select has_function(
  'public',
  'add_custom_member_allergy',
  array['uuid', 'text', 'text[]'],
  'custom allergy insert RPC exists'
);
select function_privs_are(
  'public',
  'add_custom_member_allergy',
  array['uuid', 'text', 'text[]'],
  'authenticated',
  array['EXECUTE'],
  'authenticated can execute only the custom allergy boundary'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'たまご',
      array[]::text[]
    )
  $sql$,
  '23514',
  'custom_allergy_matches_standard',
  'a direct alias cannot be stored as a custom allergy'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      '独自項目',
      array['牛乳']::text[]
    )
  $sql$,
  '23514',
  'custom_allergy_matches_standard',
  'a derived alias cannot be hidden in custom aliases'
);
select lives_ok(
  $sql$
    select public.add_custom_member_allergy(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'えんどう豆たんぱく',
      array['ピープロテイン']::text[]
    )
  $sql$,
  'an unmatched term can be stored through the RPC'
);
select is(
  (
    select custom_name
    from public.member_allergies
    where member_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ),
  'えんどう豆たんぱく',
  'the RPC returns and stores the confirmed custom term'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'えんどう豆たんぱく',
      array[]::text[]
    )
  $sql$,
  '23514',
  'custom_allergy_already_registered',
  'the same custom allergy name cannot be registered twice for one member'
);
select throws_ok(
  $sql$
    select public.add_custom_member_allergy(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      '別名義の豆たんぱく',
      array['ピープロテイン']::text[]
    )
  $sql$,
  '23514',
  'custom_allergy_already_registered',
  'a new custom allergy cannot reuse an alias already stored for the member'
);
select throws_ok(
  $sql$
    insert into public.member_allergies (
      user_id,
      member_id,
      custom_name,
      custom_confirmed
    ) values (
      '44444444-4444-4444-4444-444444444444',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'たまご',
      true
    )
  $sql$,
  '42501',
  'new row violates row-level security policy for table "member_allergies"',
  'direct custom inserts cannot bypass alias validation'
);

select * from finish();
rollback;
