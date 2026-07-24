# Kondate MVP Delivery Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Kondate MVP as seven reviewable, testable increments (Plans 1–5, guided planner Plan 7, then hardening Plan 6) from an empty repository to a Netlify and Supabase production deployment.

**Architecture:** A React 19 SPA built with Vite 8 and Tailwind CSS 4 talks directly to Supabase for RLS-protected reads and approved owner CRUD, uses expected-version plus current-safety owner RPCs for shopping-item writes, and calls narrowly scoped Netlify Functions for AI, safety revalidation, derived shopping-list writes, and account deletion. The root Docker Compose project includes a pinned official Supabase self-host stack, a development app container, Mailpit, local-only `oauth-mock`, and a deterministic OpenRouter mock; production uses real Supabase OAuth on Netlify and managed Supabase, with bounded cleanup invoked by an hourly Scheduled Function through a dedicated least-privilege database login whose 20-second statement timeout is active before the RPC command starts.

**Tech Stack:** Node.js 24 LTS, npm, TypeScript strict mode, React 19.2.7, React Router 8 Data Mode (`createBrowserRouter`), Vite 8, Tailwind CSS 4, TanStack Query 5, React Hook Form, Zod 4, Supabase JS 2, Netlify Functions, Vitest, React Testing Library, pgTAP, Playwright.

## Global Constraints

- The approved source of truth is the current `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` (“敵対的レビュー受入事項統合版・実装前確定”). Commit `cd0cb70` is its approved baseline; the integrated adversarial-review clarifications in the current file are normative and plans may not silently fall back to the baseline wording.
- Use Node.js `>=24 <25`; Node 24 is LTS. Do not use Node 26 Current for production.
- Use ESM and TypeScript `strict: true`; do not introduce `any` or unchecked type assertions at network and database boundaries.
- Use React 19.2.7 or later within React 19, Vite 8, Tailwind CSS 4 through `@tailwindcss/vite`, React Router 8 Data Mode through one `createBrowserRouter`, and TanStack Query 5. React Router 8's official baseline forbids earlier React 19.2 patches; import `RouterProvider` from `react-router/dom` and all other used router APIs from `react-router`.
- All user-facing copy is Japanese. Internal identifiers, code comments, commits, and test names are English.
- Mobile-first layout must work at 320 CSS pixels without horizontal scrolling; interactive targets are at least 44 by 44 CSS pixels.
- Use the approved visual direction: warm off-white background, terracotta primary action, subdued green pantry accents, the Plan 7 five-step guided planner wizard (meal → ingredients → cuisine → audience → review) with optional household setup, and tabbed dish results with an overall timeline first. Plan 7 supersedes the earlier single-screen / three-step planner home wording for product UI.
- OpenRouter is called only from Netlify Functions. `OPENROUTER_MODELS` must contain only explicit model IDs ending in `:free`; paid fallback and `openrouter/auto` are rejected.
- Release-locked user limits are exactly 5 successful generations per Japan calendar day, 12 actual OpenRouter sends per user/Japan day, and 4 sends per fixed 600-second window; application-wide actual sends default to 45 per Japan day. Preflight rejects any 5/12/4/600 drift. Sent attempts are never refunded.
- Every OpenRouter attempt is bounded to 20 seconds and the complete synchronous Function to 50 seconds. Before each `markSent`, at least the full 20-second provider budget plus a 2-second finalization reserve must remain; otherwise no HTTP is sent and every unsent reservation is released. Timeout, connection loss, or an unknown first result never starts repair; repair is allowed once only when the remaining monotonic deadline leaves room for the second attempt and finalization.
- Terminal failed/constraint/timeout generation ledger metadata and private shopping-mutation replay rows are retained for 30 days; auth continuations expire after 300 seconds. All are cascade-deleted immediately with the Auth user and are cleaned in bounded categories through the dedicated maintenance executor without retaining prompts, raw output, or unbounded free text.
- Never log names, emails, allergies, free-form conditions, prompts, or raw AI responses. Log only request ID, error code, duration, and actual model ID.
- Never store raw AI output. Persist only Zod-validated structures, validation versions, and unresolved label confirmations.
- Current household safety constraints always override historical safety snapshots for history use, regeneration, and shopping-list creation. Stored history text is rechecked against current member/allergy/catalog rules, while post-cook pantry deletion/quantity changes and preference-only changes are non-blocking change details, not retroactive invalidation.
- Deleting a household member nulls the historical target's owner-composite live link while preserving its anonymous ref, display snapshot, actions, and history. Current safety filters null links; regeneration requires at least one surviving current target and must not send or persist deleted-member adaptations, actions, text, or refs in the new candidate.
- Allergy and food-safety validation never produces a “safe” badge or guarantee. Processed ingredients retain explicit label-confirmation records.
- All user-owned public tables have RLS and explicit grants. Shared safety catalogs are authenticated read-only. AI control tables live in a non-exposed `private` schema.
- Browser roles have no direct shopping-item write grants. One authenticated owner RPC checks the rendered list version, applies one item mutation atomically, and increments the list version exactly once.
- A planner submission first flushes debounced autosave and uses the server-returned monotonic `draftRevision`; the canonical command HMAC and atomic new-request reservation bind that revision plus every owner source. Foreign/missing/stale sources fail with one closed error before quota mutation, while an existing same-key replay is resolved first.
- Exact response-loss recovery stores only the validated canonical generation command and recovery metadata in browser storage for a fixed 30-minute TTL, bound to the current user. Read at age `>= 1_800_000` ms, account mismatch, corruption, sign-out, account switch/deletion, or terminal completion deletes it without POST; names, emails, allergies, prompts, and AI output are forbidden.
- Result and shopping safety gates listen to local safety events plus owner-scoped Realtime, focus, visibility, online recovery, and a maximum 60-second periodic check. A signal closes controls immediately; refetch alone never reopens them before server revalidation.
- Plan 1's `HouseholdSettingsPage` remains the only `/settings` route/page owner and keeps complete family CRUD. Plan 6 contributes only `AccountSettingsSection`/DangerZone components composed at the bottom of that page.
- Local development starts through root `docker compose up`; production is Netlify plus managed Supabase.
- Every local browser, callback, Compose, Playwright, and CI continuation origin is exactly `http://127.0.0.1:5173`; generated `.env` and shell overrides may not introduce hostname or alternate-port aliases.
- Migration files contain no top-level `BEGIN`/`COMMIT`; the root local migrator applies each file and its migration-ledger insert in one transaction, and managed Supabase owns its deployment transaction.
- Every behavior change follows red-green-refactor, includes exact focused tests, and ends in a small commit.

