# Paid-plan Stripe — Plan review secondary verification

| Item | Value |
|------|-------|
| Worktree | `/home/dev/projects/kondate/.worktrees/feat-paid-plan-stripe` |
| Plan | `docs/archive/superpowers/plans/2026-07-29-paid-plan-stripe.md` |
| Design | `docs/archive/superpowers/specs/2026-07-29-paid-plan-stripe-design.md` |
| Inputs | Cross-check + Adversarial plan reviews (2026-07-29) |
| Date | 2026-07-29 |
| Scope | Read-only secondary verification of **critical** and **major** findings for false positives |

**Verdict key**

| Verdict | Meaning |
|---------|---------|
| `CONFIRMED` | Finding is real against plan/design/live code |
| `PARTIALLY_CONFIRMED` | Core concern real, but severity/scope overstated or partly mitigated |
| `REJECTED` | False positive or already adequately covered |
| `DUPLICATE` | Same root defect as another canonical id |

**Must_fix** = plan (or paired design diagram, if noted) must change before Task-following implementers ship past the affected Task.

---

## Executive summary

| Source | Critical open | Major open | Confirmed / partial | Rejected | Duplicate |
|--------|--------------:|-----------:|--------------------:|---------:|----------:|
| Cross-check C1–C3, M1–M10 | 3 | 10 | 12 | 0 | 1 |
| Adversarial Issues 1–5, 6–15, 27 | 5 | 11 | 14 | 0 | 3 |
| **Unified must_fix (deduped)** | | | | | **18** |

Both reviews are directionally correct: the plan is **not implementation-ready** as written. No critical finding was rejected. The strongest independent new blocker from adversarial (not fully stressed as critical in cross-check) is **billing write RPC surface (ADV-1)**.

---

## Cross-check findings (critical + major)

### C1 — `generationQuotaSchema` / status + repository stay Free-literal-3

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Live `shared/contracts/generation.ts:775–783`: `remaining.max` and `userDailyLimit: z.literal(releaseQuota.userDailySuccessLimit)` (=3). Live `generation-repository.ts:104` `user_daily_limit: z.literal(releaseQuota.userDailySuccessLimit)`. Plan Task3 modifies `usageTodayDataSchema` only (`plan` L565–579, L586–612); plan grep has **zero** hits for `generationQuotaSchema`. |
| **Notes** | Plus remaining 4–10 or `userDailyLimit: 10` fails Zod → 500. Canonical with ADV-2. |

### C2 — E2E Function allowlist never updated for billing/flyer

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Live `tools/e2e-function-server.mjs:5–25` closed list ends at `delete-account.ts`; comment says unlisted paths → E2E **404**. Plan Task4/7/8 File maps and E2E steps never mention `e2e-function-server.mjs` / `.test.mjs`. Task8 scenarios require checkout/entitlement/mock webhook. |
| **Notes** | Canonical with ADV-5. |

### C3 — Quality/flyer fail·stale·account-delete release symmetry under-specified

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Design §原子的 multi-ledger L669–672: fail/timeout/stale/account delete must return reserved on identity success/attempt, quality day/month, flyer success/try, global. Design interface table L1153 lists “release/finalize 対称”. Plan Task6 focuses reserve + concurrent partial rollback comment; Task7 S8/S9 path; Task8 only `release_identity_and_global_for_user_processing` + Stripe cancel. Plan grep: **no** `release_request_quota_reservations` / finalize extension for quality|flyer. Live release helper is `private.release_request_quota_reservations` in `20260728150000` (identity/global only). |
| **Notes** | Severity **critical** is justified (orphan reserved → permanent under-quota). ADV-7 is the same root; adversarial severity major is under-ranked. |

### M1 — `db:types` with `--no-deps`

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Plan Task2 Step5 L533: `docker compose run --rm --no-deps app npm run db:types`. `scripts/generate-database-types.sh:7` defaults to `http://meta:8080/...`. CLAUDE.md: `--no-deps` only for stack-independent work. Canonical docs use `docker compose run --rm app npm run db:types` (with deps). |
| **Notes** | Related ADV-24 (minor typegen ambiguity). |

