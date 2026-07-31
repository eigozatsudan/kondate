# Plan Re-Review r2: paid-plan-stripe

Reviewer: Grok Build re-review (read-only)
Date: 2026-07-29
Plan revision claimed: r2
Verdict: APPROVE

## External Issue disposition
| Issue | Severity | Disposition |
| 1 | critical | fixed_in_plan |
| 2 | critical | fixed_in_plan |
| 3 | major | fixed_in_plan |
| 4 | major | fixed_in_plan |
| 5 | major | fixed_in_plan |
| 6 | major | fixed_in_plan |

## Evidence for Issues 1–6

### Issue 1 — Task 6 DB `generation-command.v2` → v3 cutover
- Evidence:
  - Task 6 title and Files: `### Task 6: 品質モード v3 + DB HMAC v3 cutover + …`；migration `20260729150000_quality_mode_ledgers.sql` を **quality 台帳 + generation-command.v3 DB cutover を同一 migration** と明記（plan ~L1719–1722）。
  - Files に Task3 署名感度 pgTAP 全 call site 再掲 + `menu_generation_model` / `account_deletion` / `plan_aware_quota` / その他 `supabase/tests/database/**/*.sql`（~L1734–1747）。
  - **DB cutover 必須手順 0–5**（~L1795–1828）: processing truncate (L12) → CHECK を v3 only → live SQL の v2 拒否を v3 のみへ（`reserve_ai_generation` 正本 supersede）→ 旧 overload `DROP FUNCTION` → grant inventory → pgTAP fixture 全更新。
  - Grep gates A/B/D with **C 歴史 migration 非対象**（~L1831–1855）。
  - RED: v3 accept / v2 → `invalid_request_hmac` / CHECK 拒否 / overload inventory（~L1932–1947）。GREEN SQL コメントに cutover 手順（~L1963–1968）。GREEN verify: full `db-test` 必須（~L2047–2050）。
  - Prior ADV-4: Plan revision log で **fixed_in_plan**（~L2585, ~L2601）。
- Disposition: **fixed_in_plan**

### Issue 2 — Webhook crash-safe single boundary
- Evidence:
  - Architecture header: 単一 SECURITY DEFINER TX `process_billing_stripe_event`（claim + lock + order + project + processed 不可分）（~L7）。
  - Task 2 RPC table: `process_billing_stripe_event` が **Webhook 唯一の投影境界**；`upsert_…` は reconcile only；`get_billing_entitlement_for_user` は `last_stripe_event_*` を返さない（順序は RPC 内完結）（~L376–379）。
  - **禁止**: 単独 `insert_billing_webhook_event` の永久 duplicate no-op（~L389, ~L578）。
  - 単一境界手順 1–5 + `p_payload` キー + outcomes（`applied` / `duplicate_processed` / `stale_ignored` / …）；途中例外は ROLLBACK で event 行も消え再送再 claim 可（~L391–451）。
  - pgTAP RED: claim-then-crash を BEGIN/ROLLBACK で模擬 → re-call still applies（~L532–537）。
  - Task 4: Webhook 書込は process のみ；RED named cases（process once / claim-then-crash retry / stale / no evt_ lex / delayed re-entitle 禁止 / idempotent `duplicate_processed` / A3 webhook）（~L1187, ~L1268–1326）。
- Disposition: **fixed_in_plan**
- Note (not open): 同一 `stripe_event_id` の並行配送は PG UNIQUE の uncommitted wait で正しく実装すれば safe。計画は「成功完了済みのみ duplicate」と TX 一体を要求しており、別 lease 状態機械は不要と判断。

### Issue 3 — Checkout lock bind RPC
- Evidence:
  - A5: acquire（`lock_token`・session NULL）→ create → bind → release；bind 失敗時 Session expire 補償（~L40）。
  - DDL override: `lock_token NOT NULL UNIQUE` + `stripe_checkout_session_id NULL`（設計 not null を計画上書きと明記）（~L453–463）。
  - RPCs: `acquire_billing_checkout_lock(user, lock_token, expires_at)`（Session ID 不要）；`bind_billing_checkout_session`；`release` by token **or** session id（~L382–384）。
  - Task 4 状態遷移 1–7 + create 失敗 release / bind 失敗 expire+release / completed|expired release by session id（~L1349–1365）。
  - RED: happy path / create-fail release / bind-fail expire+release / completed release；409 only when lock **not expired**（~L1370–1389）。
