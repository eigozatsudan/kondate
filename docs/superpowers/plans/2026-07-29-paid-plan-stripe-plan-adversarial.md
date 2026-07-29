# Plan Adversarial Review: paid-plan-stripe

**Plan:** `docs/superpowers/plans/2026-07-29-paid-plan-stripe.md`  
**Design:** `docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md`  
**Inventory:** `/tmp/grok-1000/paid-plan-codebase-inventory.md`  
**Worktree:** `/home/dev/projects/kondate/.worktrees/feat-paid-plan-stripe`  
**Review type:** implementation-plan adversarial (not product redesign)  
**Date:** 2026-07-29  

---

## Summary

**Verdict: request changes before implement (not implementation-ready).**

The plan is strong on product locks (A1–A11), migration stamp ordering after `20260729120000`, Docker/`db-test` invocation shape, fail-closed entitlement, kill-switch webhook continuity, and phased `usageTodayDataSchema` fields. It is **not** safe for a Task-following implementer to execute as written: several paths contradict existing private-schema / RPC / e2e / wire-schema patterns and will produce red suites or production-broken partial merges.

| Severity | Open count |
|----------|------------|
| critical | 5 |
| major | 10 |
| minor | 8 |
| nit | 3 |
| **total open** | **26** |

---

## Issue 1: Webhook/Checkout cannot write billing tables under stated grants

- **Severity:** critical
- **Section:** Task 2 / Task 4
- **Description:** Task 2 revokes **all** privileges on the five `private.billing_*` tables from `public, anon, authenticated, service_role` and comments that only SECURITY DEFINER owner paths may DML. It produces only `get_billing_entitlement_for_user` (read). Task 4 implements Checkout/Portal/Webhook that must insert/update `billing_customers`, `billing_subscriptions`, `billing_webhook_events`, `billing_trial_history`, `billing_checkout_locks` — but never defines write RPCs or alternative access.  
  Current codebase pattern is unambiguous: Netlify Functions touch private ledgers **only** via `getSupabaseAdmin().rpc(...)` (see `generation-repository.ts`, `usage-today.ts`, `delete-account.ts`). Private tables are documented as `service_role: none` + SECURITY DEFINER only (`docs/testing/database-access-matrix.md`). An implementer following Task 4 literally will either (a) invent forbidden direct DML that fails at runtime, or (b) silently re-grant service_role table rights, violating the plan’s own revoke text and access-matrix intent.
- **Suggestion:** In Task 2 or 4, specify service_role-only SECURITY DEFINER RPCs (or a single `upsert_billing_subscription_from_stripe` + lock/trial helpers) covering: customer ensure, ordered subscription upsert, webhook event insert, trial_history insert-on-conflict, checkout lock insert/release. List them in File map, Produces, access matrix, and pgTAP EXECUTE grants. Do not leave “write somehow from Functions” implied.
- **Status:** open

---

## Issue 2: `generationQuotaSchema` / generation status quota wire left Free-literal

- **Severity:** critical
- **Section:** Task 3 / Global (lens 11)
- **Description:** Task 3 upgrades `usageTodayDataSchema` to 3|10 / 6|20 / 4|8 and plan-aware reserve args, but **does not** change `generationQuotaSchema` in `shared/contracts/generation.ts` (today: `remaining` max = Free 3, `userDailyLimit: z.literal(3)`). Generation status / success responses flow through this schema (`generation-service.ts` builds `userDailyLimit` from row or Free fallback). After Task 4 enables `BILLING_ENABLED=true` and Plus limits apply, a Plus user with remaining 4–10 (or `userDailyLimit: 10`) will fail Zod at the wire boundary → user-visible 500s. Inventory already flags this class of literal-lock risk for usage-today; the plan only remediates half of it.
- **Suggestion:** Task 3 must also revise `generationQuotaSchema` (and any RPC projection of `user_daily_limit`) to accept Free|Plus success ceilings, update status fixtures/tests, and wire `get_ai_generation_status` / repository `status()` with entitlement-derived limits (not `env.openRouter.userDailyLimit` alone).
- **Status:** open

---

## Issue 3: v3 command migration omits browser command builders (in-flight v2)