### M2 — Dual-subscription cancel + unmapped webhook alert under-tasked

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Design L518 dual-sub cancel newer + L527 unmapped 200 + required alert; design Vitest list L1218 includes dual-sub. Plan Task4 RED L985–1010: stale, same-second, past_due_since, trial, signature, idempotent, checkout lock — **no** dual-sub, **no** unmapped/alert. |
| **Notes** | Subset of ADV-10. |

### M3 — L10 funnel item 6 (post-success weekly flyer upsell) missing

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Design L10-6 L49 + copy table #6 L977: after menu success, Free, once/JST week, `flyer_upsell_week=YYYY-Www`. Plan Task5 fixed copy table L1162–1168 omits #6; Task7 is locked preview/upload only; plan claims “L10 → Task5” (L1740). |
| **Notes** | Product lock L10 incomplete if omitted. |

### M4 — SafeLog / observability allowlist absent

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Design Issue 16 / §可観測性 L1072–1097: extend SafeLog with `plan`, `billing_status`, `price_interval`, `quality_mode`, `flyer`; forbid email/filename/image hash; metrics including unmapped alert. Live `netlify/functions/_shared/logger.ts` SafeLogEvent has no billing fields. Plan: zero hits for SafeLog / logger / SafeLogEvent. |
| **Notes** | Without allowlist, ad-hoc logs risk PII or required codes never land. |

### M5 — Task3 verifies missing `billing-entitlement.test.ts`

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Plan Task3 Step9 L864 runs `netlify/functions/_shared/billing-entitlement.test.ts`. Task3 Files L559–570 Create only `billing-entitlement.ts` (implementation); no RED step authors the test file. Task4 Files L902 allow `_tests/billing-*.test.ts` or `_shared/*.test.ts`. |
| **Notes** | Process/plan internal contradiction; A6 unit may be improvised. |

### M6 — Design sequence `priceInterval` vs routes/plan `interval`

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** (design diagram vs routes; **plan is correct**) |
| **Must_fix** | **plan: no** / **design diagram: yes** |
| **Evidence** | Design sequence L365: `{priceInterval}`; design routes table uses `interval`; plan L913/L1028 consistently `{ interval: "month" \| "year" }`. |
| **Notes** | Not a plan defect. Implementers who only read the sequence diagram can still wire the wrong field — fix design mermaid. |

### M7 — File map wrong path for regeneration sheet

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** (cosmetic but agent-trap) |
| **Evidence** | Plan File map L91: `src/features/history/regeneration-sheet.tsx`. Live + Task5 L1152: `src/features/history/components/regeneration-sheet.tsx`. |
| **Notes** | Task5 path is correct; File map only is wrong. |

### M8 — Quality success must also consume normal success ledger (explicitness)

| Field | Value |
|-------|--------|
| **Verdict** | **PARTIALLY_CONFIRMED** |
| **Must_fix** | **yes** (plan wording; low LOC) |
| **Evidence** | Design lock L1242: 「品質成功は通常 success も消費」; atomic table L660 quality = standard ledgers **+** quality day/month. Plan Task6 SQL sketch L1354–1356 only mentions quality day/month gates + rollback of identity reserved; does not restate co-consumption of normal success. |
| **Notes** | Not a silent design omission — design is clear. Task text alone invites quality-only counter bugs. |

### M9 — Task1 `git add` omits `free-tier.test.ts`

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Task1 Files L121 Modify `shared/copy/free-tier.test.ts`. Step8 git add L342 omits that path. |
| **Notes** | Same as ADV-21 (adversarial ranked minor; process gap is real). |

### M10 — Mid-PR `usageToday` / status consumers risk (related to C1)

| Field | Value |
|-------|--------|
| **Verdict** | **PARTIALLY_CONFIRMED** / **DUPLICATE** of **C1** + **ADV-6** + **ADV-15** |
| **Must_fix** | covered by those |
| **Evidence** | Plan stages schema intentionally (Task3 →6 →7) and says update fixtures at Task3 (L584). Gap is incomplete consumer/file enumeration (status API, usage-today merge, later factories), not the staging strategy itself. |
| **Canonical** | C1, ADV-6, ADV-15 |

