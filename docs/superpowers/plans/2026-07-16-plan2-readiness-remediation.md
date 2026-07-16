# Plan 2 Readiness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every validated Plan 2 readiness finding so current-safety reads, medical-scope rejection, required safety actions, draft conflicts, emergency navigation, and the complete verification gate are fail-closed before Plan 3 begins.

**Architecture:** A service-role-only SQL RPC returns one current-safety snapshot for emergency filtering. Shared pure helpers own planner request text and browser-safe emergency response contracts; planner conflict recovery and emergency navigation use explicit state transitions around the authoritative draft revision. Food-safety actions remain source-bound, and completion is recorded only after the repository's real Docker, pgTAP, and Playwright gates pass.

**Tech Stack:** Node.js 24, TypeScript strict mode, React 19, TanStack Query 5, Zod 4, Supabase PostgreSQL/PostgREST, Netlify Functions, Vitest/RTL, pgTAP, Playwright, Docker Compose.

## Global Constraints

- Preserve the existing uncommitted change in `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md`; integrate it deliberately in Task 7 and never discard it.
- Every production behavior change follows RED → observed expected failure → minimal GREEN → focused regression run.
- Run every Node/npm/npx command through the Docker Compose `app` service.
- Run Docker, database, E2E, and host Git commands as separate tool calls; do not join them with `&&`.
- New SQL security-definer functions use `set search_path = ''`, fully qualified names, explicit ACL revocation, and service-role-only execution where specified.
- Browser code must not import `node:*`, server-only validators, service-role clients, or raw safety source data.
- User-facing copy and code comments are Japanese. TypeScript stays strict without `any` or unchecked boundary casts.
- Do not implement Plan 3 generation, quota, OpenRouter, or persistence code. Synchronize its authored plan to consume the corrected Plan 2 interfaces.
- Do not mark Plan 2 complete until focused reviews are clean, the whole-change adversarial re-review is clean, and every final command in Task 7 exits 0.

---

## File Structure

```text
supabase/
├── migrations/20260716000250_expand_fish_safety_terms.sql
├── migrations/20260716000300_current_safety_snapshot.sql
└── tests/database/002c_current_safety_snapshot.test.sql
shared/
├── contracts/planner.ts
├── contracts/planner.test.ts
├── emergency/contracts.ts
├── emergency/contracts.test.ts
├── emergency/filter-emergency-menus.ts
└── safety/{food-rules.ts,food-rules.test.ts,current-food-safety-rules.v1.ts,current-food-safety-rules.v1.test.ts}
netlify/functions/_shared/{current-safety.ts,current-safety.test.ts}
src/features/planner/{planner-route.tsx,planner-route.test.tsx,planner-page.tsx,planner-page.test.tsx,use-draft-autosave.ts,use-draft-autosave.test.tsx}
src/features/emergency/{emergency-menu-api.ts,emergency-menu-api.test.ts,emergency-menu-page.tsx,emergency-menu-page.test.tsx}
e2e/specs/{foundation.spec.ts,menu-domain-pantry.spec.ts}
docs/superpowers/plans/{2026-07-11-kondate-mvp-02-menu-domain-pantry.md,2026-07-11-kondate-mvp-03-ai-generation-results.md}
```

`shared/emergency/contracts.ts` contains schemas and DTO types only. `filter-emergency-menus.ts` contains server-side filtering and may import validators that use `node:crypto`. Browser code imports only `contracts.ts`.

---

### Task 1: Canonicalize every planner medical-scope input

**Files:**
- Modify: `shared/contracts/planner.test.ts`
- Modify: `shared/contracts/planner.ts`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/planner/planner-page.tsx`
- Modify: `shared/safety/validate-generated-menu.test.ts`
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md`

**Interfaces:**
- Produces: `collectPlannerRequestText(input): string`.
- Plan 2 UI and Plan 3's authored server preflight consume the same projection.

- [ ] **Step 1: Add RED contract tests for all free-text fields**