- **Severity:** critical
- **Section:** Task 6 (lens 8)
- **Description:** Task 6 replaces `generation-command.v2` with v3 + `qualityMode`, truncates processing rows, and updates integrity HMAC — but **Files** only vaguely mention UI toggle, not the many hard-coded v2 producers:  
  - `src/features/planner/planner-route.tsx`  
  - `src/features/history/hooks/use-regeneration.ts`  
  - `src/features/generation/api/generation-api.ts` (+ tests)  
  - `src/features/generation/model/pending-generation*.ts`  
  - recovery/page tests still asserting `generation-command.v2`  
  SQL still rejects non-v2 HMAC until Task 6 rewrites the check (`20260728150000` L246–249). If Task 6 lands server-only, **all generation breaks** for real clients. L12 “no backward compat” requires a simultaneous client cutover, which the plan does not enumerate or RED-test.
- **Suggestion:** Expand Task 6 Files + RED steps to every `commandVersion: "generation-command.v2"` call site (grep-driven checklist). Require `qualityMode: false` default on all paths; typecheck/tests for planner, regeneration, pending storage, and generation-api must pass in the same Task. Optionally add a Task-local “v2 string must not remain under src/ netlify/ shared/” gate.
- **Status:** open

---

## Issue 4: Existing pgTAP/signature inventory not in Task 3 file set

- **Severity:** critical
- **Section:** Task 3 (lens 12 / lens 14)
- **Description:** Task 3 changes `reserve_ai_generation` signature (adds `p_attempt_limit`, `p_short_window_limit`, later quality) and global 1..200, and runs full `docker compose --profile test run --rm db-test`. It only creates `plan_aware_quota.test.sql`. Existing suites hardcode the **current** signature and will fail red:

  | File | Hard-lock |
  |------|-----------|
  | `supabase/tests/database/rls_inventory.test.sql` | full `reserve_ai_generation(...)` arg list without new params |
  | `supabase/tests/database/identity_daily_quota.test.sql` | EXECUTE signature text + calls |
  | `supabase/tests/database/ai_control_and_quota.test.sql` | `has_function` / old overload absence checks |
  | `supabase/tests/database/ai_control_and_quota_races.test.sql` | grant + many `reserve_ai_generation` call sites |
  | `supabase/tests/database/user_feedback.test.sql` | `get_ai_usage_today` overload inventory |

  Implementers who only follow Task 3’s Files list will not update these; GREEN “db-test PASS” is false as written.
- **Suggestion:** Explicitly list every signature-sensitive pgTAP file under Task 3 (and Task 6 when `p_quality_mode` is added). Provide a “signature matrix” step: update grants inventory + all call sites before claiming db-test green.
- **Status:** open

---

## Issue 5: E2E allowlist omits billing/flyer Functions

- **Severity:** critical
- **Section:** Task 4 / Task 7 / Task 8 (lens 9)
- **Description:** Local E2E serves Functions only from an explicit closed list in `tools/e2e-function-server.mjs` (comment: paths not listed → **404**). List currently ends at `delete-account.ts`; no `billing-*`, no `flyer-weekly`. Task 4/7/8 File maps and E2E steps never mention updating `e2e-function-server.mjs` / `e2e-function-server.test.mjs`. Task 8 scenarios (checkout, entitlement after mock webhook, settings billing) cannot work against the e2e proxy as planned.
- **Suggestion:** Task 4 must add billing four routes to the allowlist + unit test for path registration. Task 7 adds `flyer-weekly`. Task 8 depends on both. Document webhook injection path (mock base vs e2e injector) as concrete files, not “skeleton”.
- **Status:** open

---

## Issue 6: Task 3 entitlement claim vs Task 4 missing — Free force is OK; response merge is not

- **Severity:** major
- **Section:** Task 3 (lens 7)
- **Description:** Task 3 correctly defaults `billingEnabled` false and `applyQuotaPlan` → Free limits when kill/disabled, so missing Stripe UI does not grant Plus limits. RPC `get_billing_entitlement_for_user` exists after Task 2, so load is not “table missing” if order is respected. **However:** `usageTodayDataSchema` gains required `plan` / `plusEntitled`, while live `get_ai_usage_today` SQL returns only success/attempts/short/global today, and `usage-today.ts` does `usageTodayDataSchema.parse(data)` **directly** on RPC JSON (including the `AI_QUOTA_DISABLED` rebuild path that omits any new fields). Task 3 Step 7 says only “entitlement + limits を RPC 引数へ” and never specifies **merging** plan/plusEntitled (and later quality/flyer) in the Function layer. Partial Task 3 state: every `GET /api/usage/today` 500s after schema change.
- **Suggestion:** Spell out usage-today algorithm: loadEntitlement (503 fail-closed) → applyQuotaPlan → RPC with plan limits → map snake/camel → attach `plan`/`plusEntitled` → parse. Update `AI_QUOTA_DISABLED` projection to preserve those fields. Add RED test on `_tests/usage-today.test.ts` (file not currently listed).
- **Status:** open

