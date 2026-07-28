# 緊急献立対応力改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand reviewed emergency fixtures to 9–12, add two-stage main-ingredient matching with explicit `safety_only` fallback, wire `path`/`matchMode`/`emptyReason`, ship household disclosure UI, then add idea personal candidates with non-confusable chrome and updated e2e.

**Architecture:** Server-only `filterEmergencyMenus` keeps Stage S fail-closed (current safety + reviewed metadata + `validateGeneratedMenu` with **always** `HouseholdGenerationContext`). Stage M tries AND forward match on dish/ingredient names; on zero match, returns the Stage S set with `matchMode: "safety_only"` instead of emptying. Idea reuses the same fixtures via synthetic adult context and never calls family safety RPC. Browser parses strict response fields and shows path-conditional disclosure banners driven only by `matchMode`/`path` (never by free-form message parsing).

**Tech Stack:** Node.js 24, TypeScript strict, Zod, Vitest/RTL, Netlify Functions, React 19, TanStack Query 5, Playwright, Docker Compose `app` service.

**Spec (authoritative):** `docs/superpowers/specs/2026-07-28-emergency-menu-capability-design.md` (human sign-off 2026-07-28). Supersedes Plan 7 §4.2 / §209 idea empty-only contract; MVP §9.3 remains absolute for `path=household`.

## Global Constraints

- Run Node/npm via `docker compose run --rm --no-deps app …` (separate tool calls; no `&&` chains for Docker/git).
- User-facing copy and code comments: Japanese. Identifiers/tests: English.
- Do **not** bump menu `schemaVersion` (stays `"2026-07-11.v1"`). Only `emergencyFixtureVersion` → `"2026-07-28.v1"`.
- Never relax Stage S (unconfirmed allergy, unmapped custom allergy, unsupported diet, allergen ∩ metadata, age band, validation failure).
- Never log names/emails/allergies free text/prompts/raw AI output.
- Browser imports only `@shared/emergency/contracts` (not `filter-emergency-menus` / `node:*`).
- **Train A merge gate:** Tasks 1–5 land on main **together** (or same train). Do not ship two-stage fallback without household `safety_only` banner (Task 5).
- **Train B merge gate:** Tasks 6–9. Product “done” only after Task 9.
- Work only in worktree `feature/emergency-menu-capability` unless the human says otherwise.
- One Conventional Commit in Japanese per Task after focused verify.

---

## File Structure

```text
shared/emergency/
  contracts.ts              # wire Zod: path, matchMode, emptyReason
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
  emergency-menu-page.tsx   # enablement, chrome, banners
  emergency-menu-page.test.tsx
  emergency-menu-page.cache.test.tsx
e2e/specs/
  generation-recovery-results.spec.ts
  menu-domain-pantry.spec.ts  # only if main_ingredient empty messages change
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
  const base = /* existing valid data without new fields */;
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

Export inferred types for match/empty/path if useful.

- [ ] **Step 4: Run GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/contracts.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/emergency/contracts.ts shared/emergency/contracts.test.ts
git commit -m "feat: 緊急献立レスポンスにpathとmatchModeを追加"
```

---

### Task 2: Catalog 9–12 fixtures + coverage gates

**Files:**
- Modify: `shared/emergency/fixtures.v1.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts` (coverage / uniqueness / alias tests; filter still old until Task 3)

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

- [ ] **Step 1: RED — coverage matrix tests**

Add to `filter-emergency-menus.test.ts` (or `fixtures` adjacent describe):

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