---

## Delivery Order

| Order | Plan | Depends on | Independently testable exit |
|---|---|---|---|
| 1 | `2026-07-11-kondate-mvp-01-foundation-auth-household.md` | None | Docker stack and local-only `oauth-mock` start; deterministic Google-style/magic-link auth works; household and privacy data are RLS-protected |
| 2 | `2026-07-11-kondate-mvp-02-menu-domain-pantry.md` | Plan 1 | Safety catalogs, planner draft, household constraints, pantry CRUD, and deterministic emergency menus work without OpenRouter |
| 3 | `2026-07-11-kondate-mvp-03-ai-generation-results.md` | Plans 1–2 | Authenticated generation, quota, idempotent recovery, structured validation, timeline, adaptations, and result UI work against the mock and OpenRouter smoke test |
| 4 | `2026-07-11-kondate-mvp-04-history-regeneration.md` | Plan 3 | Grouped history, provenance-preserving current-safety revalidation, canonical-quota whole/dish regeneration, deterministic replacement composition, deduplication, and selection work |
| 5 | `2026-07-11-kondate-mvp-05-shopping-list.md` | Plans 2–4 | Replay-first creation/reconciliation and owner-versioned item mutation preserve protected edits while re-deriving all warning labels as pending |
| 6 | `2026-07-22-guided-planner-optional-household.md` (Plan ID **7**) | Plans 1–5 | Optional household (`skipped`), `/welcome` + five-step wizard, `TargetMode` household/idea, `generation-command.v2`, idea isolation (no shopping / no `child_friendly`), mode-aware result/history |
| 7 | `2026-07-11-kondate-mvp-06-hardening-deployment.md` (Plan ID **6**) | Plans 1–5 **and** Plan 7 | Full accessibility/E2E/security suite, bounded scheduled maintenance, offline Netlify/type gates, same-SHA staging evidence, and deployment runbooks are ready |

Execute plans in **this table's order**. A plan may begin only after every plan it depends on has passed its full verification command and review gate. Numeric plan IDs in filenames (`01`…`06`) and the guided-planner plan's internal Plan ID **7** are stable labels for handoffs and progress; **delivery sequence is not the same as the `06` filename number** — hardening (Plan 6) runs **after** guided planner (Plan 7).

