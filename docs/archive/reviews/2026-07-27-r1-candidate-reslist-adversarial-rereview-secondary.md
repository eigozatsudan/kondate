# Secondary Adversarial Re-Review (post-fix): R1 reslist

- **Date**: 2026-07-27
- **Role**: secondary re-review (clean context — independent of design-loop, prior secondary authorship session, and primary re-review drafting)
- **Design (CURRENT revision)**: `docs/archive/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md`
- **Prior primary**: `docs/archive/reviews/2026-07-27-r1-candidate-reslist-adversarial-primary.md` (REVISE; I-1…I-7 + M-1…M-6)
- **Prior secondary**: `docs/archive/reviews/2026-07-27-r1-candidate-reslist-adversarial-secondary.md` (REVISE; blocking I-1…I-6 + A-I1; I-7 → Minor)
- **Primary re-review**: `docs/archive/reviews/2026-07-27-r1-candidate-reslist-adversarial-rereview-primary.md` (APPROVE_WITH_NITS; N-M1…N-M4)
- **Code cross-check**: `scripts/benchmark-paid-openrouter-models.mjs` (`main` still always full frozen configs; no `--trial-count` / `--configurations-json` today)

**Constraints honored**: product tree read-only except this review file; no paid OpenRouter; no secrets; no raw model output.

---

## Verdict: **APPROVE_WITH_NITS**

## Summary

Independent full re-read of the post-REVISE design confirms that every prior **blocking** Important (I-1…I-6 and A-I1) is **FIXED** with citable KD rows, normative procedure text, fail-closed tables, and PR reject policy. Prior Minors M-1…M-6 are **FIXED**. I-7 remains intentional optional preflight (Minor; not re-elevated). No new Critical or Important was found. Parent locks (20s/50s/22s, quotas, AND, $0.50, official base, no free/router, N=10-only ship, no recombine) are intact. Design correctly requires eligible-set CLI in PR-R1-2 without claiming it exists in current `main()` (re-verified: L371–378 always passes `paidOpenRouterModelConfigurations`, no argv config parse). Primary re-review nits N-M1…N-M4 are **confirmed as Minor**; none upgraded. Human approval and implementation planning may proceed.

---

## Disposition table

