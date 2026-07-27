# Secondary Adversarial Verification: R1 reslist design

- **Date**: 2026-07-27
- **Role**: secondary (clean context, independent of design-loop and of primary authorship)
- **Design**: `docs/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md`
- **Primary review**: `docs/reviews/2026-07-27-r1-candidate-reslist-adversarial-primary.md`
- **Cross-checked**: parent `2026-07-26-paid-openrouter-models-design.md` §4.1/§4.4/§6.3; evidence 第2/第4; closeout R1; code `scripts/benchmark-paid-openrouter-models.mjs` + `.test.mjs`; `docs/runbooks/openrouter.md`
- **Constraints honored**: read-only product tree except this file; no paid OpenRouter; no secrets; no raw model output

## Verdict on design after verification: **REVISE**

## Summary

Independent re-read of the R1 design against code and parent locks **confirms the primary’s REVISE**. There is still **no Critical “silent ship without N=10 / lock break / secret leak”** hole in the *stated* ship clauses. The blocking problems are Stage-1 / paid-run **procedure implementability and integrity**: full-catalog snapshot vs 1 MiB·5s path (I-1), EX-\* table contradictions (I-2), preflight/C-cut not expressible via documented `main` CLI (I-3), weak repair re-entry (I-4), free-form ranking without a reviewable decision record (I-5), and no machine-checkable survivors⊆frozen binding (I-6).

