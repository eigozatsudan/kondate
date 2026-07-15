# Kondate MVP Menu Domain and Pantry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the safety catalogs, pantry, server-persisted three-step planner draft, deterministic menu-validation contracts, and current-safety-filtered emergency menus that work without OpenRouter.

**Architecture:** Supabase migrations own read-only versioned safety catalogs and RLS-protected pantry, draft, and normalized menu aggregates. Pure modules under `shared/` validate Zod output, allergens, processed-food label confirmations, age/shape rules, medical-scope exclusions, pantry use, adaptations, and current-safety fingerprints; the browser uses direct RLS CRUD while one authenticated Netlify Function serves deterministic emergency fixtures. Plan 3 consumes these exact contracts and tables to call OpenRouter and atomically persist validated results.

**Tech Stack:** Node.js 24 LTS, npm, TypeScript strict mode, React 19.2.7, React Router 8 Data Mode (`createBrowserRouter`), Vite 8, Tailwind CSS 4, TanStack Query 5, React Hook Form, Zod 4, Supabase JS 2, Netlify Functions, Vitest, React Testing Library, pgTAP, Playwright.

## Global Constraints

- The approved source of truth is `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` at commit `cd0cb70` or a later commit that only clarifies that approved design.
- Use Node.js `>=24 <25`; Node 24 is LTS. Do not use Node 26 Current for production.
- Use ESM and TypeScript `strict: true`; do not introduce `any` or unchecked type assertions at network and database boundaries.
- Use React 19.2.7 or later within React 19, Vite 8, Tailwind CSS 4 through `@tailwindcss/vite`, React Router 8 Data Mode (`createBrowserRouter`), and TanStack Query 5.
- All user-facing copy is Japanese. Internal identifiers, code comments, commits, and test names are English.
- Mobile-first layout must work at 320 CSS pixels without horizontal scrolling; interactive targets are at least 44 by 44 CSS pixels.
- Use the approved visual direction: warm off-white background, terracotta primary action, subdued green pantry accents, three-step planner home, and tabbed dish results with an overall timeline first.
- OpenRouter is called only from Netlify Functions. This increment does not call OpenRouter, reserve quota, or create generation-status records.
- User successful-generation limit is 5 per Japan calendar day; application OpenRouter HTTP-call limit defaults to 45 per Japan calendar day.
- Never log names, emails, allergies, free-form conditions, prompts, or raw AI responses. Log only request ID, error code, duration, and actual model ID.
- Never store raw AI output. Persist only Zod-validated structures, validation versions, and unresolved label confirmations.
- Current household safety constraints always override historical snapshots for history use, regeneration, and shopping-list creation.
- Allergy and food-safety validation never produces a “safe” badge or guarantee. Processed ingredients retain explicit label-confirmation records.
- All user-owned public tables have RLS and explicit grants. Shared safety catalogs are authenticated read-only. AI control tables live in a non-exposed `private` schema.
- Local development starts through root `docker compose up`; production is Netlify plus managed Supabase.
- Run every Node/npm/npx command in the Docker Compose `app` service. Run database resets with `./scripts/reset-local-db.sh` and pgTAP through the `db-test` service instead of npm wrappers.
- Every behavior change follows red-green-refactor, includes exact focused tests, and ends in a small commit.
- Safety seed `jp-caa-2026-04.v1` contains the 9 mandatory and 20 recommended Japanese allergen-label items current on 2026-07-11; its review source is the Consumer Affairs Agency's April 2026 handbook: https://www.caa.go.jp/policies/policy/food_labeling/food_sanitation/allergy/
- The only four-way cutting action identifier is `quarter_round_food` across catalog `required_safety_tag`, TypeScript enums, normalized DB checks, validators, and fixtures.
- For targets aged five or younger, the reviewed rule catalog forbids hard bean forms and every reviewed nut by concrete Japanese name/alias. It deliberately does not use bare `豆`/`大豆` matching, so tofu, soy milk, natto, boiled soybeans, and other explicitly softened bean products are not confused with hard whole beans.
- Expired-date input is display/sort data only. Never claim edibility; an expired pantry item requires an in-memory confirmation bound to one idempotency key and one JST date.
- `must_use` is mandatory and fails with `constraint_conflict` when unused. `prefer_use` may be unused only with a persisted Japanese reason.
- “やわらかめ” is an ordinary preference, not dysphagia care. Requests for weaning food, swallowing support, or therapeutic diets are rejected before AI and never relaxed for emergency menus.
- Do not create `POST /api/generations/menu`, call OpenRouter, reserve quota, or save a generated aggregate in this increment; Plan 3 owns those operations and `private.persist_validated_menu(...)`.

---

## File Structure

```text
supabase/
├── migrations/
│   ├── 20260711000400_safety_catalog_data.sql
│   ├── 20260711001000_pantry_and_planner_drafts.sql
│   └── 20260711001100_menu_core.sql
└── tests/database/
    ├── 02_safety_catalogs.test.sql
    ├── 03_pantry_and_planner_drafts.test.sql
    └── 04_menu_core.test.sql
shared/
├── contracts/
│   ├── generation.ts
│   ├── generation.test.ts
│   ├── pantry.ts
│   ├── pantry.test.ts
│   ├── planner.ts
│   └── planner.test.ts
├── emergency/
│   ├── fixtures.v1.ts
│   ├── filter-emergency-menus.ts
│   └── filter-emergency-menus.test.ts
├── safety/
│   ├── context.ts
│   ├── allergens.ts
│   ├── allergens.test.ts
│   ├── food-rules.ts
│   ├── food-rules.test.ts
│   ├── medical-scope.ts
│   ├── medical-scope.test.ts
│   ├── fingerprint.ts
│   ├── fingerprint.test.ts
│   ├── validate-generated-menu.ts
│   └── validate-generated-menu.test.ts
├── time/
│   ├── jst.ts
│   └── jst.test.ts
└── testing/
    └── factories.ts
src/features/
├── pantry/
│   ├── pantry-api.ts
│   ├── pantry-form.tsx
│   ├── pantry-page.tsx
│   └── pantry-page.test.tsx
├── planner/
│   ├── planner-api.ts
│   ├── current-safety-summary.tsx
│   ├── expired-pantry-checks.ts
│   ├── pantry-selector.tsx
│   ├── use-draft-autosave.ts
│   ├── planner-page.tsx
│   ├── planner-route.tsx
│   └── planner-page.test.tsx
└── emergency/
    ├── emergency-menu-api.ts
    ├── emergency-menu-page.tsx
    └── emergency-menu-page.test.tsx
netlify/functions/
├── _shared/
│   ├── auth.ts
│   ├── current-safety.ts
│   ├── env.ts
│   ├── http.ts
│   └── supabase-admin.ts
├── emergency-menus.ts
└── emergency-menus.test.ts
e2e/specs/menu-domain-pantry.spec.ts
```

Responsibilities and import direction are fixed:

- `shared/contracts/pantry.ts` owns pantry input, selection, quantity, shortage, and unused-reason schemas.
- `shared/contracts/planner.ts` owns incomplete server drafts and complete planner submissions; an expired-item confirmation is deliberately absent from both persisted schemas.
- `shared/contracts/generation.ts` owns the complete validated output aggregate: total time, dishes, ingredients, ordered recipe steps, integrated timeline, ingredient-bound member safety actions, pantry usage, and label confirmations. The migration persists actions only in `menu_safety_actions`.
- `shared/safety/*` contains pure deterministic validation. It imports contracts but no React, Supabase, or Netlify module.
- `shared/emergency/*` owns versioned reviewed fixtures and filtering; fixtures use the exact `ValidatedMenu` contract.
- `src/features/*` contains browser-only RLS CRUD and UI. It never imports Netlify code.
- `netlify/functions/_shared/current-safety.ts` is the only DB-to-`CurrentSafetyContext` mapper in this increment.
- `netlify/functions/emergency-menus.ts` is the only new custom route: `GET /api/emergency-menus`.
- Plan 3 may extend `shared/contracts/generation.ts` with generation-request envelopes but must not rename this plan's exports.

## Locked Cross-Plan Interfaces

```ts
// shared/contracts/pantry.ts
export type PantryItem = z.infer<typeof pantryItemSchema>;
export type PantryItemInput = z.infer<typeof pantryItemInputSchema>;
export type PantrySelectionDraft = z.infer<typeof pantrySelectionDraftSchema>;
export type PantryUsage = z.infer<typeof pantryUsageSchema>;

// shared/contracts/planner.ts
export type PlannerDraft = z.infer<typeof plannerDraftSchema>;
export type PlannerDraftInput = z.infer<typeof plannerDraftInputSchema>;
export type PlannerSubmission = z.infer<typeof plannerSubmissionSchema>;

// shared/contracts/generation.ts
export type ValidatedMenu = z.infer<typeof validatedMenuSchema>;
export type GeneratedLabelConfirmation = z.infer<typeof generatedLabelConfirmationSchema>;
export type MenuLabelConfirmation = z.infer<typeof menuLabelConfirmationSchema>;
export type MenuValidationIssue = {
  code: string;
  path: string;
  message: string;
};
export type MenuValidationResult =
  | {
      ok: true;
      menu: ValidatedMenu;
      labelConfirmations: readonly MenuLabelConfirmation[];
      safetyFingerprint: string;
    }
  | { ok: false; issues: readonly MenuValidationIssue[] };

// shared/safety/validate-generated-menu.ts
export function validateGeneratedMenu(
  menu: unknown,
  context: GenerationContext,
): MenuValidationResult;
// shared/safety/allergens.ts
export function deriveCurrentGeneratedLabelConfirmations(
  menu: GeneratedMenu | ValidatedMenu,
  context: CurrentSafetyContext,
): readonly GeneratedLabelConfirmation[];

// shared/safety/fingerprint.ts
export function createCurrentSafetyFingerprint(
  context: CurrentSafetyContext,
): string;

// shared/time/jst.ts
export function getJstDateKey(now: Date): string;
export function getNextJstMidnight(now: Date): Date;

// netlify/functions/_shared/auth.ts
export function requireUser(
  request: Request,
): Promise<{ userId: string; accessToken: string }>;

// netlify/functions/_shared/http.ts
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  );
}
export function json<T>(status: number, body: ApiResponse<T>): Response;
export function methodNotAllowed(allowed: readonly string[]): Response;
export function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T>;
export function handleError(error: unknown): Response;

// netlify/functions/_shared/current-safety.ts
export function loadCurrentSafetyContext(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<CurrentSafetyContext>;

// shared/emergency/fixtures.v1.ts
export const emergencyFixtureVersion = "2026-07-11.v1" as const;
export const emergencyMenuFixturesV1: readonly ValidatedMenu[];

// shared/testing/factories.ts
export function makeValidatedMenu(
  overrides?: Partial<ValidatedMenu>,
): ValidatedMenu;
export function makeCurrentSafetyContext(
  overrides?: Partial<CurrentSafetyContext>,
): CurrentSafetyContext;
```

## Task 1: Versioned Reviewed Safety Catalog Data

**Files:**
- Create: `supabase/tests/database/02_safety_catalogs.test.sql`
- Create: `supabase/migrations/20260711000400_safety_catalog_data.sql`

**Interfaces:**
- Consumes: Plan 1's final `20260711000300_safety_catalogs.sql` tables, `member_allergies_allergen_id_fkey`, authenticated read-only grants, `./scripts/reset-local-db.sh`, and the Docker Compose `db-test` service.
- Produces: authenticated-read-only `allergen_catalog`, `allergen_aliases`, `food_safety_rules`; versions `jp-caa-2026-04.v1` and `jp-caa-child-shape-2026-07.v1`.

- [ ] **Step 1 (2–5 min): Write the failing catalog/grant/seed pgTAP test**

Create `supabase/tests/database/02_safety_catalogs.test.sql`:

```sql
begin;
select plan(22);

select has_table('public', 'allergen_catalog');
select has_table('public', 'allergen_aliases');
select has_table('public', 'food_safety_rules');
select has_pk('public', 'allergen_catalog');
select has_pk('public', 'allergen_aliases');
select has_pk('public', 'food_safety_rules');

select ok(has_table_privilege('authenticated', 'public.allergen_catalog', 'select'), 'catalog is readable');
select ok(has_table_privilege('authenticated', 'public.allergen_aliases', 'select'), 'aliases are readable');
select ok(has_table_privilege('authenticated', 'public.food_safety_rules', 'select'), 'rules are readable');
select ok(not has_table_privilege('authenticated', 'public.allergen_catalog', 'insert'), 'catalog is not writable');
select ok(not has_table_privilege('authenticated', 'public.allergen_aliases', 'update'), 'aliases are not writable');
select ok(not has_table_privilege('authenticated', 'public.food_safety_rules', 'delete'), 'rules are not writable');
select ok(not has_table_privilege('anon', 'public.allergen_catalog', 'select'), 'anonymous users cannot read');

select is((select count(*)::integer from public.allergen_catalog where catalog_version = 'jp-caa-2026-04.v1'), 29, 'all 29 current items are seeded');
select ok((select count(*) > 29 from public.allergen_aliases where dictionary_version = 'jp-caa-2026-04.v1'), 'direct and processed aliases are seeded');
select ok((select count(*) >= 7 from public.food_safety_rules where rule_version = 'jp-caa-child-shape-2026-07.v1'), 'age and shape rules are seeded');
select ok((select bool_and(requires_label_confirmation) from public.allergen_aliases where normalized_alias = 'カレールー'), 'processed curry roux requires label confirmation');
select ok((select bool_and(not requires_label_confirmation) from public.allergen_aliases where normalized_alias = '鶏卵'), 'derived egg is a direct rejection');
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
```


- [ ] **Step 2 (2–5 min): Run the focused DB test and verify RED**

Run: `docker compose --profile test run --rm db-test supabase/tests/database/02_safety_catalogs.test.sql`

Expected: FAIL because `all 29 current items are seeded` reports got `0`.

- [ ] **Step 3 (2–5 min): Start the forward-only reviewed-data migration**

Create `supabase/migrations/20260711000400_safety_catalog_data.sql` and start it with a provenance comment; the local migrator supplies the transaction:

```sql
-- Reviewed against the Consumer Affairs Agency April 2026 allergen material.
```

- [ ] **Step 4 (2–5 min): Complete the migration with the reviewed versioned rows**

Append the following inserts to `supabase/migrations/20260711000400_safety_catalog_data.sql`:

```sql
insert into public.allergen_catalog (id, display_name, regulatory_class, catalog_version) values
  ('shrimp', 'えび', 'mandatory', 'jp-caa-2026-04.v1'),
  ('cashew_nut', 'カシューナッツ', 'mandatory', 'jp-caa-2026-04.v1'),
  ('crab', 'かに', 'mandatory', 'jp-caa-2026-04.v1'),
  ('walnut', 'くるみ', 'mandatory', 'jp-caa-2026-04.v1'),
  ('wheat', '小麦', 'mandatory', 'jp-caa-2026-04.v1'),
  ('buckwheat', 'そば', 'mandatory', 'jp-caa-2026-04.v1'),
  ('egg', '卵', 'mandatory', 'jp-caa-2026-04.v1'),
  ('milk', '乳', 'mandatory', 'jp-caa-2026-04.v1'),
  ('peanut', '落花生（ピーナッツ）', 'mandatory', 'jp-caa-2026-04.v1'),
  ('almond', 'アーモンド', 'recommended', 'jp-caa-2026-04.v1'),
  ('abalone', 'あわび', 'recommended', 'jp-caa-2026-04.v1'),
  ('squid', 'いか', 'recommended', 'jp-caa-2026-04.v1'),
  ('salmon_roe', 'いくら', 'recommended', 'jp-caa-2026-04.v1'),
  ('orange', 'オレンジ', 'recommended', 'jp-caa-2026-04.v1'),
  ('kiwi', 'キウイフルーツ', 'recommended', 'jp-caa-2026-04.v1'),
  ('beef', '牛肉', 'recommended', 'jp-caa-2026-04.v1'),
  ('sesame', 'ごま', 'recommended', 'jp-caa-2026-04.v1'),
  ('salmon', 'さけ', 'recommended', 'jp-caa-2026-04.v1'),
  ('mackerel', 'さば', 'recommended', 'jp-caa-2026-04.v1'),
  ('soy', '大豆', 'recommended', 'jp-caa-2026-04.v1'),
  ('chicken', '鶏肉', 'recommended', 'jp-caa-2026-04.v1'),
  ('banana', 'バナナ', 'recommended', 'jp-caa-2026-04.v1'),
  ('pistachio', 'ピスタチオ', 'recommended', 'jp-caa-2026-04.v1'),
  ('pork', '豚肉', 'recommended', 'jp-caa-2026-04.v1'),
  ('macadamia_nut', 'マカダミアナッツ', 'recommended', 'jp-caa-2026-04.v1'),
  ('peach', 'もも', 'recommended', 'jp-caa-2026-04.v1'),
  ('yam', 'やまいも', 'recommended', 'jp-caa-2026-04.v1'),
  ('apple', 'りんご', 'recommended', 'jp-caa-2026-04.v1'),
  ('gelatin', 'ゼラチン', 'recommended', 'jp-caa-2026-04.v1')
on conflict (id) do update set
  display_name = excluded.display_name,
  regulatory_class = excluded.regulatory_class,
  catalog_version = excluded.catalog_version;

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version)
select id, display_name, lower(regexp_replace(display_name, '[[:space:]（）()]', '', 'g')),
  'direct', false, 'jp-caa-2026-04.v1'
from public.allergen_catalog
on conflict (allergen_id, normalized_alias, dictionary_version) do nothing;

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('egg', '鶏卵', '鶏卵', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', '卵白', '卵白', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', '卵黄', '卵黄', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', '牛乳', '牛乳', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', 'バター', 'バター', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', 'チーズ', 'チーズ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '小麦粉', '小麦粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('shrimp', '海老', '海老', 'direct', false, 'jp-caa-2026-04.v1'),
  ('shrimp', 'エビ', 'エビ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('crab', '蟹', '蟹', 'direct', false, 'jp-caa-2026-04.v1'),
  ('crab', 'カニ', 'カニ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('walnut', '胡桃', '胡桃', 'direct', false, 'jp-caa-2026-04.v1'),
  ('buckwheat', '蕎麦', '蕎麦', 'direct', false, 'jp-caa-2026-04.v1'),
  ('egg', 'たまご', 'たまご', 'direct', false, 'jp-caa-2026-04.v1'),
  ('milk', '乳成分', '乳成分', 'derived', false, 'jp-caa-2026-04.v1'),
  ('peanut', '落花生', '落花生', 'direct', false, 'jp-caa-2026-04.v1'),
  ('peanut', 'ピーナッツ', 'ピーナッツ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('sesame', '胡麻', '胡麻', 'direct', false, 'jp-caa-2026-04.v1'),
  ('salmon', '鮭', '鮭', 'direct', false, 'jp-caa-2026-04.v1'),
  ('mackerel', '鯖', '鯖', 'direct', false, 'jp-caa-2026-04.v1'),
  ('kiwi', 'キウイ', 'キウイ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('peach', '桃', '桃', 'direct', false, 'jp-caa-2026-04.v1'),
  ('yam', '山芋', '山芋', 'direct', false, 'jp-caa-2026-04.v1'),
  ('apple', '林檎', '林檎', 'direct', false, 'jp-caa-2026-04.v1'),
  ('soy', '豆腐', '豆腐', 'derived', false, 'jp-caa-2026-04.v1'),
  ('soy', '豆乳', '豆乳', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'カレールー', 'カレールー', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'カレールー', 'カレールー', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'しょうゆ', 'しょうゆ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', 'しょうゆ', 'しょうゆ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', '醤油', '醤油', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', '醤油', '醤油', 'processed', true, 'jp-caa-2026-04.v1'),
  ('mackerel', '顆粒だし', '顆粒だし', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', '顆粒だし', '顆粒だし', 'processed', true, 'jp-caa-2026-04.v1'),
  ('egg', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('egg', 'マヨネーズ', 'マヨネーズ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'ホワイトソース', 'ホワイトソース', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'ホワイトソース', 'ホワイトソース', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', '食パン', '食パン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', '食パン', '食パン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('egg', 'ハム', 'ハム', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'ハム', 'ハム', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'コンソメ', 'コンソメ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', 'みそ', 'みそ', 'processed', true, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;

insert into public.food_safety_rules
  (id, applies_to_age_bands, match_terms, rule_kind, required_safety_tag, user_message, rule_version) values
  ('hard_beans_and_reviewed_nuts_under_6', array['post_weaning_to_2','age_3_5'], array[
    '硬い豆','かたい豆','炒り大豆','煎り大豆','いり大豆','乾燥大豆','節分豆','豆まき豆',
    '落花生','ピーナッツ','ピーナツ','くるみ','胡桃','ウォールナッツ','アーモンド',
    'カシューナッツ','ピスタチオ','マカダミアナッツ'
  ], 'forbidden', null, '5歳以下を含む献立では、硬い豆とピーナッツ・くるみ・アーモンド・カシューナッツ・ピスタチオ・マカダミアナッツを原則使用できません', 'jp-caa-child-shape-2026-07.v1'),
  ('grapes_under_6', array['post_weaning_to_2','age_3_5'], array['ぶどう','ブドウ'], 'requires_tag', 'quarter_round_food', 'ぶどうは4等分する工程が必要です', 'jp-caa-child-shape-2026-07.v1'),
  ('cherry_tomato_under_6', array['post_weaning_to_2','age_3_5'], array['ミニトマト','プチトマト'], 'requires_tag', 'quarter_round_food', 'ミニトマトは4等分する工程が必要です', 'jp-caa-child-shape-2026-07.v1'),
  ('mochi_under_6', array['post_weaning_to_2','age_3_5'], array['餅','もち'], 'forbidden', null, '5歳以下を含む献立では餅を使用できません', 'jp-caa-child-shape-2026-07.v1'),
  ('mochi_senior', array['senior'], array['餅','もち'], 'forbidden', null, '高齢者を含む固定候補とAI献立では餅を原則除外します', 'jp-caa-child-shape-2026-07.v1'),
  ('bones_for_young_and_senior', array['post_weaning_to_2','age_3_5','senior'], array['小骨','骨付き','魚'], 'requires_tag', 'remove_bones', '小骨を完全に除く工程が必要です', 'jp-caa-child-shape-2026-07.v1'),
  ('hard_food_for_senior', array['senior'], array['硬い','かたい','根菜'], 'requires_tag', 'soften', '高齢者向けに十分やわらかくする工程が必要です', 'jp-caa-child-shape-2026-07.v1')
on conflict (id) do update set
  applies_to_age_bands = excluded.applies_to_age_bands,
  match_terms = excluded.match_terms,
  rule_kind = excluded.rule_kind,
  required_safety_tag = excluded.required_safety_tag,
  user_message = excluded.user_message,
  rule_version = excluded.rule_version;
```

- [ ] **Step 5 (2–5 min): Reset, rerun pgTAP, and verify GREEN**

Run:

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/02_safety_catalogs.test.sql
```

Expected: reset exits 0; pgTAP prints `1..22` and `Result: PASS`.

- [ ] **Step 6 (2–5 min): Commit the catalog increment**

```bash
git add supabase/migrations/20260711000400_safety_catalog_data.sql \
  supabase/tests/database/02_safety_catalogs.test.sql
git commit -m "feat: seed reviewed safety catalog data"
```

## Task 2: RLS-Protected Pantry and Planner Draft Storage

**Files:**
- Create: `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`
- Create: `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql`
- Create: `supabase/migrations/20260711001000_pantry_and_planner_drafts.sql`
- Modify (generated): `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: Plan 1's `auth.users` ownership convention and generated `Database` helpers.
- Produces: owner-preserving `pantry_items` CRUD; one serialized `generation_drafts` row per user; monotonic draft `revision`; persisted `pantry_selections` containing only `pantryItemId` and `priority`. `save_generation_draft` takes a per-user transaction advisory lock and gives an active-draft revision conflict precedence over payload constraints when `expectedRevision` is zero.

- [ ] **Step 1 (2–5 min): Write the failing RLS and invariant pgTAP test**

Create `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`:

```sql
begin;
select plan(26);

select has_table('public', 'pantry_items', 'pantry item table exists');
select has_table('public', 'generation_drafts', 'generation draft table exists');
select has_column('public', 'pantry_items', 'expiration_type',
  'pantry item has an expiration type');
select has_column('public', 'pantry_items', 'opened_state',
  'pantry item has an opened state');
select has_column('public', 'generation_drafts', 'pantry_selections',
  'generation draft has pantry selections');
select has_column('public', 'generation_drafts', 'revision',
  'generation draft has a revision');
select has_column('public', 'generation_drafts', 'deleted_at',
  'generation draft has a deletion tombstone');
select has_function('public', 'delete_generation_draft', array['bigint']);
select ok((select relrowsecurity from pg_class where oid = 'public.pantry_items'::regclass),
  'pantry item RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.generation_drafts'::regclass),
  'generation draft RLS is enabled');
select has_function('public','save_generation_draft',
  array['bigint','text','text[]','text','uuid[]','smallint','text','text[]','text','jsonb']);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner1@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner2@example.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

insert into public.pantry_items (user_id, name, quantity, unit, expires_on, expiration_type, opened_state)
values ('10000000-0000-0000-0000-000000000001', 'にんじん', 2, '本', current_date - 1, 'use_by', 'opened');

select is((select count(*)::integer from public.pantry_items), 1, 'owner reads own pantry row');
select throws_ok(
  $$insert into public.pantry_items (user_id, name) values ('10000000-0000-0000-0000-000000000002', 'たまねぎ')$$,
  '42501', null, 'owner cannot insert for another user'
);
select throws_ok(
  $$insert into public.pantry_items (user_id, name, quantity, unit) values ('10000000-0000-0000-0000-000000000001', '牛乳', -1, 'ml')$$,
  '23514', null, 'quantity must be positive'
);

select public.save_generation_draft(0,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
  30::smallint,'standard',array[]::text[],'',
  '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb);

select is((select count(*)::integer from public.generation_drafts), 1, 'owner reads one draft');
select is((select revision from public.generation_drafts),1::bigint,
  'first authoritative save creates revision one');
select public.save_generation_draft(1,'dinner',array['鶏肉','白菜'],'japanese',array[]::uuid[],
  30::smallint,'standard',array[]::text[],'更新', '[]'::jsonb);
select is((select revision from public.generation_drafts),2::bigint,
  'each serialized save increments revision exactly once');
select throws_ok($$select public.save_generation_draft(1,'dinner',array[]::text[],
  'japanese',array[]::uuid[],30::smallint,'standard',array[]::text[],'stale','[]'::jsonb)$$,
  'P0001','draft_revision_conflict','a stale save cannot overwrite a newer draft');
select throws_ok($$insert into public.generation_drafts(user_id)
  values('10000000-0000-0000-0000-000000000001')$$,
  '42501',null,'browser cannot bypass the monotonic save RPC');
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use","checkedAt":"2026-07-11T00:00:00Z"}]'::jsonb)$$,
  '23514', null, 'expired confirmation cannot be persisted'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"not-a-uuid","priority":"must_use"}]'::jsonb)$$,
  '23514', null, 'pantry item ID must be a UUID'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"optional"}]'::jsonb)$$,
  '23514', null, 'pantry priority must be a declared value'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'','[{"priority":"must_use"}]'::jsonb)$$,
  '23514', null, 'pantry selection requires a pantry item ID'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001"}]'::jsonb)$$,
  '23514', null, 'pantry selection requires a priority'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use","note":"x"}]'::jsonb)$$,
  '23514', null, 'pantry selection rejects undeclared keys'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'','["invalid"]'::jsonb)$$,
  '23514', null, 'pantry selection must be an object'
);

select * from finish();
rollback;
```

Create `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql` as a self-contained `no_plan()` adversarial pgTAP transaction. In addition to the Unicode, numeric, array, RLS, ACL, soft-delete, recreation, and ABA checks, it must include all of these assertions:

- `has_function` proves the existence of all six private helpers: `is_canonical_bounded_text(text,integer,integer)`, `is_valid_draft_pantry_selections(jsonb)`, `is_valid_draft_text_array(text[],integer,integer)`, `is_valid_draft_uuid_array(uuid[],integer)`, `touch_updated_at()`, and `soft_delete_generation_draft(uuid,uuid,bigint)`.
- Each of those six helper ACL assertions first proves `to_regprocedure(...) is not null`, then proves `anon`, `authenticated`, and `service_role` cannot execute it. The aggregate PUBLIC assertion requires exactly six resolved procedures and no PUBLIC execute grant.
- An owner can update an owned pantry row but cannot transfer it by changing `user_id`; the transfer fails with SQLSTATE `42501`.
- Once an active draft exists, calling `save_generation_draft(0, ...)` with an otherwise invalid payload fails with `P0001/draft_revision_conflict`, proving the active revision conflict is selected before payload check violations.

- [ ] **Step 2 (2–5 min): Run the focused DB test and verify RED**

Run:

```bash
docker compose --profile test run --rm db-test supabase/tests/database/03_pantry_and_planner_drafts.test.sql
```

Expected: FAIL with `relation "public.pantry_items" does not exist`.

- [ ] **Step 3 (2–5 min): Create the pantry/draft migration with grants and RLS**

Create `supabase/migrations/20260711001000_pantry_and_planner_drafts.sql`:

