\ir 000_helpers.sql
begin;
select plan(8);
select has_table('public', 'allergen_catalog', 'allergen catalog table exists');
select has_table('public', 'allergen_aliases', 'allergen aliases table exists');
select has_table('public', 'food_safety_rules', 'food safety rules table exists');
select ok(has_table_privilege('authenticated', 'public.allergen_catalog', 'select'), 'authenticated reads catalog');
select ok(not has_table_privilege('authenticated', 'public.allergen_catalog', 'insert'), 'authenticated cannot insert catalog');
select ok(not has_table_privilege('anon', 'public.allergen_catalog', 'select'), 'anonymous cannot read catalog');
select ok((select relrowsecurity from pg_class where oid = 'public.allergen_catalog'::regclass), 'catalog RLS is enabled');
select is((select count(*)::integer from public.allergen_catalog), 0, 'Plan 1 creates no unreviewed catalog data');
select * from finish();
rollback;
