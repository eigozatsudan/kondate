# Paid-plan Stripe — Design × Plan × Inventory × Live code cross-check

| Item | Value |
|------|-------|
| Worktree | `/home/dev/projects/kondate/.worktrees/feat-paid-plan-stripe` |
| Design | `docs/archive/superpowers/specs/2026-07-29-paid-plan-stripe-design.md` (Review-ready r2) |
| Plan | `docs/archive/superpowers/plans/2026-07-29-paid-plan-stripe.md` |
| Inventory | `/tmp/grok-1000/paid-plan-codebase-inventory.md` |
| Date | 2026-07-29 |
| Scope | Report only — no code/plan edits |

**Severity key:** `critical` = will break ship/acceptance or hard-block implementers; `major` = likely wrong behavior or silent omission of a locked requirement; `minor` = naming/path/docs noise or low-risk ambiguity.

**Classes:** `INCONSISTENCY` (design vs plan), `CODE_MISMATCH` (plan/inventory wrong about live code), `GAP` (design requirement without plan task), `PLAN_ERROR` (plan internal contradiction / wrong command), `OK`.

---

## Executive summary

| Severity | Count (non-OK) |
|----------|----------------:|
| critical | 3 |
| major | 10 |
| minor | 9 |
| **Total findings** | **22** |

**Top 10 (by severity then impact):**

1. **C1** — `generationQuotaSchema` / status + repository `user_daily_limit` stay Free-literal-3; Plus 10 breaks Zod parse (**GAP**, critical)
2. **C2** — E2E Function allowlist (`tools/e2e-function-server.mjs`) never updated for billing/flyer routes (**GAP**, critical)
3. **C3** — Quality/flyer fail·stale·account-delete **release symmetry** under-specified vs design (**GAP**, critical)
4. **M1** — `db:types` instructed with `--no-deps` (needs `meta:8080`) (**PLAN_ERROR**, major)
5. **M2** — Dual-subscription cancel + unmapped alert not task-tested (**GAP**, major)
6. **M3** — L10-6 post-success flyer upsell missing from Task5 (**GAP**, major)
7. **M4** — SafeLog / observability allowlist extension absent from Tasks (**GAP**, major)
8. **M5** — Task3 runs `billing-entitlement.test.ts` but never creates it (**PLAN_ERROR**, major)
9. **M6** — Design sequence `priceInterval` vs routes/plan `interval` (**INCONSISTENCY**, major)
10. **M7** — File map wrong path for `regeneration-sheet.tsx` (**CODE_MISMATCH**, major)

Limits, adversarial locks A1–A11 numbers, migration stamps after `20260729120000`, and `stripe@22.3.2` pin are largely **aligned** across design and plan; inventory matches live code.

---

## 1. L1–L16 product locks

| Lock | Design | Plan coverage | Inventory / live | Verdict |
|------|--------|---------------|------------------|---------|
| **L1** Forever freemium Free useful | Free not gutted | Task1–3 Free 3 maintained | Free 3 hard-coded end-to-end | **OK** |
| **L2** Single Plus only | `free` \| `plus` | `PlanCode`, checkout only plus | N/A (no billing yet) | **OK** |
| **L3** ¥580 / ¥5,800 / 7-day trial | Price + trial + card | Task4 Checkout `trial_period_days: 7`, Task5 copy 580/5800 | N/A | **OK** |
| **L4** Free success stays 3 | Explicit | `planQuota.free.successPerDay: 3` | `releaseQuota` 3 @ `generation.ts:565–570` | **OK** |
| **L5** Value: headroom → quality budget → flyer flagship | Stated | Task order 3→6→7 | N/A | **OK** |
| **L6** Free 3/6/4/600 | Table | planQuota.free exact | env + RPC + CHECK match | **OK** |
| **L7** Plus 10/20/8/600 | Table | planQuota.plus + CHECK 10/20/8 | Not in code yet (expected) | **OK** |
| **L8** Quality 3/day AND 20/month | Table | Task6 tables CHECK ≤3/≤20 | Absent | **OK** (planned) |
| **L9** Flyer 2 success/JST week + Free locked preview | Success 2; try 6 in body not L9 row | Task7 success 2 + try 6; Free preview | Absent | **OK** (try 6 is cost lock, not L9 row) |
| **L10** Funnel 1–6 | 6 funnel rows | Task5 covers 1,2,5 (+ hard CTA); Task7 locked preview = 3; Task6 quality gate = 4; **#6 upsell missing** | N/A | **GAP** → finding **M3** |
| **L11** P0 only | P1/P2 roadmap only | Plan Placeholder scan: P1 not implemented | N/A | **OK** |
| **L12** No backward compat pre-prod | v3 replace, privacy bump | Task6 v3; Task8 privacy | Still v2 / `2026-07-28.v1` | **OK** (planned) |
| **L13** Webhook entitlement SoT | Webhook SoT | Task4 A2/A3/A7 | Absent | **OK** (planned) |
| **L14** Client never trusted for plan | Functions only | Task3 loadEntitlement; ignore body plan | No plan field today | **OK** |
| **L15** No VITE secrets; no PII/AI/image log | Env + flyer rules | Task4 VITE_STRIPE reject; Task7 non-persist | Existing VITE reject pattern | **OK** (planned) |
| **L16** Free prefix / Plus neutral | `formatPlanQuotaCopy` | Task1 exact helper | `formatFreeTierQuotaCopy` only | **OK** (planned) |

