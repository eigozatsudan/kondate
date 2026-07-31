## Design Document Review: こんだて日和 Plus（Stripe フリーミアム）

**Document:** `docs/archive/superpowers/specs/2026-07-29-paid-plan-stripe-design.md`  
**Reviewer stance:** adversarial security + product-abuse (billing / freemium / AI quota)  
**Codebase checked:** `.worktrees/feat-paid-plan-stripe` (identity quota migration, reserve/mark RPCs, `env.ts`, generation repository/HMAC, delete-account, OpenRouter client, rate_windows CHECK)

### Summary

**Revision applied (r1).** Primary findings were adjudicated by secondary verification; all CONFIRMED / PARTIALLY_CONFIRMED / minor items are **addressed** in design `2026-07-29-paid-plan-stripe-design.md` (status **Review-ready**). See Revision Summary at bottom and design §Revision Summary r1.

---

### Issue 1: Plus short-window 8 blocked by existing DB CHECK and hard-coded 4
- **Severity**: critical
- **Section**: プラン対応クォータ（RPC / CHECK）; L7; Data Model Changes
- **Description**: Design sets Plus short window to **8 / 600s** and says only identity CHECKs expand to ≤10 / ≤20. Actual schema and RPCs still enforce **4**:
  - `private.ai_user_rate_windows.sent_count` has `check (sent_count between 0 and 4)` (`supabase/migrations/20260711002000_ai_control_and_quota.sql`).
  - `mark_ai_global_sent` hard-codes `if v_window.sent_count >= 4` (`20260728150000_identity_daily_quota.sql`).
  - `get_ai_usage_today` hard-codes `greatest(4 - v_window_sent, 0)` and `limit: 4`.
  - Attempt day limit is similarly hard-coded `>= 6` in `reserve_ai_generation` (not only CHECK), which the design notes, but **rate_windows CHECK is omitted** from the migration list.
  A Plus user with snapshot `quota_short_limit=8` would fail on 5th send with a CHECK violation or still be blocked at 4.
- **Suggestion**: Explicitly migrate `ai_user_rate_windows` CHECK to ≤8 (defense max); pass short limit via request snapshot into `mark_ai_global_sent` / usage RPCs (not env-only); accept `p_short_window_limit in (4,8)` symmetrically with success/attempt; list this in migration step 4/5 next to identity CHECKs.
- **Status**: addressed
- **Response**: 設計 r1 で `ai_user_rate_windows` CHECK≤8、`mark_ai_global_sent` / usage/status が request `quota_short_limit` / `p_short_window_limit` を使うようロック。硬コード 4/6 置換マトリクスと migration 手順に short CHECK を明記。

---

### Issue 2: Webhook event ordering / stale overwrite (idempotency alone is insufficient)
- **Severity**: critical
- **Section**: Stripe 統合 → Webhook イベント; Security 表（再送のみ）
- **Description**: Design handles **duplicate** events via `billing_webhook_events.stripe_event_id` insert collision → 200 no-op. It does **not** handle **out-of-order distinct events** (e.g. `customer.subscription.updated` with `status=active` processed after a later `deleted`/`canceled` because of Stripe retries or concurrent delivery). Last writer wins on `billing_subscriptions` regardless of Stripe `event.created` / subscription object version. That can re-grant `plusEntitled` after cancel/payment failure (“free forever premium” or the reverse: stuck Free after paid recovery).
- **Suggestion**: On upsert, store `stripe_event_created` (or subscription `items`/`status` event timestamp) and **ignore older events** for the same `stripe_subscription_id` / `user_id`. Optionally compare `status` transitions with a documented precedence table. Add adversarial tests: canceled then delayed active update; past_due then delayed active; deleted then delayed updated.
- **Status**: addressed
- **Response**: `billing_subscriptions.last_stripe_event_created` / `last_stripe_event_id` と ignore-older アルゴリズムをロック。敵対的 unit（canceled→delayed active 等）を Testing に追加。

