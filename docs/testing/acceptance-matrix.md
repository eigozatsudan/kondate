# Acceptance matrix (Plan 6 Task 6)

MVP 22 rows + Guided planner §3.2 の 8 rows。番号は設計書の受け入れ条件番号と一致させる。  
`Owning test` は exact file と exact test title。layer は unit / pgTAP / e2e / script / staging-evidence。

## MVP (22)

| # | Behavior (short) | Owning automated test | Layer |
| --- | --- | --- | --- |
| 1 | Compose local stack + deterministic OAuth/AI | `e2e/specs/foundation.spec.ts` — stack reaches login | e2e |
| 2 | Google/magic PKCE, state, continuation, cancel, expiry, safe retry | `netlify/functions/_tests/auth-continuation-create.test.ts` — rejects missing Origin with a closed invalid_request envelope; rejects wrong Origin with a closed invalid_request envelope; hashes state and secret before the create transition and never returns them · `netlify/functions/_tests/auth-continuation-deposit.test.ts` — rejects missing Origin with a closed continuation_unavailable envelope; rejects wrong Origin with a closed continuation_unavailable envelope; binds deposit to the hashed state and returns closed 404 when the transition rejects; encrypts the code before deposit and returns 204 without exposing ciphertext · `netlify/functions/_tests/auth-continuation-claim.test.ts` — rejects missing Origin with a closed continuation_unavailable envelope; rejects wrong Origin with a closed continuation_unavailable envelope; hashes state and secret for binding and never echoes them on failure; decrypts after claim and returns a 200 envelope without ciphertext; rejects secret hash binding violations with a closed 404 · `e2e/specs/auth-callback-security.spec.ts` — oauth-mock cancel returns safe retry copy and erases transient code/state; past expires_at continuation fails with safe retry copy and erases transient params; matching state reaches callback once; unknown and mismatched state fail safely · `e2e/specs/oauth-mock.spec.ts` — local Google success / cancellation · `e2e/specs/auth-recovery.spec.ts` — same-browser callback / isolated WebView / Google cancel and expired links · `scripts/verify-release-evidence.mjs` + external staging JSON (real Google success) | unit + e2e + script + staging-evidence |
| 3 | ~60s first household setup, standard 29 allergens, resume | `e2e/specs/onboarding.spec.ts` · `e2e/specs/settings.spec.ts` — adds, edits, and deletes a household member without account deletion | e2e |
| 4 | Privacy consent before AI; no names/emails/UUIDs in allowlist DTO | `e2e/specs/full-journey.spec.ts` · `scripts/assert-privacy-logs.mjs` · Plan 7 canary unit | e2e + script + unit |
| 5 | Meal/ingredient/genre/members generation with preflight safety | `e2e/specs/full-journey.spec.ts` — household journey: welcome through shopping reconciliation · `e2e/specs/generation-recovery-results.spec.ts` | e2e |
| 6 | Current safety on all paths; fingerprint recheck blocks stale success | `supabase/tests/database/ai_control_and_quota_races.test.sql` — P3#5 allergy-first: finalize terminals as constraint_conflict/current_safety_changed with menu 0 and reservation release; P3#5 finalize-first: success menu 1 committed under lock, then waiting allergy commits after release · `e2e/specs/history-safety-change.spec.ts` — automatically revalidates on mount and blocks stale history after safety changes; standard allergen hit returns invalid revalidation, disables actions, and auto-signals recheck · `supabase/tests/database/ai_control_and_quota.test.sql` — household finalize fingerprint mismatch terminals as constraint_conflict/current_safety_changed without menu or success consumption | pgTAP + e2e |
| 7 | Text-leaf allergen scan; pending label confirmation; structured safety | `shared/safety/allergens.test.ts` · `shared/safety/validate-generated-menu.test.ts` · adversarial mock fixtures | unit |
| 8 | Exclude unconfirmed/unsupported diets; no medical as normal menu | `shared/safety/medical-scope.test.ts` · openrouter adversarial fixtures | unit |
| 9 | Pantry must/prefer, quantities, post-cook updates | `e2e/specs/menu-domain-pantry.spec.ts` · pantry unit | e2e + unit |
| 10 | Timeline within budget; 50s Function / 20s attempt | generation service unit · `e2e/specs/generation-recovery-results.spec.ts` | unit + e2e |
| 11 | Dish tabs, portions, adaptations, human-readable labels | menu-result unit · household journey e2e | unit + e2e |
| 12 | Idempotent recovery without double consume | `e2e/specs/generation-recovery-results.spec.ts` | e2e |
| 13 | Regeneration reasons, no double success count | `e2e/specs/history-regeneration.spec.ts` | e2e |
| 14 | History groups, accept, auto revalidate ≤60s / focus / Realtime / online | `e2e/specs/history-safety-change.spec.ts` — standard allergen hit returns invalid revalidation, disables actions, and auto-signals recheck · `e2e/specs/history-regeneration.spec.ts` · `src/features/history/hooks/use-menu-revalidation.test.tsx` · `src/features/history/pages/history-detail-page.test.tsx` — fails closed and starts a fresh current-safety check for focus/visibility/online/realtime/sixty-second-poll | e2e + unit |
| 15 | Shopping revalidate races, protected rows, replay | `e2e/specs/shopping-list.spec.ts` · `e2e/specs/shopping-list-races.spec.ts` · shopping pgTAP | e2e + pgTAP |
| 16 | Owner-only RLS for history/favorites/drafts/shopping/continuations | `supabase/tests/database/rls_inventory.test.sql` · auth continuation pgTAP | pgTAP |
| 17 | Quotas 5/12/4/global; 30-day cleanup; usage/today | ai_control_and_quota pgTAP · usage-today unit | pgTAP + unit |
| 18 | Free-model only emergency menus on limit/failure | emergency-menus unit · Plan 6 free-model contract | unit |
| 19 | Non-`:free` model config fails startup/deploy verify | `scripts/verify-openrouter-models.mjs` | script |
| 20 | Failures/conflicts do not store broken menus; release reservation; keep sent attempts | `supabase/tests/database/ai_control_and_quota_races.test.sql` — P3#5 allergy-first…; P3#5 finalize-first… · `supabase/tests/database/ai_control_and_quota.test.sql` — household finalize fingerprint mismatch… · generation failure units | pgTAP + unit |
| 21 | 320px no horizontal scroll; 44px targets; a11y | `e2e/specs/mobile-accessibility.spec.ts` · `e2e/specs/full-journey.spec.ts` · axe suite | e2e |
| 22 | CI type/unit/db/e2e/adversarial/build; staging Google evidence same SHA | Task 7 CI + `scripts/verify-release-evidence.mjs` + external artifact | script + staging-evidence |