---

## 2. Adversarial locks (A1–A11 + design Issue names)

| Lock | Design | Plan | Notes | Verdict |
|------|--------|------|-------|---------|
| **A1** short CHECK ≤8; consume at mark/send; no rate_windows reserved col | r2 table + CHECK alter | A1 table; Task3 pgTAP “reserve does not grow rate_windows”; mark uses snapshot | Aligns with live: mark hardcodes `>= 4` today (`identity` mig) | **OK** |
| **A2** webhook `event.created` order; **no evt_ id lex** | r2 retrieve/terminal | A2 + Task4 unit | — | **OK** |
| **A3** `BILLING_ENABLED=false`: webhook stays up if keys; Free quota; surfaces closed | Kill split table | A3 + Task4 kill table | — | **OK** |
| **A4** atomic multi-ledger quality/flyer | Single SECURITY DEFINER TX | A4; Task6/7 pgTAP concurrent | Release-on-fail not fully tasked → **C3** | **OK** reserve / **GAP** release |
| **A5** double checkout lock → 409 | locks + advisory | Task4 RED 409 | dual-sub cancel separate → **M2** | **OK** for checkout lock |
| **A6** `past_due` + NULL `past_due_since` → not entitled | fail-closed | Task2 SQL + Task3 `computePlusEntitled` | — | **OK** |
| **A7** trial_history first `trialing\|active` webhook only | Table | Task4 unit | Abandoned Checkout does not burn | **OK** |
| **A8** flyer try only when success room; tries=6 | S2 after S1 | reserve signature + order | — | **OK** |
| **A9** entitlement read fail → 503; no defense-max default | 503 code | Task3 repository test | — | **OK** |
| **A10** `qualityMode` on `generation-command.v3` top-level + HMAC | Issue 13 | Task6 | — | **OK** |
| **A11** flyer success full → `flyer_weekly_limit` only; try/OR untouched | S1 first | Task7 pgTAP+unit | — | **OK** |

---

## 3. Limit numbers

| Limit | Design | Plan `planQuota` / tests | Inventory / live | Verdict |
|-------|--------|--------------------------|------------------|---------|
| Free success/day | 3 | 3 | 3 | **OK** |
| Free attempts/day | 6 | 6 | 6 (RPC hardcode + CHECK) | **OK** |
| Free short | 4/600s | 4/600 | CHECK `sent_count 0..4`, mark `>=4`, window %600 | **OK** |
| Plus success/day | 10 | 10 | N/A | **OK** |
| Plus attempts/day | 20 | 20 | N/A | **OK** |
| Plus short | 8/600s | 8/600 | N/A (still max 4) | **OK** planned |
| Quality day/month | 3 & 20 | 3 & 20 | N/A | **OK** |
| Flyer success/week | 2 | 2 | N/A | **OK** |
| Flyer tries/week | 6 | 6 | N/A | **OK** |
| Defense max success/attempt/short | 10/20/8 | same | N/A | **OK** |
| GLOBAL max / ops default | 200 / 80 | Task3 `globalDailyLimit(200)`; Task8 preflight | Live max **20** (`env.ts:79`) | **OK** planned; inventory accurate |
| PAST_DUE grace | 72h | 72 | N/A | **OK** |
| Flyer image | 4 MiB; jpeg/png/webp; 2048² | Task7 | N/A | **OK** |