Add tests equivalent to:

```ts
expect(
  collectPlannerRequestText({
    mainIngredients: [" 鶏肉 ", "離乳食"],
    avoidIngredients: [" 嚥下食 "],
    memo: " 治療食 ",
  }),
).toBe("鶏肉\n離乳食\n嚥下食\n治療食");

expect(
  detectUnsupportedMedicalRequest(
    collectPlannerRequestText({ mainIngredients: ["離乳食"], avoidIngredients: [], memo: "" }),
  ),
).toContain("weaning_food");
```

Add `PlannerForm` cases proving `mainIngredients`-only and `avoidIngredients`-only unsupported requests show the existing medical alert and disable generation. Task 5 adds the emergency-navigation assertion after that action becomes a guarded button.

In `validate-generated-menu.test.ts`, build `context.safety.requestText` with this helper for main-only and avoid-only fixtures, and prove both produce the existing unsupported-medical issue. This prevents server validation tests from masking the production gap with hand-authored `requestText` strings.

- [ ] **Step 2: Run RED**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts shared/safety/validate-generated-menu.test.ts src/features/planner/planner-page.test.tsx
```

Expected: FAIL because `collectPlannerRequestText` does not exist and the UI still checks only `memo`.

- [ ] **Step 3: Implement the minimal shared projection**

Add to `shared/contracts/planner.ts`:

```ts
export function collectPlannerRequestText(
  input: Pick<PlannerDraftInput, "mainIngredients" | "avoidIngredients" | "memo">,
): string {
  return [...input.mainIngredients, ...input.avoidIngredients, input.memo]
    .map((value) => value.normalize("NFKC").trim())
    .filter((value) => value.length > 0)
    .join("\n");
}
```

Replace the UI's memo-only call with:

```ts
const medicalMatches = detectUnsupportedMedicalRequest(collectPlannerRequestText(value));
```

In Plan 3 Task 8, require this exact sequence before prompt construction:

```ts
const requestText = collectPlannerRequestText(submission);
const unsupportedDietKinds = detectUnsupportedMedicalRequest(requestText);
if (unsupportedDietKinds.length > 0) {
  throw new HttpError(
    422,
    "unsupported_diet",
    "離乳食、飲み込み・嚥下、治療食の依頼には対応できません。",
  );
}
const safety = { ...loadedSafety, requestText };
```

Remove every authored `detectUnsupportedMedicalRequest(submission.memo)` instruction.

- [ ] **Step 4: Run GREEN and static handoff check**

Run the focused Vitest command from Step 2. Then run:

```bash
rg -n 'detectUnsupportedMedicalRequest\(submission\.memo\)|detectUnsupportedMedicalRequest\(value\.memo\)' src shared netlify/functions docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
```

Expected: tests PASS; `rg` has no output.

- [ ] **Step 5: Commit**

```bash
git add shared/contracts/planner.ts shared/contracts/planner.test.ts shared/safety/validate-generated-menu.test.ts src/features/planner/planner-page.tsx src/features/planner/planner-page.test.tsx docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
git commit -m "fix: 医療対象外依頼を全入力項目で拒否"
```

---

### Task 2: Bind required safety actions to applicable food sources

**Files:**
- Modify: `shared/safety/food-rules.test.ts`
- Modify: `shared/safety/food-rules.ts`
- Modify: `shared/safety/current-food-safety-rules.v1.ts`
- Modify: `shared/safety/current-food-safety-rules.v1.test.ts`
- Create: `supabase/migrations/20260716000250_expand_fish_safety_terms.sql`
- Modify: `supabase/tests/database/02_safety_catalogs.test.sql`

**Interfaces:**
- Keeps `evaluateFoodSafetyRules(menu, context)` unchanged.
- Changes required-constraint semantics from menu-global evidence to source/dish-bound evidence.

- [ ] **Step 1: Add RED adversarial tests**

Add fixtures for a child with `requiredSafetyConstraints: ["remove_bones"]` and a dish containing `鮭` and `にんじん`.

Test that the only action below is rejected:

```ts
{
  kind: "remove_bones",
  dishId,
  ingredientId: carrotId,
  anonymousMemberRef: "member_1",
  beforeRecipeStepId: stepId,
  instruction: "にんじんの骨を完全に除く",
}
```

Test that an otherwise identical action bound to `salmonId` with `鮭の骨を完全に除く` passes. Add a two-fish case requiring one action per matched ingredient, and a `cut_small` case requiring one valid ingredient-bound action per dish.

- [ ] **Step 2: Run RED**

```bash
docker compose run --rm --no-deps app npx vitest run shared/safety/food-rules.test.ts shared/safety/current-food-safety-rules.v1.test.ts
```

Expected: the carrot-bone and missing-second-fish cases incorrectly pass or omit issues.

- [ ] **Step 3: Implement source-aware constraint evaluation**

Extract one predicate that verifies member, dish, ingredient, step ownership, action wording, ingredient naming, adaptation evidence, and contradiction absence. For each required constraint:

```ts
const applicableSources = sources.filter(
  (source) =>
    source.dishId !== null &&
    source.ingredientId !== null &&
    context.foodSafetyRules.some(
      (rule) =>
        rule.appliesToAgeBands.includes(member.ageBand) &&
        rule.requiredSafetyTag === required &&
        rule.matchTerms.some((term) =>
          normalizeFoodText(source.text).includes(normalizeFoodText(term)),
        ),
    ),
);
```

- When `applicableSources` is non-empty, require verified evidence for every unique `(dishId, ingredientId)` pair.
- When `required === "remove_bones"` and no source matches, treat it as not applicable; never demand a fabricated bone action.
- For general `cut_small`, require one verified action on a real ingredient in every dish for that member.
- Keep the existing rule loop so forbidden and `requires_tag` issues retain their exact codes and paths.

Expand `bones_for_young_and_senior.matchTerms` identically in a forward-only corrective SQL migration and TypeScript with:

```ts
["小骨", "骨付き", "魚", "鮭", "さけ", "サケ", "鯖", "さば", "サバ", "鯵", "あじ", "アジ", "鰯", "いわし", "イワシ", "鯛", "たい", "タイ", "ぶり", "ブリ", "たら", "タラ", "さんま", "サンマ", "ししゃも", "うなぎ", "穴子"]
```

Do not edit the already-applied `20260711000400_safety_catalog_data.sql`. The new migration updates only the named rule, asserts that exactly one row exists, and preserves its version. Update the exact catalog manifest tests so the migrated DB state and TypeScript stay byte-for-value equivalent.

- [ ] **Step 4: Run GREEN and catalog DB proof**

Run the focused Vitest command. Then run separately:

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test supabase/tests/database/02_safety_catalogs.test.sql
```