```sql
create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (
    name = btrim(name, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    and char_length(name) between 1 and 80
  ),
  quantity numeric check (
    quantity > 0 and quantity <= 999999 and quantity = round(quantity, 3)
  ),
  unit text check (
    unit = btrim(unit, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    and char_length(unit) between 1 and 24
  ),
  expires_on date,
  expiration_type text check (expiration_type in ('use_by', 'best_before', 'other', 'unknown')),
  opened_state text check (opened_state in ('unopened', 'opened', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check ((quantity is null and unit is null) or (quantity is not null and unit is not null))
);

create index pantry_items_owner_expiry_idx
  on public.pantry_items (user_id, expires_on nulls last, created_at desc);

create or replace function private.is_canonical_bounded_text(
  p_value text, p_min_length integer, p_max_length integer
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is null or (
    pg_catalog.char_length(p_value) between p_min_length and p_max_length
    and p_value = pg_catalog.btrim(
      p_value,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
  );
$function$;

create or replace function private.is_valid_draft_pantry_selections(p_value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $function$
declare
  v_item jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;
  for v_item in select item from jsonb_array_elements(p_value) as items(item) loop
    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ? 'pantryItemId')
      or not (v_item ? 'priority')
      or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or jsonb_typeof(v_item -> 'pantryItemId') <> 'string'
      or jsonb_typeof(v_item -> 'priority') <> 'string'
      or (v_item ->> 'priority') not in ('must_use', 'prefer_use') then
      return false;
    end if;
    begin
      perform (v_item ->> 'pantryItemId')::uuid;
    exception when invalid_text_representation then
      return false;
    end;
  end loop;
  return true;
end;
$function$;

create or replace function private.is_valid_draft_text_array(
  p_value text[], p_max_count integer, p_max_length integer
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is not null
    and pg_catalog.cardinality(p_value) <= p_max_count
    and (pg_catalog.cardinality(p_value) = 0 or pg_catalog.array_ndims(p_value) = 1)
    and not exists (
      select 1
      from pg_catalog.unnest(p_value) as values_(value)
      where value is null
        or not private.is_canonical_bounded_text(value, 1, p_max_length)
    );
$function$;

create or replace function private.is_valid_draft_uuid_array(
  p_value uuid[], p_max_count integer
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is not null
    and pg_catalog.cardinality(p_value) <= p_max_count
    and (pg_catalog.cardinality(p_value) = 0 or pg_catalog.array_ndims(p_value) = 1)
    and not exists (
      select 1
      from pg_catalog.unnest(p_value) as values_(value)
      where value is null
    );
$function$;

revoke all on function private.is_canonical_bounded_text(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.is_valid_draft_pantry_selections(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.is_valid_draft_text_array(text[], integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.is_valid_draft_uuid_array(uuid[], integer)
  from public, anon, authenticated, service_role;

create table public.generation_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner')),
  main_ingredients text[] not null default '{}',
  cuisine_genre text check (cuisine_genre in ('japanese', 'western', 'chinese', 'any')),
  target_member_ids uuid[] not null default '{}',
  time_limit_minutes smallint check (time_limit_minutes in (15, 30, 45)),
  budget_preference text check (budget_preference in ('economy', 'standard')),
  avoid_ingredients text[] not null default '{}',
  memo text not null default '',
  pantry_selections jsonb not null default '[]'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (private.is_valid_draft_text_array(main_ingredients, 8, 80)),
  check (private.is_valid_draft_uuid_array(target_member_ids, 20)),
  check (private.is_valid_draft_text_array(avoid_ingredients, 20, 80)),
  check (private.is_canonical_bounded_text(memo, 0, 200)),
  check (private.is_valid_draft_pantry_selections(pantry_selections)),
  check (jsonb_array_length(pantry_selections) <= 50),
  check (pg_column_size(pantry_selections) <= 32768),
  check (
    not jsonb_path_exists(
      pantry_selections,
      '$[*] ? (exists(@.checkedAt) || exists(@.checkedOnJst) || exists(@.idempotencyKey))'
    )
  )
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at = pg_catalog.statement_timestamp();
  return new;
end;
$function$;
revoke all on function private.touch_updated_at()
  from public, anon, authenticated, service_role;

create trigger pantry_items_touch_updated_at
before update on public.pantry_items
for each row execute function private.touch_updated_at();

create trigger generation_drafts_touch_updated_at
before update on public.generation_drafts
for each row execute function private.touch_updated_at();

alter table public.pantry_items enable row level security;
alter table public.generation_drafts enable row level security;
revoke all on public.pantry_items from anon, authenticated;
revoke all on public.generation_drafts from anon, authenticated;
grant select, insert, update, delete on public.pantry_items to authenticated;
grant select on public.generation_drafts to authenticated;

create policy pantry_items_owner_select on public.pantry_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy pantry_items_owner_insert on public.pantry_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pantry_items_owner_update on public.pantry_items
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy pantry_items_owner_delete on public.pantry_items
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy generation_drafts_owner_select on public.generation_drafts
  for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);

create or replace function private.soft_delete_generation_draft(
  p_user_id uuid, p_draft_id uuid, p_expected_revision bigint
) returns public.generation_drafts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_deleted public.generation_drafts;
begin
  update public.generation_drafts
  set deleted_at = pg_catalog.statement_timestamp(), revision = revision + 1
  where user_id = p_user_id
    and deleted_at is null
    and (p_draft_id is null or id = p_draft_id)
    and (p_expected_revision is null or revision = p_expected_revision)
  returning * into v_deleted;
  return v_deleted;
end;
$function$;

revoke all on function private.soft_delete_generation_draft(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;

create or replace function public.save_generation_draft(
  p_expected_revision bigint, p_meal_type text, p_main_ingredients text[],
  p_cuisine_genre text, p_target_member_ids uuid[], p_time_limit_minutes smallint,
  p_budget_preference text, p_avoid_ingredients text[], p_memo text,
  p_pantry_selections jsonb
) returns public.generation_drafts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_saved public.generation_drafts;
  v_has_existing boolean;
begin
  if v_user_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );
  select * into v_saved
  from public.generation_drafts
  where user_id = v_user_id
  for update;
  v_has_existing := found;

  if p_expected_revision = 0 then
    if v_has_existing and v_saved.deleted_at is null then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;

    if not v_has_existing then
      insert into public.generation_drafts (
        user_id, meal_type, main_ingredients, cuisine_genre, target_member_ids,
        time_limit_minutes, budget_preference, avoid_ingredients, memo,
        pantry_selections, revision
      ) values (
        v_user_id, p_meal_type, p_main_ingredients, p_cuisine_genre, p_target_member_ids,
        p_time_limit_minutes, p_budget_preference, p_avoid_ingredients, p_memo,
        p_pantry_selections, 1
      )
      returning * into v_saved;
    else
      update public.generation_drafts
      set meal_type = p_meal_type,
        main_ingredients = p_main_ingredients,
        cuisine_genre = p_cuisine_genre,
        target_member_ids = p_target_member_ids,
        time_limit_minutes = p_time_limit_minutes,
        budget_preference = p_budget_preference,
        avoid_ingredients = p_avoid_ingredients,
        memo = p_memo,
        pantry_selections = p_pantry_selections,
        revision = revision + 1,
        deleted_at = null
      where id = v_saved.id
      returning * into v_saved;
    end if;
    return v_saved;
  else
    if not v_has_existing
      or v_saved.deleted_at is not null
      or v_saved.revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;

    update public.generation_drafts
    set meal_type = p_meal_type,
      main_ingredients = p_main_ingredients,
      cuisine_genre = p_cuisine_genre,
      target_member_ids = p_target_member_ids,
      time_limit_minutes = p_time_limit_minutes,
      budget_preference = p_budget_preference,
      avoid_ingredients = p_avoid_ingredients,
      memo = p_memo,
      pantry_selections = p_pantry_selections,
      revision = revision + 1
    where id = v_saved.id
    returning * into v_saved;
    return v_saved;
  end if;
end;
$function$;

create or replace function public.delete_generation_draft(p_expected_revision bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_deleted public.generation_drafts;
begin
  if v_user_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;
  v_deleted := private.soft_delete_generation_draft(v_user_id, null, p_expected_revision);
  if v_deleted is null then
    raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
  end if;
  return v_deleted.revision;
end;
$function$;

revoke all on function public.save_generation_draft(
  bigint, text, text[], text, uuid[], smallint, text, text[], text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.delete_generation_draft(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.save_generation_draft(
  bigint, text, text[], text, uuid[], smallint, text, text[], text, jsonb
) to authenticated;
grant execute on function public.delete_generation_draft(bigint)
  to authenticated;
```

- [ ] **Step 4 (2–5 min): Reset, regenerate types, and verify GREEN**

Run:

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/03_pantry_and_planner_drafts.test.sql
docker compose --profile test run --rm db-test supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql
docker compose run --rm app npm run db:types
docker compose run --rm --no-deps app npm run typecheck
```

Expected: 03が26 assertion、03aの全assertion（6 helperの存在/ACL、owner transfer拒否、invalid payloadに対するactive expected-zero conflict precedenceを含む）がPASSし、型生成とtypecheckがexit 0。

- [ ] **Step 5 (2–5 min): Commit pantry/draft persistence**

```bash
git add supabase/migrations/20260711001000_pantry_and_planner_drafts.sql \
  supabase/tests/database/03_pantry_and_planner_drafts.test.sql \
  supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql \
  src/shared/types/database.generated.ts
git commit -m "fix: 献立下書きの保存境界を強化"
```

## Task 3: Normalized Menu Core Schema and Owner RLS

**Files:**
- Create: `supabase/tests/database/04_menu_core.test.sql`
- Create: `supabase/tests/database/04a_menu_core_hardening.test.sql`
- Create: `supabase/migrations/20260711001100_menu_core.sql`
- Modify (generated): `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: Plan 1 household tables; Task 1 `allergen_catalog`; Task 2 `pantry_items`.
- Produces: exact menu aggregate tables consumed by Plan 3, including immutable target-member display snapshots and normalized `menu_safety_actions` rows for every validated structured action. A live household-member link is nullable and owner-composite; member deletion nulls only that link while preserving menu ownership, anonymous ref, snapshot, actions, and history. Authenticated browsers receive owner-scoped SELECT on every aggregate table and column-limited UPDATE only on `menus.is_favorite`; no generated-row INSERT/UPDATE/DELETE is granted. Plan 2 stores immutable canonical `source_text_snapshot` provenance but exposes no confirmation transition. Plan 3 creates the sole fingerprint-aware three-argument RPC in the same migration as the canonical current-safety locking helper. Plan 3/4が保存済みtargetからfingerprint入力を復元するときは、regex制約済み`anonymous_ref`の数値suffix昇順を唯一のcanonical orderとし、文字列順やDB返却順を使わない。

- [ ] **Step 1 (2–5 min): Write the failing menu-schema pgTAP test**

Create `supabase/tests/database/04_menu_core.test.sql`:

```sql
begin;
select plan(42);

select has_table('public', 'menus');
select has_table('public', 'menu_target_members');
select has_table('public', 'generation_pantry_selections');
select has_table('public', 'dishes');
select has_table('public', 'dish_ingredients');
select has_table('public', 'recipe_steps');
select has_table('public', 'menu_timeline_steps');
select has_table('public', 'menu_member_adaptations');
select has_table('public', 'menu_safety_actions');
select has_table('public', 'menu_label_confirmations');
select has_column(
  'public', 'menu_label_confirmations', 'source_text_snapshot',
  'label confirmations preserve a human-readable source snapshot'
);
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='menus'), 'menus has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='menu_target_members'), 'menu_target_members has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='generation_pantry_selections'), 'generation_pantry_selections has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='dishes'), 'dishes has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='dish_ingredients'), 'dish_ingredients has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='recipe_steps'), 'recipe_steps has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='menu_timeline_steps'), 'menu_timeline_steps has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='menu_member_adaptations'), 'menu_member_adaptations has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='menu_safety_actions'), 'menu_safety_actions has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='menu_label_confirmations'), 'menu_label_confirmations has RLS enabled');
select is((select count(*)::integer from pg_constraint where conrelid='public.dishes'::regclass and confrelid='public.menus'::regclass and contype='f'), 1, 'dish to menu has one unambiguous relationship');
select ok((select confdeltype='c' from pg_constraint where conname='menu_timeline_steps_step_owner_fkey' and conkey=array[
  (select attnum from pg_attribute where attrelid='public.menu_timeline_steps'::regclass and attname='recipe_step_id'),
  (select attnum from pg_attribute where attrelid='public.menu_timeline_steps'::regclass and attname='dish_id'),
  (select attnum from pg_attribute where attrelid='public.menu_timeline_steps'::regclass and attname='menu_id'),
  (select attnum from pg_attribute where attrelid='public.menu_timeline_steps'::regclass and attname='user_id')
]::smallint[]), 'timeline step uses the exact owner composite with cascade');
select ok((select confdeltype='c' from pg_constraint where conname='menu_member_adaptations_member_owner_fkey'), 'adaptation targets a member in the same menu and owner');
select ok(
  (select confdeltype='c' from pg_constraint where conname='menu_label_confirmations_member_owner_fkey')
  and exists(select 1 from pg_trigger where tgname='menu_label_confirmations_source_owner' and not tgisinternal),
  'label requirement has member ownership and polymorphic source ownership enforcement'
);
select ok(has_table_privilege('authenticated', 'public.menus', 'select'), 'menus are readable');
select ok(has_column_privilege('authenticated', 'public.menus', 'is_favorite', 'update'), 'favorite is browser editable');
select ok(not has_column_privilege('authenticated', 'public.menus', 'is_selected', 'update'), 'selection is not browser editable');
select ok(not has_table_privilege('authenticated', 'public.menus', 'insert'), 'menus are finalized server-side');
select ok(not has_table_privilege('authenticated', 'public.menus', 'delete'), 'menus are deleted through an owner-checking RPC');
select ok(has_table_privilege('authenticated', 'public.menu_label_confirmations', 'select'), 'label confirmations are readable');
select ok(not has_column_privilege('authenticated', 'public.menu_label_confirmations', 'confirmation_status', 'update'), 'direct confirmation update is forbidden');
select ok(
  to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid)') is null
  and to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid,text)') is null,
  'Task 3 exposes no confirmation transition before current-safety locking exists'
);
select ok(not has_table_privilege('authenticated', 'public.menu_label_confirmations', 'insert'), 'label records are finalized server-side');
select ok(has_table_privilege('authenticated', 'public.dishes', 'select'), 'generated children are readable');
select ok(not has_table_privilege('authenticated', 'public.dishes', 'insert'), 'generated children are not insertable');
select ok(not has_table_privilege('authenticated', 'public.dishes', 'update'), 'generated children are not editable');
select ok(not has_table_privilege('authenticated', 'public.dishes', 'delete'), 'generated children are not deletable');
select ok(has_table_privilege('authenticated', 'public.menu_safety_actions', 'select'), 'owner safety actions are readable');
select ok(not has_table_privilege('authenticated', 'public.menu_safety_actions', 'insert'), 'browser cannot insert safety actions');
select ok(not has_table_privilege('authenticated', 'public.menu_safety_actions', 'update'), 'browser cannot update safety actions');
select ok(not has_table_privilege('authenticated', 'public.menu_safety_actions', 'delete'), 'browser cannot delete safety actions');

select * from finish();
rollback;
```
Replace the four broad `has_fk` assertions with catalog assertions over `pg_constraint`, `conkey`, `confkey`, and `confdeltype`. They must prove each exact ordered composite key, its referenced columns, and its delete action: parent menu CASCADE; target menu CASCADE/member SET NULL; pantry selection menu CASCADE/item SET NULL; dish menu CASCADE; ingredient dish CASCADE/selection SET NULL; recipe step dish CASCADE; timeline menu, dish, and recipe-step ownership with CASCADE; adaptation dish, branch step, and member with CASCADE; every safety-action owner edge with CASCADE; and label menu/member CASCADE. Also assert there is exactly one FK relationship for each child/parent pair, so PostgREST cannot infer ambiguous duplicate single/composite relationships. Assert the label-source ownership trigger exists and is enabled.

Create `supabase/tests/database/04a_menu_core_hardening.test.sql` as a separate self-contained `begin; select no_plan(); ... select * from finish(); rollback;` pgTAP file. It must contain all setup, UUID literals, and role/JWT transitions it uses:

- As the migration owner, insert two real `auth.users`; one complete `household_members` row and one `pantry_items` row for each; then one internally valid row in every one of the ten menu aggregate tables for each owner. Use only UUID-form IDs and insert the full graph before `set local role authenticated`.
- For each of the ten tables, assert authenticated SELECT is granted and table INSERT/UPDATE/DELETE are denied. Separately assert only `menus.is_favorite` has column UPDATE. As authenticated owner 1, assert every table returns exactly its owner-1 row and hides owner 2; favorite update succeeds for owner 1 and affects zero rows for owner 2.
- Assert each exact FK by `pg_constraint` ordered `conkey`/`confkey` and `confdeltype`, plus exactly one FK per child/parent pair. Exercise rejected cross-owner dish/ingredient/step/member/source graphs. Exercise every polymorphic `source_type` with a same-menu source and reject a foreign or wrong-menu source.
- Assert neither the two-argument nor the three-argument `confirm_menu_label_confirmation` overload exists in Task 3; direct UPDATE remains denied. Reject blank, non-canonical whitespace-padded, and over-500-character `source_text_snapshot` values while accepting canonical 1-character and 500-character boundaries. Each accepted boundary fixture uses a unique source path and is deleted immediately so later owner-count assertions remain unchanged.
- `reset role` before owner-side deletes. Delete owner 1's household member and assert the target live-link pair becomes null while its display snapshot, adaptation, safety action, and label row remain. Delete its pantry item and assert the selection remains with null live pantry link and the ingredient remains. Delete owner 1's root menu and assert all nine child tables are empty for owner 1 while owner 2's entire graph remains. This proves Plan 4 can delete a derivation root/group without RESTRICT blockers.
- Add negative CHECK tests for blank `change_reason_custom`, all root/derived/custom reason states, missing shortage when both quantities exist, surplus shortage when either quantity is null, timeline step without dish, and confirmed provenance whose actor differs from `user_id`.

The accepted-boundary portion of `04a` uses the same insert columns as its confirmation fixtures. Keep these exact values and delete each row immediately:

```sql
select lives_ok(
  $$insert into public.menu_label_confirmations (
    id,menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,
    allergen_id,anonymous_member_ref,dictionary_version,requirement_safety_fingerprint
  ) values (
    '48500000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001','dish',
    '42000000-0000-0000-0000-000000000001','dishes.0.boundary.min','卵',
    'egg','member_1','dict-v1',repeat('a',64)
  )$$,
  'source snapshot accepts canonical one-character text'
);
delete from public.menu_label_confirmations
where id = '48500000-0000-0000-0000-000000000001';

select lives_ok(
  format(
    'insert into public.menu_label_confirmations '
    '(id,menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,'
    'allergen_id,anonymous_member_ref,dictionary_version,requirement_safety_fingerprint) '
    'values (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
    '48500000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001','dish',
    '42000000-0000-0000-0000-000000000001','dishes.0.boundary.max',repeat('あ',500),
    'egg','member_1','dict-v1',repeat('a',64)
  ),
  'source snapshot accepts canonical 500-character text'
);
delete from public.menu_label_confirmations
where id = '48500000-0000-0000-0000-000000000002';
```

- [ ] **Step 2 (2–5 min): Run the focused DB test and verify RED**

Run:

```bash
docker compose --profile test run --rm db-test supabase/tests/database/04_menu_core.test.sql
docker compose --profile test run --rm db-test supabase/tests/database/04a_menu_core_hardening.test.sql
```

Expected: FAIL with `relation "public.menus" does not exist`.

- [ ] **Step 3 (2–5 min): Create parent, target-member, and pantry-selection tables**

Start `supabase/migrations/20260711001100_menu_core.sql` with:

```sql
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  cuisine_genre text not null check (cuisine_genre in ('japanese', 'western', 'chinese', 'any')),
  servings smallint not null check (servings between 1 and 20),
  total_elapsed_minutes smallint not null check (total_elapsed_minutes between 1 and 180),
  preference_snapshot jsonb not null,
  safety_snapshot jsonb not null,
  safety_fingerprint text not null check (safety_fingerprint ~ '^[a-f0-9]{64}$'),
  allergen_dictionary_version text not null,
  food_safety_rule_version text not null,
  output_schema_version text not null,
  derivation_group_id uuid not null,
  parent_menu_id uuid,
  change_reason text check (change_reason in ('simpler','different_ingredient','child_friendly','different_flavor','custom')),
  change_reason_custom text check (
    private.is_canonical_bounded_text(change_reason_custom, 1, 200)
  ),
  is_selected boolean not null default false,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check (
    (parent_menu_id is null and change_reason is null and change_reason_custom is null)
    or (
      parent_menu_id is not null and change_reason is not null
      and ((change_reason = 'custom') = (change_reason_custom is not null))
    )
  )
);
create index menus_owner_created_idx on public.menus (user_id, created_at desc);
create index menus_owner_derivation_idx on public.menus (user_id, derivation_group_id);
create unique index menus_one_selected_per_group_idx
  on public.menus (user_id, derivation_group_id) where is_selected;

create table public.menu_target_members (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_member_id uuid,
  household_member_user_id uuid,
  anonymous_ref text not null check (anonymous_ref ~ '^member_[1-9][0-9]*$'),
  member_display_name_snapshot text not null check (char_length(btrim(member_display_name_snapshot)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (menu_id, household_member_id),
  unique (menu_id, anonymous_ref),
  check ((household_member_id is null) = (household_member_user_id is null)),
  check (household_member_user_id is null or household_member_user_id = user_id)
);

create table public.generation_pantry_selections (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  pantry_item_id uuid,
  pantry_name_snapshot text not null check (char_length(btrim(pantry_name_snapshot)) between 1 and 80),
  priority text not null check (priority in ('must_use', 'prefer_use')),
  idempotency_key uuid not null,
  expired_item_checked_at timestamptz,
  expired_item_check_jst_date date,
  usage_status text not null check (usage_status in ('used', 'unused')),
  planned_quantity numeric(12,3) check (planned_quantity > 0),
  inventory_quantity_snapshot numeric(12,3) check (inventory_quantity_snapshot > 0),
  shortage_quantity numeric(12,3) check (shortage_quantity >= 0),
  unit text check (char_length(btrim(unit)) between 1 and 24),
  unused_reason text check (char_length(btrim(unused_reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (menu_id, pantry_item_id),
  check ((expired_item_checked_at is null) = (expired_item_check_jst_date is null)),
  check (priority <> 'must_use' or usage_status = 'used'),
  check ((usage_status = 'unused' and priority = 'prefer_use') = (unused_reason is not null)),
  check (
    (planned_quantity is null or inventory_quantity_snapshot is null)
    = (shortage_quantity is null)
  ),
  check (
    shortage_quantity is null
    or shortage_quantity = greatest(planned_quantity - inventory_quantity_snapshot, 0)
  )
);
```

- [ ] **Step 4 (2–5 min): Add dishes, timeline, adaptations, confirmations, and explicit RLS**

Complete the same migration before `commit;`:

```sql
create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('main','side','soup','staple','other')),
  position smallint not null check (position > 0),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  cooking_time_minutes smallint not null check (cooking_time_minutes between 1 and 180),
  created_at timestamptz not null default now(),
  unique (menu_id, position)
);

create table public.dish_ingredients (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null check (position > 0),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  quantity_value numeric(12,3) check (quantity_value > 0),
  quantity_text text not null check (char_length(btrim(quantity_text)) between 1 and 60),
  unit text check (char_length(btrim(unit)) between 1 and 24),
  store_section text not null check (store_section in ('produce','meat_fish','dairy_eggs','dry_goods','seasonings','other')),
  pantry_selection_id uuid,
  label_confirmation_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (dish_id, position)
);

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null check (position > 0),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (dish_id, position)
);

create table public.menu_timeline_steps (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null check (position > 0),
  start_minute smallint not null check (start_minute >= 0),
  duration_minutes smallint not null check (duration_minutes > 0),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 500),
  dish_id uuid,
  recipe_step_id uuid,
  created_at timestamptz not null default now(),
  unique (menu_id, position),
  check (recipe_step_id is null or dish_id is not null)
);

create table public.menu_member_adaptations (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  portion_text text not null check (char_length(btrim(portion_text)) between 1 and 80),
  branch_before_recipe_step_id uuid not null,
  additional_cutting text check (char_length(btrim(additional_cutting)) between 1 and 300),
  additional_heating text check (char_length(btrim(additional_heating)) between 1 and 300),
  additional_seasoning text check (char_length(btrim(additional_seasoning)) between 1 and 300),
  serving_check text not null check (char_length(btrim(serving_check)) between 1 and 300),
  safety_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (menu_id, dish_id, anonymous_member_ref),
  unique (menu_id, dish_id, user_id, anonymous_member_ref)
);

create table public.menu_safety_actions (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  ingredient_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  before_recipe_step_id uuid not null,
  position smallint not null check (position between 1 and 20),
  kind text not null check (kind in (
    'remove_bones','cut_small','quarter_round_food','soften','heat_thoroughly'
  )),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (menu_id, dish_id, anonymous_member_ref, position)
);

create table public.menu_label_confirmations (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('dish','ingredient','recipe_step','adaptation','timeline')),
  source_id uuid not null,
  source_path text not null check (char_length(source_path) between 1 and 200),
  source_text_snapshot text not null check (
    source_text_snapshot = btrim(
      source_text_snapshot,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
    and char_length(source_text_snapshot) between 1 and 500
  ),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  dictionary_version text not null,
  requirement_safety_fingerprint text not null check (
    char_length(btrim(requirement_safety_fingerprint)) between 1 and 200),
  is_current boolean not null default true,
  confirmation_status text not null default 'pending' check (confirmation_status in ('pending','confirmed')),
  confirmed_at timestamptz,
  -- 確認者は同じ所有者であることをCHECKで固定する。auth.usersへの追加FKは、
  -- アカウント削除時のmenus起点CASCADEと競合させないため意図的に持たない。
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  constraint menu_label_confirmations_exact_source_unique
    unique (menu_id, source_type, source_id, source_path, allergen_id,
      anonymous_member_ref, dictionary_version, requirement_safety_fingerprint),
  check (
    (confirmation_status = 'pending' and confirmed_at is null and confirmed_by is null)
    or (
      confirmation_status = 'confirmed' and confirmed_at is not null
      and confirmed_by = user_id
    )
  )
);
create unique index menu_label_confirmations_one_current_requirement
  on public.menu_label_confirmations(
    menu_id,source_type,source_id,source_path,allergen_id,anonymous_member_ref
  ) where is_current;

-- 集約内の各親子には所有者複合FKを一つだけ持たせ、PostgRESTの関係推論を一意にする。
alter table public.menus
  add constraint menus_parent_owner_fkey
    foreign key (parent_menu_id, user_id) references public.menus(id, user_id) on delete cascade;

alter table public.menu_target_members
  add unique (menu_id, user_id, anonymous_ref),
  add constraint menu_target_members_menu_owner_fkey
    foreign key (menu_id, user_id) references public.menus(id, user_id) on delete cascade,
  add constraint menu_target_members_member_owner_fkey
    foreign key (household_member_id, household_member_user_id)
    references public.household_members(id, user_id)
    on delete set null (household_member_id, household_member_user_id);

alter table public.generation_pantry_selections
  add unique (id, menu_id, user_id),
  add constraint generation_pantry_selections_menu_owner_fkey
    foreign key (menu_id, user_id) references public.menus(id, user_id) on delete cascade,
  add constraint generation_pantry_selections_item_owner_fkey
    foreign key (pantry_item_id, user_id) references public.pantry_items(id, user_id)
    on delete set null (pantry_item_id);

alter table public.dishes
  add unique (id, menu_id, user_id),
  add constraint dishes_menu_owner_fkey
    foreign key (menu_id, user_id) references public.menus(id, user_id) on delete cascade;

alter table public.dish_ingredients
  add unique (id, dish_id, menu_id, user_id),
  add constraint dish_ingredients_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint dish_ingredients_pantry_owner_fkey
    foreign key (pantry_selection_id, menu_id, user_id)
    references public.generation_pantry_selections(id, menu_id, user_id)
    on delete set null (pantry_selection_id);

alter table public.recipe_steps
  add unique (id, dish_id, menu_id, user_id),
  add constraint recipe_steps_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade;

alter table public.menu_timeline_steps
  add unique (id, dish_id, menu_id, user_id),
  add constraint menu_timeline_steps_menu_owner_fkey
    foreign key (menu_id, user_id) references public.menus(id, user_id) on delete cascade,
  add constraint menu_timeline_steps_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint menu_timeline_steps_step_owner_fkey
    foreign key (recipe_step_id, dish_id, menu_id, user_id)
    references public.recipe_steps(id, dish_id, menu_id, user_id) on delete cascade;

alter table public.menu_member_adaptations
  add constraint menu_member_adaptations_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint menu_member_adaptations_branch_owner_fkey
    foreign key (branch_before_recipe_step_id, dish_id, menu_id, user_id)
    references public.recipe_steps(id, dish_id, menu_id, user_id) on delete cascade,
  add constraint menu_member_adaptations_member_owner_fkey
    foreign key (menu_id, user_id, anonymous_member_ref)
    references public.menu_target_members(menu_id, user_id, anonymous_ref) on delete cascade;

alter table public.menu_safety_actions
  add constraint menu_safety_actions_menu_owner_fkey
    foreign key (menu_id, user_id)
    references public.menus(id, user_id) on delete cascade,
  add constraint menu_safety_actions_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint menu_safety_actions_ingredient_owner_fkey
    foreign key (ingredient_id, dish_id, menu_id, user_id)
    references public.dish_ingredients(id, dish_id, menu_id, user_id) on delete cascade,
  add constraint menu_safety_actions_member_owner_fkey
    foreign key (menu_id, user_id, anonymous_member_ref)
    references public.menu_target_members(menu_id, user_id, anonymous_ref) on delete cascade,
  add constraint menu_safety_actions_step_owner_fkey
    foreign key (before_recipe_step_id, dish_id, menu_id, user_id)
    references public.recipe_steps(id, dish_id, menu_id, user_id) on delete cascade,
  add constraint menu_safety_actions_adaptation_owner_fkey
    foreign key (menu_id, dish_id, user_id, anonymous_member_ref)
    references public.menu_member_adaptations(menu_id, dish_id, user_id, anonymous_member_ref)
    on delete cascade;

alter table public.menu_label_confirmations
  add constraint menu_label_confirmations_menu_owner_fkey
    foreign key (menu_id, user_id) references public.menus(id, user_id) on delete cascade,
  add constraint menu_label_confirmations_member_owner_fkey
    foreign key (menu_id, user_id, anonymous_member_ref)
    references public.menu_target_members(menu_id, user_id, anonymous_ref) on delete cascade;

create or replace function private.assert_menu_label_source_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_exists boolean;
begin
  case new.source_type
    when 'dish' then
      select exists(select 1 from public.dishes where id=new.source_id and menu_id=new.menu_id and user_id=new.user_id) into v_exists;
    when 'ingredient' then
      select exists(select 1 from public.dish_ingredients where id=new.source_id and menu_id=new.menu_id and user_id=new.user_id) into v_exists;
    when 'recipe_step' then
      select exists(select 1 from public.recipe_steps where id=new.source_id and menu_id=new.menu_id and user_id=new.user_id) into v_exists;
    when 'adaptation' then
      select exists(select 1 from public.menu_member_adaptations where id=new.source_id and menu_id=new.menu_id and user_id=new.user_id) into v_exists;
    when 'timeline' then
      select exists(select 1 from public.menu_timeline_steps where id=new.source_id and menu_id=new.menu_id and user_id=new.user_id) into v_exists;
  end case;
  if not coalesce(v_exists,false) then
    raise exception using errcode='23503',message='menu_label_source_owner_mismatch';
  end if;
  return new;
end;
$function$;
revoke all on function private.assert_menu_label_source_owner()
  from public, anon, authenticated, service_role;

create trigger menu_label_confirmations_source_owner
before insert or update of menu_id,user_id,source_type,source_id
on public.menu_label_confirmations
for each row execute function private.assert_menu_label_source_owner();

do $$
declare
  owned_table text;
begin
  foreach owned_table in array array[
    'menus', 'menu_target_members', 'generation_pantry_selections', 'dishes',
    'dish_ingredients', 'recipe_steps', 'menu_timeline_steps',
    'menu_member_adaptations', 'menu_safety_actions', 'menu_label_confirmations'
  ]
  loop
    execute format('alter table public.%I enable row level security', owned_table);
    execute format('revoke all on public.%I from anon, authenticated', owned_table);
    execute format('grant select on public.%I to authenticated', owned_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      owned_table || '_owner_select', owned_table
    );
  end loop;
end;
$$;

grant update (is_favorite) on public.menus to authenticated;
create policy menus_owner_update_favorite on public.menus
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

```

