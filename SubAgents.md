# SubAgents.md

How to use subagents when implementing Kondate MVP plan Tasks in this repository.
This project's plans explicitly recommend `superpowers:subagent-driven-development`
(fallback: `superpowers:executing-plans` in a separate session). This file is the
project-specific policy layered on top of that skill — read the skill for the full
mechanics (task-brief/review-package scripts, ledger format, status handling); read
this file for how it applies here specifically.

## Required three-role split

Every Task that uses subagents splits work into three roles that never edit the
same files at the same time:

1. **Implementer** — reads the Task brief, writes RED tests, confirms failure in
   Docker, implements GREEN, refactors, runs the Task's own focused
   test/typecheck/lint/format in Docker, self-reviews, commits. Full read/write/bash
   access scoped to the Task's listed files.
2. **Reviewer (read-only)** — reads the committed diff (via a `review-package`
   file, never by re-deriving it with ad hoc `git` commands) and reports two
   verdicts: spec compliance against the Task's "Interfaces"/acceptance text, and
   code quality. No edits. Findings are Critical/Important/Minor; Critical and
   Important block completion.
3. **Verifier** — independently re-runs the Docker commands the Task specifies
   (focused tests, `typecheck`, `lint`, `format:check`, migration/pgTAP if the Task
   touched the database) against the implementer's commit and reports pass/fail
   with the actual command output. No edits. This is separate from the
   implementer's own pre-commit run — it exists to catch "worked on my machine"
   drift and to give the human independent evidence. This third role is a
   project-specific addition on top of the skill: `superpowers:subagent-driven-development`
   itself only defines two subagent roles per task (implementer, and a
   task-reviewer that reports both spec-compliance and quality) — the working
   instructions for this project add the verifier as a further split, they are
   not something the skill or the design/plan documents mandate on their own.

If the reviewer or verifier finds Critical/Important issues, dispatch a **fix**
(the implementer role, re-entered) with the specific findings, then re-run verifier
and reviewer against the new commit. Never move to the next Task with an open
Critical/Important finding.

## Per-Task dispatch sequence

1. Check `.superpowers/sdd/progress.md` and `git log`; skip Tasks already marked
   complete.
2. Extract the Task's full text to a brief file (the skill's `task-brief` script,
   or an equivalent manual extraction) — never paste the whole plan file into a
   subagent prompt.
3. Dispatch the implementer with: where the Task sits in the plan (one sentence),
   the brief file path, interfaces/decisions from earlier Tasks the brief can't
   know (exact exports, exact values), and a report-file path/contract. It will
   report one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED` — see
   the skill's "Handling Implementer Status" for how to react to each; only a
   `DONE` (or a resolved `DONE_WITH_CONCERNS`) moves on to step 4.
4. On `DONE`, generate the review package for the Task's commit range
   (`review-package <base> <head>` — `<base>` recorded before dispatch, never
   `HEAD~1`).
5. Dispatch the verifier with the package path and the Task's exact verification
   commands (from its "Step 6"/"Run:" block). It reports, per command, pass/fail
   plus — on failure only — the specific error/diff excerpt, never a bare
   "passed" and never the full raw log; the report file is what the controller
   reads, so keeping it to a summary is what keeps large Docker output (e2e,
   db:test, whole-repo lint) out of the controller's context.
6. Dispatch the reviewer with the same package path, the brief, the report file,
   and the plan's Global Constraints relevant to this Task copied verbatim (not
   summarized) as its attention lens.
7. If either comes back with Critical/Important findings, dispatch one fix
   subagent with the complete combined findings list (not one fixer per finding),
   then repeat steps 4–6 against the new commit.
8. Append one line to `.superpowers/sdd/progress.md`, matching the existing
   file's own style (it uses single commit hashes and, where relevant,
   `implemented` instead of `complete` when something stayed partially
   unverified — e.g. missing `pg_prove` in the runner image) rather than a
   fixed template. Mark the todo complete.
9. Report to the human in the fixed format:
   `[Plan N / Task M]` with 実装/検証/レビュー/Commit/未実施・ブロッカー/次.

## Model selection

- **Implementer, mechanical Tasks** (plan text supplies complete code to
  transcribe, 1–3 files, no cross-cutting judgment): cheapest available tier.
  Most Kondate plan Tasks are written this way — the Task text is nearly literal
  source.
- **Implementer, integration Tasks** (multiple files, must reconcile with
  existing Task 1–N exports, ambiguity in how a mock/fixture should look):
  standard tier.
- **Reviewer**: standard tier normally; scale up for auth/RLS/money-shaped Tasks
  (continuation handoff, quota, payment-adjacent quota, RLS policies) where a
  missed finding is expensive.
- **Verifier**: cheapest tier that can reliably run and report shell output —
  this role does not need judgment, only faithful execution and reporting.
- **Final whole-branch review** (end of a Plan, not a Task): most capable
  available model.

Apply model selection in this order:

1. If the surface can select a named custom agent, use the model and
   `model_reasoning_effort` explicitly defined by that agent TOML. An omitted
   value intentionally inherits the parent session setting.
2. If the surface exposes a per-dispatch model override, the controller may
   override the inherited or agent-file value to match the Task tier above.
3. If neither custom-agent selection nor a model override is available, do not
   infer the effective model. Use the available generic subagent with the exact
   role constraints and report the fallback only when it materially affects the
   final confidence or cost claim.

Treat custom-agent selection, model selection, reasoning effort, and permission
as independent capabilities. A matching `task_name` labels a thread; it is not
evidence that a same-named custom agent or its TOML settings were loaded.

## File handoffs (keep the controller's context clean)

- Task brief → `task-N-brief.md`; implementer report → `task-N-report.md`
  (same stem). Fix rounds append to the same report file.
- Reviewer/verifier get file paths, not pasted diffs: the review-package file plus
  the brief and report paths. Verifier reports stay to pass/fail-plus-excerpt (see
  step 5 above) — never a dumped raw log, since the controller reads this file
  directly into its own context.
- Never paste a prior Task's accumulated summary into a new Task's dispatch — a
  fresh subagent needs this Task's brief, the few exact prior exports it consumes,
  and nothing else.

## Hard rules specific to this project

- Never let two subagents (implementer + anyone else) hold write access to the
  repo at the same time. Reviewer and verifier are strictly read + Docker-run.
- Never dispatch a reviewer or verifier without a generated diff/package file —
  no subagent re-derives the diff with ad hoc `git diff` calls in its own prompt.
- Never pre-judge a finding in the dispatch prompt ("don't flag X", "treat as
  Minor") — let the reviewer raise it; adjudicate afterward, including asking the
  human when a finding conflicts with what the plan's text literally mandates.
- Never let a subagent push, open a PR, or touch `main` protections — those stay
  with the human-facing session, not delegated work.
- Never let a subagent redefine a locked cross-Task export (e.g. Task 7's
  `AuthFlow`, `ContinuationApi`, `ownedAuthStoragePrefixes`) — brief every
  implementer to extend, not recreate, these.
- All commit messages and code comments produced by any subagent follow this
  project's Japanese conventions (see `AGENTS.md`); English identifiers and test
  titles remain in English.