Expected: all focused tests and safety-catalog pgTAP pass.

- [ ] **Step 5: Commit**

```bash
git add shared/safety/food-rules.ts shared/safety/food-rules.test.ts shared/safety/current-food-safety-rules.v1.ts shared/safety/current-food-safety-rules.v1.test.ts supabase/migrations/20260716000250_expand_fish_safety_terms.sql supabase/tests/database/02_safety_catalogs.test.sql
git commit -m "fix: 必須安全対応を対象食材へ結合"
```

---

### Task 3: Load current safety through one service-role snapshot RPC

**Files:**
- Create: `supabase/migrations/20260716000300_current_safety_snapshot.sql`
- Create: `supabase/tests/database/002c_current_safety_snapshot.test.sql`
- Modify: `netlify/functions/_shared/current-safety.test.ts`
- Modify: `netlify/functions/_shared/current-safety.ts`
- Regenerate: `src/shared/types/database.generated.ts`

**Interfaces:**
- Produces: `public.get_current_safety_snapshot(p_user_id uuid,p_target_member_ids uuid[]) returns jsonb`.
- `loadCurrentSafetyContext` and `loadEmergencyCurrentSafety` use exactly one RPC result and no `.from()` fallback.

The SQL, Zod schema, fixtures, and generated mapper share this exact snake-case DTO; every object is strict and every array is deterministically ordered:

