# Plan 5 Task 1 Diff-Matching Plan Correction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct Plan 5 Task 1's literal `computeShoppingDiff` implementation so it can satisfy Plan 5 Task 1's own literal `diff.test.ts` assertion for a protected numeric row whose regenerated requirement becomes ambiguous, consistent with the design spec's two-stage protected-row rule.

**Architecture:** Modify only the protected-row branch of `computeShoppingDiff` in `shared/shopping/diff.ts` (as specified by Plan 5 Task 1 Step 4) to fall back to a normalized-name lookup across both numeric and ambiguous next-draft buckets when the protected row's own `diffKey` does not find a candidate. Non-protected replace/remove matching is unchanged.

**Tech Stack:** TypeScript strict mode, Vitest.

## Global Constraints

- Modify only `docs/superpowers/plans/2026-07-11-kondate-mvp-05-shopping-list.md` Task 1 Step 4's `shared/shopping/diff.ts` listing (the plan document) and, on implementation, `shared/shopping/diff.ts` itself. Do not touch Task 1's contracts, aggregation, or any other Task's files.
- Preserve every other Task 1 behavior: one-to-one ambiguous-row consumption, `resolveApprovedDiff` strict subset checking, `protectedItemIds` collection, and the `isManual` skip.
- Preserve `shared/shopping/diff.test.ts` exactly as transcribed from the plan; no test is weakened or removed to make this pass.
- Code comments in the corrected implementation are Japanese.

---

## Defect Found

Plan 5 Task 1 Step 1 (`shared/shopping/diff.test.ts`) contains this exact test (plan lines 272–280):

```ts
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
```

The second assertion calls `computeShoppingDiff` again on the same protected `removed` row (numeric, `unit:"本"`), but with the next-draft candidate now ambiguous (`quantityValue:null,unit:null`).

Plan 5 Task 1 Step 4's literal `diff.ts` (plan lines 653–692) matches protected rows by calling `takeCandidate(diffKey(item))`, where `diffKey(item)` is computed from the *protected current row's own shape*. For `removed` (numeric, unit `"本"`), this always produces the numeric bucket key `["numeric","にんじん","本"]`, which never matches the ambiguous candidate's bucket key `["ambiguous","にんじん",null,"適量","produce"]`. The literal implementation therefore can never reach its own `else if (candidate !== undefined)` review branch for this case; the ambiguous candidate falls through untouched to the unconditional leftover flush (`add.push(...[...nextBuckets.values()].flat())`) and is emitted with the default `pantryCheckRequired:false`, not `true`.

Verified independently: running the plan's literal test against the plan's literal implementation reproduces exactly one failure (`pantryCheckRequired: false` vs. expected `true`); all other 9 Task 1 tests pass unmodified.

The design spec (`docs/superpowers/specs/2026-07-11-kondate-mvp-design.md:302`) requires: a protected row with a same-name, same-unit new requirement gets a safe delta; a same-name row whose new requirement cannot be safely subtracted (unit lost, becomes ambiguous, etc.) must produce a separate confirmation item rather than being silently dropped or emitted as a plain unchecked add. The literal `diffKey`-only lookup structurally cannot reach that second case for a protected row, contradicting the design spec.

## Correction

### Task 1: Fall back to normalized-name matching for protected rows only

**Files:**
- Modify: `shared/shopping/diff.ts` (Plan 5 Task 1 Step 4 listing, and the implementation file if already created)

**Interfaces:**
- No exported signature changes. `computeShoppingDiff(current,next): ShoppingDiff` and `resolveApprovedDiff` keep their exact Task 1 signatures and behavior for every other case.

- [ ] **Step 1: Change only the protected-row candidate lookup**

Within the `for (const item of current.items)` loop, inside the `if (protectedItem(item))` branch, after the `if (item.isManual) continue;` line, replace the single `takeCandidate(diffKey(item))` lookup with: try the exact `diffKey(item)` match first (preserves current delta behavior when shapes match exactly), and only if that misses, fall back to a normalized-name scan across the remaining `nextBuckets` entries — taking the first item (in bucket-insertion order) whose `normalizedName` equals `item.normalizedName`, regardless of numeric/ambiguous shape. This fallback applies only inside the protected branch; non-protected replace/remove matching keeps its exact `diffKey` equality with no name fallback.

```ts
// protected row（購入済み・手動・編集済み・削除済み）は、まず完全一致キーで候補を探す。
// 完全一致がなければ、同じ正規化名の候補を numeric/ambiguous を問わず探す
// （設計仕様: 同単位なら安全な差分、そうでなければ別項目で確認を求める）。
const exactCandidate = takeCandidate(diffKey(item));
const candidate = exactCandidate ?? takeCandidateByName(item.normalizedName);
```

Add a helper adjacent to `takeCandidate` that scans `nextBuckets` values for the first entry matching by `normalizedName`, removes it from its bucket (preserving one-to-one consumption for the ambiguous-row test), and returns it:

```ts
const takeCandidateByName=(normalizedName:string):ShoppingDraftItem|undefined=>{
  for(const [key,bucket] of nextBuckets){
    const index=bucket.findIndex((entry)=>entry.normalizedName===normalizedName);
    if(index===-1)continue;
    const [candidate]=bucket.splice(index,1);
    if(bucket.length===0)nextBuckets.delete(key);
    return candidate;
  }
  return undefined;
};
```

Note the known limitation: because `current.items` is iterated in array order, an earlier protected row's name-fallback lookup can consume a candidate that a later non-protected or protected row of the same name would also have matched. This is not exercised by Plan 5 Task 1's tests (each test uses at most one row per name) and is acceptable for this correction's scope; a future Task touching multi-row same-name protected reconciliation must re-examine this ordering dependency.

- [ ] **Step 2: Re-run Task 1's exact tests and verify full GREEN**

Run: `npm test -- --run shared/shopping/aggregate.test.ts shared/shopping/diff.test.ts`

Expected: all 10 tests pass, including both assertions in `"keeps a removed row and proposes its larger known delta or unknown review item"`.

- [ ] **Step 3: Typecheck and commit as part of Task 1's commit**

This correction is folded into Plan 5 Task 1's own commit (`feat: define exact shopping contracts`); it is not a separate commit, since Task 1 has not yet been committed. Record this correction file's existence in the commit body only if the repository convention requires citing corrections (see Plan 2 Task 2 correction precedent); otherwise the correction document itself is the durable record.
