# 緊急献立対応力改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand reviewed emergency fixtures to 9–12, add two-stage main-ingredient matching with explicit `safety_only` fallback, wire `path`/`matchMode`/`emptyReason`, ship household disclosure UI (banner + post-API emptyReason copy), then add idea personal candidates with non-confusable chrome, planner/generation entry points, and updated e2e.

**Architecture:** Server-only `filterEmergencyMenus` keeps Stage S fail-closed (current safety + reviewed metadata + `validateGeneratedMenu` with **always** `HouseholdGenerationContext`). Stage M tries AND forward match on dish/ingredient names; on zero match, returns the Stage S set with `matchMode: "safety_only"` instead of emptying. Idea reuses the same fixtures via synthetic adult context and never calls family safety RPC. Browser parses strict response fields and shows path-conditional disclosure banners driven only by `matchMode`/`path` (never by free-form message parsing). **Server `message` (§4) and UI banner/intro/empty body (§5) are separate strings** — UI must not parse `message` to choose chrome.

**Tech Stack:** Node.js 24, TypeScript strict, Zod, Vitest/RTL, Netlify Functions, React 19, TanStack Query 5, Playwright, Docker Compose `app` service.

**Spec (authoritative):** `docs/superpowers/specs/2026-07-28-emergency-menu-capability-design.md` (human sign-off 2026-07-28). Supersedes Plan 7 §4.2 / §209 idea empty-only contract; MVP §9.3 remains absolute for `path=household`.

## Global Constraints

- Run Node/npm via `docker compose run --rm --no-deps app …` (separate tool calls; no `&&` chains for Docker/git).
- User-facing copy and code comments: Japanese. Identifiers/tests: English.
- Do **not** bump menu `schemaVersion` (stays `"2026-07-11.v1"`). Only `emergencyFixtureVersion` → `"2026-07-28.v1"`.
- Never relax Stage S (unconfirmed allergy, unmapped custom allergy, unsupported diet, allergen ∩ metadata, age band, validation failure).
- Never log names/emails/allergies free text/prompts/raw AI output.
- Browser imports only `@shared/emergency/contracts` (not `filter-emergency-menus` / `idea-context` / `node:*`).
- **Train A merge gate:** Tasks 1–5 land on main **together** (or same train). Do not ship two-stage fallback without household `safety_only` banner (Task 5) and post-API emptyReason body copy.
- **Train B merge gate:** Tasks 6–9. Product “done” only after Task 9.
- **Intermediate typecheck:** Tasks 1–4 are **not** individually typecheck-clean. After Task 1, `EmergencyMenusData` requires `path`/`matchMode`/`emptyReason`, so `netlify/functions/emergency-menus.ts` and browser fixtures that omit them fail typecheck/parse until later Tasks fill them. Do **not** claim Task 1–4 commits are CI-green on full `typecheck`. Only **Task 5 Step 4 (Train A package)** is the typecheck + lint + format:check gate for Train A. Optionally squash A1–A4 locally; per-Task commits remain OK if the train merges only when Task 5 package is green.
- Work only in worktree branch `feature/emergency-menu-capability` (verified worktree root: this checkout). Confirm with `git branch --show-current` at handoff if unsure.
- One Conventional Commit in Japanese per Task after focused verify (focused tests for that Task; full typecheck only where the Task says so).

### Copy authority (banner ≠ message)

| Surface | Authority | Notes |
|---------|-----------|--------|
| Wire `message` | Design §4 message matrix | May include「固定候補」; used in handler tests / empty `h2` fallback only |
| UI `safety_only` banner | Design §5 exact plain JP | Household has **no**「固定」and ends with `。` |
| UI intro | Design §5 exact plain JP | Idea includes 家族/年齢 + 調理前確認 |
| UI post-API empty body | Design §5 “API 後 empty” | Driven by `emptyReason` + `path`, not by parsing `message` |

---

## File Structure

```text
shared/emergency/
  contracts.ts              # wire Zod: path, matchMode, emptyReason (+ exported types)
  contracts.test.ts
  fixtures.v1.ts            # 9–12 fixtures, fixtureVersion bump
  filter-emergency-menus.ts # two-stage match; always HouseholdGenerationContext
  filter-emergency-menus.test.ts
  idea-context.ts           # NEW: synthetic adult CurrentSafetyContext for idea
  idea-context.test.ts      # NEW
netlify/functions/
  emergency-menus.ts        # query targetMode, path, messages, idea branch
  _tests/emergency-menus.test.ts
src/features/emergency/
  emergency-menu-api.ts     # request union; always send targetMode
  emergency-menu-api.test.ts
  emergency-menu-page.tsx   # enablement, chrome, banners, post-API emptyReason UX
  emergency-menu-page.test.tsx
  emergency-menu-page.cache.test.tsx
src/features/planner/components/
  review-step.tsx           # idea path: personal emergency CTA (Task 8)
  planner-wizard.test.tsx   # idea review CTA expectations
src/features/generation/components/
  generation-status-panel.tsx       # idea: show emergency link at BOTH RecoveryLinks (~62) and request_conflict (~203)
  generation-status-panel.test.tsx  # rewrite hide-for-idea → show-for-idea (failed + request_conflict)
e2e/specs/
  generation-recovery-results.spec.ts
  menu-domain-pantry.spec.ts  # chicken-allergy empty + any main_ingredient empty rewrites
docs/superpowers/specs/
  2026-07-28-emergency-menu-capability-design.md  # already signed off
```

---

### Task 1: Wire contracts — `path` / `matchMode` / `emptyReason`

**Files:**
- Modify: `shared/emergency/contracts.ts`
- Modify: `shared/emergency/contracts.test.ts`

**Interfaces:**
- Produces:
  - `emergencyMatchModes = ["none", "main_ingredient", "safety_only"] as const`
  - `emergencyEmptyReasons = ["current_safety_unavailable", "no_matching_fixture"] as const`
  - `emergencyPaths = ["household", "idea"] as const`
  - `EmergencyMatchMode`, `EmergencyEmptyReason`, `EmergencyPath` via `z.infer` / `(typeof …)[number]` — **single source of truth** for filter/handler (Task 3 imports these; do not redefine string unions elsewhere).
  - `emergencyMenusDataSchema` gains required:
    - `path: z.enum(emergencyPaths)`
    - `matchMode: z.enum(emergencyMatchModes).nullable()`
    - `emptyReason: z.enum(emergencyEmptyReasons).nullable()`
  - SuperRefine: non-empty candidates ⇔ `emptyReason === null && matchMode !== null`; empty ⇔ reverse; if `path === "idea"` then `emptyReason` is null or `"no_matching_fixture"` only.
- Consumes: existing `emergencyMenuCandidateSchema`.

- [ ] **Step 1: RED — extend contract tests**

In `contracts.test.ts`, extend the complete success parse fixture with:

```ts
path: "household",
matchMode: "none",
emptyReason: null,
```

Add cases:

```ts
it("rejects missing path/matchMode/emptyReason on strict schema", () => {
  const base = {
    fixtureVersion: "2026-07-28.v1",
    candidates: [],
    message: "条件に合う緊急献立がありません",
    consumesAiQuota: false as const,
    // intentionally omit path / matchMode / emptyReason
  };
  expect(() => emergencyMenusDataSchema.parse(base)).toThrow();
});

it("rejects idea path with current_safety_unavailable", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "idea",
      matchMode: null,
      emptyReason: "current_safety_unavailable",
    }),
  ).toThrow();
});

it("accepts empty household with no_matching_fixture", () => {
  expect(
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "household",
      matchMode: null,
      emptyReason: "no_matching_fixture",
    }).emptyReason,
  ).toBe("no_matching_fixture");
});

// superRefine 不変条件（欠落フィールド以外）
it("rejects non-empty candidates when emptyReason is set", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [
        {
          menu: makeValidatedMenu(),
          memberLabels: {},
          allergenLabels: {},
          labelWarnings: [],
        },
      ],
      message: "AIを使わない15分緊急献立です",
      consumesAiQuota: false,
      path: "household",
      matchMode: "none",
      emptyReason: "no_matching_fixture",
    }),
  ).toThrow();
});

it("rejects empty candidates when matchMode is non-null", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "household",
      matchMode: "none",
      emptyReason: "no_matching_fixture",
    }),
  ).toThrow();
});

it("rejects idea empty with emptyReason null", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "idea",
      matchMode: null,
      emptyReason: null,
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/contracts.test.ts`  
Expected: FAIL (schema lacks new fields / superRefine).

- [ ] **Step 3: GREEN — implement schema**

```ts
export const emergencyMatchModes = ["none", "main_ingredient", "safety_only"] as const;
export const emergencyEmptyReasons = [
  "current_safety_unavailable",
  "no_matching_fixture",
] as const;
export const emergencyPaths = ["household", "idea"] as const;

export type EmergencyMatchMode = (typeof emergencyMatchModes)[number];
export type EmergencyEmptyReason = (typeof emergencyEmptyReasons)[number];
export type EmergencyPath = (typeof emergencyPaths)[number];

export const emergencyMenusDataSchema = z
  .object({
    fixtureVersion: z.string().trim().min(1),
    candidates: z.array(emergencyMenuCandidateSchema),
    message: z.string().trim().min(1),
    consumesAiQuota: z.literal(false),
    path: z.enum(emergencyPaths),
    matchMode: z.enum(emergencyMatchModes).nullable(),
    emptyReason: z.enum(emergencyEmptyReasons).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const nonEmpty = value.candidates.length > 0;
    if (nonEmpty) {
      if (value.emptyReason !== null || value.matchMode === null) {
        context.addIssue({
          code: "custom",
          message: "非空候補では emptyReason=null かつ matchMode 必須",
        });
      }
    } else if (value.emptyReason === null || value.matchMode !== null) {
      context.addIssue({
        code: "custom",
        message: "空候補では emptyReason 必須かつ matchMode=null",
      });
    }
    if (
      value.path === "idea" &&
      value.emptyReason !== null &&
      value.emptyReason !== "no_matching_fixture"
    ) {
      context.addIssue({
        code: "custom",
        path: ["emptyReason"],
        message: "idea の emptyReason は no_matching_fixture のみ",
      });
    }
  });
```