```ts
type CurrentSafetySnapshot =
  | { status: "unavailable" }
  | {
      status: "available";
      dictionary_version: string;
      food_rule_version: string;
      members: Array<{
        id: string;
        display_name: string;
        age_band: AgeBand;
        portion_size: PortionSize | null;
        spice_level: SpiceLevel | null;
        ease_preferences: EasePreference[];
        allergy_status: "none" | "registered";
        required_safety_constraints: RequiredSafetyConstraint[];
        unsupported_diet_status: "none" | "present";
        unsupported_diet_kinds: UnsupportedDietKind[];
        allergies: Array<
          | { kind: "standard"; allergen_id: string }
          | { kind: "custom"; name: string; aliases: string[] }
        >;
      }>;
      catalog: Array<{
        id: string;
        display_name: string;
        regulatory_class: "mandatory" | "recommended";
        catalog_version: string;
      }>;
      aliases: Array<{
        allergen_id: string;
        alias: string;
        normalized_alias: string;
        alias_kind: "direct" | "derived" | "processed";
        requires_label_confirmation: boolean;
        dictionary_version: string;
      }>;
      rules: Array<{
        id: string;
        applies_to_age_bands: AgeBand[];
        match_terms: string[];
        rule_kind: "forbidden" | "requires_tag";
        required_safety_tag: SafetyActionKind | null;
        user_message: string;
        rule_version: string;
      }>;
    };
```

Member order follows input ordinality; allergies, catalog, aliases, and rules sort by stable identifiers/normalized values. Confirmed custom allergies only are returned. No owner IDs or partial arrays appear in `unavailable`.

- [ ] **Step 1: Write RED pgTAP for the RPC and ACL**

Create `002c_current_safety_snapshot.test.sql` with owner A/B, complete, draft, allergy-unconfirmed, unsupported-diet-unconfirmed, standard-allergy, and confirmed-custom-allergy fixtures. Assert:

- function signature, `prosecdef`, empty `search_path`;
- no execute for `PUBLIC`, `anon`, `authenticated`; execute for `service_role`;
- available response preserves requested member order and contains display/safety/allergy/catalog/alias/rule data;
- empty, duplicate, missing, foreign, draft, or unconfirmed member arrays return exactly `{"status":"unavailable"}` without partial keys;
- all returned catalog/alias/rule rows use the top-level versions.

- [ ] **Step 2: Write RED TypeScript RPC boundary tests**

Replace multi-query mocks with `{rpc,from}` and require:

```ts
expect(rpc).toHaveBeenCalledOnce();
expect(rpc).toHaveBeenCalledWith("get_current_safety_snapshot", {
  p_user_id: userId,
  p_target_member_ids: targetMemberIds,
});
expect(from).not.toHaveBeenCalled();
```

Cover valid standard/custom allergies, requested order and `member_1` mapping, label snapshots, RPC error/null, strict-shape failure, `status:"unavailable"`, member mismatch, and catalog version drift. Every failure maps to the closed 500 `safety_context_failed`; no old-context fallback is allowed.

- [ ] **Step 3: Run RED**

Run separately:

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test supabase/tests/database/002c_current_safety_snapshot.test.sql
```

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/current-safety.test.ts
```

Expected: pgTAP cannot find the RPC; TypeScript tests observe the existing five `.from()` reads and later label read.

- [ ] **Step 4: Implement the single-statement SQL snapshot**

Use a `language sql stable security definer set search_path = ''` function whose body is one `WITH ... SELECT`. Validate a one-dimensional, non-null, unique array of 1–20 IDs. Use `unnest(p_target_member_ids) with ordinality`, join only `(id,user_id)` owned complete members, nest their owned allergies, and aggregate catalog/aliases/rules in deterministic order.