---

## 4. Routes, env, tables, RPCs, failure codes

### Routes

| Route | Design | Plan | Live | Verdict |
|-------|--------|------|------|---------|
| `POST /api/billing/checkout` | yes; body **`interval`** (routes table); sequence diagram says **`priceInterval`** | `{ interval: "month"\|"year" }` | absent | **INCONSISTENCY** design diagram vs routes → **M6**; plan follows routes |
| `POST /api/billing/portal` | yes | yes | absent | **OK** |
| `POST /api/billing/webhook` | JWT none; BILLING independent | yes | absent | **OK** |
| `GET /api/billing/entitlement` | + `productSurfacesOpen` + `quotaPlan` | same wire schema | absent | **OK** |
| `POST /api/flyer-weekly` | multipart `image` only | same | absent | **OK** |
| Existing gen `/api/generations/menu\|dish`, `/api/usage/today` | extended | Task3/6 | present | **OK** |

### Env vars

| Var | Design | Plan | Live / inventory | Verdict |
|-----|--------|------|------------------|---------|
| `BILLING_ENABLED` | true/false; default false | Task4 parse | absent | **OK** planned |
| `STRIPE_SECRET_KEY` / `WEBHOOK_SECRET` / PRICE_* / `API_VERSION` | server only | Task4; example `2025-06-30.basil` placeholder | absent | **OK** (API version lock deferred — plan Placeholder scan) |
| `STRIPE_MOCK_BASE_URL` | local exact; prod throw | Task4 | absent | **OK** |
| `VITE_STRIPE_*` / `VITE_BILLING_*` | parse throw | Task4 RED | no Stripe VITE today; pattern exists for other secrets | **OK** |
| `OPENROUTER_PLUS_MODELS` | quality list | Task6 | absent | **OK** |
| `OPENROUTER_FLYER_MODELS` | optional Q1 | Task7 optional | absent | **OK** |
| `GLOBAL_DAILY_AI_LIMIT` max 200 | yes | Task3 | max 20 | **OK** planned |
| Free USER_DAILY_* env | Free-only verify or drop | Task3 Free match only | release-locked 3/6/4/600 | **OK** planned |

### Tables / RPCs

| Name | Design | Plan migration | Live | Verdict |
|------|--------|----------------|------|---------|
| `private.billing_*` (5 tables) | DDL | `20260729130000` | absent; latest mig `20260729120000` | **OK** |
| `get_billing_entitlement_for_user` | service_role only | Task2 full SQL sketch | absent | **OK** |
| identity CHECK 10/20; short ≤8 | yes | `20260729140000` | CHECK 3/6/4 | **OK** planned |
| `reserve_ai_generation` plan params + quality | yes | Task3 params; Task6 `p_quality_mode` | `p_user_limit` only Free-3; no attempt/short/quality params | **OK** planned; inventory accurate |
| `reserve_flyer_weekly` | S0–S4 | Task7 signature | absent | **OK** |
| quality / flyer identity tables | yes | Task6/7 | absent | **OK** |

### Failure codes (sample)

| Code | Design | Plan Task | Verdict |
|------|--------|-----------|---------|
| `billing_entitlement_unavailable` | 503 | Task3/4 | **OK** |
| `billing_disabled` / `billing_checkout_in_progress` / `billing_already_entitled` | yes | Task4 | **OK** |
| `quality_mode_requires_plus` / daily / monthly | yes | Task6 Japanese exact | **OK** |
| flyer_* six codes | yes | Task7 Japanese exact | **OK** |
| `billing_cancel_failed` (log) | delete-account | Task8 | **OK** |

---

