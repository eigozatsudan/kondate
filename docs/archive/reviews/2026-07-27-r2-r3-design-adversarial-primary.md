# Adversarial Review: R2 prompt/materialize + R3 price cap

- **Date**: 2026-07-27
- **Reviewer role**: primary (clean context — no prior design-loop conversation)
- **Design path**: `docs/archive/superpowers/specs/2026-07-27-openrouter-r2-prompt-materialize-r3-price-cap-design.md`
- **State reviewed**: Draft（人間承認待ち・未実装）
- **Cross-checked authorities**:
  - Code: `netlify/functions/_shared/generation-materializer.ts`, `generation-materializer.test.ts`, `generation-prompt.ts`
  - Code: `shared/safety/allergens.ts` (`normalizeFoodText`), `shared/safety/validate-generated-menu.ts`
  - Code: `scripts/verify-openrouter-models.mjs` (`maxPromptPlusCompletionUsdPerMillion = 0.5`), `openrouter-models-contract.mjs`, `benchmark-paid-openrouter-models.mjs` / tests
  - Parent: `docs/archive/superpowers/specs/2026-07-26-paid-openrouter-models-design.md` §4.1.7 / §12 KD-8; time locks 20s/50s/22s
  - R1: `docs/archive/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md`
  - Evidence: `docs/archive/bugfix/2026-07-27-plan8-production-gate-evidence.md`（第4 + R1 ラウンド）
  - Docs mirrors: `docs/runbooks/openrouter.md`, `docs/deployment/netlify.md`, MVP §11/§18, `CLAUDE.md`, `docs/testing/acceptance-matrix.md`

**Attack surfaces requested**: safety regression on trusted overwrite; P\* cost; PR order; incomplete constant updates; prompt vs `normalizeFoodText`; `plannedQuantity` edge cases.

---

## Verdict: **REVISE**

## Summary

The dual-track framing is directionally correct and evidence-aligned at the **outcome** level: R1 N=10 was **0 PASS**, with **5/6 unit1 `generation_timeout`** and the only sub-20s survivor (`inclusionai/ling-2.6-flash`) ending in **`invalid_ai_response`**; historical diagnostics also show real `pantry_name_mismatch` / `pantry_unit_mismatch`. Keeping 20s/50s/22s, quotas, AND structured, no free/router, N=10-only ship, and “no production env without PASS” is sound. R3’s single-export `P*` idea matches the existing `maxPromptPlusCompletionUsdPerMillion` pattern.

However, **R2’s trusted overwrite is under-specified in ways that convert today’s fail-closed unit/name checks into silent wrong-success states**, especially **unit overwrite without quantity/`plannedQuantity` semantic policy**, and **label/`sourceByKey` residual checks vs overwrite order**. The prompt draft **does not match `normalizeFoodText`**. R3’s “touch list” **misses several live mirrors** (MVP, runbook, Netlify deploy doc, acceptance-matrix, test titles, `CLAUDE.md`). Class-C root cause for R1/R4 `invalid_ai_response` is **not established from closed codes** (evidence deliberately omits path/message), so claiming overwrite will fix J-axis is an unproven bet.

No Critical “ship without N=10 / secret leak / time-lock break” hole in the **stated** ship path. Approval should wait until overwrite semantics, prompt accuracy, constant inventory, and R2 success criteria are tightened.

---

## Findings table

| ID | Severity | Section | Title |
|----|----------|---------|-------|
| C-1 | **Critical** | §5.2, KD-R2-2/4, OQ2 | Unit trusted overwrite without quantity / `plannedQuantity` rebind → false success |
| I-1 | Important | §5.2, KD-R2-2, materializer L140–165 / L283–367 | Overwrite vs `sourceByKey` / residual name checks / label path order unspecified |
| I-2 | Important | §5.1, KD-R2-1 | Prompt “正規化” wording ≠ `normalizeFoodText` (and typo 大文字小丸) |
| I-3 | Important | §6.2, KD-R3-2 | Incomplete constant / doc mirror inventory for `P*` |
| I-4 | Important | §1–2, KD-R2-2, evidence R1/R4 | Class-C root cause underspecified; R2 may not move `invalid_ai_response` |
| I-5 | Important | §5.2 item 4 vs KD-R2-4 / OQ2 | `pantryUsage` “上書きまたは trusted 採用” contradicts “plannedQuantity 寄せない” |
| I-6 | Important | §5.3, §9 | Missing required tests / security notes for wrong-ref silent substitution & unit+qty |
| M-1 | Minor | KD-R2-2 | “live で J 軸が支配的” overstates R1 (timeout is dominant) |
| M-2 | Minor | §6.4, OQ1 | P\* vs operator hard limit $1 / `est_pass_all` underspecified as gate |
| M-3 | Minor | §7 PR-R2-1/2 | Prompt-before-materializer partial ship risk (minor given N=10 gate) |
| M-4 | Minor | §5.1 / repair | After overwrite, `pantry_name_mismatch` / unit codes become dead — observability not defined |