---

## Issue 7: Quality/flyer release symmetry under-specified (orphan reserved risk)

- **Severity:** major
- **Section:** Task 6 / Task 7 (lens 2 / A4)
- **Description:** Design requires fail/timeout/stale/account-delete to release quality and flyer **reserved** ledgers. Task 6/7 RED/GREEN focus on reserve gates and Free 403; they do not require updating `private.release_request_quota_reservations`, `finalize_ai_generation_failure`, stale cleanup, or `release_identity_and_global_for_user_processing`. Without request flags / release branches, a quality reserve that fails post-reserve leaks reserved slots until manual repair — violating A4’s “partial reserved 残禁止” beyond the single TX rollback case.
- **Suggestion:** Task 6 must extend release/finalize/stale paths with pgTAP: quality reserve then fail → day/month reserved back to 0. Task 7 same for flyer success/try + any `flyer_weekly_requests` row. File map should include the identity migration’s release helper rewrite (full replace).
- **Status:** open

---

## Issue 8: `get_ai_generation_status` / repository `status()` still Free env limit

- **Severity:** major
- **Section:** Task 3
- **Description:** `generation-repository.ts` `status()` passes `p_user_limit: env.openRouter.userDailyLimit` (always Free 3 when env validates). Plan Step 5 mentions status global 1..200 in SQL comments but does not require repository status/repair paths to use `loadEntitlement` + plan limits / snapshots. Plus users get wrong remaining projection and possible mismatch with reserve.
- **Suggestion:** Explicit GREEN steps: `status()` uses same `limitsForPlan(applyQuotaPlan(...))` as reserve; repair keeps snapshot-only behavior (already design-correct for short/quality models) and only expands global max.
- **Status:** open

---

## Issue 9: trial_history `identity_key` write path from webhook unspecified

- **Severity:** major
- **Section:** Task 4 (A7)
- **Description:** A7/tests require `billing_trial_history` insert on first trialing|active webhook. Table PK is **identity_key** (email HMAC), not `user_id`. Webhook has Stripe objects + maybe `supabase_user_id`; it does not automatically have email. Plan never says: load auth user email via admin API → `computeQuotaIdentityKey` → insert. Checkout pre-read of trial history is also unspecified (who computes identity at Checkout).
- **Suggestion:** Task 4 algorithm box: resolve user_id → email (admin) → identity_key; fail-closed metrics if email missing; Checkout uses same helper before `trial_period_days`. Unit test identity insert without trusting client.
- **Status:** open

---

## Issue 10: Missing abuse RED coverage still required by design

- **Severity:** major
- **Section:** Task 4 / Task 6 / Task 7 (lens 2)
- **Description:** Plan has good RED stubs for stale webhook, same-second non-lex id, past_due_since, trial idempotency, checkout lock, Free quality, flyer success-full. Still missing explicit tests design calls mandatory:
  - delayed `active` after `canceled` / `past_due` / `deleted` must not re-entitle (design webhook adversarial unit list)
  - dual live subscriptions → cancel newer, keep older entitled (`billing_dual_subscription_canceled`)
  - unmapped user → 200 + `billing_user_unmapped` (not 500 retry storm)
  - `BILLING_ENABLED=false` + webhook secrets → checkout 503 but webhook upsert still runs (A3 integration, not only env parse)
  - Free `qualityMode:true` does not touch quality ledgers (partial: “before reserve” exists; ledger non-mutation assert weak)
- **Suggestion:** Promote design’s adversarial list into Task 4/6 named test cases (not comments).
- **Status:** open

---

## Issue 11: Identity CHECK drop naming may work; plan still weaker than prior migration pattern

- **Severity:** major
- **Section:** Task 3 (lens 12)
- **Description:** Identity tables use table-level `check (reserved_count + success_count <= 3)` which Postgres typically names `ai_identity_daily_usage_check`. Plan’s `drop constraint if exists ai_identity_daily_usage_check` is plausible, and rate windows get a proper `pg_constraint` discovery DO block. Prior upgrade migration `20260726225640` used **definition-regex** discovery for safety. If names differ (e.g. `_check1` after prior ops), Task 3 migration silently leaves old ≤3 CHECK → Plus reserve fails at insert. Raising ceilings does not need NOT VALID (rows already ≤3/≤6), so data risk is low; **name risk** remains.
- **Suggestion:** Use the same DO/`pg_get_constraintdef` discovery for identity usage/attempts as for rate windows (and as Plan 8 upgrade did). Avoid hard-coded constraint names alone.
- **Status:** open

