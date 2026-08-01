# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repository. This file is
Claude-Code-specific and supplements `AGENTS.md` (general contributor conventions,
build/test commands, coding style). Read both; this file governs _process_, `AGENTS.md`
governs _style_.

Where AGENTS.md itself contains process content that conflicts with this file, this
file wins. In particular, AGENTS.md §4 ("実装の進め方") step 2's instruction to run
`/compact` after each Task does not apply here: `/compact` is a user-invoked harness
command that an agent cannot trigger on itself or on a dispatched subagent, and Claude
Code already auto-compacts context as it approaches its limit (see "Context
management" below). Follow this file's "Required per-Task workflow" as the
authoritative per-Task process instead — including its own review-against-the-prior-Task
step, which replaces AGENTS.md §4 step 2's review instruction — and skip the `/compact`
step entirely.

## What this repository is

こんだて日和 (Kondate) — a mobile-first React/Vite SPA backed by Supabase and
Netlify Functions (Plus billing via Stripe). MVP delivery and many follow-on
increments are **already implemented**.

### Authority (read this first)

1. **Implementation is the source of truth** for behavior and locked values:
   `src/`, `netlify/functions/`, `shared/`, `supabase/migrations/`, tests, `e2e/`.
2. **Agent process / style**: this file + `AGENTS.md` + `SubAgents.md`.
3. **Operational docs** (local dev, deploy, runbooks, testing): see `docs/README.md`.
4. **`docs/archive/`** — historical Superpowers plans/specs, adversarial reviews,
   gate evidence. **Do not open by default.** Use only for archaeology when the
   human asks about past decisions. Never override implementation with archive text.

Exact values (ports, origins, TTLs, quotas, schema names, route paths, model
allowlists) live in code and contracts (especially `shared/contracts/`). If a
value looks overcautious or redundant, **ask the human** before changing it — do
not "tighten" or generalize silently. Historical design/plan wording in
`docs/archive/` is not an excuse to re-litigate shipped behavior.

Doc map for agents: **`docs/README.md`**.

### When the human assigns a plan Task

If (and only if) the human points at a specific plan Task to execute, follow that
Task text and `SubAgents.md`. Do not browse `docs/archive/superpowers/plans/` to
invent the next Task. Prefer one Task per work session unless the human asks for
more. Progress ledger (optional, git-ignored): `.superpowers/sdd/progress.md` —
if it disagrees with `git log`, trust `git log`.

Typical Task loop when doing plan-driven work: read Task → RED tests → GREEN
minimum implementation → focused verify (`format:check`, lint, typecheck, focused
tests; use `format:check` not `format`) → review → Conventional Commit in Japanese.

## Global constraints (condensed — verify exact numbers in code/contracts)

- Node.js `>=24 <25` only; ESM; TypeScript `strict: true`, no `any` or unchecked
  casts at network/DB boundaries.
- React 19.2.7+, Vite 8, Tailwind CSS 4, React Router 8 Data Mode
  (`RouterProvider` from `react-router/dom`, everything else from `react-router`),
  TanStack Query 5.
- All user-facing copy is Japanese. Code, comments, commit messages, and test names:
  comments and commit messages in Japanese per this project's own convention (see
  `AGENTS.md`); identifiers/test titles in English.
- Mobile-first at 320 CSS px, no horizontal scroll, 44×44 CSS px touch targets.
- One canonical local origin `http://127.0.0.1:5173`; browser Supabase
  `http://127.0.0.1:8000`; Function-side Compose URL `http://kong:8000`. Production
  accepts only the exact managed `https://<20-char-project-ref>.supabase.co`.
- OpenRouter is called only from Netlify Functions. Production `OPENROUTER_MODELS`
  is a **paid allowlist** (no `:free` on real-API paths; never `openrouter/auto` or
  equivalent routers). Mock `mock/*:free` is allowed only when
  `OPENROUTER_BASE_URL` is the exact local mock URL. Models must support both
  `structured_outputs` and `response_format`, with prompt+completion ≤ $4.00/1M.
  Free-only production models were abolished (paid allowlist only on real API).
- Never log or persist names, emails, allergies, free-form conditions, prompts, or
  raw AI output. Only Zod-validated structures are stored.
- Current household safety constraints always override historical snapshots.
- Allergy/food-safety checks never produce a "safe" guarantee.
- All user-owned public tables have RLS + explicit grants; shared safety catalogs
  are authenticated read-only (not user-owned, still not open-write); AI control
  tables live in a non-exposed `private` schema.
- Release-locked quota anchors (verify exact current values in
  `shared/contracts/plan-quota.ts`, env, and preflight — do not invent from
  memory): freemium daily generation success limit, per-user AI send limits,
  application-wide daily AI default, OpenRouter attempt budget / Function total
  budget (see `shared/contracts/function-budget.ts`; Netlify sync 60s wall),
  auth-continuation TTL, retention for terminal generation/shopping-replay rows.
