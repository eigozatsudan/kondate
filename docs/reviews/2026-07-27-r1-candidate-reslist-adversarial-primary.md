# Adversarial Review: R1 candidate / exact configuration reslist

- **Date**: 2026-07-27
- **Reviewer role**: primary (clean context — no prior design-loop conversation)
- **Design path**: `docs/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md`
- **Content hash**: `sha256sum` not executed in this session; design file is the 740-line R1 draft dated 2026-07-27, state “Ready for approval”
- **Cross-checked authorities**:
  - `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md` §4.1, §4.4, §4.4.1, §4.4.2, §6.3, §12 KD
  - `docs/superpowers/specs/2026-07-27-paid-openrouter-response-format-revision-proposal.md` (shipped scope)
  - `docs/bugfix/2026-07-27-plan8-production-gate-evidence.md` (esp. 第4ラウンド)
  - `docs/bugfix/2026-07-27-plan8-response-format-revision-closeout.md`
  - Code: `scripts/benchmark-paid-openrouter-models.mjs`, `scripts/benchmark-paid-openrouter-models.test.mjs`, `netlify/functions/_shared/paid-openrouter-benchmark-harness.ts`, `docs/runbooks/openrouter.md`

---

## Verdict: **REVISE**

## Summary

R1 correctly keeps N=10 as the only ship gate, forbids recombine, freezes locks (20s/50s/3/6/20/AND/$0.50), separates Stage 1 catalog work from live `runPaidBenchmark` union refilter, matches `recommendedConfiguration = passedConfigurations[0]`, and hardens hard-limit math to full-pass (`est_pass_all`) rather than optimistic unit-1. Those are real strengths and block several classic false-ship paths.

However, the **core Stage 1 “full catalog” procedure is under-specified against the same 1 MiB / 5s Models API path the design reuses**, EX-* mixes ID bans with configuration-shape bans and **contradicts itself on repair-slow IDs vs shortlist membership**, and **preflight exclusion / C reduction are not implementable via the documented CLI** (`main` always runs full frozen configs). Human ranking + free-form `human_pick_*` also allow two operators to freeze different shortlists/configs with only one-line narrative evidence. These are not nits: they produce wrong shortlists, wasted spend, or silent procedure divergence before N=10 ever runs.

No Critical “ship without N=10 / secret leak / lock break” hole was found in the *stated* ship path. Approval should wait until Important items are tightened in the design (and, where needed, runbook/CLI notes).

---

## Findings table

| ID | Severity | Section | Title |
|----|----------|---------|-------|
| I-1 | Important | §5.2.0, §5.2 | Full-catalog Stage 1 vs 1 MiB / 5s / no pagination is unrobust and underspecified |
| I-2 | Important | §5.3, KD-R1-7 | EX-* table mixes rule kinds; EX-R4-REPAIR-SLOW contradicts “not on shortlist” |
| I-3 | Important | §5.6, §8.1, §5.1 flow | Preflight drop / C-reduction not implementable via documented `main` CLI |
| I-4 | Important | KD-R1-7, EX-R4-REPAIR-SLOW | Repair re-entry `n≥1` + 12s threshold is too weak / underspecified |
| I-5 | Important | §5.4, §5.5.2 | Human ranking + `human_pick_*` leave non-reproducible shortlist/config selection |
| I-6 | Important | §5.2.0, §9, §13 | No machine-checkable binding of snapshot survivors → frozen constants |
| I-7 | Important | §5.6.3, §3.1 | Optional preflight + optional timeout exclusion undercuts cost-control claims |
| M-1 | Minor | §5.8.1 | Catalog snapshot failure modes not in Stage 1 fail-closed table |
| M-2 | Minor | Header / status | “設計レビュー合意済み” is premature for a draft under review |
| M-3 | Minor | §10, §13 | Missing exact verification commands for freeze/set-equality tests |
| M-4 | Minor | §5.3 EX-B | “Known class B” is illustrative, not a closed evidence-derived list |
| M-5 | Minor | §5.6.4 | Preflight invocation is API-level only; no copy-paste operator command |
| M-6 | Minor | §8.1 | Preflight cost is outside the N=10 hard-limit gate (small but unstated) |

