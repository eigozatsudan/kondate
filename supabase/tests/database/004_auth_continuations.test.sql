\ir 000_helpers.sql
begin;
-- 他のローカル実行やE2Eが残した有効なレコードに依存しないよう、テスト対象を初期化する。
delete from private.auth_continuations;
select plan(21);
select has_table('private', 'auth_continuations', 'continuation ledger exists');
select function_returns('public', 'claim_auth_continuation', array['uuid', 'bytea', 'bytea', 'text', 'timestamp with time zone'], 'setof record', 'claim has exact five-argument signature');
select function_returns('public', 'cleanup_auth_continuations', array['timestamp with time zone'], 'bigint', 'cleanup keeps the one-argument signature');
select ok(not has_table_privilege('anon', 'private.auth_continuations', 'select'), 'anonymous users cannot read the ledger');
create temporary table continuation_case as
select * from public.create_auth_continuation(
    decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'),
    'https://app.test', '/planner', '2026-07-11T00:00:00Z', 300
  );
select is((select count(*)::integer from continuation_case), 1, 'five-minute continuation is accepted');
select throws_ok($$
  select * from public.create_auth_continuation(
    decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'),
    'https://app.test', '/planner', '2026-07-11T00:00:00Z', 299
  )
$$, '22023', 'invalid continuation ttl', 'other TTL values are rejected');
select ok(exists(select 1 from private.auth_continuations where expires_at = '2026-07-11T00:05:00Z'), 'expiry is exactly five minutes');
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('ff', 32), 'hex'), 'https://app.test', decode('aa', 'hex'), decode(repeat('02', 12), 'hex'), '2026-07-11T00:01:00Z'
  ),
  false,
  'deposit rejects an incorrect state'
);
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), 'https://other.test', decode('aa', 'hex'), decode(repeat('02', 12), 'hex'), '2026-07-11T00:01:00Z'
  ),
  false,
  'deposit rejects an incorrect origin'
);
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), 'https://app.test', decode('aa', 'hex'), decode(repeat('02', 12), 'hex'), '2026-07-11T00:01:00Z'
  ),
  true,
  'first deposit succeeds'
);
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), 'https://app.test', decode('bb', 'hex'), decode(repeat('03', 12), 'hex'), '2026-07-11T00:02:00Z'
  ),
  true,
  'later matching deposit is accepted without replacing the first value'
);
select is(
  (select encode(encrypted_code, 'hex') from private.auth_continuations where id = (select id from continuation_case)),
  'aa',
  'first deposit ciphertext wins'
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('ff', 32), 'hex'), decode(repeat('01', 32), 'hex'), 'https://app.test', '2026-07-11T00:03:00Z'
  )),
  0,
  'claim rejects an incorrect state'
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), decode(repeat('ff', 32), 'hex'), 'https://app.test', '2026-07-11T00:03:00Z'
  )),
  0,
  'claim rejects incorrect credentials'
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'), 'https://other.test', '2026-07-11T00:03:00Z'
  )),
  0,
  'claim rejects an incorrect origin'
);
select ok(
  exists(
    select 1 from public.claim_auth_continuation(
      (select id from continuation_case), decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'), 'https://app.test', '2026-07-11T00:03:00Z'
    ) where encrypted_code = decode('aa', 'hex') and code_iv = decode(repeat('02', 12), 'hex') and return_to = '/planner'
  ),
  'claim returns the first ciphertext and IV once'
);
select ok(
  exists(
    select 1 from private.auth_continuations
    where id = (select id from continuation_case)
      and claimed_at = '2026-07-11T00:03:00Z'
      and encrypted_code is null
      and code_iv is null
  ),
  'claim clears stored ciphertext and IV'
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'), 'https://app.test', '2026-07-11T00:04:00Z'
  )),
  0,
  'claimed continuation cannot be replayed'
);
select ok(to_regclass('private.auth_continuations_expires_at_idx') is not null, 'expiry cleanup has a supporting index');
insert into private.auth_continuations(state_hash, secret_hash, origin, return_to, expires_at)
select
  decode(repeat('03', 32), 'hex'), decode(repeat('04', 32), 'hex'),
  'https://app.test', '/planner', '2026-07-10T00:00:00Z'
from generate_series(1, 101);
select is(public.cleanup_auth_continuations('2026-07-11T00:00:00Z'), 100::bigint, 'cleanup deletes at most one bounded batch');
select is(
  (select count(*)::integer from private.auth_continuations where expires_at = '2026-07-10T00:00:00Z'),
  1,
  'bounded cleanup leaves subsequent expired rows for a later call'
);
select * from finish();
rollback;