**One primary Important is downgraded**: I-7 (optional preflight). That is an intentional design choice (Goal 5, Open Q #2), bounded by `est_pass_all` hard-limit, not a false-ship path. Primary’s severity overstated the cost narrative relative to the design’s own honesty.

**One additional Important** was found: EX-B re-entry is even weaker than repair-slow re-entry (no minimum *n*, threshold remains full 20s), so class-B timeout IDs can re-enter shortlist on a single lucky sub-20s sample (A-I1).

**Net blocking**: 0 Critical, **7 Important** (I-1…I-6 + A-I1). Minors M-1…M-6 confirmed as real nits. Do not approve / plan-implement until Important items are revised into the design (and runbook/CLI notes where the design claims operator executability).

---

## Per-primary-finding adjudication

| ID | Primary severity | Secondary adjudication | Final severity | Notes |
|----|------------------|------------------------|----------------|-------|
| I-1 | Important | **CONFIRMED** | Important | §5.2.0 steps 2–3 literally reuse `officialModelsUrl` + 5s + 1 MiB (`OPENROUTER_MAX_BODY_BYTES`) and require **all** `data[]` entries. Code path throws on over-cap (`readResponseBodyWithByteCap` → `"response_body_over_byte_cap"` / `"OpenRouter Models API body exceeds byte cap"`). No pagination, no Stage-1-only budget, no completeness proof (`total_count` / page loop). 第2 evidence “全 40 本” shows a usable enumeration *existed that day* but does **not** define recovery when the prescribed fetch cannot return a complete pool. Treating production chat body-cap as full-catalog enumeration is a real category error. Incomplete/divergent catalogs → wrong shortlist or false Stage-1 stop. |
| I-2 | Important | **CONFIRMED** | Important | §5.3 intro: mechanical survivors are “**既定で shortlist 候補に載せない**”. EX-R4-REPAIR-SLOW body only bans **repair スロット** and says primary evaluation is separate (KD-R1-7 same). §5.4.1 also treats oss-120b as repair-unsuitable but does not ban shortlist membership. EX-R4-EXACT is a **configuration-set** rule, not an ID shortlist ban, yet sits in the same table. Two operators can honestly freeze different `candidateModelIds` / configs from the same evidence. §5.5.1 mechanical invariants still do **not** ban `configuration[1] ∈ REPAIR-SLOW` (only human step text in §5.5.2). |
| I-3 | Important | **CONFIRMED** | Important | Design: preflight FAIL configs must not enter N=10; §8.1 may **reduce C** before N=10; §5.1 eligible-only path. Code: `runPaidBenchmark({ configurations, trialCount })` accepts overrides, but **`main()` always** passes `paidOpenRouterModelConfigurations` and default `trialCount=10` (L371–378). Runbook documents only `node scripts/benchmark-paid-openrouter-models.mjs` with full frozen set. Design marks CLI flags as **optional later PR** (§5.6.4 / PR-R1-3). Result: documented operator path systematically diverges from eligible-set / C-cut semantics unless ad-hoc Node injection or temporary source edits. Important, not Critical: still cannot ship without N=10 PASS, but cost-control and “eligible only” are not executable as written. |
| I-4 | Important | **CONFIRMED** | Important | KD-R1-7 / EX-R4-REPAIR-SLOW: normative floor is **n≥1** with all samples `< 12_000`; “推奨 n≥3 の p95” is non-normative. 第4 repair `elapsedMs=20005` is exactly the failure class R1 excludes. One lucky ~11.9s sample re-admits repair-slot use under load. 12s constant is reasonable derivation from locks; **n≥1** makes the threshold ornamental. |
| I-5 | Important | **CONFIRMED** (nuance) | Important | Goal 1 *intentionally* is not pure algorithm; human L/S/J/C ranking is in scope. Primary’s phrase “two operators same shortlist” is **not** a design promise and slightly overstates. Still Important: §5.4 only requires free-form 1-line axis notes; `human_pick_singles` / `human_pick_pairs` are unconstrained beyond cardinality and set equality. Same survivors + EX-\* can freeze different bills of materials with thin narrative evidence and no required ordinals / rejected-pair log / second-operator freeze. That undercuts reviewability of the Stage-1 freeze PR (the actual N=10 inputs). |
| I-6 | Important | **CONFIRMED** | Important | §5.2.0 step 5 forbids inventing shortlist IDs outside survivors. Freeze test today only `deepEqual`s fixed ID/config arrays + `isFrozen` (`.test.mjs` L134–152). R1 adds set(ids)===union(configs), **not** ⊆ committed survivor table. Procedure integrity is honor-system; CI will not catch skipped EX-\*/ranking if IDs still pass gate-day mechanical filter. |
| I-7 | Important | **DOWNGRADE** | **Minor** | Goal 5 and Open Q #2 explicitly keep N=1 preflight **optional**; §5.6.3 allows skip. Hard-limit gate uses `est_pass_all` (KD-R1-13), so unbounded spend is not opened. Primary correctly says this is not a false-ship hole. Marketing tone in Alt F / “強く推奨” is soft; residual is **in-budget inefficiency**, not ship safety. Keep as Minor process nit: for L/J=未知, preflight-as-mandatory would be stronger ops, but design already flags the open question. Interaction with I-3 is real but attributed to I-3. |
| M-1 | Minor | **CONFIRMED** | Minor | §5.8.1 lacks Models API non-OK / over-cap / invalid body / timeout → stop rows; operators may improvise (feeds I-1). |
| M-2 | Minor | **CONFIRMED** | Minor | Header “設計レビュー合意済み” is premature while primary/secondary are open. |
| M-3 | Minor | **CONFIRMED** | Minor | §10 lists files, not Docker-wrapped exact commands per project convention. |
| M-4 | Minor | **CONFIRMED** | Minor | EX-B “既知” examples are open-ended; closed evidence-derived definition would harden re-admission. |
| M-5 | Minor | **CONFIRMED** | Minor | `runConfigurationGate({ trialCount: 1 })` is API-level; no copy-paste shell path (overlaps I-3). |
| M-6 | Minor | **CONFIRMED** | Minor | §8.1 gates **N=10 開始前**; large P preflight can spend before that check. Magnitude small; wording fix is enough. |

---

## Additional findings

### [A-I1] EX-B re-entry weaker than repair-slow re-entry — **Important**

**Section**: §5.3 EX-B vs EX-R4-REPAIR-SLOW / KD-R1-6 / KD-R1-7

**Evidence**:
- EX-B re-entry: “同一 production harness 相当で **20s 未満**の closed-code 完了を新規証跡化” — **no n minimum**, no p95, threshold is the full production abort budget.
- EX-R4-REPAIR-SLOW (already weak per I-4): at least states n≥1 and a 12s headroom constant.

**Attack / failure scenario**:
1. Historical class-B ID (e.g. flash band from 第1/第2) gets one closed-code completion at 19.5s under light load.
2. Re-entry satisfied; ID enters shortlist and possibly 2-ID configs.
3. N=10 under normal load reproduces ~20s abort (same class as evidence 第1/第2).

**Impact**: Re-admits the largest historical failure class with a **weaker** bar than repair-slot re-entry. Burns hard-limit budget; undermines “class B に強い反証” narrative in §2.3 / KD-R1-6.

**Required fix** (align with tightened I-4):
- Normative **n≥3** (or n≥5), all samples or p95 **well under 20s** (recommend same 12s headroom if ID may sit in any send slot), production harness + official base + same `menuResponseFormat` path.
- Prefer closed evidence set definition (primary M-4) so “known B” is not illustrative-only.

### Additional search performed (no further Important/Critical)

| Area | Result |
|------|--------|
| Ship without N=10 / recombine / env update on 0 PASS | Design §3.2, §5.7, §5.8.2, §17 — closed; matches closeout P0 |
| Must LOCK table vs parent §4.1 / §5 / §4.4.2 | Quotas, 20s/50s/22s, AND, $0.50, official base, no free/router — preserved |
| `recommendedConfiguration = passedConfigurations[0]` | Code L342–344; KD-R1-12 — aligned |
| Live gate filters config union only | Code L279–312 — design correctly separates Stage 1 full catalog from live refilter |
| Set equality freeze | Proposed in R1; **not** in current test — design gap only until PR-R1-2 |
| `cardinality_waiver` silent ship | Still requires N=10; waiver without approver forbidden — residual exploration reduction only |
| Privacy / secrets in evidence | Allowed fields match harness closed codes; keys/prompt/raw forbidden |
| U_hi $0.01/send vs parent §6.3 $/generation | Conservative send approximation; not a lock break |
| Parent §4.4 exact 3 configs | R1 job is to replace post-failure; does not reopen wire/adapter (response-format already shipped) |
| Hard-limit C=6 full 2-ID ~$1.20 > $1 | KD-R1-13 / §8.1 table correct; blocks past optimistic trap |

No additional Critical found.

---

## Net blocking list (Critical + Important that remain CONFIRMED or UPGRADED)

| ID | Final severity | One-line fix target |
|----|----------------|---------------------|
| **I-1** | Important | Complete catalog enumeration (paginate or Stage-1-only higher budget) + completeness fail-closed; do not equate “same as bench chat caps” with full-pool proof |
| **I-2** | Important | Split ID exclusions vs configuration constraints; state repair-slow IDs **may** be on shortlist; machine-ban as `configuration[1]` in §5.5.1 + freeze test |
| **I-3** | Important | R1-required (not optional polish) CLI/runbook one-liner **or** constants-PR-only eligible set before live N=10; forbid temp source edits |
| **I-4** | Important | Normative n≥3 (or ≥5) + p95/max &lt; 12_000 for repair re-entry |
| **I-5** | Important | Normative decision-record template (L/S/J/C ordinals + evidence checkboxes + pair rationale codes / rejected pairs); freeze shortlist needs named approver on disagreement |
| **I-6** | Important | Committed survivor artifact + freeze/review assert frozen IDs ⊆ survivors (optional models_response_sha256 / entry_count) |
| **A-I1** | Important | EX-B re-entry: minimum sample size + headroom; closed “known B” definition (with M-4) |

**Critical: 0**  
**Important (blocking): 7**  
**Minor (non-blocking, fix in same revision pass): I-7-downgraded + M-1…M-6**

---

## What primary got right / overstated

### Got right
1. **Ship path discipline** is real: N=10 only, no recombine, 0 PASS → no env/README/deploy — matches closeout and parent §4.4.2.
2. **Locks preserved** in Must LOCK / Non-Goals.
3. **Code alignment** on `recommendedConfiguration`, union-only live filter, early unit abort, `main` always full frozen configs — re-verified against `benchmark-paid-openrouter-models.mjs`.
4. **KD-R1-11 set equality** correctly targets document/code drift the freeze test does not yet catch.
5. **KD-R1-13 full-pass hard-limit** correctly rejects optimistic unit-1 estimates (C=6 vs $1).
6. **I-1…I-6** are genuine procedure holes, not pedantry; Stage 1 is R1’s new selection surface and is under-specified relative to the ship clauses.
7. **No Critical ship hole** assessment is correct — REVISE for Important tightening is the right bar.

### Overstated / nuance
1. **I-7 as Important** — overstated; intentional optional preflight with hard-limit bound → **Minor**.
2. **I-5 “two operators same shortlist”** — design never promised identical operator outcomes; still Important for **reviewable** freeze records, not for bit-identical shortlists.
3. **I-1 “cannot complete today”** — 第2 “全 40 本” shows enumeration can succeed under some tooling; the defect is **missing complete-enumeration / fail-closed procedure**, not proven current impossibility under 1 MiB every day.
4. **Severity count 7 Important** — after secondary: **6 primary Important confirmed + 1 additional (A-I1)**; primary’s I-7 drops out of the blocking list.

### Strengths of the design (secondary agrees with primary’s Strengths list)
Ship-only-on-N=10; lock table; recommendation = first PASS in eval order; Stage 1 vs live filter separation; no R4-identical mandatory configs; PR-R1-1/2 simultaneous merge; privacy field limits; honest residual J-axis risk → R2.

---

## Residual risks if Important list is fixed

| Residual | Notes |
|----------|--------|
| 0/N on J-axis again | Dominant product risk; design admits R2; not an R1 silent-ship hole |
| cardinality_waiver | Reduces exploration; still no ship without N=10 if Open Q #6 names approver |
| Catalog drift snapshot→gate day | Live union refilter fail-closed — acceptable |
| U_hi underestimates true send cost | Operational; key hard limit is last resort |

---

## Final one-paragraph verdict

**REVISE** — secondary confirms primary’s overall call: **0 Critical**, **7 Important blocking** (I-1…I-6 confirmed; I-7 downgraded to Minor; **A-I1** added for weak EX-B re-entry). Do not human-approve or write the implementation plan until the design (and runbook/CLI notes for executable eligible-set / catalog completeness) absorbs the net blocking list. Minors can land in the same revision pass.
