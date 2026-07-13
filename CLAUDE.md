# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repository. This file is
Claude-Code-specific and supplements `AGENTS.md` (general contributor conventions,
build/test commands, coding style). Read both; this file governs _process_, `AGENTS.md`
governs _style_.

## What this repository is

こんだて日和 (Kondate) MVP — a mobile-first React/Vite SPA backed by Supabase and
Netlify Functions. The full product spec and the six-plan delivery roadmap are the
only sources of truth for scope and design:

- Design spec: `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md`
  (baseline commit `cd0cb70` or a later commit that only clarifies it — never a
  silent fallback to older wording).
- Roadmap: `docs/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md`
- Plans 1–6: `docs/superpowers/plans/2026-07-11-kondate-mvp-0{1..6}-*.md`

Plans execute strictly in order (1 → 2 → … → 6); a plan begins only after the prior
plan's full verification gate and review pass. Within a plan, Tasks execute in
numeric order — do not skip ahead or reorder because a later Task looks easier.

**Never re-derive or simplify the design.** These documents were produced through an
adversarial review process and contain exact values (ports, origins, TTLs, quotas,
schema names, route paths) that look like they could be tightened or generalized —
they can't. If a plan step's literal code or exact value seems wrong, redundant, or
overcautious, that is a signal to ask the human before changing it, not to "improve"
it silently.

## Required per-Task workflow

Exactly one Task per work session unless the human explicitly asks for more. For
each Task:

1. **Read first**: the full text of the target Task, plus the contracts/interfaces
   of any Task it depends on (check "Consumes:" in the Task header and the plan's
   "Locked interfaces produced by this increment" section). Do not start from
   memory of a prior session.
2. **RED**: write the failing tests the plan specifies (plan Task text usually gives
   exact test code — transcribe it, don't invent alternatives).
3. Run the tests in Docker and confirm they fail for the expected reason (missing
   module/export), not a typo.
4. **GREEN**: implement the minimum code to pass, following the plan's given code
   where the plan supplies it verbatim.
5. **REFACTOR**: clean up only within the scope of this Task.
6. **検証 (verify)**: run the Task's focused tests, `typecheck`, `lint`,
   `format:check` (and any migration/pgTAP the Task adds) in Docker. Use
   `format:check`, not `format` — the latter is `prettier --write .` and mutates
   files, which is not a verification step.
7. **レビュー (review)**: a read-only pass over the diff for spec compliance and
   quality before/around commit — see `SubAgents.md` for how to structure this with
   subagents.
8. `git diff --check` and `git status --short` before committing.
9. **Commit**: one Conventional Commit in Japanese (see `AGENTS.md` for format and
   examples). Historically a Task may end as an implementation commit plus a small
   `fix:` follow-up once review finds something — that is fine; re-running the
   full workflow for the fix is not required, but the fix still needs its own
   focused verification.

Track progress in `.superpowers/sdd/progress.md` (git-ignored). Before starting,
read it and `git log` to see which Tasks are already complete — never re-implement
a Task the ledger marks done. If the ledger and `git log` disagree, trust `git log`.
Match the existing file's own style rather than a fixed template: it records one
line per Task with either `complete` (commit hash(es), review clean) or
`implemented` (work landed but something — e.g. a missing `pg_prove` binary, a
deferred cross-Task wiring — kept verification partial); keep using `implemented`
honestly instead of forcing `complete` when a follow-up is still owed.

## Global constraints (condensed — the plan files are authoritative)

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
- OpenRouter is called only from Netlify Functions, only `:free` model IDs, never
  `openrouter/auto`.
- Never log or persist names, emails, allergies, free-form conditions, prompts, or
  raw AI output. Only Zod-validated structures are stored.
- Current household safety constraints always override historical snapshots.
- Allergy/food-safety checks never produce a "safe" guarantee.
- All user-owned public tables have RLS + explicit grants; shared safety catalogs
  are authenticated read-only (not user-owned, still not open-write); AI control
  tables live in a non-exposed `private` schema.
- Release-locked quota anchors (verify exact current values in the roadmap's
  Locked Environment Contract before relying on them): 5 successful generations
  per JST day, 12 external AI sends/day and 4 per 600s per user, 45/day
  application-wide default, 20s per OpenRouter attempt / 50s total Function
  budget, 300s auth-continuation TTL, 30-day retention for terminal
  generation/shopping-replay rows.
- Ownership boundaries are fixed: `shared/contracts` ← browser + Functions;
  `shared/safety` ← Functions + emergency-menu service; `src/features` ← browser
  only; `netlify/functions` ← server only. Do not cross these.
- Locked interfaces, API route ownership, and migration order (see the roadmap's
  tables) are not renegotiable within a Task — a Task that seems to need a locked
  interface changed is a signal to stop and ask, not to change it.

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
Anything that hits the real stack — `db:test`, `db:push`, `e2e`, or a Vitest
spec that itself calls Supabase/oauth-mock/openrouter-mock — needs the full
stack already up (`docker compose up -d --wait`) and should run as
`docker compose run --rm app npm run <script>` (no `--no-deps`), or via the
already-running `app`/`db-test` containers, not in isolation.

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