Return only:

```json
{"status":"unavailable"}
```

or the strict available DTO fixed above, with no additional keys. Revoke and grant exactly:

```sql
revoke all on function public.get_current_safety_snapshot(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.get_current_safety_snapshot(uuid, uuid[])
  to service_role;
```

- [ ] **Step 5: Implement strict parsing and mapping**

Add a strict Zod discriminated union for `status`. Call:

```ts
const { data, error } = await admin.rpc("get_current_safety_snapshot", {
  p_user_id: userId,
  p_target_member_ids: [...targetMemberIds],
});
```

Reject error/null/unavailable/malformed/member mismatch/version drift with `HttpError(500,"safety_context_failed",...)`. Build `CurrentSafetyContext` and frozen member labels from the same member array. Remove the five-query loader and the separate display-name query.

- [ ] **Step 6: Regenerate types and run GREEN**

Run separately:

```bash
docker compose run --rm app npm run db:types
```

```bash
docker compose --profile test run --rm db-test supabase/tests/database/002c_current_safety_snapshot.test.sql
```

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/current-safety.test.ts netlify/functions/emergency-menus.test.ts
```

Expected: RPC type is generated as `Args {p_user_id:string;p_target_member_ids:string[]}; Returns: Json`; pgTAP and Vitest pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260716000300_current_safety_snapshot.sql supabase/tests/database/002c_current_safety_snapshot.test.sql netlify/functions/_shared/current-safety.ts netlify/functions/_shared/current-safety.test.ts src/shared/types/database.generated.ts
git commit -m "fix: 現行安全条件を単一スナップショットで取得"
```

---

### Task 4: Replace automatic draft conflict rebasing with explicit recovery

**Files:**
- Modify: `src/features/planner/use-draft-autosave.test.tsx`
- Modify: `src/features/planner/use-draft-autosave.ts`
- Modify: `src/features/planner/planner-route.test.tsx`
- Create: `src/features/planner/planner-route-conflict.test.tsx`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/planner/planner-page.tsx`

**Interfaces:**
- Renames the incoming baseline to `baselineRevision` and extends `useDraftAutosave` with `resetToken: number`.
- Extends `PlannerForm` with `draftConflict`, `canResolveDraftConflict`, and `onResolveDraftConflict`.

- [ ] **Step 1: Replace the current auto-rebase test with RED explicit-reset tests**

Prove that changing only `baselineRevision` after conflict leaves state `error`, rejects `flush()`, and performs no write. Queue a second save behind a deferred conflicting save, then change `value`, `baselineRevision`, and `resetToken` together. Prove the queued pre-reset payload never calls `save`, never mutates refs/state against the new revision, state becomes `idle`, and the first post-reset edit saves against the new revision.

Add a real QueryClient route test with retained revision-1 data and a deferred refetch returning distinguishable revision-2 content. Assert that refetch completion alone does not change the displayed user input or enable Generate. Only clicking `最新の下書きを読み込む` may display revision 2 and resume saves.

- [ ] **Step 2: Run RED**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/use-draft-autosave.test.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-page.test.tsx
```

Expected: current `04ba6e0` behavior clears the conflict on the revision prop alone and no explicit recovery UI exists.

- [ ] **Step 3: Implement reset-token semantics**

Keep normal hydration synchronized while no conflict exists:

```ts
useEffect(() => {
  if (conflictRef.current !== null) return;
  resetBaseline(baselineRevision);
}, [baselineRevision]);
```

Add the only conflict-clearing effect:

```ts
useEffect(() => {
  resetGenerationRef.current += 1;
  operationNumberRef.current += 1;
  conflictRef.current = null;
  resetBaseline(baselineRevision);
  if (mountedRef.current) setState("idle");
}, [resetToken]);
```

