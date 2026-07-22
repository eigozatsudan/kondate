\ir 000_helpers.sql
begin;
select plan(9);

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

-- =============================================================================
-- Plan 7 Task 2 Step 2: set_onboarding_status の入力境界。
-- =============================================================================
select throws_ok(
  $sql$
    select public.set_onboarding_status('bogus')
  $sql$,
  '22023',
  'invalid_onboarding_status',
  '許可されていない文字列はinvalid_onboarding_statusで拒否される'
);
select throws_ok(
  $sql$
    select public.set_onboarding_status('not_started')
  $sql$,
  '22023',
  'invalid_onboarding_status',
  'not_startedは入力として受け付けない'
);
select throws_ok(
  $sql$
    select public.set_onboarding_status('complete')
  $sql$,
  '22023',
  'invalid_onboarding_transition',
  'not_startedからcompleteへの直接遷移は許可された遷移表にない'
);

reset role;
select tests.clear_authentication();
set local role anon;
select throws_ok(
  $sql$select public.set_onboarding_status('in_progress')$sql$,
  '42501',
  null,
  '未認証ユーザーはset_onboarding_statusを呼べない(anonにはEXECUTE権限がない)'
);

-- authenticatedロールでもJWTクレームが無ければauth.uid()がnullになり、
-- RPC内部の認証チェックがauthentication_requiredで拒否する。
reset role;
select tests.clear_authentication();
set local role authenticated;
select throws_ok(
  $sql$select public.set_onboarding_status('in_progress')$sql$,
  '42501',
  'authentication_required',
  'authenticatedロールでも認証クレームがなければauthentication_requiredで拒否される'
);

select * from finish();
rollback;