- Ownership boundaries are fixed: `shared/contracts` ← browser + Functions;
  `shared/safety` ← Functions + emergency-menu service (full allergen evaluation,
  food-rules, validate-generated-menu, generation hard gates; evaluation pipelines
  stay Functions-oriented — do not import into `src/`); `shared/safety-pure` ←
  browser + Functions pure UX pre-checks only (`medical-scope`,
  `normalize-food-text`, `preference-gaps` display soft gaps; no hard safety
  authority). Browser must import pure modules only from `@shared/safety-pure/*`
  (or contracts for shared types such as `ExpiredPantryConfirmation`); never
  `@shared/safety/*`. Server may import from `safety-pure` or thin re-exports under
  `shared/safety` for back-compat. Intentional dual-surface non-safety packages for
  the browser: `shared/shopping`, `shared/emergency` (contracts/filter as designed),
  `shared/copy`, `shared/time`, `shared/season`. `src/features` ← browser only;
  `netlify/functions` ← server only. Do not cross these.
- Locked interfaces, API route ownership, and migration order already in the
  tree are not renegotiable casually — needing to redefine a locked export or
  cross an ownership boundary is a signal to stop and ask, not to change it.

## Hard prohibitions

- No `git push`, no PR creation, no production/staging deploy.
- No destructive git operations (`reset --hard`, `push --force`, `clean -f`,
  branch deletion) without explicit user confirmation in the moment.
- No skipping hooks (`--no-verify`) or bypassing signing.
- No redefining Task 7's `AuthFlow`/`ContinuationApi`/`AuthProvider`/
  `BrowserSupabaseClient`, or any other cross-Task locked export — extend, don't
  recreate.
- No hand-editing generated files: `package-lock.json`, `infra/supabase/**`,
  `src/shared/types/database.generated.ts`.
- No `VITE_`-prefixed secrets, service keys, or provider keys in browser-visible
  config.

## Running Node commands

This is a working-session convention for agent-driven work, not something the
plan Task text itself shows — the plans write these commands bare (e.g. `npm
test -- --run ...`) because they assume a host checkout. Run them through
Docker instead, using the `app` service defined in `compose.yaml`, so results
don't depend on whatever happens to be installed on the host:

```bash
docker compose run --rm --no-deps app npm test -- --run <files>
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

`--no-deps` is safe only for these host-independent commands (pure unit tests,
typecheck, lint, format:check) that don't talk to Postgres or the local mocks.

A Vitest spec that itself calls Supabase/oauth-mock/openrouter-mock needs the full
stack already up (`docker compose up -d --wait`) and can then run inside the `app`
container without `--no-deps`, e.g. `docker compose run --rm app npx vitest run
<file>` — this only makes network calls to already-running sibling containers, so
routing it through `app` is fine.

`db:test`, `db:push`, and `e2e` are different: their `npm run` scripts each shell
out to `docker compose` themselves (`db:test` → `docker compose run --rm db-test`;
`db:push` → `docker compose run --rm migrate`; `e2e` → `playwright test`, normally
invoked via `./scripts/run-e2e.sh`, which itself drives a dedicated `e2e` Compose
service). The `app` container has no Docker socket mounted (see `compose.yaml` —
no `docker.sock` bind, not `privileged`), so `docker compose run --rm app npm run
db:test` (or `db:push`/`e2e`) cannot reach the Docker daemon and fails or hangs.
Run these as the underlying `docker compose` command directly on the host instead,
never wrapped in `npm run` inside `app`:

```bash
docker compose --profile test run --rm db-test
docker compose run --rm migrate
./scripts/run-e2e.sh
```

This matches `AGENTS.md` §8's own verification-flow commands and is the only
combination confirmed to work end-to-end.

If a Docker prerequisite is missing (e.g. `pg_prove` in the runner image, a
local password mismatch), record it as a known blocker in the progress ledger
rather than silently skipping or faking a pass.

## Keeping verification output cheap on tokens

Docker output (especially `e2e`, `db:test`, a whole-repo `lint`/`typecheck`, or a
wide `vitest run`) can be hundreds of lines. Default to scoping every command to
the Task's own files, as the examples above already do — never run the whole
suite when the Task's files narrow it. When a run is still expected to be large:

- Redirect to a file and pull only the summary/failures into context, e.g.
  `docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1 ; grep -nE 'error|FAIL' /tmp/lint.log || tail -n 60 /tmp/lint.log`.
- For `e2e`, a full `db:reset && db:test`, or anything else likely to exceed a
  couple hundred lines, ask the human to run the exact command in their own
  terminal and paste back the summary/failures, rather than running it through
  the agent's own Bash tool. State which command and why before asking.
- Prefer routing such runs through the verifier subagent (see `SubAgents.md`)
  even within a single-session Task — its report is a pass/fail summary, not
  the raw log, so the raw output never enters the controller's context.

This changes only how command output reaches context — it does not relax which
commands 検証 (step 6) requires.

## Delegating to subagents

See `SubAgents.md` for the required implementer/reviewer/verifier split, model
selection, and file-handoff conventions used on this project.