Add a monotonically increasing reset generation. Every `enqueue` captures the current generation before joining `queueRef`; before calling `save` and again in both settlement branches, compare the captured generation. A reset increments the generation and operation number before clearing conflict. A mismatched pre-reset operation rejects with an internal superseded-operation error, performs no write, and cannot update revision, baseline, conflict, or UI state. The queue's rejection handler may unblock later post-reset work but must not surface the superseded operation as a new save error.

The route's `onConflict` awaits `refetchDraft()` and stores `result.data` in `latestConflictDraft`; it must not set `initialized=false` or consume retained `draftQuery.data`. Preserve the user's current `value`.

On explicit resolution, atomically set the sanitized latest draft into `value`, increment `resetToken`, clear `latestConflictDraft`, and remount `PlannerForm` with `key={resetToken}` so its internal state matches the autosave baseline. Before resolution, render the conflict explanation and button, and disable generation/emergency navigation.

- [ ] **Step 4: Run GREEN**

Run the focused Vitest command from Step 2. Expected: all pass, including delayed retained-cache coverage.

- [ ] **Step 5: Commit**

```bash
git add src/features/planner/use-draft-autosave.ts src/features/planner/use-draft-autosave.test.tsx src/features/planner/planner-route.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-page.tsx src/features/planner/planner-page.test.tsx
git commit -m "fix: 下書き競合を明示操作で安全に解決"
```

---

### Task 5: Flush the authoritative draft before emergency navigation

**Files:**
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/planner/planner-page.tsx`
- Modify: `src/features/planner/planner-route.test.tsx`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/emergency/emergency-menu-api.test.ts`
- Modify: `src/features/emergency/emergency-menu-api.ts`
- Modify: `src/features/emergency/emergency-menu-page.test.tsx`
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `e2e/specs/menu-domain-pantry.spec.ts`

**Interfaces:**
- `PlannerForm` produces `onOpenEmergencyMenus(): Promise<void>` after successful `flush()`.
- `getEmergencyMenus` refuses empty target-member input before fetch.

- [ ] **Step 1: Add RED component and E2E tests**

Cover:

- pristine completed-onboarding user with no draft;
- click while the 600ms save is pending;
- changed meal/member/pantry values;
- flush rejection and revision conflict;
- double click while navigation is pending;
- direct `/emergency-menus` visit with no draft;
- client call with `targetMemberIds: []` performs no fetch.
- unsupported medical text in any planner field disables emergency navigation as well as generation.

In Playwright, delay `save_generation_draft`, click the emergency action immediately, and assert no `/api/emergency-menus` request occurs until the save response completes; then assert the request uses the persisted member IDs and meal.

- [ ] **Step 2: Run RED**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/planner-page.test.tsx src/features/planner/planner-route.test.tsx src/features/emergency/emergency-menu-api.test.ts src/features/emergency/emergency-menu-page.test.tsx
```

Run the newly added browser regression before production changes as a separate command:

```bash
./scripts/run-e2e.sh e2e/specs/menu-domain-pantry.spec.ts
```

Expected: focused component tests fail because the plain anchor bypasses `flush`, null draft creates an empty query, and duplicate clicks are unguarded. Preserve the Playwright result separately: the known browser `node:crypto` boundary may fail earlier than the delayed-save assertion, so the component RED is the target-behavior proof and Task 6 must make this same unchanged Playwright test runnable and green.

- [ ] **Step 3: Implement guarded navigation**

Replace the anchor with a button. Its handler sets a dedicated pending state, awaits `flush()`, calls `onOpenEmergencyMenus()`, and clears pending only on failure. Reuse the same save/generation error copy and never navigate after a conflict.

In `planner-route.tsx`, use `useNavigate()` and pass:

```ts
onOpenEmergencyMenus={async () => {
  navigate("/emergency-menus");
}}
```

`flush()` at revision 0 creates the initial draft containing eligible members before navigation.

Add a strict input schema in `emergency-menu-api.ts` with `.min(1).max(20)` unique UUID targets; parse before `requireAccessToken`/fetch. In `EmergencyMenuPage`, when draft loading succeeds with `null`, render an alert plus a `/planner` link and keep the candidate query disabled.

- [ ] **Step 4: Run GREEN and focused E2E**

Run the focused Vitest command. Then run separately:

```bash
./scripts/run-e2e.sh e2e/specs/menu-domain-pantry.spec.ts
```

If the E2E still renders blank, stop after recording the expected existing `node:crypto` page error; Task 6 owns that independent module-boundary defect.

- [ ] **Step 5: Commit**

```bash
git add src/features/planner src/features/emergency e2e/specs/menu-domain-pantry.spec.ts
git commit -m "fix: 緊急献立の前に下書き保存を確定"
```

---

### Task 6: Restore the browser entrypoint and authoritative E2E path

**Files:**
- Create: `shared/emergency/contracts.ts`
- Create: `shared/emergency/contracts.test.ts`
- Modify: `shared/emergency/filter-emergency-menus.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts`
- Modify: `src/features/emergency/emergency-menu-api.ts`
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `netlify/functions/emergency-menus.ts`
- Modify: `e2e/specs/foundation.spec.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces browser-safe `emergencyMenusDataSchema`, `EmergencyMenusData`, and related DTO schemas from `shared/emergency/contracts.ts`.
- Server filtering remains in `filter-emergency-menus.ts`.

