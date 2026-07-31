## Design Document Re-Review (r3 final): こんだて日和 Plus（Stripe フリーミアム）

**Document:** `docs/archive/superpowers/specs/2026-07-29-paid-plan-stripe-design.md` (status **Review-ready**, r2)  
**Prior r2:** `docs/archive/superpowers/specs/2026-07-29-paid-plan-stripe-rereview.md`  
**Stance:** final adversarial check — fixes must appear in **design body**, not only Response fields

### Summary

**APPROVE** for implementation planning.  
**Open issues: 0** (critical 0 / major 0 / minor 0).

All three r2 findings are locked in the normative design text (acceptance table, algorithms, reserve ordering, multi-ledger table, testing, Key Decisions, Revision Summary r2). No drive-by nits reopened.

---

### r2 verification (design body only)

| r2 issue | Required lock | Design body evidence | Result |
|----------|---------------|----------------------|--------|
| **1** Flyer success full still burns try | S1 fail **before** try/attempt/global mutation; OpenRouter unreachable | Acceptance: “Flyer 成功 2 済の追加 POST → `flyer_weekly_limit` のみ。try/attempt/global **非変異**。OpenRouter **非呼び出し**”. Sequence alt `success 満杯` → try 非変異. Ordered table **S1** (`success_count + reserved_count >= 2` → return, 一切なし). **禁止解釈**: 成功尽でも try 常時は仕様違反. pgTAP: try 台帳不変 + mock 呼び出し 0. Key Decision 行. | **Addressed** |
| **2** Short overclaim as reserved++ | Mark/send-time only; no rate_windows reserved column | Atomic multi-ledger table: short = “**reserve 時は触らない**…`sent_count` のみ…**送信確定時** `mark_ai_global_sent` / flyer 送信直前”. Explicit: short 用 reserved 列は **作らない**; phantom reserved **禁止**. Plus 8 = CHECK ≤8 + snapshot only. | **Addressed** |
| **3** Same-second `event.id` string order | No lexicographic temporal tie-break | Order algorithm: same second → **do not** use string order (r2 comment); equal `event.id` = no-op resend; else **Stripe Subscription retrieve** as source of truth; retrieve fail → **terminal-status precedence** (canceled/unpaid/incomplete_expired > past_due > active/trialing > incomplete/paused); residual same-second skip logged. **禁止**: `event.id` lexicographic `<=`. Unit (d) same-second cannot downgrade terminality. | **Addressed** |

---

### Open issues

**None.**

---

### Residual accepted (already in design Risks — not open defects)

- Multi-email / multi-card trial farms (identity = email HMAC).
- GLOBAL=80 Free starvation until P1 priority.
- Heavy Plus cost ≫ ¥580 under caps + shared OpenRouter hard $ limit.
- Account-delete Stripe cancel best-effort orphans.
- No in-app pre-charge push; same-second webhook residual when retrieve fails (terminality preference, not re-entitle infinite).

---

### Disposition

| Class | Count |
|-------|-------|
| Critical open | **0** |
| Major open | **0** |
| Minor open | **0** |
| Prior primary 1–16 | addressed (r1) |
| Prior r2 1–3 | addressed (r2 design body) |

**Verdict: APPROVE.** Design is ready for implementation planning (PR plan in document). No further adversarial design cycle required unless product scope changes.