---

## Detailed findings

### [I-1] Full-catalog Stage 1 vs 1 MiB / 5s / no pagination — Important

**Section**: §5.2.0 steps 2–3; cross-ref code `OPENROUTER_MAX_BODY_BYTES`, `modelsApiTimeoutMs`, `officialModelsUrl`

**Quote**:
> URL: `…/models?output_modalities=text` … timeout: 5s … body byte cap: 1 MiB … 応答 `data[]` の **すべての entry** について …

**Attack / failure scenario**:
1. Operator follows the design literally and reuses `readResponseBodyWithByteCap` + 5s abort (same as live gate).
2. OpenRouter’s full text-model catalog (or a future larger catalog) exceeds 1 MiB or cannot finish in 5s.
3. Snapshot throws (`response_body_over_byte_cap` / models unavailable). There is no prescribed pagination (`offset`/`limit` exist on Models API) and no “raise catalog cap only for Stage 1 offline” rule.
4. Alternate operators “fix” it with uncapped `curl` / browser dump → different `data[]` completeness → different survivor sets, while still claiming §5.2.0 compliance.

Round 2 evidence claimed “全 40 本” mechanical passers, so a usable fetch existed *that day*; the design still freezes a procedure that **does not define recovery when the prescribed cap/timeout cannot return a complete `data[]`**. Treating chat body-cap semantics as catalog-enumeration semantics is a category error.

**Impact**: Stage 1 is the entire new selection surface for R1. Incomplete or divergent catalogs → wrong shortlist, false “survivors < 3 → R3” transitions, or silent under-coverage of new IDs (R1’s “main battlefield”).

**Required fix**:
- Specify a **complete enumeration** method: either (a) paginated Models API with per-page ≤1 MiB and explicit loop until `links.next` null / `total_count` satisfied, or (b) a Stage-1-only offline reader with a **documented higher byte/time budget** that does not weaken production chat caps, plus a completeness check (`len(data)` vs `total_count` if present).
- Add Stage 1 fail-closed when completeness cannot be proven (do not rank a partial pool as “full catalog”).
- Do not claim “ベンチと同一” for catalog body limits unless the gate path is also extended for Stage 1 tooling only.

---

### [I-2] EX-* mixes rule kinds; EX-R4-REPAIR-SLOW vs shortlist — Important

**Section**: §5.3 intro + table rows EX-R4-REPAIR-SLOW / EX-R4-EXACT; §5.4.1 oss-120b hint

**Quote**:
> 機械フィルタ通過後でも、次は **既定で shortlist 候補に載せない**。  
> EX-R4-REPAIR-SLOW | repair 送信が 20s 境界で落ちた ID を **repair スロット**に置くこと … primary スロット評価は別  
> EX-R4-EXACT | 第4ラウンドと **同一の exact 3 配列** | 必須セットにしない

**Attack / failure scenario**:
- Operator A reads the section header and **drops `openai/gpt-oss-120b` from shortlist entirely** (cannot be single primary).
- Operator B reads the row body and **keeps oss-120b on shortlist as single/primary**, only bans repair-slot placement — consistent with §5.4.1 (“単独 primary も…疑い”) and KD-R1-7’s “primary スロット評価は別”.
- EX-R4-EXACT is a **configuration-set rule**, not a shortlist-ID rule, yet lives under “shortlist に載せない”.

**Impact**: Same evidence → different frozen `candidateModelIds` / configs → non-comparable R1 rounds; possible over-exclusion freezes progress, or under-exclusion re-admits repair-timeout pairs.

