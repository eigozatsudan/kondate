## Design Document Re-Review (r2): こんだて日和 Plus（Stripe フリーミアム）

**Document:** `docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md` (status **Review-ready**, r1)  
**Primary review + writer responses:** `docs/superpowers/specs/2026-07-29-paid-plan-stripe-primary-adversarial-review.md`  
**Secondary (context):** `docs/superpowers/specs/2026-07-29-paid-plan-stripe-secondary-verification.md`  
**Stance:** adversarial re-check — fix must appear in **design text**, not only Response fields  
**Codebase spot-check:** identity quota RPC, `ai_user_rate_windows` CHECK, `get_ai_usage_today` consumed semantics, OpenRouter message type

### Summary

**r2 addressed — open: 0.** Design revision r2 locks flyer success-before-try, mark-time short window, and non-lexicographic same-second webhook tie-break. **Approve for implementation planning.**

r1 properly absorbed the prior critical/major findings **into the design body** (short-window CHECK≤8 + hardcode matrix, webhook ignore-older, kill-switch split with webhook always-on when keys present, atomic quality/flyer RPC, checkout serialize + dual-sub, `past_due_since` fail-closed, trial_history write timing, flyer try ledger, entitlement 503, command v3, cost/UX residuals documented). Those items are **not re-opened**.

One **major** wording hole remains on flyer reserve when success cap is already exhausted (can still burn try/OpenRouter if implementers follow step 1 literally). Two **minors** (short-window “reserved++” vs real mark-time model; same-second Stripe `event.id` string tie-break). After a small wording lock on the flyer path, this design is implementation-ready.

---

### Previously addressed (verified in design text — not re-listed as open)

| Prior # | Topic | Design text evidence (r1) |
|---------|--------|---------------------------|
| 1 | Plus short 8 vs CHECK/hardcode 4 | CHECK `sent_count <= 8`; matrix for `mark_ai_global_sent` / usage / status; migration step 5; acceptance “Plus short 5 回目” |
| 2 | Webhook order | `last_stripe_event_created` / `last_stripe_event_id`; ignore-older algorithm; adversarial unit list |
| 3 | Kill closes webhook | Split table: webhook **continues** if keys present; Free quota + product surfaces closed; entitlement `productSurfacesOpen`/`quotaPlan`/`dbPlusEntitled`; reconcile runbook before re-enable |
| 4 | Atomic multi-ledger | `reserve_ai_generation(p_quality_mode)` + `reserve_flyer_weekly`; same-TX rollback; release symmetry; concurrent pgTAP |
| 5 | Double Checkout | `billing_checkout_locks` + advisory lock; non-terminal / Stripe list 409; dual-sub cancel policy |
| 6 | `past_due_since` NULL | Any transition into `past_due` sets coalesce; NULL → `plusEntitled=false`; clear on active/trialing/`invoice.paid` |
| 7 | Trial write timing | Checkout **read** history; **write** only first webhook `trialing\|active` idempotent insert; multi-email High residual explicit |
| 8 | Flyer try 6 + vision | `ai_identity_flyer_weekly_tries` CHECK≤6; pre-send reserve; `flyer_weekly_try_limit`; sharp/2048²; multimodal; server safety only |
| 9 | Global 1..200 | SQL/env/preflight matrix; default 80; Free starvation residual + alert |
| 10 | Free elevation / fail-closed | loadEntitlement → **503**; never defense-max default; Function unit Free 3/6/4 |
| 11 | Cost vs ¥580 | Pessimistic ~$14; Key Decision heavy unprofit **accepted**; staging cost gate step 5 |
| 12 | Low-IT trial/cancel UX | Portal ja / period-end cancel / dark-pattern off; trial charge copy; yearly confirm; push non-P0 residual |
| 13 | qualityMode HMAC | **`generation-command.v3`**, top-level `qualityMode`, repair inherits snapshot |
| 14 | Path / roadmap | Sequence `/api/generations/menu`; roadmap Locked Environment Contract supersede |
| 15 | Unmapped 200 | 200 + **mandatory** alert + 5 min diagnostic |
| 16 | Logging PII | Stripe opaque ids allowlist; filename / Checkout email forbidden |

---

### Issue 1: Flyer reserve step 1 allows try (and OpenRouter) when weekly success is already full
- **Severity**: major
- **Section**: チラシ → 台帳セマンティクス step 1–2; failure codes
- **Description**: Sequence diagram correctly has an alt branch for **success** upper bound before send. Step 1 text is weaker and implementer-hazardous:

  > `reserve_flyer_weekly` が try reserved++ と**（成功枠に空きがあれば）**success reserved++、日次 attempt/short/global を 1 TX で確保。

  Parenthetical “if success has room” reads as **optional** success reserve while still taking try + attempt + global. That would allow OpenRouter vision calls after 2 successful weekly plans (try remaining ≤4) with **no product success path**, defeating the try-cap-as-cost-ceiling story and reopening Issue 8’s cost-bomb class under a different trigger.

  Failure code `flyer_weekly_limit` exists, but is not bound to “must reject before try reserved++”.
