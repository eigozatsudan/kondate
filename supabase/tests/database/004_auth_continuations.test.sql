\ir 000_helpers.sql
begin;
-- 他のローカル実行やE2Eが残した有効なレコードに依存しないよう、テスト対象を初期化する。
delete from private.auth_continuations;
select plan(39);
select has_table('private', 'auth_continuations', 'continuation ledger exists');
select function_returns('public', 'claim_auth_continuation', array['uuid', 'bytea', 'bytea', 'text', 'timestamp with time zone'], 'setof record', 'claim has exact five-argument signature');
select function_returns('public', 'cleanup_auth_continuations', array['timestamp with time zone'], 'bigint', 'cleanup keeps the one-argument signature');
select ok(not has_table_privilege('anon', 'private.auth_continuations', 'select'), 'anonymous users cannot read the ledger');
select is(
  (
    select count(*)::integer
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'auth_continuations'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%return_to%'
  ),
  1,
  'return path has exactly one check constraint'
);
select lives_ok($$
  select * from public.create_auth_continuation(
    decode(repeat('30', 32), 'hex'), decode(repeat('31', 32), 'hex'),
    'https://app.test', '/', '2026-07-11T00:00:00Z', 300
  )
$$, 'root return path is accepted');
select throws_ok($$
  select * from public.create_auth_continuation(
    decode(repeat('32', 32), 'hex'), decode(repeat('33', 32), 'hex'),
    'https://app.test', '//host', '2026-07-11T00:00:00Z', 300
  )
$$, '23514', null, 'protocol-relative return path is rejected');
select lives_ok($$
  select * from public.create_auth_continuation(
    decode(repeat('34', 32), 'hex'), decode(repeat('35', 32), 'hex'),
    'https://app.test', '/' || repeat('a', 499), '2026-07-11T00:00:00Z', 300
  )
$$, '500-character return path is accepted');
select throws_ok($$
  select * from public.create_auth_continuation(
    decode(repeat('36', 32), 'hex'), decode(repeat('37', 32), 'hex'),
    'https://app.test', '/' || repeat('a', 500), '2026-07-11T00:00:00Z', 300
  )
$$, '23514', null, '501-character return path is rejected');
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
  'later matching anonymous deposit is accepted and replaces the first value'
);
select is(
  (select encode(encrypted_code, 'hex') from private.auth_continuations where id = (select id from continuation_case)),
  'bb',
  'anonymous deposit last-wins while unclaimed (C2 residual poison first-wins closed)'
);
-- C2: 所有者 secret 付き deposit も未 claim なら上書きできる
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), 'https://app.test', decode('cc', 'hex'), decode(repeat('04', 12), 'hex'), '2026-07-11T00:02:30Z', decode(repeat('01', 32), 'hex')
  ),
  true,
  'owner secret deposit overwrites anonymous ciphertext'
);
select is(
  (select encode(encrypted_code, 'hex') from private.auth_continuations where id = (select id from continuation_case)),
  'cc',
  'owner deposit ciphertext replaces the previous value'
);
-- B-I2 精緻化: deposit 前の正当ポーリングは副作用なし（空返却・行保持）
delete from continuation_case;
insert into continuation_case
select * from public.create_auth_continuation(
  decode(repeat('a0', 32), 'hex'), decode(repeat('a1', 32), 'hex'),
  'https://app.test', '/planner', '2026-07-11T00:00:00Z', 300
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('a0', 32), 'hex'), decode(repeat('a1', 32), 'hex'), 'https://app.test', '2026-07-11T00:01:00Z'
  )),
  0,
  'pre-deposit claim with correct credentials returns empty'
);
select is(
  (select count(*)::integer from private.auth_continuations where id = (select id from continuation_case)),
  1,
  'pre-deposit claim with correct credentials preserves the row'
);
-- C1: deposit 前の誤 secret は空返却するが行は消さない（UUID DoS 防止）
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('a0', 32), 'hex'), decode(repeat('ff', 32), 'hex'), 'https://app.test', '2026-07-11T00:01:30Z'
  )),
  0,
  'pre-deposit claim with wrong secret returns empty'
);
select is(
  (select count(*)::integer from private.auth_continuations where id = (select id from continuation_case)),
  1,
  'pre-deposit claim with wrong secret preserves the row'
);
-- C1: 誤 state も行を消さない
delete from continuation_case;
insert into continuation_case
select * from public.create_auth_continuation(
  decode(repeat('b0', 32), 'hex'), decode(repeat('b1', 32), 'hex'),
  'https://app.test', '/planner', '2026-07-11T00:00:00Z', 300
);
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('b0', 32), 'hex'), 'https://app.test', decode('aa', 'hex'), decode(repeat('02', 12), 'hex'), '2026-07-11T00:01:00Z'
  ),
  true,
  'deposit for incorrect-state claim path'
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('ff', 32), 'hex'), decode(repeat('b1', 32), 'hex'), 'https://app.test', '2026-07-11T00:03:00Z'
  )),
  0,
  'claim rejects an incorrect state'
);
select is(
  (select count(*)::integer from private.auth_continuations where id = (select id from continuation_case)),
  1,
  'failed claim with wrong state preserves the continuation row'
);
-- 成功経路用に別 continuation を用意する
delete from continuation_case;
insert into continuation_case
select * from public.create_auth_continuation(
  decode(repeat('10', 32), 'hex'), decode(repeat('11', 32), 'hex'),
  'https://app.test', '/planner', '2026-07-11T00:00:00Z', 300
);
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('10', 32), 'hex'), 'https://app.test', decode('aa', 'hex'), decode(repeat('02', 12), 'hex'), '2026-07-11T00:01:00Z'
  ),
  true,
  'deposit for successful claim path'
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('10', 32), 'hex'), decode(repeat('ff', 32), 'hex'), 'https://app.test', '2026-07-11T00:03:00Z'
  )),
  0,
  'claim rejects incorrect credentials without erasing'
);
select is(
  (select count(*)::integer from private.auth_continuations where id = (select id from continuation_case)),
  1,
  'incorrect credentials preserve the continuation'
);
delete from continuation_case;
insert into continuation_case
select * from public.create_auth_continuation(
  decode(repeat('20', 32), 'hex'), decode(repeat('21', 32), 'hex'),
  'https://app.test', '/planner', '2026-07-11T00:00:00Z', 300
);
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('20', 32), 'hex'), 'https://app.test', decode('aa', 'hex'), decode(repeat('02', 12), 'hex'), '2026-07-11T00:01:00Z'
  ),
  true,
  'deposit for origin-mismatch claim path'
);
select is(
  (select count(*)::integer from public.claim_auth_continuation(
    (select id from continuation_case), decode(repeat('20', 32), 'hex'), decode(repeat('21', 32), 'hex'), 'https://other.test', '2026-07-11T00:03:00Z'
  )),
  0,
  'claim rejects an incorrect origin without erasing'
);
select is(
  (select count(*)::integer from private.auth_continuations where id = (select id from continuation_case)),
  1,
  'incorrect origin preserves the continuation'
);
delete from continuation_case;
insert into continuation_case
select * from public.create_auth_continuation(
  decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'),
  'https://app.test', '/planner', '2026-07-11T00:00:00Z', 300
);
select is(
  public.deposit_auth_continuation(
    (select id from continuation_case), decode(repeat('00', 32), 'hex'), 'https://app.test', decode('aa', 'hex'), decode(repeat('02', 12), 'hex'), '2026-07-11T00:01:00Z'
  ),
  true,
  'deposit for successful claim'
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
      and encrypted_code = decode('aa', 'hex')
      and code_iv = decode(repeat('02', 12), 'hex')
  ),
  'claim keeps stored ciphertext for idempotent re-delivery'
);
select ok(
  exists(
    select 1 from public.claim_auth_continuation(
      (select id from continuation_case), decode(repeat('00', 32), 'hex'), decode(repeat('01', 32), 'hex'), 'https://app.test', '2026-07-11T00:04:00Z'
    ) where encrypted_code = decode('aa', 'hex') and code_iv = decode(repeat('02', 12), 'hex') and return_to = '/planner'
  ),
  'claimed continuation can be re-claimed idempotently within TTL'
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
