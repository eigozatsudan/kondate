\ir 000_helpers.sql
begin;
select plan(12);

select tests.create_supabase_user(
  '44444444-4444-4444-4444-444444444444',
  'onboarding-start@example.invalid'
);
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
set local role authenticated;

select is(
  (select status from public.start_household_onboarding(4)),
  'draft',
  'start creates a draft member'
);
select is(
  (select onboarding_status from public.profiles),
  'in_progress',
  'start advances the profile in the same boundary'
);
select is(
  (select count(*)::integer from public.household_members),
  1,
  'start creates exactly one member'
);
select is(
  (select id from public.start_household_onboarding(9)),
  (select id from public.household_members order by created_at, id limit 1),
  'retry reads back the existing draft'
);
select is(
  (select count(*)::integer from public.household_members),
  1,
  'retry does not create a duplicate draft'
);

insert into public.household_members(user_id, status, sort_order)
values ('44444444-4444-4444-4444-444444444444', 'draft', 5);
select is(
  (select count(*)::integer from public.household_members),
  2,
  'settings can still add another unfinished family member'
);

reset role;
update public.profiles
set onboarding_status = 'complete', onboarding_completed_at = statement_timestamp()
where user_id = '44444444-4444-4444-4444-444444444444';
select tests.authenticate_as('44444444-4444-4444-4444-444444444444');
set local role authenticated;
select is(
  (select status from public.start_household_onboarding(6)),
  'draft',
  'completed users can read back their unfinished member without regressing progress'
);
select is(
  (select onboarding_status from public.profiles),
  'complete',
  'start never regresses completed onboarding'
);

reset role;
select tests.clear_authentication();
set local role anon;
select throws_ok(
  $sql$select public.start_household_onboarding(0)$sql$,
  '42501',
  null,
  'anonymous users cannot start household onboarding'
);

reset role;
select tests.create_supabase_user(
  '55555555-5555-5555-5555-555555555555',
  'onboarding-rollback@example.invalid'
);
create function tests.reject_profile_progress()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'forced_profile_update_failure';
end;
$function$;
create trigger reject_profile_progress
before update on public.profiles
for each row
when (old.user_id = '55555555-5555-5555-5555-555555555555')
execute function tests.reject_profile_progress();

select tests.authenticate_as('55555555-5555-5555-5555-555555555555');
set local role authenticated;
select throws_ok(
  $sql$select public.start_household_onboarding(0)$sql$,
  'P0001',
  'forced_profile_update_failure',
  'profile update failure aborts onboarding start'
);
select is(
  (select count(*)::integer from public.household_members),
  0,
  'profile update failure rolls back the inserted draft'
);
select is(
  (select onboarding_status from public.profiles),
  'not_started',
  'profile update failure preserves the original progress'
);

select * from finish();
rollback;