## 5. Migration timestamps

| Claim | Reality | Verdict |
|-------|---------|---------|
| Inventory latest: `20260729120000_menu_generation_model.sql` | Confirmed in `supabase/migrations/` | **OK** |
| Plan series `20260729130000`…`160000` after `29120000` | Lexicographic order correct; no collision | **OK** |
| Plan identity authority was `20260728150000` | Live last rewrite of reserve/mark/usage | **OK** |

---

## 6. Stripe package install

| Claim | Check | Verdict |
|-------|-------|---------|
| `stripe@22.3.2` exact pin | npm latest stable is 22.3.2 (as of cross-check) | **OK** |
| Install: `docker compose run --rm --no-deps app npm install stripe@22.3.2 --save-exact` | Matches AGENTS Docker npm pattern; `--no-deps` fine for install | **OK** |
| Task7 `sharp --save-exact` same pattern | OK for container; Netlify native binary risk not runbook’d | **GAP** minor → **m9** |
| No stripe in `package.json` today | Confirmed inventory + live deps | **OK** |

---

## 7. Docker / AGENTS.md command correctness

| Plan command | AGENTS / CLAUDE expectation | Verdict |
|--------------|----------------------------|---------|
| `docker compose run --rm --no-deps app npm test -- --run …` | Host-independent unit OK | **OK** |
| `docker compose run --rm --no-deps app npm run typecheck\|lint\|format:check` | OK | **OK** |
| `docker compose run --rm migrate` | Host, not inside app | **OK** |
| `docker compose --profile test run --rm db-test` | Correct (not `npm run db:test` inside app) | **OK** |
| `./scripts/run-e2e.sh` | Correct | **OK** |
| **Task2 Step5:** `docker compose run --rm --no-deps app npm run db:types` | `db:types` fetches `http://meta:8080/...` (`scripts/generate-database-types.sh`). CLAUDE: `--no-deps` only for commands that do **not** talk to stack services. Docs use `docker compose run --rm app npm run db:types` **without** `--no-deps`. | **PLAN_ERROR major → M1** |
| One-command-per-invocation (no `&&`) | Plan steps mostly separate code blocks | **OK** |

---

## 8. File paths (plan File map + Tasks vs live)

| Plan path | Live | Verdict |
|-----------|------|---------|
| `shared/contracts/generation.ts` (`releaseQuota`) | Exists; L565–570 | **OK** |
| `shared/copy/free-tier.ts` | Exists | **OK** |
| `netlify/functions/_shared/env.ts`, `generation-repository.ts`, `openrouter.ts` | Exist | **OK** |
| `netlify/functions/usage-today.ts`, `delete-account.ts` | Exist | **OK** |
| `src/features/household/household-settings-page.tsx` | Exists | **OK** |
| `src/features/planner/components/review-step.tsx` | Exists (Task5 correct) | **OK** |
| `src/features/generation/components/generation-status-panel.tsx` | Exists | **OK** |
| File map: `src/features/history/regeneration-sheet.tsx` | **Actual:** `src/features/history/components/regeneration-sheet.tsx` (Task5 path correct; File map wrong) | **CODE_MISMATCH / PLAN_ERROR → M7** |
| `src/features/account/delete-account-dialog.tsx` | Exists | **OK** |
| `src/features/privacy/privacy-copy.ts` | Exists | **OK** |
| `scripts/preflight-production.mjs`, `verify-openrouter-models.mjs` | Exist; npm script `preflight:production` exists | **OK** |
| `tools/e2e-function-server.mjs` closed Function list | Exists; **no plan step to add billing/flyer modules** | **GAP → C2** |
| New plan paths (`plan-quota.ts`, billing functions, migrations 130k–160k) | Absent (expected) | **OK** |

Inventory accuracy spot-check: `releaseQuota`, `privacyNoticeVersion = "2026-07-28.v1"`, `globalDailyLimit(20)`, no stripe, multimodal `content: string` only, latest migration stamp — **all match live**. No inventory false positives found in sampled anchors.

---

## Findings (detail)

### Critical

