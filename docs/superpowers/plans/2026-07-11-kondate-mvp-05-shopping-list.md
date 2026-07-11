# Kondate Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one active, editable shopping list per user that is atomically created from a currently revalidated menu and reconciled after regeneration without losing checked, manual, manually edited, removed-by-user, or unresolved-label state.

**Architecture:** Browser reads use the RLS-protected public shopping tables, while every item mutation uses one owner-checking, expected-version RPC that increments the list version atomically; authenticated browsers receive no direct shopping-item INSERT/UPDATE/DELETE grants. All menu-derived multi-row writes use service-role-only functions in the exposed `public` schema because PostgREST does not expose `private` RPCs. Netlify services read mutation replay before any current-state/version work, revalidate against current household safety only for a new command, compute server-owned drafts/diffs, obtain a database safety fingerprint, then call an idempotent RPC that locks the same safety rows and compares the fingerprint again. `shopping_label_confirmations` stores only immutable creation/approved-reconciliation provenance with nullable live IDs; a separate latest-only `shopping_current_label_warnings` projection is replaced after each successful current-safety check. Deleting history therefore leaves the original shopping provenance readable while making the current gate fail closed.

**Tech Stack:** TypeScript strict mode, Zod 4, Supabase PostgreSQL/RLS/JSONB RPC, Netlify Functions, React 19.2.7, TanStack Query 5, React Hook Form, Vitest, React Testing Library, pgTAP, Playwright.

## Global Constraints

- Implement after Plans 1–4 and preserve `ApiResponse<T>`, `requireUser(request)`, `HttpError`, `json(status, body)`, `methodNotAllowed(allowed)`, `parseJson(request, schema)`, and `handleError(error)` exactly.
- Use ESM and TypeScript `strict: true`; do not add `any` or unchecked assertions at HTTP, database, or local-storage boundaries.
- Every user-owned row in `public` has a non-null `user_id`, RLS, an explicit owner policy, and a composite owner foreign key where it points to another user-owned shopping row.
- Callable service-role RPCs live in `public`, use `security definer` with `search_path = pg_catalog, pg_temp`, are revoked from `public`/`anon`/`authenticated`, and are granted only to `service_role`. The sole exception is `public.mutate_shopping_item`, which derives `auth.uid()`, requires the current list version and an idempotency key, is granted only to `authenticated`, and cannot write menu-derived source/label rows. Internal non-RPC helpers may live in `private`.
- A user has at most one `active` list. Creating a new list archives the exact expected active list inside the same transaction; append requires the exact active list ID and version.
- No shopping item can be inserted, updated, or deleted directly by an authenticated browser role. `public.mutate_shopping_item` alone owns manual add, check, edit, remove/at-home, and undo, requires both the rendered list version and a freshly server-proved active-list safety fingerprint, rechecks that fingerprint under lock, and increments `shopping_lists.version` in the same transaction.
- List creation and reconciliation revalidate the menu with current household safety, obtain `public.shopping_safety_fingerprint(user_id, menu_id)`, and compare it again after locking the same current-safety rows inside the write RPC.
- Client input never supplies a trusted user ID, safety fingerprint, source quantity, derived store section, or label warning. Reconciliation approval contains only server-issued operation IDs/keys; the server resolves all values again.
- Combine only identical normalized ingredient names, identical non-null units, and numeric quantities. Ambiguous quantities stay separate. Never convert units.
- Unknown pantry quantity never removes an item. Known pantry quantity reduces only the same normalized name and unit; a shortage remains.
- Pantry matching is name-first: normalize through the reviewed grocery alias table, then compare units. A same-name row with an unknown quantity or unknown/mismatched unit sets `pantryCheckRequired`; it never silently subtracts or converts.
- `storeSection` uses Plan 2's exact tuple and the condiment value is `seasonings`, never `seasoning`.
- Reconciliation preserves rows where `is_checked`, `is_manual`, `is_manually_edited`, or `is_removed_by_user`. The SQL RPC rejects a resolved diff that targets a protected row.
- Consume Plan 1's exported `householdSafetyChangedEvent`, `householdSafetyRevisionStorageKey`, and `householdSafetyQueryPrefixes.shopping`; do not redeclare their strings. Initial mount, a current-tab event, other-tab revision change, window focus, visible `visibilitychange`, `online`, an owner-filtered Supabase Realtime change to `household_members`/`member_allergies`, or the visible-online poll (at most 60 seconds between starts) synchronously disables shopping check/edit/create/reconcile actions, invalidates and reloads exact key `["shopping","active"]`, then calls the authenticated active-list revalidation boundary. `offline` and a Realtime channel error disable the gate immediately; a later subscribed signal or successful focus/visibility/online/poll check may reopen it. Actions remain disabled until every live source menu passes current-safety revalidation and the server returns a current list-safety fingerprint. A deleted/unavailable source, invalid menu, failed check, or fingerprint race stays closed; the mutation RPC independently rejects a stale fingerprint if every client signal is missed between polls.
- The active-list revalidation response is the sole current label-warning authority. It derives warnings from every source menu under current household safety, maps them to item/list positions by exact source leaf, atomically replaces only `shopping_current_label_warnings`, and returns human source/allergen/member text. `shopping_label_confirmations` is the immutable creation/approval snapshot used only for blocked/deleted-source history display; current refresh never inserts, updates, or deletes it. A successful gate therefore shows newly added warnings, removes obsolete current warnings, and never relabels historical confirmation state as current.
- `is_manual` and `is_manually_edited` are monotonic provenance flags. `is_checked` remains user-toggleable; `is_removed_by_user` may return false only through the explicit user “元に戻す” action, while reconciliation never clears it. A protected derived row stays unchanged; if the regenerated menu needs a larger known same-unit quantity, reconciliation proposes a separate positive delta item. A removed/“家にある” row still participates in this comparison: unknown or mismatched quantity produces a separate confirmation item rather than silently discarding the candidate.
- Deleting a menu/history group sets immutable provenance live IDs to null, cascades the now-unverifiable latest current projection, and retains menu, ingredient, dish, and label-confirmation snapshots. The list and its creation/approval warning remain readable in the explicitly historical section while all actions stay blocked.
- Every mutation has a UUID idempotency key, an exact request hash, and the expected list version. Replaying the same payload returns the saved response; reusing the key with another payload fails. Creation, append, and reconciliation read the ledger before menu, pantry, safety, active-list, or version access, and browser response-loss recovery automatically resends the byte-identical persisted command. `private.shopping_mutations` has an exact 30-day replay/retention cutoff: every lookup/write path deletes the requested key if it is older than the cutoff and opportunistically deletes at most 100 other expired rows for that owner, Plan 6 migration `20260711005100_maintenance_cleanup.sql` adds only a bounded maintenance batch requiring explicit `p_before` and `p_limit`, and browser recovery records expire after 24 hours so no client retries a key after ledger expiry. No unbounded ledger DELETE helper is permitted.
- All visible copy is Japanese; controls are at least 44 by 44 CSS pixels; no “safe” badge or guarantee is introduced.
- Every task follows red-green-refactor, has 2–5 minute checkbox steps, and ends with one focused commit.

---

## File Structure

```text
shared/
├── contracts/shopping.ts                    # exact Shopping Zod schemas and inferred types
└── shopping/
    ├── aggregate.test.ts
    ├── aggregate.ts                         # deterministic draft construction
    ├── diff.test.ts
    ├── diff.ts                              # server-owned diff and approval resolution
    ├── normalize.ts
    └── reviewed-aliases.ts                  # fixed reviewed name aliases; no fuzzy matching
supabase/
├── migrations/20260711004000_shopping_lists.sql
└── tests/database/shopping_lists.test.sql
netlify/functions/
├── _shared/
│   ├── shopping-adapter.ts                  # user/admin DB adapters and RPC error mapping
│   ├── shopping-service.test.ts
│   └── shopping-service.ts                  # creation/reconcile orchestration
├── shopping-list-from-menu.test.ts
├── shopping-list-from-menu.ts
├── shopping-list-preview.test.ts
├── shopping-list-preview.ts
├── shopping-list-revalidate.test.ts
├── shopping-list-revalidate.ts
├── shopping-list-reconcile.test.ts
└── shopping-list-reconcile.ts
src/features/shopping/
├── api/shopping-api.ts
├── components/create-list-sheet.tsx
├── components/reconcile-list-sheet.tsx
├── components/shopping-item-row.tsx
├── hooks/use-shopping-list.ts
├── pages/shopping-list-page.test.tsx
└── pages/shopping-list-page.tsx
e2e/
├── fixtures/shopping.ts
└── specs/
    ├── shopping-list-races.spec.ts
    └── shopping-list.spec.ts
```

## Locked Shopping Interfaces

`shared/contracts/shopping.ts` owns these exact exported names: `StoreSection`, `ShoppingSourceIngredient`, `ShoppingLabelSnapshot`, `ShoppingDraftItem`, `ShoppingDraft`, `ShoppingItem`, `ShoppingList`, `ShoppingDiff`, `CreateShoppingListRequest`, `CreateShoppingListResponse`, `ReconcileShoppingListRequest`, `ReconcileShoppingListResponse`, `CurrentShoppingLabelWarning`, `RefreshShoppingListSafetyRpcResponse`, `ShoppingListSafetyData`, `ShoppingItemMutationRequest`, and `ShoppingItemMutationResponse`. The strict `refreshShoppingListSafetyRpcResponseSchema` is an internal database-boundary shape; only a separately parsed `shoppingListSafetyDataSchema` may cross the HTTP boundary. No task defines a second shopping-list shape.

It also owns `PreviewShoppingDiffRequest` and `PreviewShoppingDiffResponse`; preview data is built by the authenticated server loader. Browser code never invents human labels from `sourcePath`, `allergenId`, or `anonymousMemberRef`.

Creation calls `createShoppingListFromMenu(deps, command)`. Reconciliation calls `reconcileShoppingList(deps, command)`. Production dependencies are created only by `createShoppingDependencies(user: { userId: string; accessToken: string }): ShoppingDependencies`. Handlers use the Plan 2 HTTP helpers and never call `request.json()` or construct an alternate envelope directly.

`createShoppingCommandHash(command)` and `createReconciliationRequestHash(command)` hash only their canonical authenticated command fields, with set-like approval arrays sorted. Both hashes are computable before any menu/list/safety query. `revalidateActiveShoppingList(listId)` returns a current `ShoppingListSafetyData`; it returns no usable fingerprint unless every menu-derived source is still present and currently valid. `mutateShoppingItem(input)` passes that exact fingerprint to the authenticated `mutate_shopping_item` RPC and returns `{listId,version,itemId,replayed}`; browser code never writes `shopping_items` directly.

### Task 1: Define exact Shopping contracts, normalization, aggregation, and diff approval

**Files:**
- Create: `shared/contracts/shopping.ts`
- Create: `shared/shopping/normalize.ts`
- Create: `shared/shopping/reviewed-aliases.ts`
- Create: `shared/shopping/aggregate.ts`
- Create: `shared/shopping/aggregate.test.ts`
- Create: `shared/shopping/diff.ts`
- Create: `shared/shopping/diff.test.ts`

**Interfaces:**
- Consumes: `storeSections`, `DishIngredient`, and `MenuLabelConfirmation` from `shared/contracts/generation.ts`; pantry rows from Plan 2.
- Produces: all Locked Shopping Interfaces, `buildShoppingDraft(input): ShoppingDraft`, `computeShoppingDiff(current,next): ShoppingDiff`, and `resolveApprovedDiff(diff, approval): ResolvedShoppingDiff`.

- [ ] **Step 1 (2–5 min): Write failing numeric, ambiguous, pantry, label, and preservation tests**

Create `shared/shopping/aggregate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildShoppingDraft } from "./aggregate";
import { reviewedShoppingAliases } from "./reviewed-aliases";

const ingredient = (overrides: Partial<{
  ingredientId: string; dishId: string; dishName: string; name: string;
  quantityValue: number | null; quantityText: string; unit: string | null;
  storeSection: "produce" | "meat_fish" | "dairy_eggs" | "dry_goods" | "seasonings" | "other";
}> = {}) => ({
  ingredientId: "10000000-0000-4000-8000-000000000001",
  dishId: "10000000-0000-4000-8000-000000000002",
  dishName: "料理",
  name: "にんじん",
  quantityValue: 1,
  quantityText: "1本",
  unit: "本",
  storeSection: "produce" as const,
  ...overrides,
});

describe("buildShoppingDraft", () => {
  it("combines only numeric same-name same-unit rows and subtracts known pantry", () => {
    const draft = buildShoppingDraft({
      menuId: "10000000-0000-4000-8000-000000000010",
      menuVersion: 1,
      ingredients: [
        ingredient(),
        ingredient({ ingredientId: "10000000-0000-4000-8000-000000000003", name: "人参", quantityValue: 2, quantityText: "2本" }),
      ],
      pantry: [{ name: "にんじん", quantity: 1, unit: "本" }],
      aliases: new Map([["人参", "にんじん"]]),
      labels: [],
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      normalizedName: "にんじん", quantityValue: 2, quantityText: "2本",
      unit: "本", storeSection: "produce", pantryCheckRequired: false,
    });
  });

  it("keeps ambiguous quantities and different units separate", () => {
    const draft = buildShoppingDraft({
      menuId: "10000000-0000-4000-8000-000000000010",
      menuVersion: 1,
      ingredients: [
        ingredient({ quantityValue: null, quantityText: "少々", unit: null, storeSection: "seasonings" }),
        ingredient({ ingredientId: "10000000-0000-4000-8000-000000000004", quantityValue: null, quantityText: "適量", unit: null, storeSection: "seasonings" }),
      ],
      pantry: [],
      aliases: new Map(),
      labels: [],
    });
    expect(draft.items.map((item) => item.quantityText)).toEqual(["少々", "適量"]);
    expect(draft.items.every((item) => item.storeSection === "seasonings")).toBe(true);
  });

  it("retains quantity when matching pantry quantity is unknown and snapshots labels", () => {
    const source = ingredient();
    const draft = buildShoppingDraft({
      menuId: "10000000-0000-4000-8000-000000000010",
      menuVersion: 1,
      ingredients: [source],
      pantry: [{ name: "にんじん", quantity: null, unit: null }],
      aliases: new Map(),
      labels: [{
        confirmationId: "10000000-0000-4000-8000-000000000020",
        warningKey: "a".repeat(64),
        sourceMenuId: "10000000-0000-4000-8000-000000000010",
        sourceDerivationGroupId: "10000000-0000-4000-8000-000000000011",
        sourceType: "ingredient", sourceId: source.ingredientId,
        sourcePath: "dishes.0.ingredients.0", allergenId: "soy",
        allergenDisplayName: "大豆", anonymousMemberRef: "member_1",
        memberDisplayName: "家族1", sourceDisplayName: "にんじん",
        dictionaryVersion: "allergen-v1",
        confirmationStatus: "pending",
      }],
    });
    expect(draft.items[0]).toMatchObject({ quantityValue: 1, pantryCheckRequired: true });
    expect(draft.items[0]?.labelWarnings).toHaveLength(1);
  });

  it("matches pantry by reviewed name first and requires a check for unknown or mismatched units", () => {
    const draft = buildShoppingDraft({
      menuId: crypto.randomUUID(), menuVersion: 1,
      ingredients: [ingredient({ name: "人参", quantityValue: 2, unit: "本", quantityText: "2本" })],
      pantry: [{ name: "にんじん", quantity: 1, unit: null }],
      aliases: reviewedShoppingAliases, labels: [],
    });
    expect(draft.items[0]).toMatchObject({ quantityValue: 2, pantryCheckRequired: true });
  });

  it("resets confirmed menu labels to human-readable shopping pending warnings",()=>{
    const source=ingredient();
    const confirmed={confirmationId:crypto.randomUUID(),warningKey:"b".repeat(64),
      sourceMenuId:crypto.randomUUID(),
      sourceDerivationGroupId:crypto.randomUUID(),sourceType:"ingredient" as const,
      sourceId:source.ingredientId,sourcePath:"dishes.0.ingredients.0.name",allergenId:"wheat",
      allergenDisplayName:"小麦",anonymousMemberRef:"member_1",memberDisplayName:"子ども",
      sourceDisplayName:"カレールー",dictionaryVersion:"allergen-v1",
      confirmationStatus:"confirmed" as const};
    const draft=buildShoppingDraft({menuId:crypto.randomUUID(),menuVersion:1,
      ingredients:[source],pantry:[],aliases:new Map(),labels:[confirmed]});
    expect(draft.items[0]?.labelWarnings[0]).toMatchObject({confirmationStatus:"pending",
      sourceDisplayName:"カレールー",allergenDisplayName:"小麦",memberDisplayName:"子ども"});
  });
});
```

Create `shared/shopping/diff.test.ts`:

```ts
import { expect, it } from "vitest";
import { computeShoppingDiff, resolveApprovedDiff } from "./diff";
import type { ShoppingDraft, ShoppingLabelSnapshot, ShoppingList } from "../contracts/shopping";

it("does not propose checked, manual, edited, or removed rows", () => {
  const current = makeShoppingList([
    makeItem({ id: "10000000-0000-4000-8000-000000000001", isChecked: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000002", isManual: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000003", isManuallyEdited: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000004", isRemovedByUser: true }),
  ]);
  const diff = computeShoppingDiff(current, { items: [], listLabelWarnings: [] });
  expect(diff.remove.map((operation) => operation.itemId)).toEqual([]);
  expect(diff.protectedItemIds).toHaveLength(4);
});

it("matches repeated ambiguous rows one-to-one without dropping warnings",()=>{
  const first={...makeDraft().items[0]!,key:"salt-small",displayName:"塩",
    normalizedName:"塩",storeSection:"seasonings" as const,
    quantityValue:null,quantityText:"少々",unit:null,
    labelWarnings:[makeShoppingWarning({sourceDisplayName:"塩 少々"})]};
  const second={...first,key:"salt-as-needed",quantityText:"適量",
    labelWarnings:[makeShoppingWarning({sourceDisplayName:"塩 適量"})]};
  const diff=computeShoppingDiff(makeShoppingList([]),{
    items:[first,second],listLabelWarnings:[],
  });
  expect(diff.add.map((item)=>[item.key,item.quantityText,
    item.labelWarnings[0]?.sourceDisplayName])).toEqual([
      ["salt-small","少々","塩 少々"],
      ["salt-as-needed","適量","塩 適量"],
    ]);
});

it("resolves only operation IDs contained in the server diff", () => {
  const diff = computeShoppingDiff(makeShoppingList([]), makeDraft());
  expect(() => resolveApprovedDiff(diff, {
    addKeys: ["client-invented"], replaceItemIds: [], removeItemIds: [],
  })).toThrow("approved_diff_mismatch");
});

it("preserves a checked derived row and proposes only its positive required delta", () => {
  const current = makeShoppingList([makeItem({ id: crypto.randomUUID(), quantityValue: 1,
    quantityText: "1本", unit: "本", isChecked: true })]);
  const next = makeDraft();
  next.items[0] = { ...next.items[0]!, displayName: "にんじん", normalizedName: "にんじん",
    storeSection: "produce", quantityValue: 3, quantityText: "3本", unit: "本" };
  const diff = computeShoppingDiff(current, next);
  expect(diff.protectedItemIds).toEqual([current.items[0]!.id]);
  expect(diff.add[0]).toMatchObject({ quantityValue: 2, quantityText: "2本" });
  expect(diff.remove).toEqual([]);
});

it("keeps a removed row and proposes its larger known delta or unknown review item",()=>{
  const removed=makeItem({quantityValue:1,quantityText:"1本",unit:"本",isRemovedByUser:true});
  const next=makeDraft();next.items[0]={...next.items[0]!,displayName:"にんじん",
    normalizedName:"にんじん",quantityValue:3,quantityText:"3本",unit:"本"};
  expect(computeShoppingDiff(makeShoppingList([removed]),next).add[0])
    .toMatchObject({quantityValue:2,quantityText:"2本"});
  next.items[0]={...next.items[0]!,quantityValue:null,quantityText:"適量",unit:null};
  expect(computeShoppingDiff(makeShoppingList([removed]),next).add[0])
    .toMatchObject({pantryCheckRequired:true});
});

function makeItem(overrides: Partial<ShoppingList["items"][number]> = {}): ShoppingList["items"][number] {
  return {
    id: crypto.randomUUID(), listId: "10000000-0000-4000-8000-000000000010",
    displayName: "にんじん", normalizedName: "にんじん", storeSection: "produce",
    quantityValue: 1, quantityText: "1本", unit: "本", pantryCheckRequired: false,
    isChecked: false, isManual: false, isManuallyEdited: false, isRemovedByUser: false,
    labelWarnings: [], ...overrides,
  };
}
function makeShoppingWarning(
  overrides:Partial<ShoppingLabelSnapshot>={},
):ShoppingLabelSnapshot{
  return {confirmationId:null,warningKey:"c".repeat(64),sourceMenuId:crypto.randomUUID(),
    sourceDerivationGroupId:crypto.randomUUID(),sourceType:"ingredient",
    sourceId:crypto.randomUUID(),sourcePath:"dishes.0.ingredients.0.name",
    allergenId:"wheat",allergenDisplayName:"小麦",anonymousMemberRef:"member_1",
    memberDisplayName:"子ども",sourceDisplayName:"材料",dictionaryVersion:"allergen-v1",
    confirmationStatus:"pending",...overrides};
}
function makeShoppingList(items: ShoppingList["items"]): ShoppingList {
  return { id: "10000000-0000-4000-8000-000000000010", status: "active", version: 1, items, listLabelWarnings: [] };
}
function makeDraft(): ShoppingDraft {
  return {
    items: [{
      key: "add-key", displayName: "牛乳", normalizedName: "牛乳", storeSection: "dairy_eggs",
      quantityValue: 1, quantityText: "1本", unit: "本", pantryCheckRequired: false,
      sourceIngredients: [], labelWarnings: [],
    }],
    listLabelWarnings: [],
  };
}
```

- [ ] **Step 2 (2–5 min): Run the focused tests and verify RED**

Run: `npm test -- --run shared/shopping/aggregate.test.ts shared/shopping/diff.test.ts`

Expected: FAIL with module-not-found errors for `shopping` contracts, aggregation, and diff modules.

- [ ] **Step 3 (2–5 min): Implement the complete exact contract**

Create `shared/contracts/shopping.ts`:

