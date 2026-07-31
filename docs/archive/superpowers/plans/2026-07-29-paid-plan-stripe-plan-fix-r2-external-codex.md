# Paid-plan Stripe plan — external Codex open issues r2 response

| Item | Value |
|------|-------|
| Plan | `docs/archive/superpowers/plans/2026-07-29-paid-plan-stripe.md` (**revision r2**) |
| Authority | `docs/archive/superpowers/plans/2026-07-29-paid-plan-stripe-external-review-codex-gpt5.md` |
| Prior | r1 companion `docs/archive/superpowers/plans/2026-07-29-paid-plan-stripe-plan-fix-r1.md` |
| Date | 2026-07-29 |
| Scope | Plan document only（application feature code なし） |
| Verdict | All 6 open external issues **addressed_in_plan** |

## Prior must_fix update

| ID | Disposition (after r2) |
|----|------------------------|
| ADV-4 | **fixed_in_plan**（Task6 DB v3 cutover + pgTAP re-sign + overload DROP + grant inventory + targeted grep gates + full db-test。r1 は Task3 ファイル列挙のみで DB HMAC version 切替が欠けていた） |
| ADV-1..3, ADV-5..15, C1–C3, M1–M9（M6 n/a） | unchanged: fixed_in_plan / not_applicable as in external review Prior table |

---

## Issue dispositions

### Issue 1 — Task 6 DB `generation-command.v2` → v3 cutover

| Field | Value |
|-------|-------|
| Severity | critical |
| Status | **addressed_in_plan** |
| Response | Task6 Files / Interfaces / GREEN migration に DB cutover 手順を追加: (0) processing truncate (L12), (1) `request_hmac_version` CHECK を v3 のみへ置換, (2) live SQL 全関数の v2 拒否を v3 のみ受入へ, (3) 旧 overload `DROP FUNCTION`, (4) grant inventory, (5) Task3 列挙 + quality 関連 + `menu_generation_model` / `account_deletion` 等 **全** `supabase/tests/database` call site を v3 更新。RED: v3 受入、v2 → `invalid_request_hmac`、CHECK 拒否、overload inventory。Grep gate: (A) `src`/`shared`/`netlify` ヒット 0, (B) `supabase/tests/database` ヒット 0, (C) **歴史 `supabase/migrations` はゲート対象外**, (D) migrate 後の実効制約/関数定義。GREEN: **full** `db-test` 必須。Prior ADV-4 を fixed_in_plan に更新。 |

### Issue 2 — Webhook crash-safe single boundary

| Field | Value |
|-------|-------|
| Severity | critical |
| Status | **addressed_in_plan** |
| Response | Task2: 単独 `insert_billing_webhook_event`（衝突 = 永久 duplicate no-op）を **禁止**。代わりに `public.process_billing_stripe_event(p_payload jsonb)` を **単一 SECURITY DEFINER TX** として定義: (1) claim event, (2) lock subscription row, (3) ignore-older / same-second（`retrieved_subscription` 入力可）, (4) project entitlement, (5) processed = TX commit。中途例外は全体 ROLLBACK で event 行も消え、Stripe 再送で再処理可能。`get_billing_entitlement_for_user` は順序用 `last_stripe_event_*` を返さない（順序は RPC 内完結）。`upsert_billing_subscription_from_stripe` は reconcile/runbook 専用。Task4 RED: process のみ呼び出し、claim-then-crash → retry 投影、delayed active 後 re-entitle なし、idempotent duplicate_processed。 |

### Issue 3 — Checkout lock bind RPC

| Field | Value |
|-------|-------|
| Severity | major |
| Status | **addressed_in_plan** |
| Response | Task2 DDL: `billing_checkout_locks` を `lock_token NOT NULL UNIQUE` + `stripe_checkout_session_id NULL` に。RPC: `acquire_billing_checkout_lock(user, lock_token, expires_at)`（Session ID 不要）, `bind_billing_checkout_session(user, lock_token, session_id)`, `release_billing_checkout_lock(user, lock_token?, session_id?)`。Task4 状態遷移: acquire → sessions.create → bind → return url; create 失敗は token release; bind 失敗は Session expire 補償 + release; completed/expired は session id release。RED: happy path、create-fail release、bind-fail expire+release、completed release。A5 lock 文言も更新。 |

### Issue 4 — delete-account list all subscriptions

| Field | Value |
|-------|-------|
| Severity | major |
| Status | **addressed_in_plan** |
| Response | Task8 Interfaces: customer 取得後 `stripe.subscriptions.list({ customer, status: "all" })`（または non-terminal 列挙相当）で live/non-terminal を全件 best-effort `subscriptions.cancel`; 部分失敗は `billing_cancel_failed` ログ（opaque id のみ）して残りを継続し、**常に Auth delete へ**。DB の subscription 1 行だけを cancel 対象にしない。RED: customer 0 / sub 1 / 複数 / 1 件 cancel 失敗でも Auth delete。 |

### Issue 5 — sequential Tasks only

| Field | Value |
|-------|-------|
| Severity | major |
| Status | **addressed_in_plan** |
| Response | 「並列可: Task1 ∥ Task2」を削除。一意実行順 **Task1→2→3→4→5→6→7→8** を正とする。依存図は論理説明専用と明記。計画末尾に per-Task gate: implementer → verifier → primary reviewer → secondary reviewer → write-once handoff（`AGENTS.md` / `SubAgents.md`）を列挙。 |

### Issue 6 — Task 8 full AGENTS §8 nine commands

| Field | Value |
|-------|-------|
| Severity | major |
| Status | **addressed_in_plan** |
| Response | Task8 Step7 に AGENTS.md §8 の 9 コマンドを **同一順・独立コマンド**で列挙: (1) format:check (2) lint (3) typecheck (4) full `npx vitest run` (5) `./scripts/reset-local-db.sh` (6) profile db-test (7) `./scripts/run-e2e.sh` (8) build (9) `git diff --check`。規則: 1 呼び出し = 1 コマンド、`&&` 禁止、失敗時は失敗ステップから再実行、script 実行前の差分安全確認。早見表も最終は §8 正本へ合わせた。 |

---

## Plan locations touched（要約）

| Area | Change |
|------|--------|
| Header Architecture / Plan revision | r2; process RPC + checkout bind |
| A5 adversarial lock | acquire→bind→release |
| Task2 RPC table + DDL + RED/GREEN | process_billing_stripe_event; lock_token; bind; release by token/session |
| Task4 Interfaces + RED webhook/checkout + GREEN notes | crash-safe RED; checkout state machine |
| Task6 title/Files/DB cutover/gates/RED/GREEN | v3 DB + pgTAP + full db-test |
| Task8 Interfaces + RED + Step7 §8 | list all subs; nine commands |
| Spec checklist / Placeholder / Revision log | r2 rows; ADV-4 fixed |
| 実行順序 / Per-Task gate / 検証早見 / Self-review note | sequential + gates + §8 |

---

## What was not changed

- 製品定数（Free 3/6/4/600、Plus 10/20/8、品質 3/20、チラシ 2+try 6）は不変
- ルート path、STRIPE pin、`privacyNoticeVersion`、migration stamp series は不変
- 設計書本体の改訂は本 companion の範囲外（plan が checkout_locks DDL の nullable session / lock_token を実装正本として上書きする旨を Task2 に明記）
- Application / SQL / TS 実装コードは未着手

## Ready

Implementer は plan **r2** を正本として Task1 から逐次開始可能。dispatch 前に human が Task2 process RPC と Task6 DB cutover 節を skim することを推奨。