- [ ] **Step 4: Run GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/contracts.test.ts`  
Expected: PASS.  
**Do not** run full-repo `typecheck` expecting green — consumer call sites still omit new fields until Tasks 4–5.

- [ ] **Step 5: Commit**

```bash
git add shared/emergency/contracts.ts shared/emergency/contracts.test.ts
git commit -m "feat: 緊急献立レスポンスにpathとmatchModeを追加"
```

---

### Task 2: Catalog 9–12 fixtures + coverage gates

**Files:**
- Modify: `shared/emergency/fixtures.v1.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts` (coverage / uniqueness / alias tests; **rewrite existing assumptions** that break under multi-fixture catalog; filter Stage M still old until Task 3)

**Interfaces:**
- Produces: `emergencyFixtureVersion = "2026-07-28.v1"`; `emergencyMenuFixturesV1` length 9–12; metadata for every menuId.
- Locked slots (existing 3 kept; add ≥6):

| Slot | mealType | protein | standardAllergenIds rule |
|------|----------|---------|--------------------------|
| existing | breakfast | salmon | `["salmon"]` |
| new | breakfast | egg | includes `egg`, no `chicken` |
| new | breakfast | tofu-veg non-egg | no `chicken`/`egg`/`salmon` (declare `soy` if 豆腐 present) |
| existing | lunch | chicken | `["chicken"]` |
| new | lunch | fish non-egg | no `chicken`/`egg` |
| new | lunch | egg **or** tofu non-egg | with fish slot satisfies chicken+egg |
| existing | dinner | chicken | `["chicken"]` |
| new | dinner | fish non-egg | no `chicken`/`egg` |
| new | dinner | egg **or** tofu non-egg | with fish slot satisfies chicken+egg |
| optional | lunch/dinner pork | if matrix still fails | declare `pork` if 豚肉 used |

- menu `schemaVersion` **always** `"2026-07-11.v1"`.
- New menuIds use unused `82000000-0000-4000-8000-00000000001x` or `84…` band; never `83000000-0000-4000-8000-000000000001` (idea synthetic member).
- Every dish needs ingredient-bound `cut_small` (and `heat_thoroughly` / `remove_bones` where tags require) matching existing dinner/breakfast evidence style (`一口大以下`, `骨を完全に除いて`, `中心まで十分に加熱`).

**Existing tests that MUST stay green (acceptance gates — do not delete):**

| Test (current titles in `filter-emergency-menus.test.ts`) | Constraint after expand |
|------------------------------------------------------------|-------------------------|
| complete reviewed fixtures (roles, timeline, ingredients, metadata 1:1) | Still enforces dinner `main+side+soup`; breakfast/lunch main\|staple + side; ≤15 min; metadata keys === menuIds |
| age-band validation `post_weaning_to_2` / `adult` / `senior` | Every fixture validates with age defaults (`remove_bones`+`cut_small` under-6) |
| under-six defaults non-empty through filter | Stage S non-empty for under-six context per mealType |
| cut_small dish coverage loop (`cutSmallDishIds.size === menu.dishes.length`) | Preserve for every menu including new fixtures |
| ingredient-bound action evidence stems | Keep existing stem expectations for **existing** 3 fixtures; new fixtures must satisfy same binding style |

**Existing tests that MUST be rewritten in this Task (catalog expand breaks them):**

1. **“exactly three mealType entries”** (lines 24–29 today):  
   `expect(…map mealType toSorted()).toEqual(["breakfast","dinner","lunch"])` → fails as multiset.  
   Replace with: set covers all three mealTypes; length 9–12; metadata 1:1 (runtime guard at `fixtures.v1.ts` set size === 3 remains OK).
2. **“returns no candidate when one member is incompatible with the remapped fixture”** (chicken on second member + dinner → assumed empty). After expand, non-chicken dinners remain.  
   Rewrite options (pick one and document in test comment):
   - **Preferred:** second member allergenIds = **union of all metadata `standardAllergenIds`** for dinner fixtures → still `no_matching_fixture`; or
   - Assert only chicken-bearing dinners drop while ≥1 non-chicken dinner remains (then this is no longer an empty test — rename accordingly).
3. **“prefers safety exclusion over main-ingredient when every fixture is unsafe”** (chicken-only → assumed Stage S empty).  
   Rewrite to design coverage row: **union of all fixture `standardAllergenIds`** + mainIngredients e.g. `["鶏肉"]` → still `menus: []`, `emptyReason: "no_matching_fixture"` (and after Task 3 also `matchMode: null`).  
   Until Task 3, result shape still omits `matchMode` — assert only `menus` + `emptyReason` here if filter not yet updated; Task 3 will add `matchMode: null` to the same assertion.
4. **Handler test** `uses the generic empty message when a standard allergen excludes every fixture` (`netlify/functions/_tests/emergency-menus.test.ts`, chicken-only) — if this file is run in CI against expanded fixtures before Task 4 rewrites it, it fails. **Either** rewrite it in Task 2 to use full allergen union **or** leave a Task 2 note that Task 4 must rewrite it in the same train before any package test that runs handler tests. **This plan:** rewrite the assertion body in Task 4 (union allergens); Task 2 only fixes unit tests under `shared/emergency/`.

- [ ] **Step 1: RED — rewrite completeness + matrix + alias + regression empties**

**1a. Rewrite fixture completeness first:**

```ts
it("provides complete reviewed fixtures for every meal", () => {
  const mealTypes = emergencyMenuFixturesV1.map((menu) => menu.mealType);
  expect(new Set(mealTypes)).toEqual(new Set(["breakfast", "lunch", "dinner"]));
  expect(emergencyMenuFixturesV1.length).toBeGreaterThanOrEqual(9);
  expect(emergencyMenuFixturesV1.length).toBeLessThanOrEqual(12);
  // … keep existing per-menu role / timeline / ingredients / minutes checks …
  expect(Object.keys(emergencyFixtureMetadataV1).toSorted()).toEqual(
    emergencyMenuFixturesV1.map((menu) => menu.menuId).toSorted(),
  );
});
```

**1b. Coverage matrix (includes full-union empty cell):**

```ts
import { normalizeFoodText } from "../safety/allergens.js";
import { currentAllergenCatalogV1 } from "../safety/current-allergen-catalog.v1.js";

const adultContext = (allergenIds: readonly string[]) =>
  makeCurrentSafetyContext({
    members: [
      {
        ...makeCurrentSafetyContext().members[0]!,
        ageBand: "adult",
        allergenIds: [...allergenIds],
        allergyStatus: allergenIds.length === 0 ? "none" : "registered",
        requiredSafetyConstraints: [],
        unsupportedDietStatus: "none",
        hasUnmappedCustomAllergy: false,
      },
    ],
    foodSafetyRules: currentFoodSafetyRulesV1,
  });

const matrix: readonly { name: string; allergens: readonly string[] }[] = [
  { name: "none", allergens: [] },
  { name: "chicken", allergens: ["chicken"] },
  { name: "salmon", allergens: ["salmon"] },
  { name: "egg", allergens: ["egg"] },
  { name: "chicken+salmon", allergens: ["chicken", "salmon"] },
  { name: "chicken+egg", allergens: ["chicken", "egg"] },
];

it.each(matrix)("coverage matrix $name yields ≥1 per mealType", ({ allergens }) => {
  for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
    const result = filterEmergencyMenus({
      mealType,
      pantryNames: [],
      context: adultContext(allergens),
    });
    expect(result.menus.length, `${mealType}/${allergens.join("+") || "none"}`).toBeGreaterThan(0);
    expect(result.emptyReason).toBeNull();
  }
});

it("union of all metadata standardAllergenIds yields no_matching_fixture per mealType", () => {
  const union = [
    ...new Set(
      Object.values(emergencyFixtureMetadataV1).flatMap((meta) => meta.standardAllergenIds),
    ),
  ];
  expect(union.length).toBeGreaterThan(0);
  for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
    const result = filterEmergencyMenus({
      mealType,
      pantryNames: [],
      context: adultContext(union),
    });
    expect(result.menus, mealType).toEqual([]);
    expect(result.emptyReason, mealType).toBe("no_matching_fixture");
  }
});
```

**1c. Rewrite chicken-empty unit tests (Issue 1):**

```ts
it("returns no candidate when one member blocks every dinner fixture via allergen union", () => {
  const base = makeCurrentSafetyContext();
  const firstMember = base.members[0]!;
  const dinnerUnion = [
    ...new Set(
      emergencyMenuFixturesV1
        .filter((menu) => menu.mealType === "dinner")
        .flatMap((menu) => emergencyFixtureMetadataV1[menu.menuId]!.standardAllergenIds),
    ),
  ];
  const result = filterEmergencyMenus({
    mealType: "dinner",
    pantryNames: [],
    context: makeCurrentSafetyContext({
      members: [
        firstMember,
        {
          ...firstMember,
          householdMemberId: "55000000-0000-4000-8000-000000000002",
          anonymousRef: "member_2",
          allergyStatus: "registered",
          allergenIds: dinnerUnion,
        },
      ],
    }),
  });
  expect(result.menus).toEqual([]);
  expect(result.emptyReason).toBe("no_matching_fixture");
});