- [ ] **Step 5 (2–5 min): Reset, regenerate DB types, and verify GREEN**

Run:

```bash
./scripts/reset-local-db.sh
docker compose run --rm app npm run db:types
docker compose --profile test run --rm db-test supabase/tests/database/04_menu_core.test.sql
docker compose --profile test run --rm db-test supabase/tests/database/04a_menu_core_hardening.test.sql
docker compose run --rm --no-deps app npm run typecheck
```

Expected: 04 prints `1..42`; 04a dynamically plans `84` assertions and both report `Result: PASS`; typecheck exits 0. Together they prove exact non-ambiguous composite relationships/delete actions, all-ten-table ACL and real owner/foreign RLS, favorite-only mutation, immutable canonical source snapshots with exact 1/500-character acceptance and blank/non-canonical/overlength rejection, absence of both confirmation RPC overloads, polymorphic source ownership, member/pantry unlink preservation, and root-menu cascading deletion.

- [ ] **Step 6 (2–5 min): Commit the normalized menu core**

```bash
git add supabase/migrations/20260711001100_menu_core.sql \
  supabase/tests/database/04_menu_core.test.sql \
  supabase/tests/database/04a_menu_core_hardening.test.sql \
  src/shared/types/database.generated.ts
git commit -m "feat: add normalized menu domain schema"
```

## Task 4: Pantry, Planner, Timeline, Adaptation, and Output Zod Contracts

**Files:**
- Create: `shared/contracts/pantry.test.ts`
- Create: `shared/contracts/planner.test.ts`
- Create: `shared/contracts/generation.test.ts`
- Create: `shared/contracts/pantry.ts`
- Create: `shared/contracts/planner.ts`
- Create: `shared/contracts/generation.ts`

**Interfaces:**
- Consumes: roadmap `MealType`, `CuisineGenre`, `PantryPriority` and Plan 1 `requiredSafetyConstraints`.
- Produces: the exact contract exports in “Locked Cross-Plan Interfaces”; Plan 3 maps `ValidatedMenu` camelCase fields to Task 3 columns.

- [ ] **Step 1 (2–5 min): Write failing contract tests**

Create `shared/contracts/pantry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  pantryItemInputSchema,
  pantrySelectionDraftSchema,
  pantryUsageSchema,
} from "./pantry";

describe("pantry contracts", () => {
  it("requires positive paired quantity and unit", () => {
    expect(
      pantryItemInputSchema.safeParse({
        name: "にんじん",
        quantity: -1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
    expect(
      pantryItemInputSchema.safeParse({
        name: "にんじん",
        quantity: 2,
        unit: null,
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
  });

  it("canonicalizes ECMAScript padding and counts Unicode code points", () => {
    expect(
      pantryItemInputSchema.parse({
        name: "\u00a0🍳\ufeff",
        quantity: 1.234,
        unit: "\ufeff個\u00a0",
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }),
    ).toMatchObject({ name: "🍳", quantity: 1.234, unit: "個" });
    expect(
      pantryItemInputSchema.safeParse({
        name: "🍳".repeat(81),
        quantity: null,
        unit: null,
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
  });

  it("rejects quantity with more than three decimal places", () => {
    expect(
      pantryItemInputSchema.safeParse({
        name: "牛乳",
        quantity: 1.2345,
        unit: "ml",
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
  });


  it("does not accept expiry confirmation in a persisted selection", () => {
    expect(
      pantrySelectionDraftSchema.safeParse({
        pantryItemId: "20000000-0000-0000-0000-000000000001",
        priority: "must_use",
        checkedAt: "2026-07-11T00:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("requires an unused reason and exact shortage arithmetic", () => {
    expect(
      pantryUsageSchema.safeParse({
        selectionId: "21000000-0000-0000-0000-000000000001",
        pantryItemId: null,
        pantryItemName: "にんじん",
        priority: "prefer_use",
        usageStatus: "unused",
        plannedQuantity: null,
        inventoryQuantity: null,
        shortageQuantity: null,
        unit: null,
        dishIds: [],
        unusedReason: null,
      }).success,
    ).toBe(false);
    expect(
      pantryUsageSchema.safeParse({
        selectionId: "21000000-0000-0000-0000-000000000001",
        pantryItemId: null,
        pantryItemName: "にんじん",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 3,
        inventoryQuantity: 2,
        shortageQuantity: 0,
        unit: "本",
        dishIds: ["22000000-0000-0000-0000-000000000001"],
        unusedReason: null,
      }).success,
    ).toBe(false);
  });
});
```

Create `shared/contracts/planner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { plannerDraftInputSchema, plannerSubmissionSchema } from "./planner";

const incompleteDraft = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMemberIds: [],
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

describe("planner contracts", () => {
  it("allows an incomplete autosave draft", () => {
    expect(plannerDraftInputSchema.parse(incompleteDraft)).toEqual(incompleteDraft);
  });

  it("requires the three basic choices and one target for submission", () => {
    expect(plannerSubmissionSchema.safeParse(incompleteDraft).success).toBe(false);
    expect(
      plannerSubmissionSchema.safeParse({
        ...incompleteDraft,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        targetMemberIds: ["30000000-0000-0000-0000-000000000001"],
      }).success,
    ).toBe(true);
  });

  it("limits memo to 200 characters", () => {
    expect(
      plannerDraftInputSchema.safeParse({ ...incompleteDraft, memo: "あ".repeat(201) }).success,
    ).toBe(false);
  });

  it("canonicalizes Unicode padding in draft text fields", () => {
    expect(
      plannerDraftInputSchema.parse({
        ...incompleteDraft,
        mainIngredients: ["\u00a0🍳\ufeff"],
        avoidIngredients: ["\u2028乳\u2029"],
        memo: "\ufeffメモ\u00a0",
      }),
    ).toMatchObject({
      mainIngredients: ["🍳"],
      avoidIngredients: ["乳"],
      memo: "メモ",
    });
  });

  it("counts astral draft text by Unicode code point", () => {
    expect(
      plannerDraftInputSchema.safeParse({
        ...incompleteDraft,
        mainIngredients: ["🍳".repeat(80)],
        memo: "🍳".repeat(200),
      }).success,
    ).toBe(true);
    expect(
      plannerDraftInputSchema.safeParse({
        ...incompleteDraft,
        mainIngredients: ["🍳".repeat(81)],
      }).success,
    ).toBe(false);
  });
});
```

Create `shared/contracts/generation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validatedMenuSchema } from "./generation";

const dishId = "40000000-0000-0000-0000-000000000001";
const stepId = "41000000-0000-0000-0000-000000000001";

const menu = {
  schemaVersion: "2026-07-11.v1",
  menuId: "42000000-0000-0000-0000-000000000001",
  mealType: "breakfast",
  cuisineGenre: "japanese",
  servings: 2,
  totalElapsedMinutes: 15,
  safetyTags: [],
  dishes: [
    {
      id: dishId,
      role: "main",
      position: 1,
      name: "おにぎり",
      description: "朝の主食",
      cookingTimeMinutes: 10,
      ingredients: [
        {
          id: "43000000-0000-0000-0000-000000000001",
          position: 1,
          name: "ごはん",
          quantityValue: 300,
          quantityText: "300g",
          unit: "g",
          storeSection: "dry_goods",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [{ id: stepId, position: 1, instruction: "握る" }],
    },
    {
      id: "40000000-0000-0000-0000-000000000002",
      role: "side",
      position: 2,
      name: "りんご",
      description: "切った果物",
      cookingTimeMinutes: 3,
      ingredients: [
        {
          id: "43000000-0000-0000-0000-000000000002",
          position: 1,
          name: "りんご",
          quantityValue: 0.5,
          quantityText: "1/2個",
          unit: "個",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "41000000-0000-0000-0000-000000000002",
          position: 1,
          instruction: "薄く切る",
        },
      ],
    },
  ],
  timeline: [
    {
      id: "44000000-0000-0000-0000-000000000001",
      position: 1,
      startMinute: 0,
      durationMinutes: 10,
      instruction: "おにぎりを作る",
      dishId,
      recipeStepId: stepId,
    },
  ],
  adaptations: [],
  pantryUsage: [],
  labelConfirmations: [],
} as const;

describe("validated menu schema", () => {
  it("accepts a complete two-dish breakfast", () => {
    expect(validatedMenuSchema.safeParse(menu).success).toBe(true);
  });

  it("rejects a timeline beyond total elapsed time", () => {
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        timeline: [{ ...menu.timeline[0], startMinute: 10, durationMinutes: 10 }],
      }).success,
    ).toBe(false);
  });

  it("rejects an adaptation whose branch step belongs to another dish", () => {
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        adaptations: [
          {
            id: "45000000-0000-0000-0000-000000000001",
            dishId: menu.dishes[1].id,
            anonymousMemberRef: "member_1",
            portionText: "半量",
            branchBeforeRecipeStepId: stepId,
            additionalCutting: "小さく切る",
            additionalHeating: null,
            additionalSeasoning: null,
            servingCheck: "大きさを確認する",
            safetyTags: ["cut_small"],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2 (2–5 min): Run contract tests and verify RED**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run \
  shared/contracts/pantry.test.ts shared/contracts/planner.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

Expected: FAIL with module-not-found errors for `./pantry`, `./planner`, and `./generation`.

- [ ] **Step 3 (2–5 min): Implement pantry and planner contracts**

Create `shared/contracts/pantry.ts`:

```ts
import { z } from "zod";
import { pantryPriorities } from "./domain";

export const expirationTypes = ["use_by", "best_before", "other", "unknown"] as const;
export const openedStates = ["unopened", "opened", "unknown"] as const;
export const pantryUsageStatuses = ["used", "unused"] as const;

function boundedCanonicalText(min: number, max: number) {
  return z.string().trim().refine(
    (value) => {
      const length = Array.from(value).length;
      return length >= min && length <= max;
    },
    { message: `${min}〜${max}文字で入力してください` },
  );
}

const nullableUnitSchema = boundedCanonicalText(1, 24).nullable();
const nullableQuantitySchema = z
  .number()
  .positive()
  .max(999_999)
  .multipleOf(0.001)
  .nullable();

export const pantryItemInputSchema = z
  .object({
    name: boundedCanonicalText(1, 80),
    quantity: nullableQuantitySchema,
    unit: nullableUnitSchema,
    expiresOn: z.string().date().nullable(),
    expirationType: z.enum(expirationTypes).nullable(),
    openedState: z.enum(openedStates).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.quantity === null) !== (value.unit === null)) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "分量と単位は両方入力してください",
      });
    }
  });

export const pantryItemSchema = pantryItemInputSchema.safeExtend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const pantrySelectionDraftSchema = z
  .object({
    pantryItemId: z.string().uuid(),
    priority: z.enum(pantryPriorities),
  })
  .strict();

export const pantryUsageSchema = z
  .object({
    selectionId: z.string().uuid(),
    pantryItemId: z.string().uuid().nullable(),
    pantryItemName: boundedCanonicalText(1, 80),
    priority: z.enum(pantryPriorities),
    usageStatus: z.enum(pantryUsageStatuses),
    plannedQuantity: nullableQuantitySchema,
    inventoryQuantity: nullableQuantitySchema,
    shortageQuantity: z.number().min(0).max(999_999).nullable(),
    unit: nullableUnitSchema,
    dishIds: z.array(z.string().uuid()),
    unusedReason: boundedCanonicalText(1, 200).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.priority === "must_use" && value.usageStatus === "unused") {
      context.addIssue({ code: "custom", path: ["usageStatus"], message: "必ず使う食材が未使用です" });
    }
    if (value.usageStatus === "used" && value.dishIds.length === 0) {
      context.addIssue({ code: "custom", path: ["dishIds"], message: "使用先の料理が必要です" });
    }
    if (value.usageStatus === "unused" && value.unusedReason === null) {
      context.addIssue({ code: "custom", path: ["unusedReason"], message: "未使用理由が必要です" });
    }
    if (value.usageStatus === "used" && value.unusedReason !== null) {
      context.addIssue({ code: "custom", path: ["unusedReason"], message: "使用時に未使用理由は保存しません" });
    }
    if (
      (value.plannedQuantity === null || value.inventoryQuantity === null) &&
      value.shortageQuantity !== null
    ) {
      context.addIssue({ code: "custom", path: ["shortageQuantity"], message: "数量未入力時に不足量は保存しません" });
    }
    if (value.plannedQuantity !== null && value.inventoryQuantity !== null) {
      const expected = Math.max(value.plannedQuantity - value.inventoryQuantity, 0);
      if (value.shortageQuantity === null || Math.abs(value.shortageQuantity - expected) > 0.0001) {
        context.addIssue({ code: "custom", path: ["shortageQuantity"], message: "不足量が在庫量と一致しません" });
      }
    }
  });

export type ExpirationType = (typeof expirationTypes)[number];
export type OpenedState = (typeof openedStates)[number];
export type PantryItemInput = z.infer<typeof pantryItemInputSchema>;
export type PantryItem = z.infer<typeof pantryItemSchema>;
export type PantrySelectionDraft = z.infer<typeof pantrySelectionDraftSchema>;
export type PantryUsage = z.infer<typeof pantryUsageSchema>;
```

Create `shared/contracts/planner.ts`:

```ts
import { z } from "zod";
import { cuisineGenres, mealTypes } from "./domain";
import { pantrySelectionDraftSchema } from "./pantry";

export const plannerTimeLimits = [15, 30, 45] as const;
export const budgetPreferences = ["economy", "standard"] as const;

function boundedCanonicalText(min: number, max: number) {
  return z.string().trim().refine(
    (value) => {
      const length = Array.from(value).length;
      return length >= min && length <= max;
    },
    { message: `${min}〜${max}文字で入力してください` },
  );
}

const draftShape = {
  mealType: z.enum(mealTypes).nullable(),
  mainIngredients: z.array(boundedCanonicalText(1, 80)).max(8),
  cuisineGenre: z.enum(cuisineGenres).nullable(),
  targetMemberIds: z.array(z.string().uuid()).max(20),
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
  memo: boundedCanonicalText(0, 200),
  pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
} satisfies z.ZodRawShape;

export const plannerDraftInputSchema = z.object(draftShape).strict();
export const plannerDraftSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    ...draftShape,
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const plannerSubmissionSchema = z
  .object({
    mealType: z.enum(mealTypes),
    mainIngredients: z.array(boundedCanonicalText(1, 80)).min(1).max(8),
    cuisineGenre: z.enum(cuisineGenres),
    targetMemberIds: z.array(z.string().uuid()).min(1).max(20),
    timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
    budgetPreference: z.enum(budgetPreferences).nullable(),
    avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
    memo: boundedCanonicalText(0, 200),
    pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
  })
  .strict();

export type BudgetPreference = (typeof budgetPreferences)[number];
export type PlannerDraftInput = z.infer<typeof plannerDraftInputSchema>;
export type PlannerDraft = z.infer<typeof plannerDraftSchema>;
export type PlannerSubmission = z.infer<typeof plannerSubmissionSchema>;
```

- [ ] **Step 4 (2–5 min): Implement the complete menu aggregate contract**

Create `shared/contracts/generation.ts`:

```ts
import { z } from "zod";
import { cuisineGenres, mealTypes } from "./domain";
import { pantryUsageSchema } from "./pantry";

export const dishRoles = ["main", "side", "soup", "staple", "other"] as const;
export const storeSections = [
  "produce",
  "meat_fish",
  "dairy_eggs",
  "dry_goods",
  "seasonings",
  "other",
] as const;
export const labelSourceTypes = ["dish", "ingredient", "recipe_step", "adaptation", "timeline"] as const;
const safetyTagSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
export const safetyActionKinds = ["remove_bones", "cut_small", "quarter_round_food", "soften", "heat_thoroughly"] as const;
export const safetyActionSchema = z.object({
  kind: z.enum(safetyActionKinds),
  dishId: z.string().uuid(),
  ingredientId: z.string().uuid(),
  anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
  beforeRecipeStepId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(300),
}).strict();

export const dishIngredientSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  quantityValue: z.number().positive().nullable(),
  quantityText: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(24).nullable(),
  storeSection: z.enum(storeSections),
  pantrySelectionId: z.string().uuid().nullable(),
  labelConfirmationRequired: z.boolean(),
}).strict();

export const recipeStepSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(500),
}).strict();

export const dishSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(dishRoles),
  position: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300),
  cookingTimeMinutes: z.number().int().positive().max(180),
  ingredients: z.array(dishIngredientSchema).min(1).max(50),
  steps: z.array(recipeStepSchema).min(1).max(30),
}).strict();

export const menuTimelineStepSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().positive(),
  startMinute: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(500),
  dishId: z.string().uuid().nullable(),
  recipeStepId: z.string().uuid().nullable(),
}).strict();

export const menuMemberAdaptationSchema = z.object({
  id: z.string().uuid(),
  dishId: z.string().uuid(),
  anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
  portionText: z.string().trim().min(1).max(80),
  branchBeforeRecipeStepId: z.string().uuid(),
  additionalCutting: z.string().trim().min(1).max(300).nullable(),
  additionalHeating: z.string().trim().min(1).max(300).nullable(),
  additionalSeasoning: z.string().trim().min(1).max(300).nullable(),
  servingCheck: z.string().trim().min(1).max(300),
  safetyTags: z.array(safetyTagSchema),
  safetyActions: z.array(safetyActionSchema).max(20).default([]),
}).strict();

export const menuLabelConfirmationSchema = z.object({
  sourceType: z.enum(labelSourceTypes),
  sourceId: z.string().uuid(),
  sourcePath: z.string().trim().min(1).max(200),
  allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
  dictionaryVersion: z.string().trim().min(1).max(80),
  confirmationStatus: z.literal("pending"),
}).strict();

export const validatedMenuSchema = z
  .object({
    schemaVersion: z.literal("2026-07-11.v1"),
    menuId: z.string().uuid(),
    mealType: z.enum(mealTypes),
    cuisineGenre: z.enum(cuisineGenres),
    servings: z.number().int().min(1).max(20),
    totalElapsedMinutes: z.number().int().min(1).max(180),
    safetyTags: z.array(safetyTagSchema),
    dishes: z.array(dishSchema).min(1).max(5),
    timeline: z.array(menuTimelineStepSchema).min(1).max(60),
    adaptations: z.array(menuMemberAdaptationSchema).max(100),
    pantryUsage: z.array(pantryUsageSchema).max(50),
    labelConfirmations: z.array(menuLabelConfirmationSchema).max(200),
  })
  .strict()
  .superRefine((menu, context) => {
    const expectedDishCount = menu.mealType === "dinner" ? 3 : 2;
    if (menu.dishes.length !== expectedDishCount) {
      context.addIssue({ code: "custom", path: ["dishes"], message: "食事区分の品数と一致しません" });
    }
    const dishIds = new Set(menu.dishes.map((dish) => dish.id));
    const stepOwner = new Map(
      menu.dishes.flatMap((dish) => dish.steps.map((step) => [step.id, dish.id] as const)),
    );
    for (const [index, timeline] of menu.timeline.entries()) {
      if (timeline.startMinute + timeline.durationMinutes > menu.totalElapsedMinutes) {
        context.addIssue({ code: "custom", path: ["timeline", index], message: "全体時間を超えています" });
      }
      if (timeline.dishId !== null && !dishIds.has(timeline.dishId)) {
        context.addIssue({ code: "custom", path: ["timeline", index, "dishId"], message: "料理参照が不正です" });
      }
      if (timeline.recipeStepId !== null && !stepOwner.has(timeline.recipeStepId)) {
        context.addIssue({ code: "custom", path: ["timeline", index, "recipeStepId"], message: "工程参照が不正です" });
      }
      if (
        timeline.dishId !== null &&
        timeline.recipeStepId !== null &&
        stepOwner.get(timeline.recipeStepId) !== timeline.dishId
      ) {
        context.addIssue({ code: "custom", path: ["timeline", index], message: "料理と工程の参照が一致しません" });
      }
    }
    const ingredientOwner = new Map(menu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.id, dish.id] as const)));
    for (const [index, adaptation] of menu.adaptations.entries()) {
      if (stepOwner.get(adaptation.branchBeforeRecipeStepId) !== adaptation.dishId) {
        context.addIssue({
          code: "custom",
          path: ["adaptations", index, "branchBeforeRecipeStepId"],
          message: "取り分け分岐工程が対象料理に属していません",
        });
      }
      for (const [actionIndex, action] of adaptation.safetyActions.entries()) {
        if (action.dishId !== adaptation.dishId ||
            action.anonymousMemberRef !== adaptation.anonymousMemberRef ||
            ingredientOwner.get(action.ingredientId) !== adaptation.dishId ||
            stepOwner.get(action.beforeRecipeStepId) !== adaptation.dishId) {
          context.addIssue({
            code: "custom",
            path: ["adaptations", index, "safetyActions", actionIndex],
            message: "安全工程の料理・食材・家族・事前工程参照が一致しません",
          });
        }
      }
    }
    const ingredientIds = new Set(ingredientOwner.keys());
    const sourceIds = new Set<string>([
      ...dishIds,
      ...ingredientIds,
      ...stepOwner.keys(),
      ...menu.timeline.map((item) => item.id),
      ...menu.adaptations.map((item) => item.id),
    ]);
    for (const [index, confirmation] of menu.labelConfirmations.entries()) {
      if (!sourceIds.has(confirmation.sourceId)) {
        context.addIssue({ code: "custom", path: ["labelConfirmations", index, "sourceId"], message: "確認元が不正です" });
      }
    }
  });

// Until Task 10 splits stored confirmation provenance, generated output is the pending-only schema.
export const generatedMenuSchema = validatedMenuSchema;

export type DishIngredient = z.infer<typeof dishIngredientSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type Dish = z.infer<typeof dishSchema>;
export type MenuTimelineStep = z.infer<typeof menuTimelineStepSchema>;
export type MenuMemberAdaptation = z.infer<typeof menuMemberAdaptationSchema>;
export type MenuLabelConfirmation = z.infer<typeof menuLabelConfirmationSchema>;
export type ValidatedMenu = z.infer<typeof validatedMenuSchema>;
export type GeneratedMenu = z.infer<typeof generatedMenuSchema>;
export type MenuValidationIssue = { code: string; path: string; message: string };
export type MenuValidationResult =
  | {
      ok: true;
      menu: ValidatedMenu;
      labelConfirmations: readonly MenuLabelConfirmation[];
      safetyFingerprint: string;
    }
  | { ok: false; issues: readonly MenuValidationIssue[] };
```

- [ ] **Step 5 (2–5 min): Run contract tests and typecheck for GREEN**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run \
  shared/contracts/pantry.test.ts shared/contracts/planner.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

Expected: Vitest reports 9 passed tests; typecheck exits 0.

- [ ] **Step 6 (2–5 min): Commit shared contracts**

```bash
git add shared/contracts/pantry.ts shared/contracts/pantry.test.ts \
  shared/contracts/planner.ts shared/contracts/planner.test.ts \
  shared/contracts/generation.ts shared/contracts/generation.test.ts
git commit -m "feat: define planner and validated menu contracts"
```

## Task 5: Deterministic Current-Safety Engine and JST Boundary

**Files:**
- Create: `shared/testing/factories.ts`
- Create: `shared/safety/context.ts`
- Create: `shared/safety/allergens.ts`
- Create: `shared/safety/food-rules.ts`
- Create: `shared/safety/medical-scope.ts`
- Create: `shared/safety/fingerprint.ts`
- Create: `shared/safety/validate-generated-menu.ts`
- Create: `shared/time/jst.ts`
- Test: `shared/safety/allergens.test.ts`
- Test: `shared/safety/food-rules.test.ts`
- Test: `shared/safety/medical-scope.test.ts`
- Test: `shared/safety/fingerprint.test.ts`
- Test: `shared/safety/validate-generated-menu.test.ts`
- Test: `shared/time/jst.test.ts`

**Interfaces:**
- Consumes: Task 4 `ValidatedMenu`; Plan 1 `AgeBand`, `AllergyStatus`, `RequiredSafetyConstraint`, `UnsupportedDietKind`, and `UnsupportedDietStatus`.
- Produces: `CurrentSafetyContext`, deterministic direct-match rejection, processed-label records, age/shape and required-constraint rejection, medical-scope rejection, SHA-256 current fingerprint, and JST date functions.

- [ ] **Step 1 (2–5 min): Add a typed valid-menu test factory**

Create `shared/testing/factories.ts`:

```ts
import type { ValidatedMenu } from "../contracts/generation";
import type { CurrentSafetyContext } from "../safety/context";

export function makeValidatedMenu(overrides: Partial<ValidatedMenu> = {}): ValidatedMenu {
  const dishId = "50000000-0000-0000-0000-000000000001";
  const stepId = "51000000-0000-0000-0000-000000000001";
  const base: ValidatedMenu = {
    schemaVersion: "2026-07-11.v1",
    menuId: "52000000-0000-0000-0000-000000000001",
    mealType: "breakfast",
    cuisineGenre: "japanese",
    servings: 2,
    totalElapsedMinutes: 15,
    safetyTags: [],
    dishes: [
      {
        id: dishId,
        role: "main",
        position: 1,
        name: "塩おにぎり",
        description: "朝の主食",
        cookingTimeMinutes: 10,
        ingredients: [{
          id: "53000000-0000-0000-0000-000000000001",
          position: 1,
          name: "ごはん",
          quantityValue: 300,
          quantityText: "300g",
          unit: "g",
          storeSection: "dry_goods",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        }],
        steps: [{ id: stepId, position: 1, instruction: "ごはんを握る" }],
      },
      {
        id: "50000000-0000-0000-0000-000000000002",
        role: "side",
        position: 2,
        name: "温野菜",
        description: "加熱した野菜",
        cookingTimeMinutes: 5,
        ingredients: [{
          id: "53000000-0000-0000-0000-000000000002",
          position: 1,
          name: "にんじん",
          quantityValue: 0.5,
          quantityText: "1/2本",
          unit: "本",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        }],
        steps: [{
          id: "51000000-0000-0000-0000-000000000002",
          position: 1,
          instruction: "やわらかく加熱する",
        }],
      },
    ],
    timeline: [{
      id: "54000000-0000-0000-0000-000000000001",
      position: 1,
      startMinute: 0,
      durationMinutes: 10,
      instruction: "野菜を加熱しながらおにぎりを作る",
      dishId,
      recipeStepId: stepId,
    }],
    adaptations: [],
    pantryUsage: [],
    labelConfirmations: [],
  };
  return { ...base, ...overrides };
}