```ts
import { z } from "zod";
import { labelSourceTypes, storeSections } from "./generation";

const uuid = z.string().uuid();
export type StoreSection = (typeof storeSections)[number];

export const shoppingSourceIngredientSchema = z.object({
  ingredientId: uuid,
  dishId: uuid,
  dishName: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  quantityValue: z.number().positive().nullable(),
  quantityText: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(24).nullable(),
  storeSection: z.enum(storeSections),
}).strict();

export const shoppingLabelSnapshotSchema = z.object({
  confirmationId: uuid.nullable(),
  warningKey: z.string().regex(/^[a-f0-9]{64}$/),
  sourceMenuId: uuid,
  sourceDerivationGroupId: uuid,
  sourceType: z.enum(labelSourceTypes),
  sourceId: uuid,
  sourcePath: z.string().trim().min(1).max(200),
  allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  allergenDisplayName: z.string().trim().min(1).max(100),
  anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
  memberDisplayName: z.string().trim().min(1).max(100),
  sourceDisplayName: z.string().trim().min(1).max(500),
  dictionaryVersion: z.string().trim().min(1).max(80),
  confirmationStatus: z.enum(["pending", "confirmed"]),
}).strict();

export const shoppingDraftItemSchema = z.object({
  key: z.string().min(1).max(200),
  existingItemId: uuid.optional(),
  displayName: z.string().trim().min(1).max(100),
  normalizedName: z.string().trim().min(1).max(100),
  storeSection: z.enum(storeSections),
  quantityValue: z.number().positive().nullable(),
  quantityText: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(24).nullable(),
  pantryCheckRequired: z.boolean(),
  sourceIngredients: z.array(shoppingSourceIngredientSchema).min(1),
  labelWarnings: z.array(shoppingLabelSnapshotSchema),
}).strict();

export const shoppingDraftSchema = z.object({
  items: z.array(shoppingDraftItemSchema),
  listLabelWarnings: z.array(shoppingLabelSnapshotSchema),
}).strict();

export const shoppingItemSchema = z.object({
  id: uuid, listId: uuid, displayName: z.string(), normalizedName: z.string(),
  storeSection: z.enum(storeSections), quantityValue: z.number().positive().nullable(),
  quantityText: z.string(), unit: z.string().nullable(), pantryCheckRequired: z.boolean(),
  isChecked: z.boolean(), isManual: z.boolean(), isManuallyEdited: z.boolean(),
  isRemovedByUser: z.boolean(), labelWarnings: z.array(shoppingLabelSnapshotSchema),
}).strict();

export const shoppingListSchema = z.object({
  id: uuid, status: z.enum(["active", "archived"]), version: z.number().int().positive(),
  items: z.array(shoppingItemSchema), listLabelWarnings: z.array(shoppingLabelSnapshotSchema),
}).strict();

export const shoppingDiffSchema = z.object({
  add: z.array(shoppingDraftItemSchema),
  replace: z.array(z.object({ itemId: uuid,
    current:z.object({displayName:z.string(),quantityText:z.string(),storeSection:z.enum(storeSections)}).strict(),
    next: shoppingDraftItemSchema }).strict()),
  remove: z.array(z.object({ itemId: uuid, displayName: z.string(),quantityText:z.string() }).strict()),
  protectedItemIds: z.array(uuid),
  listLabelWarnings: z.array(shoppingLabelSnapshotSchema),
}).strict();

const activeExpectation = z.object({
  activeListId: uuid.nullable(),
  expectedListVersion: z.number().int().positive().nullable(),
}).superRefine((value, context) => {
  if ((value.activeListId === null) !== (value.expectedListVersion === null)) {
    context.addIssue({ code: "custom", path: ["expectedListVersion"], message: "active_expectation_pair_required" });
  }
});

export const createShoppingListRequestSchema = z.object({
  menuId: uuid, mode: z.enum(["new", "append"]),
  activeListId: uuid.nullable(), expectedListVersion: z.number().int().positive().nullable(),
  idempotencyKey: uuid,
}).strict().and(activeExpectation).superRefine((value, context) => {
  if (value.mode === "append" && value.activeListId === null) {
    context.addIssue({ code: "custom", path: ["activeListId"], message: "active_list_required" });
  }
});

export const createShoppingListResponseSchema = z.object({
  listId: uuid, version: z.number().int().positive(), replayed: z.boolean(),
}).strict();

export const reconcileShoppingListRequestSchema = z.object({
  expectedListVersion: z.number().int().positive(),
  sourceMenuId: uuid, sourceMenuVersion: z.number().int().positive(),
  idempotencyKey: uuid,
  approval: z.object({
    addKeys: z.array(z.string().min(1).max(200)),
    replaceItemIds: z.array(uuid),
    removeItemIds: z.array(uuid),
  }).strict(),
}).strict();

export const reconcileShoppingListResponseSchema = createShoppingListResponseSchema;
export const previewShoppingDiffRequestSchema = z.object({
  sourceMenuId: uuid, sourceMenuVersion: z.number().int().positive(),
  expectedListVersion: z.number().int().positive(),
}).strict();
export const previewShoppingDiffResponseSchema = shoppingDiffSchema;

export const currentShoppingLabelWarningSchema=z.object({
  itemId:uuid.nullable(),
  warningKey:z.string().regex(/^[a-f0-9]{64}$/),
  sourceMenuId:uuid,
  sourceDerivationGroupId:uuid,
  sourceType:z.enum(labelSourceTypes),
  sourceId:uuid,
  sourcePath:z.string().trim().min(1).max(200),
  allergenId:z.string().regex(/^[a-z][a-z0-9_]*$/),
  allergenDisplayName:z.string().trim().min(1).max(100),
  anonymousMemberRef:z.string().regex(/^member_[1-9][0-9]*$/),
  memberDisplayName:z.string().trim().min(1).max(100),
  sourceDisplayName:z.string().trim().min(1).max(500),
  dictionaryVersion:z.string().trim().min(1).max(80),
}).strict();
export const refreshShoppingListSafetyRpcResponseSchema=z.object({
  listId:uuid,
  safetyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  currentLabelWarnings:z.array(currentShoppingLabelWarningSchema).max(300),
}).strict();
export const shoppingListSafetyDataSchema=z.discriminatedUnion("status",[
  z.object({status:z.literal("valid"),safetyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
    checkedSourceMenuIds:z.array(uuid).max(50),
    currentLabelWarnings:z.array(currentShoppingLabelWarningSchema).max(300),
    issues:z.array(z.never())}).strict(),
  z.object({status:z.enum(["invalid","unverifiable"]),safetyFingerprint:z.null(),
    checkedSourceMenuIds:z.array(uuid).max(50),currentLabelWarnings:z.array(z.never()),
    issues:z.array(z.object({
      code:z.enum(["source_menu_unavailable","current_safety_invalid","safety_check_failed"]),
      message:z.string().trim().min(1).max(200),sourceMenuId:uuid.nullable(),
    }).strict()).min(1)}).strict(),
]);
export type ShoppingListSafetyData=z.infer<typeof shoppingListSafetyDataSchema>;
export type CurrentShoppingLabelWarning=z.infer<typeof currentShoppingLabelWarningSchema>;
export type RefreshShoppingListSafetyRpcResponse=
  z.infer<typeof refreshShoppingListSafetyRpcResponseSchema>;

const mutationBase={listId:uuid,expectedListVersion:z.number().int().positive(),
  expectedSafetyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:uuid};
export const shoppingItemMutationRequestSchema=z.discriminatedUnion("operation",[
  z.object({...mutationBase,operation:z.literal("add_manual"),itemId:z.null(),payload:z.object({
    displayName:z.string().trim().min(1).max(100),normalizedName:z.string().trim().min(1).max(100),
    storeSection:z.enum(storeSections),quantityValue:z.number().positive().nullable(),
    quantityText:z.string().trim().min(1).max(60),unit:z.string().trim().min(1).max(24).nullable(),
    pantryCheckRequired:z.literal(false),
  }).strict()}).strict(),
  z.object({...mutationBase,operation:z.literal("set_checked"),itemId:uuid,
    payload:z.object({isChecked:z.boolean()}).strict()}).strict(),
  z.object({...mutationBase,operation:z.literal("edit"),itemId:uuid,payload:z.object({
    displayName:z.string().trim().min(1).max(100),normalizedName:z.string().trim().min(1).max(100),
    storeSection:z.enum(storeSections),quantityValue:z.number().positive().nullable(),
    quantityText:z.string().trim().min(1).max(60),unit:z.string().trim().min(1).max(24).nullable(),
  }).strict()}).strict(),
  z.object({...mutationBase,operation:z.literal("remove"),itemId:uuid,
    payload:z.object({}).strict()}).strict(),
  z.object({...mutationBase,operation:z.literal("mark_at_home"),itemId:uuid,
    payload:z.object({}).strict()}).strict(),
  z.object({...mutationBase,operation:z.literal("undo"),itemId:uuid,
    payload:z.object({}).strict()}).strict(),
]);
export const shoppingItemMutationResponseSchema=z.object({listId:uuid,
  version:z.number().int().positive(),itemId:uuid,replayed:z.boolean()}).strict();

export type ShoppingSourceIngredient = z.infer<typeof shoppingSourceIngredientSchema>;
export type ShoppingLabelSnapshot = z.infer<typeof shoppingLabelSnapshotSchema>;
export type ShoppingDraftItem = z.infer<typeof shoppingDraftItemSchema>;
export type ShoppingDraft = z.infer<typeof shoppingDraftSchema>;
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;
export type ShoppingList = z.infer<typeof shoppingListSchema>;
export type ShoppingDiff = z.infer<typeof shoppingDiffSchema>;
export type CreateShoppingListRequest = z.infer<typeof createShoppingListRequestSchema>;
export type CreateShoppingListResponse = z.infer<typeof createShoppingListResponseSchema>;
export type ReconcileShoppingListRequest = z.infer<typeof reconcileShoppingListRequestSchema>;
export type ReconcileShoppingListResponse = z.infer<typeof reconcileShoppingListResponseSchema>;
export type PreviewShoppingDiffRequest = z.infer<typeof previewShoppingDiffRequestSchema>;
export type PreviewShoppingDiffResponse = z.infer<typeof previewShoppingDiffResponseSchema>;
export type ShoppingItemMutationRequest=z.infer<typeof shoppingItemMutationRequestSchema>;
export type ShoppingItemMutationResponse=z.infer<typeof shoppingItemMutationResponseSchema>;
```

- [ ] **Step 4 (2–5 min): Implement complete normalization, aggregation, and diff resolution**

Create `shared/shopping/normalize.ts`:

```ts
export function normalizeIngredientName(
  name: string,
  aliases: ReadonlyMap<string, string>,
): string {
  const compact = name.normalize("NFKC").trim().replace(/\s+/gu, "");
  return aliases.get(compact) ?? compact;
}
```

Create `shared/shopping/reviewed-aliases.ts`; this exact allowlist is reviewed with the catalog release and is the only non-identity name mapping. Do not add edit-distance or substring matching:

```ts
export const reviewedShoppingAliases: ReadonlyMap<string, string> = new Map([
  ["人参", "にんじん"], ["ニンジン", "にんじん"],
  ["玉葱", "玉ねぎ"], ["たまねぎ", "玉ねぎ"],
  ["馬鈴薯", "じゃがいも"], ["ジャガイモ", "じゃがいも"],
  ["鶏もも", "鶏もも肉"], ["鳥もも肉", "鶏もも肉"],
]);
```

Create `shared/shopping/aggregate.ts`:

```ts
import type {
  ShoppingDraft, ShoppingDraftItem, ShoppingLabelSnapshot, ShoppingSourceIngredient,
} from "../contracts/shopping";
import { normalizeIngredientName } from "./normalize";

type PantryAmount = { name: string; quantity: number | null; unit: string | null };
export type ShoppingDraftInput = {
  menuId: string; menuVersion: number; ingredients: readonly ShoppingSourceIngredient[];
  pantry: readonly PantryAmount[]; aliases: ReadonlyMap<string, string>;
  labels: readonly ShoppingLabelSnapshot[];
};

function itemKey(normalizedName: string, unit: string | null, sourceIds: readonly string[]): string {
  const value=JSON.stringify([normalizedName,unit,[...sourceIds].sort()]);
  let hash=14695981039346656037n;
  for(const character of value){hash^=BigInt(character.codePointAt(0)??0);
    hash=BigInt.asUintN(64,hash*1099511628211n);}
  return `item_${hash.toString(16).padStart(16,"0")}`;
}

export function buildShoppingDraft(input: ShoppingDraftInput): ShoppingDraft {
  const numeric = new Map<string, ShoppingDraftItem>();
  const ambiguous: ShoppingDraftItem[] = [];
  for (const source of input.ingredients) {
    const normalizedName = normalizeIngredientName(source.name, input.aliases);
    const warnings = input.labels.filter(
      (label) => label.sourceType === "ingredient" && label.sourceId === source.ingredientId,
    ).map((label)=>({...label,confirmationStatus:"pending" as const}));
    if (source.quantityValue === null || source.unit === null) {
      ambiguous.push({
        key: itemKey(normalizedName, source.unit, [source.ingredientId]),
        displayName: source.name, normalizedName, storeSection: source.storeSection,
        quantityValue: null, quantityText: source.quantityText, unit: source.unit,
        pantryCheckRequired: input.pantry.some(
          (item) => normalizeIngredientName(item.name, input.aliases) === normalizedName,
        ),
        sourceIngredients: [source], labelWarnings: warnings,
      });
      continue;
    }
    const groupKey = JSON.stringify([normalizedName, source.unit]);
    const previous = numeric.get(groupKey);
    const sources = [...(previous?.sourceIngredients ?? []), source];
    const quantityValue = (previous?.quantityValue ?? 0) + source.quantityValue;
    numeric.set(groupKey, {
      key: itemKey(normalizedName, source.unit, sources.map((item) => item.ingredientId)),
      displayName: previous?.displayName ?? source.name, normalizedName,
      storeSection: previous?.storeSection ?? source.storeSection,
      quantityValue, quantityText: `${quantityValue}${source.unit}`, unit: source.unit,
      pantryCheckRequired: false, sourceIngredients: sources,
      labelWarnings: [...(previous?.labelWarnings ?? []), ...warnings],
    });
  }

  const kept: ShoppingDraftItem[] = [];
  for (const item of [...numeric.values(), ...ambiguous]) {
    if (item.quantityValue === null || item.unit === null) {
      kept.push(item);
      continue;
    }
    const sameName = input.pantry.filter((candidate) =>
      normalizeIngredientName(candidate.name, input.aliases) === item.normalizedName);
    const sameUnit = sameName.filter((candidate) => candidate.unit === item.unit);
    if (sameName.length === 0) {
      kept.push(item);
    } else if (sameUnit.length === 0 || sameUnit.some((candidate) => candidate.quantity === null)) {
      kept.push({ ...item, pantryCheckRequired: true });
    } else {
      const pantryQuantity = sameUnit.reduce((sum, candidate) => sum + (candidate.quantity ?? 0), 0);
      const remaining = Math.max(0, item.quantityValue - pantryQuantity);
      if (remaining > 0) {
        kept.push({ ...item, quantityValue: remaining, quantityText: `${remaining}${item.unit}` });
      }
    }
  }
  const labelKey=(label:ShoppingLabelSnapshot)=>JSON.stringify([
    label.sourceType,label.sourceId,label.allergenId,label.anonymousMemberRef,
  ]);
  const attached = new Set(kept.flatMap((item) => item.labelWarnings.map(labelKey)));
  return {
    items: kept,
    listLabelWarnings: input.labels.filter((label) => !attached.has(labelKey(label)))
      .map((label)=>({...label,confirmationStatus:"pending" as const})),
  };
}
```

Create `shared/shopping/diff.ts`:

```ts
import type { ShoppingDiff, ShoppingDraft, ShoppingDraftItem, ShoppingList } from "../contracts/shopping";

export type ShoppingDiffApproval = {
  addKeys: readonly string[]; replaceItemIds: readonly string[]; removeItemIds: readonly string[];
};
export type ResolvedShoppingDiff = {
  add: ShoppingDraftItem[]; replace: Array<ShoppingDraftItem & { existingItemId: string }>;
  removeIds: string[]; listLabelWarnings: ShoppingDraft["listLabelWarnings"];
};

const protectedItem = (item: ShoppingList["items"][number]) =>
  item.isChecked || item.isManual || item.isManuallyEdited || item.isRemovedByUser;
const diffKey = (item: {
  normalizedName:string;unit:string|null;quantityValue:number|null;
  quantityText:string;storeSection:string;
}) => item.quantityValue === null || item.unit === null
  ? JSON.stringify(["ambiguous",item.normalizedName,item.unit,item.quantityText,item.storeSection])
  : JSON.stringify(["numeric",item.normalizedName,item.unit]);

export function computeShoppingDiff(current: ShoppingList, next: ShoppingDraft): ShoppingDiff {
  const nextBuckets=new Map<string,ShoppingDraftItem[]>();
  for(const item of next.items){
    const key=diffKey(item);const bucket=nextBuckets.get(key)??[];
    bucket.push(item);nextBuckets.set(key,bucket);
  }
  const takeCandidate=(key:string):ShoppingDraftItem|undefined=>{
    const bucket=nextBuckets.get(key);const candidate=bucket?.shift();
    if(bucket?.length===0)nextBuckets.delete(key);
    return candidate;
  };
  const add: ShoppingDraftItem[] = [];
  const replace: ShoppingDiff["replace"] = [];
  const remove: ShoppingDiff["remove"] = [];
  const protectedItemIds: string[] = [];

  for (const item of current.items) {
    if (protectedItem(item)) {
      protectedItemIds.push(item.id);
      if (item.isManual) continue; // a manual row never satisfies a derived requirement
      const candidate = takeCandidate(diffKey(item));
      if (candidate !== undefined && item.quantityValue !== null && candidate.quantityValue !== null
        && item.unit !== null && candidate.unit === item.unit) {
        const delta = candidate.quantityValue - item.quantityValue;
        if (delta > 0) add.push({ ...candidate,
          key: `${candidate.key}_delta_${item.id}`, quantityValue: delta,
          quantityText: `${delta}${candidate.unit}` });
      } else if (candidate !== undefined) {
        add.push({ ...candidate, key: `${candidate.key}_review_${item.id}`,
          pantryCheckRequired: true });
      }
      continue;
    }
    const candidate = takeCandidate(diffKey(item));
    if (candidate === undefined) {
      remove.push({ itemId: item.id, displayName: item.displayName,
        quantityText:item.quantityText });
    } else if (
      candidate.quantityValue !== item.quantityValue ||
      candidate.quantityText !== item.quantityText ||
      candidate.storeSection !== item.storeSection
    ) {
      replace.push({ itemId: item.id,current:{displayName:item.displayName,
        quantityText:item.quantityText,storeSection:item.storeSection},next: candidate });
    }
  }
  add.push(...[...nextBuckets.values()].flat());
  return { add, replace, remove, protectedItemIds, listLabelWarnings: next.listLabelWarnings };
}

export function resolveApprovedDiff(
  diff: ShoppingDiff,
  approval: ShoppingDiffApproval,
): ResolvedShoppingDiff {
  const add = new Map(diff.add.map((item) => [item.key, item]));
  const replace = new Map(diff.replace.map((item) => [item.itemId, item.next]));
  const remove = new Set(diff.remove.map((item) => item.itemId));
  const resolvedAdd = approval.addKeys.map((key) => add.get(key));
  const resolvedReplace = approval.replaceItemIds.map((id) => {
    const next = replace.get(id);
    return next === undefined ? undefined : { ...next, existingItemId: id };
  });
  if (
    resolvedAdd.some((item) => item === undefined) ||
    resolvedReplace.some((item) => item === undefined) ||
    approval.removeItemIds.some((id) => !remove.has(id))
  ) {
    throw new Error("approved_diff_mismatch");
  }
  return {
    add: resolvedAdd.filter((item): item is ShoppingDraftItem => item !== undefined),
    replace: resolvedReplace.filter(
      (item): item is ShoppingDraftItem & { existingItemId: string } => item !== undefined,
    ),
    removeIds: [...approval.removeItemIds],
    listLabelWarnings: diff.listLabelWarnings,
  };
}
```

- [ ] **Step 5 (2–5 min): Run tests, typecheck, and commit**

Run:

```bash
npm test -- --run shared/shopping/aggregate.test.ts shared/shopping/diff.test.ts
npm run typecheck
```

Expected: all aggregation/diff tests pass; `rg -n '"seasoning"' shared/contracts/shopping.ts shared/shopping` returns no matches.

```bash
git add shared/contracts/shopping.ts shared/shopping
git commit -m "feat: define exact shopping contracts"
```

### Task 2: Add owner-complete tables, immutable provenance, latest safety projection, retention, RLS, and public service-role RPCs

**Files:**
- Create: `supabase/migrations/20260711004000_shopping_lists.sql`
- Create: `supabase/tests/database/shopping_lists.test.sql`
- Regenerate: `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: Plan 4 `menus.version` and `delete_menu_group`; Plan 2 menu/ingredient/label tables.
- Produces: six public user-owned shopping tables, immutable `shopping_label_confirmations`, latest-only `shopping_current_label_warnings`, a 30-day private idempotency ledger with cleanup helpers, six service-only public RPCs—`shopping_safety_fingerprint`, `shopping_list_safety_fingerprint`, `refresh_shopping_list_safety`, `apply_shopping_draft`, `apply_shopping_reconciliation`, `get_shopping_mutation_replay`—and authenticated owner RPC `mutate_shopping_item` with the exact signatures below.

- [ ] **Step 1 (2–5 min): Write failing structure, RLS, grant, preservation, and history-deletion pgTAP assertions**

Create `supabase/tests/database/shopping_lists.test.sql` with the Plan 1 `000_helpers.sql` include, two users, and these assertions:

```sql
\ir 000_helpers.sql
begin;
select plan(41);
select has_table('public','shopping_lists');
select has_table('public','shopping_items');
select has_table('public','shopping_list_sources');
select has_table('public','shopping_item_sources');
select has_table('public','shopping_label_confirmations');
select has_table('public','shopping_current_label_warnings');
select has_unique('public','dish_ingredients','dish_ingredients_id_user_unique',
  'shopping source owner FK has an exact referenced unique key');