it("prefers safety exclusion over main-ingredient when every fixture is unsafe", () => {
  const context = makeCurrentSafetyContext();
  const union = [
    ...new Set(
      Object.values(emergencyFixtureMetadataV1).flatMap((meta) => meta.standardAllergenIds),
    ),
  ];
  const result = filterEmergencyMenus({
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    pantryNames: [],
    context: makeCurrentSafetyContext({
      members: [
        {
          ...context.members[0]!,
          allergyStatus: "registered",
          allergenIds: union,
        },
      ],
    }),
  });
  // メイン食材があっても、安全条件で候補が0なら no_matching_fixture（Stage M に到達しない）
  expect(result.menus).toEqual([]);
  expect(result.emptyReason).toBe("no_matching_fixture");
});
```

**1d. Version / UUID / alias + catalog-id ⊆ catalog:**

```ts
it("fixtureVersion is 2026-07-28.v1 and menu schemaVersion stays 2026-07-11.v1", () => {
  expect(emergencyFixtureVersion).toBe("2026-07-28.v1");
  for (const menu of emergencyMenuFixturesV1) {
    expect(menu.schemaVersion).toBe("2026-07-11.v1");
  }
  expect(emergencyMenuFixturesV1.length).toBeGreaterThanOrEqual(9);
  expect(emergencyMenuFixturesV1.length).toBeLessThanOrEqual(12);
});

it("all fixture UUIDs are unique and avoid idea synthetic member id", () => {
  const ideaMember = "83000000-0000-4000-8000-000000000001";
  const ids: string[] = [];
  for (const menu of emergencyMenuFixturesV1) {
    ids.push(menu.menuId);
    for (const dish of menu.dishes) {
      ids.push(dish.id, ...dish.ingredients.map((i) => i.id), ...dish.steps.map((s) => s.id));
    }
    ids.push(...menu.timeline.map((t) => t.id), ...menu.adaptations.map((a) => a.id));
  }
  expect(ids).not.toContain(ideaMember);
  expect(new Set(ids).size).toBe(ids.length);
});

it("metadata standardAllergenIds cover catalog displayName and alias exact hits; ids ⊆ catalog", () => {
  const catalogIds = new Set(currentAllergenCatalogV1.map((e) => e.id));
  // displayName と alias の両方を exact normalize 対象にする（複合語は人手レビュー）
  const byNormalizedName = new Map<string, string>();
  for (const entry of currentAllergenCatalogV1) {
    byNormalizedName.set(normalizeFoodText(entry.displayName), entry.id);
  }
  // factory と同型: catalog displayName を alias としても載せる実装が多い。
  // 追加 alias が dictionary に存在する場合は makeCurrentSafetyContext().allergenDictionary.aliases も走査する。
  const dictionaryAliases = makeCurrentSafetyContext().allergenDictionary.aliases;
  for (const alias of dictionaryAliases) {
    byNormalizedName.set(normalizeFoodText(alias.normalizedAlias), alias.allergenId);
    byNormalizedName.set(normalizeFoodText(alias.alias), alias.allergenId);
  }

  for (const menu of emergencyMenuFixturesV1) {
    const meta = emergencyFixtureMetadataV1[menu.menuId]!;
    for (const id of meta.standardAllergenIds) {
      expect(catalogIds.has(id), `unknown catalog id ${id} on ${menu.menuId}`).toBe(true);
    }
    for (const dish of menu.dishes) {
      for (const ingredient of dish.ingredients) {
        const hit = byNormalizedName.get(normalizeFoodText(ingredient.name));
        if (hit !== undefined) {
          expect(meta.standardAllergenIds, ingredient.name).toContain(hit);
        }
      }
    }
  }
});
```

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/filter-emergency-menus.test.ts`  
Expected: FAIL (version still old / only 3 fixtures / matrix fails on chicken for lunch+dinner / rewrites pending GREEN).

- [ ] **Step 3: GREEN — author fixtures**

**Authoring template (mandatory):**

1. Set `export const emergencyFixtureVersion = "2026-07-28.v1" as const;`
2. Keep existing three fixtures **byte-stable** on menuIds and dish structure.
3. **Clone `dinnerFixture` / `breakfastFixture` / `lunchFixture` structure** (dishes, timeline, per-dish adaptations with ingredient-bound `safetyActions`). Do **not** invent a flatter shape without adaptations/timeline.
4. Dinner roles **must** be `main` + `side` + `soup`. Breakfast/lunch: `main|staple` + `side`.
5. Under-6 validation: include evidence stems `一口大以下` / `骨を完全に除いて` (fish with bones) / `中心まで十分に加熱` as existing fixtures do. Fish food-rule matchTerms (さば/鯖 etc.) require boneless language **or** `remove_bones` actions.
6. `cut_small` coverage: every dish id appears in at least one `cut_small` safetyAction.
7. Suggested cookable menus (names fixed for matrix; adjust only if validation fails):

| menuId suffix | meal | name sketch | allergens |
|---------------|------|-------------|-----------|
| …010 | breakfast | 卵のしょうゆかけごはん + きゅうり | `egg` (no chicken) |
| …011 | breakfast | 冷ややっこ + 野菜 | `soy` only if 豆腐; no chicken/egg/salmon |
| …012 | lunch | 塩さばのフライパン焼き + 副菜 | `mackerel` (not egg/chicken) |
| …013 | lunch | 豆腐とわかめの味噌汁定食短時間 or 卵焼き丼 | egg **or** soy; not chicken |
| …014 | dinner | 塩さば + 副菜 + スープ | `mackerel` |
| …015 | dinner | 豆腐ハンバーグ短時間 or 豚肉野菜いため + soup | soy and/or `pork`; **not chicken+egg** |

8. `eligibleAgeBands: allReviewedAgeBands`, `reviewedAt: "2026-07-28"`.
9. Register metadata for every new menuId.
10. Ensure each mealType has ≥1 fixture with `standardAllergenIds` intersecting neither chicken nor egg.
11. Do not invent soy sauce as unlabeled wheat/soy if catalog exact-match test would require declaration—prefer salt seasoning for simple fixtures.

- [ ] **Step 4: Run GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/filter-emergency-menus.test.ts`  
Expected: PASS (matrix ≥1 rows, full-union empty, completeness, age-band, cut_small loop, rewritten chicken-empty cases).  
Note: `main_ingredient_no_match` assertions still pass under **old** Stage M until Task 3.

- [ ] **Step 5: Commit**

```bash
git add shared/emergency/fixtures.v1.ts shared/emergency/filter-emergency-menus.test.ts
git commit -m "feat: 緊急献立fixtureを2026-07-28.v1へ拡充"
```

---

### Task 3: Two-stage filter (delete `main_ingredient_no_match`)

**Files:**
- Modify: `shared/emergency/filter-emergency-menus.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts`

**Interfaces:**
- Produces (types from contracts — no duplicate unions):

```ts
import type {
  EmergencyEmptyReason,
  EmergencyMatchMode,
} from "./contracts.js";

export type EmergencyFilterResult = {
  menus: readonly ValidatedMenu[];
  emptyReason: EmergencyEmptyReason | null;
  matchMode: EmergencyMatchMode | null;
};
```

- Algorithm (exact, design §1):
  1. Gate → `{ menus: [], emptyReason: "current_safety_unavailable", matchMode: null }`
  2. Stage S → `safetyCompatibleMenus` (unchanged validation; `emergencyGenerationContext` stays `targetMode: "household"`)
  3. Stage M:
     - mains empty → `selected = safetyCompatible`, `matchMode = "none"`
     - mainMatched.length > 0 → `selected = mainMatched`, `matchMode = "main_ingredient"`
     - mainMatched empty && safetyCompatible non-empty → `selected = safetyCompatible`, `matchMode = "safety_only"`
     - both empty → `selected = []`, `emptyReason = "no_matching_fixture"`, `matchMode = null`
  4. pantry sort on `selected`
  5. non-empty → `emptyReason: null`, return `{ menus, emptyReason, matchMode }`

- [ ] **Step 1: RED — inventory + rewrite every `main_ingredient_no_match` / result shape**

Run (host): `rg "main_ingredient_no_match" shared/ netlify/ src/ e2e/ --glob '!docs/**'`  
Expected hits today (must all be rewritten this Task or Task 4 for handler messages):

| Location | Current expectation | After Task 3 |
|----------|---------------------|--------------|
| `filter-emergency-menus.test.ts` 豚肉 unrelated | `toEqual({ menus: [], emptyReason: "main_ingredient_no_match" })` | non-empty, `matchMode: "safety_only"`, `emptyReason: null` |
| same file instruction-only `湯` | empty main_ingredient_no_match | safety_only non-empty (no dish/ingredient name contains 湯 as main match → fallback) |
| same file shortToken `塩鮭` on dinner chicken | empty main_ingredient_no_match | safety_only non-empty |
| same file over-match `鶏 肉` / `鶏。肉` / ZWSP | empty main_ingredient_no_match | safety_only non-empty |
| same file matching `鶏`+`きゅうり` | length 1 | keep non-empty + `matchMode: "main_ingredient"` |
| gate / unavailable / full-union empties | `{ menus: [], emptyReason: "…" }` | add `matchMode: null` |
| multi-member / prefers safety exclusion | empty no_matching | add `matchMode: null` |
| `filter-emergency-menus.ts` type + branch | delete reason | delete |
| handler tests (Task 4 same train) | old empty message for 豚肉 | Task 4: non-empty safety_only message |

Replace main-ingredient empty expectations with:

```ts
it("falls back to safety_only when main ingredients do not match", () => {
  const result = filterEmergencyMenus({
    mealType: "dinner",
    mainIngredients: ["存在しないメイン食材XYZ"],
    pantryNames: [],
    context: adultContext([]),
  });
  expect(result.emptyReason).toBeNull();
  expect(result.matchMode).toBe("safety_only");
  expect(result.menus.length).toBeGreaterThan(0);
});