export function makeCurrentSafetyContext(
  overrides: Partial<CurrentSafetyContext> = {},
): CurrentSafetyContext {
  const base: CurrentSafetyContext = {
    dictionaryVersion: "jp-caa-2026-04.v1",
    foodRuleVersion: "jp-caa-child-shape-2026-07.v1",
    requestText: "",
    members: [{
      householdMemberId: "55000000-0000-0000-0000-000000000001",
      anonymousRef: "member_1",
      ageBand: "adult",
      allergyStatus: "none",
      allergenIds: [],
      hasUnmappedCustomAllergy: false,
      requiredSafetyConstraints: [],
      unsupportedDietStatus: "none",
      unsupportedDietKinds: [],
    }],
    allergenDictionary: { version: "jp-caa-2026-04.v1", catalog: [], aliases: [] },
    foodSafetyRules: [],
  };
  return { ...base, ...overrides };
}
```

- [ ] **Step 2 (2–5 min): Write the failing safety and JST tests**

Create `shared/safety/allergens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateAllergens } from "./allergens";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../testing/factories";

const member = {
  ...makeCurrentSafetyContext().members[0],
  allergyStatus: "registered" as const,
  allergenIds: ["egg"],
};
const context = makeCurrentSafetyContext({
  members: [member],
  allergenDictionary: {
    version: "jp-caa-2026-04.v1",
    catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
    aliases: [
      { allergenId: "egg", alias: "鶏卵", normalizedAlias: "鶏卵", aliasKind: "derived", requiresLabelConfirmation: false, dictionaryVersion: "jp-caa-2026-04.v1" },
      { allergenId: "egg", alias: "ドレッシング", normalizedAlias: "ドレッシング", aliasKind: "processed", requiresLabelConfirmation: true, dictionaryVersion: "jp-caa-2026-04.v1" },
    ],
  },
});

describe("evaluateAllergens", () => {
  it("rejects a derived allergen in recipe text", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, steps: [{ ...dish.steps[0], instruction: "鶏卵を混ぜる" }] } : dish,
      ),
    });
    expect(evaluateAllergens(menu, context).issues[0]?.code).toBe("direct_allergen_match");
  });

  it("retains source, member, allergen, and dictionary version for processed food", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, ingredients: [{ ...dish.ingredients[0], name: "ドレッシング" }] } : dish,
      ),
    });
    expect(evaluateAllergens(menu, context).labelConfirmations[0]).toMatchObject({
      sourceType: "ingredient",
      allergenId: "egg",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
    });
  });
});
```

Create `shared/safety/food-rules.test.ts`:

```ts
import { expect, it } from "vitest";
import { evaluateFoodSafetyRules } from "./food-rules";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../testing/factories";

it("requires a child shape tag and a selected household constraint tag", () => {
  const context = makeCurrentSafetyContext({
    members: [{
      ...makeCurrentSafetyContext().members[0],
      ageBand: "age_3_5",
      requiredSafetyConstraints: ["cut_small"],
    }],
    foodSafetyRules: [{
      id: "grapes_under_6",
      appliesToAgeBands: ["post_weaning_to_2", "age_3_5"],
      matchTerms: ["ぶどう"],
      ruleKind: "requires_tag",
      requiredSafetyTag: "quarter_round_food",
      userMessage: "ぶどうは4等分する工程が必要です",
      ruleVersion: "jp-caa-child-shape-2026-07.v1",
    }],
  });
  const base = makeValidatedMenu();
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 1 ? { ...dish, ingredients: [{ ...dish.ingredients[0], name: "ぶどう" }] } : dish,
    ),
  });
  expect(evaluateFoodSafetyRules(menu, context).map((issue) => issue.code)).toEqual([
    "required_safety_constraint",
    "age_shape_rule",
  ]);
});

const hardBeanAndReviewedNutRule = {
  id: "hard_beans_and_reviewed_nuts_under_6",
  appliesToAgeBands: ["post_weaning_to_2", "age_3_5"],
  matchTerms: [
    "硬い豆", "かたい豆", "炒り大豆", "煎り大豆", "いり大豆", "乾燥大豆", "節分豆", "豆まき豆",
    "落花生", "ピーナッツ", "ピーナツ", "くるみ", "胡桃", "ウォールナッツ", "アーモンド",
    "カシューナッツ", "ピスタチオ", "マカダミアナッツ",
  ],
  ruleKind: "forbidden",
  requiredSafetyTag: null,
  userMessage: "5歳以下には硬い豆やナッツを使用できません",
  ruleVersion: "jp-caa-child-shape-2026-07.v1",
} as const;

function menuWithNamedIngredient(name: string) {
  const base = makeValidatedMenu();
  return makeValidatedMenu({
    dishes: base.dishes.map((dish, index) => index === 0
      ? { ...dish, ingredients: [{ ...dish.ingredients[0], name }] }
      : dish),
  });
}

function underSixHardParticleContext() {
  const base = makeCurrentSafetyContext();
  return makeCurrentSafetyContext({
    members: [{ ...base.members[0], ageBand: "age_3_5", requiredSafetyConstraints: [] }],
    foodSafetyRules: [hardBeanAndReviewedNutRule],
  });
}

it.each([
  "煎り大豆", "いり大豆", "節分豆", "落花生", "ﾋﾟｰﾅｯﾂ", "胡桃", "アーモンド",
  "カシュー ナッツ", "ピスタチオ", "マカダミア ナッツ",
])("forbids a concrete hard bean or reviewed nut spelling for an under-six target: %s", (name) => {
  expect(evaluateFoodSafetyRules(menuWithNamedIngredient(name), underSixHardParticleContext()))
    .toEqual([expect.objectContaining({ code: "age_shape_rule" })]);
});

it.each(["豆腐", "豆乳", "納豆", "大豆の水煮", "やわらかく煮た大豆"])(
  "does not confuse an explicitly soft bean product with a hard whole bean: %s",
  (name) => {
    expect(evaluateFoodSafetyRules(menuWithNamedIngredient(name), underSixHardParticleContext()))
      .toEqual([]);
  },
);
```

Create `shared/safety/medical-scope.test.ts`:

```ts
import { expect, it } from "vitest";
import { detectUnsupportedMedicalRequest } from "./medical-scope";

it("does not treat ordinary softness as dysphagia care", () => {
  expect(detectUnsupportedMedicalRequest("やわらかめが希望です")).toEqual([]);
  expect(detectUnsupportedMedicalRequest("嚥下調整食にして")).toEqual(["swallowing_concern"]);
  expect(detectUnsupportedMedicalRequest("腎臓病の治療食にして")).toContain("therapeutic_diet");
});
```

Create `shared/safety/fingerprint.test.ts`:

```ts
import { expect, it } from "vitest";
import { createCurrentSafetyFingerprint } from "./fingerprint";
import { makeCurrentSafetyContext } from "../testing/factories";

it("sorts arrays and changes when current safety changes", () => {
  const member = { ...makeCurrentSafetyContext().members[0], allergenIds: ["wheat", "egg"] };
  const first = makeCurrentSafetyContext({ members: [member] });
  const reordered = makeCurrentSafetyContext({ members: [{ ...member, allergenIds: ["egg", "wheat"] }] });
  const changed = makeCurrentSafetyContext({ members: [{ ...member, ageBand: "age_3_5" }] });
  expect(createCurrentSafetyFingerprint(first)).toBe(createCurrentSafetyFingerprint(reordered));
  expect(createCurrentSafetyFingerprint(first)).not.toBe(createCurrentSafetyFingerprint(changed));
});
```

Create `shared/safety/validate-generated-menu.test.ts`:

```ts
import { expect, it } from "vitest";
import { validateGeneratedMenu } from "./validate-generated-menu";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../testing/factories";

it("blocks unconfirmed allergy, unsupported scope, and an unsupported memo", () => {
  const context = makeCurrentSafetyContext({
    requestText: "離乳食にして",
    members: [{
      ...makeCurrentSafetyContext().members[0],
      allergyStatus: "unconfirmed",
      unsupportedDietStatus: "unconfirmed",
    }],
  });
  const result = validateGeneratedMenu(makeValidatedMenu(), makeGenerationContext({ safety: context }));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "allergy_unconfirmed",
      "unsupported_diet_unconfirmed",
      "unsupported_medical_request",
    ]));
  }
});
```

Create `shared/time/jst.test.ts`:

```ts
import { expect, it } from "vitest";
import { getJstDateKey, getNextJstMidnight } from "./jst";

it("uses the Japan date and next midnight across UTC", () => {
  const now = new Date("2026-07-10T15:30:00.000Z");
  expect(getJstDateKey(now)).toBe("2026-07-11");
  expect(getNextJstMidnight(now).toISOString()).toBe("2026-07-11T15:00:00.000Z");
});
```

- [ ] **Step 3 (2–5 min): Run focused safety tests and verify RED**

Run: `docker compose run --rm --no-deps app npx vitest run shared/safety shared/time/jst.test.ts`

Expected: FAIL with module-not-found errors for the six production modules.

- [ ] **Step 4 (2–5 min): Implement current context and full-field allergen scanning**

Create `shared/safety/context.ts`:

```ts
import type {
  AgeBand,
  AllergyStatus,
  RequiredSafetyConstraint,
  UnsupportedDietKind,
  UnsupportedDietStatus,
} from "../contracts/domain";
import type { AllergenDictionary } from "./allergens";
import type { FoodSafetyRule } from "./food-rules";

export type CurrentSafetyMember = {
  householdMemberId: string;
  anonymousRef: string;
  ageBand: AgeBand;
  allergyStatus: AllergyStatus;
  allergenIds: readonly string[];
  hasUnmappedCustomAllergy: boolean;
  requiredSafetyConstraints: readonly RequiredSafetyConstraint[];
  unsupportedDietStatus: UnsupportedDietStatus;
  unsupportedDietKinds: readonly UnsupportedDietKind[];
};

export type CurrentSafetyContext = {
  dictionaryVersion: string;
  foodRuleVersion: string;
  requestText: string;
  members: readonly CurrentSafetyMember[];
  allergenDictionary: AllergenDictionary;
  foodSafetyRules: readonly FoodSafetyRule[];
};
```

Create `shared/safety/allergens.ts`:

```ts
import type {
  MenuLabelConfirmation,
  MenuValidationIssue,
  ValidatedMenu,
} from "../contracts/generation";
import type { CurrentSafetyContext } from "./context";

export type AllergenCatalogEntry = {
  id: string;
  displayName: string;
  catalogVersion: string;
};
export type AllergenAlias = {
  allergenId: string;
  alias: string;
  normalizedAlias: string;
  aliasKind: "direct" | "derived" | "processed";
  requiresLabelConfirmation: boolean;
  dictionaryVersion: string;
};
export type AllergenDictionary = {
  version: string;
  catalog: readonly AllergenCatalogEntry[];
  aliases: readonly AllergenAlias[];
};
export type MenuTextSource = {
  sourceType: MenuLabelConfirmation["sourceType"];
  sourceId: string;
  sourcePath: string;
  text: string;
  dishId: string | null;
  ingredientId: string | null;
};

export function normalizeFoodText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s　、。・,./（）()「」『』]/gu, "");
}

export function collectMenuTextSources(menu: ValidatedMenu): readonly MenuTextSource[] {
  const sources: MenuTextSource[] = [];
  const push = (sourceType: MenuTextSource["sourceType"], sourceId: string,
    sourcePath: string, text: string | null, dishId: string | null,
    ingredientId: string | null) => {
    if (text !== null && text.trim() !== "") {
      sources.push({ sourceType, sourceId, sourcePath, text, dishId, ingredientId });
    }
  };
  menu.dishes.forEach((dish, dishIndex) => {
    push("dish", dish.id, `dishes.${dishIndex}.name`, dish.name, dish.id, null);
    push("dish", dish.id, `dishes.${dishIndex}.description`, dish.description, dish.id, null);
    dish.ingredients.forEach((item, index) => {
      const base = `dishes.${dishIndex}.ingredients.${index}`;
      push("ingredient", item.id, `${base}.name`, item.name, dish.id, item.id);
      push("ingredient", item.id, `${base}.quantityText`, item.quantityText, dish.id, item.id);
      push("ingredient", item.id, `${base}.unit`, item.unit, dish.id, item.id);
    });
    dish.steps.forEach((step, index) => push("recipe_step", step.id,
      `dishes.${dishIndex}.steps.${index}.instruction`, step.instruction, dish.id, null));
  });
  menu.timeline.forEach((step, index) => push("timeline", step.id,
    `timeline.${index}.instruction`, step.instruction, step.dishId, null));
  menu.adaptations.forEach((item, index) => {
    const base = `adaptations.${index}`;
    push("adaptation", item.id, `${base}.portionText`, item.portionText, item.dishId, null);
    push("adaptation", item.id, `${base}.additionalCutting`, item.additionalCutting, item.dishId, null);
    push("adaptation", item.id, `${base}.additionalHeating`, item.additionalHeating, item.dishId, null);
    push("adaptation", item.id, `${base}.additionalSeasoning`, item.additionalSeasoning, item.dishId, null);
    push("adaptation", item.id, `${base}.servingCheck`, item.servingCheck, item.dishId, null);
    item.safetyActions.forEach((action, actionIndex) => push("adaptation", item.id,
      `${base}.safetyActions.${actionIndex}.instruction`, action.instruction,
      action.dishId, action.ingredientId));
  });
  return sources;
}

export function evaluateAllergens(
  menu: ValidatedMenu,
  context: CurrentSafetyContext,
): {
  issues: readonly MenuValidationIssue[];
  labelConfirmations: readonly MenuLabelConfirmation[];
} {
  const sources = collectMenuTextSources(menu);
  const issues: MenuValidationIssue[] = [];
  const confirmations = new Map<string, MenuLabelConfirmation>();
  for (const member of context.members) {
    for (const allergenId of member.allergenIds) {
      const aliases = context.allergenDictionary.aliases.filter((alias) => alias.allergenId === allergenId);
      for (const source of sources) {
        const matched = aliases.filter((alias) =>
          normalizeFoodText(source.text).includes(normalizeFoodText(alias.normalizedAlias)),
        );
        if (matched.some((alias) => !alias.requiresLabelConfirmation)) {
          issues.push({
            code: "direct_allergen_match",
            path: source.sourcePath,
            message: `${member.anonymousRef} の登録アレルゲン ${allergenId} が残っています`,
          });
          continue;
        }
        if (matched.some((alias) => alias.requiresLabelConfirmation)) {
          const confirmation: MenuLabelConfirmation = {
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sourcePath: source.sourcePath,
            allergenId,
            anonymousMemberRef: member.anonymousRef,
            dictionaryVersion: context.dictionaryVersion,
            confirmationStatus: "pending",
          };
          confirmations.set(
            [source.sourceType, source.sourceId, allergenId, member.anonymousRef].join(":"),
            confirmation,
          );
        }
      }
    }
  }
  return { issues, labelConfirmations: [...confirmations.values()] };
}
```

- [ ] **Step 5 (2–5 min): Implement age/shape rules and medical-scope detection**

Create `shared/safety/food-rules.ts`:

```ts
import type { AgeBand } from "../contracts/domain";
import type { MenuValidationIssue, ValidatedMenu } from "../contracts/generation";
import { collectMenuTextSources, normalizeFoodText } from "./allergens";
import type { CurrentSafetyContext } from "./context";

export type FoodSafetyRule = {
  id: string;
  appliesToAgeBands: readonly AgeBand[];
  matchTerms: readonly string[];
  ruleKind: "forbidden" | "requires_tag";
  requiredSafetyTag: string | null;
  userMessage: string;
  ruleVersion: string;
};

export function evaluateFoodSafetyRules(
  menu: ValidatedMenu,
  context: CurrentSafetyContext,
): readonly MenuValidationIssue[] {
  const sources = collectMenuTextSources(menu);
  const issues: MenuValidationIssue[] = [];
  for (const member of context.members) {
    const memberActions = menu.adaptations
      .filter((item) => item.anonymousMemberRef === member.anonymousRef)
      .flatMap((item) => item.safetyActions.map((action) => ({ ...action, adaptation: item })));
    for (const required of member.requiredSafetyConstraints) {
      if (!memberActions.some(({ action }) => action.kind === required)) {
        issues.push({
          code: "required_safety_action",
          path: `members.${member.anonymousRef}.requiredSafetyConstraints`,
          message: `${required} を満たす工程がありません`,
        });
      }
    }
    for (const rule of context.foodSafetyRules) {
      if (!rule.appliesToAgeBands.includes(member.ageBand)) continue;
      const source = sources.find((item) =>
        rule.matchTerms.some((term) =>
          normalizeFoodText(item.text).includes(normalizeFoodText(term)),
        ),
      );
      if (source === undefined) continue;
      const evidence = rule.requiredSafetyTag === null ? null :
        memberActions.find(({ action }) =>
          source.ingredientId !== null &&
          action.kind === rule.requiredSafetyTag &&
          action.dishId === source.dishId &&
          action.ingredientId === source.ingredientId,
        );
      const contradictory = evidence === undefined || evidence === null ? false :
        /丸ごと|切らず|骨付きのまま|硬いまま/u.test([
          source.text, evidence.action.instruction, evidence.adaptation.servingCheck,
        ].join(" "));
      if (rule.ruleKind === "forbidden" || evidence === undefined || evidence === null || contradictory) {
        issues.push({ code: "age_shape_rule", path: source.sourcePath, message: rule.userMessage });
      }
    }
  }
  return issues;
}
```

Create `shared/safety/medical-scope.ts`:

```ts
import type { UnsupportedDietKind } from "../contracts/domain";

const patterns: ReadonlyArray<readonly [UnsupportedDietKind, RegExp]> = [
  ["weaning_food", /離乳食|離乳期|赤ちゃん用/u],
  ["swallowing_concern", /嚥下|えん下|飲み込み|むせ|とろみ食|嚥下調整|刻み食/u],
  ["therapeutic_diet", /治療食|療養食|腎臓病食|糖尿病食|透析食|低たんぱく|医師.{0,12}(指示|制限)/u],
];

export function detectUnsupportedMedicalRequest(text: string): readonly UnsupportedDietKind[] {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}
```

- [ ] **Step 6 (2–5 min): Implement fingerprint, aggregate validation, and JST helpers**

Create `shared/safety/fingerprint.ts`:

```ts
import { createHash } from "node:crypto";
import type { CurrentSafetyContext } from "./context";

export function createCurrentSafetyFingerprint(context: CurrentSafetyContext): string {
  const payload = {
    dictionaryVersion: context.dictionaryVersion,
    foodRuleVersion: context.foodRuleVersion,
    members: [...context.members]
      .map((member) => ({
        householdMemberId: member.householdMemberId,
        anonymousRef: member.anonymousRef,
        ageBand: member.ageBand,
        allergyStatus: member.allergyStatus,
        allergenIds: [...member.allergenIds].sort(),
        hasUnmappedCustomAllergy: member.hasUnmappedCustomAllergy,
        requiredSafetyConstraints: [...member.requiredSafetyConstraints].sort(),
        unsupportedDietStatus: member.unsupportedDietStatus,
        unsupportedDietKinds: [...member.unsupportedDietKinds].sort(),
      }))
      .sort((left, right) => left.householdMemberId.localeCompare(right.householdMemberId)),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
```

Create `shared/safety/validate-generated-menu.ts`:

```ts
import {
  type MenuLabelConfirmation,
  type MenuValidationIssue,
  type MenuValidationResult,
  generatedMenuSchema,
} from "../contracts/generation";
import { evaluateAllergens } from "./allergens";
import type { GenerationContext } from "./generation-context";
import { createCurrentSafetyFingerprint } from "./fingerprint";
import { evaluateFoodSafetyRules } from "./food-rules";
import { detectUnsupportedMedicalRequest } from "./medical-scope";

const confirmationKey = (item: MenuLabelConfirmation): string =>
  [item.sourceType, item.sourceId, item.allergenId, item.anonymousMemberRef, item.dictionaryVersion].join(":");

export function validateGeneratedMenu(menu: unknown, context: GenerationContext): MenuValidationResult {
  const parsed = generatedMenuSchema.safeParse(menu);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid_menu_structure",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const issues: MenuValidationIssue[] = [];
  for (const member of context.safety.members) {
    if (member.allergyStatus === "unconfirmed") {
      issues.push({ code: "allergy_unconfirmed", path: member.anonymousRef, message: "アレルギー確認が必要です" });
    }
    if (member.allergyStatus === "registered" && member.allergenIds.length === 0) {
      issues.push({ code: "allergen_missing", path: member.anonymousRef, message: "登録アレルゲンを選んでください" });
    }
    if (member.hasUnmappedCustomAllergy) {
      issues.push({ code: "unmapped_custom_allergy", path: member.anonymousRef, message: "自由登録アレルギーを固定候補へ対応付けできません" });
    }
    if (member.unsupportedDietStatus === "unconfirmed") {
      issues.push({ code: "unsupported_diet_unconfirmed", path: member.anonymousRef, message: "対象外条件の確認が必要です" });
    }
    if (member.unsupportedDietStatus === "present") {
      issues.push({ code: "unsupported_diet_present", path: member.anonymousRef, message: "対象外条件のあるメンバーは対象にできません" });
    }
  }
  for (const kind of detectUnsupportedMedicalRequest(context.safety.requestText)) {
    issues.push({ code: "unsupported_medical_request", path: "requestText", message: `${kind} には対応していません` });
  }
  const allergenResult = evaluateAllergens(parsed.data, context.safety);
  issues.push(...allergenResult.issues, ...evaluateFoodSafetyRules(parsed.data, context.safety));
  const emitted = new Set(parsed.data.labelConfirmations.map(confirmationKey));
  for (const required of allergenResult.labelConfirmations) {
    if (!emitted.has(confirmationKey(required))) {
      issues.push({ code: "missing_label_confirmation", path: required.sourcePath, message: "加工品のラベル確認が不足しています" });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    menu: parsed.data,
    labelConfirmations: allergenResult.labelConfirmations,
    safetyFingerprint: createCurrentSafetyFingerprint(context.safety),
  };
}

export type { GenerationContext } from "./generation-context";
export type { CurrentSafetyContext, CurrentSafetyMember } from "./context";
export type { MenuValidationIssue, MenuValidationResult } from "../contracts/generation";
```

Create `shared/time/jst.ts`:

```ts
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getJstDateKey(now: Date): string {
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getNextJstMidnight(now: Date): Date {
  return new Date(`${getJstDateKey(now)}T15:00:00.000Z`);
}
```

- [ ] **Step 7 (2–5 min): Run all safety tests and typecheck for GREEN**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/safety shared/time/jst.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

Expected: Vitest reports 7 passed tests; typecheck exits 0.

- [ ] **Step 8 (2–5 min): Commit deterministic safety validation**

```bash
git add shared/safety shared/time shared/testing/factories.ts
git commit -m "feat: add deterministic menu safety validation"
```

## Task 6: Pantry CRUD UI

**Files:**
- Create: `src/features/pantry/pantry-api.ts`
- Test: `src/features/pantry/pantry-api.test.ts`
- Create: `src/features/pantry/pantry-form.tsx`
- Create: `src/features/pantry/pantry-page.tsx`
- Test: `src/features/pantry/pantry-page.test.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: Task 2 `pantry_items`; Task 4 `PantryItem`/`PantryItemInput`; Plan 1 `useAuth()`, `getBrowserSupabaseClient()`, and `AppShell`.
- Produces: `pantryKeys.list(userId)`, `listPantryItems`, `createPantryItem`, optimistic-concurrency-safe `updatePantryItem` / `deletePantryItem`, `PantryVersionConflictError`, and the `/pantry` route. Every update/delete caller must pass the `updatedAt` value from the row currently rendered to the user; no last-write-wins pantry mutation is allowed.

- [ ] **Step 1 (2–5 min): Write the failing pantry component test**

Create `src/features/pantry/pantry-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import { PantryPageContent } from "./pantry-page";

const expired: PantryItem = {
  id: "60000000-0000-0000-0000-000000000001",
  userId: "61000000-0000-0000-0000-000000000001",
  name: "牛乳",
  quantity: 500,
  unit: "ml",
  expiresOn: "2026-07-10",
  expirationType: "use_by",
  openedState: "opened",
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

it("shows entered expiry/open state and confirms before deletion", async () => {
  const user = userEvent.setup();
  const onDelete = vi.fn();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <PantryPageContent
      items={[expired]}
      loading={false}
      saving={false}
      error={null}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={onDelete}
    />,
  );
  expect(screen.getByText("消費期限 2026-07-10")).toBeInTheDocument();
  expect(screen.getByText("開封済み")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "牛乳を削除" }));
  expect(onDelete).toHaveBeenCalledWith(expired.id, expired.updatedAt);
});
```

Add an API test that updates and deletes with `.eq("updated_at", expectedUpdatedAt)`, returns the newly written row on success, and maps a successful zero-row response to `PantryVersionConflictError` with `code === "pantry_version_conflict"`. The page test opens `牛乳を編集`, changes its quantity, and asserts `onUpdate(expired.id, expired.updatedAt, input)`; a simulated conflict keeps the editor open, reloads the list, and displays `冷蔵庫の内容が変わりました。最新の内容を確認してください`.

- [ ] **Step 2 (2–5 min): Run the test and verify RED**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pantry/pantry-api.test.ts src/features/pantry/pantry-page.test.tsx`

Expected: FAIL with missing `pantry-api` / `pantry-page` modules.

- [ ] **Step 3 (2–5 min): Implement typed pantry CRUD**

Create `src/features/pantry/pantry-api.ts`:

```ts
import {
  type PantryItem,
  type PantryItemInput,
  pantryItemSchema,
} from "@shared/contracts/pantry";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables } from "@/shared/types/database.generated";

export const pantryKeys = {
  all: ["pantry"] as const,
  list: (userId: string) => ["pantry", userId] as const,
};

function mapRow(row: Tables<"pantry_items">): PantryItem {
  return pantryItemSchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    expiresOn: row.expires_on,
    expirationType: row.expiration_type,
    openedState: row.opened_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function writeRow(userId: string, input: PantryItemInput) {
  return {
    user_id: userId,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    expires_on: input.expiresOn,
    expiration_type: input.expirationType,
    opened_state: input.openedState,
  };
}

export async function listPantryItems(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PantryItem[]> {
  const { data, error } = await client
    .from("pantry_items")
    .select("*")
    .eq("user_id", userId)
    .order("expires_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error !== null) throw new Error("冷蔵庫の食材を読み込めませんでした");
  return data.map(mapRow);
}

export async function createPantryItem(
  client: BrowserSupabaseClient,
  userId: string,
  input: PantryItemInput,
): Promise<PantryItem> {
  const { data, error } = await client
    .from("pantry_items")
    .insert(writeRow(userId, input))
    .select("*")
    .single();
  if (error !== null) throw new Error("食材を追加できませんでした");
  return mapRow(data);
}

export async function updatePantryItem(
  client: BrowserSupabaseClient,
  userId: string,
  itemId: string,
  expectedUpdatedAt: string,
  input: PantryItemInput,
): Promise<PantryItem> {
  const { data, error } = await client
    .from("pantry_items")
    .update(writeRow(userId, input))
    .eq("id", itemId)
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error !== null) throw new Error("食材を更新できませんでした");
  if (data === null) throw new PantryVersionConflictError();
  return mapRow(data);
}

export class PantryVersionConflictError extends Error {
  readonly code = "pantry_version_conflict" as const;
  constructor() {
    super("冷蔵庫の内容が変わりました。最新の内容を確認してください");
    this.name = "PantryVersionConflictError";
  }
}

export async function deletePantryItem(
  client: BrowserSupabaseClient,
  userId: string,
  itemId: string,
  expectedUpdatedAt: string,
): Promise<void> {
  const { data, error } = await client.from("pantry_items").delete()
    .eq("id", itemId).eq("user_id", userId).eq("updated_at", expectedUpdatedAt)
    .select("id").maybeSingle();
  if (error !== null) throw new Error("食材を削除できませんでした");
  if (data === null) throw new PantryVersionConflictError();
}
```

- [ ] **Step 4 (2–5 min): Implement the accessible pantry form**

Create `src/features/pantry/pantry-form.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  type PantryItemInput,
  expirationTypes,
  openedStates,
  pantryItemInputSchema,
} from "@shared/contracts/pantry";

const defaults: PantryItemInput = {
  name: "",
  quantity: null,
  unit: null,
  expiresOn: null,
  expirationType: null,
  openedState: null,
};

export function PantryForm({
  saving,
  initialValue = defaults,
  title = "食材を追加",
  submitLabel = "追加する",
  onSubmit,
  onCancel,
}: {
  saving: boolean;
  initialValue?: PantryItemInput;
  title?: string;
  submitLabel?: string;
  onSubmit(input: PantryItemInput): Promise<void>;
  onCancel?(): void;
}) {
  const { register, handleSubmit, reset, formState } = useForm<PantryItemInput>({
    resolver: zodResolver(pantryItemInputSchema),
    defaultValues: initialValue,
  });
  return (
    <form
      className="card stack"
      onSubmit={handleSubmit(async (input) => {
        await onSubmit(input);
        reset(initialValue === defaults ? defaults : input);
      })}
    >
      <h2>{title}</h2>
      <label>食材名<input {...register("name")} /></label>
      <div className="field-row">
        <label>分量<input type="number" min="0.001" step="0.001" {...register("quantity", { setValueAs: (value) => value === "" ? null : Number(value) })} /></label>
        <label>単位<input {...register("unit", { setValueAs: (value) => value === "" ? null : value })} /></label>
      </div>
      <label>期限日<input type="date" {...register("expiresOn", { setValueAs: (value) => value === "" ? null : value })} /></label>
      <label>期限の種類
        <select {...register("expirationType", { setValueAs: (value) => value === "" ? null : value })}>
          <option value="">指定なし</option>
          {expirationTypes.map((value) => <option key={value} value={value}>{({ use_by: "消費期限", best_before: "賞味期限", other: "その他", unknown: "不明" })[value]}</option>)}
        </select>
      </label>
      <label>開封状態
        <select {...register("openedState", { setValueAs: (value) => value === "" ? null : value })}>
          <option value="">指定なし</option>
          {openedStates.map((value) => <option key={value} value={value}>{({ unopened: "未開封", opened: "開封済み", unknown: "不明" })[value]}</option>)}
        </select>
      </label>
      {formState.errors.root && <p className="error-message">{formState.errors.root.message}</p>}
      <button className="primary-button" disabled={saving} type="submit">{saving ? "保存中…" : submitLabel}</button>
      {onCancel !== undefined && <button className="text-button" disabled={saving}
        type="button" onClick={onCancel}>キャンセル</button>}
    </form>
  );
}
```

- [ ] **Step 5 (2–5 min): Implement the query-backed page and replace the Plan 1 route element**

Create `src/features/pantry/pantry-page.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PantryItem, PantryItemInput } from "@shared/contracts/pantry";
import { useAuth } from "@/features/auth/auth-provider";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { PantryForm } from "./pantry-form";
import {
  createPantryItem,
  deletePantryItem,
  listPantryItems,
  PantryVersionConflictError,
  pantryKeys,
  updatePantryItem,
} from "./pantry-api";

const expiryLabels = { use_by: "消費期限", best_before: "賞味期限", other: "期限", unknown: "期限種別不明" } as const;
const openedLabels = { unopened: "未開封", opened: "開封済み", unknown: "開封状態不明" } as const;

export function PantryPage() {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const client = getBrowserSupabaseClient();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: pantryKeys.list(userId ?? "missing"),
    queryFn: () => listPantryItems(client, userId ?? ""),
    enabled: userId !== undefined,
  });
  const createMutation = useMutation({
    mutationFn: (input: PantryItemInput) => createPantryItem(client, userId ?? "", input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId ?? "") }),
  });
  const updateMutation = useMutation({
    mutationFn: (command: { itemId: string; expectedUpdatedAt: string; input: PantryItemInput }) =>
      updatePantryItem(client, userId ?? "", command.itemId,
        command.expectedUpdatedAt, command.input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId ?? "") }),
    onError: async (error) => {
      if (error instanceof PantryVersionConflictError) {
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId ?? "") });
        await queryClient.refetchQueries({ queryKey: pantryKeys.list(userId ?? ""), exact: true });
      }
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (command: { itemId: string; expectedUpdatedAt: string }) =>
      deletePantryItem(client, userId ?? "", command.itemId, command.expectedUpdatedAt),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId ?? "") }),
    onError: async (error) => {
      if (error instanceof PantryVersionConflictError) {
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId ?? "") });
        await queryClient.refetchQueries({ queryKey: pantryKeys.list(userId ?? ""), exact: true });
      }
    },
  });
  const mutationError = updateMutation.error ?? deleteMutation.error ?? createMutation.error;
  return (
    <PantryPageContent
      items={query.data ?? []}
      loading={query.isPending}
      saving={createMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
      error={query.isError ? "冷蔵庫の食材を読み込めませんでした。通信を確認してください。"
        : mutationError instanceof PantryVersionConflictError ? mutationError.message
        : mutationError !== null ? "保存に失敗しました。通信を確認してください。" : null}
      onCreate={async (input) => { await createMutation.mutateAsync(input); }}
      onUpdate={async (itemId, expectedUpdatedAt, input) => {
        await updateMutation.mutateAsync({ itemId, expectedUpdatedAt, input });
      }}
      onDelete={(itemId, expectedUpdatedAt) =>
        deleteMutation.mutate({ itemId, expectedUpdatedAt })}
    />
  );
}

