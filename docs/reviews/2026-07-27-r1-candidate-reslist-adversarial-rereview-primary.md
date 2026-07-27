# Adversarial Re-Review (post-fix): R1 reslist design

- **Date**: 2026-07-27
- **Role**: primary re-review (clean context — no design-loop conversation; no prior approval assumed)
- **Design (CURRENT revision)**: `docs/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md`
- **Prior primary**: `docs/reviews/2026-07-27-r1-candidate-reslist-adversarial-primary.md` (Verdict: REVISE; I-1…I-7 + M-1…M-6)
- **Prior secondary**: `docs/reviews/2026-07-27-r1-candidate-reslist-adversarial-secondary.md` (Verdict: REVISE; net blocking I-1…I-6 + A-I1; I-7 → Minor)
- **Cross-checked**:
  - Parent: `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md` §4.1 / §4.4 / locks
  - Code: `scripts/benchmark-paid-openrouter-models.mjs` (`main` still always full frozen configs + default trialCount; **no CLI today**)
  - Prior findings only as adjudication targets; design text re-read in full

**Constraints honored**: read-only product tree except this review file; no paid OpenRouter; no secrets; no raw model output; no product code edits.

---

## Verdict: **APPROVE_WITH_NITS**

## Summary

The post-REVISE design **absorbs every net-blocking Important** from secondary (I-1…I-6 and A-I1) with explicit KD rows, normative procedure text, fail-closed tables, and PR-level tooling requirements. It does **not** claim the eligible-set CLI exists in current `main()` — it correctly requires CLI (or env equivalent + runbook one-liner) as **R1-required in PR-R1-2**, and forbids temporary source edits. Parent locks (20s / 50s / 22s, quotas 3/6/20, AND structured, $0.50, official base, no free/router, N=10-only ship, no recombine) remain intact. Ship path still cannot silent-ship on preflight or 0 PASS.

Residual items are **Minor** only (asymmetric EX-404 re-entry sample size, repair-slow set as “known example” rather than a fully closed list parallel to §5.3.0, soft “推奨” on preflight timeout drop, diagram vs prose). None re-open Stage-1 incompleteness, EX contradiction, non-executable eligible path, weak class-B/repair re-entry, free-form freeze without decision record, or survivors⊆frozen honor-system.

**Human approval / implementation plan may proceed.** Nits can land in the same docs pass or as PR-R1-2 polish; they are not blocking.

---

## Prior-finding disposition table

