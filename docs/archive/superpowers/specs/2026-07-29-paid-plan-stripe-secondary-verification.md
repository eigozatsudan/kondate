# Secondary verification: paid-plan-stripe design review

**Primary:** `/tmp/grok-1000/grok-design-review-27031f82.md`  
**Design:** `docs/archive/superpowers/specs/2026-07-29-paid-plan-stripe-design.md`  
**Worktree:** `/home/dev/projects/kondate/.worktrees/feat-paid-plan-stripe`  
**Stance:** adversarial vs primary findings (confirm only with design + code evidence)

## Verdict summary
- confirmed_critical: 3
- confirmed_major: 6
- rejected: 0
- partial: 6
- confirmed_minor: 1
- must_fix_before_implement:
  - Issue 1: Plus short-window 8 blocked by rate_windows CHECK + hard-coded 4
  - Issue 2: Webhook event ordering / stale overwrite
  - Issue 3: BILLING_ENABLED=false disables webhooks → entitlement desync
  - Issue 4: Quality / flyer multi-ledger reserve not atomic
  - Issue 5: Concurrent double Checkout → dual subscriptions
  - Issue 6: past_due_since NULL / grace undefined
  - Issue 7 (partial): lock trial_history write timing only
  - Issue 8: flyer weekly try-cap 6 ledger + pre-send enforcement
  - Issue 10: entitlement load fail-closed rule
  - Issue 13: qualityMode placement + command version lock

## Issue-by-issue

### Issue 1: Plus short-window 8 blocked by existing DB CHECK and hard-coded 4
- Primary severity: critical
- Verdict: **CONFIRMED**
- Evidence:
  - Design L7 / `planQuota.plus.shortWindowLimit = 8` and `defense.maxShortWindow: 8`; RPC accepts `p_short_window_limit in (4,8)` (design §プラン対応クォータ).
  - Migration list only expands **identity** CHECKs 3→10 / 6→20 and RPC replace for reserve/usage/status/repair — **no** `ai_user_rate_windows` CHECK step (design §Data Model Changes steps 4–5).
  - Code: `private.ai_user_rate_windows.sent_count ... check (sent_count between 0 and 4)` in `supabase/migrations/20260711002000_ai_control_and_quota.sql:172`.
  - Code: `mark_ai_global_sent` hard-codes `if v_window.sent_count >= 4` in `20260728150000_identity_daily_quota.sql:900`.
  - Code: `get_ai_usage_today` hard-codes `greatest(4 - v_window_sent, 0)` and `'limit', 4` at `20260728150000_identity_daily_quota.sql:815,844-847`.
  - Short-window enforcement is at **mark/send** time, not only product RPC args; without CHECK + hard-code migration, Plus 5th send in-window fails or is blocked at 4.
- If CONFIRMED: design must lock (1) `ai_user_rate_windows` CHECK ≤ defense max (8 or 10), (2) `mark_ai_global_sent` uses snapshot/request `quota_short_limit` or `p_short_window_limit`, (3) usage/status projection uses the same limit arg, (4) list these next to identity CHECK migrations.
- Adjusted severity: critical (unchanged)

### Issue 2: Webhook event ordering / stale overwrite (idempotency alone is insufficient)
- Primary severity: critical
- Verdict: **CONFIRMED**
- Evidence:
  - Design §Webhook: idempotency is only `billing_webhook_events.stripe_event_id` insert collision → 200 no-op (design ~L402–403).
  - Upsert handlers for `customer.subscription.created|updated|deleted` have **no** `event.created` / object version / ignore-older rule (design table ~L390–400).
  - Grep of design for out-of-order / `event.created` / stale subscription version: **no hits**.
  - Security table lists “Webhook 再送” only (Med), not reordering of distinct events.
- If CONFIRMED: lock upsert precondition (store last `stripe_event_created` or subscription event timestamp; drop older events for same `stripe_subscription_id`/`user_id`); document status precedence; add adversarial tests (canceled then delayed active; past_due then delayed active; deleted then delayed updated).
- Adjusted severity: critical (unchanged)

