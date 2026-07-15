\ir 000_helpers.sql
begin;
select plan(4);

select tests.create_supabase_user(
  '33333333-3333-3333-3333-333333333333',
  'draft-boundary@example.invalid'
);
select tests.authenticate_as('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select lives_ok(
  $sql$
    insert into public.household_members (
      id,
      user_id,
      age_band,
      allergy_status,
      unsupported_diet_status,
      unsupported_diet_kinds
    ) values (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      '33333333-3333-3333-3333-333333333333',
      'adult',
      'none',
      'present',
      '{}'
    )
  $sql$,
  'draft can persist present before an unsupported diet kind is selected'
);
select throws_ok(
  $sql$
    select public.complete_household_member('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
  $sql$,
  '23514',
  'member_required_fields_incomplete',
  'completion rejects present without an unsupported diet kind'
);
select lives_ok(
  $sql$
    update public.household_members
    set unsupported_diet_kinds = array['weaning_food']::text[]
    where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  $sql$,
  'draft accepts the selected unsupported diet kind'
);
select lives_ok(
  $sql$
    select public.complete_household_member('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
  $sql$,
  'completion succeeds after an unsupported diet kind is selected'
);

select * from finish();
rollback;