#### C1 — GAP — Status / repository quota Zod stay Free-only (Plus 10 will 500)
- **Severity:** critical  
- **Sources:** design usage/status projection + plan-aware status; live `generationQuotaSchema` (`generation.ts:775–783`) `remaining.max` / `userDailyLimit` = literal **3**; `generation-repository.ts:104` `user_daily_limit: z.literal(releaseQuota.userDailySuccessLimit)`.  
- **Plan:** Task3 rewrites `usageTodayDataSchema` and SQL `get_ai_generation_status`, but **never names** `generationQuotaSchema` or repository response literal. Grep over plan: zero hits for `generationQuotaSchema`.  
- **Impact:** Plus entitled user with remaining >3 or `user_daily_limit: 10` fails client/server Zod on status/reserve parse → false failures / 500s after PR3.  
- **Fix direction (report only):** Task3 must widen `generationQuotaSchema` to 3|10 (or max 10) and repository optional literal; add RED tests.

#### C2 — GAP — E2E Function server allowlist not updated
- **Severity:** critical  
- **Sources:** design E2E mock billing/flyer; live `tools/e2e-function-server.mjs` L8–25 closed list (no billing-*, no flyer-weekly); comment: paths not listed → E2E **404**.  
- **Plan:** Task8 E2E scenarios require checkout/entitlement/webhook/flyer but File list / steps **omit** `e2e-function-server.mjs` (and likely proxy wiring).  
- **Impact:** Task8 E2E acceptance cannot pass as written.

#### C3 — GAP — Release / cleanup symmetry for quality & flyer reserved ledgers
- **Severity:** critical  
- **Sources:** design §原子的 multi-ledger: fail/timeout/stale cleanup/account delete must return **reserved** on identity success/attempt, quality day/month, flyer success/try, global; external sent not returned.  
- **Plan:** Task6 focuses reserve+rollback-on-limit; Task7 S8/S9 on flyer path; Task8 only Stripe cancel + existing `release_identity_and_global_for_user_processing`. **No explicit task** to extend stale cleanup / fail finalize / account release RPCs for quality+flyer reserved, nor pgTAP for orphan reserved after fail.  
- **Impact:** Partial reserved leaks → permanent under-quota or stuck users; violates A4 spirit beyond concurrent reserve.

---

### Major

#### M1 — PLAN_ERROR — `db:types` with `--no-deps`
- **Severity:** major  
- **Plan Task2 Step5:** `docker compose run --rm --no-deps app npm run db:types`  
- **Live:** script hits Compose service `meta:8080`. Project docs: `docker compose run --rm app npm run db:types`. CLAUDE: `--no-deps` only for stack-independent work.  
- **Impact:** typegen fails or flaky in clean agent runs.

#### M2 — GAP — Dual-subscription cancel + unmapped webhook alert under-tasked
- **Severity:** major  
- **Design:** dual live subs → cancel newer, keep older entitled; `billing_user_unmapped` **200 + required alert** threshold.  
- **Plan:** PR4 prose mentions dual-sub; Task4 RED list has order/idempotency/trial/signature/checkout lock — **no dual-sub test**, no unmapped/alert step, no metrics wiring task.  
- **Impact:** high-severity security/billing edge from adversarial review can ship untested.

#### M3 — GAP — L10 funnel item 6 (post-success weekly flyer upsell)
- **Severity:** major  
- **Design L10-6 / copy table #6:** after menu success, Free, max once per JST week, copy about flyer + `localStorage` key `flyer_upsell_week=YYYY-Www`.  
- **Plan:** Spec coverage claims “L10 → Task5”; Task5 fixed copy table **omits** #6; Task7 only locked preview/upload.  
- **Impact:** incomplete conversion funnel vs L10 lock.

#### M4 — GAP — SafeLog / observability allowlist (design Issue 16)
- **Severity:** major  
- **Design:** extend SafeLog with `plan`, `billing_status`, `price_interval`, `quality_mode`, `flyer`; forbid email/filename/image hash; codes like `billing_checkout_created`, `billing_webhook_stale`, etc.  
- **Plan:** no Task touches `logger.ts` / SafeLog schema; grep plan: zero.  
- **Impact:** either PII leak risk if ad-hoc logs added, or missing required metrics/alerts (unmapped, stale).

