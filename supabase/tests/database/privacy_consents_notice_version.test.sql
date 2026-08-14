-- AP4: privacy_consents の INSERT は現行 notice_version のみ。
\ir 000_helpers.sql
begin;
select plan(4);

select tests.create_supabase_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'privacy-ap4@example.invalid');
select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set local role authenticated;

select lives_ok(
  $sql$
    insert into public.privacy_consents (user_id, notice_version)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-07-29.v1')
  $sql$,
  'authenticated can insert the current privacy notice version'
);

select throws_ok(
  $sql$
    insert into public.privacy_consents (user_id, notice_version)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-01.v1')
  $sql$,
  '42501',
  null,
  'authenticated cannot pre-insert a future privacy notice version'
);

select throws_ok(
  $sql$
    insert into public.privacy_consents (user_id, notice_version)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-07-11.v1')
  $sql$,
  '42501',
  null,
  'authenticated cannot insert an older privacy notice version'
);

select is(
  (select count(*)::integer from public.privacy_consents where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'only the current notice version row remains'
);

select * from finish();
rollback;