export function PantryPageContent({
  items, loading, saving, error, onCreate, onUpdate, onDelete,
}: {
  items: readonly PantryItem[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  onCreate(input: PantryItemInput): Promise<void>;
  onUpdate(id: string, expectedUpdatedAt: string, input: PantryItemInput): Promise<void>;
  onDelete(id: string, expectedUpdatedAt: string): void;
}) {
  const [editing, setEditing] = useState<PantryItem | null>(null);
  return (
    <main className="page-frame stack">
      <div><p className="eyebrow">冷蔵庫</p><h1>食材リスト</h1></div>
      <p>期限日は並べ替えと注意表示のための入力です。アプリは食べられるかを判断しません。</p>
      {editing === null ? <PantryForm saving={saving} onSubmit={onCreate} /> :
        <PantryForm key={editing.id} saving={saving} title={`${editing.name}を編集`}
          submitLabel="変更を保存"
          initialValue={{name:editing.name,quantity:editing.quantity,unit:editing.unit,
            expiresOn:editing.expiresOn,expirationType:editing.expirationType,
            openedState:editing.openedState}}
          onSubmit={async(input)=>{await onUpdate(editing.id,editing.updatedAt,input);
            setEditing(null);}}
          onCancel={()=>setEditing(null)} />}
      {error !== null && <p role="alert" className="error-message">{error}</p>}
      {loading && <p>読み込み中…</p>}
      {!loading && items.length === 0 && <p>登録した食材はありません。</p>}
      <ul className="stack" aria-label="冷蔵庫の食材">
        {items.map((item) => (
          <li className="card pantry-card" key={item.id}>
            <h2>{item.name}</h2>
            <p>{item.quantity === null ? "分量未入力" : `${item.quantity}${item.unit}`}</p>
            {item.expiresOn !== null && <p>{item.expirationType === null ? "期限" : expiryLabels[item.expirationType]} {item.expiresOn}</p>}
            {item.openedState !== null && <p>{openedLabels[item.openedState]}</p>}
            <button type="button" aria-label={`${item.name}を編集`}
              onClick={() => setEditing(item)}>編集</button>
            <button
              type="button"
              aria-label={`${item.name}を削除`}
              onClick={() => {
                if (window.confirm("この食材を削除しますか？")) {
                  onDelete(item.id, item.updatedAt);
                }
              }}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

In `src/app/router.tsx`, replace only the existing `/pantry` import/element:

```tsx
import { PantryPage } from "@/features/pantry/pantry-page";

// Existing protected AppShell children:
{ path: "pantry", element: <PantryPage /> }
```

- [ ] **Step 6 (2–5 min): Run component test and quality checks for GREEN**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/pantry/pantry-api.test.ts src/features/pantry/pantry-page.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
```

Expected: API concurrency and component CRUD tests pass; typecheck and lint exit 0.

- [ ] **Step 7 (2–5 min): Commit pantry CRUD**

```bash
git add src/features/pantry src/app/router.tsx
git commit -m "feat: add pantry CRUD"
```

## Task 7: Three-Step Planner, Current Safety Summary, and Server Autosave

**Files:**
- Create: `src/features/planner/planner-api.ts`
- Create: `src/features/planner/use-draft-autosave.ts`
- Create: `src/features/planner/current-safety-summary.tsx`
- Create: `src/features/planner/pantry-selector.tsx`
- Test: `src/features/planner/pantry-selector.test.tsx`
- Create: `src/features/planner/planner-page.tsx`
- Create: `src/features/planner/planner-route.tsx`
- Test: `src/features/planner/planner-api.test.ts`
- Test: `src/features/planner/planner-page.test.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: Task 2 `generation_drafts`; Task 4 planner schemas; Plan 1 `useAuth` and household APIs.
- Produces: `plannerKeys.draft(userId)`, `getPlannerDraft`, `savePlannerDraft`, `deletePlannerDraft`, `useDraftAutosave`, always-visible safety summary, and `/planner`.

- [ ] **Step 1 (2–5 min): Write the failing planner/autosave component test**

Create `src/features/planner/planner-page.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PlannerForm } from "./planner-page";

it("shows safety, captures three basic choices, and autosaves optional conditions", async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={{
        mealType: null,
        mainIngredients: [],
        cuisineGenre: null,
        targetMemberIds: [],
        timeLimitMinutes: null,
        budgetPreference: null,
        avoidIngredients: [],
        memo: "",
        pantrySelections: [],
      }}
      members={[{
        id: "70000000-0000-0000-0000-000000000001",
        label: "member_1",
        ageBandLabel: "大人",
        allergyLabel: "アレルギーなし",
        safetyLabels: ["骨を除く"],
        blocked: false,
      }]}
      saveState="saved"
      onChange={onChange}
    />,
  );
  expect(screen.getByText("現在の家族・安全条件")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "夕食" }));
  await user.type(screen.getByLabelText("メイン食材"), "鶏肉");
  await user.click(screen.getByRole("button", { name: "追加" }));
  await user.click(screen.getByRole("radio", { name: "和食" }));
  await user.click(screen.getByText("追加条件"));
  await user.type(screen.getByLabelText("自由メモ"), "野菜を多めに");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
    memo: "野菜を多めに",
  }));
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
});
```

Create `src/features/planner/planner-api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import { deletePlannerDraft } from "./planner-api";

function clientWithRpc(result: { error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as BrowserSupabaseClient, rpc };
}

describe("deletePlannerDraft", () => {
  it("passes the authoritative revision to the delete RPC", async () => {
    const { client, rpc } = clientWithRpc({ error: null });
    await deletePlannerDraft(client, 7);
    expect(rpc).toHaveBeenCalledWith("delete_generation_draft", {
      p_expected_revision: 7,
    });
  });

  it("maps a stale delete to the shared conflict code", async () => {
    const { client } = clientWithRpc({
      error: { message: "draft_revision_conflict" },
    });
    await expect(deletePlannerDraft(client, 7)).rejects.toMatchObject({
      code: "draft_revision_conflict",
    });
  });
});
```

- [ ] **Step 2 (2–5 min): Run the planner test and verify RED**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/planner/planner-page.test.tsx \
  src/features/planner/planner-api.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
```

Expected: FAIL with `Cannot find module './planner-page'`.

- [ ] **Step 3 (2–5 min): Implement draft read/upsert/delete mapping**

Create `src/features/planner/planner-api.ts`:

```ts
import {
  type PlannerDraft,
  type PlannerDraftInput,
  plannerDraftSchema,
} from "@shared/contracts/planner";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables } from "@/shared/types/database.generated";

export const plannerKeys = {
  draft: (userId: string) => ["planner", "draft", userId] as const,
};

function mapDraft(row: Tables<"generation_drafts">): PlannerDraft {
  return plannerDraftSchema.parse({
    id: row.id,
    userId: row.user_id,
    mealType: row.meal_type,
    mainIngredients: row.main_ingredients,
    cuisineGenre: row.cuisine_genre,
    targetMemberIds: row.target_member_ids,
    timeLimitMinutes: row.time_limit_minutes,
    budgetPreference: row.budget_preference,
    avoidIngredients: row.avoid_ingredients,
    memo: row.memo,
    pantrySelections: row.pantry_selections,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function getPlannerDraft(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PlannerDraft | null> {
  const { data, error } = await client.from("generation_drafts").select("*").eq("user_id", userId).maybeSingle();
  if (error !== null) throw new Error("献立条件の下書きを読み込めませんでした");
  return data === null ? null : mapDraft(data);
}

export async function savePlannerDraft(
  client: BrowserSupabaseClient,
  _userId: string,
  input: PlannerDraftInput,
  revision: number,
): Promise<PlannerDraft> {
  const { data, error } = await client.rpc("save_generation_draft", {
    p_expected_revision: revision,
    p_meal_type: input.mealType,
    p_main_ingredients: input.mainIngredients,
    p_cuisine_genre: input.cuisineGenre,
    p_target_member_ids: input.targetMemberIds,
    p_time_limit_minutes: input.timeLimitMinutes,
    p_budget_preference: input.budgetPreference,
    p_avoid_ingredients: input.avoidIngredients,
    p_memo: input.memo,
    p_pantry_selections: input.pantrySelections,
  });
  if (error?.message.includes("draft_revision_conflict") === true) {
    throw Object.assign(new Error("別の画面で献立条件が更新されました"),
      { code: "draft_revision_conflict" as const });
  }
  if (error !== null || data === null) throw new Error("献立条件を保存できませんでした");
  return mapDraft(data);
}

export async function deletePlannerDraft(
  client: BrowserSupabaseClient,
  expectedRevision: number,
): Promise<void> {
  const { error } = await client.rpc("delete_generation_draft", {
    p_expected_revision: expectedRevision,
  });
  if (error?.message.includes("draft_revision_conflict") === true) {
    throw Object.assign(new Error("別の画面で献立条件が更新されました"), {
      code: "draft_revision_conflict" as const,
    });
  }
  if (error !== null) {
    throw new Error("献立条件の下書きを削除できませんでした");
  }
}
```

生成成功後または明示的破棄のcallerは`deletePlannerDraft(client, draft.revision)`を呼ぶ。`userId`は渡さない。

- [ ] **Step 4 (2–5 min): Implement serialized debounced autosave**

Create `src/features/planner/use-draft-autosave.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";

export type DraftSaveState = "idle" | "saving" | "saved" | "error";
export type DraftAutosaveController = {
  state: DraftSaveState;
  revision: number;
  flush(): Promise<PlannerDraft>;
};

export function useDraftAutosave({
  value,
  enabled,
  initialRevision,
  save,
}: {
  value: PlannerDraftInput;
  enabled: boolean;
  initialRevision: number;
  save(value: PlannerDraftInput, revision: number): Promise<PlannerDraft>;
}): DraftAutosaveController {
  const [state, setState] = useState<DraftSaveState>("idle");
  const [savedRevision,setSavedRevision]=useState(initialRevision);
  const revision = useRef(initialRevision);
  const latest = useRef(value);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const serialized = JSON.stringify(value);
  latest.current=value;

  const enqueue=useCallback((next:PlannerDraftInput):Promise<PlannerDraft>=>{
    setState("saving");
    const operation=queue.current.then(()=>save(next,revision.current));
    queue.current=operation.then((saved)=>{
      revision.current=saved.revision;setSavedRevision(saved.revision);setState("saved");
    },()=>{setState("error");});
    return operation;
  },[save]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void enqueue(value).catch(()=>undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [enabled, enqueue, serialized, value]);

  const flush=useCallback(()=>enqueue(latest.current),[enqueue]);
  return {state,revision:savedRevision,flush};
}
```

- [ ] **Step 5 (2–5 min): Implement one-attempt, one-JST-day expired-item confirmation**

Create `src/features/planner/expired-pantry-checks.ts`:

```ts
import type { PantryItem } from "@shared/contracts/pantry";
import { getJstDateKey } from "@shared/time/jst";

export type ExpiredPantryConfirmation = {
  pantryItemId: string;
  idempotencyKey: string;
  checkedOnJst: string;
};

export function isPastEnteredExpiry(item: PantryItem, now: Date): boolean {
  return item.expiresOn !== null && item.expiresOn < getJstDateKey(now);
}

export function hasCurrentExpiredConfirmation(
  confirmations: readonly ExpiredPantryConfirmation[],
  pantryItemId: string,
  idempotencyKey: string,
  now: Date,
): boolean {
  const checkedOnJst = getJstDateKey(now);
  return confirmations.some(
    (entry) =>
      entry.pantryItemId === pantryItemId &&
      entry.idempotencyKey === idempotencyKey &&
      entry.checkedOnJst === checkedOnJst,
  );
}

export function confirmExpiredPantryItem(
  pantryItemId: string,
  idempotencyKey: string,
  now: Date,
): ExpiredPantryConfirmation {
  return { pantryItemId, idempotencyKey, checkedOnJst: getJstDateKey(now) };
}
```

Create `src/features/planner/pantry-selector.tsx`:

```tsx
import { useEffect, useState } from "react";
import type {
  PantryItem,
  PantrySelectionDraft,
} from "@shared/contracts/pantry";
import {
  confirmExpiredPantryItem,
  hasCurrentExpiredConfirmation,
  isPastEnteredExpiry,
  type ExpiredPantryConfirmation,
} from "./expired-pantry-checks";

export function PantrySelector({
  items,
  selections,
  idempotencyKey,
  now,
  onChange,
}: {
  items: readonly PantryItem[];
  selections: readonly PantrySelectionDraft[];
  idempotencyKey: string;
  now(): Date;
  onChange(value: readonly PantrySelectionDraft[]): void;
}) {
  const [confirmations, setConfirmations] = useState<ExpiredPantryConfirmation[]>([]);
  const [pendingItem, setPendingItem] = useState<PantryItem | null>(null);
  useEffect(() => {
    setConfirmations([]);
    setPendingItem(null);
  }, [idempotencyKey]);
  const select = (item: PantryItem) => {
    if (
      isPastEnteredExpiry(item, now()) &&
      !hasCurrentExpiredConfirmation(confirmations, item.id, idempotencyKey, now())
    ) {
      setPendingItem(item);
      return;
    }
    onChange([...selections, { pantryItemId: item.id, priority: "prefer_use" }]);
  };
  return (
    <section className="card stack" aria-labelledby="pantry-selector-title">
      <h2 id="pantry-selector-title">冷蔵庫から使う食材</h2>
      {items.map((item) => {
        const selected = selections.find((entry) => entry.pantryItemId === item.id);
        return (
          <div key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={selected !== undefined}
                onChange={() =>
                  selected === undefined
                    ? select(item)
                    : onChange(selections.filter((entry) => entry.pantryItemId !== item.id))
                }
              />
              {item.name}
            </label>
            {selected !== undefined && (
              <select
                aria-label={`${item.name}の使い方`}
                value={selected.priority}
                onChange={(event) =>
                  onChange(
                    selections.map((entry) =>
                      entry.pantryItemId === item.id
                        ? { ...entry, priority: event.target.value as "must_use" | "prefer_use" }
                        : entry,
                    ),
                  )
                }
              >
                <option value="must_use">必ず使う</option>
                <option value="prefer_use">使えれば使う</option>
              </select>
            )}
          </div>
        );
      })}
      {pendingItem !== null && (
        <div role="alertdialog" aria-label="期限を過ぎた食材の確認">
          <p>入力した期限を過ぎています。アプリは食べられるか判断しません。今回、実物の状態を確認しましたか？</p>
          <button
            type="button"
            onClick={() => {
              setConfirmations((current) => [
                ...current,
                confirmExpiredPantryItem(pendingItem.id, idempotencyKey, now()),
              ]);
              onChange([
                ...selections,
                { pantryItemId: pendingItem.id, priority: "prefer_use" },
              ]);
              setPendingItem(null);
            }}
          >
            実物を確認して今回だけ選ぶ
          </button>
          <button type="button" onClick={() => setPendingItem(null)}>選ばない</button>
        </div>
      )}
    </section>
  );
}
```

Append this test to `src/features/planner/planner-page.test.tsx`:

```tsx
import { PantrySelector } from "./pantry-selector";

it("does not persist or carry an expired-item confirmation to another key", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const item = {
    id: "71000000-0000-0000-0000-000000000001",
    userId: "72000000-0000-0000-0000-000000000001",
    name: "豆腐",
    quantity: 1,
    unit: "丁",
    expiresOn: "2026-07-10",
    expirationType: "use_by",
    openedState: "unopened",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  } as const;
  const view = render(
    <PantrySelector items={[item]} selections={[]} idempotencyKey="73000000-0000-0000-0000-000000000001" now={() => new Date("2026-07-11T03:00:00Z")} onChange={onChange} />,
  );
  await user.click(screen.getByRole("checkbox", { name: "豆腐" }));
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }));
  expect(onChange).toHaveBeenLastCalledWith([
    { pantryItemId: item.id, priority: "prefer_use" },
  ]);
  view.rerender(
    <PantrySelector items={[item]} selections={[]} idempotencyKey="73000000-0000-0000-0000-000000000002" now={() => new Date("2026-07-11T03:00:00Z")} onChange={onChange} />,
  );
  await user.click(screen.getByRole("checkbox", { name: "豆腐" }));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});
```

- [ ] **Step 6 (2–5 min): Implement the always-visible safety summary**

Create `src/features/planner/current-safety-summary.tsx`:

```tsx
export type PlannerSafetyMember = {
  id: string;
  label: string;
  ageBandLabel: string;
  allergyLabel: string;
  safetyLabels: readonly string[];
  blocked: boolean;
};

export function CurrentSafetySummary({
  members,
}: {
  members: readonly PlannerSafetyMember[];
}) {
  return (
    <section className="card stack" aria-labelledby="current-safety-title">
      <h2 id="current-safety-title">現在の家族・安全条件</h2>
      {members.map((member) => (
        <div key={member.id}>
          <strong>{member.label}</strong>
          <p>{member.ageBandLabel}・{member.allergyLabel}</p>
          {member.safetyLabels.length > 0 && <p>{member.safetyLabels.join("、")}</p>}
          {member.blocked && <p role="alert">確認が完了するまで、このメンバーを含む献立は作れません。</p>}
        </div>
      ))}
      <a href="/settings">家族設定を変更</a>
      <p>AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。</p>
    </section>
  );
}
```

- [ ] **Step 7 (2–5 min): Implement the three-step form and optional fields**

Create `src/features/planner/planner-page.tsx` with this complete form component; the route wrapper loads `getPlannerDraft` and Plan 1 `listHouseholdMembers`, maps age/status labels, calls `useDraftAutosave`, and passes those values here:

```tsx
import { useState } from "react";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import { detectUnsupportedMedicalRequest } from "@shared/safety/medical-scope";
import {
  CurrentSafetySummary,
  type PlannerSafetyMember,
} from "./current-safety-summary";

const mealLabels = { breakfast: "朝食", lunch: "昼食", dinner: "夕食" } as const;
const genreLabels = { japanese: "和食", western: "洋食", chinese: "中華", any: "おまかせ" } as const;

export function PlannerForm({
  initialValue,
  members,
  saveState,
  onChange,
}: {
  initialValue: PlannerDraftInput;
  members: readonly PlannerSafetyMember[];
  saveState: "idle" | "saving" | "saved" | "error";
  onChange(value: PlannerDraftInput): void;
}) {
  const [value, setValue] = useState(initialValue);
  const [ingredient, setIngredient] = useState("");
  const update = (patch: Partial<PlannerDraftInput>) => {
    const next = { ...value, ...patch };
    setValue(next);
    onChange(next);
  };
  const medicalMatches = detectUnsupportedMedicalRequest(value.memo);
  const blocked = members.some((member) => member.blocked) || medicalMatches.length > 0;
  return (
    <main className="page-frame stack">
      <div><p className="eyebrow">献立</p><h1>3ステップで献立を決める</h1></div>
      <CurrentSafetySummary members={members} />
      <section className="card"><h2>1. 食事</h2>
        {Object.entries(mealLabels).map(([key, label]) => (
          <label key={key}><input type="radio" name="meal" checked={value.mealType === key} onChange={() => update({ mealType: key as PlannerDraftInput["mealType"] })} />{label}</label>
        ))}
      </section>
      <section className="card"><h2>2. メイン食材</h2>
        <label>メイン食材<input value={ingredient} maxLength={80} onChange={(event) => setIngredient(event.target.value)} /></label>
        <button type="button" onClick={() => { const next = ingredient.trim(); if (next !== "" && !value.mainIngredients.includes(next)) update({ mainIngredients: [...value.mainIngredients, next] }); setIngredient(""); }}>追加</button>
        <div>{value.mainIngredients.map((item) => <button type="button" key={item} onClick={() => update({ mainIngredients: value.mainIngredients.filter((value) => value !== item) })}>{item}を外す</button>)}</div>
      </section>
      <section className="card"><h2>3. ジャンル</h2>
        {Object.entries(genreLabels).map(([key, label]) => (
          <label key={key}><input type="radio" name="genre" checked={value.cuisineGenre === key} onChange={() => update({ cuisineGenre: key as PlannerDraftInput["cuisineGenre"] })} />{label}</label>
        ))}
      </section>
      <details className="card"><summary>追加条件</summary>
        <label>献立全体の調理時間<select value={value.timeLimitMinutes ?? ""} onChange={(event) => update({ timeLimitMinutes: event.target.value === "" ? null : Number(event.target.value) as 15 | 30 | 45 })}><option value="">指定なし</option><option value="15">15分以内</option><option value="30">30分以内</option><option value="45">45分以内</option></select></label>
        <label>予算<select value={value.budgetPreference ?? ""} onChange={(event) => update({ budgetPreference: event.target.value === "" ? null : event.target.value as "economy" | "standard" })}><option value="">指定なし</option><option value="economy">節約優先</option><option value="standard">標準</option></select></label>
        <label>今回だけ避ける食材<input value={value.avoidIngredients.join("、")} onChange={(event) => update({ avoidIngredients: event.target.value.split(/[、,]/u).map((item) => item.trim()).filter(Boolean) })} /></label>
        <label>自由メモ<textarea maxLength={200} value={value.memo} onChange={(event) => update({ memo: event.target.value })} /></label>
        <p>{value.memo.length}/200</p>
        <p>「やわらかめ」は一般的な食べやすさの希望です。嚥下調整食ではありません。</p>
      </details>
      {medicalMatches.length > 0 && <p role="alert">離乳食、飲み込み・嚥下、治療食の依頼には対応できません。専門職の指示に従ってください。</p>}
      <p aria-live="polite">{({ idle: "", saving: "保存中…", saved: "保存済み", error: "保存失敗。通信復帰後に再保存します。" })[saveState]}</p>
      <button className="primary-button" type="button" disabled={blocked || value.mealType === null || value.mainIngredients.length === 0 || value.cuisineGenre === null || value.targetMemberIds.length === 0}>献立を作る</button>
      <a href="/emergency-menus">AIを使わない緊急献立を見る</a>
    </main>
  );
}
```

Create `src/features/planner/planner-route.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import { useAuth } from "@/features/auth/auth-provider";
import { listHouseholdMembers } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { getPlannerDraft, plannerKeys, savePlannerDraft } from "./planner-api";
import type { PlannerSafetyMember } from "./current-safety-summary";
import { PlannerForm } from "./planner-page";
import { useDraftAutosave } from "./use-draft-autosave";

const emptyDraft: PlannerDraftInput = { mealType: null, mainIngredients: [], cuisineGenre: null, targetMemberIds: [], timeLimitMinutes: null, budgetPreference: null, avoidIngredients: [], memo: "", pantrySelections: [] };
const ageLabels = { post_weaning_to_2: "離乳食完了後〜2歳", age_3_5: "3〜5歳", age_6_8: "6〜8歳", age_9_12: "9〜12歳", age_13_17: "13〜17歳", adult: "大人", senior: "高齢者" } as const;

export function PlannerPage() {
  const userId = useAuth().session?.user.id;
  const client = getBrowserSupabaseClient();
  const draftQuery = useQuery({ queryKey: plannerKeys.draft(userId ?? "missing"), queryFn: () => getPlannerDraft(client, userId ?? ""), enabled: userId !== undefined });
  const membersQuery = useQuery({ queryKey: householdKeys.members(userId ?? "missing"), queryFn: () => listHouseholdMembers(client, userId ?? ""), enabled: userId !== undefined });
  const [value, setValue] = useState<PlannerDraftInput>(emptyDraft);
  useEffect(() => {
    if (draftQuery.data !== undefined) {
      const complete = (membersQuery.data ?? []).filter((member) => member.status === "complete");
      setValue(draftQuery.data ?? { ...emptyDraft, targetMemberIds: complete.filter((member) => member.allergy_status !== "unconfirmed" && member.unsupported_diet_status === "none").map((member) => member.id) });
    }
  }, [draftQuery.data, membersQuery.data]);
  const save = useCallback((next: PlannerDraftInput, revision: number) => savePlannerDraft(client, userId ?? "", next, revision), [client, userId]);
  const autosave = useDraftAutosave({ value, enabled: userId !== undefined && draftQuery.data !== undefined, initialRevision: draftQuery.data?.revision ?? 0, save });
  if (draftQuery.isPending || membersQuery.isPending) return <main className="page-frame"><p>献立条件を読み込み中…</p></main>;
  if (draftQuery.isError || membersQuery.isError) return <main className="page-frame"><p role="alert">献立条件を読み込めませんでした。再読み込みしてください。</p></main>;
  const members: PlannerSafetyMember[] = (membersQuery.data ?? []).filter((member) => member.status === "complete").map((member, index) => ({
    id: member.id,
    label: member.display_name?.trim() || `member_${index + 1}`,
    ageBandLabel: member.age_band === null ? "年齢未確認" : ageLabels[member.age_band],
    allergyLabel: member.allergy_status === "none" ? "アレルギーなし" : member.allergy_status === "registered" ? "登録アレルギーあり" : "アレルギー未確認",
    safetyLabels: member.required_safety_constraints.map((value) => value === "remove_bones" ? "骨を除く" : "小さく切る"),
    blocked: member.allergy_status === "unconfirmed" || member.unsupported_diet_status !== "none",
  }));
  return <PlannerForm initialValue={value} members={members} saveState={autosave.state} onChange={setValue} />;
}
```

In `src/app/router.tsx` replace the existing `/planner` element:

```tsx
import { PlannerPage } from "@/features/planner/planner-route";
{ path: "planner", element: <PlannerPage /> }
```

- [ ] **Step 8 (2–5 min): Run planner tests and quality checks for GREEN**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/planner/planner-page.test.tsx \
  src/features/planner/planner-api.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
```

Expected: component test passes; typecheck and lint exit 0.

- [ ] **Step 9 (2–5 min): Commit planner autosave and safety summary**

```bash
git add src/features/planner src/app/router.tsx
git commit -m "feat: add autosaved three-step planner"
```

## Task 8: Authenticated Deterministic Emergency Menus and Empty-State UI

**Files:**
- Modify: `netlify/functions/_shared/env.ts`
- Modify: `netlify/functions/_shared/env.test.ts`
- Modify: `netlify/functions/_shared/supabase-admin.ts`
- Modify: `netlify/functions/_shared/http.ts`
- Modify: `netlify/functions/_shared/http.test.ts`
- Create: `netlify/functions/_shared/auth.ts`
- Create: `netlify/functions/_shared/current-safety.ts`
- Test: `netlify/functions/_shared/current-safety.test.ts`
- Create: `shared/emergency/fixtures.v1.ts`
- Create: `shared/emergency/filter-emergency-menus.ts`
- Test: `shared/emergency/filter-emergency-menus.test.ts`
- Create: `netlify/functions/emergency-menus.ts`
- Test: `netlify/functions/emergency-menus.test.ts`
- Create: `src/features/emergency/emergency-menu-api.ts`
- Test: `src/features/emergency/emergency-menu-api.test.ts`
- Create: `src/features/emergency/emergency-menu-page.tsx`
- Test: `src/features/emergency/emergency-menu-page.test.tsx`
- Modify: `src/app/router.tsx`
- Modify: `netlify.toml`

**Interfaces:**
- Consumes: Plan 1 `Database`/`requireAccessToken`, household data, and the existing continuation-safe `_shared/env`, `_shared/http`, `_shared/supabase-admin`; Tasks 1/5 catalogs and `validateGeneratedMenu`.
- Produces: extensions to the single shared HTTP/env/admin boundary (never replacement schemas), `requireUser`, `loadCurrentSafetyContext`, `loadEmergencyCurrentSafety`, complete emergency fixtures/filter, `EmergencyMenuCandidate` / `EmergencyLabelWarning` / `EmergencyMenusData`, and authenticated `GET /api/emergency-menus`. Each response captures owner-verified live member names into immutable response snapshots with `家族N` fallback and resolves label source/allergen/member names server-side; no browser view derives copy from an anonymous ref, allergen ID, UUID, or source path. Continuation encryption/origin fields and tests remain intact. It consumes no privacy consent and no AI quota.

- [ ] **Step 1 (2–5 min): Write failing filter, handler, and empty-state tests**

Create `shared/emergency/filter-emergency-menus.test.ts`:

```ts
import { expect, it } from "vitest";
import { makeCurrentSafetyContext } from "../testing/factories";
import { filterEmergencyMenus } from "./filter-emergency-menus";

it("does not relax an unconfirmed or unmapped current safety condition", () => {
  const result = filterEmergencyMenus({
    mealType: "dinner",
    pantryNames: [],
    context: makeCurrentSafetyContext({
      members: [{
        ...makeCurrentSafetyContext().members[0],
        allergyStatus: "unconfirmed",
        hasUnmappedCustomAllergy: true,
      }],
    }),
  });
  expect(result).toEqual({ menus: [], emptyReason: "current_safety_unavailable" });
});
```

Create `netlify/functions/emergency-menus.test.ts`:

```ts
import { expect, it } from "vitest";
import { makeCurrentSafetyContext } from "../../shared/testing/factories";
import { createEmergencyMenusHandler } from "./emergency-menus";

it("returns an authenticated explicit no-candidate response without quota use", async () => {
  const handler = createEmergencyMenusHandler({
    authenticate: async () => ({ userId: "80000000-0000-0000-0000-000000000001" }),
    loadContext: async () => ({
      context: makeCurrentSafetyContext({
        members: [{
          ...makeCurrentSafetyContext().members[0],
          unsupportedDietStatus: "present",
          unsupportedDietKinds: ["therapeutic_diet"],
        }],
      }),
      memberLabels: { member_1: "家族1" },
    }),
    loadPantryNames: async () => [],
  });
  const response = await handler(new Request(
    "http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=81000000-0000-0000-0000-000000000001",
  ));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    data: {
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
    },
  });
});
```

Create `src/features/emergency/emergency-menu-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { EmergencyMenuContent } from "./emergency-menu-page";

it("states that no candidate exists without suggesting weaker safety conditions", () => {
  render(
    <EmergencyMenuContent
      loading={false}
      error={null}
      response={{
        fixtureVersion: "2026-07-11.v1",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
      }}
    />,
  );
  expect(screen.getByText("条件に合う緊急献立がありません")).toBeInTheDocument();
  expect(screen.getByText("条件を緩めず、候補を表示していません。")).toBeInTheDocument();
  expect(screen.queryByText(/安全確認済み/u)).not.toBeInTheDocument();
});
```

Add a second component test with one reviewed candidate targeting `member_1`. It asserts the DOM exposes, in this order, total time/servings, the complete integrated timeline, every dish, every ingredient and quantity, numbered recipe steps, `子ども`-named portion/adaptation and structured action, pantry used/unused/shortage copy, and `カレールー・小麦・子ども` label-warning copy. It asserts `member_1`, raw allergen IDs, UUIDs, and `dishes.0.ingredients.0.name` are absent. The candidate `<details open>` summary is keyboard-toggleable and all content fits 320 CSS pixels.

Add `emergency-menu-api.test.ts` with a mocked authenticated fetch. A complete envelope with server-provided `memberLabels` plus human `sourceDisplayName`/`allergenDisplayName`/`memberDisplayName` parses; a candidate that has only an anonymous ref, catalog ID, or source path and omits any human display field is rejected before rendering.

Add `_shared/current-safety.test.ts` now with a fluent admin-client fake. It covers owner filtering and requested order, then changes the same member's live display name between calls and proves the first returned label snapshot does not change. It also covers blank-name `家族1` fallback and missing, foreign, or draft target failure.

- [ ] **Step 2 (2–5 min): Run the focused tests and verify RED**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency netlify/functions/_shared/current-safety.test.ts netlify/functions/emergency-menus.test.ts src/features/emergency/emergency-menu-api.test.ts src/features/emergency/emergency-menu-page.test.tsx`

Expected: FAIL with module-not-found errors for the emergency filter, Function, and page.

- [ ] **Step 3 (2–5 min): Implement the final server env, HTTP, admin, and auth boundary**

Retain Plan 1's complete continuation schema, including `AUTH_CONTINUATION_TTL_SECONDS`, and append only a narrowed Supabase projection for non-continuation handlers. Extend `env.test.ts` to prove the projection and that every continuation field still parses:

```ts
// Append below Plan 1's continuationServerEnvSchema/getServerEnv exports.
export const supabaseServerEnvSchema = continuationServerEnvSchema.pick({
  SUPABASE_URL: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});
export type SupabaseServerEnv = z.infer<typeof supabaseServerEnvSchema>;
export function getSupabaseServerEnv(): SupabaseServerEnv {
  return supabaseServerEnvSchema.parse(getServerEnv());
}
```

Extend Plan 1's `netlify/functions/_shared/supabase-admin.ts`; keep one cached admin client:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/shared/types/database.generated";
import { getSupabaseServerEnv } from "./env";

export type AdminSupabaseClient = SupabaseClient<Database>;
let cached: AdminSupabaseClient | undefined;
export function getSupabaseAdmin(): AdminSupabaseClient {
  if (cached !== undefined) return cached;
  const env = getSupabaseServerEnv();
  cached = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

Extend Plan 1's `netlify/functions/_shared/http.ts` with the generic API helpers and body cap:

```ts
import { z } from "zod";
import type { ApiResponse } from "../../../shared/contracts/http";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
export function json<T>(status: number, body: ApiResponse<T>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
export function methodNotAllowed(allowed: readonly string[]): Response {
  return new Response(JSON.stringify({
    ok: false,
    error: { code: "method_not_allowed", message: "この操作方法は利用できません" },
  } satisfies ApiResponse<never>), {
    status: 405,
    headers: { "content-type": "application/json", allow: allowed.join(", "), "cache-control": "no-store" },
  });
}
export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > 65_536) {
      throw new HttpError(413, "request_too_large", "入力が大きすぎます");
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 65_536) {
      throw new HttpError(413, "request_too_large", "入力が大きすぎます");
    }
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "JSONを読み取れません");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_request", "入力内容を確認してください", {
      fields: z.flattenError(parsed.error).fieldErrors,
    });
  }
  return parsed.data;
}
export function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(error.status, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }
  return json(500, {
    ok: false,
    error: { code: "request_failed", message: "処理を完了できませんでした" },
  });
}
```

Create `netlify/functions/_shared/auth.ts`:

```ts
import { HttpError } from "./http";
import { getSupabaseAdmin } from "./supabase-admin";