#### M5 — PLAN_ERROR — Task3 verifies missing `billing-entitlement.test.ts`
- **Severity:** major  
- **Plan Task3 Step9** runs `netlify/functions/_shared/billing-entitlement.test.ts`. Task3 Files create only `.ts` implementation; no RED step authors that test file. Task4 also runs it.  
- **Impact:** GREEN verify fails until improvised; A6 unit may land only as sketch in Task3 body without dedicated tests until Task4.

#### M6 — INCONSISTENCY — Checkout body field name `priceInterval` vs `interval`
- **Severity:** major  
- **Design sequence (~L365):** `{priceInterval}`; **routes table (~L417):** `{ interval: "month" \| "year" }`.  
- **Plan:** consistently `interval` (Zod + Checkout).  
- **Impact:** implementers reading only the sequence diagram implement wrong wire field. Routes/plan should win; design diagram should be fixed.

#### M7 — CODE_MISMATCH / PLAN_ERROR — File map path for regeneration sheet
- **Severity:** major  
- **File map L91:** `src/features/history/regeneration-sheet.tsx`  
- **Live + Task5:** `src/features/history/components/regeneration-sheet.tsx`  
- **Impact:** agents using only File map edit wrong/missing path.

#### M8 — GAP — Quality success must also consume normal success ledger (explicitness)
- **Severity:** major  
- **Design lock:** quality success increments (a) normal success + (b) quality day/month; attempts as usual.  
- **Plan Task6:** atomic reserve mentions quality ledgers; **does not restate** normal success co-consumption in Task text (only via design cross-ref).  
- **Impact:** easy mis-implement (quality-only counter) if Task is executed without re-reading design.

#### M9 — PLAN_ERROR — Task1 `git add` omits declared `free-tier.test.ts`
- **Severity:** major (process)  
- **Task1 Files:** Modify `shared/copy/free-tier.test.ts`  
- **Step8 git add:** list omits that file.  
- **Impact:** regression test uncommitted / incomplete Task commit.

#### M10 — GAP — `get_ai_usage_today` / status SQL + Functions must project plan/quality/flyer but Task3 partial schema stages risk
- **Severity:** major (related to C1)  
- **Design** final `usageTodayDataSchema` includes quality + flyerWeekly required.  
- **Plan** stages Task3 without quality/flyer, Task6/7 add required fields — good.  
- **Risk:** mid-PR clients/fixtures break if not updated each stage; plan says update fixtures Task3 but **status panel / generation status API** consumers not fully enumerated. Tied to C1.

---

### Minor

#### m1 — INCONSISTENCY — Design PR5 file list includes `issueMessages`; Plan Task5 defers codes to Task6/7
- **Severity:** minor  
- Plan Task5 is clearer; design PR Plan table is slightly ahead of Task5.

#### m2 — INCONSISTENCY — Design kill table “鍵欠落” for GET entitlement: “503 or surfaces closed” vs main path 200+DB
- **Severity:** minor  
- Plan GET with keys+kill → 200; without keys less precise. Edge case ambiguity for implementers.

#### m3 — PLAN_ERROR — Identity CHECK drop uses guessed constraint names
- **Severity:** minor  
- Task3: `drop constraint if exists ai_identity_daily_usage_check` — live CHECKs are unnamed table checks (auto names may differ). Rate windows use safer DO loop.  
- **Impact:** migration may no-op drop then fail add if old check remains.

#### m4 — CODE_MISMATCH (soft) — Plan global “inventory facts” match live (surprising OK)
- **Severity:** n/a OK note  
- Plan Global Constraints inventory bullets match live Free hard-codes, `privacyNoticeVersion`, no stripe, latest stamp `20260729120000`.

#### m5 — GAP — Portal Dashboard checklist (locale ja, cancel at period end, no dark pattern, month↔year off)
- **Severity:** minor  
- Design P0 ops checklist; plan mentions locale ja in Checkout/Portal create but no runbook checkbox task beyond reconcile.

