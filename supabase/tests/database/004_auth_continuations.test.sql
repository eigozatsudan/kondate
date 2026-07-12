\ir 000_helpers.sql
begin;
select plan(8);
select has_table('private', 'auth_continuations', 'continuation ledger exists');
select function_returns('public', 'claim_auth_continuation', array['uuid', 'bytea', 'bytea', 'text', 'timestamp with time zone'], 'table', 'claim has exact five-argument signature');
select ok(not has_table_privilege('anon', 'private.auth_continuations', 'select'), 'anonymous users cannot read the ledger');
select lives_ok($$
  select * from public.create_auth_continuation(
    decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'),
    'https://app.test', '/planner', '2026-07-11T00:00:00Z', 300
  )
$$, 'five-minute continuation is accepted');
select throws_ok($$
  select * from public.create_auth_continuation(
    decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'),
    'https://app.test', '/planner', '2026-07-11T00:00:00Z', 299
  )
$$, '22023', 'invalid continuation ttl', 'other TTL values are rejected');
select ok(exists(select 1 from private.auth_continuations where expires_at = '2026-07-11T00:05:00Z'), 'expiry is exactly five minutes');
select is(public.cleanup_auth_continuations('2026-07-11T00:05:00Z'), 1::bigint, 'expiry cleanup deletes the record');
select is((select count(*)::integer from private.auth_continuations), 0, 'cleanup removes expired ciphertext records');
select * from finish();
rollback;