| ID | Was (secondary final) | Now | Evidence (section quote / locus) |
|----|----------------------|-----|----------------------------------|
| **I-1** | Important — full catalog vs 1 MiB/5s underspecified | **FIXED** | KD-R1-14; §5.2.0.1: *「本番 chat / live ベンチの 1 MiB body cap + 5s Models timeout を『全カタログ取得に足りる』とみなすこと」禁止*; ways A (pagination + end condition) / B (Stage-1 ≥60s, ≥8 MiB offline only); completeness proof required; incomplete → fail-closed §5.8.1. Explicitly separates catalog enumeration from live union refilter. |
| **I-2** | Important — EX-* mixes ID vs config rules; repair-slow vs shortlist | **FIXED** | KD-R1-15; §5.3 split **表 A ID 除外** / **表 B 構成制約**; CFG-REPAIR-SLOW: *「shortlist に載せてよい」* + *「configuration[1] にしてはならない」*; mechanical assert in §5.5.1 + freeze; note: *「以前の『EX-R4-REPAIR-SLOW = shortlist に載せない』読解は誤り」*. CFG-R4-EXACT is config-set, not ID ban. |
| **I-3** | Important — preflight/C-cut not via documented `main` CLI | **FIXED** | KD-R1-8 / KD-R1-18; §5.6.4: *「R1 必須・一時ソース編集禁止」*; normative CLI `--trial-count` / `--configurations-json` with copy-paste Docker one-liners; C 削減 same flag; *「任意 polish」ではない*; PR-R1-1+2 merge, *「CLI 無しの定数 PR は reject」*. Design does **not** claim code has CLI today (verified: `main` L371–378 still full frozen only). |
| **I-4** | Important — repair re-entry n≥1 + soft p95 | **FIXED** | KD-R1-7; §5.3.2 / §17: re-entry requires **n≥3**, **全サンプルおよび p95** `elapsedMs < 12_000`, production harness + official base + current wire. n≥1 language removed as normative floor. |
| **I-5** | Important — free-form ranking / human_pick non-reviewable | **FIXED** | KD-R1-16; §5.4 decision record: `rankingTable` L/S/J/C **1..n 序数**, `pairCandidatesConsidered` adopt/reject codes, `rejectedFromShortlist`, `approver`, `disagreementNote`. Bit-identical shortlists still not required (correct per secondary nuance). |
| **I-6** | Important — no machine-checkable survivors → frozen | **FIXED** | KD-R1-17; §5.2.0.2 committed survivor artifact fields; §5.5.1 *`set(candidateModelIds) ⊆ set(survivorArtifact.survivors[].id)`*; freeze test must assert; optional `models_response_sha256`. |
| **I-7** | Minor (secondary downgrade) — optional preflight | **FIXED (as Minor intent)** | Goal 5 + Open Q #2 + §5.4.1 / §5.6.3 keep N=1 **任意（推奨）**; hard-limit still `est_pass_all` including preflight (KD-R1-13). Intentional cost-efficiency choice, not ship hole. Not re-elevated. |
| **A-I1** | Important — EX-B re-entry weaker than repair | **FIXED** | KD-R1-6; §5.3.0 **closed** class-B ID list; EX-B re-entry: **n≥3**, 全サンプルおよび p95 `< 12_000` (same headroom as repair). Aligns with I-4 bar. |
| **M-1** | Minor — catalog failures missing from Stage-1 fail-closed | **FIXED** | §5.8.1 row: カタログ列挙失敗（非 OK / timeout / byte cap / JSON 不正 / 完全性証明不可）→ stop, no constants PR, no N=10. |
| **M-2** | Minor — premature “設計レビュー合意済み” | **FIXED** | Header: *「Ready for approval（敵対レビュー指摘反映済み・人間承認待ち・未実装）」* — no longer claims review “合意済み” before re-review. Acceptable pending human approval. |
| **M-3** | Minor — missing exact verification commands | **FIXED** | §10.1 Docker-wrapped `node --test` / typecheck / lint / format:check. |
| **M-4** | Minor — EX-B illustrative not closed | **FIXED** | §5.3.0 normative closed list of 5 IDs; additions require design PR. |
| **M-5** | Minor — no copy-paste preflight command | **FIXED** | §5.6.4 shell one-liners for trialCount=1 and N=10 with JSON eligible set. |
| **M-6** | Minor — preflight cost outside hard-limit gate | **FIXED** | KD-R1-13; §8.1: *「有料 chat（preflight および N=10）開始」*; preflight-only batch must pass `est_pass_all` before start; *「preflight だけ先に走らせて hard-limit ゲートを後回しにしない」*. |

---

## New findings (this re-review)

### [N-M1] EX-404 re-entry still n≥1 while EX-B / repair use n≥3 — Minor

**Section**: §5.3.1 EX-404

**Quote**: *「同条件で HTTP 200 の新規証跡 n≥1（推奨 n≥3）」*

**Why not Important**: 404-under-`require_parameters` is closer to a binary availability class than load-sensitive latency; one real 200 is stronger evidence than one sub-20s sample for class B. Not a lock break or false-ship path.

**Suggested polish**: Make n≥3 normative for consistency, or one sentence that EX-404 intentionally differs because success is HTTP-status binary.

### [N-M2] CFG-REPAIR-SLOW membership is example-led, not a closed list parallel to §5.3.0 — Minor

**Section**: §5.3.2 CFG-REPAIR-SLOW; freeze checklist §10

**Quote**: *「既知: 第4 の `openai/gpt-oss-120b`」*

**Why not Important**: R1’s only evidence-backed repair-timeout ID is oss-120b; freeze can hardcode that set; decision record requires `exConfigRulesApplied`. Mechanical ban of `configuration[1]` is still specified.

**Suggested polish**: Either a one-row closed set (`openai/gpt-oss-120b` only until evidence grows) or *「plan8 / R1 証跡で repair 送信 generation_timeout が記録された ID の閉包」* so freeze fixtures cannot omit future members.

### [N-M3] §5.6.3 timeout / model_unavailable drop remains “推奨” after preflight — Minor

**Section**: §5.6.3

Preflight is optional (I-7 accepted). If operator *does* preflight and observes `generation_timeout`, exclusion is still only recommended. KD-R1-8 says excluded configs must not enter N=10 **when** excluded; it does not force exclusion.

**Why not Important**: Cost waste only; N=10 remains sole ship bar; eligible CLI still records actual JSON. Secondary already accepted optional preflight as Minor.

**Suggested polish**: If preflight is run, make timeout/unavailable **mandatory** drop (invalid/materialize stay optional).

### [N-M4] Sequence diagram still abstract on eligible CLI — Minor

**Section**: §5.8 sequenceDiagram

Shows `Op->>Bench: runPaidBenchmark` without `--configurations-json` / eligible subset. Prose §5.6.4 / rollout stage 3–4 are clear. Diagram-only nit.

### No new Critical or Important

