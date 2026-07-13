# Safety Catalog Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen the Plan 2 safety catalog pgTAP test so regulatory-class corruption, rule-set drift, and changes to representative aliases are detected without rejecting unrelated alias additions.

**Architecture:** Keep the production migration unchanged and extend the existing database test. Exact counts protect the frozen allergen classification, a bidirectional set comparison protects the frozen rule version, and a one-way expected-row table protects representative aliases while allowing additional aliases.

**Tech Stack:** PostgreSQL 15, pgTAP, Docker Compose

## Global Constraints

- Modify only `supabase/tests/database/02_safety_catalogs.test.sql` for the executable change.
- Keep code comments in Japanese; this test needs no new comments.
- Preserve existing privilege, schema, canonical tag, hard-bean, and soft-bean assertions.
- Treat `jp-caa-2026-04.v1` and `jp-caa-child-shape-2026-07.v1` as frozen version identifiers.
- Important-alias comparison is one-way: unrelated additions must not fail it.
- Use Japanese Conventional Commits format.

---

### Task 1: Strengthen reviewed safety catalog assertions

**Files:**
- Modify: `supabase/tests/database/02_safety_catalogs.test.sql:3-45`
- Reference: `supabase/migrations/20260711000400_safety_catalog_data.sql:3-118`
- Reference: `docs/superpowers/specs/2026-07-13-safety-catalog-test-coverage-design.md`

**Interfaces:**
- Consumes: reviewed rows for `jp-caa-2026-04.v1` and `jp-caa-child-shape-2026-07.v1`.
- Produces: 23 pgTAP assertions that allow unrelated aliases but reject protected classification, rule, or representative-alias changes.

- [ ] **Step 1: Add exact classification, rule-set, and representative-alias assertions**

Change `select plan(22);` to `select plan(23);`.

Keep the total allergen assertion and add exact class counts:

```sql
select is((select count(*)::integer from public.allergen_catalog
  where catalog_version = 'jp-caa-2026-04.v1' and regulatory_class = 'mandatory'),
  9, 'all 9 mandatory items are classified correctly');
select is((select count(*)::integer from public.allergen_catalog
  where catalog_version = 'jp-caa-2026-04.v1' and regulatory_class = 'recommended'),
  20, 'all 20 recommended items are classified correctly');
```

Replace the broad rule-count assertion with this exact frozen-version comparison:

```sql
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
```

Replace the two `bool_and` alias assertions with this one-way representative-row comparison:

```sql
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
```

- [ ] **Step 2: Verify each protected mutation fails for the expected assertion**

Immediately after `begin;`, add one mutation at a time, run the focused test, confirm the named assertion fails, then remove the mutation before trying the next one:

```sql
update public.allergen_catalog
set regulatory_class = 'recommended'
where id = 'shrimp';
```

Expected failures: `all 9 mandatory items are classified correctly` and
`all 20 recommended items are classified correctly`.

```sql
update public.food_safety_rules
set id = 'unexpected_rule_id'
where id = 'mochi_senior';
```

Expected failures: `the frozen food safety rule version has exactly the reviewed rule IDs`
and `senior mochi is conservatively excluded`.

```sql
update public.allergen_aliases
set alias_kind = 'direct', requires_label_confirmation = false
where allergen_id = 'wheat'
  and normalized_alias = 'カレールー'
  and dictionary_version = 'jp-caa-2026-04.v1';
```

Expected failure: `representative direct, derived, and processed aliases match reviewed semantics`.

Run after each temporary mutation:

```bash
npm run db:test -- supabase/tests/database/02_safety_catalogs.test.sql
```

Expected: FAIL only because the intended protected assertion no longer holds. Remove every temporary mutation from the file after observing its failure.

- [ ] **Step 3: Verify an unrelated alias addition remains allowed**

Immediately after `begin;`, temporarily add:

```sql
insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version)
values
  ('apple', 'アップル', 'アップル', 'direct', false, 'jp-caa-2026-04.v1');
```

Run:

```bash
npm run db:test -- supabase/tests/database/02_safety_catalogs.test.sql
```

Expected: PASS, proving the representative alias assertion is one-way. Remove the temporary insert afterward; the test's transaction rollback also prevents database persistence.

- [ ] **Step 4: Run final focused and full verification**

Confirm no temporary mutation remains, then run:

```bash
npm run db:test -- supabase/tests/database/02_safety_catalogs.test.sql
npm run db:test
git diff --check
```

Expected: focused test reports 23 tests and PASS; the full database suite reports all tests successful; `git diff --check` exits 0.

- [ ] **Step 5: Commit the test-strengthening change**

```bash
git add supabase/tests/database/02_safety_catalogs.test.sql
git commit -m "test: 安全カタログの内訳検証を強化"
```
