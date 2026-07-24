# Acceptance matrix (Plan 6 Task 6)

MVP 22 rows + Guided planner §3.2 の 8 rows。番号は設計書の受け入れ条件番号と一致させる。  
`Owning test` は exact file と exact test title。layer は unit / pgTAP / e2e / script / staging-evidence。

## MVP (22)

| # | Behavior (short) | Owning automated test | Layer |
| --- | --- | --- | --- |
| 1 | Compose local stack + deterministic OAuth/AI | `e2e/specs/foundation.spec.ts` — protects app routes and fits the active viewport · `e2e/specs/oauth-mock.spec.ts` — local Google success returns the bound code to the app and establishes a Supabase session | e2e |
| 2 | Google/magic PKCE, state, continuation, cancel, expiry, safe retry | `netlify/functions/_tests/auth-continuation-create.test.ts` — rejects missing Origin with a closed invalid_request envelope · `netlify/functions/_tests/auth-continuation-deposit.test.ts` — deposit then claim through a shared in-memory store is a real crypto roundtrip · `netlify/functions/_tests/auth-continuation-claim.test.ts` — decrypts after claim and returns a 200 envelope without ciphertext · `e2e/specs/auth-callback-security.spec.ts` — oauth-mock cancel returns safe retry copy and erases transient code/state; past expires_at continuation fails with safe retry copy and erases transient params; reused continuation code and state are rejected after a successful exchange · `e2e/specs/auth-recovery.spec.ts` — same-browser callback restores both callback and original tabs · `scripts/verify-release-evidence.test.mjs` — accepts matching SHA, deploy ID, origin, and 24h window | unit + e2e + script + staging-evidence |
| 3 | ~60s first household setup, standard 29 allergens, resume | `e2e/specs/onboarding.spec.ts` — resumes a partially saved member, completes household setup directly to /planner without privacy consent, then saves consent independently · `e2e/specs/settings.spec.ts` — adds, edits, and deletes a household member without account deletion | e2e |
| 4 | Privacy consent before AI; no names/emails/UUIDs in allowlist DTO | `e2e/specs/full-journey.spec.ts` — household journey: welcome through shopping reconciliation · `scripts/assert-privacy-logs.test.mjs` — fails on UUID, memo keys, Japanese names, and raw mock body markers; does not count maintenance_cleanup as generation presence | e2e + script |
| 5 | Meal/ingredient/genre/members generation with preflight safety | `e2e/specs/full-journey.spec.ts` — household journey: welcome through shopping reconciliation · `e2e/specs/generation-recovery-results.spec.ts` — shows timeline, tabs, ingredients, steps, adaptations, empty pantry state, labels, and disclaimer at 320px | e2e |
| 6 | Current safety on all paths; fingerprint recheck blocks stale success | `supabase/tests/database/ai_control_and_quota_races.test.sql` — P3#5 allergy-first: finalize terminals as constraint_conflict/current_safety_changed with menu 0 and reservation release; P3#5 finalize-first: success menu 1 committed under lock, then waiting allergy commits after release · `e2e/specs/history-safety-change.spec.ts` — automatically revalidates on mount and blocks stale history after safety changes; standard allergen hit returns invalid revalidation, disables actions, and auto-signals recheck · `supabase/tests/database/ai_control_and_quota.test.sql` — household finalize fingerprint mismatch terminals as constraint_conflict/current_safety_changed without menu or success consumption | pgTAP + e2e |
| 7 | Text-leaf allergen scan; pending label confirmation; structured safety | `shared/safety/allergens.test.ts` · `shared/safety/validate-generated-menu.test.ts` · `netlify/functions/_shared/openrouter-mock.test.ts` — keeps every required adversarial scenario fixed in source control | unit |
| 8 | Exclude unconfirmed/unsupported diets; no medical as normal menu | `shared/safety/medical-scope.test.ts` · `netlify/functions/_shared/openrouter-mock.test.ts` — unsupported-medical is a closed conflict outcome (not a success menu) | unit |
| 9 | Pantry must/prefer, quantities, post-cook updates | `e2e/specs/menu-domain-pantry.spec.ts` — pantry CRUD, restored planner, attempt-local expiry check, and all reviewed meals · `src/features/pantry/pantry-page.test.tsx` | e2e + unit |
| 10 | Timeline within budget; 50s Function / 20s attempt | `netlify/functions/_shared/env.test.ts` · `e2e/specs/generation-recovery-results.spec.ts` — recovers a completed result after a tab is closed before its POST response arrives | unit + e2e |
| 11 | Dish tabs, portions, adaptations, human-readable labels | `src/features/generation/components/menu-result.test.tsx` · `e2e/specs/full-journey.spec.ts` — household journey: welcome through shopping reconciliation | unit + e2e |
| 12 | Idempotent recovery without double consume | `e2e/specs/generation-recovery-results.spec.ts` — resends the same key after the first POST is lost before acceptance | e2e |
| 13 | Regeneration reasons, no double success count | `e2e/specs/history-regeneration.spec.ts` — does not consume a success for duplicate output | e2e |
| 14 | History groups, accept, auto revalidate ≤60s / focus / Realtime / online | `e2e/specs/history-safety-change.spec.ts` — standard allergen hit returns invalid revalidation, disables actions, and auto-signals recheck · `src/features/history/pages/history-detail-page.test.tsx` — fails closed and starts a fresh current-safety check for focus/visibility/online/realtime/sixty-second-poll | e2e + unit |
| 15 | Shopping revalidate races, protected rows, replay | `e2e/specs/shopping-list.spec.ts` — shows server-owned diff and preserves protected rows · `e2e/specs/shopping-list-races.spec.ts` — reuses one idempotency key after the first response is lost · `supabase/tests/database/shopping_lists_races.test.sql` | e2e + pgTAP |
| 16 | Owner-only RLS for history/favorites/drafts/shopping/continuations | `supabase/tests/database/rls_inventory.test.sql` · `supabase/tests/database/004_auth_continuations.test.sql` | pgTAP |
| 17 | Quotas 5/12/4/global; 30-day cleanup; usage/today | `supabase/tests/database/ai_control_and_quota.test.sql` · `netlify/functions/_tests/usage-today.test.ts` | pgTAP + unit |
| 18 | Free-model only emergency menus on limit/failure | `src/features/emergency/emergency-menu-page.test.tsx` · `scripts/openrouter-models-contract.mjs` | unit |
| 19 | Non-`:free` model config fails startup/deploy verify | `scripts/verify-openrouter-models.test.mjs` — rejects unsafe model configuration | script |
| 20 | Failures/conflicts do not store broken menus; release reservation; keep sent attempts | `supabase/tests/database/ai_control_and_quota_races.test.sql` — P3#5 allergy-first: finalize terminals as constraint_conflict/current_safety_changed with menu 0 and reservation release · `supabase/tests/database/ai_control_and_quota.test.sql` — household finalize fingerprint mismatch terminals as constraint_conflict/current_safety_changed without menu or success consumption | pgTAP |
| 21 | 320px no horizontal scroll; 44px targets; a11y | `e2e/specs/mobile-accessibility.spec.ts` — the household wizard and result fit 320px with usable targets · `src/app/accessibility.test.tsx` — shell shopping empty uses real ShoppingListPage structure | e2e + unit |
| 22 | CI type/unit/db/e2e/adversarial/build; staging Google evidence same SHA | `tests/tooling/project-config.test.mjs` — ci.sh and GitHub Actions CI keep the same verification gate order · `scripts/verify-release-evidence.test.mjs` — accepts matching SHA, deploy ID, origin, and 24h window | script + staging-evidence |