## Locked File Structure

```text
.
├── .github/workflows/ci.yml
├── compose.yaml
├── Dockerfile
├── netlify.toml
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.functions.json
├── vite.config.ts
├── playwright.config.ts
├── vitest.config.ts
├── infra/supabase/                 # vendored official docker directory at tag v1.26.05
├── scripts/
│   ├── vendor-supabase.sh
│   ├── generate-local-secrets.sh
│   ├── wait-for-supabase.sh
│   ├── verify-openrouter-models.mjs
│   ├── preflight-production.mjs
│   ├── smoke-production.mjs
│   └── verify-release-evidence.mjs
├── shared/
│   ├── contracts/domain.ts
│   ├── contracts/generation.ts
│   ├── contracts/http.ts
│   ├── contracts/shopping.ts
│   ├── safety/allergens.ts
│   ├── safety/food-rules.ts
│   ├── safety/validate-generated-menu.ts
│   └── time/jst.ts
├── src/
│   ├── main.tsx
│   ├── styles.css
│   ├── app/router.tsx
│   ├── app/providers.tsx
│   ├── app/layouts/app-shell.tsx
│   ├── shared/api/api-client.ts
│   ├── shared/config/public-env.ts
│   ├── shared/lib/supabase.ts
│   ├── shared/types/database.generated.ts
│   ├── shared/ui/
│   └── features/
│       ├── auth/
│       ├── privacy/
│       ├── household/
│       ├── pantry/
│       ├── planner/
│       ├── generation/
│       ├── history/
│       ├── shopping/
│       └── account/
├── netlify/functions/
│   ├── _shared/auth.ts
│   ├── _shared/env.ts
│   ├── _shared/http.ts
│   ├── _shared/supabase-admin.ts
│   ├── _shared/supabase-user.ts
│   ├── _shared/generation-service.ts
│   ├── _shared/openrouter.ts
│   ├── auth-continuation-create.ts
│   ├── auth-continuation-deposit.ts
│   ├── auth-continuation-claim.ts
│   ├── generate-menu.ts
│   ├── generate-dish.ts
│   ├── generation-status.ts
│   ├── usage-today.ts
│   ├── confirm-label-confirmation.ts
│   ├── emergency-menus.ts
│   ├── revalidate-menu.ts
│   ├── shopping-list-from-menu.ts
│   ├── shopping-list-preview.ts
│   ├── shopping-list-reconcile.ts
│   ├── shopping-list-revalidate.ts
│   ├── maintenance-cleanup.ts       # schedule code config only; no HTTP path
│   └── delete-account.ts
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   └── tests/database/
├── tools/openrouter-mock/
│   ├── server.mjs
│   └── fixtures/
├── tools/oauth-mock/
│   └── server.mjs
└── e2e/
    ├── fixtures/auth.ts
    ├── fixtures/acceptance.ts
    └── specs/
```

Files may be split further when they exceed one clear responsibility, but these ownership boundaries and import directions are fixed:

```text
shared/contracts  ← browser features and Netlify Functions
shared/safety     ← Netlify Functions and deterministic emergency-menu service
src/features      ← browser only; never imported by Functions
netlify/functions ← server only; never imported by browser code
```

## Shared Domain Contract

Plan 1 creates `shared/contracts/domain.ts` with these exact names. Later plans extend separate files but do not rename these types.

```ts
export const mealTypes = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof mealTypes)[number];

export const cuisineGenres = ["japanese", "western", "chinese", "any"] as const;
export type CuisineGenre = (typeof cuisineGenres)[number];

export const ageBands = [
  "post_weaning_to_2",
  "age_3_5",
  "age_6_8",
  "age_9_12",
  "age_13_17",
  "adult",
  "senior",
] as const;
export type AgeBand = (typeof ageBands)[number];

export const allergyStatuses = ["none", "registered", "unconfirmed"] as const;
export type AllergyStatus = (typeof allergyStatuses)[number];

export const unsupportedDietStatuses = ["none", "present", "unconfirmed"] as const;
export type UnsupportedDietStatus = (typeof unsupportedDietStatuses)[number];

export const generationStatuses = [
  "not_started",
  "processing",
  "succeeded",
  "failed",
  "constraint_conflict",
] as const;
export type GenerationStatus = (typeof generationStatuses)[number];

export const pantryPriorities = ["must_use", "prefer_use"] as const;
export type PantryPriority = (typeof pantryPriorities)[number];

export const changeReasons = [
  "simpler",
  "different_ingredient",
  "child_friendly",
  "different_flavor",
  "custom",
] as const;
export type ChangeReason = (typeof changeReasons)[number];
```

