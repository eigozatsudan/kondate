\ir 000_helpers.sql
begin;
select plan(23);

select has_table('public', 'allergen_catalog', '');
select has_table('public', 'allergen_aliases', '');
select has_table('public', 'food_safety_rules', '');
select has_pk('public', 'allergen_catalog', '');
select has_pk('public', 'allergen_aliases', '');
select has_pk('public', 'food_safety_rules', '');

select ok(has_table_privilege('authenticated', 'public.allergen_catalog', 'select'), 'catalog is readable');
select ok(has_table_privilege('authenticated', 'public.allergen_aliases', 'select'), 'aliases are readable');
select ok(has_table_privilege('authenticated', 'public.food_safety_rules', 'select'), 'rules are readable');
select ok(not has_table_privilege('authenticated', 'public.allergen_catalog', 'insert'), 'catalog is not writable');
select ok(not has_table_privilege('authenticated', 'public.allergen_aliases', 'update'), 'aliases are not writable');
select ok(not has_table_privilege('authenticated', 'public.food_safety_rules', 'delete'), 'rules are not writable');
select ok(not has_table_privilege('anon', 'public.allergen_catalog', 'select'), 'anonymous users cannot read');

select is((select count(*)::integer from public.allergen_catalog where catalog_version = 'jp-caa-2026-04.v1'), 29, 'all 29 current items are seeded');
select is((select count(*)::integer from public.allergen_catalog
  where catalog_version = 'jp-caa-2026-04.v1' and regulatory_class = 'mandatory'),
  9, 'all 9 mandatory items are classified correctly');
select is((select count(*)::integer from public.allergen_catalog
  where catalog_version = 'jp-caa-2026-04.v1' and regulatory_class = 'recommended'),
  20, 'all 20 recommended items are classified correctly');
select ok((select count(*) > 29 from public.allergen_aliases where dictionary_version = 'jp-caa-2026-04.v1'), 'direct and processed aliases are seeded');
select is_empty($$
  with expected(id) as (values
    ('hard_beans_and_reviewed_nuts_under_6'),
    ('grapes_under_6'),
    ('cherry_tomato_under_6'),
    ('mochi_under_6'),
    ('mochi_senior'),
    ('bones_for_young_and_senior'),
    ('hard_food_for_senior')
  ), differences(id) as (
    (select id from expected
      except
      select id from public.food_safety_rules
      where rule_version = 'jp-caa-child-shape-2026-07.v1')
    union all
    (select id from public.food_safety_rules
      where rule_version = 'jp-caa-child-shape-2026-07.v1'
      except
      select id from expected)
  )
  select id from differences
$$, 'the frozen food safety rule version has exactly the reviewed rule IDs');
select is_empty($$
  with expected(allergen_id, normalized_alias, alias_kind, requires_label_confirmation) as (values
    ('shrimp', '海老', 'direct', false),
    ('peanut', 'ピーナッツ', 'direct', false),
    ('egg', '鶏卵', 'derived', false),
    ('soy', '豆腐', 'derived', false),
    ('wheat', 'カレールー', 'processed', true),
    ('milk', 'カレールー', 'processed', true),
    ('wheat', 'しょうゆ', 'processed', true),
    ('soy', 'しょうゆ', 'processed', true),
    ('egg', 'ドレッシング', 'processed', true),
    ('milk', 'ドレッシング', 'processed', true),
    ('wheat', 'ドレッシング', 'processed', true),
    ('soy', 'ドレッシング', 'processed', true)
  )
  select e.* from expected e
  where not exists (
    select 1 from public.allergen_aliases a
    where a.dictionary_version = 'jp-caa-2026-04.v1'
      and a.allergen_id = e.allergen_id
      and a.normalized_alias = e.normalized_alias
      and a.alias_kind = e.alias_kind
      and a.requires_label_confirmation = e.requires_label_confirmation
  )
$$, 'representative direct, derived, and processed aliases match reviewed semantics');
select ok(exists(select 1 from public.food_safety_rules where id='mochi_senior' and
  applies_to_age_bands @> array['senior']::text[] and rule_kind='forbidden'),
  'senior mochi is conservatively excluded');
select ok(not exists(select 1 from public.food_safety_rules
  where required_safety_tag is not null and required_safety_tag not in (
    'remove_bones','cut_small','quarter_round_food','soften','heat_thoroughly'
  )) and
  (select count(*) from public.food_safety_rules where required_safety_tag = 'quarter_round_food') = 2,
  'round-food rules use only the canonical action identifier');
select ok(exists(select 1 from public.food_safety_rules
  where id='hard_beans_and_reviewed_nuts_under_6'
    and applies_to_age_bands @> array['post_weaning_to_2','age_3_5']::text[]
    and rule_kind='forbidden'
    and match_terms @> array[
      '煎り大豆','いり大豆','節分豆','落花生','ピーナッツ','ピーナツ',
      'くるみ','胡桃','アーモンド','カシューナッツ','ピスタチオ','マカダミアナッツ'
    ]::text[]), 'hard beans and every reviewed nut name/alias are forbidden under six');
select ok(not exists(select 1 from public.food_safety_rules
  where id='hard_beans_and_reviewed_nuts_under_6'
    and match_terms && array['豆','大豆','豆腐','豆乳','納豆','大豆の水煮']::text[]),
  'the hard-particle rule does not classify soft processed bean products by a bare bean term');

select * from finish();
rollback;