---

## What the design gets right (non-exhaustive)

1. **Evidence fit (unit outcomes)**: R1 table in evidence matches design §1 (5× `generation_timeout`, 1× `invalid_ai_response` on ling solo). R2+R3 together is a rational response; R2-only or R3-only correctly marked insufficient.
2. **Code claims on materialize (name/unit) are accurate**:
   - `pantryRef` ingredient: `normalizeFoodText(trusted.item.name) === normalizeFoodText(ingredient.name)` else `pantry_name_mismatch` (`generation-materializer.ts` L144–151; again for labels L357–367).
   - `pantryUsage.unit`: trim equality vs trusted, else `pantry_unit_mismatch` (L239–241).
   - `plannedQuantity` + null inventory / non-thousandths → `pantry_unit_mismatch` (L242–246, `exactThousandths`).
3. **Prompt claim accurate**: `buildBaseGenerationMessages` system strings are generic schema/safety lines only; **no pantry name/unit/ref contract** (idea L103–104; household L191–193).
4. **0.5 constant claim accurate** for scripts: `maxPromptPlusCompletionUsdPerMillion = 0.5` in `verify-openrouter-models.mjs` L8; bench imports it; contract prose still says `$0.50` / `0.5 USD/1M`. Functions runtime does **not** re-check Models pricing (grep empty under `netlify/`) — design’s “あれば” hedge is correct.
5. **Locks preserved in Non-Goals**: 20s/50s/22s, quotas, AND, no Gemini schema theme, no free/router, no N=1 as N=10, no paid N=10 in this design session.
6. **Ship discipline**: R1-replay required after R3; production env only after N=10 PASS; no shortlist reuse — matches parent §4.4.2 spirit.

---

## Detailed findings

### [C-1] Unit trusted overwrite without quantity / `plannedQuantity` rebind — **Critical**

**Where**: KD-R2-2, §5.2 steps 2–4; OQ2 defaults “plannedQuantity 寄せない”.

**Code today** (`generation-materializer.ts`):

- Unit mismatch on `pantryUsage` is **hard fail** (`pantry_unit_mismatch`).
- `plannedQuantity` is taken from the **provider** and compared to trusted inventory only after unit equality (L239–268).
- Ingredient path does **not** currently unit-check against pantry; only name (L144–160). Ingredient `quantityValue` / `quantityText` / `unit` are provider-authored.

**Design change**: on valid `pantryRef`, force trusted `name`/`unit` and **stop failing** name/unit mismatch.

**Attack / edge**:

| Provider says | Trusted pantry | After proposed overwrite | Result |
|---------------|----------------|--------------------------|--------|
| `unit: "kg"`, `plannedQuantity: 0.3` | `unit: "g"`, qty 100 | unit→`g`, planned stays **0.3** | Interprets as **0.3 g** (was likely 300 g). Shortage/shopping wrong; **success instead of fail**. |
| ingredient `unit: "kg"`, `quantityValue: 0.3`, `quantityText: "0.3kg"` | unit `g` | ingredient.unit→`g`, qty fields unchanged | Display/math incoherent (`0.3` + `g` vs text `0.3kg`). |
| `unit: "個"` vs trusted `"本"` | eggs counted differently | silent unit swap | Cooking amount semantics drift. |

KD-R2-4 claims structural quantity checks stay; that is **insufficient** if the **unit dimension** is rewritten under the same numeric `plannedQuantity`. This is not a nit: it **replaces fail-closed with wrong-success**, which is worse for shopping/shortage and can feed false “在庫で足りる/足りない”.

**Required fix (design must pick one normative policy)**:

1. **A (recommended)**: Overwrite **name only**; keep **unit trim-equality fail-closed** (unit remains model contract), **or**
2. **B**: Overwrite unit **only when** provider unit trim-equals trusted (no-op) **or** normalizeFoodText/unit-alias map is explicit; on mismatch still fail, **or**
3. **C**: If unit is force-overwritten, **also** define plannedQuantity / ingredient quantity handling: fail if provider unit ≠ trusted; never carry provider numbers across unit change; optional clear `quantityText` re-derivation rules.