---

## Adversarial findings (critical + major)

### ADV-1 — Webhook/Checkout cannot write billing tables under stated grants

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Plan Task2 L440–446 revokes **all** privileges on five `private.billing_*` tables from `service_role` and comments only SECURITY DEFINER owner DML. Only write-capable RPC produced: **none** — only `get_billing_entitlement_for_user` (read). Task4 implements Checkout/Portal/Webhook upserts with no write RPC list. Live pattern: private ledgers are `service_role: none` (`docs/testing/database-access-matrix.md`); Netlify Functions use `getSupabaseAdmin().rpc(...)` for private control plane, not direct table DML. |
| **Notes** | Cross-check under-weighted this (not in C1–C3). **Highest new blocker.** Without write RPCs (or an explicit, matrix-approved alternative), Task4 cannot persist entitlement. |

### ADV-2 — `generationQuotaSchema` left Free-literal

| Field | Value |
|-------|--------|
| **Verdict** | **DUPLICATE** of **C1** |
| **Must_fix** | yes (via C1) |
| **Canonical** | C1 |

### ADV-3 — v3 command migration omits browser command builders

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Live v2 producers: `src/features/planner/planner-route.tsx:215`, `src/features/history/hooks/use-regeneration.ts:75/110`, `src/features/generation/api/generation-api.ts`, `src/features/generation/model/pending-generation.ts` (v2-only Zod), plus many tests asserting `generation-command.v2`. Plan Task6 Files L1261–1280: schema/integrity/repository/openrouter/env/UI トグル — **no** enumeration of those producers. L12 + SQL reject non-v3 after cutover. |
| **Mitigation noted** | Task6 Step7 full `typecheck` will force many client edits if `generationCommandVersionV2` is removed — partial safety net, **not** a substitute for Files + RED checklist. |
| **Notes** | Critical for Task-following implementers and incomplete PR merges. |

### ADV-4 — Existing pgTAP/signature inventory not in Task3 file set

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Plan Task3 creates only `plan_aware_quota.test.sql` but runs full `db-test`. Live hard-locks: `rls_inventory.test.sql:276` full old `reserve_ai_generation(...)` arg list; `identity_daily_quota.test.sql` EXECUTE signature text; `ai_control_and_quota.test.sql` has_function / call sites; `ai_control_and_quota_races.test.sql` many call sites; `user_feedback.test.sql` usage inventory (per review). New params `p_attempt_limit`, `p_short_window_limit` (later quality) break signatures. |
| **Notes** | GREEN “db-test PASS” as written is false. |

### ADV-5 — E2E allowlist omits billing/flyer

| Field | Value |
|-------|--------|
| **Verdict** | **DUPLICATE** of **C2** |
| **Must_fix** | yes (via C2) |
| **Canonical** | C2 |

### ADV-6 — usage-today response merge of `plan`/`plusEntitled` unspecified

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Live `usage-today.ts:21–53` parses RPC JSON **directly** with `usageTodayDataSchema.parse(data)`; AI_QUOTA_DISABLED rebuild omits any plan fields. Plan Task3 schema **requires** `plan` + `plusEntitled` (L590–591). Step7 L842 only: “entitlement + limits を RPC 引数へ” — no merge algorithm. SQL `get_ai_usage_today` is described as accepting limit params, not returning plan fields. |
| **Notes** | After Task3 schema change, every `GET /api/usage/today` can 500. Free-force via kill is OK; **response shape is not**. |

### ADV-7 — Quality/flyer release symmetry

| Field | Value |
|-------|--------|
| **Verdict** | **DUPLICATE** of **C3** (severity should be **critical**) |
| **Must_fix** | yes (via C3) |
| **Canonical** | C3 |

### ADV-8 — `status()` / repository still Free env limit

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Live `generation-repository.ts:373–378` `status()` passes `p_user_limit: env.openRouter.userDailyLimit` (Free-locked). Plan Step5 SQL comment mentions status global 1..200; Step7 `buildReserveArgs` only sketches reserve path. Plus remaining projection mismatches reserve. |
| **Notes** | Strongly coupled to C1 wire schema. |