| Area | Result |
|------|--------|
| Ship without N=10 / recombine / env on 0 PASS | Closed (§3.2, §5.7, §5.8.2, §17) |
| Lock erosion vs parent §4.1 / §4.4 / quotas / time / AND / $0.50 | Must LOCK §3.3 + Non-Goals — preserved |
| Design claims CLI exists in code today | **No** — future PR-R1-2; code `main` verified without argv parse |
| Privacy / secrets in evidence | Unchanged closed fields; keys/prompt/raw forbidden |
| Stage-1 completeness after rewrite | Normative + fail-closed |
| Internal contradiction (A/B EX tables, shortlist vs repair-slow) | Resolved |
| `recommendedConfiguration = passedConfigurations[0]` | Still aligned; preference via array order |
| Hard-limit C=6 full 2-ID vs $1 | Still blocked correctly |

**Wording note (not a finding)**: §5.7 says recommendation is first PASS in **frozen** config order; CLI subset uses the **JSON** order passed to `runPaidBenchmark`. Same code semantics (`passedConfigurations[0]`); operator must keep preferred order in the JSON they pass. Acceptable if runbook says “eligible JSON order = eval order.”

---

## Net blocking Critical / Important remaining

| Severity | Remaining blocking |
|----------|-------------------:|
| Critical | **0** |
| Important | **0** |

**Minors residual (non-blocking)**: N-M1…N-M4 (optional polish).

---

## Strengths (revision)

1. **Adversarial absorption is structural**, not cosmetic: new KD-R1-14…18 map 1:1 to blocking IDs.
2. **Category correction on catalog caps** (chat body-cap ≠ full enumeration) removes the largest Stage-1 divergence risk.
3. **EX table A/B split** ends the oss-120b shortlist contradiction; repair-slot ban is freeze-testable.
4. **Executable eligible path** is R1-required tooling with reject-if-missing PR policy — matches code reality (`runPaidBenchmark` already accepts overrides; `main` does not yet).
5. **Re-entry bars** for class B and repair-slow are now load-realistic (n≥3 + 12s headroom).
6. **Decision record + survivors ⊆ freeze** make Stage-1 reviewable and CI-checkable without demanding bit-identical human ranking.
7. **Hard-limit** covers preflight + full-pass; optimistic unit-1 gate still forbidden.
8. **Honest residual product risk** (J-axis → R2) unchanged and correctly out of R1 ship clauses.
9. **Status / verification / closed EX-B list / CLI one-liners** clear prior Minors.

---

## Residual risks if approved

| Residual | Notes |
|----------|--------|
| **0/N on J-axis again** | Dominant product risk; design admits R2; not a silent-ship hole |
| **CLI implementation bugs / JSON shell quoting** | Implementation risk in PR-R1-2; design contract is clear |
| **Catalog API without usable pagination metadata** | Method B high budget + completeness fail-closed; operators must not improvise partial pools |
| **cardinality_waiver** | Still needs named approver (Open Q #6); still no ship without N=10 |
| **Optional preflight skip on unknown L/J IDs** | In-budget inefficiency only |
| **Human ranking variance** | Mitigated by decision record + approver; not eliminated by design (intentional) |

---

## Explicit code vs design check (re-verify)

| Claim | Code / design |
|-------|----------------|
| `main` has no CLI subset today | **Confirmed** — `main` always `paidOpenRouterModelConfigurations`, no `process.argv` parse beyond entry guard |
| Design requires CLI in PR-R1-2, not “already shipped” | **Confirmed** — §5.6.4 / §6 / §13 |
| Live gate filters config union only | Unchanged design; correct |
| Recommendation = first PASS | Unchanged; correct |
| Locks not relaxed | Unchanged Must LOCK |

---

## Severity count (this re-review)

| Severity | Count |
|----------|------:|
| Critical (new or still open) | 0 |
| Important (new or still open) | 0 |
| Minor residual / new nits | 4 (N-M1…N-M4) |
| Prior blocking Important disposition FIXED | 7 (I-1…I-6 + A-I1) |
| Prior Minor disposition FIXED | 6 (M-1…M-6) + I-7 kept as intentional Minor |

---

## Final one-paragraph verdict

**APPROVE_WITH_NITS** — clean-context re-read finds **0 Critical and 0 Important remaining**: secondary’s blocking set (I-1…I-6 + A-I1) and prior Minors M-1…M-6 are **FIXED** in the current design text with citable KDs and procedures; optional preflight (I-7) stays intentionally Minor. Four new/residual Minors only (EX-404 n≥1 asymmetry, repair-slow set not fully closed-listed, preflight timeout drop still “推奨”, sequence diagram abstraction). Human approval and the implementation plan may proceed; nits are non-blocking polish.