export async function requireUser(
  request: Request,
): Promise<{ userId: string; accessToken: string }> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "auth_required", "ログインが必要です");
  }
  const accessToken = authorization.slice("Bearer ".length).trim();
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  if (error !== null || data.user === null) {
    throw new HttpError(401, "auth_required", "ログインが必要です");
  }
  return { userId: data.user.id, accessToken };
}
```

- [ ] **Step 4 (2–5 min): Add the reviewed fixture and deterministic safety filter**

Create `shared/emergency/fixtures.v1.ts`:

```ts
import type { AgeBand } from "../contracts/domain";
import type { ValidatedMenu } from "../contracts/generation";

export const emergencyFixtureVersion = "2026-07-11.v1" as const;
export const emergencyMenuFixturesV1: readonly ValidatedMenu[] = [{
  schemaVersion: "2026-07-11.v1",
  menuId: "82000000-0000-0000-0000-000000000001",
  mealType: "dinner",
  cuisineGenre: "japanese",
  servings: 2,
  totalElapsedMinutes: 15,
  safetyTags: [],
  dishes: [
    {
      id: "82100000-0000-0000-0000-000000000001", role: "main", position: 1,
      name: "鶏肉とキャベツの塩蒸し", description: "フライパンで蒸す主菜", cookingTimeMinutes: 12,
      ingredients: [
        { id: "82200000-0000-0000-0000-000000000001", position: 1, name: "鶏肉", quantityValue: 250, quantityText: "250g", unit: "g", storeSection: "meat_fish", pantrySelectionId: null, labelConfirmationRequired: false },
        { id: "82200000-0000-0000-0000-000000000002", position: 2, name: "キャベツ", quantityValue: 0.25, quantityText: "1/4個", unit: "個", storeSection: "produce", pantrySelectionId: null, labelConfirmationRequired: false },
        { id: "82200000-0000-0000-0000-000000000003", position: 3, name: "塩", quantityValue: null, quantityText: "少々", unit: null, storeSection: "seasonings", pantrySelectionId: null, labelConfirmationRequired: false },
      ],
      steps: [
        { id: "82300000-0000-0000-0000-000000000001", position: 1, instruction: "鶏肉を一口大、キャベツを食べやすい大きさに切る" },
        { id: "82300000-0000-0000-0000-000000000002", position: 2, instruction: "フライパンに入れて塩を振り、ふたをして中心まで十分に加熱する" },
      ],
    },
    {
      id: "82100000-0000-0000-0000-000000000002", role: "side", position: 2,
      name: "きゅうりの塩もみ", description: "薄切りの副菜", cookingTimeMinutes: 5,
      ingredients: [{ id: "82200000-0000-0000-0000-000000000004", position: 1, name: "きゅうり", quantityValue: 1, quantityText: "1本", unit: "本", storeSection: "produce", pantrySelectionId: null, labelConfirmationRequired: false }],
      steps: [{ id: "82300000-0000-0000-0000-000000000003", position: 1, instruction: "薄切りにして塩でもみ、水気を絞る" }],
    },
    {
      id: "82100000-0000-0000-0000-000000000003", role: "soup", position: 3,
      name: "玉ねぎの塩スープ", description: "短時間で煮る汁物", cookingTimeMinutes: 10,
      ingredients: [{ id: "82200000-0000-0000-0000-000000000005", position: 1, name: "玉ねぎ", quantityValue: 0.5, quantityText: "1/2個", unit: "個", storeSection: "produce", pantrySelectionId: null, labelConfirmationRequired: false }],
      steps: [{ id: "82300000-0000-0000-0000-000000000004", position: 1, instruction: "薄切りの玉ねぎを水でやわらかく煮、塩で味を整える" }],
    },
  ],
  timeline: [
    { id: "82400000-0000-0000-0000-000000000001", position: 1, startMinute: 0, durationMinutes: 3, instruction: "湯を沸かしながら材料を切る", dishId: null, recipeStepId: null },
    { id: "82400000-0000-0000-0000-000000000002", position: 2, startMinute: 3, durationMinutes: 10, instruction: "主菜を蒸し、同時にスープを煮る", dishId: "82100000-0000-0000-0000-000000000001", recipeStepId: "82300000-0000-0000-0000-000000000002" },
    { id: "82400000-0000-0000-0000-000000000003", position: 3, startMinute: 13, durationMinutes: 2, instruction: "副菜の水気を絞って盛り付ける", dishId: "82100000-0000-0000-0000-000000000002", recipeStepId: "82300000-0000-0000-0000-000000000003" },
  ],
  adaptations: [],
  pantryUsage: [],
  labelConfirmations: [],
}];

export const emergencyFixtureMetadataV1: Readonly<Record<string, {
  standardAllergenIds: readonly string[];
  eligibleAgeBands: readonly AgeBand[];
  safetyTags: readonly string[];
  reviewedAt: string;
}>> = {
  "82000000-0000-0000-0000-000000000001": {
    standardAllergenIds: ["chicken"],
    eligibleAgeBands: ["post_weaning_to_2","age_3_5","age_6_8","age_9_12","age_13_17","adult","senior"],
    safetyTags: [],
    reviewedAt: "2026-07-11",
  },
};
```

Create `shared/emergency/filter-emergency-menus.ts`:

```ts
import { z } from "zod";
import type { MealType } from "../contracts/domain";
import {
  labelSourceTypes,
  validatedMenuSchema,
  type ValidatedMenu,
} from "../contracts/generation";
import type { CurrentSafetyContext } from "../safety/context";
import { collectMenuTextSources, normalizeFoodText } from "../safety/allergens";
import { validateGeneratedMenu } from "../safety/validate-generated-menu";
import { emergencyFixtureMetadataV1, emergencyMenuFixturesV1 } from "./fixtures.v1";

export type EmergencyFilterResult = {
  menus: readonly ValidatedMenu[];
  emptyReason: "current_safety_unavailable" | "no_matching_fixture" | null;
};

const memberRef = z.string().regex(/^member_[1-9][0-9]*$/u);
const humanText = z.string().trim().min(1).max(300);
export const emergencyLabelWarningSchema = z.object({
  sourceType: z.enum(labelSourceTypes),
  sourcePath: z.string().trim().min(1).max(200),
  sourceDisplayName: humanText,
  allergenDisplayName: humanText,
  anonymousMemberRef: memberRef,
  memberDisplayName: humanText,
  dictionaryVersion: z.string().trim().min(1).max(80),
  confirmationStatus: z.literal("pending"),
}).strict();
export const emergencyMenuCandidateSchema = z.object({
  menu: validatedMenuSchema,
  memberLabels: z.record(memberRef, humanText),
  labelWarnings: z.array(emergencyLabelWarningSchema).max(200),
}).strict().superRefine((value, context) => {
  const requiredRefs = new Set([
    ...value.menu.adaptations.map((item) => item.anonymousMemberRef),
    ...value.menu.labelConfirmations.map((item) => item.anonymousMemberRef),
  ]);
  for (const ref of requiredRefs) {
    if (value.memberLabels[ref] === undefined) {
      context.addIssue({ code: "custom", path: ["memberLabels", ref],
        message: "対象者の表示名が必要です" });
    }
  }
  if (value.labelWarnings.length !== value.menu.labelConfirmations.length) {
    context.addIssue({ code: "custom", path: ["labelWarnings"],
      message: "すべての原材料表示確認に人向け表示が必要です" });
  }
  const confirmationKeys = value.menu.labelConfirmations.map((item) =>
    [item.sourceType, item.sourcePath, item.anonymousMemberRef, item.dictionaryVersion].join("\u0000"),
  ).toSorted();
  const warningKeys = value.labelWarnings.map((item) =>
    [item.sourceType, item.sourcePath, item.anonymousMemberRef, item.dictionaryVersion].join("\u0000"),
  ).toSorted();
  if (JSON.stringify(confirmationKeys) !== JSON.stringify(warningKeys)) {
    context.addIssue({ code: "custom", path: ["labelWarnings"],
      message: "原材料表示確認の表示元が一致しません" });
  }
  value.labelWarnings.forEach((warning, index) => {
    if (value.memberLabels[warning.anonymousMemberRef] !== warning.memberDisplayName) {
      context.addIssue({ code: "custom", path: ["labelWarnings", index, "memberDisplayName"],
        message: "対象者の表示名が一致しません" });
    }
  });
});
export const emergencyMenusDataSchema = z.object({
  fixtureVersion: z.string().trim().min(1),
  candidates: z.array(emergencyMenuCandidateSchema),
  message: z.string().trim().min(1),
  consumesAiQuota: z.literal(false),
}).strict();
export type EmergencyLabelWarning = z.infer<typeof emergencyLabelWarningSchema>;
export type EmergencyMenuCandidate = z.infer<typeof emergencyMenuCandidateSchema>;
export type EmergencyMenusData = z.infer<typeof emergencyMenusDataSchema>;

export function buildEmergencyMenuCandidate(input: {
  menu: ValidatedMenu;
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
}): EmergencyMenuCandidate {
  const sources = new Map(collectMenuTextSources(input.menu)
    .map((source) => [source.sourcePath, source.text.trim()] as const));
  const allergens = new Map(input.context.allergenDictionary.catalog
    .map((item) => [item.id, item.displayName] as const));
  const labelWarnings = input.menu.labelConfirmations.map((confirmation) => {
    const sourceDisplayName = sources.get(confirmation.sourcePath);
    const allergenDisplayName = allergens.get(confirmation.allergenId);
    const memberDisplayName = input.memberLabels[confirmation.anonymousMemberRef];
    if (!sourceDisplayName || !allergenDisplayName || !memberDisplayName) {
      throw new Error("reviewed_emergency_label_mapping_failed");
    }
    return {
      sourceType: confirmation.sourceType,
      sourcePath: confirmation.sourcePath,
      sourceDisplayName,
      allergenDisplayName,
      anonymousMemberRef: confirmation.anonymousMemberRef,
      memberDisplayName,
      dictionaryVersion: confirmation.dictionaryVersion,
      confirmationStatus: "pending" as const,
    };
  });
  return emergencyMenuCandidateSchema.parse({
    menu: input.menu,
    memberLabels: input.memberLabels,
    labelWarnings,
  });
}

export function filterEmergencyMenus(input: {
  mealType: MealType;
  pantryNames: readonly string[];
  context: CurrentSafetyContext;
}): EmergencyFilterResult {
  if (input.context.members.some((member) =>
    member.allergyStatus === "unconfirmed" ||
    member.hasUnmappedCustomAllergy ||
    member.unsupportedDietStatus !== "none"
  )) return { menus: [], emptyReason: "current_safety_unavailable" };
  const pantry = input.pantryNames.map(normalizeFoodText);
  const menus = emergencyMenuFixturesV1
    .filter((menu) => menu.mealType === input.mealType)
    .filter((menu) => {
      const metadata = emergencyFixtureMetadataV1[menu.menuId];
      return metadata !== undefined &&
        input.context.members.every((member) => metadata.eligibleAgeBands.includes(member.ageBand)) &&
        validateGeneratedMenu(menu, makeGenerationContextForEmergency(input.context)).ok;
    })
    .sort((left, right) => {
      const score = (menu: ValidatedMenu) => collectMenuTextSources(menu)
        .filter((source) => pantry.some((name) => normalizeFoodText(source.text).includes(name))).length;
      return score(right) - score(left) || left.menuId.localeCompare(right.menuId);
    });
  return { menus, emptyReason: menus.length === 0 ? "no_matching_fixture" : null };
}
```

- [ ] **Step 5 (2–5 min): Implement the authoritative current-safety loader**

Create `netlify/functions/_shared/current-safety.ts`. Every admin query includes the verified `userId`; requested IDs that are missing, foreign, or not `complete` produce 400:

```ts
import {
  ageBands,
  allergyStatuses,
  requiredSafetyConstraints,
  unsupportedDietKinds,
  unsupportedDietStatuses,
} from "../../../shared/contracts/domain";
import type { CurrentSafetyContext } from "../../../shared/safety/context";
import { z } from "zod";
import { HttpError } from "./http";
import type { AdminSupabaseClient } from "./supabase-admin";

const ageBandSchema = z.enum(ageBands);
const allergyStatusSchema = z.enum(allergyStatuses);
const requiredSafetyConstraintSchema = z.enum(requiredSafetyConstraints);
const unsupportedDietKindSchema = z.enum(unsupportedDietKinds);
const unsupportedDietStatusSchema = z.enum(unsupportedDietStatuses);
const aliasKindSchema = z.enum(["direct", "derived", "processed"]);
const ruleKindSchema = z.enum(["forbidden", "requires_tag"]);

export async function loadCurrentSafetyContext(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<CurrentSafetyContext> {
  if (targetMemberIds.length === 0) throw new HttpError(400, "target_members_required", "対象メンバーを選んでください");
  const [membersResult, allergiesResult, catalogResult, aliasesResult, rulesResult] = await Promise.all([
    admin.from("household_members").select("*").eq("user_id", userId).eq("status", "complete").in("id", [...targetMemberIds]),
    admin.from("member_allergies").select("*").eq("user_id", userId).in("member_id", [...targetMemberIds]),
    admin.from("allergen_catalog").select("*").eq("catalog_version", "jp-caa-2026-04.v1"),
    admin.from("allergen_aliases").select("*").eq("dictionary_version", "jp-caa-2026-04.v1"),
    admin.from("food_safety_rules").select("*").eq("rule_version", "jp-caa-child-shape-2026-07.v1"),
  ]);
  const firstError = [membersResult.error, allergiesResult.error, catalogResult.error, aliasesResult.error, rulesResult.error].find((error) => error !== null);
  if (firstError !== undefined) throw new HttpError(500, "safety_context_failed", "現在の安全条件を読み込めませんでした");
  const members = membersResult.data ?? [];
  if (members.length !== new Set(targetMemberIds).size) throw new HttpError(400, "invalid_target_members", "対象メンバーを確認してください");
  const allergies = allergiesResult.data ?? [];
  return {
    dictionaryVersion: "jp-caa-2026-04.v1",
    foodRuleVersion: "jp-caa-child-shape-2026-07.v1",
    requestText: "",
    members: targetMemberIds.map((memberId, index) => {
      const member = members.find((row) => row.id === memberId);
      if (member === undefined || member.age_band === null) throw new HttpError(400, "invalid_target_members", "対象メンバーを確認してください");
      const memberAllergies = allergies.filter((row) => row.member_id === memberId);
      return {
        householdMemberId: member.id,
        anonymousRef: `member_${index + 1}`,
        ageBand: ageBandSchema.parse(member.age_band),
        allergyStatus: allergyStatusSchema.parse(member.allergy_status),
        allergenIds: memberAllergies.flatMap((row) => row.allergen_id === null ? [] : [row.allergen_id]),
        hasUnmappedCustomAllergy: memberAllergies.some((row) => row.allergen_id === null),
        requiredSafetyConstraints: z.array(requiredSafetyConstraintSchema).parse(member.required_safety_constraints),
        unsupportedDietStatus: unsupportedDietStatusSchema.parse(member.unsupported_diet_status),
        unsupportedDietKinds: z.array(unsupportedDietKindSchema).parse(member.unsupported_diet_kinds),
      };
    }),
    allergenDictionary: {
      version: "jp-caa-2026-04.v1",
      catalog: (catalogResult.data ?? []).map((row) => ({ id: row.id, displayName: row.display_name, catalogVersion: row.catalog_version })),
      aliases: (aliasesResult.data ?? []).map((row) => ({
        allergenId: row.allergen_id, alias: row.alias, normalizedAlias: row.normalized_alias,
        aliasKind: aliasKindSchema.parse(row.alias_kind),
        requiresLabelConfirmation: row.requires_label_confirmation,
        dictionaryVersion: row.dictionary_version,
      })),
    },
    foodSafetyRules: (rulesResult.data ?? []).map((row) => ({
      id: row.id,
      appliesToAgeBands: row.applies_to_age_bands.map((value) => ageBandSchema.parse(value)),
      matchTerms: row.match_terms,
      ruleKind: ruleKindSchema.parse(row.rule_kind),
      requiredSafetyTag: row.required_safety_tag,
      userMessage: row.user_message,
      ruleVersion: row.rule_version,
    })),
  };
}

export type EmergencyCurrentSafety = {
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
};

export async function loadEmergencyCurrentSafety(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<EmergencyCurrentSafety> {
  const context = await loadCurrentSafetyContext(admin, userId, targetMemberIds);
  const { data, error } = await admin.from("household_members")
    .select("id,display_name").eq("user_id", userId).eq("status", "complete")
    .in("id", [...targetMemberIds]);
  if (error !== null || (data ?? []).length !== new Set(targetMemberIds).size) {
    throw new HttpError(400, "invalid_target_members", "対象メンバーを確認してください");
  }
  const rows = new Map((data ?? []).map((member) => [member.id, member] as const));
  const memberLabels = Object.freeze(Object.fromEntries(context.members.map((member, index) => {
    const live = rows.get(member.householdMemberId)?.display_name?.trim();
    // Capture the live owner value as a response-local immutable display snapshot.
    return [member.anonymousRef, live || `家族${index + 1}`] as const;
  })));
  return { context, memberLabels };
}
```

The focused loader test changes a live display name between two calls and proves each returned `memberLabels` object remains its own immutable response snapshot. It also proves a blank name becomes `家族1`, target order stays aligned with `member_1..N`, and missing/foreign/draft rows fail before any candidate is returned.

- [ ] **Step 6 (2–5 min): Implement `GET /api/emergency-menus`**

Create `netlify/functions/emergency-menus.ts`:

```ts
import { z } from "zod";
import { mealTypes } from "../../shared/contracts/domain";
import { emergencyFixtureVersion } from "../../shared/emergency/fixtures.v1";
import {
  buildEmergencyMenuCandidate,
  filterEmergencyMenus,
  type EmergencyMenusData,
} from "../../shared/emergency/filter-emergency-menus";
import { requireUser } from "./_shared/auth";
import {
  loadEmergencyCurrentSafety,
  type EmergencyCurrentSafety,
} from "./_shared/current-safety";
import { handleError, json, methodNotAllowed } from "./_shared/http";
import { getSupabaseAdmin } from "./_shared/supabase-admin";

const uuidList = z.string().min(1).transform((value, context) => {
  const values = value.split(",").filter(Boolean);
  if (values.length > 20 || new Set(values).size !== values.length ||
      values.some((item) => !z.string().uuid().safeParse(item).success)) {
    context.addIssue({ code: "custom", message: "IDは重複なしで20件以内にしてください" });
    return z.NEVER;
  }
  return values;
});
const querySchema = z.object({
  meal: z.enum(mealTypes),
  targetMemberIds: uuidList,
  pantryItemIds: uuidList.optional().default([]),
});
export type EmergencyHandlerDeps = {
  authenticate(request: Request): Promise<{ userId: string }>;
  loadContext(userId: string, targetMemberIds: readonly string[]): Promise<EmergencyCurrentSafety>;
  loadPantryNames(userId: string, pantryItemIds: readonly string[]): Promise<readonly string[]>;
};

export function createEmergencyMenusHandler(deps: EmergencyHandlerDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse({
        meal: url.searchParams.get("meal"),
        targetMemberIds: url.searchParams.get("targetMemberIds"),
        pantryItemIds: url.searchParams.get("pantryItemIds") ?? undefined,
      });
      if (!parsed.success) return json(400, { ok: false, error: { code: "invalid_request", message: "検索条件を確認してください", details: { fields: z.flattenError(parsed.error).fieldErrors } } });
      const { userId } = await deps.authenticate(request);
      const [loaded, pantryNames] = await Promise.all([
        deps.loadContext(userId, parsed.data.targetMemberIds),
        deps.loadPantryNames(userId, parsed.data.pantryItemIds),
      ]);
      const result = filterEmergencyMenus({ mealType: parsed.data.meal,
        pantryNames, context: loaded.context });
      const candidates = result.menus.map((menu) => buildEmergencyMenuCandidate({
        menu, context: loaded.context, memberLabels: loaded.memberLabels,
      }));
      return json<EmergencyMenusData>(200, { ok: true, data: {
        fixtureVersion: emergencyFixtureVersion,
        candidates,
        message: candidates.length === 0 ? "条件に合う緊急献立がありません" : "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
      } });
    } catch (error) {
      return handleError(error);
    }
  };
}

const handler = createEmergencyMenusHandler({
  authenticate: requireUser,
  loadContext: (userId, ids) => loadEmergencyCurrentSafety(getSupabaseAdmin(), userId, ids),
  loadPantryNames: async (userId, ids) => {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("pantry_items").select("name").eq("user_id", userId).in("id", [...ids]);
    if (error !== null || (data ?? []).length !== new Set(ids).size) return [];
    return (data ?? []).map((row) => row.name);
  },
});
export default handler;
export const config = { path: "/api/emergency-menus" };
```

Add to `netlify.toml`:

```toml
[[redirects]]
  from = "/api/emergency-menus"
  to = "/.netlify/functions/emergency-menus"
  status = 200
```

- [ ] **Step 7 (2–5 min): Implement the authenticated client and emergency page**

Create `src/features/emergency/emergency-menu-api.ts`:

```ts
import type { MealType } from "@shared/contracts/domain";
import {
  emergencyMenusDataSchema,
  type EmergencyMenusData,
} from "@shared/emergency/filter-emergency-menus";
import { z } from "zod";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const emergencyResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: emergencyMenusDataSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
]);