select has_unique('public','menu_label_confirmations','menu_label_confirmations_id_user_unique',
  'shopping label owner FK has an exact referenced unique key');
select has_table('private','shopping_mutations');
select ok((select bool_and(attnotnull) from pg_attribute
  where attrelid in ('public.shopping_lists'::regclass,'public.shopping_items'::regclass,
    'public.shopping_list_sources'::regclass,'public.shopping_item_sources'::regclass,
    'public.shopping_label_confirmations'::regclass,
    'public.shopping_current_label_warnings'::regclass)
    and attname='user_id' and not attisdropped), 'every public shopping table has non-null user_id');
select row_security_is('public','shopping_lists',true);
select row_security_is('public','shopping_items',true);
select row_security_is('public','shopping_list_sources',true);
select row_security_is('public','shopping_item_sources',true);
select row_security_is('public','shopping_label_confirmations',true);
select row_security_is('public','shopping_current_label_warnings',true);
select has_function('public','shopping_safety_fingerprint',array['uuid','uuid']);
select has_function('public','shopping_list_safety_fingerprint',array['uuid','uuid']);
select has_function('public','refresh_shopping_list_safety',array['uuid','uuid','text','jsonb']);
select has_function('public','apply_shopping_draft',
  array['uuid','uuid','text','uuid','integer','text','uuid','text','jsonb']);
select has_function('public','apply_shopping_reconciliation',
  array['uuid','uuid','integer','uuid','integer','text','uuid','text','jsonb']);
select has_function('public','get_shopping_mutation_replay',array['uuid','uuid','text']);
select has_function('public','mutate_shopping_item',
  array['uuid','integer','text','text','uuid','uuid','jsonb']);
select ok(not has_function('private','apply_shopping_draft',
  array['uuid','uuid','text','uuid','integer','text','uuid','text','jsonb']),
  'callable draft RPC is not hidden in private');
select ok(not has_function_privilege('authenticated',
  'public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)','execute'),
  'authenticated cannot execute derived-write RPC');
select ok(has_function_privilege('service_role',
  'public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)','execute'),
  'service role can execute derived-write RPC');
select ok(has_function_privilege('authenticated',
  'public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)','execute'),
  'authenticated owner can execute versioned item RPC');
select col_is_null('public','shopping_list_sources','menu_id','live menu reference is nullable');
select col_is_null('public','shopping_item_sources','dish_ingredient_id','live ingredient reference is nullable');
select col_is_null('public','shopping_label_confirmations','menu_label_confirmation_id','live label reference is nullable');
select col_is_null('public','shopping_label_confirmations','source_confirmation_id_snapshot',
  'a current warning may have no historical confirmation row');
select has_column('public','shopping_label_confirmations','source_warning_key',
  'every warning has a canonical non-null identity independent of a confirmation UUID');
select has_column('public','shopping_current_label_warnings','warning_key',
  'current projection has its independent canonical warning identity');
select ok((select count(*)=3 from information_schema.columns where table_schema='public'
    and table_name='shopping_current_label_warnings'
    and column_name in ('source_display_name','allergen_display_name','member_display_name')),
  'current projection stores all bounded human display fields');
select ok((select count(*)=3 from pg_constraint where
    conrelid='public.shopping_current_label_warnings'::regclass and contype='f'
    and conname in ('shopping_current_label_warnings_list_owner_fk',
      'shopping_current_label_warnings_item_owner_fk',
      'shopping_current_label_warnings_menu_owner_fk')),
  'current projection uses exact composite owner foreign keys');
select ok(not has_table_privilege('authenticated','public.shopping_current_label_warnings','insert')
    and not has_table_privilege('authenticated','public.shopping_current_label_warnings','update')
    and not has_table_privilege('authenticated','public.shopping_current_label_warnings','delete'),
  'browser cannot mutate the latest current projection');
select ok((select count(*)=2 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename in ('household_members','member_allergies'))
    and (select count(*)=2 from pg_class where oid in
      ('public.household_members'::regclass,'public.member_allergies'::regclass)
      and relreplident='f'),
  'owner household safety tables publish full-row cross-device changes');
select ok(not has_table_privilege('authenticated','public.shopping_list_sources','insert'),
  'browser cannot insert source snapshots');
select ok(not has_table_privilege('authenticated','public.shopping_label_confirmations','update'),
  'browser cannot alter warning snapshots');
select ok(not has_table_privilege('authenticated','public.shopping_items','insert'),
  'browser cannot insert shopping rows directly');
select ok(not has_table_privilege('authenticated','public.shopping_items','update')
  and not has_table_privilege('authenticated','public.shopping_items','delete'),
  'browser cannot update or delete shopping rows directly');
select * from finish();
rollback;
```

Add a second transaction in the same file that seeds immutable warning A through `apply_shopping_draft`, saves the complete `shopping_label_confirmations` row as JSONB, refreshes current projection A, then refreshes it with warning B. Assert the provenance row/count/`created_at` remain byte-identical, current projection contains only B, and both RPC responses match the strict internal shape. Delete the menu group as its owner and assert: list/item row counts are unchanged, all immutable live IDs become null, `source_menu_id_snapshot` and warning A's human fields remain unchanged, and `shopping_current_label_warnings` is empty by its live-menu cascade. A failed/fingerprint-raced refresh must roll back without changing either the previous current projection or immutable provenance. Add two concurrent tests using `dblink`: (1) after the expected fingerprint is read, another session updates a target member and the apply RPC raises `safety_fingerprint_changed` with zero shopping rows; (2) while the RPC holds `FOR UPDATE` on target `household_members`, another session's `member_allergies` insert blocks on the parent FK until the RPC commits, so no allergy phantom can enter between the locked fingerprint comparison and writes.

Add an owner-mutation transaction proving authenticated direct INSERT/UPDATE/DELETE privileges are absent, wrong-owner item IDs are indistinguishable as `shopping_item_not_found`, every `add_manual` / `set_checked` / `edit` / `remove` / `mark_at_home` / `undo` success increments the list exactly once, and same-key replay returns the saved version before the stale expected-version check. A `dblink` two-tab test starts both commands at version 3: the first commits version 4, the second receives `list_version_conflict` and changes no item. Reusing the first key with another payload returns `idempotency_payload_mismatch` before list lookup.

Add a retention transaction with 150 expired rows and two fresh rows for user A plus one expired row for user B. Make the requested expired key newer than the oldest 100: one A-owned replay lookup deletes at most those 100 plus that one specifically addressed key, never replays it, and leaves all fresh/B rows untouched; the next A lookup removes at most 49 remaining expired A rows. A row exactly 30 days old under transaction `now()` remains until it is strictly older than the cutoff. This proves logical replay expiry is exact while physical read-path cleanup is owner-scoped, ordered, and bounded; no test or implementation invokes an unbounded ledger delete.

- [ ] **Step 2 (2–5 min): Run DB test and verify RED**

Run: `npm run db:test -- supabase/tests/database/shopping_lists.test.sql`

Expected: FAIL because the shopping relations and public RPCs do not exist.

- [ ] **Step 3 (2–5 min): Create complete tables, owner keys, RLS, and column grants**

Create the first half of `supabase/migrations/20260711004000_shopping_lists.sql`:

```sql
alter table public.dish_ingredients
  add constraint dish_ingredients_id_user_unique unique (id,user_id);
alter table public.menu_label_confirmations
  add constraint menu_label_confirmations_id_user_unique unique (id,user_id);

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version > 0),
  safety_fingerprint text not null check (safety_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id)
);
create unique index shopping_lists_one_active_per_user
  on public.shopping_lists(user_id) where status='active';

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  normalized_name text not null check (char_length(btrim(normalized_name)) between 1 and 100),
  store_section text not null check (store_section in
    ('produce','meat_fish','dairy_eggs','dry_goods','seasonings','other')),
  quantity_value numeric(12,3) check (quantity_value > 0),
  quantity_text text not null check (char_length(btrim(quantity_text)) between 1 and 60),
  unit text check (char_length(btrim(unit)) between 1 and 24),
  pantry_check_required boolean not null default false,
  is_checked boolean not null default false,
  is_manual boolean not null default false,
  is_manually_edited boolean not null default false,
  is_removed_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade
);

create table public.shopping_list_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  menu_id uuid,
  source_menu_id_snapshot uuid not null,
  source_menu_version integer not null check (source_menu_version > 0),
  source_derivation_group_id uuid not null,
  created_at timestamptz not null default now(),
  unique (id,user_id),
  unique (list_id,source_menu_id_snapshot,source_menu_version),
  foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade,
  foreign key (menu_id,user_id) references public.menus(id,user_id) on delete set null (menu_id)
);

create table public.shopping_item_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  dish_ingredient_id uuid,
  source_ingredient_id_snapshot uuid not null,
  source_dish_id_snapshot uuid not null,
  source_dish_name text not null,
  source_name text not null,
  source_quantity_value numeric(12,3),
  source_quantity_text text not null,
  source_unit text,
  created_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (item_id,user_id) references public.shopping_items(id,user_id) on delete cascade,
  foreign key (dish_ingredient_id,user_id)
    references public.dish_ingredients(id,user_id) on delete set null (dish_ingredient_id)
);

create table public.shopping_label_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  item_id uuid,
  menu_label_confirmation_id uuid,
  source_confirmation_id_snapshot uuid,
  source_warning_key text not null check (source_warning_key ~ '^[a-f0-9]{64}$'),
  source_menu_id_snapshot uuid not null,
  source_derivation_group_id uuid not null,
  source_type text not null check (source_type in ('dish','ingredient','recipe_step','adaptation','timeline')),
  source_id_snapshot uuid not null,
  source_path text not null,
  source_display_name text not null check (char_length(btrim(source_display_name)) between 1 and 500),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  allergen_display_name text not null check (char_length(btrim(allergen_display_name)) between 1 and 100),
  anonymous_member_ref text not null,
  member_display_name text not null check (char_length(btrim(member_display_name)) between 1 and 100),
  dictionary_version text not null,
  confirmation_status text not null check (confirmation_status in ('pending','confirmed')),
  created_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade,
  foreign key (item_id,user_id) references public.shopping_items(id,user_id) on delete cascade,
  foreign key (menu_label_confirmation_id,user_id)
    references public.menu_label_confirmations(id,user_id)
    on delete set null (menu_label_confirmation_id)
);
create unique index shopping_label_warning_snapshot_unique
  on public.shopping_label_confirmations(
    list_id,coalesce(item_id,'00000000-0000-0000-0000-000000000000'::uuid),source_warning_key
  );

create table public.shopping_current_label_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  item_id uuid,
  warning_key text not null check (warning_key ~ '^[a-f0-9]{64}$'),
  source_menu_id uuid not null,
  source_derivation_group_id uuid not null,
  source_type text not null check (source_type in
    ('dish','ingredient','recipe_step','adaptation','timeline')),
  source_id uuid not null,
  source_path text not null check (char_length(btrim(source_path)) between 1 and 200),
  source_display_name text not null check (char_length(btrim(source_display_name)) between 1 and 500),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  allergen_display_name text not null check (char_length(btrim(allergen_display_name)) between 1 and 100),
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  member_display_name text not null check (char_length(btrim(member_display_name)) between 1 and 100),
  dictionary_version text not null check (char_length(btrim(dictionary_version)) between 1 and 80),
  checked_at timestamptz not null default now(),
  unique (id,user_id),
  constraint shopping_current_label_warnings_list_owner_fk
    foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade,
  constraint shopping_current_label_warnings_item_owner_fk
    foreign key (item_id,user_id) references public.shopping_items(id,user_id) on delete cascade,
  constraint shopping_current_label_warnings_menu_owner_fk
    foreign key (source_menu_id,user_id) references public.menus(id,user_id) on delete cascade
);
create unique index shopping_current_label_warnings_list_item_key_unique
  on public.shopping_current_label_warnings(
    list_id,coalesce(item_id,'00000000-0000-0000-0000-000000000000'::uuid),warning_key
  );

create table private.shopping_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null check (jsonb_typeof(response)='object'),
  created_at timestamptz not null default now(),
  primary key (user_id,idempotency_key)
);
create index shopping_mutations_created_at_idx
  on private.shopping_mutations(created_at);
create index shopping_mutations_owner_created_at_idx
  on private.shopping_mutations(user_id,created_at,idempotency_key);

create or replace function private.cleanup_expired_shopping_mutations(
  p_user_id uuid,p_limit integer default 100
)
returns bigint language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_deleted bigint;
begin
  if p_user_id is null or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using errcode='22023',message='invalid_cleanup_limit';
  end if;
  delete from private.shopping_mutations target where target.ctid in (
    select candidate.ctid from private.shopping_mutations candidate
      where candidate.user_id=p_user_id
        and candidate.created_at < now()-interval '30 days'
      order by candidate.created_at,candidate.idempotency_key limit p_limit
  );
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$function$;

do $block$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='household_members') then
    execute 'alter publication supabase_realtime add table public.household_members';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='member_allergies') then
    execute 'alter publication supabase_realtime add table public.member_allergies';
  end if;
end;
$block$;
alter table public.household_members replica identity full;
alter table public.member_allergies replica identity full;

create or replace function private.enforce_shopping_item_provenance()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $function$
begin
  if old.is_manual <> new.is_manual
    or (old.is_manually_edited and not new.is_manually_edited) then
    raise exception using errcode='22023',message='shopping_provenance_is_monotonic';
  end if;
  return new;
end;
$function$;
create trigger shopping_items_provenance_monotonic before update on public.shopping_items
for each row execute function private.enforce_shopping_item_provenance();

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.shopping_list_sources enable row level security;
alter table public.shopping_item_sources enable row level security;
alter table public.shopping_label_confirmations enable row level security;
alter table public.shopping_current_label_warnings enable row level security;

create policy shopping_lists_select_own on public.shopping_lists for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_items_select_own on public.shopping_items for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_list_sources_select_own on public.shopping_list_sources for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_item_sources_select_own on public.shopping_item_sources for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_labels_select_own on public.shopping_label_confirmations for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_current_labels_select_own on public.shopping_current_label_warnings
  for select to authenticated using ((select auth.uid())=user_id);

revoke all on public.shopping_lists,public.shopping_items,public.shopping_list_sources,
  public.shopping_item_sources,public.shopping_label_confirmations,
  public.shopping_current_label_warnings from public,anon,authenticated;
grant select on public.shopping_lists,public.shopping_items,public.shopping_list_sources,
  public.shopping_item_sources,public.shopping_label_confirmations,
  public.shopping_current_label_warnings to authenticated;
revoke insert,update,delete on public.shopping_items from authenticated;
```

- [ ] **Step 4 (2–5 min): Append the complete fingerprint/helper/public RPC implementation**

Append the following SQL to the same migration before its final `commit;`. This is the only implementation of the RPCs:

```sql
create or replace function public.shopping_safety_fingerprint(p_user_id uuid,p_menu_id uuid)
returns text language sql stable security definer set search_path=pg_catalog,pg_temp as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'householdMemberId',m.id,'anonymousRef',t.anonymous_ref,'ageBand',m.age_band,
      'allergyStatus',m.allergy_status,
      'allergenIds',coalesce((select jsonb_agg(a.allergen_id order by a.allergen_id)
        from public.member_allergies a where a.user_id=m.user_id and a.member_id=m.id
          and a.allergen_id is not null),'[]'::jsonb),
      'hasUnmappedCustomAllergy',exists(select 1 from public.member_allergies a
        where a.user_id=m.user_id and a.member_id=m.id and a.allergen_id is null),
      'requiredSafetyConstraints',to_jsonb(array(select unnest(m.required_safety_constraints) order by 1)),
      'unsupportedDietStatus',m.unsupported_diet_status,
      'unsupportedDietKinds',to_jsonb(array(select unnest(m.unsupported_diet_kinds) order by 1))
      ) order by m.id)
      from public.household_members m join public.menu_target_members t
        on t.household_member_id=m.id and t.user_id=m.user_id
      where t.menu_id=p_menu_id and m.user_id=p_user_id),'[]'::jsonb),
    'dictionaryVersion',coalesce((select max(dictionary_version) from public.allergen_aliases),''),
    'foodRuleVersion',coalesce((select max(rule_version) from public.food_safety_rules),'')
  )::text,'UTF8'),'sha256'),'hex');
$function$;