**Required fix**:
- Split EX into two tables: **ID exclusions** (EX-B, EX-404, EX-GEM, …) vs **configuration constraints** (no R4-identical arrays as mandatory; repair-slot ban list).
- State explicitly whether repair-slow IDs **may** appear on shortlist (recommended: **yes**, with mechanical ban on appearing as `configuration[1]` in any 2-ID config, enforced in §5.5.1 invariants + freeze test).

---

### [I-3] Preflight drop / C-reduction not implementable via documented CLI — Important

**Section**: §5.1 flow G→H→R; §5.6.3–5.6.4; §8.1 step 4 “C を減らす”; code `main()`

**Quote**:
> preflight FAIL で除外した構成は **N=10 に入らない**  
> **`C` を減らす**（評価順の後方構成をこのラウンドから外す…）

**Code reality** (`scripts/benchmark-paid-openrouter-models.mjs`):
- `runPaidBenchmark({ configurations, trialCount })` supports overrides.
- `main()` **always** passes `configurations: paidOpenRouterModelConfigurations` and default `trialCount = 10`.
- No CLI flag for subset or `--preflight-only` (design marks flag as optional later PR).

**Attack / failure scenario**:
1. Operator runs preflight via ad-hoc `runConfigurationGate({ trialCount: 1 })` and marks 2 configs FAIL-timeout.
2. For N=10 they run the only documented command:  
   `docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs`  
   → **all frozen configs chat again**, including preflight-failed ones (design violation / wasted spend).
3. Or they hand-edit constants for one run without a PR, then freeze tests/design drift.
4. Same hole for §8.1 C reduction when `hard_limit_covers_est=no` for C=6.

**Impact**: Cost-control and eligible-set semantics in the design are **not executable as written** without undocumented Node injection or temporary source edits. Two operators diverge; hard-limit gate can be bypassed by “just running the script”.

**Required fix** (pick one, document as R1-required—not optional polish):
- **Runbook + CLI**: document exact one-liner that calls `runPaidBenchmark({ configurations: eligibleSubset, trialCount })` **or** add `--configurations-json` / env allowlist for this round; and/or
- **Process**: require a constants PR that shrinks `paidOpenRouterModelConfigurations` to the N=10 eligible set (and re-check KD-R1-11) **before** live N=10, and state that temporary source edits are forbidden.
- Sequence diagram §5.8 should show which artifact (CLI args vs frozen constants) defines the N=10 set.

---

### [I-4] Repair re-entry `n≥1` + 12s threshold too weak — Important

**Section**: KD-R1-7; EX-R4-REPAIR-SLOW re-entry

**Quote**:
> 証跡サンプルの **全 elapsedMs が < 12_000**（かつ n≥1、推奨 n≥3 の p95 も < 12_000）

**Attack / failure scenario**:
- Known repair-timeout ID (oss-120b class) gets **one** lucky closed-code send at 11.9s under light load.
- Re-entry condition met (`n≥1`); ID returns to repair slots.
- N=10 under load reproduces ~20s repair timeout (第4: repair `elapsedMs = 20005`).

12s is a new operational constant not in parent locks (reasonable derivation, but **n≥1** makes it ornamental). “推奨 n≥3 p95” is non-normative.

**Impact**: Re-admits a failure class R1 was meant to exclude; burns hard-limit budget; false confidence in Stage 1.

**Required fix**:
- Make **n≥3** (or n≥5) and **p95 < 12_000** (or max < 12_000 for all samples) **normative**, not recommended.
- Require production harness + official base + same `menuResponseFormat` path as gate (already partly stated).
- Optionally: ban repair-slot use of any ID with **any** prior official-base 20s abort in evidence unless a full re-entry package is attached to the shortlist PR.

---

### [I-5] Human ranking + `human_pick_*` non-reproducible — Important

**Section**: §3.1 Goal 1; §5.4; §5.5.2 steps (1)(2)

