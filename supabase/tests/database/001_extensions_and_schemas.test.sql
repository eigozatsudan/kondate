\ir 000_helpers.sql
begin;
select plan(7);

select ok(
  current_setting('server_version_num')::integer between 170000 and 179999,
  'database runs PostgreSQL 17'
);

select has_schema('extensions', 'extensions schema exists');
select has_schema('private', 'private schema exists');
select has_extension('pgcrypto', 'pgcrypto is installed');
select has_extension('pgtap', 'pgtap is installed');
select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot use private schema'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated cannot use private schema'
);

select * from finish();
rollback;