`shared/contracts/http.ts` owns the stable envelope used by every custom API:

```ts
export type ApiSuccess<T> = { ok: true; data: T };

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
```

`shared/contracts/generation.ts` is the only owner of generation wire commands. It exports named request schemas first, then uses those same schema objects in the canonical union:

```ts
export type RegenerateMenuRequest = {
  idempotencyKey: string;
  sourceMenuId: string;
  changeReason: ChangeReason;
  changeReasonCustom: string | null;
  expiredPantryConfirmations: readonly ExpiredPantryConfirmation[];
};
export type RegenerateDishRequest = RegenerateMenuRequest & { dishId: string };
export type GenerationCommand =
  | { kind: "new_menu"; request: NewMenuGenerationRequest }
  | { kind: "regenerate_menu"; request: RegenerateMenuRequest }
  | { kind: "regenerate_dish"; request: RegenerateDishRequest };
```

No Plan 4 module redeclares this union or substitutes `replaceDishId`, `customReason`, or a parallel privacy-version field in a wire request, persisted pending command, or endpoint body. Plan 3 alone may derive its internal, non-serialized `RegenerationExecutionPayload.replaceDishId` from canonical `request.dishId` for orchestration. The canonical usage response returned by `GET /api/usage/today` includes both independent budgets:

`NewMenuGenerationRequest` additionally carries a positive integer `draftRevision`. The browser awaits an autosave flush before constructing a new-menu command; regeneration commands are immutable source/version requests and do not invent a draft revision. `PendingGeneration` stores the complete discriminated command plus `ownerUserId` and `createdAt` under `PENDING_GENERATION_TTL_MS = 1_800_000`; every reader receives the current user and current clock, and never silently substitutes a newer mutable draft.

```ts
export type GenerationUsageData = {
  success: { consumed: number; limit: 5; remaining: number };
  attempts: { sent: number; limit: 12; remaining: number };
  shortWindow: { sent: number; limit: 4; remaining: number; retryAt: string | null };
  globalAvailable: boolean;
  retryAt: string | null;
};
```

This is the exact five-key object owned by Plan 3. Available responses use null retry fields; no `usageDay`, `windowSeconds`, `available`, or parallel quota alias may appear. Browser copy reads `response.data.success.remaining` from the standard success envelope.

`shared/contracts/shopping.ts` exclusively owns `StoreSection`, `ShoppingSourceIngredient`, `ShoppingLabelSnapshot`, `ShoppingDraftItem`, `ShoppingDraft`, `ShoppingItem`, `ShoppingList`, `ShoppingDiff`, `ShoppingListSafetyData`, `CreateShoppingListRequest/Response`, `PreviewShoppingDiffRequest/Response`, `ReconcileShoppingListRequest/Response`, and `ShoppingItemMutationRequest/Response`. Label snapshots carry human `sourceDisplayName`, `allergenDisplayName`, and `memberDisplayName`; browser UI must never derive display copy from source paths, catalog IDs, anonymous refs, or UUIDs. Creation/reconciliation warnings are immutable provenance in `shopping_label_confirmations`; active safety refresh writes a separate latest-only `shopping_current_label_warnings` projection and never deletes provenance. Item mutations carry both the rendered list version and the latest server-issued all-source safety fingerprint; the owner RPC rechecks both under lock.

## API Route Ownership

| Route | Function file | Plan |
|---|---|---|
| `POST /api/auth/continuations` | `netlify/functions/auth-continuation-create.ts` | 1 |
| `POST /api/auth/continuations/:continuationId/callback` | `netlify/functions/auth-continuation-deposit.ts` | 1 |
| `POST /api/auth/continuations/:continuationId/claim` | `netlify/functions/auth-continuation-claim.ts` | 1 |
| `POST /api/generations/menu` | `netlify/functions/generate-menu.ts` | 3 |
| `POST /api/generations/dish` | `netlify/functions/generate-dish.ts` | 4 |
| `GET /api/generations/:idempotencyKey/status` | `netlify/functions/generation-status.ts` | 3 |
| `GET /api/usage/today` | `netlify/functions/usage-today.ts` | 3 |
| `GET /api/emergency-menus` | `netlify/functions/emergency-menus.ts` | 2 |
| `POST /api/menus/:menuId/label-confirmations/:confirmationId/confirm` | `netlify/functions/confirm-label-confirmation.ts` | 3 |
| `POST /api/menus/:menuId/revalidate` | `netlify/functions/revalidate-menu.ts` | 4 |
| `POST /api/shopping-lists/from-menu` | `netlify/functions/shopping-list-from-menu.ts` | 5 |
| `POST /api/shopping-lists/:listId/revalidate` | `netlify/functions/shopping-list-revalidate.ts` | 5 |
| `POST /api/shopping-lists/:listId/preview` | `netlify/functions/shopping-list-preview.ts` | 5 |
| `POST /api/shopping-lists/:listId/reconcile` | `netlify/functions/shopping-list-reconcile.ts` | 5 |
| `DELETE /api/account` | `netlify/functions/delete-account.ts` | 6 |