---

## Issue 12: `sharp` native binary — Docker install ≠ Netlify Functions runtime

- **Severity:** major
- **Section:** Task 7 (lens 6 class / deploy)
- **Description:** Task 7 installs `sharp` via `docker compose run --rm --no-deps app npm install sharp --save-exact` and notes “native binding は app イメージ前提”. Production flyer runs on **Netlify Functions** (AWS Linux), not the Compose `app` image. Mismatched platform binaries or missing bundler external config commonly break deploy/runtime. Plan has no Netlify bundling/`sharp` externalization step or CI smoke.
- **Suggestion:** Pin sharp; document Netlify functions bundling (include native or use pure decode alternative); add a Function-level test that imports sharp in the same way production bundles; verify in Task 8 build. If Netlify support is uncertain, lock decode strategy in design-compatible way before implement.
- **Status:** open

---

## Issue 13: stripe SDK pin is fine for ESM; API version still a free-floating placeholder

- **Severity:** major
- **Section:** Task 4 (lens 6)
- **Description:** `stripe@22.3.2` exists as current npm latest and supports modern Node; package `"type": "module"` + `import Stripe from "stripe"` is the supported path — **not** an ESM blocker. However tests embed `STRIPE_API_VERSION: "2025-06-30.basil"` with comment “実装時にロックした版文字列に置換”. Account Dashboard API version mismatch causes subtle request failures. Plan admits placeholder in Placeholder scan but still leaves implementers without a single locked string or verification step.
- **Suggestion:** Before Task 4 RED, lock one API version string in the plan (or “read from stripe package default and pin env to that exact string” procedure) and use it in `.env.example`, env tests, and Stripe client factory. Fail parse if unset when billing secrets present.
- **Status:** open

---

## Issue 14: GLOBAL 20→200 incomplete caller/test matrix

- **Severity:** major
- **Section:** Task 3 / Task 8 (lens 11)
- **Description:** Plan updates `globalDailyLimit(200)`, preflight, and SQL 1..200 on main RPCs. Many call sites/tests still assume max/default 20 (`generation-repository.test.ts`, `usage-today.test.ts`, `env.test.ts` expectations, compose local `"20"`, repair path comments). compose keeping 20 for local is OK; **tests that assert max rejection at 21** or fixtures that assume schema max 20 will mislead. `reserve_ai_repair_call` / status global bounds must all move together or Plus traffic + ops 80 fails.
- **Suggestion:** Task 3 checklist: grep `between 1 and 20` / `globalDailyLimit: 20` / `GLOBAL_DAILY_AI_LIMIT` across migrations, functions tests, preflight, e2e reset helpers; update or explicitly keep local default 20 with max 200.
- **Status:** open

---

## Issue 15: Phased required `quality` / `flyerWeekly` will red intermediate consumers without listed fixture updates

- **Severity:** major
- **Section:** Task 6 / Task 7 (lens 3)
- **Description:** Plan correctly phases schema (Task3 plan only → Task6 quality required → Task7 flyerWeekly required). Each phase **requires** bulk fixture updates (`shared/testing/factories.ts`, usage-today tests, UI mocks). Task 6/7 Files do not list factories / usage-today tests / planner mocks. Implementers will pass narrow RED samples and fail typecheck or unrelated suites.
- **Suggestion:** Each schema-expanding Task must include “update all `UsageTodayData` fixtures” as a mandatory step with grep gate.
- **Status:** open

---

## Issue 16: Task 5 before quality/flyer — OK; copy may still call Free prefix for Plus after Task 3–4

- **Severity:** minor
- **Section:** Task 5
- **Description:** Task 5 depends on Task 4 APIs and Task 1 copy helpers; it does not need quality/flyer fields if it only uses success remaining + entitlement. Risk: existing call sites still use `formatFreeTierQuotaCopy` unconditionally (`generation-status-panel`, `review-step`, `regeneration-sheet` per inventory). Task 5 says apply `formatPlanQuotaCopy` but RED coverage is partial (hard-limit CTA, settings) — easy to leave Plus users seeing 「無料版は」.
- **Suggestion:** Grep `formatFreeTierQuotaCopy` and require replacement or plan-aware wrapper at every user-facing quota string; add Plus remaining copy test.
- **Status:** open