#### m6 — GAP — Roadmap Locked Environment Contract “reference this design” note
- **Severity:** minor  
- Design supersede asks roadmap table update; Task8 mentions “roadmap Locked Environment Contract 注記” — lightly covered.

#### m7 — INCONSISTENCY — Sequence diagram vs acceptance: `GET /entitlement` path shorthand
- **Severity:** minor  
- Acceptance row writes `GET /entitlement`; canonical is `/api/billing/entitlement`. Plan uses full path.

#### m8 — GAP — Optional `private.flyer_weekly_requests` processing table
- **Severity:** minor  
- Design “任意”; plan relies on finalize path without mandating table. Acceptable if release symmetry covered elsewhere (see C3).

#### m9 — GAP — Netlify/sharp native binary deployment note
- **Severity:** minor  
- Task7 installs sharp in app image; production Netlify Functions Linux binary not runbook’d in plan.

#### m10 — OK (surprising) — Free env remains release-locked while Plus is code+entitlement
- Design + plan agree: env cannot override Plus limits. Live still forces all users to 3 via env+RPC — expected pre-implementation.

#### m11 — OK — `stripe@22.3.2` pin matches npm latest at check time
- Plan “install-time latest exact pin” claim is currently true.

#### m12 — PLAN_ERROR (minor) — Task3 Step9 assumes `billing-entitlement.test.ts` path under `_shared/`
- Same root as M5; Task4 also allows `_tests/billing-*.test.ts` — dual path convention inconsistency.

---

## 9. Inventory vs live (sampled)

| Inventory claim | Live verify | Verdict |
|-----------------|-------------|---------|
| `releaseQuota` 3/6/4/600 @ generation.ts ~565 | Exact | **OK** |
| No `planQuota` module | Confirmed | **OK** |
| `usageTodayDataSchema` literals Free | L845+ | **OK** |
| `globalDailyLimit(20)` | env.ts:79 | **OK** |
| Identity mig authority `20260728150000` | reserve `p_user_limit <> 3`, attempt `>= 6`, mark short `>= 4` | **OK** |
| `ai_user_rate_windows` CHECK 0..4 | 20260711002000; unaltered | **OK** |
| No stripe dep | package.json | **OK** |
| `privacyNoticeVersion` `2026-07-28.v1` | domain.ts:71 | **OK** |
| Latest migration `20260729120000` | dir listing | **OK** |
| `OpenRouterMessage.content: string` | openrouter.ts | **OK** |
| delete-account no Stripe | delete-account.ts | **OK** |
| e2e function list closed | e2e-function-server.mjs | **OK** (inventory didn’t stress this; cross-check adds C2) |

---

## 10. What is solid (brief OK notes)

- Free/Plus product numbers and quality/flyer caps are **identical** in design `planQuota` block and plan Task1 tests.  
- Adversarial r2 locks (S1 flyer, mark-time short, webhook no evt_ lex) are first-class in plan A1–A11 and Task tests.  
- Migration ordering after `20260729120000` is correct.  
- Stripe install command shape and exact pin approach match repo conventions.  
- Most unit/lint/typecheck Docker invocations match AGENTS.md.  
- Kill-switch split (webhook continues) is consistent design↔plan.  
- Task staging of `usageTodayDataSchema` (plan → quality → flyer) is intentional and documented.

---

## 11. Recommended fix priority (for plan authors; no edits made here)

1. Task3: widen `generationQuotaSchema` + repository `user_daily_limit`; RED for Plus 10 status.  
2. Task8 (or 4/7): add `tools/e2e-function-server.mjs` module paths for all new Functions.  
3. Task6/7/8: explicit release/stale/account-delete symmetry for quality+flyer reserved.  
4. Fix `db:types` command (drop `--no-deps` or require stack up + document).  
5. Task4 RED: dual-sub cancel + unmapped 200+alert.  
6. Task5: L10-6 upsell + localStorage key.  
7. Task4/8: SafeLog allowlist.  
8. Create/billing-entitlement tests in Task3 Files; fix Task1 git add; fix File map regeneration path; design diagram `interval`.

---

*End of cross-check. Report-only; repository plans/specs/code not modified by this pass except this report file and `/tmp/grok-1000/paid-plan-crosscheck.md`.*