### ADV-9 — trial_history `identity_key` write path unspecified

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Design trial table PK `identity_key` (email HMAC). A7 insert on first trialing\|active. Plan tests assert insert (L1000) but never specifies: user_id → admin email → `computeQuotaIdentityKey` → insert; nor Checkout pre-read of trial history via same helper. |
| **Notes** | Without this, A7 is implementable only by guessing. |

### ADV-10 — Missing abuse RED coverage required by design

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Design webhook adversarial list includes dual-sub, unmapped 200, delayed active after terminal, kill webhook continues. Plan has good stubs for subset (stale, same-second, trial, lock, Free quality, flyer success-full) but lacks dual-sub, unmapped, delayed re-entitle, A3 integration (checkout 503 + webhook upsert), and strong Free quality ledger non-mutation. |
| **Notes** | Superset of M2. |

### ADV-11 — Identity CHECK drop naming weaker than prior pattern

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Live identity tables use table-level unnamed `check (...)` (`20260728150000` L22/L32). Plan L698–706 hard-codes `ai_identity_daily_usage_check` / `…_external_attempts_check`; only rate_windows get DO/`pg_get_constraintdef` discovery (L731–748). Prior upgrade `20260726225640` used definition-regex discovery for quota CHECKs. |
| **Notes** | If auto-name differs, old ≤3/≤6 CHECK remains → Plus reserve fails. Cross-check m3 (minor) is the same issue; major is appropriate given migration fail-closed risk. |

### ADV-12 — `sharp` native binary Docker ≠ Netlify Functions

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Plan Task7 install via app image; Placeholder scan L1768 notes “native は app コンテナ内”. Production flyer is Netlify Functions (AWS Linux). No bundler externalization / CI import smoke. Cross-check m9 minor under-ranks deploy break risk. |
| **Notes** | Must lock Netlify packaging strategy before Task7 GREEN. |

### ADV-13 — `STRIPE_API_VERSION` free-floating placeholder

| Field | Value |
|-------|--------|
| **Verdict** | **PARTIALLY_CONFIRMED** |
| **Must_fix** | **yes before Task4 RED** (not a logic falsehood) |
| **Evidence** | Plan env test L968 placeholder + Placeholder scan L1767 explicitly defers lock to implement-time Dashboard string. Not a silent omission — still leaves implementers without a single pinned value in plan text. |
| **Notes** | Do not block Tasks 1–3; block Task4 start until one string is written into plan/env/example. |

### ADV-14 — GLOBAL 20→200 incomplete caller/test matrix

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Plan updates `globalDailyLimit(200)` (L848). Live `env.test.ts:189–190` `it.each(["0","21"])` rejects out-of-range — **21 becomes valid** after max 200 unless updated. Fixtures use `globalDailyLimit: 20` in repository/usage-today tests (OK as local value; max rejection tests are not). SQL repair/status bounds must move with reserve. |
| **Notes** | compose local default 20 remains OK. |

### ADV-15 — Phased quality/flyer fixtures not listed on Task6/7

| Field | Value |
|-------|--------|
| **Verdict** | **CONFIRMED** |
| **Must_fix** | **yes** |
| **Evidence** | Task3 lists `shared/testing/factories.ts`. Task6/7 require `quality` / `flyerWeekly` on `usageTodayDataSchema` but Files omit factories, usage-today tests, UI mocks. Typecheck/unrelated suites will fail. |
| **Notes** | Staging strategy is sound; file lists are incomplete. |

### ADV-27 — Order / partial-merge safety aggregate

| Field | Value |
|-------|--------|
| **Verdict** | **DUPLICATE** of ADV-1, ADV-3, C2/ADV-5 (and related) |
| **Must_fix** | via components |
| **Canonical** | ADV-1, ADV-3, C2 |

---

## Cross-source mapping (dedupe)