it("returns main_ingredient when all mains match dish or ingredient names", () => {
  const result = filterEmergencyMenus({
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    pantryNames: [],
    context: adultContext([]),
  });
  expect(result.matchMode).toBe("main_ingredient");
  expect(result.emptyReason).toBeNull();
  expect(result.menus.length).toBeGreaterThan(0);
});

it("returns none when main ingredients empty", () => {
  const result = filterEmergencyMenus({
    mealType: "dinner",
    mainIngredients: [],
    pantryNames: [],
    context: adultContext([]),
  });
  expect(result.matchMode).toBe("none");
  expect(result.emptyReason).toBeNull();
});

// Update every remaining toEqual on filter results, e.g.:
// expect(result).toEqual({ menus: [], emptyReason: "current_safety_unavailable", matchMode: null });
// expect(result).toEqual({ menus: [], emptyReason: "no_matching_fixture", matchMode: null });
```

Also update existing tests that used full-object equality without `matchMode` (gate, multi-member empty, prefers safety exclusion, over-match cases now safety_only).

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/filter-emergency-menus.test.ts`  
Expected: FAIL (old empty reason / missing matchMode).

- [ ] **Step 3: GREEN — full `filterEmergencyMenus` return paths**

Replace the function body return logic (keep Stage S loop / remap / validate as-is; only change matching + returns). Concrete implementation:

```ts
export function filterEmergencyMenus(input: {
  mealType: MealType;
  mainIngredients?: readonly string[];
  pantryNames: readonly string[];
  context: CurrentSafetyContext;
  memberLabels?: Readonly<Record<string, string>>;
}): EmergencyFilterResult {
  const mainIngredients = (input.mainIngredients ?? []).map(normalizeMainIngredientForMatch);

  // 1) Stage S 前ゲート
  if (
    input.context.members.length === 0 ||
    input.context.members.some(
      (member) =>
        member.allergyStatus === "unconfirmed" ||
        member.hasUnmappedCustomAllergy ||
        member.unsupportedDietStatus !== "none",
    )
  ) {
    return {
      menus: [],
      emptyReason: "current_safety_unavailable",
      matchMode: null,
    };
  }

  const pantry = input.pantryNames.map(normalizeFoodText).filter((name) => name !== "");

  // 2) Stage S（validation は常に HouseholdGenerationContext — targetMode: "household"）
  const safetyCompatibleMenus = emergencyMenuFixturesV1
    .filter((menu) => menu.mealType === input.mealType)
    .flatMap((menu) => {
      const metadata = emergencyFixtureMetadataV1[menu.menuId];
      if (
        metadata === undefined ||
        input.context.members.some(
          (member) =>
            !metadata.eligibleAgeBands.includes(member.ageBand) ||
            member.allergenIds.some((allergenId) =>
              metadata.standardAllergenIds.includes(allergenId),
            ),
        )
      ) {
        return [];
      }
      const remapped = remapFixtureForMembers(menu, input.context.members);
      const validated = validateGeneratedMenu(
        remapped,
        emergencyGenerationContext(remapped, input.context, input.memberLabels ?? {}),
      );
      return validated.ok ? [validated.menu] : [];
    });

  // 3) Stage M
  let selected: readonly ValidatedMenu[];
  let matchMode: EmergencyMatchMode | null;
  let emptyReason: EmergencyEmptyReason | null;

  if (mainIngredients.length === 0) {
    selected = safetyCompatibleMenus;
    matchMode = safetyCompatibleMenus.length > 0 ? "none" : null;
    emptyReason = safetyCompatibleMenus.length > 0 ? null : "no_matching_fixture";
  } else {
    const mainMatched = safetyCompatibleMenus.filter((menu) => {
      const candidateNames = menu.dishes.flatMap((dish) => [
        normalizeMainIngredientForMatch(dish.name),
        ...dish.ingredients.map((ingredient) =>
          normalizeMainIngredientForMatch(ingredient.name),
        ),
      ]);
      return mainIngredients.every((mainIngredient) =>
        candidateNames.some((candidateName) => candidateName.includes(mainIngredient)),
      );
    });
    if (mainMatched.length > 0) {
      selected = mainMatched;
      matchMode = "main_ingredient";
      emptyReason = null;
    } else if (safetyCompatibleMenus.length > 0) {
      selected = safetyCompatibleMenus;
      matchMode = "safety_only";
      emptyReason = null;
    } else {
      selected = [];
      matchMode = null;
      emptyReason = "no_matching_fixture";
    }
  }

  // 4) pantry sort（既存）
  const menus = [...selected].sort((left, right) => {
    const score = (menu: ValidatedMenu) =>
      collectMenuTextSources(menu).filter((source) =>
        pantry.some((name) => normalizeFoodText(source.text).includes(name)),
      ).length;
    return score(right) - score(left) || left.menuId.localeCompare(right.menuId);
  });

  return { menus, emptyReason, matchMode };
}
```

Update `EmergencyFilterResult` type as in Interfaces. **Delete** every `main_ingredient_no_match` branch and type member.

Comment near `emergencyGenerationContext` (Japanese): idea 経路でも常に `targetMode: "household"` を渡す。`validateIdeaMenu` は adaptations を拒否し fixture が全滅するため禁止。wire の `path: "idea"` が製品上の真実。

- [ ] **Step 4: grep-kill**

Run: `rg "main_ingredient_no_match" --glob '!docs/**' --glob '!.worktrees/**'` from worktree root  
Expected: zero hits in `shared/`, `src/`, `netlify/`, `e2e/`. Fix any remainder (handler message branches → Task 4 if still present, fix in this train before merge).

- [ ] **Step 5: Run GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/emergency/filter-emergency-menus.ts shared/emergency/filter-emergency-menus.test.ts
git commit -m "feat: 緊急献立のメイン食材フォールバックを追加"
```

---

### Task 4: Handler household wire + message matrix

**Files:**
- Modify: `netlify/functions/emergency-menus.ts`
- Modify: `netlify/functions/_tests/emergency-menus.test.ts`

**Interfaces:**
- Query: Task 4 accepts only household (default). Parse optional `targetMode`; if `targetMode=idea` → 400 `invalid_request` with message `検索条件を確認してください` and fieldErrors key `targetMode` until Task 6.
- Response `data` always includes `path: "household"`, `matchMode`, `emptyReason` from filter, `fixtureVersion` from fixtures.

**§4 server message matrix (household only this task)** — UI banner is Task 5 and is **different** for `safety_only`:

| condition | message (wire) |
|-----------|----------------|
| non-empty && matchMode in none/main_ingredient | `AIを使わない15分緊急献立です` |
| non-empty && safety_only | `メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています` |
| empty (any emptyReason) | `条件に合う緊急献立がありません` |

Delete handler branch for old main-ingredient-only empty string `選択したメイン食材に合う固定候補がありません`.

- [ ] **Step 1: RED — handler tests (mirror existing deps pattern)**

Use `createEmergencyMenusHandler` + mocks like existing tests:

```ts
const userId = "80000000-0000-4000-8000-000000000001";
const memberId = "81000000-0000-4000-8000-000000000001";

it("returns matchMode safety_only and new message when mains miss", async () => {
  const handler = createEmergencyMenusHandler({
    authenticate: () => Promise.resolve({ userId }),
    loadContext: () =>
      Promise.resolve({
        context: makeCurrentSafetyContext(),
        memberLabels: Object.freeze({ member_1: "家族1" }),
      }),
    loadPantryNames: () => Promise.resolve([]),
  });
  const query = new URLSearchParams({
    meal: "dinner",
    targetMemberIds: memberId,
    mainIngredients: "存在しないメイン食材XYZ",
  });
  const res = await handler(
    new Request(`http://localhost/api/emergency-menus?${query.toString()}`),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true,
    data: {
      path: "household",
      matchMode: "safety_only",
      emptyReason: null,
      consumesAiQuota: false,
      message: "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています",
    },
  });
  expect(body.data.candidates.length).toBeGreaterThan(0);
  expect(body.data.message).not.toContain("選択したメイン食材に合う固定候補がありません");
});