- [ ] **Step 1: Preserve the observed RED evidence**

The retained Playwright trace establishes the root cause:

```text
Module "node:crypto" has been externalized for browser compatibility.
Cannot access "node:crypto.createHash" in client code.
shared/safety/fingerprint.ts:1
```

Add a contract test that imports only `shared/emergency/contracts.ts` and parses a complete response. Add a source-boundary assertion that `contracts.ts` imports neither `filter-emergency-menus`, `validate-generated-menu`, `fingerprint`, nor `node:*`.

Run the contract RED first:

```bash
docker compose run --rm --no-deps app npx vitest run shared/emergency/contracts.test.ts
```

Expected: FAIL because the browser-safe contract module does not exist.

Run the retained browser reproduction separately:

```bash
./scripts/run-e2e.sh e2e/specs/foundation.spec.ts --project=desktop-chromium
```

Expected RED before the split: blank page and the same browser `node:crypto` page error.

- [ ] **Step 2: Split pure contracts from server filtering**

Move all response/request-facing Zod schemas and inferred DTO types from `filter-emergency-menus.ts` to `contracts.ts`. `contracts.ts` may import only Zod and pure shared contract modules. Update browser API/page imports to `@shared/emergency/contracts`. Update the Netlify handler and filter module to import/re-export the pure types without causing the browser to load filtering code.

Do not make fingerprint asynchronous and do not add a browser crypto shim; the browser does not need to compute server safety fingerprints.

- [ ] **Step 3: Run GREEN for the browser boundary**

Run separately:

```bash
docker compose run --rm --no-deps app npx vitest run shared/emergency src/features/emergency netlify/functions/emergency-menus.test.ts
```

```bash
./scripts/run-e2e.sh e2e/specs/foundation.spec.ts --project=desktop-chromium
```

Expected: tests pass; login page renders and the protected-route foundation test passes with no page error.

- [ ] **Step 4: Correct formatting and the documented E2E command**

Run RED:

```bash
docker compose run --rm --no-deps app npm run format:check
```

Then format `AGENTS.md` through Prettier:

```bash
docker compose run --rm --no-deps app npx prettier AGENTS.md --write
```

Do not edit the dirty Plan 2 document in this task; Task 7 changes its E2E command only after creating the real progress entry it will reference. Do not alter `scripts/run-e2e.sh`; it already forwards spec arguments and owns the e2e image, host network, function-server override, and cleanup.

- [ ] **Step 5: Run the complete E2E suite**

```bash
./scripts/run-e2e.sh
```

Expected: every configured journey, including the new delayed-save case, passes in both mobile and desktop projects. If another failure appears, follow systematic debugging from its trace; do not increase timeouts or weaken selectors.

- [ ] **Step 6: Commit**

