# Paid-plan Stripe plan — must_fix r1 response

| Item | Value |
|------|-------|
| Plan | `docs/superpowers/plans/2026-07-29-paid-plan-stripe.md` |
| Authority | `docs/superpowers/plans/2026-07-29-paid-plan-stripe-plan-secondary-verify.md` |
| Also | crosscheck + adversarial plan reviews |
| Date | 2026-07-29 |
| Scope | Plan document only (no application feature code) |

## Critical

| ID | What changed in the plan |
|----|--------------------------|
| **ADV-1** | Task2 Produces: full **write RPC table** (`ensure_billing_customer`, `upsert_billing_subscription_from_stripe`, `insert_billing_webhook_event`, `insert_billing_trial_history`, `has_billing_trial_history`, `acquire_billing_checkout_lock`, `release_billing_checkout_lock`, customer getters, dual-sub mark). Tables REVOKE ALL including service_role; grant EXECUTE service_role only. Task4 must use `rpc` only. pgTAP grants + access matrix. |
| **C1** | Task3: widen **`generationQuotaSchema`** (remaining max 10, `userDailyLimit` 3\|10) + repository `user_daily_limit` Zod; RED tests for Plus 10 status wire. |
| **ADV-3** | Task6: enumerated **all v2 producers/consumers** under `src/` / `shared/` / `netlify/` with exact paths; simultaneous cutover; grep gate 0 hits for `generation-command.v2`. |
| **ADV-4** | Task3 Files: list `rls_inventory`, `identity_daily_quota`, `ai_control_and_quota`, `ai_control_and_quota_races`, `user_feedback`, `paid_quota_upgrade_path`, maintenance/account_deletion as needed; signature matrix step before db-test green. |
| **C2** | Task4 adds billing 4 modules to `tools/e2e-function-server.mjs` + unit test; Task7 adds `flyer-weekly`; Task8 verifies allowlist. |
| **C3** | Task6 extends `private.release_request_quota_reservations` + fail/stale/`release_identity_and_global_for_user_processing` for quality reserved; Task7 flyer release helpers + pgTAP; Task8 delete-account calls extended release. |

## Major

| ID | What changed |
|----|--------------|
| **ADV-6** | Task3 Step7: usage-today algorithm steps 1–9 — loadEntitlement → limits RPC → **attach plan/plusEntitled** → parse; AI_QUOTA_DISABLED preserves fields; RED on usage-today tests. |
| **ADV-8** | Task3: `status()` uses same `limitsForPlan(applyQuotaPlan(...))` as reserve; repair snapshot-only for short/quality. |
| **ADV-10** (incl **M2**) | Task4 named RED: dual-sub cancel, unmapped 200+alert, delayed active after terminal, A3 webhook-up/checkout-closed; Task6 Free quality ledger non-mutation. |
| **ADV-9** | Task4 algorithm: userId → admin email → `computeQuotaIdentityKey` → trial_history; Checkout pre-read same helper. |
| **ADV-11** | Task3 migration: DO/`pg_get_constraintdef` discovery for identity usage/attempts CHECKs (not hard-coded names alone). |
| **ADV-12** | Task7: Netlify packaging for sharp + import smoke + deploy doc; no silent sharp removal. |
| **M1** | typegen command: `docker compose run --rm app npm run db:types` (**no** `--no-deps`). |
| **M3** | Task5: L10-6 post-success flyer upsell + `localStorage` `flyer_upsell_week=YYYY-Www`. |
| **M4** | Task4: extend `logger.ts` SafeLog allowlist + billing codes. |
| **M5** | Task3 **Creates** `billing-entitlement.test.ts` with A6 RED. |
| **ADV-14** | Task3: env tests reject `0`/`201`, accept `21`; grep gate for leftover max-20 assumptions. |
| **ADV-15** | Task6/7 Files list factories + usage-today tests + UI mocks for quality/flyerWeekly. |
| **ADV-13** | Locked **`STRIPE_API_VERSION = "2026-06-24.dahlia"`** in plan/env/example/tests（内部テスト前に acacia から再ピン）。 |
| **M7** | File map: `src/features/history/components/regeneration-sheet.tsx`. |
| **M8** | Task6 text: quality reserve co-consumes normal identity success/attempt in same TX. |
| **M9** | Task1 `git add` includes `shared/copy/free-tier.test.ts`. |

## Design-only (not plan defect)

| ID | Note |
|----|------|
| **M6** | Plan already uses `{ interval }`. Note: design mermaid `priceInterval` should be fixed in design doc separately. |

## Minors bundled

- Free-prefix regression tests (Task5 Plus copy test + grep formatFreeTierQuotaCopy)
- Checkout lock TTL 30 min
- A6 pgTAP case table expanded (Task2)
- Portal Dashboard checklist in billing-reconcile runbook
- `package.json` db:test → `--profile test` (Task8)
- Runtime: RPC JSON authority; TS computePlusEntitled unit-only
- ISO-Z timestamps from entitlement RPC
- Response OpenRouter content remains string (request multimodal only)

## Verdict

All **critical** and **major** must_fix items from secondary verification are written into the plan r1. Ready for implementer dispatch after human skim of r1 sections Task2–4.