it("rejects targetMode=idea until idea path ships", async () => {
  const loadContext = vi.fn();
  const handler = createEmergencyMenusHandler({
    authenticate: () => Promise.resolve({ userId }),
    loadContext,
    loadPantryNames: () => Promise.resolve([]),
  });
  const res = await handler(
    new Request(
      `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&targetMode=idea`,
    ),
  );
  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toMatchObject({
    ok: false,
    error: {
      code: "invalid_request",
      message: "検索条件を確認してください",
    },
  });
  expect(loadContext).not.toHaveBeenCalled();
});
```

Update **all** existing success/empty response assertions in this file to include `path` / `matchMode` / `emptyReason`:

- unsupported diet / unmapped → `path: "household"`, `matchMode: null`, `emptyReason: "current_safety_unavailable"`, message generic empty
- 豚肉 / adversarial over-match → non-empty `matchMode: "safety_only"`, new safety_only **server** message (not empty)
- chicken-only “excludes every fixture” → rewrite allergens to **full metadata union** (catalog expand); still empty `no_matching_fixture` + generic message
- success with 鶏肉 match → `matchMode: "main_ingredient"` or `"none"` as appropriate

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_tests/emergency-menus.test.ts`  
Expected: FAIL.

- [ ] **Step 3: GREEN — handler household wire**

```ts
// after filterEmergencyMenus + candidates map
const path = "household" as const;
const message =
  candidates.length === 0
    ? "条件に合う緊急献立がありません"
    : filtered.matchMode === "safety_only"
      ? "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています"
      : "AIを使わない15分緊急献立です";

return json(200, {
  ok: true,
  data: {
    fixtureVersion: emergencyFixtureVersion,
    candidates,
    message,
    consumesAiQuota: false,
    path,
    matchMode: filtered.matchMode,
    emptyReason: filtered.emptyReason,
  },
});
```

For `targetMode` temporary reject: extend query parse so `targetMode` optional enum; if value is `"idea"`, return 400 before auth/DB (same shape as invalid_request). Household default when omitted + members present remains as today.

- [ ] **Step 4: Run GREEN (focused)**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_tests/emergency-menus.test.ts shared/emergency`  
Expected: tests PASS.  
**Do not** claim full-repo typecheck green — browser request/response fixtures still lack fields until Task 5.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/emergency-menus.ts netlify/functions/_tests/emergency-menus.test.ts
git commit -m "feat: 緊急献立APIにpathとmatchModeを載せる"
```

---

### Task 5: Client parse + household banner + post-API empty UX (Train A ship lock)

**Files:**
- Modify: `src/features/emergency/emergency-menu-api.ts`
- Modify: `src/features/emergency/emergency-menu-api.test.ts`
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `src/features/emergency/emergency-menu-page.test.tsx`
- Modify: `src/features/emergency/emergency-menu-page.cache.test.tsx` (any response fixtures)

**Interfaces:**
- Request (household only this task): always send `targetMode=household`.

```ts
const emergencyMenuRequestSchema = z
  .object({
    mealType: z.enum(mealTypes),
    mainIngredients: emergencyMainIngredientsSchema,
    targetMode: z.literal("household"),
    targetMemberIds: z.array(z.uuid()).min(1).max(20).refine(/* unique */),
    pantryItemIds: z.array(z.uuid()).max(50).refine(/* unique */),
  })
  .strict();
```

- Query string includes `targetMode=household`.
- `emergencyMenuKeys.candidates` includes `targetMode`.
- **Page `request` const must include `targetMode: "household"`** (current page lines ~143–148 omit it — parse will fail once schema requires it).

**UI banner (design §5 — NOT §4 server message):**

When `response.path === "household" && response.matchMode === "safety_only" && candidates.length > 0`:

Exact: `メイン食材は一致しませんでした。安全条件に合う候補を表示しています。`  
(no「固定」, trailing `。`)  
Trigger = `matchMode` only (never parse `message`).

**A11y (design §5):** wrap the `safety_only` banner in `role="status"` or `role="note"` (pick one and keep consistent; design allows either). Prefer `role="status"` for the banner. Task 8 also puts idea intro on `role="status"` or `role="note"`.

**UI post-API empty body (design §5) — Task 5 implements household rows; idea row lands in Task 8:**

| emptyReason | path | Body copy (exact for tests) |
|-------------|------|------------------------------|
| `current_safety_unavailable` | household | `アレルギー確認未了または対応できない食事条件のため、候補を表示していません。条件は緩めていません` |
| `no_matching_fixture` | household | `いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません` |
| `no_matching_fixture` | idea | `固定候補を表示できませんでした` (Task 8; schema allows household-only responses in A) |

Empty section still may show wire `message` as heading (`条件に合う緊急献立がありません`) for contract alignment; **body** differentiates by `emptyReason`. Remove sole reliance on fixed `条件を緩めず、候補を表示していません。` for all empties — replace body with the table above. Optional: keep a single non-relax sentence only if it does not duplicate the table strings awkwardly; prefer design table as sole body.

- [ ] **Step 1: RED — API + page tests**

```ts
// emergency-menu-api.test.ts
it("always sends targetMode=household on the query string", async () => {
  // mock fetch; call getEmergencyMenus({…, targetMode: "household", …})
  // expect URL to include targetMode=household
});

// emergency-menu-page.test.tsx
it("shows household safety_only banner only when matchMode is safety_only", () => {
  render(
    <EmergencyMenuContent
      loading={false}
      error={null}
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [/* one valid candidate */],
        message: "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています",
        consumesAiQuota: false,
        path: "household",
        matchMode: "safety_only",
        emptyReason: null,
      }}
    />,
  );
  const banner = screen.getByRole("status", {
    name: /メイン食材は一致しませんでした。安全条件に合う候補を表示しています。/,
  });
  // name 無しなら getByRole("status") + getByText exact の併用でも可
  expect(
    screen.getByText(
      "メイン食材は一致しませんでした。安全条件に合う候補を表示しています。",
    ),
  ).toBeVisible();
  expect(banner).toBeVisible();
  // §4 server message may differ; banner must not require「固定」
  expect(
    screen.queryByText(
      "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています",
    ),
  ).toBeNull();
});

it("does not show safety_only banner when matchMode is none", () => {
  // matchMode none → queryByText household banner → null; queryByRole status for that banner → null
});

it("shows differentiated post-API empty copy for current_safety_unavailable", () => {
  render(
    <EmergencyMenuContent
      loading={false}
      error={null}
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
        path: "household",
        matchMode: null,
        emptyReason: "current_safety_unavailable",
      }}
    />,
  );
  expect(
    screen.getByText(
      "アレルギー確認未了または対応できない食事条件のため、候補を表示していません。条件は緩めていません",
    ),
  ).toBeVisible();
});

it("shows differentiated post-API empty copy for household no_matching_fixture", () => {
  // emptyReason no_matching_fixture → いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません
});
```

Update every mock `EmergencyMenusData` in page/api/cache tests with new fields.

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/emergency`  
Expected: FAIL.

- [ ] **Step 3: GREEN**

1. Extend request schema + `getEmergencyMenus` query (`targetMode` always) + keys.
2. **Update `EmergencyMenuPage` `request` const** to include `targetMode: "household"` and pass it into keys/queryFn.
3. In `EmergencyMenuContent`, accept `response` with new fields:
   - Banner when `matchMode === "safety_only" && path === "household"` with §5 household string, wrapped in `<p role="status">` (or `role="note"`).
   - Empty body switch on `emptyReason` (+ `path` for idea placeholder if response can be idea later).
4. Keep household intro copy for now (idea chrome is Task 8):  
   `現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。`

- [ ] **Step 4: Verify Train A package**

Run (separate tool calls):

```bash
docker compose run --rm --no-deps app npx vitest run shared/emergency src/features/emergency netlify/functions/_tests/emergency-menus.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

Expected: all PASS. **This is the first Task where full typecheck is required green.**

- [ ] **Step 5: Commit**

```bash
git add src/features/emergency
git commit -m "feat: 緊急献立のメイン食材フォールバックをUI開示する"
```

**Train A complete.** Do not mark product success done.

---

### Task 6: Idea server path (`idea-context` + filter + handler)

**Files:**
- Create: `shared/emergency/idea-context.ts`
- Create: `shared/emergency/idea-context.test.ts`
- Modify: `shared/emergency/filter-emergency-menus.ts` (export `emergencyGenerationContext` **or** a thin `buildEmergencyGenerationContextForTests` if needed for spy — prefer exporting the existing builder for unit contract test)
- Modify: `netlify/functions/emergency-menus.ts`
- Modify: `netlify/functions/_tests/emergency-menus.test.ts`

**Interfaces:**
- `buildIdeaPersonalSafetyContext(): { context: CurrentSafetyContext; memberLabels: Readonly<Record<string, string>> }`
  - Synthetic member id `83000000-0000-4000-8000-000000000001`
  - `anonymousRef: "member_1"`, ageBand `adult`, allergy none, no unmapped, unsupported none, empty requiredSafetyConstraints
  - Labels: `{ member_1: "あなた" }`
  - dictionary/food rule versions from current catalogs
- Filter always uses `emergencyGenerationContext` with `targetMode: "household"`.
- Handler idea: **no** `loadContext`; **yes** `loadPantryNames`; idea + filter `current_safety_unavailable` → **500** fail-closed.

**Query resolution (design §3 — implement verbatim):**

