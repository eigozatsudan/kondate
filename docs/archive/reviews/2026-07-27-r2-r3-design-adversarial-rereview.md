# Adversarial Re-Review (post-REVISE): R2 prompt/materialize + R3 price cap

- **Date**: 2026-07-27
- **Role**: clean-context re-review (no design-loop conversation; prior primary used only as adjudication targets)
- **Design (CURRENT revision)**: `docs/archive/superpowers/specs/2026-07-27-openrouter-r2-prompt-materialize-r3-price-cap-design.md`
- **Prior primary**: `docs/archive/reviews/2026-07-27-r2-r3-design-adversarial-primary.md` (Verdict: **REVISE**; C-1, I-1…I-6, M-1…M-4)
- **Cross-checked authorities** (read-only):
  - Code: `netlify/functions/_shared/generation-materializer.ts` (name check L144–151 / L357–367; unit trim L239–241; `plannedQuantity`/thousandths L242–268; `sourceByKey` from raw `menu.dishes` L283–300)
  - Code: `shared/safety/allergens.ts` (`normalizeFoodText` L46–58)
  - Code: `netlify/functions/_shared/generation-prompt.ts` (`buildBaseGenerationMessages` dual system strings L104 / L193 — still no pantry contract)
  - Code: `scripts/verify-openrouter-models.mjs` (`maxPromptPlusCompletionUsdPerMillion = 0.5`); bench import; contract/tests prose `0.5` / `$0.50`
  - Live mirrors still at $0.50: MVP design, R1 design Must LOCK, `docs/runbooks/openrouter.md`, `docs/deployment/netlify.md`, `CLAUDE.md`, `README.md`, acceptance-matrix (via prior inventory)
  - Parent / R1: paid-openrouter design §4.1.7 / KD-8; R1 KD-R1-13 hard-limit `est_pass_all`
  - Evidence: Plan8 gate evidence R1 round (5/6 timeout, 1/6 `invalid_ai_response`) — outcomes only; subcodes not in gate evidence

**Constraints honored**: no design/product edits; no paid OpenRouter; no secrets; no raw model output.

---

## Verdict: **APPROVE_WITH_NITS**

## Summary

The REVISE pass closes the **Critical** fail-closed→wrong-success hole and every **blocking Important** algorithm/spec gap from primary. **C-1** is resolved by **name-only** trusted overwrite with unit trim-equality fail-closed and an explicit ban on unit rewrite under provider `plannedQuantity`. **I-1** has a step-ordered working-copy algorithm covering both name-check sites and `sourceByKey`/label `sourceText`. **I-2** rewrites the prompt to exact field copy plus an accurate `normalizeFoodText` gloss. **I-3** is a closed P\* path table plus Docker verification of the single export. **I-4** demotes R2 to a class-C hypothesis with explicit out-of-scope failures and closed-subcode success observation. **I-5**’s non-implementable “または” is gone. **I-6**’s required unit+qty test and core overwrite cases are present; residual security prose and a few edge-test rows are nits. Locks (20s/50s/22s, quotas, AND, N=10-only env, no free/router, no recombine) remain intact. No new Critical or Important found.

**Human approval / implementation planning may proceed.** Nits can land in the same docs polish pass or early PR-R2/R3 commits; none re-open C-1 or ship-without-N=10.

---

## Prior-finding disposition table