---

### Issue 3: `BILLING_ENABLED=false` kill switch closes webhooks → permanent entitlement desync
- **Severity**: critical
- **Section**: 環境変数; ロールアウト Rollback; 成功受け入れ `BILLING_ENABLED=false`
- **Description**: Design says when `BILLING_ENABLED=false`, Checkout/Portal/**Webhook** return 503/feature-disabled, while app forces Free limits. Stripe will retry then drop events. During the kill window (or if keys are absent), cancels, `past_due`, and period ends never update `billing_subscriptions`. On re-enable, DB may still show `active`/`trialing` for users who canceled or failed payment in Stripe — **`plusEntitled` flips true immediately** while kill switch is off only by re-reading stale rows. Conversely, new pays may not project until manual reconcile.
  Also: forcing Free limits while `GET /api/billing/entitlement` might still report Plus (if endpoint stays up) creates UX/support contradictions; if entitlement endpoint is also disabled, settings UI behavior is unspecified.
- **Suggestion**: **Lock:** webhook handler remains enabled whenever Stripe secrets are present (signature verify + upsert), even if `BILLING_ENABLED=false`. Kill switch only closes Checkout/Portal/quality/flyer **product surfaces** and optionally forces Free **quota** (document which). Add “reconcile from Stripe on re-enable” runbook, or periodic pull for active customers. Define entitlement API behavior under kill switch explicitly.
- **Status**: addressed
- **Response**: Kill を分割: Webhook は鍵がある限り継続; 製品面+quota Free 強制; GET entitlement は `productSurfacesOpen`/`quotaPlan`/`dbPlusEntitled` を返す。`docs/runbooks/billing-reconcile.md` を再有効化必須手順として追加。

---

### Issue 4: Quality / flyer multi-ledger reserve is not atomic with generation quota
- **Severity**: major
- **Section**: モデル allowlist（品質カウンタ）; チラシ; Functions 配線
- **Description**: Quality mode must reserve (a) standard success/attempt/global, (b) quality daily, (c) quality monthly. Flyer must reserve weekly success + attempt/global (+ weekly try cap 6). Design describes separate tables and “reserve” steps but **no single SECURITY DEFINER RPC** that locks and mutates all relevant ledgers in one transaction with unified release on failure. Partial reserve + crash leaves permanent reserved_count orphans (same class of bug the freemium design already fixed for identity/global on delete). Concurrent quality requests can oversubscribe day/month if two transactions interleave.
- **Suggestion**: Specify one RPC per path, e.g. `reserve_ai_generation` extended with optional quality flags, or `reserve_quality_generation` / `reserve_flyer_weekly` that FOR UPDATE all rows and increments in one function; document release/finalize symmetry for quality/flyer reserved rows on fail/timeout/stale cleanup; pgTAP concurrent reservation tests.
- **Status**: addressed
- **Response**: `reserve_ai_generation` + `p_quality_mode` で quality day/month を同一 TX 原子 reserve。チラシは `reserve_flyer_weekly`。release/finalize/cleanup 対称と並行 pgTAP を明記。

---

### Issue 5: Concurrent double Checkout → dual Stripe subscriptions
- **Severity**: major
- **Section**: Checkout 作成; 409 already entitled
- **Description**: 409 is only when already `plusEntitled`. Two parallel `POST /api/billing/checkout` before any webhook can create **two Checkout Sessions** (and potentially two subscriptions) for one Customer. Portal month/year switch is OFF, but dual subs still bill. `billing_subscriptions.user_id` is PK — second webhook upsert may **overwrite** the first `stripe_subscription_id`, orphaning a live paid sub that still charges.
- **Suggestion**: Serialize checkout per user (advisory lock / “open session” row); Stripe-side allow one active sub; on webhook, if another live sub id exists, cancel the newer or older by policy and log; reject second session creation if a non-terminal incomplete/trialing/active sub id is already stored or listed via Stripe API.
- **Status**: addressed
- **Response**: `billing_checkout_locks` + advisory lock、既存 non-terminal / Stripe list で 409、dual-sub は新しい方を cancel し DB は古い entitled を優先。

---

### Issue 6: `past_due_since` can stay NULL → grace logic undefined / infinite Plus
- **Severity**: major
- **Section**: Entitlement 判定; Webhook `invoice.payment_failed` / `customer.subscription.updated`
- **Description**: `plusEntitled` for `past_due` requires `past_due_since` within 72h. Design only sets `past_due_since = coalesce(past_due_since, now)` on **`invoice.payment_failed` when status is already past_due**. `customer.subscription.updated` with `status=past_due` may arrive **without** payment_failed, leaving `past_due_since` NULL. Entitlement code then either:
  - treats NULL as “not in grace” → abrupt Free (harsh), or
  - treats NULL as “always grace” → **infinite Plus on past_due** (abuse / cost).
  Neither branch is locked.
- **Suggestion**: On any transition into `past_due` (subscription.updated/created), set `past_due_since = coalesce(past_due_since, now)`. Clear only on return to `active`/`trialing` / `invoice.paid`. Unit-test NULL past_due_since.
- **Status**: addressed
- **Response**: 任意 past_due 遷移で set。復帰/invoice.paid で clear。**NULL → plusEntitled=false（fail-closed）** をロック。unit 必須。

---

### Issue 7: Trial abuse mitigations incomplete (write timing + multi-email / multi-customer)
- **Severity**: major
- **Section**: Security トライアル濫用; `billing_trial_history`; Open Questions
- **Description**: Residual high-value abuse path for a ¥580 / 7-day trial product:
  1. **`billing_trial_history` write timing is not locked** — “Checkout 前に check” is stated, but not whether `first_trial_at` is written at Checkout create, on webhook `trialing`, or only after first successful payment method attach. Wrong choice either burns trial on abandoned Checkout or allows unlimited abandoned sessions until one succeeds (minor) / fails to record trial at all.
  2. **Identity = email HMAC only** (confirmed in `quota-identity.ts`; freemium residual §3.6 email-change / new email). New email ⇒ new identity ⇒ **new trial + fresh daily/quality/flyer counters**. Delete+re-register same email is mitigated; **new-email farms are not**.
  3. Multiple Stripe Customers: if ensure-customer insert fails after Stripe `customers.create`, next Checkout creates another Customer — trial/Radar linkage weakens.
  4. Design leans on “Stripe Dashboard fraud / same card” without locking Radar rules or `subscription_data.trial_settings` / customer reuse policy as ship-blocking ops gates.
- **Suggestion**: Lock write: insert trial_history on first webhook status in (`trialing`,`active`) for that identity (idempotent). Reuse single Stripe customer id with unique constraint + recovery from Stripe search by metadata. Document residual multi-email abuse as accepted risk with severity High and ops monitoring (trial starts / card fingerprint if Stripe provides). Consider “one trial per Stripe customer + payment method fingerprint” as P0 if launch is public.
- **Status**: addressed
- **Response**: 二次の confirmed 部分集合を採用: trial_history は初回 trialing|active webhook で冪等 insert; Customer metadata search 再利用。別メール farm は High 残差として Risks に明示（P0 fingerprint 横断は非必須）。

---

### Issue 8: Flyer weekly try-cap (6) and vision cost path under-specified / under-costed
- **Severity**: major
- **Section**: チラシ; コストモデル; OpenRouter client reality
- **Description**:
  - Product text locks **週次試行上限 6**, but SQL only shows success+reserved ≤ 2. No `attempt_count` / try ledger, no failure_code for try exhaustion, no interaction with global/attempt daily.
  - Cost model uses vision **$0.02–0.10** per flyer success. Reality for this codebase: OpenRouter client today is **text-only** (`OpenRouterMessage.content: string` in `openrouter.ts`); a 7-day structured menu with image multimodal + primary/repair + validation retries can exceed $0.10 easily, and **failed validation still bills** OpenRouter while not counting “success”. At 6 tries/week that is a deliberate cost-bomb vector if try-cap is missing or not enforced before send.
  - Image decompression bombs / polyglots: magic bytes + 4 MiB + long-edge 2048 help, but no lock on decoder library, max pixels before decode, or CPU time budget.
  - “household context refs” in multipart: must lock **server-side load of current household safety** (never trust client allergy snapshot) — implied but not as hard as generation integrity path.
- **Suggestion**: Add flyer weekly try ledger (or count sent attempts on week key) with CHECK; reserve try **before** OpenRouter; release try reservation only if never sent. Cost model: assume upper bound with repair. Specify image pipeline (e.g. sharp with pixel limit, no-op on decode failure). Flyer Function: `requireUserWithEmail` + server current-safety only. Budget timeout aligned with 60s/150s generation contract.
- **Status**: addressed
- **Response**: `ai_identity_flyer_weekly_tries` CHECK≤6、`reserve_flyer_weekly` で送信前 try reserve、`flyer_weekly_try_limit`。sharp+2048²、server safety only、multimodal path、60s/150s。コスト悲観再計算は Issue 11 と合わせて更新。

---

### Issue 9: Global cap change incomplete vs current hard max 20; Free starvation residual
- **Severity**: major
- **Section**: Global 20 との相互作用; env `GLOBAL_DAILY_AI_LIMIT`
- **Description**: Design correctly notes Plus attempt 20 can exhaust global 20 and recommends hard max **200**, ops default **80**. Current code **rejects** `p_global_limit` outside `1..20` in `reserve_ai_generation`, `reserve_ai_repair_call`, and `get_ai_usage_today`, and `env.ts` uses `globalDailyLimit(20)`. Design lists env hard max change but not every RPC bound. Even at 80, a few Plus heavies (4×20) starve Free users — acknowledged as P1 priority only, with no interim fairness (e.g. reserve portion for free) or alert threshold.
- **Suggestion**: Explicit RPC + env + preflight matrix: max 200, default 80; update all three SQL sites and tests/e2e reset helpers. For P0, lock monitoring threshold and optional lower per-user attempt if global remaining &lt; N (or accept residual with severity High in Risks).
- **Status**: addressed
- **Response**: GLOBAL 1..200 マトリクス（reserve/repair/usage/env/preflight/e2e）をロック。既定 80。Free 飢餓は P0 受け入れ残差 + remaining&lt;10 alert。P1 優先枠。

---

### Issue 10: RPC limit acceptance holes — Free elevation if caller bugs / wrong entitlement
- **Severity**: major
- **Section**: RPC 署名変更; Functions 配線
- **Description**: Design accepts `p_user_limit in (3,10)`, etc., from Functions based on `loadEntitlement`. Defense CHECK is raised to Plus max. If entitlement load fails open, caches stale Plus, or a bug passes 10 for Free, **CHECK will not save Free**. No fail-closed rule for entitlement read errors (throw 503 vs treat as Free). No note that `service_role` RPC remains the only writer — good today, but generation-repository must not soft-default to max limits.
- **Suggestion**: Lock: entitlement read failure → **Free limits** (or hard 503 with no reserve — prefer 503 fail-closed for billing ambiguity). Never default `p_user_limit` to defense max. pgTAP: free identity cannot reserve 4th success even if malicious RPC args… actually service_role only — then Function unit tests must prove free path always passes 3/6/4.
- **Status**: addressed
- **Response**: entitlement 失敗 → **503 fail-closed**（Free silent fallback 禁止）。defense max を default にしない。Function unit で Free 3/6/4 配線を証明。

---

### Issue 11: Cost model optimistic for quality + vision vs ¥580; heavy user unprofitable without harder caps
- **Severity**: major
- **Section**: コストモデル; L8/L9
- **Description**: Design already shows heavy user ~$5 ≲ ¥750 &gt; ¥580. Gaps:
  - Standard path is primary+repair (2 attempts) in existing generation service; 10 successes can consume up to ~20 attempts — cost ~2× single-call estimate.
  - Quality uses higher models **and** still consumes standard success (good) but cost line still understated.
  - Flyer all-or-nothing 7-day output + vision tokens understated; weekly try 6 multiplies.
  - Yearly ¥5,800 (~2 months free) worsens unit economics for annual.
  OpenRouter hard $ limit is necessary but is a **kill switch**, not a product control — hits all users.
- **Suggestion**: Recompute heavy-user bound with repair; consider reducing flyer tries, quality monthly, or Plus success 10 before public launch; require staging cost telemetry gate in rollout step 5; document “unprofitable heavy is accepted / not accepted” as a Key Decision.
- **Status**: addressed
- **Response**: repair+flyer try 悲観で ~$14/月を明示。**ヘビー赤字は受け入れる** Key Decision（L7–L9 を P0 で削らない）。staging 原価テレメトリを step 5 ゲート化。

---

### Issue 12: Trial / cancel UX for low-IT Japanese users incomplete (surprise charge risk)
- **Severity**: major
- **Section**: 価格・プラン構造; Free→Plus UX; Customer Portal
- **Description**: Trial copy at Checkout is good (“7 日間は無料…続く場合は登録したカードに請求”). Missing product locks:
  - In-app **pre-charge reminder** (e.g. day 5–6) — Stripe emails may be ignored/spam; app has settings trial_end but no push/notification design.
  - Cancel path is Portal-only; copy “お支払い・解約の管理” is OK, but no guarantee Portal Japanese locale / cancel survey off / retention offers (dark pattern risk if Stripe Portal configured with friction).
  - Yearly plan: larger surprise risk; no extra confirmation copy.
  - Delete-account copy says cancel is attempted, but charge timing if delete fails mid-period is only best-effort.
- **Suggestion**: Lock Portal Dashboard config (locale ja, cancel immediately vs period end aligned with entitlement, no dark-pattern offers). Settings must show trial end date + “無料期間終了後に課金” in plain Japanese. Optional: refuse yearly as first purchase in P0 (month only) to reduce surprise.
- **Status**: addressed
- **Response**: Portal locale ja・period-end 解約・dark pattern off を Dashboard チェックリスト化。trial 終了後課金の平易文+年額確認文。月額のみ制限は L3 のため不採用。アプリ内プッシュリマインドは通知基盤なしで非 P0 残差。

---

### Issue 13: qualityMode HMAC / command version interaction under-specified vs live v2 path
- **Severity**: major
- **Section**: 生成コマンド HMAC; API Changes
- **Description**: Live path uses `generation-command.v2` and `canonicalizeGenerationCommandV2` without `qualityMode` (`generation-command-integrity.ts`). Design says include `qualityMode` in integrity and “version bump if needed” under L12 truncate. Ambiguity:
  - Adding field without version bump breaks all clients mid-deploy.
  - Body schema on `generate-menu` / `generate-dish` is strict discriminated unions — `qualityMode` placement (top-level vs request) not fixed.
  - Repair/second OpenRouter call must use **same** model list as reserved quality mode; not stated.
  - Free client sending `qualityMode:true` must 403 **before** reserve (stated) — good; must also not mark quality counters.
- **Suggestion**: Lock field location, `generation-command.v3` (or explicit v2 additive rule with simultaneous client deploy only because pre-prod), repair inherits request.quality_mode snapshot column.
- **Status**: addressed
- **Response**: **`generation-command.v3`**、トップレベル `qualityMode: boolean` を HMAC canonical に含める。repair は `quality_mode` スナップショットで Plus モデルリスト継承。

---

### Issue 14: Minor factual / interface mismatches with codebase
- **Severity**: minor
- **Section**: sequence diagram; related paths; privacy version
- **Description**:
  - Sequence uses `POST /api/generations`; actual routes are `/api/generations/menu` and `/api/generations/dish`.
  - `privacyNoticeVersion` today is `2026-07-28.v1` (`shared/contracts/domain.ts`); design correctly bumps to `2026-07-29.v1`.
  - `releaseQuota`, `p_user_limit <> 3`, identity CHECK ≤3/≤6, env release-locked 3/6/4/600, global max 20 — **verified correct**.
  - `delete-account` today has no Stripe cancel step — extension order is reasonable.
  - Netlify `Permissions-Policy: payment=()` in `netlify.toml` is fine for hosted Checkout redirect; note if future Stripe embedded payment element is considered.
  - Roadmap still documents fixed 3/6/4/20 — design supersede table should explicitly list roadmap Locked Environment Contract as superseded for billing plan (it lists MVP/Plan8/freemium/copy; roadmap env table is another consumer implementers will follow).
- **Suggestion**: Fix path names; add roadmap env supersede row; keep privacy bump.
- **Status**: addressed
- **Response**: sequence を `/api/generations/menu` に修正。roadmap Locked Environment Contract を supersede 表へ追加。privacy `2026-07-29.v1` 維持。

---

### Issue 15: Webhook unmapped user = 200 swallows real misconfig
- **Severity**: minor
- **Section**: Open Question Q3; user 解決順
- **Description**: Default 200 + metric avoids retry storms (good) but a production mis-wiring (metadata missing, customer map failed) yields **silent non-entitlement** after paid Checkout — support burden and charge-without-access. Combined with kill-switch webhook disable, worse.
- **Suggestion**: Keep 200 for truly unknown customers; alert on metric threshold; settings UI “お支払い反映まで数十秒” + support path already partly noted — add “paid but Free after 5 min” diagnostic using Stripe customer id lookup by authenticated user only (server-side).
- **Status**: addressed
- **Response**: 200 維持 + **unmapped 閾値 alert 必須**。5 分後診断とサポート導線を明記。

---

### Issue 16: Logging / PII residual around Stripe and flyer
- **Severity**: minor
- **Section**: 可観測性; プライバシー
- **Description**: SafeLogEvent forbids email/receipt email — good. Residual: logging `stripe_customer_id` / `stripe_subscription_id` links payment identity to `user_id` in log sinks (may be acceptable ops need; not classified). Flyer “画像 hash の永続ログ” forbidden — good; ensure error logs don’t include multipart filenames with personal info.
- **Suggestion**: Explicit allowlist: log stripe ids only as opaque codes with user_id hash or request id; never log Checkout email fields from Stripe objects.
- **Status**: addressed
- **Response**: SafeLog allowlist に stripe opaque id を許可、Checkout email / multipart filename を禁止として固定。

---

### Strengths
- Correct supersede of MVP §18 “no billing” and freemium L7 “no paywall UI,” while preserving Free 3/day and identity HMAC delete-resistance — matches repo direction.
- Server-only entitlement, ignore client `plan`, webhook signature + event_id idempotency, private schema non-exposure: right trust model.
- Verified accurate description of current Free locks: `releaseQuota` 3/6/4/600, `p_user_limit <> 3`, identity CHECK ≤3/≤6, hard-coded attempt 6, env `releaseLockedInteger`, `GLOBAL` max 20.
- past_due 72h + canceled through `current_period_end` is a clear, user-fair policy (once past_due_since is fixed).
- Quality consumes standard success (cost control); flyer success independent of daily success (product clarity) — trade-offs explicit.
- Trial history by identity_key is the right *shape* of mitigation for delete/re-register (timing must be locked).
- Local mock gating pattern mirrors OpenRouter mock (exact URL, not isLocal alone).
- Conversion UX prioritizes hard-limit CTA over dark soft pressure; Free prefix rules integrate with existing `formatFreeTierQuotaCopy`.
- Alternatives table is honest (no multi-tier, no metered, no Free cut to 1).
- Pre-prod L12 allows breaking CHECK/schema change without migration theater — appropriate for this branch.

---

### Verification notes (code vs design claims)

| Claim | Code reality | Verdict |
|-------|--------------|---------|
| Free success 3 / attempt 6 / short 4 / global 20 | `releaseQuota`, env, identity CHECK, hard-coded 6/4, global 1..20 | Match |
| `p_user_limit <> 3` release_quota_mismatch | `reserve_ai_generation` / status RPC | Match |
| identity tables `private.ai_identity_*` | `20260728150000_identity_daily_quota.sql` | Match |
| short window user-scoped CASCADE | `ai_user_rate_windows` | Match |
| `AI_QUOTA_DISABLED` local only | `env.ts` `aiQuotaDisabled` | Match |
| HMAC identity email normalize | `quota-identity.ts` | Match |
| delete-account pre-release then Auth delete | `delete-account.ts` | Match (no Stripe yet) |
| OpenRouter text generation only today | `openrouter.ts` messages content string | Flyer needs new path |
| privacyNoticeVersion | `2026-07-28.v1` | Bump planned |
| Generate API path | `/api/generations/menu` / `dish` | Diagram wrong |

---

### Residual accepted risks (if design deliberately keeps them)
- Multi-email / multi-card trial farms without Radar.
- Global 80 Free starvation until P1 priority lane.
- Heavy Plus users above ARPU even after caps.
- Account delete Stripe cancel best-effort orphans.

These should remain in Risks with severity; they should not be silent.

---

### Verdict checklist (for author)
Before implementation plan approval, at least resolve **Issues 1–7** (critical/major billing correctness and quota schema). Issues 8–13 should be decided (lock or explicit residual). Minors 14–16 can ship as doc nits in the same revision pass.

**Post-r1:** Issues 1–16 all **Status: addressed**. Design is Review-ready for implementation planning.


---

## Revision Summary

**Date:** 2026-07-29  
**Design:** `docs/archive/superpowers/specs/2026-07-29-paid-plan-stripe-design.md` r1 → **Review-ready**  
**Secondary:** all `must_fix_before_implement` items locked in design.

| Issue | Secondary | Design action |
|-------|-----------|---------------|
| 1 short-window 8 | CONFIRMED | rate_windows CHECK≤8 + mark/usage snapshot matrix |
| 2 webhook order | CONFIRMED | last_stripe_event_created ignore-older + tests |
| 3 BILLING_ENABLED | CONFIRMED | webhook stays up; Free quota + product kill; reconcile runbook |
| 4 atomic reserve | CONFIRMED | reserve_ai_generation quality TX; reserve_flyer_weekly |
| 5 double checkout | CONFIRMED | checkout_locks + dual-sub cancel-newer |
| 6 past_due_since | CONFIRMED | set on any past_due; NULL = not entitled |
| 7 trial_history | PARTIAL | webhook trialing\|active idempotent insert; multi-email High residual |
| 8 flyer try 6 | CONFIRMED | tries ledger + pre-send; image pipeline; multimodal |
| 9 global | PARTIAL | max 200 matrix default 80; starvation residual |
| 10 fail-closed | CONFIRMED | 503; never defense-max default |
| 11 cost | PARTIAL | pessimistic bound; heavy unprofit accepted KD |
| 12 UX | PARTIAL | Portal checklist + trial copy; no push P0 |
| 13 qualityMode | CONFIRMED | generation-command.v3 top-level |
| 14 paths/roadmap | CONFIRMED | menu/dish paths; roadmap supersede |
| 15 unmapped | PARTIAL | 200 + mandatory alert |
| 16 logging | PARTIAL | stripe id allowlist; no filenames |

Open issues remaining in this review file: **0**.