```ts
const mealSchema = z.enum(mealTypes);
const targetModeSchema = z.enum(["household", "idea"]);

// 未知キーは拒否しない（.strict() にしない）
const rawQuerySchema = z.object({
  meal: mealSchema,
  mainIngredients: emergencyMainIngredientsSchema,
  targetMode: targetModeSchema.optional(),
  targetMemberIds: z.string().optional(),
  pantryItemIds: z.string().optional(),
});

// ★ critical: URLSearchParams.get は欠落時 null。Zod .optional() は undefined のみ受理。
// null を渡すと idea omit / targetMode omit が 400 になる。必ず ?? undefined する。
const url = new URL(request.url);
const rawParsed = rawQuerySchema.safeParse({
  meal: url.searchParams.get("meal") ?? undefined,
  mainIngredients: url.searchParams.getAll("mainIngredients"),
  targetMode: url.searchParams.get("targetMode") ?? undefined,
  // キー未送出 → null → undefined（omit）
  // キーあり空文字 ?targetMemberIds= → ""（idea では 400。omit と混同しない）
  targetMemberIds: url.searchParams.get("targetMemberIds") ?? undefined,
  pantryItemIds: url.searchParams.get("pantryItemIds") ?? undefined,
});

// 正規化後:
// 1. targetMode 欠落 (undefined):
//    - targetMemberIds が valid 非空 CSV → household
//    - それ以外（undefined / "" / invalid） → 400 invalid_request
// 2. targetMode=idea:
//    - targetMemberIds が undefined（キー未送出）のみ許可
//    - 空文字 "" や "," や UUID リスト → 400（omit と区別）
// 3. targetMode=household:
//    - targetMemberIds は uuidListSchema(20) 必須（1..20 unique）
// 4. pantryItemIds: 既存 optional uuidListSchema(50); undefined → []
// 5. 未知 targetMode 文字列 → Zod enum で 400
// fieldErrors キー: meal, mainIngredients, targetMode, targetMemberIds, pantryItemIds
// error.code: "invalid_request"
// Task 4 temporary idea reject is removed by this resolution.
```

**§4 idea message matrix** (wire — UI still hides non-empty message; **handler tests must assert wire message**):

| condition | message |
|-----------|---------|
| non-empty none/main_ingredient | `AIを使わない15分緊急献立です。アレルギー条件は適用していません` |
| non-empty safety_only | `メイン食材は一致しませんでした。アレルギー条件は適用していません` |
| empty | `条件に合う緊急献立がありません` |

Note: Non-empty UI disclosure is banner/intro only; wire `message` still must match matrix for handler/contract tests.

- [ ] **Step 1: RED — full named tests**

```ts
// idea-context.test.ts
it("builds adult none-allergy context with fixed synthetic member id", () => {
  const { context, memberLabels } = buildIdeaPersonalSafetyContext();
  expect(context.members).toHaveLength(1);
  expect(context.members[0]!.householdMemberId).toBe(
    "83000000-0000-4000-8000-000000000001",
  );
  expect(context.members[0]!.allergyStatus).toBe("none");
  expect(context.foodRuleVersion).toBe("jp-caa-child-shape-2026-07.v1");
  expect(memberLabels.member_1).toBe("あなた");
});

// filter-emergency-menus.test.ts or idea-context adjacent
it("idea personal filter returns ≥1 per mealType", () => {
  for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
    const { context, memberLabels } = buildIdeaPersonalSafetyContext();
    const result = filterEmergencyMenus({
      mealType,
      pantryNames: [],
      context,
      memberLabels,
    });
    expect(result.menus.length, mealType).toBeGreaterThan(0);
    expect(result.emptyReason).toBeNull();
  }
});

it("idea filter validates fixtures with generation context targetMode household", () => {
  // 方針 A: export emergencyGenerationContext し、builder 契約で targetMode === "household"
  // 方針 B: vi.spyOn(validateGeneratedMenu module) で渡された context.targetMode を記録
  // 必須: idea パスで validateIdeaMenu 分岐に入らないこと
  const { context, memberLabels } = buildIdeaPersonalSafetyContext();
  const gen = emergencyGenerationContext(
    emergencyMenuFixturesV1[0]!,
    context,
    memberLabels,
  );
  expect(gen.targetMode).toBe("household");
  expect(gen.submission.targetMode).toBe("household");
});

// handler — netlify/functions/_tests/emergency-menus.test.ts
it("rejects idea with targetMemberIds", async () => { /* 400 fieldErrors.targetMemberIds */ });
it("rejects idea with empty-string targetMemberIds", async () => {
  // ?targetMode=idea&targetMemberIds=  or ","
});
it("treats omitted targetMode + members as household", async () => {
  // loadContext called; path household
});
it("rejects omitted targetMode without members", async () => { /* 400 */ });
it("rejects unknown targetMode", async () => { /* 400 */ });
it("idea path does not call loadContext", async () => {
  const loadContext = vi.fn();
  const handler = createEmergencyMenusHandler({
    authenticate: () => Promise.resolve({ userId }),
    loadContext,
    loadPantryNames: () => Promise.resolve([]),
  });
  const res = await handler(
    new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMode=idea`),
  );
  expect(res.status).toBe(200);
  expect(loadContext).not.toHaveBeenCalled();
  const body = await res.json();
  expect(body.data.path).toBe("idea");
  expect(body.data.candidates.length).toBeGreaterThan(0);
  expect(body.data.message).toContain("アレルギー条件は適用していません");
});
it("idea path loads pantry names without loadContext", async () => {
  // pantry ids present → loadPantryNames called with those ids; loadContext not called
});
it("household path calls loadContext once", async () => { /* existing shape + path household */ });
it("returns 500 when idea filter yields current_safety_unavailable", async () => {
  // force via deps that inject broken idea context OR spy filterEmergencyMenus to return unavailable
  // expect status 500; never 200 with emptyReason current_safety_unavailable on idea
});
```

Remove/replace Task 4 test `rejects targetMode=idea until idea path ships`.

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency netlify/functions/_tests/emergency-menus.test.ts`  
Expected: FAIL (missing module / idea branch).

- [ ] **Step 3: GREEN — idea-context + handler resolution**

**`shared/emergency/idea-context.ts`:**

```ts
import type { CurrentSafetyContext } from "../safety/context.js";
import {
  currentAllergenCatalogV1,
  currentAllergenCatalogVersion,
} from "../safety/current-allergen-catalog.v1.js";
import { currentFoodSafetyRulesV1 } from "../safety/current-food-safety-rules.v1.js";

const IDEA_SYNTHETIC_MEMBER_ID = "83000000-0000-4000-8000-000000000001";
// makeCurrentSafetyContext / currentFoodSafetyRulesV1 と同じ版。
// 誤ると validateGeneratedMenu の版検査で Stage S が全滅する。
const IDEA_FOOD_RULE_VERSION = "jp-caa-child-shape-2026-07.v1" as const;
// 代替: currentFoodSafetyRulesV1[0]!.ruleVersion（リテラルと一致すること）

export function buildIdeaPersonalSafetyContext(): {
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
} {
  return {
    memberLabels: Object.freeze({ member_1: "あなた" }),
    context: {
      dictionaryVersion: currentAllergenCatalogVersion,
      foodRuleVersion: IDEA_FOOD_RULE_VERSION,
      requestText: "",
      members: [
        {
          householdMemberId: IDEA_SYNTHETIC_MEMBER_ID,
          anonymousRef: "member_1",
          ageBand: "adult",
          allergyStatus: "none",
          allergenIds: [],
          hasUnmappedCustomAllergy: false,
          requiredSafetyConstraints: [],
          unsupportedDietStatus: "none",
          unsupportedDietKinds: [],
        },
      ],
      allergenDictionary: {
        version: currentAllergenCatalogVersion,
        catalog: currentAllergenCatalogV1.map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          catalogVersion: entry.catalogVersion,
        })),
        aliases: currentAllergenCatalogV1.map((entry) => ({
          allergenId: entry.id,
          alias: entry.displayName,
          normalizedAlias: entry.displayName,
          aliasKind: "direct" as const,
          requiresLabelConfirmation: false,
          dictionaryVersion: entry.catalogVersion,
        })),
      },
      foodSafetyRules: [...currentFoodSafetyRulesV1],
    },
  };
}
```

**Handler parse + idea branch (after auth):**

After `rawParsed` succeeds, resolve household/idea per rules above (empty-string `targetMemberIds` is **not** omit). Then:

```ts
const pantryNames = await deps.loadPantryNames(userId, resolved.pantryItemIds);

if (resolved.targetMode === "idea") {
  const idea = buildIdeaPersonalSafetyContext();
  const filtered = filterEmergencyMenus({
    mealType: resolved.meal,
    mainIngredients: resolved.mainIngredients,
    pantryNames,
    context: idea.context,
    memberLabels: idea.memberLabels,
  });
  if (filtered.emptyReason === "current_safety_unavailable") {
    // 到達しない想定のバグ。偽の 200 empty にしない。
    throw new Error("idea_emergency_current_safety_unavailable");
  }
  const candidates = filtered.menus.map((menu) =>
    buildEmergencyMenuCandidate({
      menu,
      context: idea.context,
      memberLabels: idea.memberLabels,
    }),
  );
  const message =
    candidates.length === 0
      ? "条件に合う緊急献立がありません"
      : filtered.matchMode === "safety_only"
        ? "メイン食材は一致しませんでした。アレルギー条件は適用していません"
        : "AIを使わない15分緊急献立です。アレルギー条件は適用していません";
  return json(200, {
    ok: true,
    data: {
      fixtureVersion: emergencyFixtureVersion,
      candidates,
      message,
      consumesAiQuota: false,
      path: "idea",
      matchMode: filtered.matchMode,
      emptyReason: filtered.emptyReason,
    },
  });
}
// else household: existing loadContext path + §4 household messages
```

Export `emergencyGenerationContext` from filter module if tests need it (name can stay; Japanese comment that production idea path must use it with household targetMode).