```bash
git add shared/emergency src/features/emergency netlify/functions/emergency-menus.ts netlify/functions/emergency-menus.test.ts e2e/specs/foundation.spec.ts AGENTS.md
git commit -m "fix: ブラウザ境界とPlan 2 E2E経路を修正"
```

---

### Task 7: Close database, documentation, and adversarial completion gates

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md`

**Interfaces:**
- Produces durable Plan 2 completion evidence in the tracked Plan 2 document and recovery evidence in the local progress ledger.

- [ ] **Step 1: Run a preliminary whole-tree gate**

Run every command below separately and retain raw output:

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npx vitest run
```

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test
```

```bash
./scripts/run-e2e.sh
```

```bash
docker compose run --rm --no-deps app npm run build
```

```bash
git diff --check
```

Expected: every command exits 0 and every configured mobile/desktop journey passes. A database failure blocks completion; preserve its SQL statement, role, SQLSTATE, and migration order and open a separately reviewed systematic-debugging task.

- [ ] **Step 2: Integrate the preserved Plan 2 note provisionally**

Append the implemented Task 1–6 commit IDs, review identities, and focused RED/GREEN evidence to `.superpowers/sdd/progress.md`, but keep the final gate status provisional.

Now, and only now, integrate the user's preserved dirty change into the Plan 2 document. Replace its nonexistent progress reference with the entry just created and replace Task 10's direct app-container Playwright command with:

```bash
./scripts/run-e2e.sh e2e/specs/menu-domain-pantry.spec.ts
```

Add a provisional `Completion Record` below Plan 2's Execution Handoff. Do not claim PASS yet.

- [ ] **Step 3: Run independent adversarial review and fix/re-review loops**

Use distinct agents for discovery, candidate verification, valid-finding fixes, and a context-clean fresh re-review. Review the remediation base through the current working tree, including the integrated Plan 2/3 documents. Require security review of RPC ACL/RLS, snapshot consistency, medical fail-closed behavior, source-bound actions, reset-generation races, and browser/server import boundaries.

For each valid finding, reproduce it with a focused failing test before fixing, commit the fix, rerun focused regressions, and start another context-clean review. Do not proceed while any new valid Critical/Important finding remains.

- [ ] **Step 4: Run the final gate after the last review fix**

Repeat every separate command from Step 1, including a fresh DB reset, full pgTAP, full Playwright, build, and `git diff --check`, against the final working tree. A review fix always sends execution back to this full step; focused GREEN alone is insufficient.

- [ ] **Step 5: Finalize and verify the evidence tree**

Replace the provisional ledger and `Completion Record` values with the exact final implementation commit range, review identities, pgTAP/Vitest/E2E totals, and command exits from Step 4. State explicitly that the Plan 2 document's E2E command uses `scripts/run-e2e.sh` and that the final review found no new valid Critical/Important issue.

Run `format:check` and `git diff --check` once more after inserting the raw values. Compare `git diff --name-only` with the declared Task 7 files and stop if generated or unrelated files changed. Because this step changes evidence text only, any code/config change returns to Step 3 and then Step 4.

- [ ] **Step 6: Commit the reviewed evidence tree**

```bash
git add docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md
git commit -m "docs: Plan 2完了ゲートの検証結果を記録"
```

The ignored `.superpowers/sdd/progress.md` remains the local recovery ledger and is not forced into Git.

---

## Execution Handoff

Execute this plan with `superpowers:subagent-driven-development`. Before Task 1, invoke `superpowers:using-git-worktrees` and create an isolated feature worktree from the current HEAD; copy the user's uncommitted Plan 2 document change into that worktree without modifying or deleting the original working-tree change. Record the implementation base SHA before dispatching any task.

Each task uses one implementer, a separate spec/code reviewer, and a fix/re-review loop before the next task. After Task 7, run the whole-change reviewer on the implementation base-to-HEAD review package and then the stricter `reviewing-adversarially` role-separated workflow.