Each HTTP function uses Netlify’s fetch-style default export and an exact `config.path`; no catch-all API router is introduced.

## Scheduled Function Ownership

| Schedule | Function file | Plan | Bound |
|---|---|---|---|
| `@hourly` | `netlify/functions/maintenance-cleanup.ts` | 6 | 250 rows/category; 20-second DB and 25-second client ceilings |

The Scheduled Function exports `config = {schedule:"@hourly"}` and no `path` because those options are mutually exclusive. It runs only on published production deploys, cannot be invoked by URL, and is debugged locally with `npm exec --offline netlify functions:invoke maintenance-cleanup`.

## Locked Environment Contract

Browser-visible configuration is limited to `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_MAGIC_LINK_RESEND_SECONDS=60`, `VITE_AUTH_CONTINUATION_TTL_MS=300000`, and the authentication-provider switch below. There is **no** `VITE_PRIVACY_POLICY_URL` — privacy copy is an in-app route. No service key, OpenRouter key, continuation encryption key, prompt, or household value may use a `VITE_` prefix.

| Browser auth variable | Local rule | Production rule |
|---|---|---|
| `VITE_AUTH_PROVIDER_MODE` | Exactly `oauth_mock` | Exactly `supabase` |
| `VITE_OAUTH_MOCK_ORIGIN` | Exactly `http://127.0.0.1:8788` | Must be absent |

Compose service `oauth-mock` listens inside the network at `http://oauth-mock:8788`, is exposed to the browser at `http://127.0.0.1:8788`, and answers `GET /health`. Production preflight rejects mock mode, any mock origin variable, and any attempt to point the Supabase mode at the local fixture.

Server configuration uses these exact names and release defaults:

| Variable | Locked production rule/default |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only values for exact managed origin `https://<project-ref>.supabase.co`; production browser/server origins and maintenance ref must all match |
| `SERVER_SITE_ORIGIN` | Canonical HTTPS (or locked local) origin; no path/query/fragment. **Not** duplicated as `APP_ORIGIN` — that name is retired |
| `AUTH_CONTINUATION_ENCRYPTION_KEY` | Server-only base64 value decoding to exactly 32 bytes |
| `GENERATION_REQUEST_HMAC_KEY` | Server-only canonical base64 decoding to exactly 32 bytes; stable key material for **`generation-command.v2`**, never a `VITE_` value |
| `AUTH_CONTINUATION_TTL_SECONDS` | `300` |
| `OPENROUTER_API_KEY` | Server-only secret |
| `OPENROUTER_BASE_URL` | Production must equal `https://openrouter.ai/api/v1` exactly |
| `OPENROUTER_MODELS` | Ordered, unique, explicit `:free` IDs; never `openrouter/auto` |
| `USER_DAILY_AI_LIMIT` | Release-locked `5` successful generations per JST day |
| `USER_DAILY_EXTERNAL_CALL_LIMIT` | Release-locked `12` actual external sends per user/JST day |
| `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT` | Release-locked `4` actual external sends |
| `USER_SHORT_WINDOW_SECONDS` | Release-locked `600` |
| `GLOBAL_DAILY_AI_LIMIT` | Default `45` actual external sends per JST day; operator may lower this positive-integer safety valve |
| `OPENROUTER_TIMEOUT_MS` | `20000` per attempt |
| `FUNCTION_TOTAL_BUDGET_MS` | `50000` total synchronous budget |
| Terminal generation / shopping-mutation retention | Release-locked **30 days**, enforced in maintenance SQL (`interval '30 days'`), **not** an environment variable |
| `AI_PROCESSING_STALE_SECONDS` | Release-locked `180` |
| `SUPABASE_MAINTENANCE_DB_URL` | Functions-only TLS URL: direct `kondate_maintenance_login@db.<ref>:5432` or IPv4 Supavisor Session `kondate_maintenance_login.<ref>@<region>.pooler:5432`; port 6543 is forbidden and the connected `session_user` must be exact `kondate_maintenance_login`; never a build/browser variable |