- [ ] **Step 4: Run GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency netlify/functions/_tests/emergency-menus.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/emergency/idea-context.ts shared/emergency/idea-context.test.ts \
  shared/emergency/filter-emergency-menus.ts shared/emergency/filter-emergency-menus.test.ts \
  netlify/functions/emergency-menus.ts netlify/functions/_tests/emergency-menus.test.ts
git commit -m "feat: アイデアモードの緊急献立個人パスをサーバーに追加"
```

---

### Task 7: Client idea request arm

**Files:**
- Modify: `src/features/emergency/emergency-menu-api.ts`
- Modify: `src/features/emergency/emergency-menu-api.test.ts`

**Interfaces:**

```ts
const emergencyMenuRequestSchema = z.discriminatedUnion("targetMode", [
  z
    .object({
      mealType: z.enum(mealTypes),
      mainIngredients: emergencyMainIngredientsSchema,
      targetMode: z.literal("household"),
      targetMemberIds: z.array(z.uuid()).min(1).max(20).refine((ids) => new Set(ids).size === ids.length),
      pantryItemIds: z.array(z.uuid()).max(50).refine((ids) => new Set(ids).size === ids.length),
    })
    .strict(),
  z
    .object({
      mealType: z.enum(mealTypes),
      mainIngredients: emergencyMainIngredientsSchema,
      targetMode: z.literal("idea"),
      targetMemberIds: z.tuple([]), // length 0 only
      pantryItemIds: z.array(z.uuid()).max(50).refine((ids) => new Set(ids).size === ids.length),
    })
    .strict(),
]);
```

- idea: query has `targetMode=idea`, **omit** `targetMemberIds` param entirely.
- keys include `targetMode`.

- [ ] **Step 1: RED**

```ts
it("sends targetMode=idea and omits targetMemberIds on the query string", async () => {
  // mock fetch; getEmergencyMenus({ targetMode: "idea", targetMemberIds: [], … })
  // URL has targetMode=idea and does not include targetMemberIds=
});

it("rejects idea requests with non-empty targetMemberIds at the client schema", () => {
  expect(() =>
    // parse or getEmergencyMenus with one uuid
  ).toThrow();
});
```

- [ ] **Step 2: GREEN** — implement discriminated union + query builder branch.

- [ ] **Step 3: Run** `docker compose run --rm --no-deps app npx vitest run src/features/emergency/emergency-menu-api.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/features/emergency/emergency-menu-api.ts src/features/emergency/emergency-menu-api.test.ts
git commit -m "feat: 緊急献立APIクライアントにideaアームを追加"
```

---

### Task 8: Idea UI chrome + enablement + entry points + idea banner + empty + Realtime gate

**Files:**
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `src/features/emergency/emergency-menu-page.test.tsx`
- Modify: `src/features/emergency/emergency-menu-page.cache.test.tsx`
- Modify: `src/features/planner/components/review-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.test.tsx` (idea review CTA)
- Modify: `src/features/generation/components/generation-status-panel.tsx`
- Modify: `src/features/generation/components/generation-status-panel.test.tsx` (exists; rewrite hide-for-idea)

**Product decision (design supersedes Plan 7):** idea may show **personal** emergency candidates. Entry points are **not** deep-link-only:

| Entry | After Task 8 |
|-------|----------------|
| `/emergency-menus` with idea draft | candidates + idea chrome |
| Planner review (`review-step.tsx`) | idea shows CTA `AIを使わない緊急献立を見る` (same handler as household flush→navigate); remove block note `家族向けの緊急献立は…` |
| Generation recovery (`generation-status-panel.tsx`) | show emergency link for idea at **both** sites (see GREEN step 4) |

**Interfaces:** implement design §5 enablement pseudocode exactly, **including loading chrome path**:

```ts
const draft = draftQuery.data;
const draftReady =
  draftQuery.isSuccess && draft !== null && draft !== undefined && !draftQuery.isFetching;
const isIdea = draft?.targetMode === "idea";
const isHouseholdPath =
  draft !== null && draft !== undefined && draft.targetMode !== "idea";

// design §5: loading 中も draft から chrome を決める。response.path だけに頼らない。
const expectedPath: "household" | "idea" = isIdea ? "idea" : "household";

const householdQueryEnabled =
  userId !== undefined && draftQuery.isSuccess && !draftQuery.isFetching && isHouseholdPath;
const safetyRealtimeEnabled = householdQueryEnabled; // Realtime / 60s poll も同条件

const targetMemberIds = isIdea
  ? []
  : shouldResolveUnselectedTargets
    ? eligibleMemberIds.slice(0, 20)
    : draft?.targetMode === "household"
      ? draft.targetMemberIds.filter((id) => eligibleMemberIds.includes(id)).slice(0, 20)
      : [];

const candidateQueryEnabled =
  userId !== undefined &&
  draftReady &&
  (isIdea ||
    (householdQueryEnabled && householdQuery.isSuccess && targetMemberIds.length > 0));

const request = isIdea
  ? {
      mealType,
      mainIngredients,
      targetMode: "idea" as const,
      targetMemberIds: [] as const,
      pantryItemIds,
    }
  : {
      mealType,
      mainIngredients,
      targetMode: "household" as const,
      targetMemberIds,
      pantryItemIds,
    };

// chromePath: response 確定時は wire path を正とする。loading / error 時は expectedPath。
// 旧 path の candidates は loading 中 visibleResponse=null で消す（既存）。
return (
  <EmergencyMenuContent
    loading={loading}
    error={error}
    expectedPath={expectedPath}
    response={loading || error !== null ? null : (query.data ?? null)}
  />
);
```

**`EmergencyMenuContent` prop contract (Task 8 — extend beyond Task 5):**

```ts
export function EmergencyMenuContent({
  loading,
  error,
  expectedPath,
  response,
}: {
  loading: boolean;
  error: string | null;
  /** draft 由来。loading 中 intro/empty chrome の正本 */
  expectedPath: "household" | "idea";
  response: EmergencyMenusData | null;
}) {
  const visibleResponse = loading || error !== null ? null : response;
  // wire path があれば優先（サーバ真実）。無ければ draft 推定。
  const chromePath = visibleResponse?.path ?? expectedPath;
  // intro / safety_only banner / post-API empty は chromePath で分岐
  // candidates は visibleResponse のみ（loading 中 0）
}
```

Gate the existing Realtime `useEffect` with `safetyRealtimeEnabled` / `householdQueryEnabled` (today depends only on `[userId]` and always subscribes — **must change**).

**Chrome (design §5 exact) — driven by `chromePath`, not by free-form message:**

| path | intro (`role="status"` or `role="note"`) |
|------|-------|
| household | `現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。` |
| idea | `個人向けの固定候補です。家族のアレルギー・年齢条件は適用していません。AI利用回数は消費しません。調理前に原材料表示と家庭内の混入を確認してください。` |

| path | `safety_only` banner (`role="status"` or `role="note"`) |
|------|----------------------|
| household | `メイン食材は一致しませんでした。安全条件に合う候補を表示しています。` |
| idea | `メイン食材は一致しませんでした。アレルギー条件は適用していません。` |

Post-API empty idea: `固定候補を表示できませんでした`.

Delete idea pre-API block copy `アイデアモードでは緊急献立を表示できません…`.

- [ ] **Step 1: RED component tests** (names from design + entry points)

```ts
// emergency-menu-page.test.tsx / cache
it("shows household safety_only banner only when matchMode is safety_only", () => { /* Task 5; keep */ });
it("shows idea safety_only banner without family-safety wording", () => {
  // path idea, matchMode safety_only → exact idea banner via role=status/note
  // queryByText("安全条件に合う") → null
});
it("does not show household safety_only banner text on idea path", () => { /* … */ });
it("shows idea intro and hides household intro", () => {
  // idea intro exact (full §5 string including 調理前…) on role=status|note
  // household intro exact absent
});
it("shows idea intro during loading before response arrives", () => {
  // expectedPath="idea", loading=true, response=null
  // idea intro visible; household intro absent; no 候補 N; no candidates section
});
it("enables idea candidate query without household members", () => { /* getEmergencyMenus called with targetMode idea */ });
it("does not request idea path when draft is household", () => { /* … */ });
it("does not fallback to idea when eligible members empty", () => { /* pre-API household empty stays */ });
it("clears idea candidates and chrome when draft switches to household before refetch completes", () => {
  // design §5 cache fail-closed: loading 中は旧 idea candidates 非表示
  // expectedPath が household に切り替わったら household intro、idea intro 不在
});
it("does not subscribe household Realtime or safety poll when draft is idea", () => {
  // mock getBrowserSupabaseClient channel; expect subscribe count 0 on idea
  // or assert channel() not called when isIdea
});
it("shows idea post-API empty copy for no_matching_fixture", () => {
  // 固定候補を表示できませんでした
});

// planner-wizard.test.tsx
it("idea の review では個人向け緊急献立 CTA を出す", () => {
  // button AIを使わない緊急献立を見る visible
  // 旧案内「家族向けの緊急献立は…」不在
});