it("metadata standardAllergenIds cover catalog displayName exact hits on ingredient names", () => {
  const byDisplay = new Map(
    currentAllergenCatalogV1.map((e) => [normalizeFoodText(e.displayName), e.id] as const),
  );
  for (const menu of emergencyMenuFixturesV1) {
    const meta = emergencyFixtureMetadataV1[menu.menuId]!;
    for (const dish of menu.dishes) {
      for (const ingredient of dish.ingredients) {
        const hit = byDisplay.get(normalizeFoodText(ingredient.name));
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
Expected: FAIL (version still v1 / only 3 fixtures / matrix fails on chicken for lunch+dinner).

- [ ] **Step 3: GREEN — author fixtures**

1. Set `export const emergencyFixtureVersion = "2026-07-28.v1" as const;`
2. Keep existing three fixtures **byte-stable** on menuIds and dish structure.
3. Add at least six new fixtures by **cloning the dinner/breakfast shape** (dishes + timeline + adaptations with ingredient-bound actions). Suggested cookable menus (names fixed for matrix; adjust only if validation fails):

| menuId suffix | meal | name sketch | allergens |
|---------------|------|-------------|-----------|
| …010 | breakfast | 卵のしょうゆかけごはん + きゅうり | `egg` (no chicken) |
| …011 | breakfast | 冷ややっこ + 野菜 | `soy` only if 豆腐; no chicken/egg/salmon |
| …012 | lunch | 塩さばのフライパン焼き + 副菜 | `mackerel` (not egg/chicken) |
| …013 | lunch | 豆腐とわかめの味噌汁定食短時間 or 卵焼き丼 | egg **or** soy; not chicken |
| …014 | dinner | 塩さば + 副菜 + スープ | `mackerel` |
| …015 | dinner | 豆腐ハンバーグ短時間 or 豚肉野菜いため + soup | soy and/or `pork`; **not chicken+egg** |

4. For fish fixtures: use `remove_bones` + evidence stems like breakfast salmon if bones; or boneless fillet language consistent with food rules.
5. `eligibleAgeBands: allReviewedAgeBands`, `reviewedAt: "2026-07-28"`.
6. Register metadata for every new menuId.
7. Ensure each mealType has ≥1 fixture with `standardAllergenIds` intersecting neither chicken nor egg.

Do not invent soy sauce as unlabeled wheat/soy if catalog exact-match test would require declaration—prefer salt seasoning for simple fixtures.

- [ ] **Step 4: Run GREEN**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/filter-emergency-menus.test.ts`  
Expected: PASS (including existing age-band validation each fixture).

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
- Produces:

```ts
export type EmergencyMatchMode = "none" | "main_ingredient" | "safety_only";
export type EmergencyEmptyReason =
  | "current_safety_unavailable"
  | "no_matching_fixture";

export type EmergencyFilterResult = {
  menus: readonly ValidatedMenu[];
  emptyReason: EmergencyEmptyReason | null;
  matchMode: EmergencyMatchMode | null;
};
```

- Algorithm (exact):
  1. Gate → `{ menus: [], emptyReason: "current_safety_unavailable", matchMode: null }`
  2. Stage S → `safetyCompatibleMenus` (unchanged validation; `emergencyGenerationContext` stays `targetMode: "household"`)
  3. Stage M:
     - mains empty → `selected = safetyCompatible`, `matchMode = "none"`
     - mainMatched.length > 0 → `selected = mainMatched`, `matchMode = "main_ingredient"`
     - mainMatched empty && safetyCompatible non-empty → `selected = safetyCompatible`, `matchMode = "safety_only"`
     - both empty → `selected = []`, `emptyReason = "no_matching_fixture"`, `matchMode = null`
  4. pantry sort on `selected`
  5. non-empty → `emptyReason: null`

- [ ] **Step 1: RED — rewrite main-ingredient tests**

Replace expectations that assert `main_ingredient_no_match` with:

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
});

it("returns none when main ingredients empty", () => {
  const result = filterEmergencyMenus({
    mealType: "dinner",
    mainIngredients: [],
    pantryNames: [],
    context: adultContext([]),
  });
  expect(result.matchMode).toBe("none");
});
```

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run shared/emergency/filter-emergency-menus.test.ts`  
Expected: FAIL (old empty reason / missing matchMode).

- [ ] **Step 3: GREEN — implement Stage M**

Update `filterEmergencyMenus` return paths; **delete** every `main_ingredient_no_match` branch.

- [ ] **Step 4: grep-kill**

Run: `rg "main_ingredient_no_match" --glob '!docs/**' --glob '!.worktrees/**'` from worktree root  
Expected: zero hits outside this plan/spec if any remain in code — fix code until 0 in `shared/`, `src/`, `netlify/`, `e2e/`.

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
- Modify: `netlify/functions/_tests/emergency-menus.test.ts` (path may be `emergency-menus.test.ts` under `_tests` — use repo’s actual path)

**Interfaces:**
- Query: add optional `targetMode` defaulting to `"household"` when members present (Train A: only household fully supported; idea returns 400 or wait Task 6 — **prefer**: parse `targetMode` as `z.enum(["household","idea"]).optional()`; if `idea`, return 400 with `invalid_request` until Task 6 **OR** implement full idea in Task 6 only and keep Task 4 household-only by rejecting `idea` explicitly).

  **This plan:** Task 4 accepts only household (default). If `targetMode=idea` → 400 `invalid_request` with message `検索条件を確認してください` until Task 6 removes the reject.

- Response `data` always includes `path: "household"`, `matchMode`, `emptyReason` from filter, `fixtureVersion` from fixtures.

Message matrix (household only in this task):

| condition | message |
|-----------|---------|
| non-empty && matchMode in none/main_ingredient | `AIを使わない15分緊急献立です` |
| non-empty && safety_only | `メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています` |
| empty | `条件に合う緊急献立がありません` |

Delete handler branch for old main-ingredient-only empty string.

- [ ] **Step 1: RED — handler tests**

```ts
it("returns matchMode safety_only and new message when mains miss", async () => {
  // deps: loadContext adult no allergy; fixtures dinner; mainIngredients=xyz
  const res = await handler(/* … */);
  const body = await res.json();
  expect(body.data.matchMode).toBe("safety_only");
  expect(body.data.path).toBe("household");
  expect(body.data.emptyReason).toBeNull();
  expect(body.data.message).toContain("メイン食材は一致しませんでした");
  expect(body.data.message).not.toContain("選択したメイン食材に合う固定候補がありません");
});

it("rejects targetMode=idea until idea path ships", async () => {
  const res = await handler(new Request("http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=<uuid>&targetMode=idea"));
  expect(res.status).toBe(400);
});
```

Update all existing success response fixtures in tests to include `path`/`matchMode`/`emptyReason`.

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_tests/emergency-menus.test.ts`  
(If file path differs, use: `npx vitest run netlify/functions/emergency-menus.test.ts`)  
Expected: FAIL.

- [ ] **Step 3: GREEN — handler**

```ts
// after filterEmergencyMenus
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

- [ ] **Step 4: Run GREEN + typecheck focused**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_tests/emergency-menus.test.ts shared/emergency`  
Run: `docker compose run --rm --no-deps app npm run typecheck`  
Expected: tests PASS; typecheck may still fail on browser parse until Task 5 — if so, proceed to Task 5 in same train without claiming complete.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/emergency-menus.ts netlify/functions/_tests/emergency-menus.test.ts
git commit -m "feat: 緊急献立APIにpathとmatchModeを載せる"
```

---

### Task 5: Client parse + household `safety_only` banner (Train A ship lock)

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
- Keys include `targetMode`.
- UI: when `response.path === "household" && response.matchMode === "safety_only" && candidates.length > 0`, show banner exact:

`メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています`

Banner trigger = `matchMode` only (not message parse).

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
        message: "…",
        consumesAiQuota: false,
        path: "household",
        matchMode: "safety_only",
        emptyReason: null,
      }}
    />,
  );
  expect(
    screen.getByText("メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています"),
  ).toBeVisible();
});

it("does not show safety_only banner when matchMode is none", () => {
  // matchMode none → queryByText banner → null
});
```

Update every mock `EmergencyMenusData` in page/api/cache tests with new fields.

- [ ] **Step 2: Run RED**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/emergency`  
Expected: FAIL.

- [ ] **Step 3: GREEN**

1. Extend request schema + fetch query.
2. In `EmergencyMenuContent`, accept `response` with new fields; render banner when `matchMode === "safety_only" && path === "household"`.
3. Keep household intro copy for now (idea chrome is Task 8).

- [ ] **Step 4: Verify Train A package**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/emergency src/features/emergency netlify/functions/_tests/emergency-menus.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

Expected: all PASS.

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
- Modify: `shared/emergency/filter-emergency-menus.ts` (optional: export builder used by tests)
- Modify: `netlify/functions/emergency-menus.ts`
- Modify: `netlify/functions/_tests/emergency-menus.test.ts`

**Interfaces:**
- `buildIdeaPersonalSafetyContext(): { context: CurrentSafetyContext; memberLabels: Record<string, string> }`
  - One synthetic member id `83000000-0000-4000-8000-000000000001`
  - `anonymousRef: "member_1"`, ageBand `adult`, allergy none, no unmapped, unsupported none, empty requiredSafetyConstraints
  - Labels: `{ member_1: "あなた" }`
  - dictionary/food rule versions from current catalogs (same as other emergency loaders use)
- Filter always uses `emergencyGenerationContext` with `targetMode: "household"` (never idea generation context).
- Handler:
  - `targetMode=idea` → **no** `loadContext`; **yes** `loadPantryNames` if pantry IDs present
  - require `targetMemberIds` absent/empty for idea; household requires 1–20 IDs
  - idea messages:

| condition | message |
|-----------|---------|
| non-empty none/main_ingredient | `AIを使わない15分緊急献立です。アレルギー条件は適用していません` |
| non-empty safety_only | `メイン食材は一致しませんでした。アレルギー条件は適用していません` |
| empty | `条件に合う緊急献立がありません` |

- `path: "idea"`, never emit `current_safety_unavailable` on idea (if it happens → 500 fail closed).

- [ ] **Step 1: RED**

```ts
// idea-context.test.ts
it("builds adult none-allergy context with fixed synthetic member id", () => {
  const { context, memberLabels } = buildIdeaPersonalSafetyContext();
  expect(context.members).toHaveLength(1);
  expect(context.members[0]!.householdMemberId).toBe(
    "83000000-0000-4000-8000-000000000001",
  );
  expect(context.members[0]!.allergyStatus).toBe("none");
  expect(memberLabels.member_1).toBe("あなた");
});

// filter or handler
it("idea personal filter returns ≥1 per mealType with household generation context", () => {
  for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
    const { context, memberLabels } = buildIdeaPersonalSafetyContext();
    const result = filterEmergencyMenus({
      mealType,
      pantryNames: [],
      context,
      memberLabels,
    });
    expect(result.menus.length).toBeGreaterThan(0);
  }
});

it("idea path loads pantry names without loadContext", async () => {
  // spy: loadContext not called; loadPantryNames called when pantry ids present
});
```

- [ ] **Step 2: Run RED → Step 3 GREEN → Step 4 tests pass → Step 5 Commit**

```bash
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
      targetMemberIds: z.array(z.uuid()).min(1).max(20).refine(/* unique */),
      pantryItemIds: z.array(z.uuid()).max(50).refine(/* unique */),
    })
    .strict(),
  z
    .object({
      mealType: z.enum(mealTypes),
      mainIngredients: emergencyMainIngredientsSchema,
      targetMode: z.literal("idea"),
      targetMemberIds: z.tuple([]), // or .array().length(0)
      pantryItemIds: z.array(z.uuid()).max(50).refine(/* unique */),
    })
    .strict(),
]);
```

- idea: query has `targetMode=idea`, **omit** `targetMemberIds` param (or empty — handler must accept omitted).
- keys include `targetMode`.

- [ ] **Step 1: RED tests for idea query shape**
- [ ] **Step 2: GREEN**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 緊急献立APIクライアントにideaアームを追加"
```