export async function getEmergencyMenus(input: {
  mealType: MealType;
  targetMemberIds: readonly string[];
  pantryItemIds: readonly string[];
}): Promise<EmergencyMenusData> {
  const token = await requireAccessToken(getBrowserSupabaseClient());
  const query = new URLSearchParams({
    meal: input.mealType,
    targetMemberIds: input.targetMemberIds.join(","),
    pantryItemIds: input.pantryItemIds.join(","),
  });
  const response = await fetch(`/api/emergency-menus?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body: unknown = await response.json();
  const envelope = emergencyResponseSchema.parse(body);
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.data;
}
```

Create `src/features/emergency/emergency-menu-page.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import type { EmergencyMenusData } from "@shared/emergency/filter-emergency-menus";
import { useAuth } from "@/features/auth/auth-provider";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { getPlannerDraft } from "@/features/planner/planner-api";
import { getEmergencyMenus } from "./emergency-menu-api";

const roleLabels = { main: "主菜", side: "副菜", soup: "汁物",
  staple: "主食", other: "料理" } as const;
const amount = (value: number | null, unit: string | null, text: string) =>
  value === null ? text : `${value}${unit ?? ""}`;

export function EmergencyMenuPage() {
  const userId = useAuth().session?.user.id;
  const query = useQuery({
    queryKey: ["emergency-menus", userId],
    enabled: userId !== undefined,
    queryFn: async () => {
      const draft = await getPlannerDraft(getBrowserSupabaseClient(), userId ?? "");
      return getEmergencyMenus({
        mealType: draft?.mealType ?? "dinner",
        targetMemberIds: draft?.targetMemberIds ?? [],
        pantryItemIds: draft?.pantrySelections.map((item) => item.pantryItemId) ?? [],
      });
    },
  });
  return <EmergencyMenuContent loading={query.isPending} error={query.isError ? "緊急献立を読み込めませんでした" : null} response={query.data ?? null} />;
}

export function EmergencyMenuContent({
  loading, error, response,
}: {
  loading: boolean;
  error: string | null;
  response: EmergencyMenusData | null;
}) {
  return (
    <main className="page-frame stack">
      <div><p className="eyebrow">AIを使わない</p><h1>15分緊急献立</h1></div>
      <p>現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。</p>
      {loading && <p>候補を確認中…</p>}
      {error !== null && <p role="alert">{error}</p>}
      {response?.candidates.length === 0 && <section className="card"><h2>{response.message}</h2><p>条件を緩めず、候補を表示していません。</p></section>}
      {response?.candidates.map(({ menu, memberLabels, labelWarnings }, candidateIndex) => {
        const candidateDomId = `emergency-candidate-${candidateIndex + 1}`;
        return <article className="card stack min-w-0 break-words" key={menu.menuId}>
          <h2>{menu.dishes.map((dish) => dish.name).join("・")}</h2>
          <p>食卓まで全体 {menu.totalElapsedMinutes}分・{menu.servings}人分</p>
          <details open>
            <summary className="flex min-h-11 cursor-pointer items-center font-bold">
              材料と作り方を表示
            </summary>
            <section aria-labelledby={`${candidateDomId}-timeline`}>
              <h3 id={`${candidateDomId}-timeline`}>全体の段取り</h3>
              <ol>{menu.timeline.map((step) => <li key={step.id}>
                {step.startMinute}分〜（目安{step.durationMinutes}分） {step.instruction}
              </li>)}</ol>
            </section>
            {menu.dishes.map((dish, dishIndex) => {
              const adaptations = menu.adaptations.filter((item) => item.dishId === dish.id);
              const dishDomId = `${candidateDomId}-dish-${dishIndex + 1}`;
              return <section key={dish.id} aria-labelledby={dishDomId}>
                <h3 id={dishDomId}>
                  {roleLabels[dish.role]}・{dish.name}
                </h3>
                <p>{dish.description}（目安{dish.cookingTimeMinutes}分）</p>
                <h4>材料</h4>
                <ul>{dish.ingredients.map((ingredient) => <li key={ingredient.id}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                  <span>{ingredient.name}</span>
                  <span>{ingredient.quantityText}</span>
                </li>)}</ul>
                <h4>作り方</h4>
                <ol>{dish.steps.map((step) => <li key={step.id}>
                  <strong>手順{step.position}</strong> {step.instruction}
                </li>)}</ol>
                {adaptations.length > 0 && <section>
                  <h4>家族向けの取り分け</h4>
                  {adaptations.map((adaptation) => <dl key={adaptation.id}>
                    <dt><strong>{memberLabels[adaptation.anonymousMemberRef] ?? "家族"}</strong>
                      ・{adaptation.portionText}</dt>
                    <dd>分ける前: 手順{dish.steps.find((step) =>
                      step.id === adaptation.branchBeforeRecipeStepId)?.position ?? "を確認"}</dd>
                    {adaptation.additionalCutting && <dd>切り方: {adaptation.additionalCutting}</dd>}
                    {adaptation.additionalHeating && <dd>加熱: {adaptation.additionalHeating}</dd>}
                    {adaptation.additionalSeasoning && <dd>味付け: {adaptation.additionalSeasoning}</dd>}
                    <dd>配膳時: {adaptation.servingCheck}</dd>
                    {adaptation.safetyActions.length > 0 && <dd>
                      <strong>安全のための手順</strong>
                      <ul>{adaptation.safetyActions.map((action, index) =>
                        <li key={`${action.beforeRecipeStepId}-${index}`}>{action.instruction}</li>)}</ul>
                    </dd>}
                  </dl>)}
                </section>}
              </section>;
            })}
            <section aria-labelledby={`${candidateDomId}-pantry`}>
              <h3 id={`${candidateDomId}-pantry`}>冷蔵庫食材の使い方</h3>
              {menu.pantryUsage.length === 0 ? <p>今回選んだ冷蔵庫食材はありません。</p> :
                <ul>{menu.pantryUsage.map((usage) => <li key={usage.selectionId}>
                  <strong>{usage.pantryItemName}</strong>{usage.usageStatus === "used" ?
                    <p>使用予定 {amount(usage.plannedQuantity, usage.unit, "分量を確認")}
                      {usage.shortageQuantity !== null && usage.shortageQuantity > 0 &&
                        `／不足 ${amount(usage.shortageQuantity, usage.unit, "")}`}</p> :
                    <p>使わなかった理由: {usage.unusedReason}</p>}
                  {usage.dishIds.length > 0 && <p>使用先: {usage.dishIds.flatMap((dishId) => {
                    const name = menu.dishes.find((dish) => dish.id === dishId)?.name;
                    return name === undefined ? [] : [name];
                  }).join("・")}</p>}
                </li>)}</ul>}
            </section>
          </details>
          {labelWarnings.length > 0 && <section role="note"
            className="rounded-xl border border-amber-700 bg-amber-50 p-3">
            <h3>加工品は原材料表示を確認してください</h3>
            <ul>{labelWarnings.map((warning, warningIndex) => <li
              key={`${candidateDomId}-warning-${warningIndex + 1}`}>
              {warning.sourceDisplayName}・{warning.allergenDisplayName}・
              {warning.memberDisplayName}
            </li>)}</ul>
          </section>}
          <p>固定データから表示しています。内容、加熱状態、加工品の原材料表示と家庭内の混入を調理前に確認してください。安全を保証する表示ではありません。</p>
        </article>;
      })}
    </main>
  );
}
```

In `src/app/router.tsx` add the protected non-navigation route:

```tsx
import { EmergencyMenuPage } from "@/features/emergency/emergency-menu-page";
{ path: "emergency-menus", element: <EmergencyMenuPage /> }
```

- [ ] **Step 8 (2–5 min): Run focused tests and verify GREEN**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/emergency netlify/functions/_shared/current-safety.test.ts netlify/functions/emergency-menus.test.ts src/features/emergency/emergency-menu-api.test.ts src/features/emergency/emergency-menu-page.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
```

Expected: filter, authenticated handler, explicit no-candidate UI, typecheck, and lint all pass; no OpenRouter request or quota row is created.

- [ ] **Step 9 (2–5 min): Commit emergency-menu delivery**

```bash
git add shared/emergency netlify/functions src/features/emergency src/app/router.tsx netlify.toml
git commit -m "feat: add current-safety emergency menus"
```

## Task 9: Increment E2E, Planner/Pantry Wiring, and Full Verification Gate

**Files:**
- Create: `e2e/specs/menu-domain-pantry.spec.ts`
- Modify: `src/features/planner/planner-page.tsx`
- Modify: `src/features/planner/planner-route.tsx`

**Interfaces:**
- Consumes: Plan 1 `test`/`expect`/`completeMinimumOnboarding`; Tasks 6–8 routes and APIs.
- Produces: a browser-level proof of pantry CRUD, server draft restore, one-attempt expired confirmation, three-step planner, current safety summary, deterministic candidate, and condition-preserving empty state.

- [ ] **Step 1 (2–5 min): Write the failing E2E scenario**

Create `e2e/specs/menu-domain-pantry.spec.ts`:

```ts
import {
  expect,
  test,
} from "../fixtures/auth";

test("pantry, autosaved planner, expiry confirmation, and emergency fallback", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  await page.goto("/pantry");
  await page.getByLabel("食材名").fill("キャベツ");
  await page.getByLabel("分量").fill("1");
  await page.getByLabel("単位").fill("個");
  await page.getByLabel("期限日").fill(yesterday);
  await page.getByLabel("期限の種類").selectOption("use_by");
  await page.getByLabel("開封状態").selectOption("opened");
  await page.getByRole("button", { name: "追加する" }).click();
  await expect(page.getByRole("heading", { name: "キャベツ" })).toBeVisible();

  await page.goto("/planner");
  await expect(page.getByText("現在の家族・安全条件")).toBeVisible();
  await page.getByRole("radio", { name: "夕食" }).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("radio", { name: "和食" }).check();
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toContainText("アプリは食べられるか判断しません");
  await page.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }).click();
  await page.getByLabel("キャベツの使い方").selectOption("must_use");
  await expect(page.getByText("保存済み")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("radio", { name: "夕食" })).toBeChecked();
  await expect(page.getByText("鶏肉を外す")).toBeVisible();
  await page.getByRole("checkbox", { name: "キャベツ" }).uncheck();
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toBeVisible();

  await page.getByRole("button", { name: "選ばない" }).click();
  await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
  await expect(page.getByRole("heading", { name: "鶏肉とキャベツの塩蒸し・きゅうりの塩もみ・玉ねぎの塩スープ" })).toBeVisible();
  await expect(page.getByText("AI利用回数は消費しません。")).toBeVisible();
  await expect(page.getByText("食卓まで全体 15分・2人分")).toBeVisible();
  await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "主菜・鶏肉とキャベツの塩蒸し" })).toBeVisible();
  await expect(page.getByText("250g", { exact: true })).toBeVisible();
  await expect(page.getByText(/手順1.*鶏肉を一口大/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  await expect(page.getByText(/安全を保証する表示ではありません/u)).toBeVisible();
  const details = page.locator("article details").first();
  const summary = details.locator("summary", { hasText: "材料と作り方を表示" });
  await summary.focus();
  await summary.press("Enter");
  await expect(details).not.toHaveAttribute("open", "");
  await summary.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(page.locator("body")).not.toContainText("member_1");
  await expect(page.locator("body")).not.toContainText("dishes.0.ingredients.0.name");
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);

  await page.goto("/planner");
  await page.getByRole("radio", { name: "朝食" }).check();
  await expect(page.getByText("保存済み")).toBeVisible();
  await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
  await expect(page.getByText("条件に合う緊急献立がありません")).toBeVisible();
  await expect(page.getByText("条件を緩めず、候補を表示していません。")).toBeVisible();
});

test("keeps an incompatible current allergy as an explicit no-candidate result", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/settings");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "鶏肉を追加" }).click();
  await expect(page.getByRole("status")).toContainText("最新条件で再確認します");
  await page.goto("/planner");
  await page.getByRole("radio", { name: "夕食" }).check();
  await expect(page.getByText("保存済み")).toBeVisible();
  await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
  await expect(page.getByText("条件に合う緊急献立がありません")).toBeVisible();
  await expect(page.getByText("条件を緩めず、候補を表示していません。")).toBeVisible();
});
```

- [ ] **Step 2 (2–5 min): Run E2E and verify RED at the unwired pantry selector**

Run: `docker compose run --rm app npm run e2e -- e2e/specs/menu-domain-pantry.spec.ts`

Expected: FAIL because `/planner` does not yet render the `キャベツ` checkbox.

- [ ] **Step 3 (2–5 min): Wire pantry query and runtime attempt key into the planner**

Add these imports and optional props to `src/features/planner/planner-page.tsx`:

```tsx
import type { PantryItem } from "@shared/contracts/pantry";
import { PantrySelector } from "./pantry-selector";

// Add to PlannerForm props:
pantryItems?: readonly PantryItem[];
attemptKey?: string;
now?: () => Date;

// Add defaults in PlannerForm parameter destructuring:
pantryItems = [],
attemptKey = crypto.randomUUID(),
now = () => new Date(),

// Render between additional conditions and the medical-scope error:
<PantrySelector
  items={pantryItems}
  selections={value.pantrySelections}
  idempotencyKey={attemptKey}
  now={now}
  onChange={(pantrySelections) => update({ pantrySelections: [...pantrySelections] })}
/>
```

Add the owned pantry query and stable runtime key to `src/features/planner/planner-route.tsx`:

```tsx
import { useRef } from "react";
import { listPantryItems, pantryKeys } from "@/features/pantry/pantry-api";

// Immediately after membersQuery:
const pantryQuery = useQuery({
  queryKey: pantryKeys.list(userId ?? "missing"),
  queryFn: () => listPantryItems(client, userId ?? ""),
  enabled: userId !== undefined,
});
const attemptKey = useRef(crypto.randomUUID());

// Include pantryQuery in loading/error branches and replace the final return:
return (
  <PlannerForm
    initialValue={value}
    members={members}
    pantryItems={pantryQuery.data ?? []}
    attemptKey={attemptKey.current}
    saveState={saveState}
    onChange={setValue}
  />
);
```

The attempt key is not written to `generation_drafts`. Reloading creates a new key and therefore forces another physical-state confirmation. Plan 3 reuses the current in-memory key only after storing it in device generation-recovery storage immediately before the generation request; a new/whole/dish regeneration replaces it.

- [ ] **Step 4 (2–5 min): Run the focused E2E and verify GREEN**

Run: `docker compose run --rm app npm run e2e -- e2e/specs/menu-domain-pantry.spec.ts`

Expected at this pre-correction checkpoint: both scenarios pass; the restored draft retains `must_use` but not the expired confirmation; dinner exposes the complete read-only cooking view at 320 px and keyboard-toggles its details; the not-yet-added breakfast fixture and the separately configured incompatible allergy both return explicit condition-preserving no-candidate copy. Task 10 replaces only the catalog-gap assertion after adding the reviewed breakfast/lunch rows.

- [ ] **Step 5 (2–5 min): Run the complete increment verification gate**

Run each command separately:

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
docker compose --profile test run --rm db-test
docker compose run --rm app npm run e2e
docker compose run --rm --no-deps app npm run build
docker compose config --quiet
```

Expected: every command exits 0; Vitest, pgTAP, and Playwright report zero failures; Vite writes `dist/`; Docker Compose reports no configuration error. Search the test output for `openrouter` and confirm the only hits are existing mock/tooling tests—this increment makes zero outbound OpenRouter calls and changes no quota table.

- [ ] **Step 6 (2–5 min): Review the Plan 2 → Plan 3 contract boundary**

Run:

```bash
rg -n "ValidatedMenu|GenerationContext|validateGeneratedMenu|createCurrentSafetyFingerprint|loadCurrentSafetyContext|emergencyMenuFixturesV1" \
  shared netlify/functions
rg -n "OPENROUTER|ai_generation_requests|ai_user_daily_usage|ai_global_daily_usage" \
  shared src/features/pantry src/features/planner src/features/emergency netlify/functions/emergency-menus.ts
```

Expected: the first command shows one production definition for every locked export and typed consumers only; the second command returns no Plan 2 production match.

- [ ] **Step 7 (2–5 min): Commit the increment gate**

```bash
git add e2e/specs/menu-domain-pantry.spec.ts \
  src/features/planner/planner-page.tsx \
  src/features/planner/planner-route.tsx
git commit -m "test: cover menu domain and pantry increment"
```

## Task 10: Close the reviewed safety, ownership, pantry-concurrency, planner-attempt, and emergency contracts

**Files:**
- Modify: `supabase/tests/database/02_safety_catalogs.test.sql`
- Modify: `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`
- Modify: `supabase/tests/database/04_menu_core.test.sql`
- Modify: `supabase/migrations/20260711000400_safety_catalog_data.sql`
- Modify: `supabase/migrations/20260711001000_pantry_and_planner_drafts.sql`
- Modify: `supabase/migrations/20260711001100_menu_core.sql`
- Modify: `shared/contracts/generation.test.ts`
- Modify: `shared/contracts/generation.ts`
- Create: `shared/safety/generation-context.ts`
- Modify: `shared/safety/allergens.test.ts`
- Modify: `shared/safety/allergens.ts`
- Modify: `shared/safety/food-rules.test.ts`
- Modify: `shared/safety/food-rules.ts`
- Modify: `shared/safety/validate-generated-menu.test.ts`
- Modify: `shared/safety/validate-generated-menu.ts`
- Modify: `shared/testing/factories.ts`
- Modify: `src/features/planner/pantry-selector.test.tsx`
- Modify: `src/features/planner/pantry-selector.tsx`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/planner/planner-page.tsx`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/planner/planner-api.test.ts`
- Modify: `src/features/planner/planner-api.ts`
- Modify: `src/features/planner/use-draft-autosave.test.ts`
- Modify: `src/features/planner/use-draft-autosave.ts`
- Modify: `src/features/pantry/pantry-api.test.ts`
- Modify: `src/features/pantry/pantry-api.ts`
- Modify: `src/features/pantry/pantry-form.tsx`
- Modify: `src/features/pantry/pantry-page.test.tsx`
- Modify: `src/features/pantry/pantry-page.tsx`
- Modify: `src/features/emergency/emergency-menu-api.test.ts`
- Modify: `src/features/emergency/emergency-menu-api.ts`
- Modify: `src/features/emergency/emergency-menu-page.test.tsx`
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `netlify/functions/_shared/current-safety.test.ts`
- Modify: `netlify/functions/_shared/current-safety.ts`
- Modify: `netlify/functions/_shared/http.test.ts`
- Modify: `netlify/functions/_shared/http.ts`
- Modify: `netlify/functions/emergency-menus.test.ts`
- Modify: `netlify/functions/emergency-menus.ts`
- Modify: `shared/emergency/fixtures.v1.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts`
- Modify: `shared/emergency/filter-emergency-menus.ts`
- Modify: `e2e/specs/menu-domain-pantry.spec.ts`

**Interfaces:**
- `generatedMenuSchema` parses external AI output and permits only `confirmationStatus: "pending"`. `validatedMenuSchema` parses stored/returned menus and permits `pending | confirmed` together with `confirmedAt`/`confirmedBy` provenance.
- AI `safetyTags` may be stored for display/debugging but are never evidence. `SafetyAction` is `{ kind, dishId, ingredientId, anonymousMemberRef, beforeRecipeStepId, instruction }`; a required constraint is satisfied only by an ingredient/dish/member/step-bound action whose instruction and recipe/adaptation text agree and contain no contradictory instruction. An action for another ingredient in the same dish never satisfies the rule.
- `quarter_round_food` is the sole four-way-cut action kind across the catalog, schema, normalized table, validator, and fixtures. The under-six hard-particle fixture contains concrete hard-bean forms and the reviewed peanut/walnut/almond/cashew/pistachio/macadamia names and aliases; it excludes bare bean terms and proves soft processed bean products do not match.
- `menu_safety_actions` is the only persisted representation of `SafetyAction`; `menu_member_adaptations` has no JSON action column. Each row carries `user_id`, canonical `kind`/`instruction`, stable `position`, and owner-composite menu/dish/ingredient/target-member/recipe-step/adaptation FKs. Authenticated browsers have owner SELECT only and no write privilege. Plan 3 must persist every validator-returned action and rebuild the same nested `ValidatedMenu.adaptations[].safetyActions` array on readback.
- `menu_target_members` keeps `user_id`, `anonymous_ref`, and `member_display_name_snapshot` permanently. Its live `(household_member_id,household_member_user_id)` link is nullable, owner-matched when present, and both columns become null on member deletion; the target row and its dependent safety actions never cascade from household settings deletion.
- `GenerationContext` is the only validator context shared with Plan 3. `validateGeneratedMenu(menu: unknown, context: GenerationContext): MenuValidationResult` validates current safety plus meal/time/role/genre/main/avoid/member preference/must-use/prefer-use semantics, then overwrites label confirmations with deterministic canonical pending records.
- Plan 2 stores immutable canonical `source_text_snapshot` provenance and proves that neither confirmation RPC overload exists. Plan 3 alone creates the fingerprint-aware three-argument confirmation RPC together with the canonical current-safety locking helper, plus the authenticated HTTP/browser API and UI; no browser code in Plan 2 performs a confirmation transition, and no AI or service persistence input may set confirmed.
- Fingerprint builderは入力ordinalを`member_N`へ割り当てるため、Plan 3/4が`menu_target_members`から入力UUID配列を復元する順序は`anonymous_ref`の数値suffix昇順に固定する。SQLは`^member_[1-9][0-9]*$`制約済みsuffixをinteger化して`ORDER BY`し、TypeScriptはsuffixを数値化して明示sortする。`member_10`を`member_2`より前へ置く文字列sortと、順序未指定のDB返却値は禁止する。
- `ExpiredPantryCheck` is exactly `{ pantryItemId: string; checkedAt: string }`. It lives in the planner parent attempt state, never in `generation_drafts`. The same attempt's `idempotencyKey` and checks are handed to Plan 3's `PendingGeneration` before POST. `generation_drafts.revision` is authoritative and strictly monotonic: browser INSERT/UPDATE is revoked, `save_generation_draft(expectedRevision,...)` performs the only write, and the generation click awaits `useDraftAutosave().flush()` before constructing a command with the returned `draftRevision`.
- Every ordinary pantry update/delete, including Plan 3's after-cooking actions, uses the exact rendered row's `updatedAt` as `expectedUpdatedAt`, adds `.eq("updated_at", expectedUpdatedAt)`, selects the affected row/id, and maps a successful zero-row result to `PantryVersionConflictError` (`code: "pantry_version_conflict"`). A conflict refreshes the owner-scoped row and is never retried as an unconditional last-write-wins mutation.
- `EmergencyMenusData.candidates` contains complete `EmergencyMenuCandidate` objects. The server attaches response-local owner-verified human member snapshots and resolves pending label checks to human source/allergen/member labels. The read-only mobile view renders all dish ingredients with serving quantities, per-dish numbered steps, one integrated timeline, named portion/structured safety actions, pantry usage, label warnings, and the safety disclaimer; anonymous refs, raw catalog IDs, UUIDs, and source paths are never user-facing copy.
- All `_shared` modules import root `shared/` or `src/` through `../../../`; ordinary `netlify/functions/*.ts` modules use `../../`.

- [ ] **Step 1: Write the full failing safety and semantic validator matrix (5 minutes)**

Create/extend `shared/safety/validate-generated-menu.test.ts` with these table-driven cases. `makeGenerationContext()` must return the final context type rather than a validator-only mock:

Add the exact reusable rule/context fixture to `shared/testing/factories.ts`:

```ts
import type { GenerationContext } from "../safety/generation-context";
import type { FoodSafetyRule } from "../safety/food-rules";

export const hardBeanAndReviewedNutRule: FoodSafetyRule = {
  id: "hard_beans_and_reviewed_nuts_under_6",
  appliesToAgeBands: ["post_weaning_to_2", "age_3_5"],
  matchTerms: [
    "硬い豆", "かたい豆", "炒り大豆", "煎り大豆", "いり大豆", "乾燥大豆", "節分豆", "豆まき豆",
    "落花生", "ピーナッツ", "ピーナツ", "くるみ", "胡桃", "ウォールナッツ", "アーモンド",
    "カシューナッツ", "ピスタチオ", "マカダミアナッツ",
  ],
  ruleKind: "forbidden",
  requiredSafetyTag: null,
  userMessage: "5歳以下には硬い豆やナッツを使用できません",
  ruleVersion: "jp-caa-child-shape-2026-07.v1",
};

export function underSixHardBeanAndNutContext(): GenerationContext {
  const base = makeGenerationContext();
  return {
    ...base,
    safety: {
      ...base.safety,
      members: base.safety.members.map((member) => ({ ...member, ageBand: "age_3_5" })),
      foodSafetyRules: [hardBeanAndReviewedNutRule],
    },
  };
}
```

```ts
it("canonicalizes every provider confirmation to deterministic pending provenance", () => {
  const output = makeGeneratedMenu({
    dishes: [dishWithIngredient("カレールー")],
    labelConfirmations: [{
      sourceType: "ingredient", sourceId: INGREDIENT_ID,
      sourcePath: "made.up.path", allergenId: "wheat",
      anonymousMemberRef: "member_1", dictionaryVersion: "wrong",
      confirmationStatus: "confirmed",
    }],
  });
  const result = validateGeneratedMenu(output, makeGenerationContext({ allergenIds: ["wheat"] }));
  expect(result.ok).toBe(false); // generatedMenuSchema rejects provider-confirmed state

  const pending = validateGeneratedMenu(
    { ...output, labelConfirmations: [{ ...output.labelConfirmations[0], confirmationStatus: "pending" }] },
    makeGenerationContext({ allergenIds: ["wheat"] }),
  );
  expect(pending).toMatchObject({ ok: true, menu: { labelConfirmations: [{
    sourcePath: "dishes.0.ingredients.0.name", dictionaryVersion: "jp-caa-2026-04.v1",
    confirmationStatus: "pending", confirmedAt: null, confirmedBy: null,
  }] } });
});

it("does not trust a tag or an action contradicted by recipe text", () => {
  const unsafe = makeGeneratedMenu({
    safetyTags: ["quarter_round_food"],
    dishes: [dishWithIngredient("ぶどう", { step: "ぶどうは丸ごと盛り付ける" })],
    adaptations: [adaptation({ safetyTags: ["quarter_round_food"], safetyActions: [{
      kind: "quarter_round_food", dishId: DISH_ID, ingredientId: GRAPE_INGREDIENT_ID,
      anonymousMemberRef: "member_1",
      beforeRecipeStepId: STEP_ID, instruction: "4等分する",
    }] })],
  });
  expect(validateGeneratedMenu(unsafe, toddlerContext())).toMatchObject({
    ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  });
});

it("does not use an action for another ingredient in the same dish as evidence", () => {
  const output = menuWithTwoIngredients({
    first: { id: GRAPE_INGREDIENT_ID, name: "ぶどう" },
    second: { id: CARROT_INGREDIENT_ID, name: "にんじん" },
    safetyActions: [{
      kind: "quarter_round_food", dishId: DISH_ID, ingredientId: CARROT_INGREDIENT_ID,
      anonymousMemberRef: "member_1", beforeRecipeStepId: STEP_ID,
      instruction: "にんじんを4等分する",
    }],
  });
  expect(validateGeneratedMenu(output, toddlerContext())).toMatchObject({
    ok: false,
    issues: expect.arrayContaining([expect.objectContaining({ code: "age_shape_rule" })]),
  });
});

it.each([
  "煎り大豆", "いり大豆", "節分豆", "落花生", "ﾋﾟｰﾅｯﾂ", "胡桃", "アーモンド",
  "カシュー ナッツ", "ピスタチオ", "マカダミア ナッツ",
])("rejects each concrete hard-bean/reviewed-nut spelling for an under-six target: %s", (name) => {
  expect(validateGeneratedMenu(
    menuWithIngredient(name), underSixHardBeanAndNutContext(),
  )).toMatchObject({ ok: false, issues: expect.arrayContaining([
    expect.objectContaining({ code: "age_shape_rule" }),
  ]) });
});

it.each(["豆腐", "豆乳", "納豆", "大豆の水煮", "やわらかく煮た大豆"])(
  "does not reject a soft processed bean product as a hard whole bean: %s",
  (name) => {
    expect(validateGeneratedMenu(
      menuWithIngredient(name), underSixHardBeanAndNutContext(),
    ).ok).toBe(true);
  },
);

it.each([
  ["dish description", { description: "カレールーを使う" }],
  ["quantity text", { ingredientQuantityText: "しょうゆ小さじ1" }],
  ["timeline", { timelineInstruction: "ドレッシングをかける" }],
  ["adaptation", { servingCheck: "食パンの表示を確認する" }],
])("scans every textual leaf including %s", (_name, patch) => {
  expect(validateGeneratedMenu(makeGeneratedMenu(patch), wheatContext()).ok).toBe(false);
});

it("uses one canonical dot path with explicit field names for every food text leaf", () => {
  expect(collectMenuTextSources(menuWithEveryTextLeaf()).map((item) => item.sourcePath)).toEqual([
    "dishes.0.name",
    "dishes.0.description",
    "dishes.0.ingredients.0.name",
    "dishes.0.ingredients.0.quantityText",
    "dishes.0.ingredients.0.unit",
    "dishes.0.steps.0.instruction",
    "timeline.0.instruction",
    "adaptations.0.portionText",
    "adaptations.0.additionalCutting",
    "adaptations.0.additionalHeating",
    "adaptations.0.additionalSeasoning",
    "adaptations.0.servingCheck",
    "adaptations.0.safetyActions.0.instruction",
  ]);
});

it("canonicalizes a used pantry product through its real ingredient leaf",()=>{
  const menu=menuUsingPantryIngredient({pantryName:"カレールー",ingredientName:"カレールー"});
  const result=validateGeneratedMenu(menu,wheatContext());
  expect(result).toMatchObject({ok:true,menu:{labelConfirmations:[{
    sourceType:"ingredient",sourceId:menu.dishes[0]?.ingredients[0]?.id,
    sourcePath:"dishes.0.ingredients.0.name",
  }]}});
  if(!result.ok)throw new Error("expected valid linked pantry fixture");
  expect(JSON.stringify(result.menu.labelConfirmations))
    .not.toContain(menu.pantryUsage[0]?.selectionId);
});

it("rejects a used pantry selection without an exact linked food ingredient",()=>{
  expect(validateGeneratedMenu(
    menuUsingPantryIngredient({pantryName:"カレールー",ingredientName:"にんじん"}),
    wheatContext(),
  )).toMatchObject({ok:false,issues:expect.arrayContaining([
    expect.objectContaining({code:"pantry_usage_link_mismatch"}),
  ])});
});

it.each([
  ["meal type", { menu: { mealType: "lunch" }, submission: { mealType: "dinner" } }, "meal_type_mismatch"],
  ["genre", { menu: { cuisineGenre: "western" }, submission: { cuisineGenre: "japanese" } }, "genre_mismatch"],
  ["time", { menu: { totalElapsedMinutes: 45 }, submission: { timeLimitMinutes: 30 } }, "time_limit_exceeded"],
  ["main ingredient", { submission: { mainIngredients: ["鶏肉"] } }, "main_ingredient_missing"],
  ["avoid ingredient", { submission: { avoidIngredients: ["ねぎ"] }, menu: { ingredient: "ねぎ" } }, "avoid_ingredient_used"],
  ["required roles", { menu: { roles: ["main", "side", "staple"] } }, "required_dish_role_missing"],
  ["must use", { pantry: { priority: "must_use", usageStatus: "unused" } }, "must_use_missing"],
  ["prefer reason", { pantry: { priority: "prefer_use", usageStatus: "unused", unusedReason: null } }, "prefer_use_reason_missing"],
])("rejects semantic mismatch: %s", (_name, patch, code) => {
  const result = validateGeneratedMenu(makeGeneratedMenu(patch.menu), makeGenerationContext(patch));
  expect(result).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code })]) });
});

it.each([toddlerContext(), seniorContext()])(
  "requires structured cutting/bone/softening actions for $safety.members.0.ageBand",
  (context) => {
    const result = validateGeneratedMenu(menuWithoutStructuredAction(), context);
    expect(result).toMatchObject({ ok: false, issues: expect.arrayContaining([
      expect.objectContaining({ code: "required_safety_action" }),
    ]) });
  },
);

it("conservatively excludes mochi for a senior target", () => {
  const result = validateGeneratedMenu(menuWithIngredient("餅"), seniorContext());
  expect(result).toMatchObject({ ok: false, issues: expect.arrayContaining([
    expect.objectContaining({ code: "age_shape_rule" }),
  ]) });
});
```