| ID | Was | Now | Evidence (locus / quote) |
|----|-----|-----|--------------------------|
| **C-1** | Critical — unit trusted overwrite + provider `plannedQuantity` → wrong success (e.g. kg/0.3 → g/0.3) | **FIXED** | KD-R2-2: *「name のみ trusted で上書き」* / *「unit は上書きしない」*; §5.2.1 step 3: unit *「上書きして成功にしない」*; *「禁止: unit を trusted に差し替えたまま provider の数量を残す」*; §5.3 row: unit 改変 + plannedQuantity → **`pantry_unit_mismatch`**; OQ2 *「解決済み」*; §12 bullet ban. Policy A from primary adopted. |
| **I-1** | Important — overwrite vs `sourceByKey` / dual name checks / order | **FIXED** | §5.2.1: working copy → ref resolve → name overwrite → pantryUsage unit fail-closed → *「下流構造はすべて working 値から構築」* (dishes / `sourceByKey` / label `sourceText`) → second name-check *「削除するか working 基準に書き換え（実装で一方・テスト固定）」* → `validateGeneratedMenu` after. Residual implementer choice is binary-safe if working is trusted name first (covered by §5.3 sourceByKey/label test). |
| **I-2** | Important — prompt “正規化” ≠ `normalizeFoodText` + typo | **FIXED** | §5.1 operational (1)–(4) **exact copy** of pantry ref/name/unit; server gloss: *「NFKC、カタカナ→ひらがな、小文字化、空白・句読点・中黒・括弧除去後」* + unit trim exact. Matches code shape (NFKC → kana fold → lower → strip separators). Minor gloss gap: `\p{Cf}` format controls not listed (N-M1). |
| **I-3** | Important — incomplete P\* mirror inventory | **FIXED** | §6.2 **closed table**: verify export, both test files, bench, contract prose, parent §4.1.7/KD-8, runbook, netlify.md, acceptance-matrix, MVP, R1 footnote, CLAUDE/AGENTS if present, response-format supersession note; Functions *「新規に発明しない」*. Mandatory `node -e` assert on export + `node --test` both test files; prose residual via `rg` (not sole gate). Residual: root `README.md` still holds `$0.50` and is not a table row (N-M2). |
| **I-4** | Important — class-C root cause overstated; R2 may not move invalid | **FIXED** | §5.0: R2 is *「class C の一部」* hypothesis; R1 dominant is timeout 5/6; invalid subcode *「未確定」*; out-of-scope list (`duplicate_ref`, allergy validate, schema/wire, timeout); success = unit tests + next live **closed subcode 分布**. M-1 overclaim removed from KD-R2-2. |
| **I-5** | Important — §5.2 “上書きまたは” vs plannedQuantity | **FIXED** | No “または”. Single branch: unit trim fail-closed; plannedQuantity provider + existing thousandths/null-inventory rules; C-1 ban explicit. |
| **I-6** | Important — missing overwrite attack tests + §9 wrong-ref analysis | **PARTIAL** (residual **Minor**) | **Fixed:** §5.3 name改変→success+trusted; unit改変→fail; null ref; sourceByKey/label; both prompt paths; adversarial regression green. **Residual:** §9 still lacks a dedicated wrong-valid-ref coercion paragraph (primary required accept/reject + rationale); thousandths `0.0001` / null-inventory+planned not explicit table rows (only “現行維持” + regression). Intent of KD-R2-2 is ref authority for **name**; not a reopened algorithm hole. Track as N-M3. |
| **M-1** | Minor — “J 軸が支配的” overstates R1 | **FIXED** | §5.0 / KD-R2-2 no longer claim J-dominant live; timeout-majority stated. |
| **M-2** | Minor — P\* vs hard_limit / `est_pass_all` | **FIXED** | §6.4: keep KD-R1-13; *「P\* 引き上げ後は同じ C でも実費が増え得るため、U_hi または hard limit を再確認してから live」*. |
| **M-3** | Minor — prompt-before-materializer partial ship | **PARTIAL** | §7 still *「PR-R2-2 … PR-R2-1 と同時または直後」* — simultaneous allowed. Order preference is soft. Residual N-M4 only (N=10 gate remains ship bar). |
| **M-4** | Minor — dead diagnostic codes after overwrite | **PARTIAL** | §5.4: `pantry_name_mismatch` *「稀になる想定」*; remaining invalid taxonomy; closed subcode table in evidence. No soft “overwrite applied” metric / explicit code-retirement map. Residual N-M5. |

---

## New findings (this re-review)

### [N-M1] Prompt gloss omits `\p{Cf}` strip — Minor

**Section**: §5.1  
**Code**: `normalizeFoodTextBase` strips `\p{Cf}` before separator strip.  
**Why not Important**: Format controls are rare in pantry names; operational instruction is exact-copy, which avoids the mismatch path entirely when models comply.  
**Polish**: Add「書式制御文字除去」to the gloss, or keep “相当” and point implementers at `allergens.ts`.

### [N-M2] Root `README.md` `$0.50` not in §6.2 closed table — Minor

**Section**: §6.2  
**Live**: `README.md` L107 still states prompt+completion ≤ **$0.50 / 1M**.  
**Why not Important**: Table already covers verify/tests/contract/MVP/runbook/netlify/acceptance/CLAUDE; design mandates residual prose `rg` review. README drift is operator confusion, not a second price constant in code.  
**Polish**: Add `README.md` row to the closed checklist (or fold under “docs 運用散文”).

### [N-M3] I-6 residual — wrong-valid-ref §9 paragraph + edge test rows — Minor