- Disposition: **fixed_in_plan**

### Issue 4 — delete-account list all subscriptions
- Evidence:
  - Task 8 Interfaces 4a–e: `get_billing_customer_by_user` → empty skip → else `stripe.subscriptions.list({ customer, status: "all" })` → live/non-terminal 全件 best-effort cancel → 部分失敗は `billing_cancel_failed`（opaque id）で残り継続 → **常に Auth delete**；DB 1 行だけを cancel 対象にしない（~L2287–2301）。
  - RED: 0 customer / 1 sub / 複数 / 1 件 cancel 失敗でも Auth delete（~L2310–2335）。
  - `get_billing_customer_by_user` 戻りは `{ stripe_customer_id }` のみと Task2 で固定し、list 解決と整合（~L385）。
- Disposition: **fixed_in_plan**

### Issue 5 — sequential Tasks only
- Evidence:
  - 「並列可: Task1 ∥ Task2」は計画本文に **残存なし**（grep 0；削除済み明記 ~L2634）。
  - **実行順序（一意・逐次のみ）**: `Task1 → Task2 → … → Task8`；並列禁止；論理依存図は説明専用（~L2626–2646）。
  - **Per-Task gate**: implementer → verifier → primary reviewer → secondary reviewer → write-once handoff → progress ledger（~L2648–2659）。
- Disposition: **fixed_in_plan**

### Issue 6 — Task 8 AGENTS §8 nine commands
- Evidence:
  - Task 8 Step 7: AGENTS.md §8 必須 9 検証を **同一順・独立コマンド**で表 + コピー用 bash ブロック列挙（~L2393–2452）。
  - 順: (1) format:check (2) lint (3) typecheck (4) full `npx vitest run` (5) `./scripts/reset-local-db.sh` (6) profile db-test (7) `./scripts/run-e2e.sh` (8) build (9) `git diff --check`。
  - 規則: 1 呼び出し = 1 コマンド、`&&` 禁止、失敗時は失敗ステップから再実行、script 実行前の差分安全確認（~L2395–2400）。
  - 検証コマンド早見「最終（Task8）」も同じ 9 順（~L2689–2701）。
- Disposition: **fixed_in_plan**

## New open issues (if any)

None that block implementation start.

Adversarial scan notes (closed / not raised as open):

- **process_billing_stripe_event 仕様粒度**: claim 順序・payload キー・outcomes・stale 時 event 行残し・Function 側 same-second retrieve 入力・trial は RPC 外は十分。GREEN はコメント骨格だが Task2 RED/pgTAP と Task4 abuse suite が契約を固定。
- **bind race / orphan Session**: create→bind 間 crash は lock TTL + dual-sub cancel で既存設計の残差。r2 は bind RPC と expire 補償を追加済みで Issue 3 の穴は閉じている。
- **設計書の旧「insert 衝突 no-op」文言**: design ~L481 は旧 split 冪等のまま。計画は process 単一 TX を実装正本とし Task2 で split public claim を禁止。companion どおり design 本体改訂は r2 範囲外。実装は plan Task2/4 に従えば Issue 2 は再発しない。
- **v3 migration**: Task6 に CHECK / live RPC / DROP overload / grants / 全 pgTAP / targeted gates / full db-test が揃い、Issue 1 の「v3 切替不完全」は閉じた。

## Counts
- open critical: 0
- open major: 0
- open minor: 0
- open nit: 0

## Summary

External Codex Issues **1–6 はすべて計画本文（Task 節・RPC 表・RED・実行順・Task8 §8）に具体化されており**、companion のみの主張ではない。Prior ADV-4 も Task6 DB cutover により plan 上 fixed。r2 導入の process 単一境界 / bind 状態機械 / list-all cancel / 逐次+handoff / §8 九コマンドに新 critical/major の抜けは見当たらない。

**Verdict: APPROVE** — implementer は plan r2 を正本として Task1 から逐次開始してよい。