| Topic | Cross-check | Adversarial | Secondary canonical |
|-------|-------------|-------------|---------------------|
| generationQuotaSchema Free literal | C1 | ADV-2 | **C1** |
| E2E allowlist | C2 | ADV-5 | **C2** |
| Release symmetry quality/flyer | C3 | ADV-7 | **C3** |
| Billing write RPCs | (missed as critical) | ADV-1 | **ADV-1** |
| v3 client cutover files | — | ADV-3 | **ADV-3** |
| pgTAP signature consumers | — | ADV-4 | **ADV-4** |
| usage-today plan merge | M10 partial | ADV-6 | **ADV-6** |
| status() Free env | M10/C1 related | ADV-8 | **ADV-8** |
| dual-sub + unmapped tests | M2 | ADV-10 subset | **ADV-10** (includes M2) |
| trial identity_key path | — | ADV-9 | **ADV-9** |
| db:types --no-deps | M1 | ADV-24 minor | **M1** |
| L10-6 flyer upsell | M3 | — | **M3** |
| SafeLog allowlist | M4 | — | **M4** |
| billing-entitlement.test missing | M5 | — | **M5** |
| priceInterval diagram | M6 | — | design-only fix |
| regeneration-sheet path | M7 | — | **M7** |
| quality co-consumes success | M8 | — | **M8** |
| free-tier.test git add | M9 | ADV-21 minor | **M9** |
| Identity CHECK discovery | m3 minor | ADV-11 | **ADV-11** |
| sharp/Netlify | m9 minor | ADV-12 | **ADV-12** |
| STRIPE_API_VERSION | Placeholder OK note | ADV-13 | **ADV-13** |
| GLOBAL 200 test matrix | — | ADV-14 | **ADV-14** |
| Task6/7 fixture lists | M10 | ADV-15 | **ADV-15** |

---

## Minors worth fixing in the same plan pass

Worth bundling while editing the plan (low cost, reduces implementer drift):

1. **CC-m3 / ADV-11** — already major above; use DO discovery for identity CHECKs.
2. **CC-m9 / ADV-12** — sharp/Netlify note (major above).
3. **ADV-16** — grep `formatFreeTierQuotaCopy` → `formatPlanQuotaCopy` at all user-facing sites + Plus copy test.
4. **ADV-17** — promote webhook dual-sub + checkout lock TTL (30 min) from design into Task4 copy-paste blocks.
5. **ADV-18** — expand Task2 pgTAP case table (past_due NULL already comment-only).
6. **ADV-19** — runtime: map RPC JSON only; TS `computePlusEntitled` for unit parity only.
7. **ADV-20** — ISO-normalize timestamptz from entitlement RPC before Zod.
8. **ADV-22** — Task5 note: browser only `/api/billing/*`; no Price IDs / publishable misuse.
9. **ADV-23** — align `package.json` `"db:test"` with `--profile test` (plan command is already correct).
10. **ADV-24 / M1** — single canonical typegen command without `--no-deps`.
11. **CC-m1** — design PR5 vs plan Task5 issueMessages deferral (plan clearer; optional design table tweak).
12. **CC-m5** — Portal Dashboard ops checklist runbook checkbox.
13. **CC-m8** — optional `flyer_weekly_requests` only if C3 needs a row flag (do not invent unless release symmetry requires it).

Nits **not** required in same pass: ADV-25 (response content string-only), ADV-26 (Plus formatPlanQuotaCopy no-op arms).

---

## Unified must_fix list (deduped, severity order)

### Critical (merge / Task blockers)

1. **ADV-1** — Specify service_role-only SECURITY DEFINER **write RPCs** (or equivalent matrix-approved write surface) for billing customers/subscriptions/webhook_events/trial_history/checkout_locks; list in Task2/4 Files, Produces, access matrix, pgTAP grants. Do not leave Task4 to invent direct DML after Task2 REVOKE ALL.

2. **C1 / ADV-2** — Task3: widen `generationQuotaSchema` + repository `user_daily_limit` Zod to Free|Plus (3|10 / max 10); RED for Plus status wire.