Retired non-variables (do not reintroduce in preflight or `.env.example`): `APP_ORIGIN` (use `SERVER_SITE_ORIGIN`), `FAILED_GENERATION_LEDGER_RETENTION_DAYS` (hardcoded 30-day SQL), `VITE_PRIVACY_POLICY_URL` (in-app privacy route). `OPENROUTER_MOCK_SCENARIO` is test-only and is honored only with the exact local mock base URL. Plan 6's environment parser and production preflight validate all names and fixed values from an explicit, environment-clean input; they reject leaked `VITE_` secrets, production OpenRouter lookalike URLs, arbitrary/lookalike Supabase hosts, path/query/credential URLs, and browser/server/direct/session project-ref mismatch. Local parsers continue to accept only the explicitly locked Compose origins.

## Migration Order

```text
20260711000100_extensions_and_schemas.sql
20260711000200_profiles_household_privacy.sql
20260711000300_safety_catalogs.sql
20260711000330_auth_continuations.sql
20260711000400_safety_catalog_data.sql
20260711001000_pantry_and_planner_drafts.sql
20260711001100_menu_core.sql
20260711002000_ai_control_and_quota.sql
20260711003000_history_regeneration.sql
20260711004000_shopping_lists.sql
20260712000100_onboarding_completion_boundary.sql
20260712000200_household_allergy_and_continuation_hardening.sql
20260712000300_serialize_member_allergy_deletion.sql
20260715000100_allow_incomplete_unsupported_diet_drafts.sql
20260715000200_custom_allergy_alias_boundary.sql
20260715000300_atomic_household_onboarding_start.sql
# … later Plan 2–5 corrective / data migrations as present under supabase/migrations/
# Plan 7 (guided planner) — actual CLI timestamps on disk (examples; do not invent):
#   20260722120643_optional_household_profiles.sql
#   20260722130029_target_mode_storage.sql
#   20260722225217_generation_command_v2.sql
#   20260722234554_idea_generation_boundary.sql
# Plan 6 (hardening) — create only via:
#   docker compose run --rm --no-deps app npx supabase migration new account_deletion
#   docker compose run --rm --no-deps app npx supabase migration new maintenance_cleanup
# so the CLI timestamps sort **after every Plan 7 file**. Never hand-author
# 20260711005000_account_deletion.sql / 20260711005100_maintenance_cleanup.sql — those
# prefixes apply *before* 20260722* on a clean reset and break Plan 7. Shorthands
# "migration 050/051" in Plan 6 mean ordered logical pairs, not fixed filenames.
# Record each CLI-emitted path in the Task brief/report.
```