**Section**: §9, §5.3, §5.5  
**Gap**: Valid `pantryRef` + provider free-text name that names a different food (incl. allergen-only-in-`ingredient.name`) becomes trusted name after overwrite; today that was `pantry_name_mismatch`. Design accepts this as name authority but does not spell accept rationale or “allergen detection then relies on remaining free text (steps/description/null-ref ingredients)”.  
**Why not Important**: Product decision is inherent to KD-R2-2 name-only overwrite; allergy validate path retained; not a unit/qty wrong-success.  
**Polish**: 5–8 lines in §9; optional explicit test rows for thousandths / null-inventory (already code-path “現行維持”).

### [N-M4] PR-R2-1/2 still allow true simultaneous merge — Minor

**Section**: §7  
Primary preferred materializer policy **before** prompt. “同時または直後” still permits prompt-only main without overwrite if PR-R2-1 slips.  
**Why not Important**: Production env still blocked until N=10; partial ship is intentional.  
**Polish**: *「PR-R2-2 は PR-R2-1 マージ後」* or non-goal “prompt-only on main without overwrite”.

### [N-M5] No overwrite soft-telemetry after `pantry_name_mismatch` becomes rare — Minor

**Section**: §5.4, Goal 3  
**Why not Important**: Fail path for unit/ref/duplicate unchanged; evidence still gets closed invalid subcodes.  
**Polish**: Optional closed counter (e.g. repair note / metric “name_trusted_override”) without logging raw names.

### No new Critical

### No new Important

Ship path, time/quota/AND locks, R1-replay requirement, and “no production `OPENROUTER_MODELS` without N=10 PASS” were re-checked and remain intact. Name-only overwrite does not reintroduce C-1. R2 is correctly framed as non-sufficient for timeout-majority R1.

---

## Attack battery re-check

| Attack | vs revised design |
|--------|-------------------|
| Safety / unit+qty wrong success | **Closed** (C-1 FIXED) |
| Label / `sourceByKey` order | **Closed** (I-1 FIXED; test-gated implementer choice) |
| Prompt ≠ normalizer | **Closed** for Important bar (I-2); N-M1 gloss nit |
| Incomplete P\* mirrors | **Closed** for Important bar (I-3); N-M2 README nit |
| Class-C overclaim | **Closed** (I-4) |
| plannedQuantity “または” | **Closed** (I-5) |
| Wrong-valid-ref name coerce | **Accepted product semantics**; write-up nit (N-M3) — not unit/qty hole |
| P\* cost / hard limit | **Addressed** (M-2 FIXED) |
| PR order | **Acceptable** with N=10 gate (N-M4 nit) |
| Paid N=10 in design session | **Still forbidden** (Non-Goals) |

---

## Lock cross-check

| Lock | Design | Assessment |
|------|--------|------------|
| 20s / 50s / 22s / repair max 1 | Non-Goals / §12 | **Preserved** |
| Quotas 3/6/20 | Non-Goals | **Preserved** |
| structured AND | Non-Goals | **Preserved** |
| Official base / mock exact URL | §3.3 | **Preserved** |
| $0.50 → P\* | Intentional R3 lock change | **OK** with closed checklist + human OQ1 |
| N=10 only / no recombine / no env without PASS | KD-R3-3, §6.3, §12, KD-R23-1 | **Preserved** |
| Allergy / food-rule validate | KD-R23-2, §5.2.2 | **Preserved** (post-materialize) |

---

## Verdict paragraph + counts

**APPROVE_WITH_NITS** — primary Critical C-1 and Important I-1…I-5 are FIXED with citable KD/§ text; I-6 is PARTIAL only on security prose and edge-test rows (residual Minor); Minors M-1/M-2 FIXED and M-3/M-4 PARTIAL as nits; five new Minor polish items (N-M1…N-M5); zero new Critical/Important. Dual R2→R3→R1-replay→N=10 path and time/quota/AND/N=10 locks hold.

| Class | Prior disposition | New this pass |
|-------|-------------------|---------------|
| Critical open | **0** (C-1 FIXED) | **0** |
| Important open | **0** (I-1…I-5 FIXED; I-6 residual demoted Minor) | **0** |
| Minor open / residual | M-3, M-4 PARTIAL | N-M1…N-M5 (**5** new) |
| **Verdict** | | **APPROVE_WITH_NITS** |

**Counts**: Critical **0** · Important **0** · Minor **7** (2 prior PARTIAL + 5 new) · Prior FIXED **8** (C-1, I-1…I-5, M-1, M-2) · Prior PARTIAL **3** (I-6, M-3, M-4) · Verdict **APPROVE_WITH_NITS**.