OQ2 must not leave “寄せない” without stating that **unit overwrite + provider plannedQuantity is forbidden**.

Also extend §5.3 tests: “provider unit kg + plannedQuantity 0.3 + trusted g” must have an **explicit expected fail or convert** — never silent 0.3g success.

---

### [I-1] Overwrite vs `sourceByKey` / residual name checks order — **Important**

**Code order today**:

1. Ingredient materialize path: name equality check, then persist **provider** `name` (L140–165).
2. Later `sourceByKey` is built from **raw `menu.dishes` provider strings** (L283–306).
3. Label path re-checks pantry name equality on provider ingredient (L357–367).
4. `validateGeneratedMenu` re-runs linkage with `normalizeFoodText` on **materialized** names (L230–233) and **replaces** labelConfirmations with canonical allergen labels on success (L560–566).

**Design §5.2** says: overwrite name/unit; do not run normalize/unit checks on that path. It does **not** say:

- whether `sourceByKey` / `labelConfirmations.sourceText` use **pre- or post-overwrite** strings;
- whether the **second** name check (L357–367) is removed, rewritten, or still fails;
- whether overwrite mutates a working copy of the AI payload before all consumers.

If residual label-path check remains → R2 “success on name rewrite” tests fail.  
If removed but `sourceByKey` keeps provider “パン” while dish ingredient becomes trusted “ごはん” → intermediate object inconsistent (even if validate later overwrites labels).  
If only dishes are overwritten and `pantryUsage` unit path is vague → partial implementation drift.

**Required fix**: Normative algorithm, step-ordered:

1. Resolve `pantryByRef` / dangling / unknown (unchanged).
2. For each pantry-linked ingredient with valid ref: set working `name`/`unit` from trusted (**subject to C-1 policy**).
3. Build **all** downstream structures (materialized dishes, `sourceByKey`, label `sourceText`) from the **working** values.
4. Explicitly delete or rewrite both name-check sites (ingredient loop + label loop).
5. `pantryUsage`: trusted `unit` / `pantryItemName` already partially authoritative on output (L260–269); define provider-unit handling without C-1 hole.
6. State that `validateGeneratedMenu` remains after materialize (KD-R23-2) and that linkage checks see trusted names.

---

### [I-2] Prompt contract ≠ `normalizeFoodText` — **Important**

**Design §5.1 (2)**:

> name は、入力 pantry の name と食品正規化後に一致させる（全角半角・大文字小丸・空白差を吸収する同一規則）

**Actual `normalizeFoodText`** (`shared/safety/allergens.ts` L46–58):

1. NFKC  
2. katakana → hiragana fold  
3. `toLocaleLowerCase("ja-JP")`  
4. strip format controls `\p{Cf}`  
5. strip `[\s\u3000、。・,./（）()「」『』']`

Issues:

- **「大文字小丸」** is not a real description of the algorithm (likely typo for 大文字小文字 / 小書き).  
- Prompt omits **カタカナ↔ひらがな折り畳み** (the dominant Japanese food-name behavior; tests use サーモン/さーもん).  
- Prompt omits **句読点・中黒・括弧除去**.  
- “全角半角” is only a partial gloss of NFKC.

If R2 relies on prompt alone for class C, models will “normalize” by a different mental model and still mismatch — **unless** overwrite (C-1-safe) is the real acceptance path. Then the prompt should say something closer to:

- 「サーバーは `normalizeFoodText` 相当（NFKC・カナ折り畳み・空白/句読点除去後の一致）で検査する。不一致を避けるため **入力 pantry の name 文字列をそのままコピー**せよ」  
  and for unit: 「**入力の unit を trim 後に文字どおりコピー**（null は null）。別名や換算をするな」

**Required fix**: Rewrite §5.1 to either (a) “byte-copy / exact field copy from input pantry” as the operational instruction, with a short accurate gloss of checks, or (b) reference the same bullet list as the code (no false subset). Fix the typo. Add test that prompt snapshot mentions カナ/NFKC or exact-copy language.

---

### [I-3] Incomplete `P*` mirror inventory — **Important**

Design §6.2 lists verify, bench, contract “等”, parent §4.1.7/KD-8, runbook/README, R1 footnotes. **Live mirrors actually holding 0.50 / 0.5 include at least**:

| Location | Form |
|----------|------|
| `scripts/verify-openrouter-models.mjs` | `= 0.5` export (正本) |
| `scripts/benchmark-paid-openrouter-models.mjs` | import + compare |
| `scripts/benchmark-paid-openrouter-models.test.mjs` | `assert.equal(..., 0.5)` |
| `scripts/verify-openrouter-models.test.mjs` | titles + cases “above 0.5” / “exactly 0.5” |
| `scripts/openrouter-models-contract.mjs` | prose `$0.50` / `0.5 USD/1M` |
| Parent design §4.1.7 / §12-8 | normative $0.50 |
| MVP `2026-07-11-kondate-mvp-design.md` | § with $0.50 |
| R1 design Must LOCK / filter steps | $0.50 |
| `docs/runbooks/openrouter.md` | $0.50 |
| `docs/deployment/netlify.md` | $0.50 |
| `docs/testing/acceptance-matrix.md` | test title “above 0.5 USD” |
| `CLAUDE.md` global constraints | ≤ $0.50/1M |
| Response-format revision “変更しないもの” | may need R3 supersession note |

KD-R3-2 says single export + **all** mirrors. Without a **closed checklist** (and a CI grep/`rg` gate for residual `0.5` price prose where appropriate), partial PR-R3-1 will ship drift — exactly What Not To Do §12.

**Required fix**: Expand §6.2 to a **closed table** of paths + whether each is “import constant” vs “prose must match P\*”. Mandate updating **MVP + runbook + netlify.md + acceptance-matrix + CLAUDE/AGENTS if present + both test files**. Require a verification command (e.g. fail if `maxPromptPlusCompletionUsdPerMillion !== P*` or contract prose stale). Clarify Functions: **no runtime price re-check today** — do not invent a mirror unless intentionally added.

---

### [I-4] Class-C root cause underspecified — **Important**

Evidence policy omits path/message/raw output. R1/R4 only expose closed codes like `invalid_ai_response` / `generation_timeout`. Older 60s **non-gate** diag did show `materialize_fail:pantry_name_mismatch` / `pantry_unit_mismatch` / `duplicate_ref`.

Design KD-R2-2 justifies overwrite with “live で J 軸が支配的”. For **R1**, timeout is dominant (5/6). For the **one** invalid survivor, root cause is **unknown** in the official evidence. Overwrite does **not** fix `duplicate_ref`, dangling refs, schema adapter failures, allergen label set mismatch, food-rule fails, etc.

**Required fix**:

1. Soften causal claim: R2 is **hypothesis-driven** for a subset of class C; not proven for ling/nano.
2. Add R2 success criterion beyond unit tests: e.g. after R2-only mock/adversarial, and/or require next live round to log **closed materialize/validate subcodes** already available in repair (`pantry_name_mismatch`, …) without logging raw output.
3. Explicitly list **out of R2 scope** failures (`duplicate_ref`, allergy validate, …) so R1-replay expectations stay honest.

---

### [I-5] §5.2 “上書きまたは” vs plannedQuantity policy — **Important**

§5.2.4: 「unit / plannedQuantity の整合は、trusted を権威に再評価（provider unit 不一致は**上書きまたは** trusted 採用）」  
KD-R2-4 / OQ2: structure / plannedQuantity **not** trusted-aligned by default.

“または” is not implementable. Combined with C-1 it invites implementers to pick the permissive branch.

**Required fix**: Single normative branch; remove “または”. Align with C-1 policy. State exact throws that remain (`must_use_missing`, `pantry_priority_mismatch`, `pantry_usage_link_mismatch`, thousandths, null-inventory+non-null planned, unknown ref, …).

---

### [I-6] Missing tests & security write-up for overwrite attacks — **Important**

Attack: model attaches **valid** `pantryRef` for “サラダ油” while free-text recipe intent is another oil/allergen-bearing item; overwrite forces trusted name into the ingredient list; steps might still mention the other item (food-rules/allergens may or may not catch). Today name mismatch **fail-closed**; after R2, **silent identity bind to ref**.

This may be acceptable **if** product decision is “ref is sole authority”, but the design only says “安全を緩めない” / “アレルギー validate 維持” without analyzing **fail-closed → coerce** for identity.

**Required fix**:

- §9 Security: short adversarial paragraph on wrong-ref coercion; accept or reject with rationale.
- §5.3 add cases:
  - name mismatch → success + trusted name (if still desired after C-1)
  - unit mismatch → per C-1
  - label confirmations present with pre-overwrite name path
  - `validateGeneratedMenu` still green on overwritten happy path
  - must_use / dishRefs / priority still fail
  - `plannedQuantity` 0.0001 still `pantry_unit_mismatch`
  - null inventory + non-null planned still fail
  - idea **and** household prompt both contain contract block (KD-R2-5)

---

### [M-1] “J 軸が支配的” overstates R1 — **Minor**