| ID | Prior severity | Now | Notes |
|----|----------------|-----|-------|
| **I-1** | Important | **FIXED** | KD-R1-14; §5.2.0.1 forbids equating chat 1 MiB/5s with full-catalog enumeration; ways A (pagination + end condition) / B (Stage-1 ≥60s, ≥8 MiB, offline only); completeness proof required; incomplete → §5.8.1 fail-closed. Live union refilter remains separate. |
| **I-2** | Important | **FIXED** | KD-R1-15; §5.3.1 表 A (ID 除外) vs §5.3.2 表 B (構成制約); CFG-REPAIR-SLOW: shortlist OK, `configuration[1]` 機械禁止; explicit note that old “not on shortlist” reading is wrong; CFG-R4-EXACT is config-set only; §5.5.1 + freeze assert. |
| **I-3** | Important | **FIXED** | KD-R1-8 / KD-R1-18; §5.6.4 R1-required CLI (`--trial-count` / `--configurations-json`) or env + runbook one-liner; C 削減 same path; temporary source edit forbidden; PR-R1-1+2 *「CLI 無しの定数 PR は reject」*. Does **not** claim code has CLI today — correct vs `main` L371–378. |
| **I-4** | Important | **FIXED** | KD-R1-7; repair re-entry / `configuration[1]` placement: normative **n≥3**, **全サンプルおよび p95** `elapsedMs < 12_000`, production harness + official base + current wire. n≥1 floor removed. |
| **I-5** | Important | **FIXED** | KD-R1-16; §5.4 decision record: `rankingTable` L/S/J/C **1..n 序数**, `pairCandidatesConsidered` adopt/reject codes, `rejectedFromShortlist`, `approver`, `disagreementNote`. Bit-identical shortlists still not required (correct). |
| **I-6** | Important | **FIXED** | KD-R1-17; committed survivor artifact fields (§5.2.0.2); §5.5.1 `set(candidateModelIds) ⊆ survivors[].id`; freeze must assert; optional `models_response_sha256`. |
| **I-7** | Minor (secondary downgrade) | **FIXED (as Minor intent)** | Goal 5 + Open Q #2 + §5.6.3 keep N=1 **任意（推奨）**; hard-limit still `est_pass_all` including preflight (KD-R1-13). Not re-elevated; cost efficiency only. |
| **A-I1** | Important | **FIXED** | KD-R1-6; §5.3.0 **closed** class-B ID list (5 IDs; design-PR to extend); EX-B re-entry **n≥3** + all samples and p95 `< 12_000` — aligned with repair bar. |
| **M-1** | Minor | **FIXED** | §5.8.1 catalog enumeration failure row (non-OK / timeout / byte cap / invalid JSON / no completeness proof) → stop, no constants PR, no N=10. |
| **M-2** | Minor | **FIXED** | Header no longer “設計レビュー合意済み”; now *「Ready for approval（敵対レビュー指摘反映済み・人間承認待ち・未実装）」* — accurate post-REVISE absorption pending human approval. |
| **M-3** | Minor | **FIXED** | §10.1 Docker-wrapped `node --test` / typecheck / lint / format:check. |
| **M-4** | Minor | **FIXED** | §5.3.0 normative closed EX-B list; additions require design PR. |
| **M-5** | Minor | **FIXED** | §5.6.4 copy-paste Docker one-liners for preflight and N=10 eligible JSON. |
| **M-6** | Minor | **FIXED** | KD-R1-13; §8.1 gates **有料 chat（preflight および N=10）**; preflight-only batch needs `est_pass_all` yes before start; no “preflight first, hard-limit later.” |

---

## Adjudication of re-review nits (primary N-M1…N-M4)

| ID | Primary severity | Secondary adjudication | Notes |
|----|------------------|------------------------|-------|
| **N-M1** | Minor — EX-404 re-entry n≥1 vs n≥3 for EX-B/repair | **CONFIRM Minor** — do **not** upgrade | HTTP 200 under `require_parameters` is binary availability, not load-sensitive latency. One real 200 is stronger class-evidence than one sub-20s sample for class B. Optional polish: n≥3 for consistency **or** one sentence stating intentional asymmetry. Not lock/ship risk. |
| **N-M2** | Minor — CFG-REPAIR-SLOW example-led, not closed list like §5.3.0 | **CONFIRM Minor** — do **not** upgrade | Only evidence-backed repair-timeout ID is `openai/gpt-oss-120b`; mechanical `configuration[1]` ban + decision-record `exConfigRulesApplied` still apply. Polish: closed one-row set or “all plan8/R1 evidence repair generation_timeout IDs” so freeze fixtures cannot omit future members. |
| **N-M3** | Minor — preflight timeout/unavailable drop still “推奨” | **CONFIRM Minor** — do **not** upgrade | Preflight itself optional (I-7 accepted). KD-R1-8 forces “when excluded → not in N=10” but does not force exclusion. Cost waste only; ship bar remains N=10; eligible CLI records actual JSON. Optional polish: if preflight *is* run, make timeout/unavailable **mandatory** drop. |
| **N-M4** | Minor — sequenceDiagram abstract on eligible CLI | **CONFIRM Minor** — do **not** upgrade | Prose §5.6.4 / rollout stages 3–4 / §13 are clear; diagram-only abstraction. |

No nits upgraded to Important. No nits rejected as invalid.

**Wording note (agree with primary; not a finding):** §5.7 phrases recommendation as first PASS in **frozen** config order; CLI subset uses **JSON** order passed to `runPaidBenchmark`. Same code semantics (`passedConfigurations[0]`). Runbook should state “eligible JSON order = eval order.” Acceptable.

---

## Additional findings

**None (Critical or Important).**

