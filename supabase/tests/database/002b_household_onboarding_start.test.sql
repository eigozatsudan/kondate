\ir 000_helpers.sql
begin;
select plan(36);

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

-- H11: authenticated raw INSERT は拒否。第二 draft は RPC でも作らず既存 draft を再利用する。
select throws_ok(
  $sql$
    insert into public.household_members(user_id, status, sort_order)
    values ('44444444-4444-4444-4444-444444444444', 'draft', 5)
  $sql$,
  '42501',
  null,
  'authenticated cannot raw-insert a second unfinished member (H11)'
);
select is(
  (select count(*)::integer from public.household_members),
  1,
  'second start path keeps a single draft (H11 multi-draft closed)'
);
select is(
  (select id from public.start_household_onboarding(5)),
  (select id from public.household_members order by created_at, id limit 1),
  'start_household_onboarding reuses the existing draft instead of creating another'
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

-- =============================================================================
-- Plan 7 Task 2 Step 2: set_onboarding_status の状態遷移。家族設定なしでも
-- skipped へ遷移でき、skipped からは in_progress/complete のどちらにも戻れる。
-- complete は家族の完全性だけを検査し、privacy consent の有無を見ない。
-- =============================================================================
reset role;
select tests.create_supabase_user(
  '88888888-8888-8888-8888-888888888888',
  'onboarding-skip@example.invalid'
);
select tests.authenticate_as('88888888-8888-8888-8888-888888888888');
set local role authenticated;

select lives_ok(
  $$ select public.set_onboarding_status('skipped') $$,
  '家族未登録でもskippedへ遷移できる'
);
select is(
  (select onboarding_status from public.profiles where user_id = auth.uid()),
  'skipped',
  'skippedが保存される'
);
select ok(
  (select onboarding_completed_at is not null from public.profiles where user_id = auth.uid()),
  'skippedは完了時刻を持つ'
);
select lives_ok(
  $$ select public.set_onboarding_status('in_progress') $$,
  'skippedからin_progressへ戻れる'
);
select ok(
  (select onboarding_completed_at is null from public.profiles where user_id = auth.uid()),
  'in_progressへ戻ると完了時刻を消す'
);

create temporary table onboarding_idempotent_check as
  select updated_at from public.profiles where user_id = '88888888-8888-8888-8888-888888888888';
select lives_ok(
  $$ select public.set_onboarding_status('in_progress') $$,
  '同じ状態への再送は成功する（冪等）'
);
select is(
  (select updated_at from public.profiles where user_id = '88888888-8888-8888-8888-888888888888'),
  (select updated_at from onboarding_idempotent_check),
  '同じ状態への再送はupdated_atを変更しない'
);
drop table onboarding_idempotent_check;

-- H11: complete メンバー fixture は postgres で seed（authenticated raw INSERT 不可）。
reset role;
insert into public.household_members (
  id, user_id, status, age_band, allergy_status, unsupported_diet_status
) values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '88888888-8888-8888-8888-888888888888',
  'complete', 'adult', 'none', 'none'
);
select tests.authenticate_as('88888888-8888-8888-8888-888888888888');
set local role authenticated;
select lives_ok(
  $$ select public.set_onboarding_status('complete') $$,
  '家族1人が完全ならprivacy同意なしでcompleteへ遷移できる'
);
select is(
  (select onboarding_status from public.profiles where user_id = auth.uid()),
  'complete',
  'completeが保存される'
);
select ok(
  (select onboarding_completed_at is not null from public.profiles where user_id = auth.uid()),
  'completeは完了時刻を持つ'
);
select ok(
  not exists (
    select 1 from public.privacy_consents where user_id = '88888888-8888-8888-8888-888888888888'
  ),
  'privacy_consents行を一切作らずにcompleteへ遷移できる'
);
select lives_ok(
  $$
    delete from public.household_members
    where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  $$,
  '完了済みの最後の家族メンバーを削除できる'
);
select is(
  (select onboarding_status from public.profiles where user_id = '88888888-8888-8888-8888-888888888888'),
  'complete',
  '最後の家族メンバー削除後もonboarding_statusはcompleteのまま変化しない'
);

reset role;
select tests.create_supabase_user(
  '99999999-9999-9999-9999-999999999999',
  'onboarding-incomplete@example.invalid'
);
select tests.authenticate_as('99999999-9999-9999-9999-999999999999');
set local role authenticated;
select lives_ok(
  $$ select public.set_onboarding_status('in_progress') $$,
  '家族なしユーザーもin_progressへは遷移できる'
);
select throws_ok(
  $$ select public.set_onboarding_status('complete') $$,
  '23514',
  'onboarding_members_incomplete',
  '家族が1人もいない場合はcompleteへ遷移できない'
);
select is(
  (select onboarding_status from public.profiles where user_id = '99999999-9999-9999-9999-999999999999'),
  'in_progress',
  '失敗したcomplete試行はonboarding_statusを変更しない'
);


-- =============================================================================
-- Landing R1: set_onboarding_status CAS (p_expected_status)
-- not_started 以外へ expected を付けた更新は上書きせず現状を返す
-- =============================================================================
reset role;
select tests.create_supabase_user(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'onboarding-cas@example.invalid'
);
select tests.authenticate_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
set local role authenticated;

select lives_ok(
  $$ select public.set_onboarding_status('skipped', 'not_started') $$,
  'CAS: not_started から skipped へ expected 付きで遷移できる'
);
select is(
  (select onboarding_status from public.profiles where user_id = auth.uid()),
  'skipped',
  'CAS: skipped が保存される'
);

-- 別タブ相当: expected=not_started のまま in_progress を要求しても上書きしない
select is(
  (select onboarding_status from public.set_onboarding_status('in_progress', 'not_started')),
  'skipped',
  'CAS miss: expected 不一致なら in_progress で上書きせず skipped を返す'
);
select is(
  (select onboarding_status from public.profiles where user_id = auth.uid()),
  'skipped',
  'CAS miss: DB も skipped のまま'
);

-- expected 省略時は従来どおり skipped → in_progress を許可
select lives_ok(
  $$ select public.set_onboarding_status('in_progress') $$,
  'expected 省略時は従来遷移（skipped → in_progress）を許可'
);
select is(
  (select onboarding_status from public.profiles where user_id = auth.uid()),
  'in_progress',
  'expected 省略で in_progress に遷移する'
);

select * from finish();
rollback;