**Quote**:
> **この段階は人間判断である。** … 厳密な重み付けアルゴリズムは必須としない  
> `for id in human_pick_singles(S, limit=2)` … `for p in human_pick_pairs(S)`

**Attack / failure scenario**:
- Same snapshot survivors and same EX-* application.
- Operator A: singles = top-2 L; pairs biased to S[1]+S[3].
- Operator B: different L/S/J narrative scores (allowed: integer ranks, 1-line evidence); different pairs; different eval order → different `recommendedConfiguration` if multiple PASS (KD-R1-12).
- No required decision record fields beyond free text; no second-operator check.

**Impact**: R1 claims a “fixed procedure” for selection, but **only mechanical filter + cardinality + set equality are mechanical**. Shortlist order and exact configs—the actual N=10 bill of materials—are free-form. Undermines reviewability and “two operators same shortlist” expectation in the adversarial brief.

**Required fix**:
- Normative **decision record template**: for each shortlist ID, mandatory L/S/J/C ordinal (1..k) + allowed evidence sources checkbox + tie-break price; for each config, primary/repair rationale codes (enum: `L_high`, `J_expected`, `C_low`, `new_id_probe`, …).
- Constrain pair generation further, e.g. “all pairs among top-3 by rank” **or** require explicit enumeration of rejected pairs with reason.
- State that ranking disagreement requires named approver (already open Q #6 for waiver only—extend to final shortlist freeze).

---

### [I-6] No machine-checkable binding of snapshot survivors → frozen constants — Important

**Section**: §5.2.0 step 5; §9; §13 PR-R1-1/2; freeze tests today

**Quote**:
> **survivor に無い ID を shortlist に発明してはならない。**

**Code reality**: freeze test (`benchmark-paid-openrouter-models.test.mjs` L134–152) only deepEquals fixed ID arrays; R1 adds set equality of ids↔configs, **not** “⊆ snapshot survivor table”.

**Attack / failure scenario**:
- PR author pastes IDs believed to pass AND+price without attaching survivor table, or edits table after ranking.
- Reviewers check narrative only. Gate day mechanical filter may still pass (if pricing still OK) → **invented shortlist that skipped EX-\* / ranking**.
- Or IDs pass filter but were never ranked on L/S/J (violates procedure, not code).

**Impact**: Procedure integrity is honor-system; silent lock-breaking of Stage 1 intent without failing CI.

**Required fix**:
- Require committed evidence artifact (e.g. `docs/bugfix/…-r1-snapshot-D.md`) with survivor IDs + reasons, and PR checklist that frozen constants ⊆ that file’s survivor set (reviewer assert or a tiny offline test reading both).
- Optional: store `models_response_sha256` / `entry_count` (not raw body) on the evidence row for audit.

---

### [I-7] Optional preflight undercuts cost-control narrative — Important

**Section**: §3.1 Goal 5; §5.4.1 “N=1 preflight を強く推奨”; §5.6.3 “推奨” for timeout exclusion

**Quote**:
> 未評価 ID は L/J が「未知」のため、§5.6 の N=1 preflight を **強く推奨**  
> `generation_timeout` / `model_unavailable` … N=10 **対象外にする（推奨）**

**Attack / failure scenario**:
- Shortlist of 5 new IDs, 6 pair-heavy configs, preflight skipped (allowed).
- Full-pass est may still be ≤ hard limit (§8.1 yes), so N=10 starts.
- Unit-1 timeouts on every config: still cheaper than full pass, but **design’s main cost-reduction lever is optional**, and timeout exclusion is only “recommended”, so operators may re-pay N=10 on known timeout configs.

**Impact**: Not a false-ship hole, but a **cost / process hole**: R1 markets preflight as cost control while leaving the expensive path fully legitimate. Combined with I-3, even diligent preflight may not stick.

**Required fix**:
- For any shortlist ID with L or J marked **未知**, make N=1 preflight **mandatory** before that ID’s configs enter N=10.
- Make `generation_timeout` / `model_unavailable` preflight results **mandatory** N=10 exclusion (keep invalid/materialize as optional).
- Keep “skip preflight for fully known IDs” if desired.

---

### [M-1] Catalog snapshot failures not in Stage 1 fail-closed table — Minor

**Section**: §5.8.1

Fail-closed rows cover survivors < 3, ranking failure, configs < 3. Missing: Models API non-OK, body over cap, invalid body, timeout. Operators may improvise (I-1) instead of stopping.

**Required fix**: Add rows → stop, no constants PR, no N=10.

---

### [M-2] Status line claims design review already agreed — Minor

**Section**: header “状態: Ready for approval（設計レビュー合意済み・人間承認待ち・未実装）”

This primary adversarial review is still open. Premature “合意済み” biases implementers.

**Required fix**: “Draft — under adversarial review” until verdict APPROVE\*.

---

### [M-3] Missing exact verification commands — Minor

**Section**: §10 checklist

Project convention is Docker-wrapped node tests. Design lists files but not:

```bash
docker compose run --rm --no-deps app node --test scripts/benchmark-paid-openrouter-models.test.mjs
docker compose run --rm --no-deps app npm run typecheck
# etc.
```

**Required fix**: Add a short §10.1 verification block for PR-R1-2.

---

### [M-4] EX-B list is illustrative, not closed — Minor

**Section**: §5.3 EX-B

Examples cover major 第1/第2 class-B IDs from evidence, but “既知” is undefined (evidence doc only? any historical log?). Risk of re-admitting unlisted historical aborts.

**Required fix**: “EX-B = any model ID with generation_timeout / 20s abort on official base in `docs/bugfix/2026-07-27-plan8-production-gate-evidence.md` or later R1 evidence, unless re-entry package attached.”

---

### [M-5] Preflight has no copy-paste operator command — Minor

**Section**: §5.6.4

`runConfigurationGate({ trialCount: 1 })` is a library call, not a shell command. Overlaps I-3.

**Required fix**: Provide a minimal `node --input-type=module -e '…'` or script entry in runbook.

---

### [M-6] Preflight cost outside hard-limit gate — Minor

**Section**: §8.1 “N=10 開始前”

`est_pass_all` includes `S_preflight`, but the gate is checked before N=10; an operator could run large P preflight first, then discover hard limit insufficient. Magnitude is small (P×2×$0.01), yet should say “run §8.1 before **any** paid preflight as well if P≥1”.

---

## Strengths

1. **Ship path discipline**: N=10 only; preflight PASS ≠ ship; 0 pass → no env/README/deploy; recombine forbidden — aligned with closeout P0/P1 and parent §4.4.2.
2. **Lock preservation**: Explicit Must LOCK table matches parent KD and response-format “変更しないもの” (quota, timeouts, AND, $0.50, official base, no free/router).
3. **Code alignment on recommendation**: KD-R1-12 matches `recommendedConfiguration = passedConfigurations[0] ?? null` (`benchmark-paid-openrouter-models.mjs` ~L342–344) and freeze/recommend tests; avoids silent selection drift.
4. **Set equality (KD-R1-11)**: Correctly notes live gate filters **config union only** (L279–312); forcing shortlist ≡ union prevents document/code drift.
5. **Hard-limit math (KD-R1-13 / §8.1)**: Rejects optimistic `est_fail_unit1`; C=6 full 2-ID pass at U_hi=$0.01 → $1.20 > $1 is correctly blocked — fixes a real past operational trap.
6. **Stage separation**: Catalog pool is Stage 1; live `runPaidBenchmark` stays union-only — does **not** demand silent rewrite of gate filter semantics for full catalog at runtime.
7. **KD-R1-5 / EX-R4-EXACT intent**: Avoids re-billing the exact 3 configs that already failed 第4 (closeout “同じ 3 構成を根拠なく繰り返さない”).
8. **PR merge policy**: PR-R1-1 alone on main would break freeze tests — simultaneous merge requirement is correct.
9. **Privacy**: Evidence field set matches harness closed codes; forbids key/prompt/raw output; harness `logTerminalEvent: () => {}`.
10. **Independence from R2/R3**: Scope control is clear; residual J-axis failure → R2 is honest (not oversold).

---

## Residual risks if approved as-is

| Risk | Why it remains |
|------|----------------|
| **0/N again on J-axis** | 第3/第4 show wire-OK + materialize fail; R1 does not change prompt/materialize. Design admits this — still the dominant ship risk. |
| **Divergent operator shortlists** | I-2, I-5, I-6 until fixed. |
| **Catalog procedure thrash** | I-1 when Models API payload grows. |
| **Spend without learning** | I-3, I-7 if preflight/C-cut not enforced in tooling. |
| **Repair-slow re-admission** | I-4 with n≥1. |
| **cardinality_waiver** | Allows 1–2 config N=10 with human sign-off; still no ship without N=10, but reduces exploration. Open Q #6 on approver is fine if named at approval. |

None of these alone is “silent ship without N=10” if operators obey the ship clauses; the REVISE is about **making Stage 1 and paid-run selection as fail-closed and implementable as the ship clauses**.

---

## Explicit verification against code

| Claim in R1 | Verified |
|-------------|----------|
| `candidateModelIds` / `paidOpenRouterModelConfigurations` match design §2.1 / runbook | **Yes** — `benchmark-paid-openrouter-models.mjs` L28–38; freeze test L134–146; `docs/runbooks/openrouter.md` L28–38 |
| `OPENROUTER_MAX_BODY_BYTES = 1 MiB`, `modelsApiTimeoutMs = 5000`, `officialModelsUrl` with `output_modalities=text` | **Yes** — L21–26 |
| `evaluateMechanicalFilter`: empty / `:free` / routers / missing / AND / price ≤0.5 | **Yes** — L99–134; uses `maxPromptPlusCompletionUsdPerMillion` from verify script (= 0.5) |
| Live gate filters **union of configurations only**, not full catalog | **Yes** — `runPaidBenchmark` L279–312 |
| `recommendedConfiguration = passedConfigurations[0]` | **Yes** — L342–344; test L310–340 |
| Early abort on first unit fail | **Yes** — `runConfigurationGate` L248 `if (!unit.ok) break` |
| `main` always full frozen configs, no trialCount/CLI subset | **Yes** — L371–378 (supports I-3) |
| Freeze test lacks set-equality today | **Yes** — only deepEqual + isFrozen; R1 correctly proposes adding set equality |
| Harness evidence shape: models / responseModel / excludedModel / elapsedMs / failureCodes | **Yes** — `paid-openrouter-benchmark-harness.ts` L34–46; no prompt/raw logging L399–400 |
| 第4 evidence: nano invalid; nano+llama invalid after repair; nano+oss generation_timeout repair 20005ms | **Yes** — evidence L189–214; matches design §2.2 |
| Parent §4.4.2 N=10 exact config / no recombine / 20s–50s–22s / repair max 1 | **Aligned** — R1 §3.3 / §5.7 do not relax |
| Response-format revision shipped shortlist = same 3 IDs/configs | **Aligned** — R1’s job is to replace those constants post-failure; does not reopen wire/adapter |
| Parent §6.3 ~$0.001–0.01 / generation used as U_hi=$0.01 / **send** | **Conservative relative to “per generation”** if 2 sends/unit; OK as upper band, but note units differ slightly from parent wording |

---

## Severity count

| Severity | Count |
|----------|------:|
| Critical | 0 |
| Important | 7 |
| Minor | 6 |

**Verdict: REVISE** — address I-1…I-7 in the design (and runbook/CLI notes as needed) before human approval / implementation plan. M-\* can land in the same revision pass.