Adversarial hunt performed (no new blocking items):

| Area | Result |
|------|--------|
| Silent ship without N=10 / recombine / env on 0 PASS | Closed — §3.2, §5.7, §5.8.2, §17 |
| Must LOCK vs parent quotas / time / AND / $0.50 / official base / no free-router | Preserved — §3.3 |
| Design claims CLI exists in tree today | **No** — PR-R1-2 requirement; `main` L371–378 verified full frozen only |
| Catalog completeness after rewrite | Normative + fail-closed; chat-cap category error corrected |
| EX table A/B / shortlist vs repair-slow contradiction | Resolved |
| Class-B / repair re-entry n≥1 | Replaced by n≥3 + 12s headroom |
| Free-form freeze without decision record | Decision record mandatory |
| survivors → frozen honor-system only | Freeze assert required |
| Runtime CLI C-cut vs KD-R1-11 | §8.1 requires re-check; temporary eligible subset is gate exploration, not ship; recommended still exact PASS order only |
| Privacy / secrets in evidence | Closed fields; keys/prompt/raw forbidden |
| Hard-limit C=6 full 2-ID vs $1 | Still correctly blocked via `est_pass_all` |
| cardinality_waiver | Named approver (Open Q #6); still no ship without N=10 |
| J-axis 0/N residual | Product risk admitted → R2; not R1 silent-ship |

---

## Net blocking Critical / Important remaining

| Severity | Remaining blocking |
|----------|-------------------:|
| Critical | **0** |
| Important | **0** |

**Residual non-blocking Minors:** N-M1…N-M4 only (optional polish).

---

## Agreement / disagreement with primary re-review

| Topic | Secondary position |
|-------|--------------------|
| Verdict **APPROVE_WITH_NITS** | **Agree** |
| All of I-1…I-6 + A-I1 **FIXED** | **Agree** with same design citations (KD-R1-6/7/8/14–18, §5.2.0.1, §5.3.0–5.3.2, §5.4 record, §5.5.1, §5.6.4, §5.8.1, §8.1, §13) |
| M-1…M-6 **FIXED** | **Agree** |
| I-7 not re-elevated | **Agree** — intentional optional preflight + `est_pass_all` bound |
| N-M1…N-M4 as Minor only | **Agree** — none upgraded |
| No new Critical/Important | **Agree** after independent hunt |
| CLI may be design-required in PR without existing in tree today | **Agree** — correct; code check confirms absence |
| Human approval / plan may proceed | **Agree** |

**No material disagreement** with the primary re-review. Secondary independently re-derived the same FIXED dispositions and the same four Minor polish items; found no additional blocking defects.

---

## Strengths of the revision (secondary)

1. Structural KD-R1-14…18 map 1:1 to prior blocking IDs — not cosmetic wording.
2. Catalog enumeration category correction (chat body-cap ≠ full pool) closes the largest Stage-1 divergence.
3. EX A/B split ends oss-120b shortlist contradiction; repair-slot ban is freeze-testable.
4. Eligible CLI is R1-required tooling with reject-if-missing PR policy; matches current code reality (`runPaidBenchmark` accepts overrides; `main` does not).
5. Class-B and repair re-entry bars are load-realistic (n≥3 + 12s).
6. Decision record + survivors ⊆ freeze make Stage-1 reviewable without bit-identical human ranking.
7. Hard-limit covers preflight + full-pass; optimistic unit-1 gate still forbidden.
8. Honest residual J-axis risk stays outside R1 ship clauses.

---

## Final one-paragraph verdict

**APPROVE_WITH_NITS** — secondary re-review finds **0 Critical and 0 Important remaining**: prior blocking set (I-1…I-6 + A-I1) and Minors M-1…M-6 are **FIXED** in the current design with citable KDs and procedures; I-7 stays intentional Minor; primary nits N-M1…N-M4 confirmed Minor with no upgrades; no new Important/Critical. Human approval and the implementation plan may proceed; residual nits are non-blocking polish.