Extend `shared/safety/allergens.test.ts` with an exact expected path list for every string-valued food text leaf. The list includes dish `name/description`, ingredient `name/quantityText/unit`, recipe instruction, timeline instruction, all adaptation text and safety-action instruction, and pantry `pantryItemName/unit/unusedReason`; it excludes UUIDs, enum codes, and provenance fields.

- [ ] **Step 2: Complete non-database cap tests; keep menu-core ownership proof canonical (4 minutes)**

Task 3's `04_menu_core.test.sql` is the 42-assertion schema/ACL and confirmation-transition-absence smoke test, and `04a_menu_core_hardening.test.sql` is the self-contained dynamically planned 84-assertion owner/foreign fixture with canonical 1/500-character `source_text_snapshot` acceptance and blank/non-canonical/overlength rejection. The two accepted rows use distinct `dishes.0.boundary.min`/`dishes.0.boundary.max` paths and are deleted immediately before RLS count assertions. Do not append a third partial database fixture here. In particular, do not use non-UUID placeholders, undeclared fixtures, or run owner-only DML before switching back from `authenticated`; extend 04a when a new menu-core adversarial case is required.

Extend the draft test with a 51-element `pantry_selections` array and a JSON value over 32 KiB; both must fail with check violation. Extend `_shared/http.test.ts` with declared and undeclared bodies of 65,537 UTF-8 bytes and expect `413/request_too_large`. Extend the emergency handler test with 21 UUIDs and duplicate UUIDs and expect `400/invalid_request` before DB loading.

- [ ] **Step 3: Run the new tests and verify RED (3 minutes)**

Run:

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/02_safety_catalogs.test.sql supabase/tests/database/04_menu_core.test.sql supabase/tests/database/04a_menu_core_hardening.test.sql
docker compose run --rm --no-deps app npx vitest run shared/contracts/generation.test.ts shared/safety netlify/functions/_shared/http.test.ts netlify/functions/emergency-menus.test.ts
```

Expected: RED for the generated/stored schema split, normalized ingredient-bound `menu_safety_actions`, canonical kind/instruction checks, cross-owner action FKs, snapshot-preserving member deletion, semantic context, canonical pending records, RPC provenance, body cap, and the missing toddler/senior/processed-food coverage.

- [ ] **Step 4: Split generated and stored contracts and define the canonical context (5 minutes)**

In `shared/contracts/generation.ts`, add the structured action and distinct confirmation schemas:

```ts
export const safetyActionKinds = [
  "remove_bones", "cut_small", "quarter_round_food", "soften", "heat_thoroughly",
] as const;
export const safetyActionSchema = z.object({
  kind: z.enum(safetyActionKinds),
  dishId: z.string().uuid(),
  ingredientId: z.string().uuid(),
  anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/u),
  beforeRecipeStepId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(300),
}).strict();

// Add to menuMemberAdaptationSchema. safetyTags remains non-authoritative metadata.
safetyActions: z.array(safetyActionSchema).max(20),

const labelConfirmationBase = {
  sourceType: z.enum(labelSourceTypes), sourceId: z.string().uuid(),
  sourcePath: z.string().trim().min(1).max(200),
  allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/u),
  dictionaryVersion: z.string().trim().min(1).max(80),
};
export const generatedLabelConfirmationSchema = z.object({
  ...labelConfirmationBase, confirmationStatus: z.literal("pending"),
}).strict();
export const menuLabelConfirmationSchema = z.discriminatedUnion("confirmationStatus", [
  z.object({ ...labelConfirmationBase, confirmationStatus: z.literal("pending"),
    confirmedAt: z.null(), confirmedBy: z.null() }).strict(),
  z.object({ ...labelConfirmationBase, confirmationStatus: z.literal("confirmed"),
    confirmedAt: z.string().datetime({ offset: true }), confirmedBy: z.string().uuid() }).strict(),
]);
```

Factor the common menu object into `menuShape`; `generatedMenuSchema` uses `generatedLabelConfirmationSchema`, while `validatedMenuSchema` uses `menuLabelConfirmationSchema`. Export `GeneratedLabelConfirmation`, `GeneratedMenu`, `ValidatedMenu`, and `SafetyAction`. No provider response is ever parsed with `validatedMenuSchema`.

Create `shared/safety/generation-context.ts`:

```ts
import type { PlannerSubmission } from "../contracts/planner";
import type { PantryItem } from "../contracts/pantry";
import type { EasePreference, PortionSize, SpiceLevel } from "../contracts/domain";
import type { CurrentSafetyContext } from "./context";

export type ExpiredPantryCheck = { pantryItemId: string; checkedAt: string };
export type GenerationMemberPreference = {
  householdMemberId: string;
  anonymousMemberRef: string;
  portionSize: PortionSize;
  spiceLevel: SpiceLevel;
  easePreferences: readonly EasePreference[];
  dislikes: readonly string[];
};
export type GenerationContext = {
  submission: PlannerSubmission;
  safety: CurrentSafetyContext;
  pantryItems: readonly PantryItem[];
  memberPreferences: readonly GenerationMemberPreference[];
  targetMembers: readonly {
    householdMemberId: string;
    anonymousRef: string;
    displayNameSnapshot: string;
  }[];
  expiredPantryChecks: readonly ExpiredPantryCheck[];
  idempotencyKey: string;
  preferenceSnapshot: Readonly<Record<string, unknown>>;
  safetySnapshot: Readonly<Record<string, unknown>>;
};
```

- [ ] **Step 5: Implement exhaustive text collection, structured-action validation, and canonical output (5 minutes)**

Replace `collectMenuTextSources` with an explicit collector that covers every food-bearing string field:

```ts
export function collectMenuTextSources(menu: GeneratedMenu | ValidatedMenu): readonly MenuTextSource[] {
  const sources: MenuTextSource[] = [];
  const push = (sourceType: MenuTextSource["sourceType"], sourceId: string,
    sourcePath: string, text: string | null, dishId: string | null,
    ingredientId: string | null) => {
    if (text !== null && text.trim() !== "") {
      sources.push({ sourceType, sourceId, sourcePath, text, dishId, ingredientId });
    }
  };
  menu.dishes.forEach((dish, dishIndex) => {
    push("dish", dish.id, `dishes.${dishIndex}.name`, dish.name, dish.id, null);
    push("dish", dish.id, `dishes.${dishIndex}.description`, dish.description, dish.id, null);
    dish.ingredients.forEach((item, index) => {
      const base = `dishes.${dishIndex}.ingredients.${index}`;
      push("ingredient", item.id, `${base}.name`, item.name, dish.id, item.id);
      push("ingredient", item.id, `${base}.quantityText`, item.quantityText, dish.id, item.id);
      push("ingredient", item.id, `${base}.unit`, item.unit, dish.id, item.id);
    });
    dish.steps.forEach((step, index) => push("recipe_step", step.id,
      `dishes.${dishIndex}.steps.${index}.instruction`, step.instruction, dish.id, null));
  });
  menu.timeline.forEach((step, index) => push("timeline", step.id,
    `timeline.${index}.instruction`, step.instruction, step.dishId, null));
  menu.adaptations.forEach((item, index) => {
    const base = `adaptations.${index}`;
    push("adaptation", item.id, `${base}.portionText`, item.portionText, item.dishId, null);
    push("adaptation", item.id, `${base}.additionalCutting`, item.additionalCutting, item.dishId, null);
    push("adaptation", item.id, `${base}.additionalHeating`, item.additionalHeating, item.dishId, null);
    push("adaptation", item.id, `${base}.additionalSeasoning`, item.additionalSeasoning, item.dishId, null);
    push("adaptation", item.id, `${base}.servingCheck`, item.servingCheck, item.dishId, null);
    item.safetyActions.forEach((action, actionIndex) => push("adaptation", item.id,
      `${base}.safetyActions.${actionIndex}.instruction`, action.instruction,
      action.dishId, action.ingredientId));
  });
  return sources;
}
```

`generation_pantry_selections.id` is persistence identity, never a food-text source identity. Do not emit a label source whose `sourceType` is `ingredient` but whose `sourceId` is a pantry-selection ID, and do not add a parallel `pantry_selection` label source type. Every `used` pantry selection must be referenced by at least one `dishIngredient.pantrySelectionId`; the validator requires `pantryUsage.dishIds` to equal the owning dishes of those exact ingredients. Food/allergen text is therefore scanned only through the already exhaustive dish-ingredient leaves. The server materializer copies the trusted pantry name only into inventory provenance and requires the normalized trusted name to match at least one linked ingredient name or an explicitly reviewed alias; `unusedReason` and units are never treated as food consumed. Add a regression where selected `カレールー` is used by a linked `カレールー` ingredient: the canonical warning has `sourceType:"ingredient"`, that ingredient's UUID and `dishes.0.ingredients.0.name`; the pantry-selection UUID never appears in any confirmation. A used selection with no linked ingredient or only an unrelated ingredient fails with `pantry_usage_link_mismatch`.

`evaluateFoodSafetyRules()` must not read `menu.safetyTags` or adaptation `safetyTags`. Resolve each catalog rule's `requiredSafetyTag` as the required `SafetyAction.kind`; evidence must match the exact ingredient source's `ingredientId`, its dish, member, and a `beforeRecipeStepId` owned by that dish. A non-ingredient matched source has no action evidence and is conservatively rejected. Reject contradiction terms (`丸ごと`, `切らず`, `骨付きのまま`, `硬いまま`) anywhere in that ingredient's dish/adaptation. The action evidence map is fixed and tested:

`underSixHardBeanAndNutContext()` in `shared/testing/factories.ts` uses the exact seeded `hard_beans_and_reviewed_nuts_under_6` row. Its hard-bean terms are qualified forms such as `煎り大豆`, `乾燥大豆`, and `節分豆`; never broaden them to bare `豆` or `大豆`. Apply `normalizeFoodText()` before matching so NFKC width and removable-space variations such as `ﾋﾟｰﾅｯﾂ` and `カシュー ナッツ` match their reviewed aliases. The soft-product negative matrix (`豆腐`, `豆乳`, `納豆`, `大豆の水煮`, `やわらかく煮た大豆`) must remain green.

```ts
const actionEvidence: Record<SafetyAction["kind"], RegExp> = {
  remove_bones: /骨を(?:完全に)?除|骨を取り除|骨がないことを確認/u,
  cut_small: /小さく切|一口大以下|細かく刻/u,
  quarter_round_food: /4等分|四等分|縦に4つ/u,
  soften: /やわらかくなるまで|舌でつぶせる|十分に煮る/u,
  heat_thoroughly: /中心まで(?:十分に)?加熱|中心温度/u,
};

const evidence = source.ingredientId === null || source.dishId === null ? undefined
  : memberActions.find(({ action }) =>
      action.kind === rule.requiredSafetyTag &&
      action.dishId === source.dishId &&
      action.ingredientId === source.ingredientId &&
      action.anonymousMemberRef === member.anonymousRef &&
      stepOwner.get(action.beforeRecipeStepId) === source.dishId &&
      actionEvidence[action.kind].test(action.instruction));
```

Implement `validateGeneratedMenu(menu, context)` in this order: generated schema; exact target/member/pantry ownership sets; medical and current-safety preconditions; meal/genre/time/role requirements; normalized main/avoid terms; must/prefer usage; portion/spice/ease adaptations; allergen and food rules. Compare provider confirmation keys including exact `sourcePath` and reject extras. On success ignore the provider array and return:

```ts
export function evaluateAllergens(
  menu:GeneratedMenu|ValidatedMenu,context:CurrentSafetyContext,
):{issues:readonly MenuValidationIssue[];
  labelConfirmations:readonly GeneratedLabelConfirmation[]} {
  // Keep the existing exhaustive text walk, but construct only
  // GeneratedLabelConfirmation rows here. Stored provenance is not part of evaluation.
}

export function deriveCurrentGeneratedLabelConfirmations(
  menu:GeneratedMenu|ValidatedMenu,context:CurrentSafetyContext,
):readonly GeneratedLabelConfirmation[]{
  return evaluateAllergens(menu,context).labelConfirmations;
}

const canonicalLabelConfirmations:readonly MenuLabelConfirmation[] =
  allergenResult.labelConfirmations.map((item) => ({
    ...item, confirmationStatus: "pending" as const,
    confirmedAt: null, confirmedBy: null,
  }));
const validatedMenu=validatedMenuSchema.parse({
  ...parsed.data,labelConfirmations:canonicalLabelConfirmations,
});
return {
  ok: true,
  menu: validatedMenu,
  labelConfirmations: validatedMenu.labelConfirmations,
  safetyFingerprint: createCurrentSafetyFingerprint(context.safety),
};
```

Replace the pre-Task-10 `evaluateAllergens` return type and its internal `confirmation` annotation; neither may remain `MenuLabelConfirmation` after the schema split. The evaluator and `deriveCurrentGeneratedLabelConfirmations` return provider-shape pending rows without `confirmedAt`/`confirmedBy`. The one `canonicalLabelConfirmations` array above is the only conversion to stored provenance and is reused for both `menu.labelConfirmations` and the successful sibling `labelConfirmations`, so strict typechecking cannot expose two incompatible representations. Tests assert exact equality of those two returned arrays and compile under `tsc --noEmit`.

The validator requires dinner roles `main + side + soup`; breakfast/lunch require one of `main|staple` plus `side`. `cuisineGenre: "any"` accepts any returned genre; all other genres require equality. Every `must_use` selection must be `used`; every unused `prefer_use` needs a non-empty reason. Every requested main ingredient must occur in dish/ingredient text, every avoided term must not occur, and returned member refs must equal the context refs with no extras.

- [ ] **Step 6: Lock immutable confirmation provenance and defer the transition (4 minutes)**

The migration is the complete Plan 2 deliverable: direct column UPDATE is revoked, immutable canonical `source_text_snapshot` is required, and neither the two- nor three-argument confirmation RPC exists. `menu_safety_actions` is normalized, owner-readable, browser-write-forbidden, and protected by menu/dish/ingredient/member/step/adaptation owner-composite links; no JSON shadow copy remains. The nullable live member link cannot cross owners, while member deletion preserves `member_display_name_snapshot`, target row, action rows, and historical menu. pgTAP proves these deletion semantics, cross-owner graphs, invalid kinds/blank instructions, canonical 1/500-character source-snapshot acceptance, blank/non-canonical/overlength rejection, and both RPC overloads' absence. Plan 3 creates the sole fingerprint-aware three-argument RPC in the same migration as the canonical current-safety locking helper and exposes the spec-locked authenticated HTTP route; browser code never invokes the RPC directly. Persistence inserts only pending label rows with null provenance, and loading a result never auto-confirms.

- [ ] **Step 7: Lift expiry checks to the planner attempt and render concrete member safety (5 minutes)**

Replace the selector-owned confirmation type/state with:

```ts
export type PlannerAttempt = {
  idempotencyKey: string;
  expiredPantryChecks: readonly ExpiredPantryCheck[];
};
export type PantrySelectorProps = {
  items: readonly PantryItem[];
  selections: readonly PantrySelectionDraft[];
  attempt: PlannerAttempt;
  onAttemptChange(next: PlannerAttempt): void;
  onChange(next: readonly PantrySelectionDraft[]): void;
  now?: () => Date;
};

export function confirmExpiredPantryItem(
  attempt: PlannerAttempt, pantryItemId: string, now: Date,
): PlannerAttempt {
  return {
    ...attempt,
    expiredPantryChecks: [
      ...attempt.expiredPantryChecks.filter((item) => item.pantryItemId !== pantryItemId),
      { pantryItemId, checkedAt: now.toISOString() },
    ],
  };
}
```

`PlannerRoute` owns one `PlannerAttempt` in state. Reload creates a new key/check list; ordinary autosave never does. Plan 3's submit handler first persists a `PendingGeneration` using this exact `idempotencyKey` and exact checks, then POSTs it. A `not_started` retry reuses both; a new/whole/dish generation creates a fresh attempt.

The final autosave contract is `useDraftAutosave(...): {state,revision,flush():Promise<PlannerDraft>}`. `flush()` joins the same serialized promise queue as the 600-ms timer, saves the latest in-memory value through `save_generation_draft`, and resolves only with the database-returned row/revision; it never computes `revision + 1` in the browser. The Generate handler must await it before saving the pending command. A stale save returns closed `draft_revision_conflict`, refetches the owner draft, keeps the user's inputs visible, and creates no generation command. Component/API tests prove revisions `1→2→3`, two-tab stale rejection, a Generate click while debounce is pending waiting for the final row, and that Plan 3 receives the exact returned `draft.id` and `draft.revision` rather than the query's earlier values. pgTAP proves direct INSERT/UPDATE is denied and the RPC increments exactly once per successful write.

Render each eligible target as a checked checkbox with its human name. Immediately below it render a concrete list using catalog display names and human labels, for example `くるみ・小麦／3〜5歳／小さく切る・骨を除く`; never show `member_1`, raw allergen IDs, or raw enum values. Tests must cover one selected and one excluded member and assert that unconfirmed/unsupported members are disabled with the reason visible.

Close the ordinary pantry mutation contract in the same gate. `pantry-api.test.ts` proves both update and delete include owner/id/version predicates, return the changed row/id, and turn a successful zero-row response into `pantry_version_conflict`. The edit/delete component tests pass the row currently rendered as `expectedUpdatedAt`; after an injected conflict the page leaves the user's edit visible, refetches only `pantryKeys.list(userId)`, announces the conflict, and never submits without a version predicate. These are the same exported functions Plan 3 must use after cooking.

- [ ] **Step 8: Provide complete reviewed breakfast/lunch/dinner fixtures and the ready-to-cook view (5 minutes)**

Keep the existing complete dinner. Add two complete `ValidatedMenu` objects with stable IDs:

- breakfast `82000000-0000-0000-0000-000000000002`: two servings, `鮭おにぎり` (`main`), `やわらか野菜` (`side`), two dishes, complete ingredients/steps/timeline, 15 minutes;
- lunch `82000000-0000-0000-0000-000000000003`: two servings, `鶏そぼろ丼` (`main`), `やわらか温野菜` (`side`), two dishes, complete ingredients/steps/timeline, 15 minutes.

Each object must pass `validatedMenuSchema.parse` at module load and have a metadata entry with exact `standardAllergenIds`, eligible age bands, reviewed date, and structured safety actions whose `ingredientId` names the exact ingredient protected by the action. Add this executable invariant rather than a partial object cast:

```ts
const reviewedFixtures = [breakfastFixture, lunchFixture, dinnerFixture] as const;
export const emergencyMenuFixturesV1 = reviewedFixtures.map((fixture) =>
  validatedMenuSchema.parse(fixture));
if (new Set(emergencyMenuFixturesV1.map((menu) => menu.mealType)).size !== 3) {
  throw new Error("Emergency fixtures must cover breakfast, lunch, and dinner");
}
```

The fixture test asserts exact meal coverage, required roles, non-empty ingredient/step/timeline arrays, `totalElapsedMinutes <= 15`, metadata for every ID, and `validateGeneratedMenu()` success for toddler, adult, and senior safe contexts. Update E2E to request all three meals and expect a concrete candidate for each; retain a separate incompatible-allergen case for the explicit no-candidate UI.

In the first Task 9 E2E scenario, replace the temporary breakfast no-candidate assertions with this final morning/noon proof. Keep the dinner 320-pixel overflow and keyboard-summary assertions and keep the second incompatible-allergen scenario unchanged:

```ts
await expect(page.getByRole("heading", {
  name: "鮭おにぎり・やわらか野菜",
})).toBeVisible();
await expect(page.getByText("食卓まで全体 15分・2人分")).toBeVisible();
await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();

await page.goto("/planner");
await page.getByRole("radio", { name: "昼食" }).check();
await expect(page.getByText("保存済み")).toBeVisible();
await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
await expect(page.getByRole("heading", {
  name: "鶏そぼろ丼・やわらか温野菜",
})).toBeVisible();
await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
expect(await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth,
)).toBe(true);
```

The emergency candidate projection test uses a target whose live display name is `子ども` and a pending processed-food label check. It verifies that server output contains only response-snapshot human member labels and human source/allergen/member warning labels for display, while the read-only component exposes the total/servings, complete integrated timeline, every dish, every ingredient and its reviewed quantity for that serving count, per-dish numbered steps, named portion instructions and ingredient-bound structured actions, used/unused/shortage pantry information, label warning, and disclaimer. At 320 CSS pixels the page has no horizontal overflow; `<summary>` is reachable and toggles with the keyboard. Rendered DOM text rejects `member_1`, catalog IDs, UUIDs, and `sourcePath` values.

- [ ] **Step 9: Run the complete Plan 2 correction gate (5 minutes)**

Run each command separately:

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run shared/contracts shared/safety shared/emergency src/features/planner src/features/pantry src/features/emergency netlify/functions
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test
docker compose run --rm app npm run e2e -- e2e/specs/menu-domain-pantry.spec.ts
docker compose run --rm --no-deps app npm run build
rg -n 'from "\.\./\.\./shared|from "\.\./\.\./src' netlify/functions/_shared
rg -n 'validateGeneratedMenu\(' shared src netlify/functions
rg -n 'confirmationStatus:\s*z\.enum\(\["pending",\s*"confirmed"\]\)|menu\.safetyTags.*required|flatMap\(\(item\) => item\.safetyTags\)' shared
rg -n '\.eq\("updated_at", expectedUpdatedAt\)' src/features/pantry/pantry-api.ts
```

Expected: all verification commands exit 0, safety-catalog pgTAP prints `1..22`, menu-core 04 prints `1..42`, and dynamically planned 04a reports 84 assertions with PASS. The import-depth and obsolete-proof searches return no output; the validator search shows only the canonical `validateGeneratedMenu(menu, GenerationContext)` definition and typed call sites; the pantry version search returns exactly the update and delete predicates. Provider-confirmed state and tag-only or wrong-ingredient safety are rejected; deterministic records are pending; immutable `source_text_snapshot` accepts exact canonical 1/500-character boundaries and rejects blank, non-canonical, and overlength values; Task 3 exposes neither confirmation RPC overload; two requirements sharing a normalized source/allergen/member but using different `sourcePath` values coexist; the single `quarter_round_food` identifier is used everywhere; concrete hard-bean and reviewed-nut spellings are rejected for under-six targets while soft processed bean products remain distinct; normalized action rows reject browser writes and cross-owner graphs; household-member deletion preserves the target snapshot, actions, and history; oversized inputs fail; pantry conflicts never overwrite a newer row; all three emergency meals expose complete read-only cooking details without raw identifiers, and the independent incompatible-allergen journey remains an explicit no-candidate state. Plan 3 owns the sole fingerprint-aware three-argument confirmation RPC and creates it with the canonical current-safety locking helper.

- [ ] **Step 10: Commit the reviewed menu-domain corrections (2 minutes)**

```bash
git add supabase/migrations/20260711000400_safety_catalog_data.sql \
  supabase/migrations/20260711001000_pantry_and_planner_drafts.sql \
  supabase/migrations/20260711001100_menu_core.sql supabase/tests/database \
  shared/contracts shared/safety shared/emergency netlify/functions \
  src/features/planner src/features/pantry src/features/emergency \
  e2e/specs/menu-domain-pantry.spec.ts
git commit -m "fix: enforce reviewed menu and pantry contracts"
```

Expected: one correction commit is created only after Step 9 is green; no unrelated path is staged.

## Execution Handoff

Plan 3 must extend its result aggregate with this exact live-inventory view contract; the generation snapshot alone is not writable state:

```ts
import type { PantryItem } from "@shared/contracts/pantry";

export type PantryPostCookTarget = {
  selectionId: string;
  pantryItemId: string | null;
  pantryItemName: string;
  plannedQuantity: number | null;
  unit: string | null;
  currentPantryRow: Pick<PantryItem,
    "id" | "name" | "quantity" | "unit" | "expiresOn" | "expirationType" |
    "openedState" | "updatedAt"> | null;
};

// Required addition to Plan 3's MenuResultViewModel.
pantryPostCookTargets: readonly PantryPostCookTarget[];
```

`getMenuResult()` builds one target for every `used` pantry-usage row and owner-RLS-reads the linked current `pantry_items` row in the same result load. `currentPantryRow.updatedAt`, never `inventoryQuantity` or another generation snapshot, is the mutation version. A deleted/unlinked row produces `pantryItemId: null` and `currentPantryRow: null`; the UI says `冷蔵庫から削除済み` and offers no mutation. A successful update synchronizes every target sharing that pantry ID and refetches the menu-result and pantry-list queries. A successful delete changes all matching visible targets to the deleted state and refetches both queries; the database's `ON DELETE SET NULL` remains authoritative.

For each non-null target, render two 44-pixel-or-larger primary choices, `使い切った` and `まだある`; do not hide them behind a generic `調理後に冷蔵庫へ反映` action and never mutate automatically. `使い切った` first asks `この食材を冷蔵庫から削除しますか？`, then calls `deletePantryItem(client,userId,id,currentPantryRow.updatedAt)`. Success announces deletion in an accessible live region and keeps `元に戻す` available until the user dismisses it or leaves the result; undo calls `createPantryItem()` with the captured name, quantity/unit, expiry kind/date, and opened state, invalidates the pantry-list query, and announces `冷蔵庫に新しい食材として戻しました`. It does not update immutable generation rows or reconnect their null FK to the new ID; the result target stays visibly completed/deleted and offers no second mutation. Cancellation performs no write.

`まだある` opens `残りの分量（任意）` and unit inputs. A blank amount deliberately saves both quantity and unit as `null`; a numeric amount requires a unit. It preserves the current name, expiry fields, and opened state and calls `updatePantryItem(client,userId,id,currentPantryRow.updatedAt,input)`. It never subtracts the AI-planned amount automatically. A `pantry_version_conflict` keeps the user's choice/input, refetches the live row/version, and says `冷蔵庫の内容が変わりました。最新の内容を確認してください`; it never retries unconditionally. Plan 3 tests must cover cancel, confirmed delete, undo recreation, blank and numeric remaining amounts, already-deleted state, same-row target synchronization, and update/delete conflicts.

Plan 2 is independently complete only when Task 10's correction gate passes and a reviewer confirms the catalog seed, sole `quarter_round_food` identifier, under-six hard-bean/reviewed-nut concrete-name matrix and soft-bean-product negative matrix, canonical pending-confirmation behavior, immutable canonical `source_text_snapshot` provenance, absence of both confirmation RPC overloads, ingredient-bound normalized safety actions, menu/dish/ingredient/member/step/adaptation owner-composite FKs, optimistic pantry mutation predicates, complete human-labelled emergency candidates, and all three emergency fixture metadata records. Plan 3 owns insertion/readback/UI of these exact rows and the sole fingerprint-aware three-argument confirmation RPC created with the canonical current-safety locking helper; it may not introduce a JSON shadow representation. Execute with `superpowers:subagent-driven-development` (recommended, one fresh worker and two-stage review per task) or `superpowers:executing-plans` (inline batches with review checkpoints). Do not begin Plan 3 until Tasks 1–10 and this gate pass.