Every migration is forward-only, enables RLS in the same file that creates a user-owned table, revokes broad default grants, and grants only the operations required by the corresponding plan.
Migrations `20260712000100`/`20260712000200` are Plan 1 Task 13's correction-gate hardening, ratified after the fact during the Plan 1 whole-branch adversarial review (2026-07-13): the first closes the onboarding-completion consent bypass by revoking direct `authenticated` UPDATE on `profiles` and routing completion through a `set_onboarding_status` RPC; the second normalizes/bounds allergy and auth-continuation-cleanup invariants. They deviate from this table's original date-prefix convention and from Task 13's literal "modify only" file list; this entry is the required human ratification, not a silent edit — see `.superpowers/sdd/progress.md` Task 13 for the review record. Lexical order among *existing* files is authoritative; this table is not a claim that Plan 1 corrections apply after Plan 6 once Plan 6 files exist.
Migrations `20260712000300` and `20260715000100`–`20260715000300` are forward-only corrective migrations ratified by the 2026-07-15 implementation review. In lexical order among files that exist today, they follow `20260712000200`. Plan 6's account-deletion and maintenance migrations must be created with timestamps that sort after Plan 7, not re-use the obsolete `20260711005*` placeholders.
Plan 6 **account_deletion** (logical "050") removes competing composite/non-cascade Auth FKs, adds an exact single-column `user_id → auth.users(id) ON DELETE CASCADE`, then fails deployment if any public/private user-owned relation still violates that exact invariant. It preserves owner-composite FKs to application relations. Plan 6 **maintenance_cleanup** (logical "051") adds bounded canonical cleanup batch helpers plus one RPC executable only by a NOLOGIN maintenance executor; the scheduled Function assumes that role from its dedicated LOGIN session. Applied migrations are never rewritten; a later defect is corrected by a new migration after the current HEAD of the chain. Database type generation always includes both public and private schemas (via the repo's pg-meta generator), and CI fails on drift in either schema.

## Attempt, Idempotency, and Retention Invariants

- New-key reservation atomically verifies owner-scoped draft/source/dish references and `draftRevision` before creating quota or request rows. Existing same-key/HMAC replay is read first. The per-user attempt and global counters become irrevocably sent only immediately before an external request and only when a full 20-second provider window plus 2-second finalization reserve remains. Preflight/deadline failures release every unsent reservation; sent attempts remain counted on success, provider failure, invalid output, disconnect, and timeout.
- One repair may reserve a second user/global attempt only after a complete first response is deterministically invalid and the 50-second deadline can still accommodate a 20-second attempt plus finalization. Timeout or unknown outcome never repairs.
- Idempotency replay is read before stale expected-version checks. The same key plus canonical request hash returns the saved terminal response; the same key with a different hash fails closed.
- Shopping-list creation and reconciliation read replay before menu, pantry, household-safety, active-list, or version state. A committed response lost in transport is automatically read back with the byte-identical persisted command; it never requires a second user click.
- Every shopping item/list warning derived from a menu is canonical `pending` even if the menu source was previously confirmed. Creation/reconciliation warning rows are immutable human source/allergen/member provenance; successful active-list revalidation atomically replaces only a separate latest current projection. Deleted-source read-only UI uses provenance, while action gates use the current projection. Removed or “at home” source rows participate in reconciliation: a known increase becomes a positive delta; an unquantified increase requires explicit pantry review.
- Shopping-item add/check/edit/remove/at-home/undo writes go only through the owner RPC with the rendered expected list version. One success increments the list version once; a competing tab refetches on conflict; direct browser table writes remain revoked.
- Plan 1 exports the household-safety event, revision-storage key, and query prefixes. Plan 4/5 add owner-scoped Realtime plus focus/visibility/online/max-60-second checks. Plan 5 derives exact active key `["shopping","active"]`, invalidates/reloads it on each signal, and disables check/edit/create/reconcile until active-list reload plus server revalidation of every live source menu succeeds. Deleted/unverifiable/invalid sources and fingerprint races remain closed; every item mutation rechecks the returned list fingerprint under lock.
- Generation terminal ledger and shopping mutation replay rows older than 30 days, plus expired/consumed auth continuations older than their 300-second lifetime, are cleaned by the least-privilege maintenance executor. Account deletion cascades all immediately.
- Hourly maintenance invokes bounded canonical cleanup transitions with reentrant batches; stale processing releases success and only unsent external/global reservations, while monitoring exposes counts only.
- Shopping reconciliation preserves protected rows, emits separate positive deltas when a known quantity grows, retains canonical item/list warnings, and rejects a second insertion of the same menu version even under a fresh key.

## Acceptance Coverage Ledger

Plan 6 creates `docs/testing/acceptance-matrix.md` with exactly 22 rows matching specification §17. Every row records an exact automated test file and title; real Google-provider success additionally requires sanitized staging evidence for the same commit SHA.

| Spec # | Primary owner | Required proof boundary |
|---:|---|---|
| 1 | Plan 1 | Compose health, Mailpit, deterministic OAuth/AI fixture E2E |
| 2 | Plans 1, 6 | PKCE/state/continuation adversarial automation plus unexpired real-Google evidence whose staging SHA/origin are read back from Netlify deploy metadata |
| 3 | Plan 1 | 60-second minimum onboarding, resume, settings CRUD, 29-item allergen UI |
| 4 | Plans 1, 3 | Consent gate and recursive prompt DTO no-PII/no-stable-ID test |
| 5 | Plans 2, 3 | Meal/member selection and pre-send safety/pantry-conflict rejection |
| 6 | Plans 2–5 | Current-safety loaders plus finalization/revalidation/shopping race and cross-device detection tests |
| 7 | Plans 2, 3, 5 | All-text-leaf safety, canonical current pending confirmation, immutable shopping provenance/current-projection split, human snapshot UI |
| 8 | Plans 2, 3 | Unsupported/unconfirmed diet and medical-scope preflight rejection |
| 9 | Plans 2, 3 | Pantry priority, quantity/shortage, same-key same-JST expiry, post-cook actions |
| 10 | Plan 3 | Timeline limit and fake-clock 20-second-attempt/2-second-finalize/50-second-total deadline, including no-send budget exhaustion |
| 11 | Plan 3 | Dish tabs, portions/branches, human labels, keyboard navigation |
| 12 | Plan 3 | Before-send/processing/response-loss same-key recovery, 30-minute/user-bound pending command, and draft-revision binding without double counts |
| 13 | Plan 4 | Canonical quota path, full retained/local-ref replacement contract, surviving-member filtering, deterministic composition, reason persistence, and duplicate non-consumption |
| 14 | Plan 4 | Grouping/selection and event/Realtime/focus/visibility/online/60-second current-safety revalidation; pantry/preference drift is non-blocking |
| 15 | Plan 5 | Replay-before-state recovery, human per-operation approval, immutable pending provenance/current projection, removed/protected delta, cross-device all-source revalidation, locked item safety fingerprint, quantity/unit/section editing, pantry matching, undo, no duplicate source |
| 16 | Plans 1–7 then Plan 6 | Owner/RLS/grant matrix, continuation isolation, cross-user negative tests |
| 17 | Plans 3, 5, 6 | Concurrent 5-success/12-daily/4-per-600s/45-global gates and bounded 30-day generation/shopping-replay retention |
| 18 | Plans 2, 3 | No-paid-fallback and complete deterministic breakfast/lunch/dinner emergency menus |
| 19 | Plans 3, 6 | Structural plus live production `:free`/capability verification |
| 20 | Plan 3 | Failure/constraint/timeout/current-safety-change rollback and attempt accounting |
| 21 | Plan 6 | axe, keyboard, live-region, 44px, and 320/375/430px Playwright checks |
| 22 | Plan 6 | Pinned-SHA CI, public/private type and offline Netlify gates, unexpired external Google evidence, and authoritative staging plus production deploy-ID/SHA/origin readback matching tag/candidate |

## Global Verification Gate

Run after every plan:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run db:test
npm run e2e
npm run build
docker compose config --quiet
```

Expected: every command exits 0; Vitest, pgTAP, and Playwright report zero failed tests; Vite produces `dist/`; Docker Compose reports no configuration error.

Plan 6's candidate gate begins with `npm ci` and `./scripts/generate-local-secrets.sh`, installs an `EXIT` cleanup for Compose plus the gitignored `.env`, and additionally runs `npm audit --omit=dev --audit-level=high`, the pinned local `npm exec --offline netlify -- build --offline --context deploy-preview`, production preflight tests, `npm run db:types` followed by a zero public/private generated-type diff, the RLS/grant and bounded-maintenance matrices, and the 22/22 acceptance ledger from a clean worktree. Real Google success is stored only in the strict external artifact; the verifier reads immutable Netlify staging metadata and requires local HEAD, `candidateSha`, `stagingDeploySha`, and `metadata.commit_ref` to match before the artifact's exact 24-hour expiry. Tag and production deploy use that unchanged candidate SHA with no later evidence commit. After publish, a second authoritative metadata readback binds production deploy ID, `commit_ref`, production origin, tag, and candidate; smoke accepts only that returned origin. Production model verification is the only gate allowed to contact OpenRouter, uses an explicit timeout, and queries model metadata rather than generating a menu.

## Official References

- Node 24 LTS: https://nodejs.org/en/about/previous-releases
- Vite 8: https://vite.dev/blog/announcing-vite8
- React 19: https://react.dev/versions
- React Router: https://reactrouter.com/
- React Router 8 release baseline: https://reactrouter.com/start/start/changelog
- Tailwind with Vite: https://tailwindcss.com/docs/installation/using-vite
- Netlify Vite: https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/
- Netlify Functions configuration: https://docs.netlify.com/build/functions/configuration/
- Netlify Scheduled Functions: https://docs.netlify.com/build/functions/scheduled-functions/
- Supabase Docker: https://supabase.com/docs/guides/self-hosting/docker
- Supabase migrations: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase pgTAP testing: https://supabase.com/docs/guides/database/testing
- OpenRouter fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- OpenRouter structured output: https://openrouter.ai/docs/guides/features/structured-outputs