---

### Task 8: Idea UI chrome + enablement + idea banner

**Files:**
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `src/features/emergency/emergency-menu-page.test.tsx`
- Modify: `src/features/emergency/emergency-menu-page.cache.test.tsx`

**Interfaces:** implement design §5 enablement pseudocode exactly:

- `isIdea = draft?.targetMode === "idea"`
- household query + Realtime/poll **only** when non-idea
- `candidateQueryEnabled = draftReady && (isIdea || (household success && hasEligible))`
- pre-API empty **never** for idea
- intro:
  - household: `現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。`
  - idea: `個人向けの固定候補です。アレルギー条件は適用していません。AI利用回数は消費しません。`
- idea `safety_only` banner exact: `メイン食材は一致しませんでした。アレルギー条件は適用していません`
- Assert idea view does **not** contain household intro or household banner phrase `安全条件に合う`

- [ ] **Step 1: RED component tests** (names from design)
  - `shows household safety_only banner only when matchMode is safety_only` (already Task 5)
  - idea enablement without household members
  - idea intro present / household intro absent
  - idea safety_only banner exact + absence of `安全条件に合う`
  - draft household never sends idea (request spy)
- [ ] **Step 2: GREEN**
- [ ] **Step 3: focused vitest + typecheck + lint + format:check**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: アイデアモード緊急献立の開示UIを追加"
```

---

### Task 9: E2E contract rewrite

**Files:**
- Modify: `e2e/specs/generation-recovery-results.spec.ts`
- Modify: `e2e/specs/menu-domain-pantry.spec.ts` only if it asserts removed main-ingredient empty message

**Interfaces:**
- idea draft on `/emergency-menus`: **may** call `GET /api/emergency-menus` with `targetMode=idea`
- must **not** call current-safety RPC / household_members list (except settings routes) / shopping revalidate / generation
- Stop classifying `/api/emergency-menus` as forbidden family-safety on idea path
- Expect visible idea heading + idea disclosure (or candidates), not only the old empty copy  
  Old: `アイデアモードでは緊急献立を表示できません…` → **remove** as success expectation for idea

- [ ] **Step 1: RED — update assertions first (tests fail against incomplete UI if needed; should pass after Task 8)**
- [ ] **Step 2: Run e2e via host**

Run: `./scripts/run-e2e.sh` (or project’s scoped playwright for these files if available)  
If full e2e is too heavy for the agent, ask human to run and paste summary — do not claim PASS without evidence.

- [ ] **Step 3: Commit**

```bash
git commit -m "test: アイデアモード緊急献立のe2e契約を更新"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Catalog 9–12 + coverage matrix | Task 2 |
| Two-stage match + delete main_ingredient_no_match | Task 3 |
| Wire path/matchMode/emptyReason | Task 1, 4 |
| Household safety_only banner Train A | Task 5 |
| Idea personal path + no family safety RPC | Task 6–8 |
| Idea chrome / intro swap | Task 8 |
| E2E allow emergency API on idea | Task 9 |
| schemaVersion lock | Task 2 |
| validateIdeaMenu avoidance | Task 3/6 (household context) |
| Plan 7 supersession | documented in spec; behavior Tasks 6–9 |
| Train A/B merge gates | Global Constraints + Task 5/9 |

Placeholder scan: no TBD steps. Fixture **recipes** are specified by slot table + validation gates (full multi-hundred-line menus are authored in Task 2 GREEN under those gates—not left as “add some menus”).

---

## Execution Handoff

Plan complete and saved to:

`docs/superpowers/plans/2026-07-28-emergency-menu-capability.md`

(in worktree `feature/emergency-menu-capability`)

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per Task, review between Tasks (`superpowers:subagent-driven-development`)
2. **Inline Execution** — this session with `superpowers:executing-plans` and checkpoints

Which approach?