---

## Issue 17: Vague / conceptual GREEN steps still present

- **Severity:** minor
- **Section:** Task 3 Step 7, Task 4 Step 7, Task 6 Step 5–6 (lens 4)
- **Description:** Despite strong verbatim blocks elsewhere, several Must paths remain sketch-level: `buildReserveArgs` “概念”, webhook “設計の擬似コードをそのまま”, quality reserve SQL bullet comments, `tools/stripe-mock/` “最低限 README + fixture”. These are better than pure TBD but still allow divergent implementer choices on lock TTL, dual-sub cancel, retrieve-on-same-second, and mock signature vectors.
- **Suggestion:** Promote design pseudocode for webhook ordered upsert and dual-sub into Task 4 as copy-paste reference implementation; define checkout lock TTL (design: 30 min) in Task text; define mock exact `STRIPE_MOCK_BASE_URL` contract.
- **Status:** open

---

## Issue 18: Task 2 pgTAP is a skeleton, not a full adversarial suite

- **Severity:** minor
- **Section:** Task 2
- **Description:** `plan(12)` with ~5 concrete asserts and comments “実装時に…すべて assert”. A6 past_due NULL is comment-only. Implementers can ship thin tests and still “GREEN”.
- **Suggestion:** Expand required case table: none, trialing, active, past_due grace, past_due expired, past_due NULL, canceled in period, canceled after period, service_role execute ok, authenticated/anon execute fail.
- **Status:** open

---

## Issue 19: Dual entitlement computation (SQL RPC vs TS `computePlusEntitled`)

- **Severity:** minor
- **Section:** Task 2 / Task 3
- **Description:** SQL `get_billing_entitlement_for_user` and TS `computePlusEntitled` both implement A6. If `loadEntitlement` re-derives from raw rows instead of trusting RPC JSON, drift is likely. Plan exports both without saying RPC is sole runtime authority for request path.
- **Suggestion:** Runtime: map RPC JSON only. Use TS pure function for unit tests mirroring SQL, with a shared case table documented once; optional pgTAP vs TS parity fixture.
- **Status:** open

---

## Issue 20: timestamptz in jsonb may not satisfy wire ISO helpers

- **Severity:** minor
- **Section:** Task 2 / Task 4
- **Description:** RPC returns `current_period_end` / `trial_end` / `past_due_since` via `jsonb_build_object` of timestamptz. Postgres text form is not always the project’s `isoDateTimeSchema`. Entitlement endpoint Zod may reject valid DB rows.
- **Suggestion:** Cast to ISO in SQL (`to_char(... AT TIME ZONE 'UTC', ...) || 'Z'`) or normalize in Functions before Zod.
- **Status:** open

---

## Issue 21: Task1 commit `git add` list incomplete / free-tier regression file

- **Severity:** minor
- **Section:** Task 1
- **Description:** Files include `shared/copy/free-tier.test.ts` modification; Step 8 `git add` omits it. Minor process footgun.
- **Suggestion:** Align git add with Files list.
- **Status:** open

---

## Issue 22: Secrets / VITE_ — plan good; UI Task must not invent publishable misuse

- **Severity:** minor
- **Section:** Task 4 / Task 5 (lens 10)
- **Description:** Plan correctly forbids `VITE_STRIPE_*` / `VITE_BILLING_*` in parseServerEnv and has RED for `VITE_STRIPE_SECRET_KEY`. Checkout returns a hosted URL; browser should not embed secret/price IDs if prices are only server-side. Task 5 does not explicitly forbid shipping Price IDs in client env. Low risk if implementers only call APIs, but not locked.
- **Suggestion:** Task 5 note: browser only uses `/api/billing/*`; no Stripe.js secret; optional Stripe.js publishable key is out of scope (Checkout redirect only).
- **Status:** open

---

## Issue 23: `npm run db:test` vs plan’s profile-test command

- **Severity:** minor
- **Section:** Global (lens 14)
- **Description:** Plan correctly uses `docker compose --profile test run --rm db-test` (host). `package.json` `"db:test": "docker compose run --rm db-test"` omits `--profile test`. Implementers following package.json rather than plan may get service-not-found. Plan itself is correct; risk is operational.
- **Suggestion:** Optional Task 8 chore: align `package.json` db:test with profile; keep plan command as source of truth.
- **Status:** open