R1 evidence: timeout-majority. Historical rounds support pantry J failures. Rephrase to “timeout-dominant band + residual class C on sub-20s models; R2 addresses C hypothesis, R3 addresses band.”

---

### [M-2] P\* cost vs $1 hard limit — **Minor**

§6.4 notes worse per-generation ceiling and `est_pass_all` recalculation. R1 used hard_limit **$1** with est ≈ $0.90. Raising P\* expands survivors into pricier IDs; **N=10 under $1 may become covers=no**. Required: PR-R23-1/2 runbook step — recompute hard limit **before** paid N=10; do not treat P\* raise as free.

Also note: P\*=$1.00 is **USD/1M tokens**, not USD/request; do not imply 2× user bill without token assumptions.

---

### [M-3] PR order — **Minor**

KD-R23-1 R2→R3→replay→N=10 is good. Partial ship of R3-only code is allowed; production env blocked — OK. Risk: R2-2 prompt-only without R2-1 overwrite leaves models instructed to match a normalization they cannot reliably perform (I-2). Prefer **materializer policy fixed before prompt**, as already suggested; make “prompt-only merge to main without overwrite” a **non-goal** if overwrite remains the acceptance path.

---

### [M-4] Dead diagnostic codes after overwrite — **Minor**

If name/unit mismatches never throw, repair codes `pantry_name_mismatch` / `pantry_unit_mismatch` stop firing. Goal 3 says “欠落なく伝える現状を維持・必要なら補強”. Either keep **soft** diagnostic (count overwrite events in closed metrics / repair notes without failing) or explicitly retire those codes for the overwrite path and update repair maps/tests.

---

## Lock / time / parent cross-check

| Lock | Design stance | Assessment |
|------|---------------|------------|
| 20s / 50s / 22s / repair max 1 | Non-Goal / What Not To Do | **Preserved** |
| Quotas 3/6/20 | Non-Goal | **Preserved** |
| structured AND | Non-Goal | **Preserved** |
| Official base / mock exact URL | §3.3 | **Preserved** |
| $0.50 price | **Intentional lock change via R3 → P\*** | OK only with closed mirror list (I-3) + human OQ1 |
| N=10 only ship / no recombine | KD-R3-3, §6.3, §12 | **Preserved** |
| Parent KD-8 text | Must be rewritten in same PR as code | Called out; list incomplete (I-3) |

---

## Attack battery (requested)

| Attack | Result vs this draft |
|--------|----------------------|
| Safety regression on trusted overwrite | **Open hole** — C-1 unit+qty; I-1 label/source order; I-6 wrong-ref coercion under-analyzed. Allergy validate retained is necessary but **not sufficient** to claim “安全を緩めない”. |
| P\* cost | Partially addressed (§6.4); hard-limit interaction weak (M-2). No paid run in design session — good. |
| Order of PRs | Mostly sound; prompt/materializer sequencing should be harder (M-3). R3-before-R2 code OK; N=10 only after both — OK. |
| Incomplete constant updates | **Confirmed gap** (I-3). |
| Prompt ≠ `normalizeFoodText` | **Confirmed** (I-2). |
| `plannedQuantity` edge cases | **Confirmed critical interaction** with unit overwrite (C-1); thousandths / null-inventory must remain in must-keep fail table (I-5). |

---

## Required revisions for APPROVE (checklist)

1. **Resolve C-1** with a single unit/quantity policy; ban silent unit rewrite under unchanged provider quantities.  
2. **Normative materializer algorithm** (I-1) including `sourceByKey` / both name-check sites.  
3. **Rewrite §5.1** to exact-copy + accurate normalizer gloss (I-2).  
4. **Closed P\* mirror table** + verification expectation (I-3), including MVP/runbook/netlify/acceptance-matrix/tests/CLAUDE.  
5. **Tone down / evidence-limit class-C claims**; define R2 evaluation success beyond unit tests (I-4).  
6. **Remove “または”** in §5.2.4; lock plannedQuantity behavior (I-5).  
7. **Security + tests** for overwrite attacks (I-6).

Nits M-1…M-4 may ship as small text fixes in the same revise pass.

---

## Verdict paragraph + counts

**REVISE** — dual R2+R3 framing and time/quota/AND/N=10 locks are sound and R1 evidence (5/6 timeout, 1/6 invalid) is cited correctly at the unit level, but trusted unit overwrite without quantity rebind is a Critical fail-closed→wrong-success hole, overwrite/label ordering and prompt≠`normalizeFoodText` are Important, and the P\* mirror list is incomplete for a lock change.  
**Counts**: Critical **1** · Important **6** · Minor **4** · Verdict **REVISE**.