## Guided planner §3.2 (8)

| # | Success condition | Owning automated test | Layer |
| --- | --- | --- | --- |
| G1 | Household-free login → generation → result | `e2e/specs/full-journey.spec.ts` — idea journey: no family safety, no shopping, mode-preserving regen · Plan 7 idea E2E | e2e |
| G2 | Fixed four-question order (meal → ingredient → genre → audience) | planner wizard unit · Plan 7 wizard E2E | unit + e2e |
| G3 | Pre-generation review includes whether safety conditions are used | idea review notice E2E · planner review unit | e2e + unit |
| G4 | Answers survive back / consent / disconnect | generation recovery + planner draft autosave E2E | e2e |
| G5 | Household mode keeps full safety checks | `e2e/specs/full-journey.spec.ts` — household journey… · history safety E2E | e2e |
| G6 | Idea mode never presented as family-safety-confirmed | `e2e/specs/full-journey.spec.ts` — idea journey… · history-regeneration idea cases | e2e |
| G7 | 320px / 44px compliance | `e2e/specs/mobile-accessibility.spec.ts` · full-journey viewport asserts | e2e |
| G8 | WCAG 2.1 AA contrast body/supporting/primary buttons | `src/styles.contrast.test.ts` | unit |

## Notes

- Real Google OAuth success is **not** local-only: automated PKCE/state/callback tests above plus external JSON verified by `node scripts/verify-release-evidence.mjs` (see `docs/testing/google-oauth-staging.md`).
- Production secret / post-deploy smoke evidence is Task 8 (preflight + deploy metadata + smoke scripts).
- Deferred Important closures owned by this Task: P1#1, P1#2, P1#3, P3#5, P4#4 map to MVP **#2, #6, #14, #20**.