// generation-status-panel.test.tsx — BOTH call sites
// 既存 it("hides emergency recovery link for idea target mode") を書き換え:
it("shows emergency recovery link for idea target mode on failed recovery", () => {
  render(<GenerationStatusPanel state={failedState} targetMode="idea" />);
  expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toHaveAttribute(
    "href",
    "/emergency-menus",
  );
});
it("shows emergency recovery link for idea target mode on request_conflict", () => {
  // state.phase === "request_conflict" の fixture を使う（panel 内 2 箇所目の showEmergencyLink）
  render(<GenerationStatusPanel state={requestConflictState} targetMode="idea" />);
  expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toBeInTheDocument();
});
```

- [ ] **Step 2: GREEN**

1. Page enablement + `expectedPath` prop + intro/banner/empty keyed off `chromePath` as above.
2. Realtime effect: `if (!safetyRealtimeEnabled) return;` before channel setup; deps include enablement flag.
3. `review-step.tsx`: for idea + `onOpenEmergencyMenus`, render the same secondary button as household; remove idea-only block `<p role="note">家族向けの緊急献立は…`.
4. `generation-status-panel.tsx` — **two independent gates** (worktree verified):
   - `RecoveryLinks` (~line 62): `const showEmergencyLink = true;` (or delete the condition and always render the link). Update C-I6 comment to cite this design’s personal path.
   - `request_conflict` branch (~line 203): same — `const showEmergencyLink = true;` (or always render). Partial edit of only RecoveryLinks leaves idea users without the link on conflict.
5. Rewrite `generation-status-panel.test.tsx` hide-for-idea → show-for-idea for **failed** and **request_conflict**.
6. Update planner-wizard tests accordingly.
7. Wrap idea intro and both path banners in `role="status"` or `role="note"`.

- [ ] **Step 3: focused verify**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/emergency src/features/planner/components/planner-wizard.test.tsx src/features/generation
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 4: Commit**

```bash
git add src/features/emergency src/features/planner/components/review-step.tsx \
  src/features/planner/components/planner-wizard.test.tsx \
  src/features/generation/components/generation-status-panel.tsx \
  src/features/generation/components/generation-status-panel.test.tsx
git commit -m "feat: アイデアモード緊急献立の開示UIを追加"
```

---

### Task 9: E2E contract rewrite

**Files:**
- Modify: `e2e/specs/generation-recovery-results.spec.ts`
- Modify: `e2e/specs/menu-domain-pantry.spec.ts` (**required**, not optional)

**Before claiming done**, host-grep e2e for regressions:

```bash
rg "条件に合う緊急献立|アイデアモードでは緊急|main_ingredient|鶏肉を追加" e2e/
```

**1) `generation-recovery-results.spec.ts` — 5-route smoke / idea draft**

Current listener (≈588–595) treats **all** `/api/emergency-menus` as forbidden family-safety. After idea enablement that breaks.

**Replace classification (design REST ban list — not optional soft skips):**

```ts
// 許可: GET /api/emergency-menus?targetMode=idea
// 禁止（idea 訪問中 activeRoute==="emergency-menus" でも 0 件）:
//   - household emergency API
//   - shopping / generation / revalidate
//   - get_current_safety_snapshot RPC
//   - PostgREST household_members / member_allergies（settings 以外。activeRoute で settings を除外済み）
page.on("request", (request) => {
  if (activeRoute === null) return;
  const url = new URL(request.url());
  const path = url.pathname;

  const isEmergencyMenus = path === "/api/emergency-menus";
  const isIdeaEmergency =
    isEmergencyMenus && url.searchParams.get("targetMode") === "idea";

  const isSafetyRpc =
    path.endsWith("/rest/v1/rpc/get_current_safety_snapshot") ||
    path.includes("/rpc/get_current_safety_snapshot");
  const isHouseholdMembersRead =
    path.includes("/rest/v1/household_members") || path.endsWith("/household_members");
  const isMemberAllergiesRead =
    path.includes("/rest/v1/member_allergies") || path.endsWith("/member_allergies");

  const isDisallowedSideEffect =
    (isEmergencyMenus && !isIdeaEmergency) ||
    path.startsWith("/api/shopping-lists/") ||
    path === "/api/generations/dish" ||
    /^\/api\/menus\/[^/]+\/revalidate$/u.test(path) ||
    isSafetyRpc ||
    // emergency-menus 訪問中の家族表読込は禁止（settings は activeRoute が settings のときだけ許容）
    (activeRoute === "emergency-menus" && (isHouseholdMembersRead || isMemberAllergiesRead));

  if (isDisallowedSideEffect) {
    familySafetyRequests[activeRoute].push(path + url.search);
  }
});
// rename 推奨: disallowedSafetySideEffectRequests
```

For this skipped-user smoke: idea draft visit **may** call idea emergency API. Assert:

- heading `15分緊急献立` visible
- idea intro exact **or** `getByText("候補 1")` / candidate article visible
- **not** old empty `アイデアモードでは緊急献立を表示できません…`
- `familySafetyRequests["emergency-menus"]` (or renamed) equals `[]` after idea visit — covers non-idea emergency, shopping/generation/revalidate, **and** `get_current_safety_snapshot` / `household_members` / `member_allergies`

Draft-none visit: keep empty without API.

**2) `menu-domain-pantry.spec.ts` — chicken allergy case (critical)**

Test `keeps an incompatible current allergy as an explicit no-candidate result` (≈649–677): registers 鶏肉, expects `条件に合う緊急献立がありません`. Design matrix requires chicken-only → **≥1 per mealType**.

**Rewrite to one of:**

**(a) True empty via full allergen union (harder in UI)** — not practical via settings buttons alone.

**(b) Recommended:** change product assertion to chicken-only success.  
**Do not** use `/分/` — page title is always `15分緊急献立`, so bare `分` is a **false green** even with zero candidates.

```ts
test("keeps chicken-allergic household on non-chicken emergency candidates without relaxing copy", async ({
  completedOnboardingPage: page,
}) => {
  // … register 鶏肉 as today …
  await advanceToReviewWithHousehold(page, "夕食");
  await page.goto("/emergency-menus");
  // 鶏のみでは catalog 上 ≥1 候補（設計 coverage）
  await expect(page.getByText("条件に合う緊急献立がありません")).toHaveCount(0);
  await expect(
    page.getByText("いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません"),
  ).toHaveCount(0);
  // 非空 chrome のみ（page 実装: <p class="emergency-candidate-number">候補 {n}</p>）
  await expect(page.getByText("候補 1", { exact: true })).toBeVisible();
  // 任意強化: candidate article
  await expect(page.locator("article.emergency-candidate").first()).toBeVisible();
  // 緩和していない開示（固定データ注意など既存）が残ること。safety_only バナーはメイン未指定なら出ない。
});
```

If the suite still needs an explicit empty e2e, add a separate case that uses unsupported diet / unconfirmed allergy already covered elsewhere, **not** chicken-only.

Also fix any assertion on removed main-ingredient empty message `選択したメイン食材に合う固定候補がありません` if present.

- [ ] **Step 1: RED — update assertions first**

- [ ] **Step 2: Run e2e via host**

Run: `./scripts/run-e2e.sh` scoped if project supports file filter; else full script.  
If full e2e is too heavy for the agent, ask human to run and paste summary — **do not claim PASS without evidence.**

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/generation-recovery-results.spec.ts e2e/specs/menu-domain-pantry.spec.ts
git commit -m "test: アイデアモード緊急献立のe2e契約を更新"
```

**Train B complete / product done** only after e2e evidence.

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Catalog 9–12 + coverage matrix + full-union empty | Task 2 |
| Rewrite chicken-empty unit assumptions | Task 2 |
| mealType multiset completeness | Task 2 |
| Alias + catalog id ⊆ catalog | Task 2 |
| Clone dinner/breakfast structure; cut_small / dinner roles / age-band gates | Task 2 |
| Two-stage match + delete main_ingredient_no_match + full GREEN code | Task 3 |
| matchMode on all filter result shapes; types from contracts | Task 3 |
| Wire path/matchMode/emptyReason + superRefine invariants | Task 1 |
| Household §4 messages + idea temporary 400 | Task 4 |
| Household §5 banner (≠ message) + post-API emptyReason UX | Task 5 |
| Page request always sends targetMode | Task 5 |
| Train A typecheck only at Task 5 | Global + Task 5 |
| Idea query Zod + 500 unavailable + loadContext skip | Task 6 |
| Validation context targetMode household (spy/export) | Task 6 |
| Idea client arm | Task 7 |
| Idea chrome / intro / banner / Realtime off / cache switch | Task 8 |
| expectedPath loading chrome (no household blurb flash) | Task 8 |
| Planner review + generation CTA for idea (both RecoveryLinks + request_conflict) | Task 8 |
| A11y role=status/note on intro + safety_only banners | Task 5/8 |
| Query null→undefined coerce; idea empty-string members 400 | Task 6 |
| idea-context foodRuleVersion `jp-caa-child-shape-2026-07.v1` | Task 6 |
| E2E allow idea emergency API; chicken e2e `候補 1` (not `/分/`); RPC/household_members ban | Task 9 |
| schemaVersion lock | Task 2 |
| Plan 7 supersession | Tasks 6–9 |
| Train A/B merge gates | Global Constraints + Task 5/9 |

**Placeholder policy:** Tasks 1–5 and 6–9 include full non-trivial GREEN code or algorithmic steps. Fixture **recipes** remain slot-table + clone-existing-structure + validation gates (hundreds of lines of menu JSON are authored under those gates, not pasted). No interactive “which approach?” handoff.

---

## Execution Handoff

Plan complete and saved to:

`docs/superpowers/plans/2026-07-28-emergency-menu-capability.md`

Worktree branch: `feature/emergency-menu-capability`.

**Default execution:** Subagent-Driven Development — fresh subagent per Task, review between Tasks (`superpowers:subagent-driven-development`). Inline `executing-plans` only if the human opts out of subagents.