---

## Issue 24: typegen path ambiguity

- **Severity:** minor
- **Section:** Task 2
- **Description:** Step hedges `npm run db:types` vs `bash scripts/generate-database-types.sh`. Script expects Meta at `http://meta:8080` (Compose network) — correct inside `app`, wrong on host without URL override. Hand-edit of `database.generated.ts` is correctly forbidden.
- **Suggestion:** Single canonical command: `docker compose run --rm app npm run db:types` (with deps so meta is reachable) or document required stack up.
- **Status:** open

---

## Issue 25: Multimodal response parse still string-only

- **Severity:** nit
- **Section:** Task 7
- **Description:** Plan extends `OpenRouterMessage.content` for **requests**. Response path still `message.content: z.string()` in openrouter.ts (inventory). Usually OK for chat completions text JSON; vision models still return text. Low risk unless API returns array parts.
- **Suggestion:** Note “response content remains string; request content union only” or extend response schema if provider returns parts.
- **Status:** open

---

## Issue 26: formatPlanQuotaCopy Plus branch is no-op both arms

- **Severity:** nit
- **Section:** Task 1
- **Description:** Plus branch checks prefixes then returns `trimmed` either way — fine, slightly redundant. Not a plan defect.
- **Suggestion:** Optional simplify in implementation; no plan change required.
- **Status:** open

---

## Issue 27: Order / partial-merge safety (summary of lens 1)

- **Severity:** major (aggregate; components filed above)
- **Section:** Global
- **Description:** Intended order Task1∥2 → 3 → 4 → 5 → 6 → 7 → 8 is mostly sound for product safety:
  - Task3 without Task4: Free force via `billingEnabled` default — **safe for limits**.
  - Task4 without Task5: APIs only — safe.
  - Task6 without client builders / Task7 without e2e allowlist — **unsafe** (Issues 3, 5).
  - Task2+4 without write RPCs — **unsafe** (Issue 1).
  Migration billing (130) before plan-aware quota (140) is correct; quality/flyer after is correct.
- **Suggestion:** Treat Issues 1–5 as merge blockers before any PR lands past skeleton.
- **Status:** open

---

## Strengths

1. **Adversarial locks A1–A11** are explicit and mostly tested where it matters (short mark-time, ignore-older, kill webhook stays up, past_due NULL, flyer success-full no try, quality before reserve).
2. **Migration series** `20260729130000`–`160000` correctly sorts after latest code migration `20260729120000`.
3. **DB test invocation** uses host `docker compose --profile test run --rm db-test` (not `app` container) — matches CLAUDE.md/AGENTS.md.
4. **Fail-closed entitlement (A9)** and ban on defense-max default are correctly threaded into repository RED.
5. **Kill switch split (A3)** is clear: Checkout closed, Free quotas, webhook continues — design-aligned.
6. **planQuota / releaseQuota alias** preserves existing Free imports — good incremental Task 1.
7. **Phased usageToday shape** (quality/flyer later required) shows awareness of type consistency across PRs.
8. **RPC full replace** of `20260728150000` bodies (no partial patch) matches prior identity migration discipline.
9. **stripe@22.3.2 exact pin** is a real current package version; Node 24 + ESM project can consume it with default import.
10. **Cross-check matrix** maps design acceptance scenarios to Tasks — good for coverage audits once gaps above close.
11. **No VITE_ secrets** RED in Task 4 is the right pattern for this codebase’s `parseServerEnv`.
12. **L12 truncate processing on v3** is an honest pre-prod choice that simplifies HMAC cutover (if client files are included).

---

## Recommended fix order (for plan authors; not implementation)

1. Add billing **write** SECURITY DEFINER RPC surface + grants (Issue 1).  
2. Expand Task 3 wire schemas: usage **and** generationQuota/status + usage-today merge (Issues 2, 6, 8).  
3. List all pgTAP signature consumers (Issue 4) and constraint discovery (Issue 11).  
4. Expand Task 6 client v3 cutover file list (Issue 3).  
5. Register e2e-function-server routes + real mock injector (Issue 5).  
6. Release symmetry + abuse RED completeness (Issues 7, 10).  
7. trial identity_key path, sharp/Netlify, STRIPE_API_VERSION lock (Issues 9, 12, 13).

Until Issues 1–5 are resolved in the plan text, do not dispatch Implementer on Task 2+ as written.

---

*Read-only review. Plan and product design files were not modified by the reviewer; this document is the deliverable.*
