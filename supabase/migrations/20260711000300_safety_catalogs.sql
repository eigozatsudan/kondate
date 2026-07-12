create table public.allergen_catalog (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null unique check (char_length(display_name) between 1 and 40),
  regulatory_class text not null check (regulatory_class in ('mandatory', 'recommended')),
  catalog_version text not null check (char_length(catalog_version) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.allergen_aliases (
  id uuid primary key default gen_random_uuid(),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  alias text not null check (char_length(alias) between 1 and 80),
  normalized_alias text not null check (char_length(normalized_alias) between 1 and 80),
  alias_kind text not null check (alias_kind in ('direct', 'derived', 'processed')),
  requires_label_confirmation boolean not null,
  dictionary_version text not null check (char_length(dictionary_version) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (allergen_id, normalized_alias, dictionary_version),
  check ((alias_kind = 'processed') = requires_label_confirmation)
);
create index allergen_aliases_normalized_alias_idx on public.allergen_aliases(normalized_alias);

create table public.food_safety_rules (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  applies_to_age_bands text[] not null check (cardinality(applies_to_age_bands) > 0),
  match_terms text[] not null check (cardinality(match_terms) > 0),
  rule_kind text not null check (rule_kind in ('forbidden', 'requires_tag')),
  required_safety_tag text,
  user_message text not null check (char_length(user_message) between 1 and 200),
  rule_version text not null check (char_length(rule_version) between 1 and 80),
  created_at timestamptz not null default now(),
  check (
    (rule_kind = 'forbidden' and required_safety_tag is null)
    or (rule_kind = 'requires_tag' and required_safety_tag ~ '^[a-z][a-z0-9_]*$')
  ),
  check (applies_to_age_bands <@ array[
    'post_weaning_to_2','age_3_5','age_6_8','age_9_12','age_13_17','adult','senior'
  ]::text[])
);

alter table public.member_allergies
  add constraint member_allergies_allergen_id_fkey
  foreign key (allergen_id) references public.allergen_catalog(id) on delete restrict;

alter table public.allergen_catalog enable row level security;
alter table public.allergen_aliases enable row level security;
alter table public.food_safety_rules enable row level security;
revoke all on public.allergen_catalog, public.allergen_aliases, public.food_safety_rules
  from public, anon, authenticated;
grant select on public.allergen_catalog, public.allergen_aliases, public.food_safety_rules
  to authenticated;
create policy allergen_catalog_authenticated_read on public.allergen_catalog
for select to authenticated using (true);
create policy allergen_aliases_authenticated_read on public.allergen_aliases
for select to authenticated using (true);
create policy food_safety_rules_authenticated_read on public.food_safety_rules
for select to authenticated using (true);