create or replace function private.lock_and_check_shopping_safety(
  p_user_id uuid,p_menu_id uuid,p_expected text
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
begin
  perform 1 from public.menus where id=p_menu_id and user_id=p_user_id for share;
  if not found then raise exception using errcode='P0002',message='menu_not_found'; end if;
  perform 1 from public.household_members m join public.menu_target_members t
    on t.household_member_id=m.id and t.user_id=m.user_id
    where t.menu_id=p_menu_id and m.user_id=p_user_id for update of m;
  perform 1 from public.member_allergies a join public.menu_target_members t
    on t.household_member_id=a.member_id and t.user_id=a.user_id
    where t.menu_id=p_menu_id and a.user_id=p_user_id for update of a;
  lock table public.allergen_catalog,public.allergen_aliases,public.food_safety_rules in share mode;
  if public.shopping_safety_fingerprint(p_user_id,p_menu_id)<>p_expected then
    raise exception using errcode='P0001',message='safety_fingerprint_changed';
  end if;
end;
$function$;

create or replace function public.shopping_list_safety_fingerprint(
  p_user_id uuid,p_list_id uuid
) returns text language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $function$
declare v_material text;
begin
  if not exists(select 1 from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active') then return null; end if;
  if exists(select 1 from public.shopping_list_sources
    where list_id=p_list_id and user_id=p_user_id and menu_id is null) then return null; end if;
  select string_agg(source.menu_id::text||':'||
    public.shopping_safety_fingerprint(p_user_id,source.menu_id),'|' order by source.menu_id)
    into v_material from (select distinct menu_id from public.shopping_list_sources
      where list_id=p_list_id and user_id=p_user_id and menu_id is not null) source;
  return encode(extensions.digest(convert_to(coalesce(v_material,'manual-only'),'UTF8'),'sha256'),'hex');
end;
$function$;

create or replace function private.lock_and_check_shopping_list_safety(
  p_user_id uuid,p_list_id uuid,p_expected text
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_source record;v_current text;
begin
  perform 1 from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active' for update;
  if not found then raise exception using errcode='P0002',message='shopping_list_not_found'; end if;
  for v_source in select menu_id from public.shopping_list_sources
    where list_id=p_list_id and user_id=p_user_id order by source_menu_id_snapshot for share
  loop
    if v_source.menu_id is null then
      raise exception using errcode='P0001',message='shopping_safety_fingerprint_changed';
    end if;
    v_current:=public.shopping_safety_fingerprint(p_user_id,v_source.menu_id);
    perform private.lock_and_check_shopping_safety(p_user_id,v_source.menu_id,v_current);
  end loop;
  if public.shopping_list_safety_fingerprint(p_user_id,p_list_id) is distinct from p_expected then
    raise exception using errcode='P0001',message='shopping_safety_fingerprint_changed';
  end if;
end;
$function$;

create or replace function public.refresh_shopping_list_safety(
  p_user_id uuid,p_list_id uuid,p_expected_fingerprint text,p_warnings jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_warning jsonb;v_item_user uuid;v_projection jsonb;
begin
  if jsonb_typeof(p_warnings) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_shopping_warnings';
  end if;
  if jsonb_array_length(p_warnings)>300 then
    raise exception using errcode='22023',message='invalid_shopping_warnings';
  end if;
  perform private.lock_and_check_shopping_list_safety(
    p_user_id,p_list_id,p_expected_fingerprint);
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  for v_warning in select value from jsonb_array_elements(p_warnings) loop
    if jsonb_typeof(v_warning) is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    if not (v_warning ?& array['warningKey','sourceMenuId','sourceDerivationGroupId',
      'sourceType','sourceId','sourcePath','sourceDisplayName','allergenId',
      'allergenDisplayName','anonymousMemberRef','memberDisplayName','dictionaryVersion','itemId'])
      or v_warning-array['warningKey','sourceMenuId','sourceDerivationGroupId',
        'sourceType','sourceId','sourcePath','sourceDisplayName','allergenId',
        'allergenDisplayName','anonymousMemberRef','memberDisplayName','dictionaryVersion','itemId']
          <> '{}'::jsonb then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    if nullif(v_warning->>'itemId','') is not null then
      select user_id into v_item_user from public.shopping_items
        where id=(v_warning->>'itemId')::uuid and list_id=p_list_id and user_id=p_user_id for share;
      if v_item_user is distinct from p_user_id then
        raise exception using errcode='22023',message='invalid_shopping_warnings';
      end if;
    end if;
    if not exists(select 1 from public.shopping_list_sources where user_id=p_user_id
      and list_id=p_list_id and menu_id=(v_warning->>'sourceMenuId')::uuid for share) then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    insert into public.shopping_current_label_warnings(user_id,list_id,item_id,
      warning_key,source_menu_id,source_derivation_group_id,source_type,source_id,
      source_path,source_display_name,allergen_id,allergen_display_name,
      anonymous_member_ref,member_display_name,dictionary_version)
    values(p_user_id,p_list_id,nullif(v_warning->>'itemId','')::uuid,
      v_warning->>'warningKey',
      (v_warning->>'sourceMenuId')::uuid,(v_warning->>'sourceDerivationGroupId')::uuid,
      v_warning->>'sourceType',(v_warning->>'sourceId')::uuid,v_warning->>'sourcePath',
      v_warning->>'sourceDisplayName',v_warning->>'allergenId',
      v_warning->>'allergenDisplayName',v_warning->>'anonymousMemberRef',
      v_warning->>'memberDisplayName',v_warning->>'dictionaryVersion');
  end loop;
  update public.shopping_lists set safety_fingerprint=p_expected_fingerprint,updated_at=now()
    where id=p_list_id and user_id=p_user_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId',item_id,'warningKey',warning_key,'sourceMenuId',source_menu_id,
      'sourceDerivationGroupId',source_derivation_group_id,'sourceType',source_type,
      'sourceId',source_id,'sourcePath',source_path,'sourceDisplayName',source_display_name,
      'allergenId',allergen_id,'allergenDisplayName',allergen_display_name,
      'anonymousMemberRef',anonymous_member_ref,'memberDisplayName',member_display_name,
      'dictionaryVersion',dictionary_version
    ) order by warning_key,item_id nulls first),'[]'::jsonb) into v_projection
    from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  return jsonb_build_object('listId',p_list_id,'safetyFingerprint',p_expected_fingerprint,
    'currentLabelWarnings',v_projection);
end;
$function$;

create or replace function private.write_shopping_items(
  p_user_id uuid,p_list_id uuid,p_items jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_item jsonb; v_source jsonb; v_label jsonb; v_item_id uuid;
begin
  if jsonb_typeof(p_items)<>'array' then
    raise exception using errcode='22023',message='invalid_shopping_items';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_id:=coalesce(nullif(v_item->>'existingItemId','')::uuid,gen_random_uuid());
    insert into public.shopping_items(id,user_id,list_id,display_name,normalized_name,store_section,
      quantity_value,quantity_text,unit,pantry_check_required)
    values(v_item_id,p_user_id,p_list_id,v_item->>'displayName',v_item->>'normalizedName',
      v_item->>'storeSection',nullif(v_item->>'quantityValue','')::numeric,
      v_item->>'quantityText',nullif(v_item->>'unit',''),(v_item->>'pantryCheckRequired')::boolean)
    on conflict(id) do update set
      display_name=excluded.display_name,normalized_name=excluded.normalized_name,
      store_section=excluded.store_section,quantity_value=excluded.quantity_value,
      quantity_text=excluded.quantity_text,unit=excluded.unit,
      pantry_check_required=excluded.pantry_check_required,updated_at=now()
    where public.shopping_items.user_id=p_user_id and public.shopping_items.list_id=p_list_id
      and not(public.shopping_items.is_checked or public.shopping_items.is_manual
        or public.shopping_items.is_manually_edited or public.shopping_items.is_removed_by_user);
    if not found then raise exception using errcode='P0001',message='protected_item_conflict'; end if;
    delete from public.shopping_item_sources where item_id=v_item_id and user_id=p_user_id;
    delete from public.shopping_label_confirmations where item_id=v_item_id and user_id=p_user_id;
    for v_source in select value from jsonb_array_elements(v_item->'sourceIngredients') loop
      insert into public.shopping_item_sources(user_id,item_id,dish_ingredient_id,
        source_ingredient_id_snapshot,source_dish_id_snapshot,source_dish_name,source_name,
        source_quantity_value,source_quantity_text,source_unit)
      values(p_user_id,v_item_id,(v_source->>'ingredientId')::uuid,
        (v_source->>'ingredientId')::uuid,(v_source->>'dishId')::uuid,
        v_source->>'dishName',v_source->>'name',nullif(v_source->>'quantityValue','')::numeric,
        v_source->>'quantityText',nullif(v_source->>'unit',''));
    end loop;
    for v_label in select value from jsonb_array_elements(v_item->'labelWarnings') loop
      insert into public.shopping_label_confirmations(user_id,list_id,item_id,
        menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
        source_menu_id_snapshot,
        source_derivation_group_id,source_type,source_id_snapshot,
        source_path,source_display_name,allergen_id,allergen_display_name,
        anonymous_member_ref,member_display_name,dictionary_version,confirmation_status)
      values(p_user_id,p_list_id,v_item_id,nullif(v_label->>'confirmationId','')::uuid,
        nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
        (v_label->>'sourceMenuId')::uuid,
        (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
        (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
        v_label->>'allergenId',v_label->>'allergenDisplayName',
        v_label->>'anonymousMemberRef',v_label->>'memberDisplayName',v_label->>'dictionaryVersion',
        'pending');
    end loop;
  end loop;
end;
$function$;

create or replace function public.apply_shopping_draft(
  p_user_id uuid,p_menu_id uuid,p_mode text,p_active_list_id uuid,
  p_expected_list_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_draft jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_hash text; v_saved private.shopping_mutations; v_active public.shopping_lists;
  v_list public.shopping_lists; v_menu public.menus; v_label jsonb; v_response jsonb;
  v_source_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_request_hash';
  end if;
  v_hash:=p_request_hash;
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_saved.request_hash<>v_hash then raise exception using errcode='22023',message='idempotency_payload_mismatch'; end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;
  if p_mode not in('new','append') or jsonb_typeof(p_draft->'items')<>'array'
    or jsonb_typeof(p_draft->'listLabelWarnings')<>'array' then
    raise exception using errcode='22023',message='invalid_shopping_draft';
  end if;
  perform private.lock_and_check_shopping_safety(p_user_id,p_menu_id,p_safety_fingerprint);
  select * into v_menu from public.menus where id=p_menu_id and user_id=p_user_id for share;
  select * into v_active from public.shopping_lists
    where user_id=p_user_id and status='active' for update;
  if p_mode='append' then
    if v_active.id is null or v_active.id is distinct from p_active_list_id
      or v_active.version is distinct from p_expected_list_version then
      raise exception using errcode='P0001',message='list_version_conflict';
    end if;
    update public.shopping_lists set version=version+1,safety_fingerprint=p_safety_fingerprint,
      updated_at=now() where id=v_active.id returning * into v_list;
  else
    if v_active.id is null then
      if p_active_list_id is not null or p_expected_list_version is not null then
        raise exception using errcode='P0001',message='list_version_conflict';
      end if;
    else
      if v_active.id is distinct from p_active_list_id
        or v_active.version is distinct from p_expected_list_version then
        raise exception using errcode='P0001',message='list_version_conflict';
      end if;
      update public.shopping_lists set status='archived',updated_at=now() where id=v_active.id;
    end if;
    insert into public.shopping_lists(user_id,safety_fingerprint)
      values(p_user_id,p_safety_fingerprint) returning * into v_list;
  end if;
  insert into public.shopping_list_sources(user_id,list_id,menu_id,source_menu_id_snapshot,
    source_menu_version,source_derivation_group_id)
  values(p_user_id,v_list.id,v_menu.id,v_menu.id,v_menu.version,v_menu.derivation_group_id)
  on conflict(list_id,source_menu_id_snapshot,source_menu_version) do nothing
  returning id into v_source_id;
  if v_source_id is null then
    raise exception using errcode='23505',message='menu_version_already_in_list';
  end if;
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=v_list.id;
  perform private.write_shopping_items(p_user_id,v_list.id,p_draft->'items');
  for v_label in select value from jsonb_array_elements(p_draft->'listLabelWarnings') loop
    insert into public.shopping_label_confirmations(user_id,list_id,item_id,
      menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
      source_menu_id_snapshot,
      source_derivation_group_id,source_type,source_id_snapshot,
      source_path,source_display_name,allergen_id,allergen_display_name,
      anonymous_member_ref,member_display_name,dictionary_version,confirmation_status)
    values(p_user_id,v_list.id,null,nullif(v_label->>'confirmationId','')::uuid,
      nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
      (v_label->>'sourceMenuId')::uuid,
      (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
      (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
      v_label->>'allergenId',v_label->>'allergenDisplayName',v_label->>'anonymousMemberRef',
      v_label->>'memberDisplayName',v_label->>'dictionaryVersion','pending');
  end loop;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,'replayed',false);
  insert into private.shopping_mutations values(p_user_id,p_idempotency_key,v_hash,v_response,now());
  return v_response;
end;
$function$;

create or replace function public.apply_shopping_reconciliation(
  p_user_id uuid,p_list_id uuid,p_expected_list_version integer,p_source_menu_id uuid,
  p_source_menu_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_resolved_diff jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_hash text; v_saved private.shopping_mutations; v_list public.shopping_lists;
  v_menu public.menus; v_id uuid; v_source_id uuid; v_label jsonb; v_response jsonb;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_request_hash';
  end if;
  v_hash:=p_request_hash;
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_saved.request_hash<>v_hash then raise exception using errcode='22023',message='idempotency_payload_mismatch'; end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;
  select * into v_list from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active' for update;
  if v_list.id is null or v_list.version<>p_expected_list_version then
    raise exception using errcode='P0001',message='list_version_conflict';
  end if;
  select * into v_menu from public.menus
    where id=p_source_menu_id and user_id=p_user_id and version=p_source_menu_version for share;
  if v_menu.id is null then raise exception using errcode='P0002',message='source_menu_version_conflict'; end if;
  perform private.lock_and_check_shopping_safety(p_user_id,p_source_menu_id,p_safety_fingerprint);
  insert into public.shopping_list_sources(user_id,list_id,menu_id,source_menu_id_snapshot,
    source_menu_version,source_derivation_group_id)
  values(p_user_id,p_list_id,v_menu.id,v_menu.id,v_menu.version,v_menu.derivation_group_id)
  on conflict(list_id,source_menu_id_snapshot,source_menu_version) do nothing
  returning id into v_source_id;
  if v_source_id is null then
    raise exception using errcode='23505',message='menu_version_already_in_list';
  end if;
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  for v_id in select (value #>> '{}')::uuid from jsonb_array_elements(p_resolved_diff->'removeIds') loop
    if exists(select 1 from public.shopping_items where id=v_id and user_id=p_user_id
      and (is_checked or is_manual or is_manually_edited or is_removed_by_user)) then
      raise exception using errcode='P0001',message='protected_item_conflict';
    end if;
    delete from public.shopping_items where id=v_id and user_id=p_user_id and list_id=p_list_id;
  end loop;
  perform private.write_shopping_items(p_user_id,p_list_id,p_resolved_diff->'replace');
  perform private.write_shopping_items(p_user_id,p_list_id,p_resolved_diff->'add');
  delete from public.shopping_label_confirmations
    where user_id=p_user_id and list_id=p_list_id and item_id is null
      and source_derivation_group_id=v_menu.derivation_group_id;
  for v_label in select value from jsonb_array_elements(p_resolved_diff->'listLabelWarnings') loop
    insert into public.shopping_label_confirmations(user_id,list_id,item_id,
      menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
      source_menu_id_snapshot,
      source_derivation_group_id,source_type,source_id_snapshot,source_path,source_display_name,
      allergen_id,allergen_display_name,anonymous_member_ref,member_display_name,
      dictionary_version,confirmation_status)
    values(p_user_id,p_list_id,null,nullif(v_label->>'confirmationId','')::uuid,
      nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
      (v_label->>'sourceMenuId')::uuid,
      (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
      (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
      v_label->>'allergenId',v_label->>'allergenDisplayName',v_label->>'anonymousMemberRef',
      v_label->>'memberDisplayName',v_label->>'dictionaryVersion','pending');
  end loop;
  update public.shopping_lists set version=version+1,safety_fingerprint=p_safety_fingerprint,
    updated_at=now() where id=p_list_id returning * into v_list;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,'replayed',false);
  insert into private.shopping_mutations values(p_user_id,p_idempotency_key,v_hash,v_response,now());
  return v_response;
end;
$function$;

revoke all on function public.shopping_safety_fingerprint(uuid,uuid) from public,anon,authenticated;
revoke all on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  from public,anon,authenticated;
create or replace function public.get_shopping_mutation_replay(
  p_user_id uuid,p_idempotency_key uuid,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_saved private.shopping_mutations;
begin
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if not found then return null; end if;
  if v_saved.request_hash<>p_request_hash then
    raise exception using errcode='22023',message='idempotency_payload_mismatch';
  end if;
  return v_saved.response||jsonb_build_object('replayed',true);
end;
$function$;

create or replace function public.mutate_shopping_item(
  p_list_id uuid,p_expected_list_version integer,p_expected_safety_fingerprint text,
  p_operation text,p_item_id uuid,
  p_idempotency_key uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_user_id uuid:=(select auth.uid());v_saved private.shopping_mutations;
  v_list public.shopping_lists;v_item public.shopping_items;v_item_id uuid;v_response jsonb;v_hash text;
begin
  if v_user_id is null then raise exception using errcode='42501',message='auth_required'; end if;
  perform private.cleanup_expired_shopping_mutations(v_user_id,100);
  delete from private.shopping_mutations where user_id=v_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  if jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023',message='invalid_item_mutation';
  end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('listId',p_list_id,
    'expectedListVersion',p_expected_list_version,
    'expectedSafetyFingerprint',p_expected_safety_fingerprint,'operation',p_operation,
    'itemId',p_item_id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
  select * into v_saved from private.shopping_mutations
    where user_id=v_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_saved.request_hash<>v_hash then
      raise exception using errcode='22023',message='idempotency_payload_mismatch';
    end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;
  perform private.lock_and_check_shopping_list_safety(
    v_user_id,p_list_id,p_expected_safety_fingerprint
  );
  select * into v_list from public.shopping_lists
    where id=p_list_id and user_id=v_user_id and status='active' for update;
  if v_list.id is null or v_list.version<>p_expected_list_version then
    raise exception using errcode='P0001',message='list_version_conflict';
  end if;
  if p_operation='add_manual' then
    if p_item_id is not null or not (p_payload ?& array[
      'displayName','normalizedName','storeSection','quantityText','pantryCheckRequired']) then
      raise exception using errcode='22023',message='invalid_item_mutation';
    end if;
    insert into public.shopping_items(user_id,list_id,display_name,normalized_name,store_section,
      quantity_value,quantity_text,unit,pantry_check_required,is_manual)
    values(v_user_id,p_list_id,p_payload->>'displayName',p_payload->>'normalizedName',
      p_payload->>'storeSection',nullif(p_payload->>'quantityValue','')::numeric,
      p_payload->>'quantityText',nullif(p_payload->>'unit',''),
      (p_payload->>'pantryCheckRequired')::boolean,true) returning id into v_item_id;
  else
    select * into v_item from public.shopping_items
      where id=p_item_id and list_id=p_list_id and user_id=v_user_id for update;
    if v_item.id is null then raise exception using errcode='P0002',message='shopping_item_not_found'; end if;
    v_item_id:=v_item.id;
    case p_operation
      when 'set_checked' then
        update public.shopping_items set is_checked=(p_payload->>'isChecked')::boolean,updated_at=now()
          where id=v_item.id and user_id=v_user_id;
      when 'edit' then
        update public.shopping_items set display_name=p_payload->>'displayName',
          normalized_name=p_payload->>'normalizedName',store_section=p_payload->>'storeSection',
          quantity_value=nullif(p_payload->>'quantityValue','')::numeric,
          quantity_text=p_payload->>'quantityText',unit=nullif(p_payload->>'unit',''),
          is_manually_edited=true,updated_at=now()
          where id=v_item.id and user_id=v_user_id;
      when 'remove' then
        if v_item.is_manual then
          delete from public.shopping_items where id=v_item.id and user_id=v_user_id;
        else
          update public.shopping_items set is_removed_by_user=true,is_manually_edited=true,
            updated_at=now() where id=v_item.id and user_id=v_user_id;
        end if;
      when 'mark_at_home' then
        if v_item.is_manual then
          delete from public.shopping_items where id=v_item.id and user_id=v_user_id;
        else
          update public.shopping_items set is_removed_by_user=true,is_manually_edited=true,
            updated_at=now() where id=v_item.id and user_id=v_user_id;
        end if;
      when 'undo' then
        if v_item.is_manual or not v_item.is_removed_by_user then
          raise exception using errcode='22023',message='invalid_item_mutation';
        end if;
        update public.shopping_items set is_removed_by_user=false,updated_at=now()
          where id=v_item.id and user_id=v_user_id;
      else raise exception using errcode='22023',message='invalid_item_mutation';
    end case;
  end if;
  update public.shopping_lists set version=version+1,updated_at=now()
    where id=p_list_id and user_id=v_user_id returning * into v_list;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,
    'itemId',v_item_id,'replayed',false);
  insert into private.shopping_mutations values(v_user_id,p_idempotency_key,v_hash,v_response,now());
  return v_response;
end;
$function$;

revoke all on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.get_shopping_mutation_replay(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)
  from public,anon;
grant execute on function public.shopping_safety_fingerprint(uuid,uuid) to service_role;
revoke all on function public.shopping_list_safety_fingerprint(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.shopping_list_safety_fingerprint(uuid,uuid) to service_role;
revoke all on function public.refresh_shopping_list_safety(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.refresh_shopping_list_safety(uuid,uuid,text,jsonb)
  to service_role;
grant execute on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  to service_role;
grant execute on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  to service_role;
grant execute on function public.get_shopping_mutation_replay(uuid,uuid,text) to service_role;
grant execute on function public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)
  to authenticated;
revoke all on function private.lock_and_check_shopping_safety(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function private.lock_and_check_shopping_list_safety(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function private.write_shopping_items(uuid,uuid,jsonb)
  from public,anon,authenticated;
revoke all on function private.cleanup_expired_shopping_mutations(uuid,integer)
  from public,anon,authenticated;

```

- [ ] **Step 5 (2–5 min): Apply, test, regenerate, and commit**

Run:

```bash
npm run db:push
npm run db:test -- supabase/tests/database/shopping_lists.test.sql
npm run db:types
npm run typecheck
```

Expected: 41 structure/grant/publication assertions plus behavioral, owner-composite-FK, monotonic-provenance, deletion-retention, removed/checked protected-delta, replay-before-version, request-hash, same-menu/new-key rejection, canonical pending item/list provenance, null historical-confirmation ID with non-null deterministic warning key, 500-character exact source text, latest-only current-warning replacement, immutable-provenance non-mutation, rollback, concurrent safety-race, bounded 30-day owner cleanup, and two-tab item-version assertions pass. The first two unique assertions prove exact keys `(dish_ingredients.id,user_id)` and `(menu_label_confirmations.id,user_id)` exist before dependent FKs are created; a clean `db:reset` therefore cannot fail with “no unique constraint matching given keys”. The list-fingerprint/refresh assertions prove the service-only active-list safety boundary, strict internal RPC result, and projection/provenance separation. Generated types expose the service-only RPCs plus the authenticated owner mutation RPC and no callable `private.apply_*` or unbounded cleanup RPC.

**Plan 6 retention handoff:** do not add a global purge in this migration. Plan 6 migration `supabase/migrations/20260711005100_maintenance_cleanup.sql` owns the maintenance-only `private.cleanup_shopping_mutations(p_before timestamptz,p_limit integer)`: both arguments are mandatory, `p_limit` is restricted to `1..250`, deletion is deterministic in `(created_at,user_id,idempotency_key)` order and never exceeds `p_limit`, and the scheduled caller supplies `p_before => now()-interval '30 days'`. Its database test seeds `p_limit+1` expired rows across owners, proves one call removes exactly `p_limit`, and proves the next call removes only the remainder; neither migration may contain an unbounded `delete from private.shopping_mutations`.

```bash
git add supabase/migrations/20260711004000_shopping_lists.sql supabase/tests/database/shopping_lists.test.sql src/shared/types/database.generated.ts
git commit -m "feat: add atomic shopping persistence"
```

### Task 3: Implement current-safety creation service, production adapter, and unified HTTP handler

**Files:**
- Create: `netlify/functions/_shared/shopping-adapter.ts`
- Create: `netlify/functions/_shared/shopping-service.ts`
- Create: `netlify/functions/_shared/shopping-service.test.ts`
- Create: `netlify/functions/shopping-list-from-menu.ts`
- Create: `netlify/functions/shopping-list-from-menu.test.ts`

**Interfaces:**
- Consumes: `createUserScopedSupabase`, `getSupabaseAdmin`, Plan 4's sole owner-scoped `loadStoredMenu`, `createRevalidationDeps`, `revalidateStoredMenu`, and its exact current human `CurrentMenuLabelWarning` projection, Plan 2 HTTP helpers, and Task 1 draft builder.
- Produces: `ShoppingDependencies`, `createShoppingDependencies(user)`, `createShoppingListFromMenu(deps,command)`, and `POST /api/shopping-lists/from-menu`.

- [ ] **Step 1 (2–5 min): Write failing service and handler tests**

Create tests that inject `ShoppingDependencies` and assert: a saved creation replay returns before `revalidate`, menu, pantry, fingerprint, active-list, or expected-version access; a same-key/different canonical command fails before those reads; replay miss then foreign/missing menu → 404; current validation with issues → `current_safety_revalidation_required`; database fingerprint is read only after validation; fingerprint change from apply RPC → 409 `safety_fingerprint_changed` with no response data; new/append pass exact active ID/version and the precomputed command hash; malformed JSON uses Plan 2 `invalid_json`; unauthenticated uses `auth_required`; method mismatch returns 405 and `Allow: POST`. Adapter tests prove `loadMenu` receives only the just-completed revalidation's `currentLabelWarnings`, performs no second/historical-confirmation query, and preserves each exact source path plus human source/allergen/member text. Add an allergy before list creation and assert the newly derived null-ID warning enters the new immutable shopping snapshot; remove an allergy before creation and assert its obsolete current warning does not enter that snapshot. A deleted target still uses the immutable human snapshot produced by Plan 4. The handler test imports `createShoppingListFromMenuHandler` and supplies a dependency factory—no module mock or undefined `createDeps` helper.

- [ ] **Step 2 (2–5 min): Run focused tests and verify RED**

Run: `npm test -- --run netlify/functions/_shared/shopping-service.test.ts netlify/functions/shopping-list-from-menu.test.ts`

Expected: FAIL because adapter, service, and handler modules do not exist.

- [ ] **Step 3 (2–5 min): Implement the complete creation/reconciliation dependency contract and adapter**

Create `netlify/functions/_shared/shopping-adapter.ts`:

```ts
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  CreateShoppingListResponse, ReconcileShoppingListResponse, ShoppingDraft,
  ShoppingLabelSnapshot, ShoppingList, ShoppingSourceIngredient,
} from "../../../shared/contracts/shopping";
import type { ResolvedShoppingDiff } from "../../../shared/shopping/diff";
import { reviewedShoppingAliases } from "../../../shared/shopping/reviewed-aliases";
import {
  createShoppingListResponseSchema,reconcileShoppingListResponseSchema,
  shoppingLabelSnapshotSchema,shoppingListSchema,shoppingSourceIngredientSchema,
} from "../../../shared/contracts/shopping";
import { HttpError } from "./http";
import { getSupabaseAdmin } from "./supabase-admin";
import { createUserScopedSupabase, type UserSupabaseClient } from "./supabase-user";
import { createRevalidationDeps } from "./revalidation-adapter";
import {
  revalidateStoredMenu,
  type CurrentMenuLabelWarning,
  type RevalidationResult,
} from "./revalidation-service";
import { loadStoredMenu } from "./stored-menu-loader";

export type ShoppingMenuAggregate = {
  menuId: string; version: number; derivationGroupId: string;
  ingredients: ShoppingSourceIngredient[]; labels: ShoppingLabelSnapshot[];
};
export type ShoppingPantryAmount = { name: string; quantity: number | null; unit: string | null };

export type ShoppingDependencies = {
  loadMenu(
    menuId: string,
    currentLabelWarnings: readonly CurrentMenuLabelWarning[],
  ): Promise<ShoppingMenuAggregate>;
  revalidate(menuId: string): Promise<RevalidationResult>;
  loadPantry(): Promise<ShoppingPantryAmount[]>;
  loadActiveList(listId?: string): Promise<ShoppingList | null>;
  getSafetyFingerprint(menuId: string): Promise<string>;
  applyDraft(input: {
    userId: string; menuId: string; mode: "new" | "append"; activeListId: string | null;
    expectedListVersion: number | null; safetyFingerprint: string;
    idempotencyKey: string; requestHash:string; draft: ShoppingDraft;
  }): Promise<CreateShoppingListResponse>;
  applyReconciliation(input: {
    userId: string; listId: string; expectedListVersion: number; sourceMenuId: string;
    sourceMenuVersion: number; safetyFingerprint: string; idempotencyKey: string;
    requestHash: string;
    resolvedDiff: ResolvedShoppingDiff;
  }): Promise<ReconcileShoppingListResponse>;
  findMutationReplay(input:{idempotencyKey:string;requestHash:string}):
    Promise<CreateShoppingListResponse|null>;
  aliases: ReadonlyMap<string,string>;
};

type AuthenticatedUser = { userId: string; accessToken: string };

export function createShoppingWarningKey(input:{sourceMenuId:string;sourceType:string;
  sourceId:string;sourcePath:string;allergenId:string;anonymousMemberRef:string;
  dictionaryVersion:string}):string{
  return createHash("sha256").update(JSON.stringify({version:"shopping-warning.v1",
    sourceMenuId:input.sourceMenuId,sourceType:input.sourceType,sourceId:input.sourceId,
    sourcePath:input.sourcePath,allergenId:input.allergenId,
    anonymousMemberRef:input.anonymousMemberRef,
    dictionaryVersion:input.dictionaryVersion}),"utf8").digest("hex");
}

function dbFailure(message: string): HttpError {
  return new HttpError(503,"shopping_unavailable",message);
}

function mapRpcError(error: { message: string }): never {
  const known: Record<string,[number,string,string]> = {
    safety_fingerprint_changed: [409,"safety_fingerprint_changed","家族設定が変わったため、もう一度確認してください"],
    list_version_conflict: [409,"list_version_conflict","買い物リストが更新されました。再読み込みしてください"],
    source_menu_version_conflict: [409,"source_menu_version_conflict","献立が更新されたため、差分を作り直してください"],
    protected_item_conflict: [409,"protected_item_conflict","購入済みまたは手動変更した項目があるため、差分を作り直してください"],
    idempotency_payload_mismatch: [409,"idempotency_payload_mismatch","前回と異なる内容で再送できません"],
    menu_version_already_in_list: [409,"menu_version_already_in_list","この献立はすでに今の買い物リストへ追加されています"],
    menu_not_found: [404,"menu_not_found","献立が見つかりません"],
  };
  const match=Object.entries(known).find(([code])=>error.message.includes(code));
  if(match!==undefined){const [status,code,message]=match[1];throw new HttpError(status,code,message);}
  throw dbFailure("買い物リストを更新できませんでした");
}

async function loadShoppingMenu(client:UserSupabaseClient,userId:string,menuId:string,
  currentLabelWarnings:readonly CurrentMenuLabelWarning[]):Promise<ShoppingMenuAggregate>{
  const stored=await loadStoredMenu(client,userId,menuId);
  const ingredients:ShoppingSourceIngredient[]=stored.menu.dishes.flatMap((dish)=>
    dish.ingredients.map((item)=>shoppingSourceIngredientSchema.parse({
      ingredientId:item.id,dishId:dish.id,dishName:dish.name,name:item.name,
      quantityValue:item.quantityValue,quantityText:item.quantityText,unit:item.unit,
      storeSection:item.storeSection,
    })),
  );
  const labels:ShoppingLabelSnapshot[]=currentLabelWarnings.map((item)=>
    shoppingLabelSnapshotSchema.parse({
      confirmationId:item.confirmationId,
      warningKey:createShoppingWarningKey({sourceMenuId:stored.menu.menuId,
        sourceType:item.sourceType,sourceId:item.sourceId,sourcePath:item.sourcePath,
        allergenId:item.allergenId,anonymousMemberRef:item.anonymousMemberRef,
        dictionaryVersion:item.dictionaryVersion}),
      sourceMenuId:stored.menu.menuId,
      sourceDerivationGroupId:stored.derivationGroupId,
      sourceType:item.sourceType,sourceId:item.sourceId,
      sourcePath:item.sourcePath,allergenId:item.allergenId,
      sourceDisplayName:item.sourceText,allergenDisplayName:item.allergenName,
      anonymousMemberRef:item.anonymousMemberRef,memberDisplayName:item.memberLabel,
      dictionaryVersion:item.dictionaryVersion,
      confirmationStatus:"pending",
    }));
  return {menuId:stored.menu.menuId,version:stored.version,
    derivationGroupId:stored.derivationGroupId,ingredients,labels};
}

async function loadActiveShoppingList(
  client:UserSupabaseClient,userId:string,listId?:string,
):Promise<ShoppingList|null>{
  let query=client.from("shopping_lists").select(`
    id,status,version,
    shopping_items(id,list_id,display_name,normalized_name,store_section,quantity_value,
      quantity_text,unit,pantry_check_required,is_checked,is_manual,is_manually_edited,
      is_removed_by_user,shopping_label_confirmations(*)),
    shopping_label_confirmations(*)
  `).eq("user_id",userId).eq("status","active");
  if(listId!==undefined)query=query.eq("id",listId);
  const {data,error}=await query.maybeSingle();
  if(error!==null)throw dbFailure("買い物リストを読み込めませんでした");
  if(data===null)return null;
  return shoppingListSchema.parse({
    id:data.id,status:data.status,version:data.version,
    items:data.shopping_items.map((item)=>({
      id:item.id,listId:item.list_id,displayName:item.display_name,
      normalizedName:item.normalized_name,storeSection:item.store_section,
      quantityValue:item.quantity_value,quantityText:item.quantity_text,unit:item.unit,
      pantryCheckRequired:item.pantry_check_required,isChecked:item.is_checked,
      isManual:item.is_manual,isManuallyEdited:item.is_manually_edited,
      isRemovedByUser:item.is_removed_by_user,
      labelWarnings:item.shopping_label_confirmations.filter((label)=>label.item_id!==null).map(toLabel),
    })),
    listLabelWarnings:data.shopping_label_confirmations.filter((label)=>label.item_id===null).map(toLabel),
  });
}
function toLabel(row:{
  menu_label_confirmation_id:string|null;source_warning_key:string;source_menu_id_snapshot:string;
  source_derivation_group_id:string;source_type:string;source_id_snapshot:string;
  source_path:string;source_display_name:string;allergen_id:string;allergen_display_name:string;
  anonymous_member_ref:string;member_display_name:string;
  dictionary_version:string;confirmation_status:string;
}):ShoppingLabelSnapshot{
  return shoppingLabelSnapshotSchema.parse({
    confirmationId:row.menu_label_confirmation_id,warningKey:row.source_warning_key,
    sourceMenuId:row.source_menu_id_snapshot,
    sourceDerivationGroupId:row.source_derivation_group_id,sourceType:row.source_type,
    sourceId:row.source_id_snapshot,sourcePath:row.source_path,
    sourceDisplayName:row.source_display_name,allergenId:row.allergen_id,
    allergenDisplayName:row.allergen_display_name,anonymousMemberRef:row.anonymous_member_ref,
    memberDisplayName:row.member_display_name,dictionaryVersion:row.dictionary_version,
    confirmationStatus:row.confirmation_status});
}

function parseRpcResponse<T>(data:unknown,schema:z.ZodType<T>):T{
  const parsed=schema.safeParse(data);
  if(!parsed.success)throw dbFailure("買い物リストの応答を確認できませんでした");
  return parsed.data;
}

export function createShoppingDependencies(user:AuthenticatedUser):ShoppingDependencies{
  const userClient=createUserScopedSupabase(user.accessToken);
  const admin=getSupabaseAdmin();
  return {
    loadMenu:(menuId,currentLabelWarnings)=>
      loadShoppingMenu(userClient,user.userId,menuId,currentLabelWarnings),
    revalidate:(menuId)=>revalidateStoredMenu(createRevalidationDeps(user),{
      userId:user.userId,menuId,
    }),
    async loadPantry(){
      const {data,error}=await userClient.from("pantry_items").select("name,quantity,unit")
        .eq("user_id",user.userId);
      if(error!==null)throw dbFailure("冷蔵庫の内容を読み込めませんでした");
      return data;
    },
    loadActiveList:(listId)=>loadActiveShoppingList(userClient,user.userId,listId),
    async getSafetyFingerprint(menuId){
      const {data,error}=await admin.rpc("shopping_safety_fingerprint",{
        p_user_id:user.userId,p_menu_id:menuId,
      });
      if(error!==null)mapRpcError(error);
      return data;
    },
    async applyDraft(input){
      const {data,error}=await admin.rpc("apply_shopping_draft",{
        p_user_id:input.userId,p_menu_id:input.menuId,p_mode:input.mode,
        p_active_list_id:input.activeListId,p_expected_list_version:input.expectedListVersion,
        p_safety_fingerprint:input.safetyFingerprint,p_idempotency_key:input.idempotencyKey,
        p_request_hash:input.requestHash,
        p_draft:input.draft,
      });
      if(error!==null)mapRpcError(error);
      return parseRpcResponse(data,createShoppingListResponseSchema);
    },
    async applyReconciliation(input){
      const {data,error}=await admin.rpc("apply_shopping_reconciliation",{
        p_user_id:input.userId,p_list_id:input.listId,
        p_expected_list_version:input.expectedListVersion,p_source_menu_id:input.sourceMenuId,
        p_source_menu_version:input.sourceMenuVersion,
        p_safety_fingerprint:input.safetyFingerprint,p_idempotency_key:input.idempotencyKey,
        p_request_hash:input.requestHash,
        p_resolved_diff:input.resolvedDiff,
      });
      if(error!==null)mapRpcError(error);
      return parseRpcResponse(data,reconcileShoppingListResponseSchema);
    },
    async findMutationReplay(input){
      const {data,error}=await admin.rpc("get_shopping_mutation_replay",{
        p_user_id:user.userId,p_idempotency_key:input.idempotencyKey,
        p_request_hash:input.requestHash,
      });
      if(error!==null)mapRpcError(error);
      return data===null?null:parseRpcResponse(data,createShoppingListResponseSchema);
    },
    aliases:reviewedShoppingAliases,
  };
}
```

Each generated RPC call uses its literal function name and exact parameter object; `parseRpcResponse` treats returned JSON as `unknown` and validates it with the exact response schema.

- [ ] **Step 4 (2–5 min): Implement creation service and the complete fetch handler**

Create `netlify/functions/_shared/shopping-service.ts`:

```ts
import { createHash } from "node:crypto";
import { HttpError } from "./http";
import type {
  CreateShoppingListRequest,CreateShoppingListResponse,ReconcileShoppingListRequest,
  ReconcileShoppingListResponse,ShoppingDiff,
} from "../../../shared/contracts/shopping";
import { buildShoppingDraft } from "../../../shared/shopping/aggregate";
import { computeShoppingDiff,resolveApprovedDiff } from "../../../shared/shopping/diff";
import type { ShoppingDependencies } from "./shopping-adapter";

type UserCommand={userId:string};

export function createReconciliationRequestHash(
  command:ReconcileShoppingListRequest&UserCommand&{listId:string},
):string{
  const canonical={listId:command.listId,expectedListVersion:command.expectedListVersion,
    sourceMenuId:command.sourceMenuId,sourceMenuVersion:command.sourceMenuVersion,
    approval:{addKeys:command.approval.addKeys.toSorted(),
      replaceItemIds:command.approval.replaceItemIds.toSorted(),
      removeItemIds:command.approval.removeItemIds.toSorted()}};
  return createHash("sha256").update(JSON.stringify(canonical),"utf8").digest("hex");
}

export function createShoppingCommandHash(command:CreateShoppingListRequest&UserCommand):string{
  const canonical={menuId:command.menuId,mode:command.mode,activeListId:command.activeListId,
    expectedListVersion:command.expectedListVersion};
  return createHash("sha256").update(JSON.stringify(canonical),"utf8").digest("hex");
}

async function validatedDraft(deps:ShoppingDependencies,menuId:string){
  const revalidation=await deps.revalidate(menuId);
  if(revalidation.status==="invalid"||revalidation.issues.length>0){
    throw new HttpError(409,"current_safety_revalidation_required",
      "現在の家族設定で献立を確認してから買い物リストを作ってください");
  }
  const fingerprintBefore=await deps.getSafetyFingerprint(menuId);
  const [menu,pantry]=await Promise.all([
    deps.loadMenu(menuId,revalidation.currentLabelWarnings),deps.loadPantry(),
  ]);
  const draft=buildShoppingDraft({
    menuId:menu.menuId,menuVersion:menu.version,ingredients:menu.ingredients,
    pantry,aliases:deps.aliases,labels:menu.labels,
  });
  const fingerprintAfter=await deps.getSafetyFingerprint(menuId);
  if(fingerprintBefore!==fingerprintAfter){
    throw new HttpError(409,"safety_fingerprint_changed",
      "家族設定が変わったため、もう一度確認してください");
  }
  return {menu,draft,safetyFingerprint:fingerprintAfter};
}

export async function createShoppingListFromMenu(
  deps:ShoppingDependencies,command:CreateShoppingListRequest&UserCommand,
):Promise<CreateShoppingListResponse>{
  const requestHash=createShoppingCommandHash(command);
  const replay=await deps.findMutationReplay({idempotencyKey:command.idempotencyKey,requestHash});
  if(replay!==null)return replay;
  const {draft,safetyFingerprint}=await validatedDraft(deps,command.menuId);
  return deps.applyDraft({...command,requestHash,safetyFingerprint,draft});
}

export async function previewShoppingListDiff(deps:ShoppingDependencies,command:{
  userId:string;listId:string;sourceMenuId:string;sourceMenuVersion:number;
  expectedListVersion:number;
}):Promise<ShoppingDiff>{
  const list=await deps.loadActiveList(command.listId);
  if(list===null)throw new HttpError(404,"shopping_list_not_found","買い物リストが見つかりません");
  if(list.version!==command.expectedListVersion)throw new HttpError(409,"list_version_conflict","買い物リストが更新されました");
  const {menu,draft}=await validatedDraft(deps,command.sourceMenuId);
  if(menu.version!==command.sourceMenuVersion)throw new HttpError(409,"source_menu_version_conflict","献立が更新されました");
  return computeShoppingDiff(list,draft);
}

export async function reconcileShoppingList(
  deps:ShoppingDependencies,
  command:ReconcileShoppingListRequest&UserCommand&{listId:string},
):Promise<ReconcileShoppingListResponse>{
  const requestHash=createReconciliationRequestHash(command);
  const replay=await deps.findMutationReplay({idempotencyKey:command.idempotencyKey,requestHash});
  if(replay!==null)return replay;
  const list=await deps.loadActiveList(command.listId);
  if(list===null)throw new HttpError(404,"shopping_list_not_found","買い物リストが見つかりません");
  if(list.version!==command.expectedListVersion){
    throw new HttpError(409,"list_version_conflict","買い物リストが更新されました");
  }
  const {menu,draft,safetyFingerprint}=await validatedDraft(deps,command.sourceMenuId);
  if(menu.version!==command.sourceMenuVersion){
    throw new HttpError(409,"source_menu_version_conflict","献立が更新されました");
  }
  const resolved=resolveApprovedDiff(computeShoppingDiff(list,draft),command.approval);
  return deps.applyReconciliation({...command,requestHash,safetyFingerprint,resolvedDiff:resolved});
}
```

Create `netlify/functions/shopping-list-from-menu.ts`:

```ts
import type { Config } from "@netlify/functions";
import { createShoppingListRequestSchema } from "../../shared/contracts/shopping";
import { requireUser } from "./_shared/auth";
import { handleError,json,methodNotAllowed,parseJson } from "./_shared/http";
import {
  createShoppingDependencies,type ShoppingDependencies,
} from "./_shared/shopping-adapter";
import { createShoppingListFromMenu } from "./_shared/shopping-service";

type Factory=(user:{userId:string;accessToken:string})=>ShoppingDependencies;

export function createShoppingListFromMenuHandler(factory:Factory){
  return async(request:Request):Promise<Response>=>{
    if(request.method!=="POST")return methodNotAllowed(["POST"]);
    try{
      const user=await requireUser(request);
      const body=await parseJson(request,createShoppingListRequestSchema);
      const result=await createShoppingListFromMenu(factory(user),{...body,userId:user.userId});
      return json(200,{ok:true,data:result});
    }catch(error){return handleError(error);}
  };
}
export default createShoppingListFromMenuHandler(createShoppingDependencies);
export const config:Config={path:"/api/shopping-lists/from-menu"};
```

- [ ] **Step 5 (2–5 min): Run creation tests/typecheck and commit**

Run:

```bash
npm test -- --run netlify/functions/_shared/shopping-service.test.ts netlify/functions/shopping-list-from-menu.test.ts
npm run typecheck
```

Expected: all auth, JSON, current-safety, fingerprint-before/after race, RPC lock race, new/append, canonical shopping-pending label snapshot, replay, and error mapping tests pass. Exact order is ledger lookup → on miss only current-context validation → fingerprint-before → owner menu/pantry load → fingerprint-after → locked RPC compare; replay hits perform none of the later reads, and the handler imports no undefined helper.

```bash
git add netlify/functions/_shared/shopping-adapter.ts netlify/functions/_shared/shopping-service.ts netlify/functions/_shared/shopping-service.test.ts netlify/functions/shopping-list-from-menu.ts netlify/functions/shopping-list-from-menu.test.ts
git commit -m "feat: create current-safe shopping lists"
```

### Task 4: Recompute server diff and atomically reconcile approved operations

**Files:**
- Modify: `netlify/functions/_shared/shopping-adapter.ts`
- Modify: `netlify/functions/_shared/shopping-service.ts`
- Create: `netlify/functions/shopping-list-preview.ts`
- Create: `netlify/functions/shopping-list-preview.test.ts`
- Create: `netlify/functions/shopping-list-revalidate.ts`
- Create: `netlify/functions/shopping-list-revalidate.test.ts`
- Create: `netlify/functions/shopping-list-reconcile.ts`
- Create: `netlify/functions/shopping-list-reconcile.test.ts`
- Modify: `netlify/functions/_shared/shopping-service.test.ts`

**Interfaces:**
- Consumes: `reconcileShoppingList` and production dependency factory from Task 3.
- Produces: `POST /api/shopping-lists/:listId/revalidate`, `POST /api/shopping-lists/:listId/preview`, and `POST /api/shopping-lists/:listId/reconcile`; `ShoppingDependencies.loadActiveListSources`, `getListSafetyFingerprint`, and `replaceCurrentSafetyProjection`; and the sole internal-RPC-parse → public-response-compose boundary. All use the same owner-scoped loader and canonical human fields. Approval carries keys/IDs only; resolved values never come from the browser.

- [ ] **Step 1 (2–5 min): Add failing approval, protected-row, version, and handler tests**

Add exact tests for: active list with all live/currently-valid sources returns a deterministic fingerprint; one deleted/null source returns `unverifiable` and no fingerprint; a current invalid source returns human issues and no fingerprint; owner/source enumeration failure stays closed; a safety change between source validation and fingerprint read returns no token; immutable provenance warning A remains byte-identical while current projection changes from A to B; invented add key; replace/remove ID absent from server diff; checked/manual/edited/removed rows absent from proposed operations; protected known-quantity delta; stale list version; stale source-menu version; safety change after validation; RPC `protected_item_conflict` defense; path UUID rejection; malformed JSON via `parseJson`; 405 via `methodNotAllowed`. The revalidation test supplies source menu IDs in reverse order with a duplicate and makes `replaceCurrentSafetyProjection` return the exact strict internal object `{listId,safetyFingerprint,currentLabelWarnings}`. It expects the public result exactly equal to `{status:"valid",safetyFingerprint,checkedSourceMenuIds:[menuA,menuB],currentLabelWarnings:[warningB],issues:[]}` with sorted unique IDs. Missing/foreign `listId`, a changed fingerprint, a missing key, an extra key, 301 warnings, or a malformed warning in the internal RPC result must fail closed and never be wrapped as HTTP success. Include this response-loss regression in `shopping-service.test.ts`:

```ts
it("returns a saved reconciliation before stale-version or current-state reads",async()=>{
  const saved={listId:crypto.randomUUID(),version:4,replayed:true};
  const deps=makeShoppingDependencies({
    findMutationReplay:vi.fn().mockResolvedValue(saved),
    loadActiveList:vi.fn(()=>{throw new Error("must not load after replay");}),
    revalidate:vi.fn(()=>{throw new Error("must not revalidate after replay");}),
  });
  await expect(reconcileShoppingList(deps,reconcileCommand)).resolves.toEqual(saved);
  expect(deps.loadActiveList).not.toHaveBeenCalled();
  expect(deps.revalidate).not.toHaveBeenCalled();
});
```

The DB test calls `apply_shopping_reconciliation`, records version `4`, then calls `get_shopping_mutation_replay` with the same key/hash while still supplying the old expected version `3`; it must return the saved response. A changed approval with the same key must raise `idempotency_payload_mismatch` before any version error.

- [ ] **Step 2 (2–5 min): Run and verify RED**

Run: `npm test -- --run shared/shopping/diff.test.ts netlify/functions/_shared/shopping-service.test.ts netlify/functions/shopping-list-revalidate.test.ts netlify/functions/shopping-list-preview.test.ts netlify/functions/shopping-list-reconcile.test.ts`

Expected: handler tests fail because the revalidation/reconcile Functions do not exist.

- [ ] **Step 3 (2–5 min): Implement the complete reconcile handler**

Create `shopping-list-preview.ts` with the same injected factory pattern:

```ts
import type { Config,Context } from "@netlify/functions";
import { z } from "zod";
import { previewShoppingDiffRequestSchema } from "../../shared/contracts/shopping";
import { requireUser } from "./_shared/auth";
import { handleError,HttpError,json,methodNotAllowed,parseJson } from "./_shared/http";
import {
  createShoppingDependencies,type ShoppingDependencies,
} from "./_shared/shopping-adapter";
import { previewShoppingListDiff } from "./_shared/shopping-service";

const listIdSchema=z.string().uuid();
type Factory=(user:{userId:string;accessToken:string})=>ShoppingDependencies;

export function createShoppingListPreviewHandler(factory:Factory){return async(
  request:Request,context:Context):Promise<Response>=>{
  if(request.method!=="POST")return methodNotAllowed(["POST"]);
  try{const user=await requireUser(request);const parsedId=listIdSchema.safeParse(context.params.listId);
    if(!parsedId.success)throw new HttpError(400,"invalid_list_id","買い物リストを確認できませんでした");
    const body=await parseJson(request,previewShoppingDiffRequestSchema);
    const diff=await previewShoppingListDiff(factory(user),{
      ...body,listId:parsedId.data,userId:user.userId,
    });
    return json(200,{ok:true,data:diff});
  }catch(error){return handleError(error);}
};}
export default createShoppingListPreviewHandler(createShoppingDependencies);
export const config:Config={path:"/api/shopping-lists/:listId/preview"};
```

The preview test supplies a menu whose processed ingredient is “カレールー”, allergen display is “小麦”, and member display is “子ども”; it asserts those three strings are returned from the owner-scoped server snapshot. It also asserts the UI never renders `sourcePath`, raw allergen ID, anonymous ref, or member UUID as a human label.

Create `netlify/functions/shopping-list-revalidate.ts` with the same authenticated/context-param factory pattern and exact `config.path` `/api/shopping-lists/:listId/revalidate`. `revalidateActiveShoppingList(deps,{userId,listId})` owner-loads the active list, every `shopping_list_sources` row, and its exact `shopping_item_sources` mapping. It returns `shoppingListSafetyDataSchema.parse(...)` with `unverifiable`, a null fingerprint, no current warnings, and sorted unique IDs of only the sources actually checked when any menu-derived source has a null/missing live menu. Otherwise it runs Plan 4's `revalidateStoredMenu` once for every distinct source against current safety; only `valid` or `changed` with zero issues may continue. For each response, convert every `currentLabelWarning` to the explicit `CurrentShoppingLabelWarning` current shape—there is no `confirmationId` or `confirmationStatus`—using the live source menu/version/group, canonical `warningKey`, bounded human fields, and typed source refs. Map `itemId` only when an exact `(sourceMenuId,sourceType,sourceId,sourcePath)` item source exists; otherwise keep it as a list-level warning. Never fall back to name-only matching. Deduplicate and sort by `(warningKey,itemId)`.

Extend `ShoppingDependencies` and its production adapter with these exact methods: `loadActiveListSources(listId): Promise<ActiveShoppingSource[]>`, `getListSafetyFingerprint(listId): Promise<string|null>`, and `replaceCurrentSafetyProjection(input:{userId:string;listId:string;expectedFingerprint:string;warnings:readonly CurrentShoppingLabelWarning[]}):Promise<RefreshShoppingListSafetyRpcResponse>`. The last method calls service-only `refresh_shopping_list_safety`, treats `data` as `unknown`, and parses only `refreshShoppingListSafetyRpcResponseSchema`; it never parses the internal RPC object as the public HTTP union. The RPC locks list/source/current-safety state, rechecks the fingerprint, and atomically replaces only `shopping_current_label_warnings` without incrementing user-edit version or touching `shopping_label_confirmations`.

```ts
export type ActiveShoppingSource={
  menuId:string|null;
  sourceMenuIdSnapshot:string;
  sourceMenuVersion:number;
  sourceDerivationGroupId:string;
  itemSources:readonly {itemId:string;sourceIngredientIdSnapshot:string}[];
};
```

The adapter parses every field as UUID/positive version before returning this type. Only an ingredient warning whose live menu leaf has the same `sourceId` and `sourcePath`, and whose `sourceId` equals one exact `sourceIngredientIdSnapshot`, receives that row's `itemId`; every other warning remains list-level.

After every source succeeds, compute `checkedSourceMenuIds` as sorted unique live IDs and read `shopping_list_safety_fingerprint(userId,listId)`. Pass the fingerprint and closed projection to `replaceCurrentSafetyProjection`, require returned `listId` and fingerprint to equal the request, then construct and parse the public result explicitly:

```ts
const checkedSourceMenuIds=[...new Set(liveSources.map((source)=>source.menuId))].sort();
const persisted=await deps.replaceCurrentSafetyProjection({userId:command.userId,
  listId:command.listId,expectedFingerprint:fingerprint,warnings:currentLabelWarnings});
if(persisted.listId!==command.listId||persisted.safetyFingerprint!==fingerprint){
  throw new HttpError(503,"safety_check_failed","現在の家族設定を確認できませんでした");
}
return shoppingListSafetyDataSchema.parse({status:"valid",
  safetyFingerprint:persisted.safetyFingerprint,checkedSourceMenuIds,
  currentLabelWarnings:persisted.currentLabelWarnings,issues:[]});
```

A source deletion or fingerprint race rolls back latest-projection replacement and returns a separately public-schema-parsed `safety_check_failed` result with no current projection. Tests create immutable warning A with the list, then add allergy B and remove A. Successful revalidation returns/persists B as the only current warning while the immutable A row remains unchanged. Deleting the source menu cascades B from `shopping_current_label_warnings`; the next unverifiable load renders immutable A—not B—in the read-only provenance section and disables every action. Deleted-member display names come only from A's immutable snapshot. A source/fingerprint race, missing source before refresh, invalid menu, foreign item mapping, duplicate warning key, 501-character source text, or malformed strict internal RPC object rolls back/fails closed and returns no current warnings. Raw source rows, member IDs, and internal RPC shapes never leave the Function.

```ts
export const config:Config={path:"/api/shopping-lists/:listId/revalidate",method:"POST"};
```

Extend `mutate_shopping_item` with `p_expected_safety_fingerprint text`. Before replay-miss item/list state changes, it calls `private.lock_and_check_shopping_list_safety(userId,listId,expected)` and fails `shopping_safety_fingerprint_changed` if the source set is missing/changed or current safety no longer matches. Same-key replay is still read before stale version/fingerprint checks; a new mutation can never use a fingerprint from before a household change. pgTAP proves a second session changing an allergy after browser revalidation either commits first and rejects the item mutation or blocks until the mutation commits—never both under one stale fingerprint.

Create `netlify/functions/shopping-list-reconcile.ts`:

```ts
import type { Config,Context } from "@netlify/functions";
import { z } from "zod";
import { reconcileShoppingListRequestSchema } from "../../shared/contracts/shopping";
import { requireUser } from "./_shared/auth";
import { handleError,HttpError,json,methodNotAllowed,parseJson } from "./_shared/http";
import {
  createShoppingDependencies,type ShoppingDependencies,
} from "./_shared/shopping-adapter";
import { reconcileShoppingList } from "./_shared/shopping-service";

const listIdSchema=z.string().uuid();
type Factory=(user:{userId:string;accessToken:string})=>ShoppingDependencies;

export function createShoppingListReconcileHandler(factory:Factory){
  return async(request:Request,context:Context):Promise<Response>=>{
    if(request.method!=="POST")return methodNotAllowed(["POST"]);
    try{
      const user=await requireUser(request);
      const listId=listIdSchema.safeParse(context.params.listId);
      if(!listId.success){
        throw new HttpError(400,"invalid_list_id","買い物リストを確認できませんでした");
      }
      const body=await parseJson(request,reconcileShoppingListRequestSchema);
      const result=await reconcileShoppingList(factory(user),{
        ...body,listId:listId.data,userId:user.userId,
      });
      return json(200,{ok:true,data:result});
    }catch(error){return handleError(error);}
  };
}
export default createShoppingListReconcileHandler(createShoppingDependencies);
export const config:Config={path:"/api/shopping-lists/:listId/reconcile"};
```

- [ ] **Step 4 (2–5 min): Run service, handler, and DB defense tests**

Run:

```bash
npm test -- --run shared/shopping/diff.test.ts netlify/functions/_shared/shopping-service.test.ts netlify/functions/shopping-list-revalidate.test.ts netlify/functions/shopping-list-preview.test.ts netlify/functions/shopping-list-reconcile.test.ts
npm run db:test -- supabase/tests/database/shopping_lists.test.sql
npm run typecheck
```

Expected: source-set revalidation, immutable-provenance/current-projection separation, strict internal RPC parsing, sorted checked-source composition, final public-schema parsing, deleted-source fail-closed behavior, list-safety fingerprint race, approval subset, protected state, current-safety race, version conflict, replay, and rollback tests pass. Inspect handler imports: every imported symbol was produced in Plans 2–4 or Tasks 1–3.

- [ ] **Step 5 (2–5 min): Commit reconciliation**

```bash
git add netlify/functions/_shared/shopping-service.ts netlify/functions/_shared/shopping-service.test.ts \
  netlify/functions/_shared/shopping-adapter.ts \
  netlify/functions/shopping-list-revalidate.ts netlify/functions/shopping-list-revalidate.test.ts \
  netlify/functions/shopping-list-preview.ts netlify/functions/shopping-list-preview.test.ts \
  netlify/functions/shopping-list-reconcile.ts netlify/functions/shopping-list-reconcile.test.ts
git commit -m "feat: reconcile shopping lists atomically"
```

### Task 5: Build typed browser CRUD, preview-only diff, and mobile shopping UI

**Files:**
- Create: `src/features/shopping/api/shopping-api.ts`
- Create: `src/features/shopping/hooks/use-shopping-list.ts`
- Create: `src/features/shopping/components/create-list-sheet.tsx`
- Create: `src/features/shopping/components/reconcile-list-sheet.tsx`
- Create: `src/features/shopping/components/shopping-item-row.tsx`
- Create: `src/features/shopping/pages/shopping-list-page.tsx`
- Create: `src/features/shopping/pages/shopping-list-page.test.tsx`
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: exact Task 1 schemas, Plan 1 browser Supabase/access-token helpers plus canonical `householdSafetyChangedEvent`, `householdSafetyRevisionStorageKey`, `householdSafetyQueryPrefixes.shopping = ["shopping"]`, and Plan 3 `getMenuResult(menuId)`.
- Produces: `shoppingKeys.active = ["shopping","active"]`, `useShoppingSafetyGate`, owner-filtered household Realtime subscription with focus/visibility/online/60-second fallback, `fetchActiveShoppingList`, `revalidateActiveShoppingList`, `createShoppingList`, `previewShoppingDiff`, `reconcileShoppingListRequest`, `mutateShoppingItem`, exact component Props, `/shopping`, and result actions. Browser preview is display-only; the server always recomputes it, stored provenance is never promoted to current authority, and item writes use no direct table mutation.

- [ ] **Step 1 (2–5 min): Write failing component/API tests with explicit Props**

Create tests that render each exported component using its exported Props type and assert: initial mount is blocked until active-list server revalidation succeeds; every invalidation source listed in the Global Constraints refetches the list and all sources but a list refetch alone never returns the gate to ready; invalid/deleted-source/error results stay closed; active-list new/append choice includes exact ID/version; reconcile lists every human item name, previous/new quantity, dish source, pantry check, and item warning; deselecting one add/replace/remove checkbox omits only that operation from approval; six groups include `seasonings` → “調味料”; checked/manual/edited/removed rows remain after a preview; protected known quantities produce only a delta; every manual/check/edit/remove/at-home/undo action calls `mutateShoppingItem` with the rendered list version, the latest server list-safety fingerprint, and a new idempotency key; a DB fingerprint conflict closes and reruns the gate; immutable label snapshots render the human source/allergen/member names after `confirmationId:null`; create/reconcile/item version conflicts reload the active query; all controls have a CSS min height of 44px. Include these exact interaction assertions in `shopping-list-page.test.tsx` using a locally defined `renderPage` wrapper and mocked API module.

Add a deferred-promise safety test first: dispatch Plan 1's exact custom event, assert every check/edit/create/reconcile control becomes disabled in the same tick, assert exact `shoppingKeys.active` invalidation/refetch, resolve only the active-list reload, and prove controls are still disabled. Resolve the server's all-source revalidation with a valid list fingerprint, then assert controls re-enable and the next item RPC carries that fingerprint. Repeat with a `StorageEvent` whose key is `householdSafetyRevisionStorageKey`; an unrelated storage key does nothing. Rejected, invalid, or deleted-source results leave the gate closed with the returned human message.

Use fake timers and a mocked Supabase channel for cross-device coverage. Independently fire `focus`, visible `visibilitychange`, `online`, an owner-filtered `household_members` Realtime payload, and an owner-filtered `member_allergies` payload; each must move the gate to checking synchronously and start a fresh all-source revalidation. A payload for another owner never reaches the registered filter callback. `offline`, `CHANNEL_ERROR`, and `TIMED_OUT` disable controls immediately. `SUBSCRIBED` performs a fresh check. At 59,999 ms no poll runs; at 60,000 ms a visible-online poll disables and revalidates, while hidden/offline intervals do not call the server and rely on their foreground/online event before interaction. Unmount removes every DOM listener, clears the interval, and removes the Supabase channel. Finally simulate a household mutation arriving only from the database—no custom event and no `StorageEvent`—and prove controls close before the deferred revalidation resolves; if all client signals are suppressed, an item RPC with the old fingerprint still returns `shopping_safety_fingerprint_changed`, closes the gate, and performs no write.

Keep these ordinary mutation assertions:

```tsx
it("edits quantity, marks an item at home, and explicitly undoes it",async()=>{
  renderPage(makeShoppingList([makeItem({displayName:"にんじん",quantityValue:1,unit:"本"})]));
  await user.click(screen.getByRole("button",{name:"数量・単位・売り場を編集"}));
  await user.clear(screen.getByLabelText("にんじんの数量"));await user.type(screen.getByLabelText("にんじんの数量"),"3");
  await user.clear(screen.getByLabelText("にんじんの分量表記"));
  await user.type(screen.getByLabelText("にんじんの分量表記"),"3袋");
  await user.clear(screen.getByLabelText("にんじんの単位"));await user.type(screen.getByLabelText("にんじんの単位"),"袋");
  await user.selectOptions(screen.getByLabelText("にんじんの売り場"),"other");
  await user.click(screen.getByRole("button",{name:"変更を保存"}));
  expect(mutateShoppingItem).toHaveBeenCalledWith(expect.objectContaining({operation:"edit",
    expectedListVersion:1,expectedSafetyFingerprint:expect.stringMatching(/^[a-f0-9]{64}$/u),
    payload:expect.objectContaining({quantityValue:3,quantityText:"3袋",unit:"袋",storeSection:"other"})}));
  await user.click(screen.getByRole("button",{name:"家にある"}));
  expect(mutateShoppingItem).toHaveBeenCalledWith(expect.objectContaining({operation:"mark_at_home"}));
  rerenderRemovedPage();
  await user.click(screen.getByRole("button",{name:"元に戻す"}));
  expect(mutateShoppingItem).toHaveBeenCalledWith(expect.objectContaining({operation:"undo"}));
});

it("reloads after another tab advances the expected list version",async()=>{
  mutateShoppingItem.mockRejectedValueOnce(Object.assign(new Error("stale"),{code:"list_version_conflict"}));
  renderPage(makeShoppingList([makeItem()]));
  await user.click(screen.getByRole("checkbox",{name:/購入済みにする/u}));
  await waitFor(()=>expect(fetchActiveShoppingList).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("alert")).toHaveTextContent("別の画面で更新されました");
});
```

- [ ] **Step 2 (2–5 min): Run UI tests and verify RED**

Run: `npm test -- --run src/features/shopping`

Expected: FAIL because the shopping API/hooks/components do not exist.

- [ ] **Step 3 (2–5 min): Implement complete browser API and display-only preview**

Create `src/features/shopping/api/shopping-api.ts`:

```ts
import { z } from "zod";
import {
  createShoppingListResponseSchema,previewShoppingDiffResponseSchema,
  reconcileShoppingListResponseSchema,shoppingItemMutationRequestSchema,
  shoppingItemMutationResponseSchema,shoppingListSafetyDataSchema,shoppingListSchema,
  type CreateShoppingListRequest,type CreateShoppingListResponse,type ReconcileShoppingListRequest,
  type ReconcileShoppingListResponse,type ShoppingDiff,type ShoppingItemMutationRequest,
  type ShoppingItemMutationResponse,type ShoppingList,
  type ShoppingListSafetyData,
} from "../../../../shared/contracts/shopping";
import { requireAccessToken } from "../../../features/auth/session";
import { getBrowserSupabaseClient } from "../../../shared/lib/supabase";

const failureSchema=z.object({ok:z.literal(false),error:z.object({
  code:z.string(),message:z.string(),details:z.record(z.string(),z.unknown()).optional(),
})});
function envelopeSchema<T>(data:z.ZodType<T>){
  return z.discriminatedUnion("ok",[z.object({ok:z.literal(true),data}),failureSchema]);
}
async function post<T>(path:string,body:unknown,schema:z.ZodType<T>):Promise<T>{
  const client=getBrowserSupabaseClient();
  const token=await requireAccessToken(client);
  const response=await fetch(path,{method:"POST",headers:{
    authorization:`Bearer ${token}`,"content-type":"application/json",
  },body:JSON.stringify(body)});
  const parsed=envelopeSchema(schema).safeParse(await response.json());
  if(!parsed.success)throw new Error("買い物リストの応答を確認できませんでした");
  if(!parsed.data.ok)throw Object.assign(new Error(parsed.data.error.message),{
    code:parsed.data.error.code,
  });
  return parsed.data.data;
}

const rowLabel=(row:{
  menu_label_confirmation_id:string|null;source_warning_key:string;source_menu_id_snapshot:string;
  source_derivation_group_id:string;source_type:string;source_id_snapshot:string;
  source_path:string;source_display_name:string;allergen_id:string;allergen_display_name:string;
  anonymous_member_ref:string;member_display_name:string;
  dictionary_version:string;confirmation_status:string;
})=>({
  confirmationId:row.menu_label_confirmation_id,warningKey:row.source_warning_key,
  sourceMenuId:row.source_menu_id_snapshot,
  sourceDerivationGroupId:row.source_derivation_group_id,sourceType:row.source_type,
  sourceId:row.source_id_snapshot,sourcePath:row.source_path,
  sourceDisplayName:row.source_display_name,allergenId:row.allergen_id,
  allergenDisplayName:row.allergen_display_name,anonymousMemberRef:row.anonymous_member_ref,
  memberDisplayName:row.member_display_name,dictionaryVersion:row.dictionary_version,
  confirmationStatus:row.confirmation_status,
});

export async function fetchActiveShoppingList():Promise<ShoppingList|null>{
  const client=getBrowserSupabaseClient();
  const {data,error}=await client.from("shopping_lists").select(`
    id,status,version,
    shopping_items(id,list_id,display_name,normalized_name,store_section,quantity_value,
      quantity_text,unit,pantry_check_required,is_checked,is_manual,is_manually_edited,
      is_removed_by_user,shopping_label_confirmations(*)),
    shopping_label_confirmations(*)
  `).eq("status","active").maybeSingle();
  if(error!==null)throw new Error("買い物リストを読み込めませんでした");
  if(data===null)return null;
  return shoppingListSchema.parse({
    id:data.id,status:data.status,version:data.version,
    items:data.shopping_items.map((item)=>({
      id:item.id,listId:item.list_id,displayName:item.display_name,
      normalizedName:item.normalized_name,storeSection:item.store_section,
      quantityValue:item.quantity_value,quantityText:item.quantity_text,unit:item.unit,
      pantryCheckRequired:item.pantry_check_required,isChecked:item.is_checked,
      isManual:item.is_manual,isManuallyEdited:item.is_manually_edited,
      isRemovedByUser:item.is_removed_by_user,
      labelWarnings:item.shopping_label_confirmations.filter((label)=>label.item_id!==null).map(rowLabel),
    })),
    listLabelWarnings:data.shopping_label_confirmations.filter((label)=>label.item_id===null).map(rowLabel),
  });
}

export const createShoppingList=(input:CreateShoppingListRequest):Promise<CreateShoppingListResponse>=>
  post("/api/shopping-lists/from-menu",input,createShoppingListResponseSchema);
export const reconcileShoppingListRequest=(
  listId:string,input:ReconcileShoppingListRequest,
):Promise<ReconcileShoppingListResponse>=>
  post(`/api/shopping-lists/${listId}/reconcile`,input,reconcileShoppingListResponseSchema);

export const previewShoppingDiff=(menuId:string,menuVersion:number,list:ShoppingList):Promise<ShoppingDiff>=>
  post(`/api/shopping-lists/${list.id}/preview`,{
    sourceMenuId:menuId,sourceMenuVersion:menuVersion,expectedListVersion:list.version,
  },previewShoppingDiffResponseSchema);

export const revalidateActiveShoppingList=(listId:string):Promise<ShoppingListSafetyData>=>
  post(`/api/shopping-lists/${listId}/revalidate`,{},shoppingListSafetyDataSchema);

export async function mutateShoppingItem(
  input:ShoppingItemMutationRequest,
):Promise<ShoppingItemMutationResponse>{
  const parsed=shoppingItemMutationRequestSchema.parse(input);
  const {data,error}=await getBrowserSupabaseClient().rpc("mutate_shopping_item",{
    p_list_id:parsed.listId,p_expected_list_version:parsed.expectedListVersion,
    p_expected_safety_fingerprint:parsed.expectedSafetyFingerprint,
    p_operation:parsed.operation,p_item_id:parsed.itemId,
    p_idempotency_key:parsed.idempotencyKey,p_payload:parsed.payload,
  });
  if(error!==null){
    if(error.message.includes("list_version_conflict")){
      throw Object.assign(new Error("買い物リストが更新されました"),{code:"list_version_conflict"});
    }
    if(error.message.includes("idempotency_payload_mismatch")){
      throw Object.assign(new Error("前回と異なる内容で再送できません"),{
        code:"idempotency_payload_mismatch"});
    }
    if(error.message.includes("shopping_safety_fingerprint_changed")){
      throw Object.assign(new Error("家族設定が変わりました"),{
        code:"shopping_safety_fingerprint_changed"});
    }
    throw new Error("買い物項目を更新できませんでした");
  }
  return shoppingItemMutationResponseSchema.parse(data);
}
```

- [ ] **Step 4 (2–5 min): Implement hooks and all component-local helpers/Props**

Create `src/features/shopping/hooks/use-shopping-list.ts`:

```ts
import {useCallback,useEffect,useRef,useState} from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import type {
  CreateShoppingListRequest,CurrentShoppingLabelWarning,ReconcileShoppingListRequest,
} from "../../../../shared/contracts/shopping";
import {
  householdSafetyChangedEvent,householdSafetyQueryPrefixes,
  householdSafetyRevisionStorageKey,
} from "../../household/household-queries";
import {
  createShoppingList,fetchActiveShoppingList,reconcileShoppingListRequest,
  revalidateActiveShoppingList,
} from "../api/shopping-api";
import {getBrowserSupabaseClient} from "../../../shared/lib/supabase";
export const shoppingKeys={
  active:[...householdSafetyQueryPrefixes.shopping,"active"] as const,
};
export const useShoppingList=()=>useQuery({queryKey:shoppingKeys.active,queryFn:fetchActiveShoppingList});
export function useShoppingSafetyGate(){
  const cache=useQueryClient();const epoch=useRef(0);
  const [state,setState]=useState<
    |{phase:"checking"}
    |{phase:"ready";safetyFingerprint:string|null;
      currentLabelWarnings:readonly CurrentShoppingLabelWarning[]}
    |{phase:"blocked";message:string}
  >({phase:"checking"});
  const refresh=useCallback(async()=>{
    const current=++epoch.current;setState({phase:"checking"});
    try{
      await cache.invalidateQueries({queryKey:shoppingKeys.active,exact:true});
      const list=await cache.fetchQuery({queryKey:shoppingKeys.active,
        queryFn:fetchActiveShoppingList,staleTime:0});
      if(list===null){
        if(epoch.current===current)setState({phase:"ready",safetyFingerprint:null,
          currentLabelWarnings:[]});
        return;
      }
      const checked=await revalidateActiveShoppingList(list.id);
      if(epoch.current!==current)return;
      if(checked.status==="valid")setState({phase:"ready",
        safetyFingerprint:checked.safetyFingerprint,
        currentLabelWarnings:checked.currentLabelWarnings});
      else setState({phase:"blocked",message:checked.issues.map((issue)=>issue.message).join("。")});
    }catch{if(epoch.current===current)setState({phase:"blocked",
      message:"現在の家族設定を確認できませんでした"});}
  },[cache]);
  useEffect(()=>{
    const changed=()=>{void refresh();};
    const stored=(event:StorageEvent)=>{
      if(event.key===householdSafetyRevisionStorageKey)void refresh();
    };
    const visible=()=>{if(document.visibilityState==="visible")void refresh();};
    const offline=()=>{epoch.current+=1;setState({phase:"blocked",
      message:"ネット接続後に現在の家族設定を確認してください"});};
    window.addEventListener(householdSafetyChangedEvent,changed);
    window.addEventListener("storage",stored);
    window.addEventListener("focus",changed);window.addEventListener("online",changed);
    window.addEventListener("offline",offline);
    document.addEventListener("visibilitychange",visible);
    const poll=window.setInterval(()=>{
      if(document.visibilityState==="visible"&&navigator.onLine)void refresh();
    },60_000);
    const client=getBrowserSupabaseClient();let closed=false;
    let channel:ReturnType<typeof client.channel>|null=null;
    void client.auth.getUser().then(({data,error})=>{
      if(closed)return;
      if(error!==null||data.user===null){offline();return;}
      const filter=`user_id=eq.${data.user.id}`;
      channel=client.channel(`shopping-safety:${data.user.id}`)
        .on("postgres_changes",{event:"*",schema:"public",table:"household_members",filter},changed)
        .on("postgres_changes",{event:"*",schema:"public",table:"member_allergies",filter},changed)
        .subscribe((status)=>{
          if(status==="SUBSCRIBED")void refresh();
          if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){
            epoch.current+=1;setState({phase:"blocked",
              message:"現在の家族設定の更新を確認できませんでした"});
          }
        });
    });
    return()=>{closed=true;window.clearInterval(poll);
      window.removeEventListener(householdSafetyChangedEvent,changed);
      window.removeEventListener("storage",stored);window.removeEventListener("focus",changed);
      window.removeEventListener("online",changed);window.removeEventListener("offline",offline);
      document.removeEventListener("visibilitychange",visible);
      if(channel!==null)void client.removeChannel(channel);};
  },[refresh]);
  useEffect(()=>{void refresh();},[refresh]);
  return {blocked:state.phase!=="ready",checking:state.phase==="checking",
    error:state.phase==="blocked",message:state.phase==="blocked"?state.message:null,
    safetyFingerprint:state.phase==="ready"?state.safetyFingerprint:null,
    currentLabelWarnings:state.phase==="ready"?state.currentLabelWarnings:[],refresh};
}
const retryLostResponse=(failureCount:number,error:unknown)=>
  failureCount<1&&!(error instanceof Error&&"code" in error);
export function useCreateShoppingList(){const cache=useQueryClient();return useMutation({
  mutationFn:createShoppingList,onSuccess:()=>cache.invalidateQueries({queryKey:shoppingKeys.active}),
  retry:retryLostResponse,
});}
export function useReconcileShoppingList(){const cache=useQueryClient();return useMutation({
  mutationFn:({listId,input}:{listId:string;input:ReconcileShoppingListRequest})=>
    reconcileShoppingListRequest(listId,input),
  onSuccess:()=>cache.invalidateQueries({queryKey:shoppingKeys.active}),
  retry:retryLostResponse,
});}
```

In the same hook file, implement `useResumeShoppingCommand(kind,targetId,submit)` by importing the one exported storage-key/envelope/TTL contract from `shopping-api.ts`; do not redeclare the envelope. It parses the strict `{createdAtMs,command}` storage envelope and then the exact create/reconcile command schema, removes corrupt, clock-invalid, or older-than-24-hour records before any submit, and on mount, `online`, or visible focus invokes `submit` at most once at a time with the unchanged inner command. A transport failure retains it and the mutation's single automatic retry performs the immediate readback; a page reload within 24 hours invokes the same saved command again. Success clears it only after the response parses and the active list readback succeeds. HTTP/domain errors carry `code`, are never automatically retried, clear the stale command, invalidate active/menu queries, and require a fresh user approval. Tests use fake time/online/visibility events and prove one committed-but-lost creation and one reconciliation recover without a second click or changed byte, while a record at `24h+1ms` is cleared and never sent.

Create `src/features/shopping/components/create-list-sheet.tsx`:

```tsx
import { useState } from "react";
export type CreateListSheetProps={
  activeList:{id:string;version:number;itemCount:number}|null;pending:boolean;safetyBlocked:boolean;
  onSubmit(input:{mode:"new"|"append";activeListId:string|null;
    expectedListVersion:number|null}):void;onCancel():void;
};
export function CreateListSheet({activeList,pending,safetyBlocked,onSubmit,onCancel}:CreateListSheetProps){
  const [mode,setMode]=useState<"new"|"append">(activeList===null?"new":"append");
  return <section className="card stack" aria-labelledby="create-list-title">
    <h2 id="create-list-title">買い物リストを作る</h2>
    {activeList!==null&&<fieldset><legend>作り方</legend>
      <label className="min-h-11 flex items-center"><input type="radio" checked={mode==="append"} onChange={()=>setMode("append")}/>
        今のリストへ追加（{activeList.itemCount}件）</label>
      <label className="min-h-11 flex items-center"><input type="radio" checked={mode==="new"} onChange={()=>setMode("new")}/>
        新しいリストにする</label>
    </fieldset>}
    <button className="primary-button" disabled={pending||safetyBlocked} onClick={()=>onSubmit({
      mode,activeListId:activeList?.id??null,expectedListVersion:activeList?.version??null,
    })}>作成する</button>
    <button className="text-button" onClick={onCancel}>キャンセル</button>
  </section>;
}
```

Create `src/features/shopping/components/reconcile-list-sheet.tsx`:

```tsx
import {useState} from "react";
import type { ShoppingDiff } from "../../../../shared/contracts/shopping";
export type ReconcileListSheetProps={
  diff:ShoppingDiff;pending:boolean;safetyBlocked:boolean;onApply(approval:{
    addKeys:string[];replaceItemIds:string[];removeItemIds:string[];
  }):void;onCancel():void;
};
export function ReconcileListSheet({diff,pending,safetyBlocked,onApply,onCancel}:ReconcileListSheetProps){
  const [addKeys,setAddKeys]=useState(()=>new Set(diff.add.map((item)=>item.key)));
  const [replaceIds,setReplaceIds]=useState(()=>new Set(diff.replace.map((item)=>item.itemId)));
  const [removeIds,setRemoveIds]=useState(()=>new Set(diff.remove.map((item)=>item.itemId)));
  const toggle=(current:Set<string>,value:string,checked:boolean,setter:(next:Set<string>)=>void)=>{
    const next=new Set(current);if(checked)next.add(value);else next.delete(value);setter(next);
  };
  const warnings=(items:readonly {sourceDisplayName:string;allergenDisplayName:string;
    memberDisplayName:string}[])=>items.map((warning)=>
      `${warning.sourceDisplayName}・${warning.allergenDisplayName}・${warning.memberDisplayName}`).join("、");
  return <section className="card stack" aria-labelledby="diff-title">
    <h2 id="diff-title">献立変更の差分</h2>
    <p>内容を確認し、反映する項目だけ選んでください。</p>
    <fieldset><legend>追加 {diff.add.length}件</legend>{diff.add.map((item)=><label
      className="flex min-h-11 items-start gap-3" key={item.key}>
      <input type="checkbox" checked={addKeys.has(item.key)} onChange={(event)=>
        toggle(addKeys,item.key,event.target.checked,setAddKeys)}/>
      <span><strong>{item.displayName} {item.quantityText}</strong>
        <span className="block">使用先：{[...new Set(item.sourceIngredients.map((source)=>source.dishName))].join("・")}</span>
        {item.pantryCheckRequired&&<span className="block">在庫量を確認</span>}
        {item.labelWarnings.length>0&&<span className="block">原材料表示：{warnings(item.labelWarnings)}</span>}
      </span></label>)}</fieldset>
    <fieldset><legend>数量・内容変更 {diff.replace.length}件</legend>{diff.replace.map((item)=><label
      className="flex min-h-11 items-start gap-3" key={item.itemId}>
      <input type="checkbox" checked={replaceIds.has(item.itemId)} onChange={(event)=>
        toggle(replaceIds,item.itemId,event.target.checked,setReplaceIds)}/>
      <span><strong>{item.current.displayName}</strong>：{item.current.quantityText} → {item.next.quantityText}
        <span className="block">使用先：{[...new Set(item.next.sourceIngredients.map((source)=>source.dishName))].join("・")}</span>
        {item.next.labelWarnings.length>0&&<span className="block">原材料表示：{warnings(item.next.labelWarnings)}</span>}
      </span></label>)}</fieldset>
    <fieldset><legend>不要になる候補 {diff.remove.length}件</legend>{diff.remove.map((item)=><label
      className="flex min-h-11 items-start gap-3" key={item.itemId}>
      <input type="checkbox" checked={removeIds.has(item.itemId)} onChange={(event)=>
        toggle(removeIds,item.itemId,event.target.checked,setRemoveIds)}/>
      <span>{item.displayName} {item.quantityText}を外す</span></label>)}</fieldset>
    {diff.protectedItemIds.length>0&&<p>購入済み・手動変更の項目はそのまま残します。</p>}
    {diff.listLabelWarnings.map((warning)=><p key={`${warning.sourceType}:${warning.sourceId}:${warning.allergenId}:${warning.anonymousMemberRef}`}>
      原材料表示を確認：{warning.sourceDisplayName}・{warning.allergenDisplayName}・{warning.memberDisplayName}</p>)}
    <button className="primary-button" disabled={pending||safetyBlocked} onClick={()=>onApply({
      addKeys:[...addKeys],replaceItemIds:[...replaceIds],removeItemIds:[...removeIds],
    })}>選んだ変更を反映</button>
    <button className="text-button" onClick={onCancel}>変更しない</button>
  </section>;
}
```

Create `src/features/shopping/components/shopping-item-row.tsx`:

```tsx
import type {
  CurrentShoppingLabelWarning,ShoppingItem,
} from "../../../../shared/contracts/shopping";
export type ShoppingItemRowProps={
  item:ShoppingItem;onChecked(id:string,value:boolean):void;
  onEdit(item:ShoppingItem):void;onAtHome(id:string):void;
  onRemove(item:ShoppingItem):void;onUndo(id:string):void;disabled:boolean;
  currentLabelWarnings:readonly CurrentShoppingLabelWarning[];
};
export function ShoppingItemRow({item,onChecked,onEdit,onAtHome,onRemove,onUndo,disabled,
  currentLabelWarnings}:ShoppingItemRowProps){
  if(item.isRemovedByUser)return <li className="card flex min-h-11 items-center justify-between">
    <span>{item.displayName}をリストから外しました</span>
    <button type="button" disabled={disabled} className="text-button min-h-11" onClick={()=>onUndo(item.id)}>元に戻す</button>
  </li>;
  return <li className="card stack">
    <label><input type="checkbox" checked={item.isChecked} disabled={disabled}
      aria-label={`${item.displayName}を購入済みにする`}
      onChange={(event)=>onChecked(item.id,event.target.checked)}/>{item.displayName}</label>
    <span>{item.quantityText}</span>
    {item.pantryCheckRequired&&<span>在庫量を確認</span>}
    {currentLabelWarnings.length>0&&<div>
      <strong>加工品は原材料表示を確認</strong>
      {currentLabelWarnings.map((warning)=><p key={warning.warningKey}>
        {warning.sourceDisplayName}・{warning.allergenDisplayName}・{warning.memberDisplayName}</p>)}
    </div>}
    <button disabled={disabled} className="text-button min-h-11" onClick={()=>onEdit(item)}>数量・単位・売り場を編集</button>
    <button disabled={disabled} className="text-button min-h-11" onClick={()=>onAtHome(item.id)}>家にある</button>
    <button disabled={disabled} className="text-button" onClick={()=>onRemove(item)}>削除</button>
  </li>;
}
```

Create `src/features/shopping/pages/shopping-list-page.tsx` with no design-system placeholders:

```tsx
import { useRef,useState,type FormEvent } from "react";
import {shoppingItemMutationRequestSchema,
  type ShoppingItem,type ShoppingItemMutationRequest,type StoreSection} from "../../../../shared/contracts/shopping";
import { mutateShoppingItem } from "../api/shopping-api";
import { normalizeIngredientName } from "../../../../shared/shopping/normalize";
import { reviewedShoppingAliases } from "../../../../shared/shopping/reviewed-aliases";
import { ShoppingItemRow } from "../components/shopping-item-row";
import { useShoppingList,useShoppingSafetyGate } from "../hooks/use-shopping-list";

const sectionLabels:Record<StoreSection,string>={
  produce:"野菜",meat_fish:"肉・魚",dairy_eggs:"乳製品・卵",
  dry_goods:"乾物",seasonings:"調味料",other:"その他",
};
export function categoryLabel(section:StoreSection):string{return sectionLabels[section];}
const sections:readonly StoreSection[]=[
  "produce","meat_fish","dairy_eggs","dry_goods","seasonings","other",
];
type LocalShoppingItemMutation<T=ShoppingItemMutationRequest>=
  T extends ShoppingItemMutationRequest
    ? Omit<T,"listId"|"expectedListVersion"|"expectedSafetyFingerprint"|"idempotencyKey">
    : never;

export function ShoppingListPage(){
  const query=useShoppingList();
  const safetyGate=useShoppingSafetyGate();
  const [adding,setAdding]=useState(false);
  const [manualName,setManualName]=useState("");
  const [manualQuantity,setManualQuantity]=useState("");
  const [manualQuantityText,setManualQuantityText]=useState("数量未入力");
  const [manualUnit,setManualUnit]=useState("");
  const [manualSection,setManualSection]=useState<StoreSection>("other");
  const [editingItem,setEditingItem]=useState<ShoppingItem|null>(null);
  const [editingQuantity,setEditingQuantity]=useState("");
  const [editingQuantityText,setEditingQuantityText]=useState("");
  const [editingUnit,setEditingUnit]=useState("");
  const [editingSection,setEditingSection]=useState<StoreSection>("other");
  const [fieldError,setFieldError]=useState<string|null>(null);
  const manualFirstField=useRef<HTMLInputElement>(null);
  const editFirstField=useRef<HTMLInputElement>(null);
  const [mutationError,setMutationError]=useState<string|null>(null);
  if(query.isPending)return <main className="page-frame"><p>買い物リストを読み込んでいます</p></main>;
  if(query.isError)return <main className="page-frame"><p role="alert">読み込めませんでした</p></main>;
  if(query.data===null)return <main className="page-frame stack"><h1>買い物リスト</h1>
    <p>買い物リストは空です</p><a className="primary-button" href="/history">献立から作る</a></main>;
  const list=query.data;
  const safetyBlocked=safetyGate.blocked||query.isFetching;
  const currentListWarnings=safetyGate.currentLabelWarnings
    .filter((warning)=>warning.itemId===null);
  const storedProvenanceWarnings=safetyGate.error
    ? [...list.listLabelWarnings,...list.items.flatMap((item)=>item.labelWarnings)] : [];
  const mutate=async(value:LocalShoppingItemMutation)=>{
    if(safetyBlocked||safetyGate.safetyFingerprint===null)return;
    try{setMutationError(null);await mutateShoppingItem(shoppingItemMutationRequestSchema.parse({
      ...value,listId:list.id,expectedListVersion:list.version,
      expectedSafetyFingerprint:safetyGate.safetyFingerprint,
      idempotencyKey:crypto.randomUUID(),
    }));
    }catch(error){if(error instanceof Error&&"code" in error&&error.code==="list_version_conflict"){
      setMutationError("別の画面で更新されました。最新の内容を読み込みました");
    }else if(error instanceof Error&&"code" in error&&error.code==="shopping_safety_fingerprint_changed"){
      setMutationError("家族設定が変わりました。もう一度確認します");
      await safetyGate.refresh();
    }else{setMutationError("買い物項目を更新できませんでした");}}
    await query.refetch();
  };
  const submitManual=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const quantity=manualQuantity.trim()===""?null:Number(manualQuantity);
    if(manualName.trim()===""||manualQuantityText.trim()===""||
      (quantity!==null&&(!Number.isFinite(quantity)||quantity<=0))){
      setFieldError("項目名と分量を確認してください");
      requestAnimationFrame(()=>manualFirstField.current?.focus());return;
    }
    await mutate({operation:"add_manual",itemId:null,payload:{displayName:manualName.trim(),
      normalizedName:normalizeIngredientName(manualName,reviewedShoppingAliases),
      storeSection:manualSection,quantityValue:quantity,quantityText:manualQuantityText.trim(),
      unit:manualUnit.trim()===""?null:manualUnit.trim(),
      pantryCheckRequired:false}});
    setManualName("");setManualQuantity("");setManualQuantityText("数量未入力");
    setManualUnit("");setFieldError(null);setAdding(false);await query.refetch();
  };
  return <main className="page-frame stack"><h1>買い物リスト</h1>
    {safetyGate.error&&<p role="alert">{safetyGate.message}</p>}
    {storedProvenanceWarnings.length>0&&<section className="card" aria-label="過去の原材料表示警告">
      <strong>現在の条件では確認できない過去の警告</strong>
      <p>安全確認が完了するまで買い物操作はできません。</p>
      {storedProvenanceWarnings.map((warning)=><p key={warning.warningKey}>
        {warning.sourceDisplayName}・{warning.allergenDisplayName}・{warning.memberDisplayName}</p>)}
    </section>}
    {safetyGate.checking&&<p role="status">現在の家族設定で再確認しています</p>}
    {mutationError!==null&&<p role="alert">{mutationError}</p>}
    {currentListWarnings.length>0&&
      <section className="card"><strong>加工品は原材料表示を確認</strong>
        {currentListWarnings
          .map((warning)=><p key={warning.warningKey}>
            {warning.sourceDisplayName}・{warning.allergenDisplayName}・{warning.memberDisplayName}</p>)}
      </section>}
    {sections.map((section)=>{
      const items=list.items.filter((item)=>item.storeSection===section);
      return items.length===0?null:<section key={section} aria-labelledby={`section-${section}`}>
        <h2 id={`section-${section}`}>{categoryLabel(section)}</h2><ul className="stack">
          {items.map((item)=><ShoppingItemRow key={item.id} item={item}
            disabled={safetyBlocked}
            currentLabelWarnings={safetyGate.currentLabelWarnings
              .filter((warning)=>warning.itemId===item.id)}
            onChecked={(id,value)=>void mutate({operation:"set_checked",itemId:id,payload:{isChecked:value}})}
            onEdit={(target)=>{setEditingItem(target);setEditingQuantity(String(target.quantityValue??""));
              setEditingQuantityText(target.quantityText);setEditingUnit(target.unit??"");
              setEditingSection(target.storeSection);setFieldError(null);}}
            onAtHome={(id)=>void mutate({operation:"mark_at_home",itemId:id,payload:{}})}
            onRemove={(target)=>void mutate({operation:"remove",itemId:target.id,payload:{}})}
            onUndo={(id)=>void mutate({operation:"undo",itemId:id,payload:{}})}/>)}
        </ul></section>;
    })}
    {editingItem!==null&&<form className="card stack" onSubmit={(event)=>{event.preventDefault();
      const quantity=editingQuantity.trim()===""?null:Number(editingQuantity);
      if(editingQuantityText.trim()===""||(quantity!==null&&
        (!Number.isFinite(quantity)||quantity<=0))){setFieldError("分量を確認してください");
        requestAnimationFrame(()=>editFirstField.current?.focus());return;}
      void mutate({operation:"edit",itemId:editingItem.id,payload:{
        displayName:editingItem.displayName,
        normalizedName:normalizeIngredientName(editingItem.displayName,reviewedShoppingAliases),
        storeSection:editingSection,quantityValue:quantity,
        quantityText:editingQuantityText.trim(),unit:editingUnit.trim()===""?null:editingUnit.trim()}})
        .then(()=>setEditingItem(null));}}>
      <h2>{editingItem.displayName}を編集</h2>
      {fieldError&&<p role="alert">{fieldError}</p>}
      <label>数値（任意）<input ref={editFirstField} aria-label={`${editingItem.displayName}の数量`} type="number" min="0.001"
        step="0.001" value={editingQuantity}
        onChange={(event)=>setEditingQuantity(event.target.value)}/></label>
      <label>表示する分量<input aria-label={`${editingItem.displayName}の分量表記`} required
        value={editingQuantityText} onChange={(event)=>setEditingQuantityText(event.target.value)}/></label>
      <label>単位（任意）<input aria-label={`${editingItem.displayName}の単位`} maxLength={24}
        value={editingUnit} onChange={(event)=>setEditingUnit(event.target.value)}/></label>
      <label>売り場<select aria-label={`${editingItem.displayName}の売り場`} value={editingSection}
        onChange={(event)=>{const selected=sections.find((item)=>item===event.target.value);
          if(selected!==undefined)setEditingSection(selected);}}>{sections.map((section)=><option
          key={section} value={section}>{categoryLabel(section)}</option>)}</select></label>
      <button disabled={safetyBlocked} className="primary-button min-h-11" type="submit">変更を保存</button>
      <button className="text-button min-h-11" type="button" onClick={()=>setEditingItem(null)}>キャンセル</button>
    </form>}
    {adding?<form className="card stack" onSubmit={(event)=>void submitManual(event)}>
      {fieldError&&<p role="alert">{fieldError}</p>}
      <label className="field">項目名<input ref={manualFirstField} aria-label="項目名" required maxLength={100}
        value={manualName} onChange={(event)=>setManualName(event.target.value)}/></label>
      <label className="field">数値（任意）<input aria-label="数量" type="number" min="0.001"
        step="0.001" value={manualQuantity} onChange={(event)=>setManualQuantity(event.target.value)}/></label>
      <label className="field">表示する分量<input aria-label="分量表記" required maxLength={60}
        value={manualQuantityText} onChange={(event)=>setManualQuantityText(event.target.value)}/></label>
      <label className="field">単位（任意）<input aria-label="単位" maxLength={24}
        value={manualUnit} onChange={(event)=>setManualUnit(event.target.value)}/></label>
      <label className="field">売り場<select aria-label="売り場" value={manualSection}
        onChange={(event)=>{const selected=sections.find((item)=>item===event.target.value);
          if(selected!==undefined)setManualSection(selected);}}>
        {sections.map((section)=><option key={section} value={section}>{categoryLabel(section)}</option>)}
      </select></label>
      <button disabled={safetyBlocked} className="primary-button" type="submit">追加する</button>
      <button className="text-button" type="button" onClick={()=>setAdding(false)}>キャンセル</button>
    </form>:<button disabled={safetyBlocked} className="primary-button" type="button" onClick={()=>setAdding(true)}>
      ＋ 項目を追加</button>}
  </main>;
}
```

- [ ] **Step 5 (2–5 min): Wire result actions/routes, run tests, and commit**

Add this command helper to `shopping-api.ts`; retry and reload reuse its exact body until a successful response clears it:

```ts
export const pendingShoppingCommandStorageKey=(kind:"create"|"reconcile",targetId:string)=>
  `kondate:shopping:${kind}:${targetId}`;
export const pendingShoppingCommandTtlMs=24*60*60*1_000;
export const pendingShoppingCommandEnvelopeSchema=<T>(schema:z.ZodType<T>)=>z.object({
  createdAtMs:z.number().int().nonnegative(),command:schema,
}).strict();
export function persistedShoppingCommand<T>(kind:"create"|"reconcile",targetId:string,
  schema:z.ZodType<T>,build:(idempotencyKey:string)=>T):T{
  const key=pendingShoppingCommandStorageKey(kind,targetId);const saved=sessionStorage.getItem(key);
  if(saved!==null){try{const parsed=pendingShoppingCommandEnvelopeSchema(schema).safeParse(JSON.parse(saved));
    if(parsed.success){const age=Date.now()-parsed.data.createdAtMs;
      if(age>=0&&age<=pendingShoppingCommandTtlMs)return parsed.data.command;}
  }catch{/* remove below */}sessionStorage.removeItem(key);}
  const command=schema.parse(build(crypto.randomUUID()));
  sessionStorage.setItem(key,JSON.stringify({createdAtMs:Date.now(),command}));return command;
}
export const clearShoppingCommand=(kind:"create"|"reconcile",targetId:string)=>
  sessionStorage.removeItem(pendingShoppingCommandStorageKey(kind,targetId));
```

`MenuResultPage` loads `useShoppingList()` and `useShoppingSafetyGate()`. Its `safetyBlocked` is true while that gate is blocked or Plan 4's current-menu revalidation query is fetching/not-successful; pass it to both sheets and refuse to construct a create/reconcile command until both reloads succeed. “買い物リストを作る” renders `CreateListSheet` with the exact active ID/version. Creation builds a Zod-validated persisted command containing `menuId`, mode, active ID/version, and key, then mounts `useResumeShoppingCommand`; a lost response automatically retries/readbacks the same key without another click. Clear it only after success plus active-list readback and navigate to `/shopping`. When the active list contains an older source version from the same derivation group, “買い物リストとの差分を確認” calls display-only `previewShoppingDiff`, renders `ReconcileListSheet`, and builds one persisted request containing exact list/menu versions, approval IDs, and key. A network error keeps and automatically retries the command; 409 clears it, reloads active/menu data, and requires new approval. Replace only the `/shopping` placeholder in `src/app/router.tsx` with `<ShoppingListPage />`; no second route or client-trusted resolved values are introduced.

The component test stubs `sessionStorage`, loses the first committed create/reconcile response, fires no second user click, and asserts automatic byte-identical inner commands/idempotency keys and saved-response readback; exact fake-clock cases cover `24h`, `24h+1ms`, and a future timestamp. Additional exact tests click “数量・単位・売り場を編集”, change numeric quantity, human quantity text, unit, and section, and verify all four values reach the owner RPC; manual add accepts the same optional quantity/unit fields. Empty/invalid values render a field error and move focus into the form. “家にある” and “元に戻す” tests assert the latest list version, list-safety fingerprint, operation, payload, and unique key; a simulated second-tab success makes the stale first-tab command fail and refetch. Safety-signal tests hold active-list source revalidation pending and prove check/edit/create/reconcile remain disabled after same-tab, other-tab, focus, visibility, online, Realtime, or poll invalidation even after active-list reload, then re-enable only after all sources, latest current projection, and list fingerprint succeed. Once ready, render only `safetyGate.currentLabelWarnings` as the actionable/current item- and list-level warnings using `sourceDisplayName・allergenDisplayName・memberDisplayName`; do not render `list.items[].labelWarnings` or `list.listLabelWarnings` as current authority. If the gate is blocked/unverifiable because a source was deleted or cannot be checked, keep every control disabled but render only those immutable creation/approval snapshots in a separate read-only section headed `現在の条件では確認できない過去の警告`; never copy the last current projection into this section or label provenance current/confirmed. A newly added allergy appears after a successful check, an obsolete current warning disappears, and raw source/catalog/member refs never become copy.

Run:

```bash
npm test -- --run src/features/shopping
npm run typecheck
npm run lint
```

Expected: empty/create/append, 24-hour-bounded response-loss replay, canonical household-safety event/revision plus focus/visibility/online/Realtime/60-second-poll invalidation, exact `["shopping","active"]` reload, fail-closed controls, owner-RPC manual/check/edit/remove/undo, two-tab version conflict, category, separated immutable/current human warnings, preview, protected-state, conflict reload, 44px, and API failure tests pass. A source scan finds no browser `.from("shopping_items").insert/update/delete` call, no browser query treating `shopping_current_label_warnings` as authoritative without revalidation, and no duplicated safety event/revision string.

```bash
git add src/features/shopping src/features/generation/pages/menu-result-page.tsx src/app/router.tsx
git commit -m "feat: add mobile shopping workflow"
```

### Task 6: Define E2E fixtures and verify creation, retention, reconciliation, race, and retry

**Files:**
- Create: `e2e/fixtures/shopping.ts`
- Create: `e2e/specs/shopping-list.spec.ts`
- Create: `e2e/specs/shopping-list-races.spec.ts`

**Interfaces:**
- Consumes: Plan 1 `test`/`expect`/`completeMinimumOnboarding` and Plans 3–4 UI.
- Produces: `test` fixture `shoppingMenuId` and defined helpers `ensurePlannerReady`, `generateShoppingMenu`, `createListFromMenu`, `addManualItem`, `regenerateWholeMenu`, `deleteMenuHistoryGroup`, and `deferMatchingRequest`.

- [ ] **Step 1 (2–5 min): Create the fixture before journeys reference it**

Create `e2e/fixtures/shopping.ts`:

```ts
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
  completeMinimumOnboarding,expect,test as authTest,
} from "./auth";
import { localRestHeaders } from "./local-supabase";

type ShoppingFixtures={shoppingMenuId:string};
export const test=authTest.extend<ShoppingFixtures>({
  shoppingMenuId:async({authenticatedPage:page},use)=>{
    await ensurePlannerReady(page);
    await use(await generateShoppingMenu(page));
  },
});
export {expect};

export async function ensurePlannerReady(page:Page):Promise<void>{
  await page.goto("/planner");
  if(await page.getByRole("heading",{name:"家族の初回設定"}).isVisible()){
    await completeMinimumOnboarding(page);
    await page.getByRole("checkbox",{name:/説明を確認しました/u}).check();
    await page.getByRole("button",{name:"確認して進む"}).click();
  }
}
export async function generateShoppingMenu(page:Page):Promise<string>{
  await page.goto("/planner");
  await page.getByRole("radio",{name:"夕食"}).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("radio",{name:"和食"}).check();
  await page.getByRole("button",{name:"献立を作る"}).click();
  await expect(page.getByRole("heading",{name:"献立ができました"}))
    .toBeVisible({timeout:30_000});
  const parsed=/\/menus\/([0-9a-f-]+)$/u.exec(new URL(page.url()).pathname);
  if(parsed?.[1]===undefined)throw new Error("generated menu id was not present in URL");
  return parsed[1];
}
export async function createListFromMenu(page:Page,menuId:string):Promise<void>{
  await page.goto(`/menus/${menuId}`);
  await page.getByRole("button",{name:"買い物リストを作る"}).click();
  const newChoice=page.getByRole("radio",{name:"新しいリストにする"});
  if(await newChoice.isVisible())await newChoice.check();
  await page.getByRole("button",{name:"作成する"}).click();
  await expect(page).toHaveURL(/\/shopping$/u);
}
export async function addManualItem(page:Page,name:string):Promise<void>{
  await page.getByRole("button",{name:"＋ 項目を追加"}).click();
  await page.getByLabel("項目名").fill(name);
  await page.getByLabel("売り場").selectOption("other");
  await page.getByRole("button",{name:"追加する"}).click();
}
export async function regenerateWholeMenu(page:Page,menuId:string):Promise<string>{
  await page.goto(`/history/${menuId}`);
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible();
  await page.getByRole("button",{name:"献立をまるごと別案にする"}).click();
  await page.getByLabel("別の味に").check();
  await page.getByRole("button",{name:"別案を作る"}).click();
  await expect(page.getByRole("heading",{name:"献立ができました"}))
    .toBeVisible({timeout:30_000});
  const parsed=/\/menus\/([0-9a-f-]+)$/u.exec(new URL(page.url()).pathname);
  if(parsed?.[1]===undefined)throw new Error("regenerated menu id was not present in URL");
  return parsed[1];
}
export async function deleteMenuHistoryGroup(page:Page,menuId:string):Promise<void>{
  const headers=await authenticatedRestHeaders(page);
  const lookup=await page.request.get(
    `http://127.0.0.1:8000/rest/v1/menus?id=eq.${menuId}&select=derivation_group_id`,
    {headers},
  );
  const rows=z.array(z.object({derivation_group_id:z.string().uuid()}))
    .parse(await lookup.json());
  if(rows[0]===undefined)throw new Error("menu group was not found");
  const removed=await page.request.post(
    "http://127.0.0.1:8000/rest/v1/rpc/delete_menu_group",
    {headers,data:{p_derivation_group_id:rows[0].derivation_group_id}},
  );
  if(!removed.ok())throw new Error("menu group could not be deleted");
}
export async function deferMatchingRequest(page:Page,pattern:string):Promise<{
  release():Promise<void>;
}>{
  let open:()=>void=()=>undefined,seen:()=>void=()=>undefined;
  const gate=new Promise<void>((resolve)=>{open=resolve;});
  const intercepted=new Promise<void>((resolve)=>{seen=resolve;});
  await page.route(pattern,async(route)=>{seen();await gate;await route.continue();});
  return {release:async()=>{await intercepted;open();
    await page.unrouteAll({behavior:"wait"});}};
}
export async function markFirstMemberAllergyUnconfirmed(page:Page):Promise<void>{
  const headers=await authenticatedRestHeaders(page);
  const lookup=await page.request.get(
    "http://127.0.0.1:8000/rest/v1/household_members?status=eq.complete&select=id&limit=1",
    {headers},
  );
  const rows=z.array(z.object({id:z.string().uuid()})).parse(await lookup.json());
  if(rows[0]===undefined)throw new Error("complete household member was not found");
  const changed=await page.request.patch(
    `http://127.0.0.1:8000/rest/v1/household_members?id=eq.${rows[0].id}`,
    {headers,data:{allergy_status:"unconfirmed"}},
  );
  if(!changed.ok())throw new Error("household safety could not be changed");
}
async function authenticatedRestHeaders(page:Page):Promise<Record<string,string>>{
  return localRestHeaders(page);
}
```

- [ ] **Step 2 (2–5 min): Write journeys using only fixture exports**

Create `e2e/specs/shopping-list.spec.ts`:

```ts
import {
  addManualItem,createListFromMenu,deleteMenuHistoryGroup,expect,
  regenerateWholeMenu,test,
} from "../fixtures/shopping";

test("retains checked/manual items and label snapshots after history deletion",async({
  authenticatedPage:page,shoppingMenuId,
})=>{
  await createListFromMenu(page,shoppingMenuId);
  const first=page.getByRole("checkbox",{name:/を購入済みにする/u}).first();
  await first.check();
  await addManualItem(page,"キッチンペーパー");
  await deleteMenuHistoryGroup(page,shoppingMenuId);
  await page.goto("/shopping");
  await expect(page.getByText("キッチンペーパー")).toBeVisible();
  await expect(first).toBeChecked();
  await expect(page.getByText("現在の条件では確認できない過去の警告")).toBeVisible();
  await expect(page.getByText("加工品は原材料表示を確認")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"＋ 項目を追加"})).toBeDisabled();
});

test("shows server-owned diff and preserves protected rows",async({
  authenticatedPage:page,shoppingMenuId,
})=>{
  await createListFromMenu(page,shoppingMenuId);
  const checked=page.getByRole("checkbox",{name:/を購入済みにする/u}).first();
  await checked.check();
  const nextMenuId=await regenerateWholeMenu(page,shoppingMenuId);
  await page.goto(`/menus/${nextMenuId}`);
  await page.getByRole("button",{name:"買い物リストとの差分を確認"}).click();
  await expect(page.getByText("購入済み・手動変更の項目はそのまま残します。")).toBeVisible();
  await page.getByRole("button",{name:"選んだ変更を反映"}).click();
  await page.goto("/shopping");
  await expect(checked).toBeChecked();
});
```

Create `e2e/specs/shopping-list-races.spec.ts`:

```ts
import {
  createShoppingListRequestSchema,reconcileShoppingListRequestSchema,
} from "../../shared/contracts/shopping";
import {
  createListFromMenu,deferMatchingRequest,expect,markFirstMemberAllergyUnconfirmed,test,
} from "../fixtures/shopping";

test("reuses one idempotency key after the first response is lost",async({
  authenticatedPage:page,shoppingMenuId,
})=>{
  let calls=0;const bodies:string[]=[];
  await page.route("**/api/shopping-lists/from-menu",async(route)=>{
    bodies.push(route.request().postData()??"");calls+=1;
    if(calls===1){await route.fetch();await route.abort("connectionreset");return;}
    await route.continue();
  });
  await createListFromMenu(page,shoppingMenuId);
  expect(calls).toBe(2);
  const commands=bodies.map((body)=>createShoppingListRequestSchema.parse(JSON.parse(body)));
  expect(new Set(commands.map((command)=>command.idempotencyKey)).size).toBe(1);
  await expect(page.getByRole("heading",{name:"買い物リスト"})).toBeVisible();
});

test("rejects creation after current household safety changes",async({
  authenticatedPage:page,shoppingMenuId,
})=>{
  await markFirstMemberAllergyUnconfirmed(page);
  await page.goto(`/menus/${shoppingMenuId}`);
  await page.getByRole("button",{name:"買い物リストを作る"}).click();
  await page.getByRole("button",{name:"作成する"}).click();
  await expect(page.getByText(/現在の家族設定/u)).toBeVisible();
});

test("disables shopping actions immediately after member or allergy mutation",async({
  authenticatedPage:shoppingPage,shoppingMenuId,
})=>{
  await createListFromMenu(shoppingPage,shoppingMenuId);
  const settingsPage=await shoppingPage.context().newPage();
  await settingsPage.goto("/settings");
  const reload=await deferMatchingRequest(shoppingPage,"**/rest/v1/shopping_lists*");
  const sourceRevalidation=await deferMatchingRequest(shoppingPage,
    "**/api/shopping-lists/*/revalidate");
  await settingsPage.getByLabel("表示名").fill("更新後の家族");
  await settingsPage.getByRole("button",{name:"家族設定を保存"}).click();
  await expect(shoppingPage.getByRole("checkbox",{name:/購入済みにする/u}).first()).toBeDisabled();
  await expect(shoppingPage.getByRole("button",{name:"数量・単位・売り場を編集"}).first()).toBeDisabled();
  await reload.release();
  await expect(shoppingPage.getByRole("checkbox",{name:/購入済みにする/u}).first()).toBeDisabled();
  await sourceRevalidation.release();
  await expect(shoppingPage.getByRole("checkbox",{name:/購入済みにする/u}).first()).toBeEnabled();
  await settingsPage.getByRole("button",{name:"アレルギーを編集"}).click();
  await settingsPage.getByRole("checkbox",{name:"くるみ"}).check();
  const allergyReload=await deferMatchingRequest(shoppingPage,"**/rest/v1/shopping_lists*");
  const allergyRevalidation=await deferMatchingRequest(shoppingPage,
    "**/api/shopping-lists/*/revalidate");
  await settingsPage.getByRole("button",{name:"アレルギーを保存"}).click();
  await expect(shoppingPage.getByRole("checkbox",{name:/購入済みにする/u}).first()).toBeDisabled();
  await allergyReload.release();
  await expect(shoppingPage.getByRole("checkbox",{name:/購入済みにする/u}).first()).toBeDisabled();
  await allergyRevalidation.release();
});

test("fails closed on a server-only household change without browser events",async({
  authenticatedPage:page,shoppingMenuId,
})=>{
  await createListFromMenu(page,shoppingMenuId);
  await page.goto("/shopping");
  const revalidation=await deferMatchingRequest(page,"**/api/shopping-lists/*/revalidate");
  await markFirstMemberAllergyUnconfirmed(page);
  await expect(page.getByRole("checkbox",{name:/購入済みにする/u}).first()).toBeDisabled();
  await expect(page.getByRole("button",{name:"数量・単位・売り場を編集"}).first()).toBeDisabled();
  await revalidation.release();
  await expect(page.getByText(/現在の家族設定/u)).toBeVisible();
  await expect(page.getByRole("checkbox",{name:/購入済みにする/u}).first()).toBeDisabled();
});

test("replays reconciliation after the committed response is lost",async({
  authenticatedPage:page,shoppingMenuId,
})=>{
  await createListFromMenu(page,shoppingMenuId);
  const nextMenuId=await regenerateWholeMenu(page,shoppingMenuId);
  await page.goto(`/menus/${nextMenuId}`);
  await page.getByRole("button",{name:"買い物リストとの差分を確認"}).click();
  const bodies:string[]=[];let first=true;
  await page.route("**/api/shopping-lists/*/reconcile",async(route)=>{
    bodies.push(route.request().postData()??"");
    if(first){first=false;await route.fetch();await route.abort("connectionreset");return;}
    await route.continue();
  });
  await page.getByRole("button",{name:"選んだ変更を反映"}).click();
  await expect(page).toHaveURL(/\/shopping$/u);
  expect(bodies).toHaveLength(2);
  const commands=bodies.map((body)=>reconcileShoppingListRequestSchema.parse(JSON.parse(body)));
  expect(new Set(commands.map((command)=>command.idempotencyKey)).size).toBe(1);
});
```

- [ ] **Step 3 (2–5 min): Run RED, then implement only fixture/UI integration exposed by these exact tests**

Run: `npm run e2e -- e2e/specs/shopping-list.spec.ts e2e/specs/shopping-list-races.spec.ts`

Expected before route/UI wiring: FAIL on the first missing shopping action, not on an undefined fixture symbol. Implement the Task 5 manual form, diff action, persisted retry command, and history delete confirmation exactly as specified; do not add a test-only pause endpoint. The between-validation/locked-RPC races remain deterministic service/`dblink` tests from Tasks 2–4.

- [ ] **Step 4 (2–5 min): Run the complete Plan 5 gate**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run db:test
npm run e2e -- e2e/specs/shopping-list.spec.ts e2e/specs/shopping-list-races.spec.ts
npm run build
docker compose config --quiet
```

Expected: every command exits 0; unit, handler, pgTAP, concurrency, deletion-retention, canonical safety-event/revision, focus/visibility/online/Realtime/poll, immediate disabled-state, component, same-device, and server-only household-change E2E tests report zero failures. Then run the following self-scan; it exits 0 without printing a match:

```bash
for term in 'TB''D' 'TO''DO' 'implement ''later' 'fill in ''details' 'similar to ''Task'; do
  ! rg -n "$term" docs/superpowers/plans/2026-07-11-kondate-mvp-05-shopping-list.md
done
```

- [ ] **Step 5 (2–5 min): Commit verified journeys**

```bash
git add e2e/fixtures/shopping.ts e2e/specs/shopping-list.spec.ts e2e/specs/shopping-list-races.spec.ts
git commit -m "test: cover shopping list safety journeys"
```