### Issue 3: `BILLING_ENABLED=false` kill switch closes webhooks → permanent entitlement desync
- Primary severity: critical
- Verdict: **CONFIRMED**
- Evidence:
  - Env parse lock: `BILLING_ENABLED=false` → “Checkout/Portal/**Webhook** は 503 または feature-disabled” (design ~L346).
  - Success table L97 is softer (“Checkout/Portal/品質/チラシ… Free 相当”) and **omits** webhook — internal inconsistency with env section.
  - Rollback **ロック** (~L854): free limits always when flag false; Stripe-side for “課金面だけ閉じる”.
  - During kill, forced Free limits hide Plus even if DB still `active` (safe while off). On re-enable, missed cancel/past_due/period-end webhooks leave stale `active`/`trialing` → immediate false Plus until manual reconcile (not specified).
  - Entitlement endpoint behavior under kill switch is not locked (open vs Free-forced vs 503).
- If CONFIRMED: **split kill surfaces** — webhook stays up whenever secrets present (verify+upsert); product surfaces (Checkout/Portal/quality/flyer) and optionally quota Free-force are separate; lock entitlement GET under kill; add re-enable reconcile runbook.
- Adjusted severity: critical (unchanged). Note: primary’s “plusEntitled flips true while kill is off” is slightly imprecise for *during* kill (design forces free limits); the re-enable desync and webhook-disable lock are the real defects.

### Issue 4: Quality / flyer multi-ledger reserve is not atomic with generation quota
- Primary severity: major
- Verdict: **CONFIRMED**
- Evidence:
  - Quality: separate `ai_identity_quality_daily` / `_monthly` tables; “品質カウンタを reserve”; success also consumes standard success (design ~L607–632). No single SECURITY DEFINER RPC that FOR UPDATEs standard + quality ledgers in one TX.
  - Flyer: sequence “weekly cap reserve” + attempt/global consumption; only success table CHECK ≤2 (design ~L680); try-cap 6 not in SQL.
  - API Changes: “品質/チラシ reserve 系” as separate RPCs (design ~L888), not “extend `reserve_ai_generation` in one call”.
  - Contrast: existing `reserve_ai_generation` already FOR UPDATEs identity success/attempt + global in one function (`20260728150000_identity_daily_quota.sql` ~450+), with unified release helpers — quality/flyer lack the same pattern.
- If CONFIRMED: one RPC per path (or extended reserve with quality flags) that locks all ledgers, increments reserved, and documents release/finalize symmetry; pgTAP concurrent oversubscribe tests.
- Adjusted severity: major (unchanged)

### Issue 5: Concurrent double Checkout → dual Stripe subscriptions
- Primary severity: major
- Verdict: **CONFIRMED**
- Evidence:
  - Checkout lock: 409 only when already `plusEntitled` (design ~L382).
  - No advisory lock, open-session row, or Stripe “one active subscription” enforcement before `checkout.sessions.create`.
  - `billing_subscriptions.user_id` is PK (design ~L237–238) — second live sub id overwrites first on webhook; orphaned paid sub can keep billing.
  - Portal month/year switch OFF does not prevent dual subs.
- If CONFIRMED: serialize checkout per user; reject if non-terminal sub already stored or listed; webhook policy if second live `stripe_subscription_id` appears (cancel newer/older + metric).
- Adjusted severity: major (unchanged)

### Issue 6: `past_due_since` can stay NULL → grace logic undefined / infinite Plus
- Primary severity: major
- Verdict: **CONFIRMED**
- Evidence:
  - Entitlement: `past_due` + `past_due_since` within 72h → `plusEntitled` (design ~L284–287, L294).
  - `past_due_since` write is only on `invoice.payment_failed` when status is past_due: `coalesce(past_due_since, now)` (design ~L399).
  - `customer.subscription.updated` upsert lists status/period/cancel/price only — **no** `past_due_since` on transition into `past_due` (design ~L396).
  - No unit-test requirement or branch for `status=past_due AND past_due_since IS NULL`.
- If CONFIRMED: any transition into `past_due` sets `past_due_since = coalesce(past_due_since, now)`; clear on return to active/trialing / `invoice.paid`; document NULL → not entitled (fail closed) or treat as grace start = now; unit-test both.
- Adjusted severity: major (unchanged)

### Issue 7: Trial abuse mitigations incomplete (write timing + multi-email / multi-customer)
- Primary severity: major
- Verdict: **PARTIALLY_CONFIRMED**
- Evidence:
  - **Write timing (confirmed gap):** Security table locks `billing_trial_history (identity_key, first_trial_at)` and “Checkout 前に check”; default 2nd Checkout without trial (design ~L771). Does **not** lock whether `first_trial_at` is written at Checkout create, first webhook `trialing`/`active`, or after payment method attach. Abandoned Checkout vs unlimited abandoned sessions vs never recording trial all depend on this.
  - **Multi-email (accepted residual, not silent hole):** identity = email HMAC only is real (`quota-identity.ts` normalize + HMAC). Design Risks lists “トライアルカード濫用 | Med | trial_history + Stripe Radar” (~L1000) — multi-email farm is residual, partially acknowledged via Radar, not a missing design concept.
  - **Multi Customer / Radar ops gates:** ensure-customer race and Dashboard fraud rules are not ship-blocking locks; primary is right they are weak, but design already frames trial abuse as residual High/Med with Stripe-side help.
- If CONFIRMED (subset): lock write = first webhook status ∈ (`trialing`,`active`) for identity (idempotent insert); unique customer recovery by metadata search; document multi-email as **accepted High residual** with monitoring (do not pretend trial_history closes it).
- Adjusted severity: **major for write timing only**; multi-email/Radar → residual Risk (not implementation-blocking schema change)

### Issue 8: Flyer weekly try-cap (6) and vision cost path under-specified / under-costed
- Primary severity: major
- Verdict: **CONFIRMED** (try-cap / pre-send); cost/image pipeline **partially** overstated as equal-weight blockers
- Evidence:
  - Product locks 週次試行上限 **6** (design ~L643); Implementation Notes `Flyer try cap / week | 6` (~L1019).
  - SQL surface only `success+reserved ≤ 2` (~L680). No attempt/try ledger, no `flyer_weekly_try_limit` failure_code (codes list weekly success limit, not try exhaustion ~L684–691).
  - OpenRouter client today is text-only: `OpenRouterMessage.content: string` in `netlify/functions/_shared/openrouter.ts:16-18` — flyer needs a new multimodal path (primary correct).
  - Cost model $0.02–0.10 per flyer success (~L793) understates primary+repair and failed-validation bills; generation path already does primary+repair (`generation-repair`, integration tests “at most one repair”).
  - Image: magic bytes + 4 MiB + long edge 2048 locked; decoder library / max pixels / CPU budget not locked — real but secondary to try-cap cost bomb.
  - Household safety: “current safety revalidate” locked (~L679); “never trust client allergy snapshot” is implied by validate path, slightly softer than generation integrity wording.
- If CONFIRMED: add weekly try ledger (or sent attempts on week key) with CHECK; **reserve try before OpenRouter**; release only if never sent; cost upper bound with repair; specify image pipeline (e.g. sharp + pixel limit); flyer Function auth + server current-safety only; timeouts 60s/150s.
- Adjusted severity: major for try-cap enforcement; image/cost model refinements stay major product-risk but can be documented residual if try-cap is hard-enforced

### Issue 9: Global cap change incomplete vs current hard max 20; Free starvation residual
- Primary severity: major
- Verdict: **PARTIALLY_CONFIRMED**
- Evidence:
  - Design does lock intent: GLOBAL hard max **200**, ops default **80** (design ~L525–526, L971, L1022; PR8 ~L1101).
  - Code still rejects `p_global_limit` outside `1..20` in `reserve_ai_generation`, `reserve_ai_repair_call`, `get_ai_usage_today` (`20260728150000_identity_daily_quota.sql:254,621,772`); `env.ts` `GLOBAL_DAILY_AI_LIMIT: globalDailyLimit(20)` (~L79).
  - Design §Global 表 mentions env hard max but does **not** enumerate all three SQL sites + preflight/e2e helpers in one matrix (primary fair).
  - Free starvation at 80 with few Plus×20 is already Risks Med + P1 priority lane (~L998, P1 混雑時優先) — not an unacknowledged hole.
- If PARTIAL: require explicit matrix (env max 200, default 80, all RPC bounds, tests); starvation remains accepted residual unless P0 fairness is chosen.
- Adjusted severity: **major → major-for-completeness / not design-silent**; lower urgency than Issues 1–6 if PR8 matrix is expanded before implement

### Issue 10: RPC limit acceptance holes — Free elevation if caller bugs / wrong entitlement
- Primary severity: major
- Verdict: **CONFIRMED**
- Evidence:
  - Product limits come from Functions `loadEntitlement` → `planQuota[plus|free]` (design ~L507–512); DB CHECK is Plus max (10/20/8).
  - No rule for entitlement read errors (throw 503 vs treat as Free).
  - No “never soft-default `p_user_limit` to defense max” lock.
  - service_role-only writers remain true in current grants (`grant execute ... to service_role` on reserve RPCs) — primary’s “pgTAP free cannot pass malicious args” caveat is correct; Function unit tests must pin Free path 3/6/4.
- If CONFIRMED: entitlement failure → **503 fail-closed** (preferred) or Free limits with explicit metric; never default to defense max; Function tests prove free/plus arg wiring.
- Adjusted severity: major (unchanged)

### Issue 11: Cost model optimistic for quality + vision vs ¥580; heavy user unprofitable without harder caps
- Primary severity: major
- Verdict: **PARTIALLY_CONFIRMED**
- Evidence:
  - Design already shows heavy ~$5 ≲ ¥750 > ¥580 and lists High risk + hard $ limit + caps (design ~L796–811, Risks ~L997).
  - Missing in arithmetic: standard primary+repair can ~2× OpenRouter sends per success (code/tests confirm repair path); flyer try-cap 6 multiplies failed vision cost; yearly ¥5,800 unit economics.
  - Key Decisions do **not** explicitly say “unprofitable heavy is accepted”; Risks + hard limit imply acceptance.
- If PARTIAL: recompute bound with repair + flyer tries; optional Key Decision “heavy unprofit accepted under hard $ limit”; staging cost telemetry already in rollout step 5 spirit — strengthen as gate.
- Adjusted severity: **major → residual High risk / pre-launch ops gate**, not schema blocker if Issue 8 try-cap is fixed

### Issue 12: Trial / cancel UX for low-IT Japanese users incomplete (surprise charge risk)
- Primary severity: major
- Verdict: **PARTIALLY_CONFIRMED**
- Evidence:
  - Present: trial Checkout copy (~L219), settings plan section with trial end / past_due Portal (~L737–739), Portal for cancel (~L384–388), Checkout `locale: "ja"` (~L378), 特商法 checklist Risk (~L1003).
  - Missing: in-app pre-charge reminder (no push/notification architecture in app); Portal Dashboard locale/cancel-at-period-end/dark-pattern offers not locked; yearly extra confirmation; delete-account charge timing only best-effort (design already says best-effort cancel ~L749).
  - Primary’s “no guarantee Portal Japanese locale” is partially mitigated by Checkout locale; Portal session create does not pass locale.
- If PARTIAL: lock Portal Dashboard ops checklist (locale ja, cancel at period end aligned with entitlement, no retention dark patterns); settings plain-Japanese “無料期間終了後に課金”; optional P0 month-only.
- Adjusted severity: **major → minor/major product polish** (not billing-correctness blocker like Issues 1–6)

### Issue 13: qualityMode HMAC / command version interaction under-specified vs live v2 path
- Primary severity: major
- Verdict: **CONFIRMED**
- Evidence:
  - Live: `generation-command.v2` + `canonicalizeGenerationCommandV2` has **no** `qualityMode` field (`generation-command-integrity.ts:31-53`).
  - Design: include `qualityMode` in integrity; “バージョンバンプが必要なら … フィールド追加として互換（L12 truncate）” (~L906–907) — ambiguous v2 additive vs v3.
  - Body: `qualityMode?: boolean` on generation request (~L895) but top-level vs nested `request` not fixed vs strict discriminated unions in `shared/contracts/generation.ts`.
  - Repair/second OpenRouter model list inheritance from quality reservation snapshot not stated (design locks quota snapshot columns, not quality model list for repair).
  - Free `qualityMode:true` → 403 before reserve is locked (~L607) — good; counters not marked is implied.
- If CONFIRMED: lock field path, prefer explicit `generation-command.v3` (or single-deploy additive v2 with simultaneous client), repair inherits request quality_mode + Plus model list snapshot.
- Adjusted severity: major (unchanged)

### Issue 14: Minor factual / interface mismatches with codebase
- Primary severity: minor
- Verdict: **CONFIRMED**
- Evidence:
  - Sequence uses `POST /api/generations` (design ~L321); real routes are `/api/generations/menu` and `/dish` (generate-menu/dish functions + tests).
  - `privacyNoticeVersion` today `2026-07-28.v1` (`shared/contracts/domain.ts:71`); design bump `2026-07-29.v1` correct.
  - Free locks 3/6/4/600, `p_user_limit <> 3`, identity CHECK ≤3/≤6, global max 20 — verified in `releaseQuota`, identity migration, `env.ts`.
  - `delete-account` has no Stripe cancel yet — extension order reasonable.
  - `netlify.toml` `payment=()` confirmed; hosted Checkout redirect OK.
  - Roadmap Locked Environment Contract still 3/6/4/20 (`docs/archive/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md` ~L21, L315–319); design supersede table does not list roadmap env contract (~L101–111).
- If CONFIRMED: fix diagram paths; add roadmap env supersede row; keep privacy bump.
- Adjusted severity: minor (unchanged)

### Issue 15: Webhook unmapped user = 200 swallows real misconfig
- Primary severity: minor
- Verdict: **PARTIALLY_CONFIRMED**
- Evidence:
  - Open Question Q3 default **200 + metrics** (design ~L985, user resolve ~L410).
  - Silent paid-but-Free is real support risk; design already notes settings “反映まで数十秒” + polling (~L999).
  - Primary’s combine with kill-switch webhook disable is real only while Issue 3 stands.
- If PARTIAL: keep 200 for unknown; alert threshold mandatory; optional authenticated diagnostic lookup — not ship-blocker if metrics+alert locked.
- Adjusted severity: minor residual (ops)

### Issue 16: Logging / PII residual around Stripe and flyer
- Primary severity: minor
- Verdict: **PARTIALLY_CONFIRMED**
- Evidence:
  - SafeLog forbids email/receipt email/image hash (~L828); allows plan/billing_status/price_interval.
  - No explicit allow/deny for logging `stripe_customer_id` / `stripe_subscription_id` with `user_id`.
  - Flyer multipart filenames in error logs not forbidden by name.
- If PARTIAL: allowlist stripe ids as opaque codes + request id; never log Checkout email fields from Stripe objects.
- Adjusted severity: minor (unchanged)

---

## Cross-checks against primary “Verification notes” table

| Primary claim | Secondary | Notes |
|---------------|-----------|-------|
| Free 3/6/4/global 20 | Match | `releaseQuota`, identity migration, env, hard-coded 6/4 |
| `p_user_limit <> 3` | Match | `reserve_ai_generation` / status RPC |
| identity private tables | Match | `20260728150000_identity_daily_quota.sql` |
| short window user CASCADE | Match | `ai_user_rate_windows` |
| `AI_QUOTA_DISABLED` local only | Match (not re-audited line-by-line) | env pattern consistent with freemium design |
| HMAC email normalize | Match | `quota-identity.ts` |
| delete-account no Stripe | Match | design extends it |
| OpenRouter text-only | Match | `content: string` |
| privacy 2026-07-28.v1 | Match | domain.ts |
| Generate path diagram wrong | Match | sequence vs menu/dish |

Primary’s codebase fact table is accurate; no rejections there.

## Disagreements with primary framing
1. **Issue 3 during kill:** design forces Free **limits** while flag is false — not “plusEntitled true during kill.” Harm is **re-enable desync** + product/env contradiction on webhook disable.
2. **Issue 7 multi-email:** not a silent omission; Risks + identity HMAC architecture already imply residual. Write timing is the implement-blocking subset.
3. **Issue 9 / 11 / 12:** primary severity as equal peers to dual-sub / past_due is slightly high; design already accepts heavy cost and global residual at Med/High with P1 fairness.
4. **Issue 15:** intentional Q3 default; confirm as residual ops, not design error unless metrics omitted.

## must_fix_before_implement (secondary list)
1. Short-window CHECK + `mark_ai_global_sent` / usage hard-coded 4 → plan-aware 4|8  
2. Webhook ignore-older / event ordering  
3. Kill switch: webhooks stay on; document Free-force vs product surface  
4. Atomic quality (+ flyer) reserve RPCs  
5. Checkout concurrency / dual-sub policy  
6. `past_due_since` on any past_due transition + NULL semantics  
7. `billing_trial_history` write timing  
8. Flyer try-cap ledger + pre-OpenRouter reserve  
9. Entitlement load fail-closed  
10. `qualityMode` wire location + HMAC version  

Minors 14–16 + residual cost/UX/global starvation: same revision pass preferred, not all schema-blocking.