## Guided planner §3.2 (8)

| # | Success condition | Owning automated test | Layer |
| --- | --- | --- | --- |
| G1 | Household-free login → generation → result | `e2e/specs/full-journey.spec.ts` — idea journey: no family safety, no shopping, mode-preserving regen | e2e |
| G2 | Fixed four-question order (meal → ingredient → genre → audience) | `src/app/accessibility.test.tsx` — meal/ingredients/cuisine/audience/review expose focusable heading · `e2e/specs/generation-recovery-results.spec.ts` — wizard accessibility and layout contracts | unit + e2e |
| G3 | Pre-generation review includes whether safety conditions are used | `e2e/specs/full-journey.spec.ts` — idea journey: no family safety, no shopping, mode-preserving regen · `src/app/accessibility.test.tsx` — idea review shows the family-skip notice and generate control | e2e + unit |
| G4 | Answers survive back / consent / disconnect | `e2e/specs/generation-recovery-results.spec.ts` — recovers a persisted result when only the POST response is lost | e2e |
| G5 | Household mode keeps full safety checks | `e2e/specs/full-journey.spec.ts` — household journey: welcome through shopping reconciliation · `e2e/specs/history-safety-change.spec.ts` — automatically revalidates on mount and blocks stale history after safety changes | e2e |
| G6 | Idea mode never presented as family-safety-confirmed | `e2e/specs/full-journey.spec.ts` — idea journey: no family safety, no shopping, mode-preserving regen · `e2e/specs/history-regeneration.spec.ts` — idea history shows badge, notice, permitted actions, regenerates as idea without shopping | e2e |
| G7 | 320px / 44px compliance | `e2e/specs/mobile-accessibility.spec.ts` — the household wizard and result fit 320px with usable targets | e2e |
| G8 | WCAG 2.1 AA contrast body/supporting/primary buttons | `src/styles.contrast.test.ts` | unit |

## Notes

- Real Google OAuth success is **not** local-only: automated PKCE/state/callback tests above plus external JSON verified by `node scripts/verify-release-evidence.mjs` (see `docs/testing/google-oauth-staging.md`).
- Production secret / post-deploy smoke evidence is Task 8 (preflight + deploy metadata + smoke scripts).
- Deferred Important closures owned by this Task: P1#1, P1#2, P1#3, P3#5, P4#4 map to MVP **#2, #6, #14, #20**.