- **Suggestion**: Lock a single ordered rule, e.g.:

  1. If `success_count + success_reserved >= 2` → return `flyer_weekly_limit` (**no** try/attempt/global mutation).  
  2. Else if try exhausted → `flyer_weekly_try_limit`.  
  3. Else atomically reserve success + try + attempt + short-check-as-designed + global.

  Add unit/pgTAP: after 2 successes, further flyer POSTs never call OpenRouter and never increment try sent.
- **Status**: addressed
- **Response**: 設計 r2 で `reserve_flyer_weekly` を S0–S9 の順序表に固定。**S1 成功枠満 → `flyer_weekly_limit` のみ・try/attempt/global 非変異・OpenRouter 到達不能**。sequence・受け入れ表・pgTAP 必須ケースを同期。

---

### Issue 2: Atomic multi-ledger table overclaims short-window `reserved++` (mark-time model in code)
- **Severity**: minor
- **Section**: 原子的 multi-ledger reserve 表（標準生成 / チラシ）
- **Description**: Table claims standard and flyer reserves do **FOR UPDATE + reserved++** on short (user). Current schema (`private.ai_user_rate_windows`) has only `sent_count` (no reserved), and enforcement is in **`mark_ai_global_sent`** with hard-coded 4 today. r1 correctly migrates limit to snapshot `quota_short_limit` at mark/usage — that is enough for Plus 8.

  Saying short is reserved in the same TX as identity success will push implementers to invent a non-existent short-reserved ledger or mis-port generation into a broken dual model.
- **Suggestion**: Clarify: short window remains **send-time** (mark / flyer send convert) using `quota_short_limit` snapshot (generation) or equivalent flyer request snapshot; atomic reserve TX covers identity success/attempt/global (+ quality/flyer ledgers), not a new short reserved column unless you explicitly add one.
- **Status**: addressed
- **Response**: 原子 multi-ledger 表を改訂。short は **mark/send-time** + snapshot。`ai_user_rate_windows` に reserved 列を新設しないことを明示禁止。

---

### Issue 3: Same-second webhook tie-break via `event.id` string compare is not chronological
- **Severity**: minor
- **Section**: Webhook 順序保護 algorithm
- **Description**:

  ```text
  if event.created == row.last_stripe_event_created
     and event.id <= row.last_stripe_event_id:  -- 同一秒の tie-break は event id 文字列比較で固定
  ```

  Stripe `evt_…` ids are **not** ordered by time under lexicographic `<=`. Same-second reordering residual is rare but the lock claims a false total order. Primary ignore-older on `event.created` still fixes the critical canceled→delayed-active class.
- **Suggestion**: Prefer: same `event.created` → process if payload differs and is not a strict no-op, or retrieve Subscription from Stripe API as tie-break; or document “same-second last-writer-wins acceptable residual” without claiming string order is temporal.
- **Status**: addressed
- **Response**: `event.id` lexicographic 比較を **禁止**。同一秒は Stripe Subscription retrieve を正とし、失敗時は status 終端性優先。残差を設計本文に記載。

---

### Strengths (r1 quality)

- Fixes are **in the normative design**, with acceptance scenarios, migration steps, testing, Key Decisions, and Risks aligned — not review-only commentary.
- Kill-switch split (webhook stays hot / quota Free / surfaces closed / reconcile before re-enable) is operationally sound.
- `past_due_since NULL → not entitled` is the right fail-closed choice.
- trial_history write-on-first-webhook (not on Checkout create) correctly avoids burning trial on abandoned sessions.
- Heavy-user unprofitability is an explicit Key Decision rather than silent optimism.
- PR plan orders CHECK/short/global before quality/flyer and Stripe order before UI — sensible for reviewable increments.
- Residual abuse (multi-email trial farm, global Free starvation) is named High/Med in Risks instead of pretended closed.

---

### Residual accepted (do not block; already in design Risks)

- Multi-email / multi-card trial farms (identity = email HMAC).
- GLOBAL=80 Free starvation until P1 priority lane.
- Heavy Plus cost ≫ ¥580 under caps + shared OpenRouter hard $ limit.
- Account-delete Stripe cancel best-effort orphans.
- No in-app pre-charge push (settings + Stripe email only).

---

### Disposition

| Class | Count | Action |
|-------|-------|--------|
| Prior 1–16 | addressed in design | Do not re-open |
| Critical open | **0** | — |
| Major open | **1** | Flyer success-full vs try reserve wording (Issue 1) |
| Minor open | **2** | Short reserved++ clarity; event.id tie-break |

**Verdict (post-r2 design fix):** **Approve for implementation planning.** Issues 1–3 **Status: addressed** in design body. No further adversarial cycle required unless new scope appears.

---

## Revision Summary (r2)

**Date:** 2026-07-29  
**Design:** `2026-07-29-paid-plan-stripe-design.md` r2 → Review-ready  

| Issue | Severity | Design action |
|-------|----------|---------------|
| 1 Flyer success-full still burns try | major | Ordered S1–S9: success cap first → `flyer_weekly_limit` with zero try/attempt/global mutation; OpenRouter unreachable; pgTAP |
| 2 Short reserved++ overclaim | minor | Atomic table: short is mark/send-time only; no rate_windows reserved column |
| 3 event.id string tie-break | minor | Same-second: retrieve Subscription or terminal-status precedence; ban evt_ lexicographic order |

Open issues remaining: **0**.