3. **ADV-3** — Task6: enumerate **all** `generation-command.v2` producers/consumers under `src/` (planner-route, use-regeneration, generation-api, pending-generation, recovery/page tests, etc.); require simultaneous client cutover + `qualityMode: false` default; grep gate no remaining v2 under src/netlify/shared.

4. **ADV-4** — Task3 (and Task6 when quality param lands): list every signature-sensitive pgTAP file (`rls_inventory`, `identity_daily_quota`, `ai_control_and_quota`, `ai_control_and_quota_races`, `user_feedback`, …); update grants inventory + call sites before db-test green.

5. **C2 / ADV-5** — Task4 add billing Function modules to `tools/e2e-function-server.mjs` (+ unit test); Task7 add `flyer-weekly`; Task8 depends on both. Document mock webhook injector path as concrete files.

6. **C3 / ADV-7** — Task6/7/8: extend `release_request_quota_reservations` / finalize / stale cleanup / account release for quality + flyer **reserved**; pgTAP reserve-then-fail → reserved back to 0. Align severity with design A4 release symmetry.

### Major (wrong behavior / silent lock omission / false GREEN)

7. **ADV-6** — Task3: spell usage-today algorithm: loadEntitlement → applyQuotaPlan → RPC limits → map → **attach plan/plusEntitled** → parse; fix AI_QUOTA_DISABLED projection; RED on `usage-today` tests.

8. **ADV-8** — Task3: `status()` / repair global bounds use plan limits or snapshots consistently with reserve (repair stays snapshot-only for short/quality per design).

9. **ADV-10** (includes **M2**) — Task4 named RED: dual-sub cancel, unmapped 200+`billing_user_unmapped` alert, delayed active after canceled/past_due/deleted no re-entitle, A3 checkout-closed/webhook-up integration; Task6 Free quality does not mutate quality ledgers.

10. **ADV-9** — Task4 algorithm: resolve identity_key via admin email + `computeQuotaIdentityKey` for trial_history + Checkout trial pre-read.

11. **ADV-11** — Task3 migration: DO/`pg_get_constraintdef` discovery for identity usage/attempts CHECKs (match Plan 8 / rate_windows pattern).

12. **ADV-12** — Task7/8: Netlify Functions packaging for `sharp` (or pure decode alternative) + import/build smoke.

13. **M1** — Fix Task2 typegen command: `docker compose run --rm app npm run db:types` (stack up; no `--no-deps`).

14. **M3** — Task5: L10-6 post-success flyer upsell copy + `localStorage` key `flyer_upsell_week=YYYY-Www`.

15. **M4** — Task4/8 (or shared Task): extend `logger.ts` SafeLog allowlist + required billing codes/metrics (design Issue 16).

16. **M5** — Task3 Files + RED: create `billing-entitlement.test.ts` (single path convention with Task4).

17. **ADV-14** — Task3 checklist: update env max-rejection tests (`21` no longer invalid), repair/status SQL 1..200, document local default 20 vs max 200.

18. **ADV-15** — Task6/7 Files: factories + usage-today tests + UI mocks for required `quality` / `flyerWeekly`.

19. **ADV-13** — Before Task4 RED: lock one `STRIPE_API_VERSION` string in plan + `.env.example` + env tests (procedure already exists; fill the value).

20. **M7** — File map: `src/features/history/components/regeneration-sheet.tsx`.

21. **M8** — Task6 text: restate quality reserve co-consumes normal identity success/attempt (+ quality day/month) in same TX.

22. **M9** — Task1 `git add` include `shared/copy/free-tier.test.ts`.

### Explicit non-plan must_fix

- **M6** — Fix design mermaid `priceInterval` → `interval` (plan already correct).

---

## Rejected

None of the critical/major findings were rejected as false positives.

---

## Overall readiness

**Request changes before implement** — confirmed. Until **ADV-1, C1, ADV-3, ADV-4, C2, C3** are written into the plan, do not dispatch Implementer on Task2+ as a pure Task-follower.

---

*Read-only secondary verification. Plan/design/code not modified except this report and the `/tmp/grok-1000` copy.*
