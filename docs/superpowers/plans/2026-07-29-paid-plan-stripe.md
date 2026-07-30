# こんだて日和 Plus（Stripe フリーミアム） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free を削らず（成功 3 / attempt 6 / short 4/600s）、単一有料プラン「こんだて日和 Plus」（¥580/月・¥5,800/年・7 日 trial）を Stripe Checkout + Portal + Webhook 正本で提供し、Plus 枠（10/20/8）、品質モード（3/日・20/月）、チラシ画像→1 週間献立（成功 2/JST 週 + try 6）を Functions が entitlement 強制で開放する。

**Architecture:** ブラウザは plan を主張しない。`GET /api/billing/entitlement` と生成経路が `loadEntitlement`（DB 読取失敗は **503 fail-closed**）で枠を決める。Webhook 正本は **単一 SECURITY DEFINER TX** `process_billing_stripe_event`（event claim + subscription 行ロック + ignore-older / same-second + entitlement 投影 + processed 確定を不可分に実行。claim だけ成功して投影が落ちる経路を禁止）。billing 表への書込は **SECURITY DEFINER write RPCs のみ**（service_role EXECUTE; 表への direct DML 禁止）。Checkout は `lock_token` で acquire → Session 作成 → `bind_billing_checkout_session` → completed/expired/失敗で release。`planQuota` が製品定数、DB CHECK は防御 max（10/20/8）。品質は `reserve_ai_generation(..., p_quality_mode=true)` 原子 multi-ledger（通常 success/attempt も同一 TX で消費）。チラシは `reserve_flyer_weekly`（S1 成功枠満 → try/OpenRouter 非接触）。fail/stale/account-delete は quality/flyer **reserved** も対称解放。`BILLING_ENABLED=false` でも Webhook は鍵があれば継続し枠は Free 強制。

**Tech Stack:** TypeScript strict / ESM、React 19 + Vite 8 + React Router 8 Data Mode、TanStack Query 5、Zod 4、Netlify Functions、Supabase Postgres（SECURITY DEFINER RPC + `private` schema）、Stripe Node SDK（`stripe@22.3.2` exact pin、**`STRIPE_API_VERSION = "2026-06-24.dahlia"`** 固定・内部テスト前に ADV-13 再ピン）、Vitest / React Testing Library / Playwright / pgTAP、Docker 経由 `npm`（`docker compose run --rm --no-deps app …`）。

**Plan revision:** r2 — external Codex review（`docs/superpowers/plans/2026-07-29-paid-plan-stripe-external-review-codex-gpt5.md`）の open 6 件を計画修正（companion: `docs/superpowers/plans/2026-07-29-paid-plan-stripe-plan-fix-r2-external-codex.md`）。r1: adversarial + crosscheck + secondary must_fix（`docs/superpowers/plans/2026-07-29-paid-plan-stripe-plan-fix-r1.md`）。

## Global Constraints

- **設計正本:** `docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md`（Review-ready r2）。矛盾時は設計が MVP / Plan 8 / freemium / コピー簡素化の課金・枠関連を supersede。
- **再導出禁止 L1–L16** と敵対的ロック（下記 Adversarial locks）。数値・ルート・失敗コード・CHECK 上限を勝手に「改善」しない。
- **現行コード事実（inventory 2026-07-29）:**
  - `releaseQuota` は `shared/contracts/generation.ts` L565–570 で Free 固定 3/6/4/600。`planQuota` モジュールは **未実装**。
  - 枠 RPC 正本 migration: `supabase/migrations/20260728150000_identity_daily_quota.sql`（`p_user_limit <> 3`、attempt 硬コード 6、short 硬コード 4）。
  - `ai_user_rate_windows.sent_count between 0 and 4`（`20260711002000`、以降未変更）。
  - `usageTodayDataSchema` は literal 3/6/4。`generation-command.v2` のみ。`OpenRouterMessage.content: string` のみ。
  - `privacyNoticeVersion = "2026-07-28.v1"`。`stripe` package **未導入**。最新 migration stamp **`20260729120000`**。
  - `GLOBAL_DAILY_AI_LIMIT` max **20**（`env.ts` `globalDailyLimit(20)`）。本番推奨 80・max 200 は本設計。
- **Migration timestamps:** 本 Plan の新規 SQL はすべて **`20260729130000` 以降**（series 下記 File map）。
- **Node コマンド:** Docker。**1 ツール呼び出し = 1 コマンド**（`&&` / `;` 連結禁止）。
  - ホスト独立: `docker compose run --rm --no-deps app …`
  - DB: `docker compose run --rm migrate` / `docker compose --profile test run --rm db-test`（`app` 内から Docker socket 不可）
  - E2E: `./scripts/run-e2e.sh`
- **コミット:** 日本語 Conventional Commits。`git push` / PR 作成 / 本番デプロイ禁止。生成物 `package-lock.json` は `npm install` 経由のみ。`database.generated.ts` は typegen のみ。
- **秘密:** `VITE_STRIPE_*` / `VITE_BILLING_*` は `parseServerEnv` で throw。カードデータは Stripe ホストのみ。

### Adversarial locks（実装・テストで必ず固定）

| ID | ロック |
|----|--------|
| A1 | short CHECK **`sent_count <= 8`**。消費は **mark/send 時**（`quota_short_limit` スナップショット）。reserve で `ai_user_rate_windows` を変異しない・reserved 列を新設しない |
| A2 | Webhook: `event.created < last_stripe_event_created` → 200 no-op。**evt_ id 文字列順は時系列に使わない**。同一秒は retrieve or 終端性優先 |
| A3 | `BILLING_ENABLED=false` でも Webhook は鍵があれば **稼働継続**（署名 + `process_billing_stripe_event`）。Checkout/Portal/品質/チラシ閉鎖 + **枠 Free 強制** |
| A4 | 品質 / チラシは **単一 SECURITY DEFINER TX** で multi-ledger reserved++。部分 reserved 残禁止 |
| A5 | 並行 Checkout: `acquire`（`lock_token`・session id は NULL）→ Session create → `bind_billing_checkout_session` → completed/expired/失敗で release（token または session id）。bind 失敗時は作成済 Session を expire 補償。409 `billing_checkout_in_progress` / `billing_already_entitled` |
| A6 | `status=past_due AND past_due_since IS NULL` → **`plusEntitled=false`**（fail-closed） |
| A7 | `billing_trial_history` は **初回** webhook status ∈ (`trialing`,`active`) で冪等 insert。放棄 Checkout のみでは焼かない |
| A8 | Flyer: try は成功枠に空きがあるときのみ OpenRouter 前に reserve（triesPerJstWeek **6**） |
| A9 | entitlement 読取失敗 → **HTTP 503** `billing_entitlement_unavailable`。defense max を default にしない |
| A10 | `qualityMode` は **`generation-command.v3` トップレベル boolean**。HMAC canonical に含める |
| A11 | Flyer 成功 2 済 → **`flyer_weekly_limit` のみ**。try/attempt/global **非変異**。OpenRouter **0 回** |

---

## File map

| パス | 役割 | Task |
|------|------|------|
| `shared/contracts/plan-quota.ts` | `planQuota` / re-export `releaseQuota` | 1 |
| `shared/contracts/plan-quota.test.ts` | 数値ロック | 1 |
| `shared/contracts/generation.ts` | `releaseQuota` 再エクスポート、`usageTodayDataSchema` plan 対応、v3 command、issueMessages 新規 codes | 1,3,5,6,7 |
| `shared/copy/plan-tier.ts` | `formatPlanQuotaCopy` | 1 |
| `shared/copy/plan-tier.test.ts` | Free 接頭 / Plus 中立 | 1 |
| `shared/contracts/billing.ts` | checkout/portal/entitlement Zod | 4 |
| `shared/contracts/billing.test.ts` | wire 契約 | 4 |
| `shared/contracts/flyer-weekly.ts` | `weeklyFlyerMenuSchema` + request/response | 7 |
| `shared/contracts/domain.ts` | `privacyNoticeVersion` → `2026-07-29.v1` | 8 |
| `supabase/migrations/20260729130000_billing_entitlement.sql` | billing 表 + **read/write** SECURITY DEFINER RPCs（service_role only） | 2 |
| `supabase/migrations/20260729140000_plan_aware_quota.sql` | CHECK 10/20/8、RPC plan params、request スナップショット、global 1..200 | 3 |
| `supabase/migrations/20260729150000_quality_mode_ledgers.sql` | quality day/month + reserve quality 分岐 | 6 |
| `supabase/migrations/20260729160000_flyer_weekly.sql` | flyer success+tries + `reserve_flyer_weekly` | 7 |
| `supabase/tests/database/billing_entitlement.test.sql` | pgTAP billing | 2 |
| `supabase/tests/database/plan_aware_quota.test.sql` | pgTAP 10/20/8・mark short | 3 |
| `supabase/tests/database/quality_mode_reserve.test.sql` | 並行 quality | 6 |
| `supabase/tests/database/flyer_weekly_reserve.test.sql` | S1 try 非変異 | 7 |
| `netlify/functions/_shared/env.ts` | BILLING/STRIPE/PLUS_MODELS/GLOBAL 200 | 3,4,6 |
| `netlify/functions/_shared/billing-entitlement.ts` | `loadEntitlement` / `computePlusEntitled` / `applyQuotaPlan` | 3,4 |
| `netlify/functions/_shared/billing-stripe.ts` | Stripe client factory | 4 |
| `netlify/functions/_shared/billing-webhook.ts` | 署名・user 解決・`process_billing_stripe_event` 1 回呼び出し | 4 |
| `netlify/functions/billing-checkout.ts` | `POST /api/billing/checkout` | 4 |
| `netlify/functions/billing-portal.ts` | `POST /api/billing/portal` | 4 |
| `netlify/functions/billing-webhook.ts` | `POST /api/billing/webhook` | 4 |
| `netlify/functions/billing-entitlement.ts` | `GET /api/billing/entitlement` | 4 |
| `netlify/functions/flyer-weekly.ts` | `POST /api/flyer-weekly` | 7 |
| `netlify/functions/_shared/generation-repository.ts` | entitlement + plan limits + qualityMode | 3,6 |
| `netlify/functions/_shared/generation-command-integrity.ts` | v3 HMAC + qualityMode | 6 |
| `netlify/functions/_shared/openrouter.ts` | multimodal content + Plus models | 6,7 |
| `netlify/functions/delete-account.ts` | Stripe cancel best-effort | 8 |
| `netlify/functions/usage-today.ts` | plan-aware RPC args | 3 |
| `tools/stripe-mock/` | ローカル Checkout/Portal/Webhook 疑似 | 4 |
| `docs/runbooks/billing-reconcile.md` | 再有効化手順 | 4,8 |
| `docs/deployment/netlify.md` | env 境界 | 4,8 |
| `docs/testing/database-access-matrix.md` | billing 表 grants | 2 |
| `src/features/billing/` | entitlement hook / checkout API / Plan section | 5 |
| `src/features/household/household-settings-page.tsx` | プランセクション | 5 |
| `src/features/planner/...` | 硬上限 CTA・soft 1 残・flyer locked | 5,7 |
| `src/features/generation/...` | quality トグル・CTA | 5,6 |
| `src/features/history/components/regeneration-sheet.tsx` | Plus CTA | 5 |
| `src/features/account/delete-account-dialog.tsx` | 削除文面 | 8 |
| `src/features/privacy/privacy-copy.ts` | 課金追記 | 8 |
| `src/features/generation/pages/menu-result-page.tsx`（または success 面） | L10-6 flyer upsell | 5 |
| `netlify/functions/_shared/logger.ts` | SafeLog billing allowlist | 4 |
| `tools/e2e-function-server.mjs` | billing + flyer Function allowlist | 4,7,8 |
| `tools/e2e-function-server.test.mjs` | allowlist 登録テスト | 4,7 |
| `scripts/preflight-production.mjs` | GLOBAL max 200・Stripe 鍵 | 3,8 |
| `scripts/verify-openrouter-models.mjs` | PLUS_MODELS も検証 | 6 |
| `e2e/specs/` | billing / hard-limit CTA / flyer | 8 |
| `package.json` / `package-lock.json` | `stripe@22.3.2`, `sharp` exact, `db:test` profile | 4,7,8 |
| `src/shared/types/database.generated.ts` | typegen only | 2,3,6,7 |
| `.env.example` | STRIPE_* / `STRIPE_API_VERSION=2026-06-24.dahlia` / BILLING / PLUS_MODELS | 4,6 |

### Migration series（`> 20260729120000`）

| Stamp | File |
|-------|------|
| `20260729130000` | `billing_entitlement.sql` |
| `20260729140000` | `plan_aware_quota.sql` |
| `20260729150000` | `quality_mode_ledgers.sql` |
| `20260729160000` | `flyer_weekly.sql` |

---

### Task 1: `planQuota` 契約とプラン別コピー基盤（PR1）

**Files:**
- Create: `shared/contracts/plan-quota.ts`
- Create: `shared/contracts/plan-quota.test.ts`
- Create: `shared/copy/plan-tier.ts`
- Create: `shared/copy/plan-tier.test.ts`
- Modify: `shared/contracts/generation.ts`（`releaseQuota` を `plan-quota` から re-export。ランタイム枠はまだ Free 固定のままでも **定数の正本を移す**）
- Modify: `shared/contracts/generation.test.ts`（`releaseQuota` import 経路が壊れないこと）
- Modify: `shared/copy/free-tier.test.ts`（既存接頭は維持。plan-tier との二重接頭を禁止する回帰を 1 本）

**Interfaces:**
- Consumes: なし（新規定数）
- Produces:
  - `export const planQuota`（設計どおり）
  - `export const releaseQuota`（Free 別名。既存 import 互換）
  - `export type PlanCode = "free" | "plus"`
  - `export function formatPlanQuotaCopy(body: string, plan: PlanCode): string`

- [ ] **Step 1: RED — planQuota 数値ロック**

`shared/contracts/plan-quota.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planQuota, releaseQuota, type PlanCode } from "./plan-quota.js";

describe("planQuota", () => {
  it("locks Free and Plus product limits and defense ceilings", () => {
    expect(planQuota.free).toEqual({
      successPerDay: 3,
      attemptsPerDay: 6,
      shortWindowLimit: 4,
      shortWindowSeconds: 600,
    });
    expect(planQuota.plus).toEqual({
      successPerDay: 10,
      attemptsPerDay: 20,
      shortWindowLimit: 8,
      shortWindowSeconds: 600,
    });
    expect(planQuota.quality).toEqual({ perDay: 3, perMonth: 20 });
    expect(planQuota.flyerWeekly).toEqual({
      successPerJstWeek: 2,
      triesPerJstWeek: 6,
    });
    expect(planQuota.defense).toEqual({
      maxSuccessPerDay: 10,
      maxAttemptsPerDay: 20,
      maxShortWindow: 8,
      maxFlyerSuccessPerWeek: 2,
      maxFlyerTriesPerWeek: 6,
    });
  });

  it("keeps releaseQuota as Free alias for legacy imports", () => {
    expect(releaseQuota).toEqual({
      userDailySuccessLimit: 3,
      userDailyExternalCallLimit: 6,
      userShortWindowExternalCallLimit: 4,
      userShortWindowSeconds: 600,
    });
  });

  it("exposes PlanCode as free|plus only", () => {
    const codes: PlanCode[] = ["free", "plus"];
    expect(codes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: RED run**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/plan-quota.test.ts
```

Expected: FAIL（module not found）

- [ ] **Step 3: GREEN — `plan-quota.ts`**

```ts
/** プラン別製品上限と DB/Zod 防御天井。設計 2026-07-29 L6–L9。 */
export const planQuota = {
  free: {
    successPerDay: 3,
    attemptsPerDay: 6,
    shortWindowLimit: 4,
    shortWindowSeconds: 600,
  },
  plus: {
    successPerDay: 10,
    attemptsPerDay: 20,
    shortWindowLimit: 8,
    shortWindowSeconds: 600,
  },
  quality: {
    perDay: 3,
    perMonth: 20,
  },
  flyerWeekly: {
    successPerJstWeek: 2,
    /** OpenRouter 送信前に数える週次試行（成功 2 と独立） */
    triesPerJstWeek: 6,
  },
  /** DB CHECK / Zod max の防御上限（製品最大） */
  defense: {
    maxSuccessPerDay: 10,
    maxAttemptsPerDay: 20,
    maxShortWindow: 8,
    maxFlyerSuccessPerWeek: 2,
    maxFlyerTriesPerWeek: 6,
  },
} as const;

export type PlanCode = "free" | "plus";

/** 後方互換: Free 固定の別名（既存 import を段階的に planQuota へ寄せる） */
export const releaseQuota = {
  userDailySuccessLimit: planQuota.free.successPerDay,
  userDailyExternalCallLimit: planQuota.free.attemptsPerDay,
  userShortWindowExternalCallLimit: planQuota.free.shortWindowLimit,
  userShortWindowSeconds: planQuota.free.shortWindowSeconds,
} as const;
```

- [ ] **Step 4: RED — plan-tier コピー**

`shared/copy/plan-tier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatPlanQuotaCopy } from "./plan-tier.js";

describe("formatPlanQuotaCopy", () => {
  it("prefixes Free with 無料版は without double prefix", () => {
    expect(formatPlanQuotaCopy("本日の作成上限に達しています。", "free")).toBe(
      "無料版は本日の作成上限に達しています。",
    );
    expect(formatPlanQuotaCopy("無料版は既に付与済み。", "free")).toBe(
      "無料版は既に付与済み。",
    );
  });

  it("keeps Plus body neutral without Free prefix", () => {
    expect(formatPlanQuotaCopy("本日の作成上限に達しています。", "plus")).toBe(
      "本日の作成上限に達しています。",
    );
    expect(formatPlanQuotaCopy("Plusでは1日最大10回まで作成できます。", "plus")).toBe(
      "Plusでは1日最大10回まで作成できます。",
    );
  });

  it("returns empty trim for blank body", () => {
    expect(formatPlanQuotaCopy("  ", "free")).toBe("");
  });
});
```

- [ ] **Step 5: RED run plan-tier**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/copy/plan-tier.test.ts
```

Expected: FAIL（module not found）

- [ ] **Step 6: GREEN — `plan-tier.ts` + generation re-export**

`shared/copy/plan-tier.ts`:

```ts
import { formatFreeTierQuotaCopy } from "./free-tier.js";
import type { PlanCode } from "../contracts/plan-quota.js";

/**
 * 制限説明のプラン接頭。
 * Free: 「無料版は」。Plus: 接頭なし（既に Plusでは/無料版は なら触らない）。
 */
export function formatPlanQuotaCopy(body: string, plan: PlanCode): string {
  const trimmed = body.trim();
  if (!trimmed) return trimmed;
  if (plan === "plus") {
    if (trimmed.startsWith("Plusでは") || trimmed.startsWith("無料版は")) {
      return trimmed;
    }
    return trimmed;
  }
  return formatFreeTierQuotaCopy(trimmed);
}
```

`generation.ts`: 既存 `export const releaseQuota = { ... }` を削除し、

```ts
export { releaseQuota, planQuota } from "./plan-quota.js";
export type { PlanCode } from "./plan-quota.js";
```

（`env.ts` 等が `generation.js` から `releaseQuota` を import している場合はパス互換を維持。）

- [ ] **Step 7: GREEN verify**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/plan-quota.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run shared/copy/plan-tier.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 8: Commit**

```bash
git add shared/contracts/plan-quota.ts shared/contracts/plan-quota.test.ts shared/copy/plan-tier.ts shared/copy/plan-tier.test.ts shared/copy/free-tier.test.ts shared/contracts/generation.ts shared/contracts/generation.test.ts
```

```bash
git commit -m "feat: Plus向けplanQuota定数とプラン別コピーヘルパを追加"
```

---

### Task 2: billing スキーマ + 読取/書込 SECURITY DEFINER RPC（PR2）

**Files:**
- Create: `supabase/migrations/20260729130000_billing_entitlement.sql`
- Create: `supabase/tests/database/billing_entitlement.test.sql`
- Modify: `docs/testing/database-access-matrix.md`
- Run typegen → `src/shared/types/database.generated.ts`（手編集禁止）

**Interfaces:**
- Consumes: `auth.users(id)` CASCADE、identity hex64 パターン
- Produces (SQL):
  - Tables: `private.billing_customers`, `private.billing_subscriptions`, `private.billing_webhook_events`, `private.billing_trial_history`, `private.billing_checkout_locks`（設計 DDL そのまま）
  - **表への GRANT は一切なし**（`service_role` 含む REVOKE ALL）。Functions は **RPC のみ**（現行 identity ledger と同型）
  - Read RPC + **Write RPCs（ADV-1 Must）** — すべて `SECURITY DEFINER`、`search_path = pg_catalog, private, public`、`revoke … from public, anon, authenticated`、`grant execute … to service_role` のみ

#### Write/Read RPC 一式（Task2 で必須。Task4 はこれらを `getSupabaseAdmin().rpc` するだけ）

| RPC | 役割 |
|-----|------|
| `public.get_billing_entitlement_for_user(p_user_id uuid, p_now timestamptz default clock_timestamp()) returns jsonb` | 読取 + A6 判定（runtime 正本。TS `computePlusEntitled` は unit parity 専用）。ワイヤーは entitlement 面のみ。順序判定用 `last_stripe_event_*` は **返さない**（順序は `process_billing_stripe_event` 内で完結） |
| `public.ensure_billing_customer(p_user_id uuid, p_stripe_customer_id text) returns jsonb` | customer upsert（1:1 UNIQUE） |
| `public.process_billing_stripe_event(p_payload jsonb) returns jsonb` | **Webhook 唯一の投影境界（crash-safe 単一 TX）**。下記「単一境界」参照。claim 成功後に投影前 crash しても Stripe 再送で再処理可能（claim-before-success を永久 no-op にしない） |
| `public.upsert_billing_subscription_from_stripe(p_payload jsonb) returns jsonb` | **reconcile / 手動 runbook 専用**。event claim を伴わない。Webhook 本番経路からは **呼ばない**（`process_billing_stripe_event` が内部で同等投影を実行） |
| `public.insert_billing_trial_history(p_identity_key text) returns jsonb` | `on conflict do nothing` |
| `public.has_billing_trial_history(p_identity_key text) returns boolean` | Checkout 前 read |
| `public.acquire_billing_checkout_lock(p_user_id uuid, p_lock_token text, p_expires_at timestamptz) returns jsonb` | **Session ID 不要**で取得。`stripe_checkout_session_id` は NULL。衝突 or 未期限 lock → `{ ok:false, failure_code:'billing_checkout_in_progress' }`。成功 → `{ ok:true, lock_token }`。TTL 既定 **30 min** は Function が `expires_at` に載せる |
| `public.bind_billing_checkout_session(p_user_id uuid, p_lock_token text, p_stripe_checkout_session_id text) returns jsonb` | Session 作成成功後に session id を CAS 記録。token 不一致 / 期限切れ / 他 session 既 bind → `{ ok:false, failure_code:'billing_checkout_bind_failed' }` |
| `public.release_billing_checkout_lock(p_user_id uuid, p_lock_token text default null, p_stripe_checkout_session_id text default null) returns jsonb` | **token または session id** で解放（completed / expired / create 失敗 / bind 失敗補償）。両方 null は no-op or clear-by-user（実装は user_id 行削除を token/session 一致時のみ） |
| `public.get_billing_customer_by_user(p_user_id uuid) returns jsonb` | `{ stripe_customer_id }` or empty（subscription id は返さない — delete-account は Stripe list で解決） |
| `public.get_billing_customer_by_stripe_id(p_stripe_customer_id text) returns jsonb` | unmapped 解決用 |
| `public.mark_billing_subscription_dual_cancel_keep(p_user_id uuid, p_keep_stripe_subscription_id text) returns jsonb` | dual-sub: DB 行を keep 側 id に揃え status 投影（Stripe cancel は Function） |

**禁止（r2 / external Issue 2）:** `insert_billing_webhook_event` を単独 public RPC として「衝突 = 永久 duplicate no-op」にする設計は **採用しない**。event 行の確定と subscription 投影を別 RPC に分割しない。

#### `process_billing_stripe_event` — crash-safe 単一境界（必須）

単一 `SECURITY DEFINER` 関数・**1 トランザクション**で次をこの順に実行する:

```text
1. claim event
   - billing_webhook_events に stripe_event_id UNIQUE で insert を試みる
   - 既に同一 stripe_event_id が存在する → { ok:true, outcome:"duplicate_processed" }
     （成功完了済みのみ。中途 claim の永久 no-op を作らない）
   - 未存在 → insert（processed_at = now() は TX コミット時のみ永続）

2. lock current subscription row
   - user_id 解決済みの p_user_id で private.billing_subscriptions を
     SELECT … FOR UPDATE（行無しなら後続 insert 用に user_id のみ確保）

3. order / ignore-older / same-second terminality（Function が渡す入力のみで完結）
   - 入力: event.created, event.id, 投影 status フィールド一式
   - same-second のときは Function が事前 retrieve した Subscription JSON を
     p_payload.retrieved_subscription に載せてよい（RPC が Stripe を呼ばない）
   - event.created < last_stripe_event_created → outcome:"stale_ignored"（event 行は残し状態不変）
   - event.created > last → apply 投影
   - 同一秒: event.id 一致 → duplicate; 不一致 → retrieved_subscription または終端性優先
     （設計 A2。evt_ 文字列順は使わない）

4. project entitlement
   - status / period / price / past_due_since coalesce / last_stripe_event_* を書く
   - trial 初回 trialing|active は Function が別途 insert_billing_trial_history
     （identity は server email → HMAC。本 RPC は trial を焼かない）

5. mark processed = claim 行が TX に含まれコミットされること
   - 途中例外 → 全体 ROLLBACK（event 行も消える）→ Stripe 再送で再 claim 可
```

**`p_payload` キー（jsonb・固定）:**

```text
stripe_event_id text,
event_type text,
stripe_event_created bigint,          -- event.created Unix 秒
user_id uuid,                          -- Function 解決済み
stripe_subscription_id text,
stripe_price_id text,
status text,
cancel_at_period_end boolean,
current_period_start timestamptz|ISO-Z,
current_period_end timestamptz|ISO-Z,
trial_end timestamptz|ISO-Z|null,
past_due_since timestamptz|ISO-Z|null,
clear_past_due_since boolean,
retrieved_subscription jsonb|null,    -- same-second 用（任意）
skip_subscription_projection boolean  -- customer.* 等、event 記録のみ
```

**戻り JSON 例:**

```json
{
  "ok": true,
  "outcome": "applied" | "duplicate_processed" | "stale_ignored" | "same_second_skip" | "event_only"
}
```

**checkout_locks DDL 差分（設計の `stripe_checkout_session_id not null` を計画で上書き）:**

```sql
create table private.billing_checkout_locks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lock_token text not null unique,                 -- Function 生成 UUID 等
  stripe_checkout_session_id text null,            -- bind 後にのみ非 NULL
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

**`get_billing_entitlement_for_user` 戻り JSON（固定・時刻は ISO UTC `…Z`）:**

```json
{
  "plan": "free" | "plus",
  "status": "none" | "<stripe status>",
  "plus_entitled": boolean,
  "past_due_grace": boolean,
  "current_period_end": "ISO-Z" | null,
  "cancel_at_period_end": boolean,
  "trial_end": "ISO-Z" | null,
  "db_plus_entitled": boolean,
  "past_due_since": "ISO-Z" | null
}
```

SQL で timestamptz は `to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` 等で **ISO-Z 正規化**（ADV-20）。Functions は RPC JSON を map するだけ（runtime で `computePlusEntitled` 再計算しない）。

**A6 判定表（pgTAP 必須ケース）:**

| fixture | `plus_entitled` | `past_due_grace` |
|---------|-----------------|------------------|
| 行なし | false | false |
| trialing | true | false |
| active | true | false |
| past_due + `past_due_since` NULL | **false** | false |
| past_due + since within 72h | true | true |
| past_due + since > 72h | false | false |
| canceled + now < period_end | true | false |
| canceled + now ≥ period_end | false | false |
| unpaid / incomplete / paused | false | false |

- [ ] **Step 1: RED — pgTAP 必須ケース表**

`supabase/tests/database/billing_entitlement.test.sql`:

```sql
begin;
select plan(40);

select has_table('private', 'billing_customers', 'billing_customers exists');
select has_table('private', 'billing_subscriptions', 'billing_subscriptions exists');
select has_table('private', 'billing_webhook_events', 'billing_webhook_events exists');
select has_table('private', 'billing_trial_history', 'billing_trial_history exists');
select has_table('private', 'billing_checkout_locks', 'billing_checkout_locks exists');

-- grants: authenticated cannot execute ANY billing RPC (read + write)
select throws_ok(
  $$ select public.get_billing_entitlement_for_user('00000000-0000-4000-8000-000000000001'::uuid) $$,
  '42501', null,
  'authenticated cannot execute get_billing_entitlement_for_user'
);
select throws_ok(
  $$ select public.ensure_billing_customer('00000000-0000-4000-8000-000000000001'::uuid, 'cus_x') $$,
  '42501', null,
  'authenticated cannot execute ensure_billing_customer'
);
-- 同様: process_billing_stripe_event / upsert_billing_subscription_from_stripe /
-- insert_billing_trial_history / acquire_billing_checkout_lock /
-- bind_billing_checkout_session / release_billing_checkout_lock を throws_ok

-- service_role: A6 ケース表を 1 it 相当ずつ assert（上記 9 fixture）

-- service_role: acquire lock twice (same user) → second fails billing_checkout_in_progress
-- service_role: acquire → bind session → release by session id
-- service_role: acquire → release by lock_token without bind

-- crash-safe process_billing_stripe_event:
--   first call applies active → plus_entitled true + event row exists
--   second call same stripe_event_id → outcome duplicate_processed, state unchanged
--   older event.created after cancel projection → stale_ignored, plus_entitled stays false
--   (simulated claim-then-crash): BEGIN; call process...; ROLLBACK; re-call → still applies
--     ※ 同一 TX 内 insert+project のため ROLLBACK で event 行も消えること

-- service_role: insert_billing_trial_history on conflict do nothing

select finish();
rollback;
```

`plan(N)` は実装後に実アサート数へ合わせる（**コメント逃げ禁止** — A6 9 行 + grants + lock acquire/bind/release + process 冪等/stale/crash-safe は必須）。

- [ ] **Step 2: RED run db-test（マイグレ未適用で fail を確認）**

```bash
docker compose --profile test run --rm db-test
```

Expected: FAIL on missing tables / function。

- [ ] **Step 3: GREEN — migration SQL（tables + ALL RPCs）**

設計 DDL を CREATE（`billing_checkout_locks` は上表の **lock_token + nullable session id** 版）。続けて:

```sql
-- 5 表すべて: REVOKE ALL from public, anon, authenticated, service_role
-- 表 GRANT を service_role に戻さない（ADV-1）

-- get_billing_entitlement_for_user: A6 判定 + ISO-Z timestamps（上記）
-- ensure_billing_customer
-- process_billing_stripe_event  -- 単一 TX claim+lock+order+project（上記）
-- upsert_billing_subscription_from_stripe  -- reconcile only
-- insert_billing_trial_history / has_billing_trial_history
-- acquire_billing_checkout_lock(p_user_id, p_lock_token, p_expires_at)
-- bind_billing_checkout_session(p_user_id, p_lock_token, p_stripe_checkout_session_id)
-- release_billing_checkout_lock(p_user_id, p_lock_token default null, p_stripe_checkout_session_id default null)
-- get_billing_customer_by_user / get_billing_customer_by_stripe_id
-- mark_billing_subscription_dual_cancel_keep

-- 各 public RPC:
--   revoke all from public, anon, authenticated;
--   grant execute to service_role;

-- 禁止: public.insert_billing_webhook_event を単独 claim RPC として export しない
```

`process_billing_stripe_event` / reconcile `upsert_…` の投影キーは上の `p_payload` と整合させる。

- [ ] **Step 4: access matrix 更新**

`docs/testing/database-access-matrix.md`:

- billing 5 表: `service_role: none`（direct）、PostgREST 非公開
- 上記全 RPC（`process_billing_stripe_event` / `bind_billing_checkout_session` 含む）: `service_role: EXECUTE` only

- [ ] **Step 5: migrate + typegen + GREEN pgTAP**

スタック起動済み前提（`meta:8080` 到達）:

```bash
docker compose run --rm migrate
```

```bash
docker compose run --rm app npm run db:types
```

（**`--no-deps` 禁止** — `scripts/generate-database-types.sh` が `http://meta:8080` を使う。M1 修正。）

```bash
docker compose --profile test run --rm db-test
```

Expected: `billing_entitlement.test.sql` 含む suite PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729130000_billing_entitlement.sql supabase/tests/database/billing_entitlement.test.sql docs/testing/database-access-matrix.md src/shared/types/database.generated.ts
```

```bash
git commit -m "feat: Stripe entitlement用private billing表と読取・書込RPCを追加"
```

---

### Task 3: プラン対応 quota RPC + short CHECK≤8 + repository entitlement（PR3）

**Files:**
- Create: `supabase/migrations/20260729140000_plan_aware_quota.sql`
- Create: `supabase/tests/database/plan_aware_quota.test.sql`
- **Modify（ADV-4 署名感度 pgTAP — 全ファイル必須更新）:**
  - `supabase/tests/database/rls_inventory.test.sql`（`reserve_ai_generation` 旧 arg list）
  - `supabase/tests/database/identity_daily_quota.test.sql`（EXECUTE signature 文字列 + call sites）
  - `supabase/tests/database/ai_control_and_quota.test.sql`（`has_function` / overload）
  - `supabase/tests/database/ai_control_and_quota_races.test.sql`（多数の call sites）
  - `supabase/tests/database/user_feedback.test.sql`（`get_ai_usage_today` overload inventory）
  - `supabase/tests/database/paid_quota_upgrade_path.test.sql`（該当すれば limit/CHECK）
  - `supabase/tests/database/maintenance_cleanup.test.sql`（release 経路が触れる場合）
  - `supabase/tests/database/account_deletion.test.sql`（release 公開 RPC が触れる場合）
- Modify: `netlify/functions/_shared/env.ts`（`globalDailyLimit(200)`、Free env は Free 値一致のみ検証）
- Modify: `netlify/functions/_shared/env.test.ts`（**ADV-14**: max 拒否を `0`/`201` に。`21` は有効）
- Modify: `netlify/functions/_shared/generation-repository.ts`（reserve + **`status()`** plan limits、`user_daily_limit` Zod 3|10）
- Create: `netlify/functions/_shared/billing-entitlement.ts`
- **Create: `netlify/functions/_shared/billing-entitlement.test.ts`**（M5: Task3 が初回作成。A6 ケース表 unit）
- Modify: `netlify/functions/usage-today.ts` + **`netlify/functions/_tests/usage-today.test.ts`**
- Modify: `shared/contracts/generation.ts`（`usageTodayDataSchema` **and** `generationQuotaSchema`）
- Modify: `shared/contracts/generation.test.ts`
- Modify: `netlify/functions/_shared/generation-repository.test.ts`
- Modify: `scripts/preflight-production.mjs`（GLOBAL 1..200）
- Modify: `compose.yaml` — ローカル `GLOBAL_DAILY_AI_LIMIT` 既定 **20 維持**（max のみ 200）
- Modify: `shared/testing/factories.ts` + 全 `UsageTodayData` fixture 消費側

**Interfaces:**
- Consumes: Task1 `planQuota`, Task2 `get_billing_entitlement_for_user`
- Produces:
  - SQL `reserve_ai_generation` 受理: `p_user_limit in (3,10)`, `p_attempt_limit in (6,20)`, `p_short_window_limit in (4,8)`, `p_global_limit between 1 and 200`
  - Request 列: `quota_success_limit`, `quota_attempt_limit`, `quota_short_limit`（quality_mode 列は Task6）
  - `mark_ai_global_sent`: `sent_count >= coalesce(request.quota_short_limit, 4)`（A1）
  - `loadEntitlement` / `applyQuotaPlan` TS
  - `usageTodayDataSchema` に `plan` / `plusEntitled`、可変 limit union 3|10 / 6|20 / 4|8
  - **schema 段階導入（型一貫）:**
    - **Task3:** `plan`, `plusEntitled`, success/attempts/short の可変 limit。`quality` / `flyerWeekly` は **まだ載せない**（Task6/7 が required で追加）。
    - **Task6:** `quality` required（台帳投影）。
    - **Task7:** `flyerWeekly` required（台帳投影）。
  - 既存 UI/fixture は Task3 で Free 3/6/4 + `plan:"free"` を満たすよう一括更新。

**`usageTodayDataSchema`（Task3 時点の必須 shape）:**

```ts
z.object({
  plan: z.enum(["free", "plus"]),
  plusEntitled: z.boolean(),
  success: z.object({
    consumed: z.number().int().min(0).max(10),
    limit: z.union([z.literal(3), z.literal(10)]),
    remaining: z.number().int().min(0).max(10),
  }).strict(),
  attempts: z.object({
    sent: z.number().int().min(0).max(20),
    limit: z.union([z.literal(6), z.literal(20)]),
    remaining: z.number().int().min(0).max(20),
  }).strict(),
  shortWindow: z.object({
    sent: z.number().int().min(0).max(8),
    limit: z.union([z.literal(4), z.literal(8)]),
    remaining: z.number().int().min(0).max(8),
    retryAt: z.string().nullable(), // ISO or null（既存 iso helper を再利用）
  }).strict(),
  globalAvailable: z.boolean(),
  retryAt: z.string().nullable(),
}).strict();
// balance superRefine: consumed+remaining===limit 等は現行方針を維持
```

- [ ] **Step 1: RED — contracts usageToday + generationQuotaSchema（C1）**

`generation.test.ts`:

```ts
it("accepts Plus limits on usageTodayDataSchema", () => {
  const plus = {
    plan: "plus" as const,
    plusEntitled: true,
    success: { consumed: 0, limit: 10 as const, remaining: 10 },
    attempts: { sent: 0, limit: 20 as const, remaining: 20 },
    shortWindow: { sent: 0, limit: 8 as const, remaining: 8, retryAt: null },
    globalAvailable: true,
    retryAt: null,
  };
  expect(usageTodayDataSchema.parse(plus)).toEqual(plus);
});

it("accepts Free limits with plan free", () => {
  const free = {
    plan: "free" as const,
    plusEntitled: false,
    success: { consumed: 0, limit: 3 as const, remaining: 3 },
    attempts: { sent: 0, limit: 6 as const, remaining: 6 },
    shortWindow: { sent: 0, limit: 4 as const, remaining: 4, retryAt: null },
    globalAvailable: true,
    retryAt: null,
  };
  expect(usageTodayDataSchema.parse(free)).toEqual(free);
});

it("rejects success limit outside 3|10", () => {
  expect(
    usageTodayDataSchema.safeParse({
      plan: "free",
      plusEntitled: false,
      success: { consumed: 0, limit: 5, remaining: 5 },
      attempts: { sent: 0, limit: 6, remaining: 6 },
      shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
      globalAvailable: true,
      retryAt: null,
    }).success,
  ).toBe(false);
});

it("accepts Plus generationQuotaSchema with userDailyLimit 10 and remaining up to 10", () => {
  expect(
    generationQuotaSchema.parse({
      remaining: 7,
      userDailyLimit: 10,
      // …既存必須フィールドを現行 schema に合わせて埋める
    }),
  ).toMatchObject({ remaining: 7, userDailyLimit: 10 });
});

it("rejects generationQuota remaining above 10", () => {
  expect(
    generationQuotaSchema.safeParse({
      remaining: 11,
      userDailyLimit: 10,
    }).success,
  ).toBe(false);
});
```

**`generationQuotaSchema` GREEN 変更（現行 L775–783 を置換）:**

```ts
export const generationQuotaSchema = z
  .object({
    remaining: z.number().int().min(0).max(planQuota.defense.maxSuccessPerDay), // 10
    userDailyLimit: z.union([z.literal(3), z.literal(10)]),
    // …既存フィールドは維持
  })
  .strict();
```

**repository RPC parse（現行 L104）:**

```ts
user_daily_limit: z.union([z.literal(3), z.literal(10)]).optional(),
```

- [ ] **Step 2: RED contracts**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

Expected: FAIL（schema が literal 3 のみ）

- [ ] **Step 3: RED — billing-entitlement.test.ts（M5 初回作成）+ repository A9**

Create `netlify/functions/_shared/billing-entitlement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyQuotaPlan,
  computePlusEntitled,
  PAST_DUE_GRACE_HOURS,
} from "./billing-entitlement.js";

describe("computePlusEntitled", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  it("returns false when past_due and past_due_since is null (A6)", () => {
    expect(
      computePlusEntitled(
        {
          status: "past_due",
          past_due_since: null,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: false, pastDueGrace: false });
  });
  it("returns grace true within PAST_DUE_GRACE_HOURS", () => {
    expect(PAST_DUE_GRACE_HOURS).toBe(72);
    // past_due_since = now - 1h → plusEntitled true, pastDueGrace true
  });
  // trialing/active/canceled-in-period/expired を同ファイルで網羅
});

describe("applyQuotaPlan", () => {
  it("forces free when billingEnabled is false even if dbPlusEntitled", () => {
    expect(
      applyQuotaPlan(
        {
          plan: "plus",
          status: "active",
          plusEntitled: true,
          pastDueGrace: false,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          trialEnd: null,
          dbPlusEntitled: true,
        },
        false,
      ),
    ).toBe("free");
  });
});
```

`generation-repository.test.ts`:

```ts
it("returns billing_entitlement_unavailable and does not reserve when loadEntitlement throws", async () => {
  // loadEntitlement mock throws BillingEntitlementUnavailableError
  // reserveNew が supabase.rpc("reserve_ai_generation") を呼ばない
});

it("status() passes plan success limit not env Free-only when plus entitled", async () => {
  // mock entitlement plus → p_user_limit 10 / p_attempt_limit 20 / p_short_window_limit 8
});

it("parses reserve response with user_daily_limit 10", async () => {
  // response JSON user_daily_limit: 10 が Zod 成功
});
```

`netlify/functions/_tests/usage-today.test.ts`（ADV-6）:

```ts
it("merges plan and plusEntitled from entitlement onto RPC usage payload before parse", async () => {
  // RPC returns success/attempts/short/global only (no plan fields)
  // loadEntitlement → free; response must include plan:"free", plusEntitled:false
  // usageTodayDataSchema.parse 成功
});

it("AI_QUOTA_DISABLED rebuild still includes plan and plusEntitled", async () => {
  // rebuild path must not drop new required fields
});
```

- [ ] **Step 4: RED — pgTAP plan_aware_quota + signature inventory**

`plan_aware_quota.test.sql` 必須:

1. identity CHECK が 10/20 を許容（insert reserved+success=10）
2. `ai_user_rate_windows` に sent_count=8 が入り、9 で失敗
3. `reserve_ai_generation` が `p_user_limit=10, p_attempt_limit=20, p_short_window_limit=8` を受理
4. `p_user_limit=5` 等は `release_quota_mismatch` 相当で拒否
5. reserve 後 `ai_user_rate_windows` 行が **増えない**（A1）
6. mark で short limit 8 スナップショットが効く
7. `p_global_limit=200` 受理、`201` 拒否

**ADV-4 signature matrix step（db-test 前必須）:** 上記 Files の各 pgTAP で旧シグネチャ文字列・`has_function`・call sites を新引数付きに更新。未更新のまま full db-test を PASS としない。

- [ ] **Step 5: GREEN — migration `20260729140000_plan_aware_quota.sql`**

要点（現行 `20260728150000` の `create or replace` を **全文置換**。部分パッチ禁止）:

```sql
-- ADV-11: identity CHECK は hard-coded 名に依存しない（Plan 8 / rate_windows と同型 discovery）
do $$
declare r record;
begin
  for r in
    select c.conname, t.relname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private'
      and t.relname in ('ai_identity_daily_usage', 'ai_identity_daily_external_attempts')
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%reserved_count%success_count%'
        or pg_get_constraintdef(c.oid) ilike '%reserved_count%sent_count%'
      )
  loop
    execute format(
      'alter table private.%I drop constraint %I',
      r.relname, r.conname
    );
  end loop;
end $$;

alter table private.ai_identity_daily_usage
  add constraint ai_identity_daily_usage_quota_check
    check (reserved_count + success_count <= 10);

alter table private.ai_identity_daily_external_attempts
  add constraint ai_identity_daily_external_attempts_quota_check
    check (reserved_count + sent_count <= 20);

-- rate windows sent_count: discovery drop then <= 8
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private' and t.relname = 'ai_user_rate_windows'
      and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%sent_count%'
  loop
    execute format('alter table private.ai_user_rate_windows drop constraint %I', r.conname);
  end loop;
end $$;

alter table private.ai_user_rate_windows
  add constraint ai_user_rate_windows_sent_count_check
    check (sent_count >= 0 and sent_count <= 8);

alter table private.ai_generation_requests
  add column if not exists quota_success_limit integer not null default 3
    check (quota_success_limit in (3, 10)),
  add column if not exists quota_attempt_limit integer not null default 6
    check (quota_attempt_limit in (6, 20)),
  add column if not exists quota_short_limit integer not null default 4
    check (quota_short_limit in (4, 8));

-- reserve_ai_generation: p_attempt_limit, p_short_window_limit
-- p_user_limit in (3,10); attempt gate >= p_attempt_limit; snapshot columns
-- mark_ai_global_sent: request.quota_short_limit (not hardcode 4)
-- get_ai_usage_today: p_user_limit, p_attempt_limit, p_short_window_limit, p_global_limit 1..200
--   NOTE: RPC は plan/plusEntitled を返さない（Function が merge）
-- get_ai_generation_status: 同 limit 引数 + remaining 投影
-- reserve_ai_repair_call: p_global_limit 1..200; short/quality は request snapshot のみ
```

- [ ] **Step 6: GREEN — `billing-entitlement.ts`（Functions 側）**

```ts
import { planQuota, type PlanCode } from "../../../shared/contracts/plan-quota.js";

export type BillingSubscriptionStatus =
  | "trialing" | "active" | "past_due" | "canceled" | "unpaid"
  | "incomplete" | "incomplete_expired" | "paused";

export type Entitlement = {
  plan: PlanCode;
  status: "none" | BillingSubscriptionStatus;
  plusEntitled: boolean;
  pastDueGrace: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  dbPlusEntitled: boolean;
};

export const PAST_DUE_GRACE_HOURS = 72;

export class BillingEntitlementUnavailableError extends Error {
  readonly code = "billing_entitlement_unavailable" as const;
  constructor(cause?: unknown) {
    super("billing_entitlement_unavailable");
    this.cause = cause;
  }
}

export function computePlusEntitled(
  row: {
    status: BillingSubscriptionStatus;
    past_due_since: string | null;
    current_period_end: string;
  } | null,
  now: Date,
): { plusEntitled: boolean; pastDueGrace: boolean } {
  if (!row) return { plusEntitled: false, pastDueGrace: false };
  if (row.status === "trialing" || row.status === "active") {
    return { plusEntitled: true, pastDueGrace: false };
  }
  if (row.status === "past_due") {
    if (row.past_due_since == null) {
      return { plusEntitled: false, pastDueGrace: false }; // A6
    }
    const since = new Date(row.past_due_since).getTime();
    const graceMs = PAST_DUE_GRACE_HOURS * 3600_000;
    if (now.getTime() <= since + graceMs) {
      return { plusEntitled: true, pastDueGrace: true };
    }
    return { plusEntitled: false, pastDueGrace: false };
  }
  if (row.status === "canceled" && now.getTime() < new Date(row.current_period_end).getTime()) {
    return { plusEntitled: true, pastDueGrace: false };
  }
  return { plusEntitled: false, pastDueGrace: false };
}

/** BILLING_ENABLED=false → 常に free limits（A3 枠面） */
export function applyQuotaPlan(
  entitlement: Entitlement,
  billingEnabled: boolean,
): PlanCode {
  if (!billingEnabled) return "free";
  return entitlement.plusEntitled ? "plus" : "free";
}

export function limitsForPlan(plan: PlanCode) {
  return planQuota[plan];
}

// loadEntitlement(userId): RPC get_billing_entitlement_for_user
// 失敗・不正 JSON → throw BillingEntitlementUnavailableError（A9）
// 成功時 limits 選択は applyQuotaPlan のみ。defense.max* を default にしない
```

- [ ] **Step 7: GREEN — reserve / status / usage-today merge（ADV-6 / ADV-8）**

**Runtime 規則:** `loadEntitlement` は `get_billing_entitlement_for_user` RPC JSON を map するだけ。TS `computePlusEntitled` は **unit parity 専用**（request path で再計算しない）。

`generation-repository.ts` `buildReserveArgs` + `status()`:

```ts
const entitlement = await loadEntitlement(user.userId); // throws BillingEntitlementUnavailableError → 503
const quotaPlan = applyQuotaPlan(entitlement, env.billingEnabled);
const limits = limitsForPlan(quotaPlan);
// reserve + status の両方:
//   p_user_limit: limits.successPerDay          // 3|10 — env Free 固定を使わない
//   p_attempt_limit: limits.attemptsPerDay      // 6|20
//   p_short_window_limit: limits.shortWindowLimit // 4|8
//   p_global_limit: env.openRouter.globalDailyLimit // 1..200
// 絶対に planQuota.defense.max* を default にしない
// repair: p_global_limit のみ env 拡張; short/quality は request スナップショットのみ
```

**`usage-today.ts` アルゴリズム（Must・ADV-6）:**

```text
1. requireUserWithEmail
2. entitlement = loadEntitlement(userId)  // fail → 503 billing_entitlement_unavailable
3. quotaPlan = applyQuotaPlan(entitlement, env.billingEnabled)
4. limits = limitsForPlan(quotaPlan)
5. rpc get_ai_usage_today(p_user_limit, p_attempt_limit, p_short_window_limit, p_global_limit, …)
6. map RPC snake/camel → intermediate object（plan フィールドは RPC に無い）
7. attach:
     plan: quotaPlan
     plusEntitled: entitlement.plusEntitled && env.billingEnabled
     // kill 時 plusEntitled 表示は DB 投影を UI が entitlement API で見る。
     // usage/today の plusEntitled は「枠が Plus か」= (quotaPlan==="plus")
     plusEntitled: quotaPlan === "plus"
8. AI_QUOTA_DISABLED ローカル rebuild 時も step 7 の plan/plusEntitled を必ず載せる
9. usageTodayDataSchema.parse(merged) → 200
```

- [ ] **Step 8: GREEN — env GLOBAL 200 + Free env 検証（ADV-14）**

```ts
// env.ts
GLOBAL_DAILY_AI_LIMIT: globalDailyLimit(200), // was max 20
// USER_DAILY_* が残る場合: Free 値との一致のみ。不一致 throw。Plus を env で上書き不可。
// billingEnabled: 未設定 false（Task4 で Stripe 鍵と結合）
```

`env.test.ts`:

```ts
it.each(["0", "201"])("rejects out-of-range global quota %s", (value) => {
  expect(() => parseServerEnv({ ...validServerEnv, GLOBAL_DAILY_AI_LIMIT: value })).toThrow();
});

it("accepts GLOBAL_DAILY_AI_LIMIT 21 within max 200", () => {
  expect(
    parseServerEnv({ ...validServerEnv, GLOBAL_DAILY_AI_LIMIT: "21" }).openRouter
      .globalDailyLimit,
  ).toBe(21);
});
```

grep ゲート（ホスト 1 コマンド）:

```bash
grep -rn "between 1 and 20\|globalDailyLimit(20)\|rejects out-of-range global quota.*21" netlify supabase scripts --include='*.ts' --include='*.sql' --include='*.mjs'
```

Expected: 製品 max が 200 に揃っていること（compose ローカル default `"20"` は残してよい）。

- [ ] **Step 9: GREEN unit + migrate + pgTAP**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-repository.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/billing-entitlement.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/env.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_tests/usage-today.test.ts
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm migrate
```

```bash
docker compose run --rm app npm run db:types
```

```bash
docker compose --profile test run --rm db-test
```

- [ ] **Step 10: Commit**

```bash
git add shared/contracts/generation.ts shared/contracts/generation.test.ts netlify/functions/_shared/billing-entitlement.ts netlify/functions/_shared/billing-entitlement.test.ts netlify/functions/_shared/generation-repository.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/env.ts netlify/functions/_shared/env.test.ts netlify/functions/usage-today.ts netlify/functions/_tests/usage-today.test.ts supabase/migrations/20260729140000_plan_aware_quota.sql supabase/tests/database/plan_aware_quota.test.sql supabase/tests/database/rls_inventory.test.sql supabase/tests/database/identity_daily_quota.test.sql supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/ai_control_and_quota_races.test.sql supabase/tests/database/user_feedback.test.sql shared/testing/factories.ts scripts/preflight-production.mjs src/shared/types/database.generated.ts
```

（触った他 pgTAP / fixture も add）

```bash
git commit -m "feat: 日次・短時間枠をプラン可変にしCHECKを10/20/8へ拡張"
```

---

### Task 4: Stripe Functions（Checkout / Portal / Webhook / Entitlement）+ stripe dep + mock（PR4）

**Files:**
- Modify: `package.json` / `package-lock.json` via Docker `npm install`
- Create: `shared/contracts/billing.ts` + test
- Modify: `netlify/functions/_shared/env.ts`（Stripe 鍵・kill 分割）
- Modify: `netlify/functions/_shared/env.test.ts`
- Create: `netlify/functions/_shared/billing-stripe.ts`
- Create: `netlify/functions/_shared/billing-webhook.ts` + **`billing-webhook.test.ts`**
- Modify: `netlify/functions/_shared/billing-entitlement.ts`（productSurfacesOpen / quotaPlan; test は Task3 作成済み）
- Create: `netlify/functions/billing-checkout.ts` + test
- Create: `netlify/functions/billing-portal.ts`
- Create: `netlify/functions/billing-webhook.ts`
- Create: `netlify/functions/billing-entitlement.ts`
- Modify: `netlify/functions/_shared/logger.ts` + test（**M4 SafeLog allowlist**）
- Create: `tools/stripe-mock/`（固定 `whsec_test_…` + session URL + webhook fixture injector モジュール）
- **Modify: `tools/e2e-function-server.mjs`** + **`tools/e2e-function-server.test.mjs`**（C2: billing 4 modules を `functionModulePaths` に追加）
- Create: `docs/runbooks/billing-reconcile.md`（Portal Dashboard チェックリスト含む）
- Modify: `docs/deployment/netlify.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Task2 **write/read RPCs only**（表 direct DML 禁止）、Task1 planQuota、`computeQuotaIdentityKey`
- Produces:
  - `stripe@22.3.2`（**exact pin**）
  - **`STRIPE_API_VERSION` 固定文字列: `"2026-06-24.dahlia"`**（ADV-13 再ピン。env / `.env.example` / Stripe client factory / env tests で同一。変更は設計改訂）
  - Routes（`Config.path`）:
    - `POST /api/billing/checkout` body `{ interval: "month" | "year" }`（**`priceInterval` ではない** — 設計 mermaid は diagram-only 誤り。plan/routes が正）
    - `POST /api/billing/portal`
    - `POST /api/billing/webhook`（JWT 不要）
    - `GET /api/billing/entitlement` → `{ plan, status, plusEntitled, pastDueGrace, currentPeriodEnd, cancelAtPeriodEnd, trialEnd, dbPlusEntitled, productSurfacesOpen, quotaPlan }`
  - Failure codes: `billing_disabled`, `billing_checkout_in_progress`, `billing_already_entitled`, `billing_entitlement_unavailable`, 署名不正 400
  - SafeLog codes: `billing_checkout_created`, `billing_portal_created`, `billing_webhook_ok`, `billing_webhook_stale`, `billing_webhook_same_second_skip`, `billing_user_unmapped`, `billing_dual_subscription_canceled`, `billing_checkout_in_progress`, `billing_checkout_bind_failed`, `billing_checkout_session_expired_compensation`（log）
  - Webhook DB 書込は **`process_billing_stripe_event` のみ**（split claim/upsert 禁止）
  - Checkout 順序: acquire(`lock_token`) → `sessions.create` → bind → 失敗時 release + Session expire 補償

**Stripe package pin 根拠:**

| 項目 | 値 |
|------|-----|
| Package | `stripe@22.3.2` exact |
| API version | **`2026-06-24.dahlia`**（本 Plan で固定。Dashboard と不一致なら deploy 前に設計改訂して全箇所置換） |
| 理由 | 公式 Node SDK。semver range 禁止。API version を Dashboard 任せにしない |
| インストール | Docker のみ（下記 Step） |

- [ ] **Step 1: Install stripe exact**

```bash
docker compose run --rm --no-deps app npm install stripe@22.3.2 --save-exact
```

Expected: `package.json` dependencies に `"stripe": "22.3.2"`、lock 更新。

- [ ] **Step 2: RED — env billing parse**

`netlify/functions/_shared/env.test.ts`（既存があれば追記）:

```ts
it("rejects VITE_STRIPE_SECRET_KEY in server env source", () => {
  expect(() =>
    parseServerEnv({
      ...validBase,
      VITE_STRIPE_SECRET_KEY: "sk_test_x",
    }),
  ).toThrow(/server_configuration_invalid/);
});

it("defaults BILLING_ENABLED to false and keeps webhook keys optional when false", () => {
  const env = parseServerEnv({ ...validBase /* no BILLING */ });
  expect(env.billingEnabled).toBe(false);
});

it("requires Stripe secrets when BILLING_ENABLED=true", () => {
  expect(() =>
    parseServerEnv({ ...validBase, BILLING_ENABLED: "true" }),
  ).toThrow();
});

it("allows BILLING_ENABLED=false with webhook secrets present (A3)", () => {
  const env = parseServerEnv({
    ...validBase,
    BILLING_ENABLED: "false",
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_WEBHOOK_SECRET: "whsec_xxx",
    STRIPE_PRICE_PLUS_MONTHLY: "price_m",
    STRIPE_PRICE_PLUS_YEARLY: "price_y",
    STRIPE_API_VERSION: "2026-06-24.dahlia",
  });
  expect(env.billingEnabled).toBe(false);
  expect(env.stripe?.webhookSecret).toBeTruthy();
  expect(env.stripe?.apiVersion).toBe("2026-06-24.dahlia");
});

it("rejects STRIPE_API_VERSION other than the locked pin when stripe keys present", () => {
  expect(() =>
    parseServerEnv({
      ...validBase,
      BILLING_ENABLED: "false",
      STRIPE_SECRET_KEY: "sk_test_xxx",
      STRIPE_WEBHOOK_SECRET: "whsec_xxx",
      STRIPE_PRICE_PLUS_MONTHLY: "price_m",
      STRIPE_PRICE_PLUS_YEARLY: "price_y",
      STRIPE_API_VERSION: "2024-01-01.acacia",
    }),
  ).toThrow(/server_configuration_invalid/);
});
```

- [ ] **Step 3: RED run env**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/env.test.ts
```

- [ ] **Step 4: RED — webhook crash-safe process + ordered projection abuse suite（A2 / ADV-10 / external Issue 2）**

`billing-webhook.test.ts` **必須 named cases**:

```ts
it("calls process_billing_stripe_event once per delivery (not split claim+upsert)", async () => {
  // mock admin.rpc: only process_billing_stripe_event for subscription projection path
  // insert_billing_webhook_event must NOT be called
});

it("after claim-then-crash before project, Stripe retry eventually projects (crash-safe)", async () => {
  // 1st process_billing_stripe_event throws / TX aborted (no durable event row)
  // 2nd delivery same event → process succeeds → plusEntitled / status projected
  // permanent no-op after partial claim is forbidden
});

it("ignores subscription events older than last_stripe_event_created", async () => {
  // last_stripe_event_created=2000, event.created=1000 → 200, SafeLog billing_webhook_stale
  // process RPC outcome stale_ignored; state unchanged
});

it("does not use evt_ id lexicographic order as time tie-break", async () => {
  // same second, different ids → retrieve Subscription into retrieved_subscription payload
  // or terminal precedence inside process RPC; never event.id < last_id as time
});

it("does not re-entitle from delayed active after canceled past period_end", async () => {
  // terminal row + older/out-of-order active → ignore-older or terminal precedence; plusEntitled stays false
});

it("does not re-entitle from delayed active after past_due grace expired", async () => {});

it("does not re-entitle from delayed updated after subscription.deleted projection", async () => {});

it("sets past_due_since on first transition to past_due and clears on active", async () => {});

it("inserts billing_trial_history on first trialing|active using server identity_key (A7)", async () => {
  // see identity algorithm below; client must not supply identity_key
  // trial insert is AFTER successful process outcome applied (or same Function request; not inside claim-only)
});

it("rejects invalid signature with 400 before body parse", async () => {});

it("idempotent replay of same stripe_event_id returns 200 no-op", async () => {
  // process outcome duplicate_processed → 200; no second projection mutation
});

it("returns 200 billing_user_unmapped when user cannot be resolved and does not 500", async () => {
  // SafeLog code billing_user_unmapped; alert metric counter incremented (or log field for aggregator)
  // process_billing_stripe_event NOT called without user_id
});

it("cancels newer dual live subscription and keeps older entitled row", async () => {
  // Stripe subscriptions.cancel(newer); mark_billing_subscription_dual_cancel_keep; log billing_dual_subscription_canceled
});

it("processes webhook when BILLING_ENABLED=false if secrets present (A3)", async () => {
  // checkout would 503; webhook still calls process_billing_stripe_event
});
```

**trial_history identity_key 導出（ADV-9 Must アルゴリズム）:**

```text
on first trialing|active webhook after user resolved:
  1. userId = subscription.metadata.supabase_user_id
     || billing_customers lookup by stripe_customer_id (RPC get_billing_customer_by_stripe_id)
  2. if no userId → 200 + billing_user_unmapped (no trial insert, no process with null user)
  3. rpc process_billing_stripe_event({ user_id, event fields, projection… })
  4. if outcome applied (or already projected equivalent): 
     email = auth.admin.getUserById(userId).email  // server only; never log email
  5. if no email → 200 + log billing_trial_identity_unavailable; skip trial insert (fail-closed for trial burn)
  6. identity_key = computeQuotaIdentityKey(email, env.quotaIdentityHmacKey)
  7. rpc insert_billing_trial_history(identity_key)  // on conflict do nothing

Checkout pre-read (trial_period_days):
  1. requireUserWithEmail → email already on AuthenticatedUserWithEmail
  2. identity_key = computeQuotaIdentityKey(email, key)
  3. rpc has_billing_trial_history(identity_key) → if true, omit trial_period_days
```

**Checkout lock 状態遷移（external Issue 3・設計 448–452 整合）:**

```text
1. lock_token = randomUUID()
2. expires_at = now + 30 minutes
3. rpc acquire_billing_checkout_lock(user_id, lock_token, expires_at)
   - fail → 409 billing_checkout_in_progress
4. stripe.checkout.sessions.create(...)
   - on throw/fail → rpc release_billing_checkout_lock(user_id, lock_token) → return error
5. rpc bind_billing_checkout_session(user_id, lock_token, session.id)
   - on bind fail → stripe.checkout.sessions.expire(session.id) best-effort
                 → release by lock_token
                 → log billing_checkout_bind_failed / billing_checkout_session_expired_compensation
                 → 5xx or 409（実装は fail-closed）
6. return { url: session.url }
7. webhook checkout.session.completed | expired → release_billing_checkout_lock(..., session_id)
   （subscription 投影は process_billing_stripe_event 側）
```

- [ ] **Step 5: RED — checkout acquire→create→bind→release（A5）+ e2e allowlist**

```ts
it("returns 409 billing_checkout_in_progress when lock row exists and not expired", async () => {});
it("returns 409 billing_already_entitled when dbPlusEntitled", async () => {});

it("acquire → sessions.create → bind → returns url (happy path)", async () => {
  // acquire called with lock_token and WITHOUT real session id
  // sessions.create then bind_billing_checkout_session(token, session.id)
});

it("releases lock by token when sessions.create fails", async () => {
  // create throws → release_billing_checkout_lock(user, lock_token); no bind
});

it("expires Session and releases lock when bind fails after create", async () => {
  // create ok, bind fails → sessions.expire(session.id) + release by token
});

it("releases lock by session id on checkout.session.completed webhook", async () => {
  // release_billing_checkout_lock(user, null, session.id) or by session id overload
});
```

`tools/e2e-function-server.test.mjs`（または既存 test に）:

```js
it("registers billing function modules for e2e proxy", () => {
  // functionModulePaths includes:
  // /netlify/functions/billing-checkout.ts
  // /netlify/functions/billing-portal.ts
  // /netlify/functions/billing-webhook.ts
  // /netlify/functions/billing-entitlement.ts
});
```

- [ ] **Step 6: GREEN — env + contracts + logger + shared modules**

`shared/contracts/billing.ts` 抜粋:

```ts
import { z } from "zod";

export const checkoutRequestSchema = z
  .object({ interval: z.enum(["month", "year"]) })
  .strict();

export const entitlementDataSchema = z
  .object({
    plan: z.enum(["free", "plus"]),
    status: z.enum([
      "none",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
    ]),
    plusEntitled: z.boolean(),
    pastDueGrace: z.boolean(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    trialEnd: z.string().nullable(),
    dbPlusEntitled: z.boolean(),
    productSurfacesOpen: z.boolean(),
    quotaPlan: z.enum(["free", "plus"]),
  })
  .strict();
```

**SafeLog（M4）— `logger.ts`:**

```ts
// SafeLogEvent に optional 追加（PII 禁止）:
// plan?: "free"|"plus"
// billing_status?: string
// price_interval?: "month"|"year"
// quality_mode?: boolean
// flyer?: boolean
// stripe_customer_id / stripe_subscription_id: opaque id のみ可
// 禁止: email, name, receipt email, multipart filename, image hash, prompts, raw AI
```

Webhook 順序保護は **`process_billing_stripe_event` 内**で完結（設計擬似コードを RPC コメントに貼付）。Function は署名検証・user 解決・same-second retrieve・dual-sub cancel・trial_history を担当し、subscription 投影の DB 書込は **当該 RPC 1 回のみ**。reconcile runbook のみ `upsert_billing_subscription_from_stripe` を使用可。

Checkout Session 作成パラメータ（ロック）:

```ts
{
  mode: "subscription",
  customer: stripeCustomerId,
  client_reference_id: userId,
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `${origin}/settings?billing=success`,
  cancel_url: `${origin}/settings?billing=cancel`,
  subscription_data: {
    trial_period_days: hasUsedTrial ? undefined : 7,
    metadata: { supabase_user_id: userId, plan_code: "plus" },
  },
  metadata: { supabase_user_id: userId, plan_code: "plus" },
  payment_method_collection: "always",
  allow_promotion_codes: false,
  locale: "ja",
}
// Stripe client: new Stripe(secret, { apiVersion: "2026-06-24.dahlia" })
```

Kill 分割表（A3）:

| 面 | BILLING_ENABLED=false |
|----|------------------------|
| Checkout/Portal | 503 `billing_disabled` |
| Webhook | 鍵あり → 通常処理（write RPC） |
| GET entitlement | 200 + `productSurfacesOpen:false` + `quotaPlan:"free"` + DB 投影 |

- [ ] **Step 7: GREEN — four Functions + e2e allowlist + mock**

```ts
import type { Config } from "@netlify/functions";
export const config: Config = { path: "/api/billing/checkout", method: "POST" };
// portal POST /api/billing/portal
// webhook POST /api/billing/webhook（no JWT）
// entitlement GET /api/billing/entitlement
```

`tools/e2e-function-server.mjs` の `functionModulePaths` に追加:

```js
  "/netlify/functions/billing-checkout.ts",
  "/netlify/functions/billing-portal.ts",
  "/netlify/functions/billing-webhook.ts",
  "/netlify/functions/billing-entitlement.ts",
```

`tools/stripe-mock/`: 固定 webhook secret、Checkout Session URL 返却、E2E 用 `injectStripeWebhookEvent({ type, payload })` export。

`docs/runbooks/billing-reconcile.md`: Stripe list → upsert RPC → 差分 → その後 `BILLING_ENABLED=true`。

**Portal Dashboard チェックリスト（P0・runbook 内 checkbox）:**

- [ ] 既定言語 ja
- [ ] 解約は期間末（`cancel_at_period_end`）
- [ ] retention offer / 解約アンケートのダークパターン off
- [ ] 月↔年切替 off（Q2）

`.env.example`:

```bash
BILLING_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PLUS_MONTHLY=
STRIPE_PRICE_PLUS_YEARLY=
STRIPE_API_VERSION=2026-06-24.dahlia
# STRIPE_MOCK_BASE_URL=  # local exact mock only
```

- [ ] **Step 8: GREEN tests**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/env.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/billing-webhook.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/billing-entitlement.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/billing.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run tools/e2e-function-server.test.mjs
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 9: Commit**

```bash
git commit -m "feat: Stripe Checkout・Portal・Webhookとentitlement APIを追加"
```

---

### Task 5: UI ファネル + 設定のプラン管理（PR5）

**Files:**
- Create: `src/features/billing/billing-api.ts`
- Create: `src/features/billing/use-entitlement.ts`
- Create: `src/features/billing/plan-settings-section.tsx` + test
- Create: `src/features/billing/plus-cta.tsx` + test
- Create: `src/features/billing/flyer-upsell-banner.tsx` + test（**L10-6**）
- Modify: `src/features/household/household-settings-page.tsx`
- Modify: `src/features/planner/components/review-step.tsx` + `planner-wizard.test.tsx`
- Modify: `src/features/generation/components/generation-status-panel.tsx` + test
- Modify: `src/features/history/components/regeneration-sheet.tsx` + test
- Modify: `src/features/generation/pages/menu-result-page.tsx`（または成功結果を出す面）+ test — L10-6 マウント
- Modify: routes に `?billing=success|cancel` 処理（settings）
- 新規 failure code の `issueMessages` は Task6/7 で追加（本 Task は UI コピー固定のみ）

**Interfaces:**
- Consumes: Task1 `formatPlanQuotaCopy`, Task4 entitlement/checkout/portal APIs
- Produces: L10 ファネル UI 1–6 すべて（#3 locked preview は Task7 で完成、本 Task は #1/#2/#5/#6 + quality gate 枠は Task6）
- **ブラウザは `/api/billing/*` のみ。** Price ID / `sk_` / `VITE_STRIPE_*` を client に置かない（Checkout redirect only。Stripe.js publishable は P0 非スコープ）

**コピー固定（テスト exact）:**

| 場所 | 文言 |
|------|------|
| Free 硬上限 CTA | `Plus なら 1 日最大 10 回まで作成できます` + ボタン `Plus を見る` |
| Free success remaining === 1 | `本日の無料回数が残り 1 回です` |
| 設定 trial | `無料期間が終わると、登録したお支払い方法に料金がかかります` |
| 年額確認 | `1 年分まとめてのお支払いです。途中解約しても残り期間の返金はありません（法令に従う場合を除く）` |
| Portal ボタン | `お支払い・解約の管理` |
| Stripe 遷移前 | `カード入力画面に移ります` |
| **L10-6 成功後 upsell** | `来週の献立をチラシからまとめて作ることもできます` + 閉じる。`localStorage` キー **`flyer_upsell_week`** 値 **`YYYY-Www`**（JST ISO 週）。同週 2 回目は出さない。Plus entitled では出さない |

- [ ] **Step 1: RED — plan settings**

```ts
it("shows Free plan price and Plus をはじめる CTA when not entitled", () => {
  // mock entitlement free
  // expect 月額 580 円 / 年額 5,800 円
});

it("shows trial end warning copy while trialing", () => {
  expect(screen.getByText(/無料期間が終わると/)).toBeVisible();
});

it("shows past_due payment update path to portal", () => {
  //
});
```

- [ ] **Step 2: RED — hard limit CTA on review + L10-6 upsell**

```ts
it("shows Plus hard-limit CTA when Free success remaining is 0", () => {
  render(<Harness usageRemaining={0} attemptsRemaining={3} plan="free" />);
  expect(screen.getByText(/Plus なら 1 日最大 10 回まで作成できます/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Plus を見る" })).toBeVisible();
});

it("shows soft one-remaining line without hard sell", () => {
  render(<Harness usageRemaining={1} attemptsRemaining={3} plan="free" />);
  expect(screen.getByText("本日の無料回数が残り 1 回です")).toBeVisible();
});

it("does not prefix Plus remaining copy with 無料版は", () => {
  render(<Harness usageRemaining={2} attemptsRemaining={5} plan="plus" />);
  expect(screen.queryByText(/無料版は/)).not.toBeInTheDocument();
});

it("shows flyer upsell once per JST week for Free after success (L10-6)", () => {
  localStorage.clear();
  // render menu result success Free
  expect(
    screen.getByText("来週の献立をチラシからまとめて作ることもできます"),
  ).toBeVisible();
  // dismiss → flyer_upsell_week set
  // remount same week → banner absent
});
```

- [ ] **Step 3: RED run**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/plan-settings-section.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/flyer-upsell-banner.test.tsx
```

- [ ] **Step 4: GREEN UI**

- `formatPlanQuotaCopy(body, plan)` を個人枠メッセージに適用（global は接頭なし維持）。
- ホスト grep ゲート:

```bash
grep -rn "formatFreeTierQuotaCopy" src --include='*.ts' --include='*.tsx'
```

Expected: ユーザー向け残数/上限表示は `formatPlanQuotaCopy` 経由（`free-tier.ts` 内部呼び出しは plan-tier のみ可）。

- Checkout: `POST /api/billing/checkout` body `{ interval }` → `window.location.assign(url)`。
- Portal: 同様。
- タッチ 44×44、320px 折り返し。
- `billing=success` 時は entitlement を短周期 re-fetch（webhook 遅延の UX）。
- L10-6: Free かつ成功結果表示時のみ。dismiss で `localStorage.setItem("flyer_upsell_week", jstIsoWeekKey)`。

- [ ] **Step 5: GREEN verify**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/history/components/regeneration-sheet.test.tsx
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: 設定のプラン管理と上限時Plus CTAを追加"
```

---

### Task 6: 品質モード v3 + DB HMAC v3 cutover + `OPENROUTER_PLUS_MODELS` + 原子 reserve（PR6）

**Files:**
- Create: `supabase/migrations/20260729150000_quality_mode_ledgers.sql`（**quality 台帳 + generation-command.v3 DB cutover を同一 migration**）
- Create: `supabase/tests/database/quality_mode_reserve.test.sql`
- Modify: `shared/contracts/generation.ts`（**v3 置換**、`qualityMode: boolean`、v2 削除）
- Modify: `netlify/functions/_shared/generation-command-integrity.ts` + test
- Modify: `netlify/functions/_shared/generation-repository.ts`（`p_quality_mode`）
- Modify: `netlify/functions/_shared/openrouter.ts` / `generation-service.ts` モデル選択
- Modify: `netlify/functions/_shared/env.ts`（`OPENROUTER_PLUS_MODELS`）
- Modify: `scripts/verify-openrouter-models.mjs`
- Modify: UI トグル「くわしく作る」（Q4）— planner/review または generation 入口
- Modify: `usageTodayDataSchema` に `quality` **required**（Task3 shape 拡張）
- Modify: **ADV-15 fixtures** — `shared/testing/factories.ts`, `netlify/functions/_tests/usage-today.test.ts`, UI mocks that build `UsageTodayData`
- Modify: `issueMessages` + `generationFailureCodes`:
- **Modify（DB v3 cutover — external Issue 1 / prior ADV-4 残件）:** Task3 が列挙した署名感度 pgTAP **全 call site を v3 へ再更新**（Task3 時点は plan 対応 arg だが HMAC version はまだ v2 のまま）:
  - `supabase/tests/database/rls_inventory.test.sql`
  - `supabase/tests/database/identity_daily_quota.test.sql`
  - `supabase/tests/database/ai_control_and_quota.test.sql`
  - `supabase/tests/database/ai_control_and_quota_races.test.sql`
  - `supabase/tests/database/user_feedback.test.sql`
  - `supabase/tests/database/paid_quota_upgrade_path.test.sql`（該当）
  - `supabase/tests/database/maintenance_cleanup.test.sql`（該当）
  - `supabase/tests/database/account_deletion.test.sql`
  - `supabase/tests/database/menu_generation_model.test.sql`（`request_hmac_version` fixture）
  - `supabase/tests/database/plan_aware_quota.test.sql`（Task3 追加分）
  - `supabase/tests/database/quality_mode_reserve.test.sql`（本 Task 新規・v3 のみ）
  - その他 `supabase/tests/database/**/*.sql` で `generation-command.v2` を渡す call site（実装時ホスト grep で確定）

| code | message（日本語・固定） |
|------|-------------------------|
| `quality_mode_requires_plus` | `くわしい AI での作成は Plus で使えます。` |
| `quality_daily_limit` | `本日のプレミアム作成回数を使い切りました。` |
| `quality_monthly_limit` | `今月のプレミアム回数を使い切りました。` |

#### ADV-3 + ADV-4 — `generation-command.v3` 同時 cutover（TS **と** DB・全パス必須）

**Browser producers（qualityMode: false 明示）:**

| Path | Role |
|------|------|
| `src/features/planner/planner-route.tsx` | new_menu command 構築 |
| `src/features/history/hooks/use-regeneration.ts` | regenerate_menu / regenerate_dish |
| `src/features/generation/api/generation-api.ts` | POST body |
| `src/features/generation/model/pending-generation.ts` | pending Zod / storage |

**Browser tests that assert v2（期待を v3 + qualityMode へ）:**

| Path |
|------|
| `src/features/planner/planner-route.test.tsx` |
| `src/features/history/hooks/use-regeneration.test.tsx` |
| `src/features/generation/api/generation-api.test.ts` |
| `src/features/generation/model/pending-generation.test.ts` |
| `src/features/generation/hooks/use-generation-recovery.test.tsx` |
| `src/features/generation/model/generation-return-path.test.ts` |
| `src/features/generation/pages/generation-page.test.tsx` |
| `src/shared/types/database.test.ts`（v2 文字列があれば） |

**Server / shared:**

| Path |
|------|
| `shared/contracts/generation.ts` |
| `netlify/functions/_shared/generation-command-integrity.ts` |
| `netlify/functions/_shared/generation-command-integrity.test.ts` |
| `netlify/functions/_shared/generation-repository.ts` / `.test.ts` |
| `netlify/functions/_shared/generation-service.ts` / `.test.ts` |
| `netlify/functions/generate-menu.ts` / `generate-dish.ts` |
| `netlify/functions/_tests/generate-menu.test.ts` / `generate-dish.test.ts` |
| `netlify/functions/_shared/generation-integrity-context.test.ts` |
| `netlify/functions/_shared/generation-prompt.test.ts` |
| `netlify/functions/_shared/regeneration-*.test.ts`（v2 fixture） |
| `netlify/functions/_shared/generation-adversarial.integration.test.ts` |
| その他 `src` / `shared` / `netlify` の grep ヒット |

**DB cutover（`20260729150000_quality_mode_ledgers.sql` 内・必須手順）:**

```text
0. Pre-prod / local のみ: processing 中の request を truncate（L12 後方互換不要）
   delete from private.generation_regeneration_snapshots;
   delete from private.ai_generation_requests;
   -- 必要なら related processing rows

1. CHECK 置換
   - private.ai_generation_requests.request_hmac_version の
     CHECK (… = 'generation-command.v2') を DROP
   - 新 CHECK: request_hmac_version = 'generation-command.v3' のみ

2. 全 live SQL 関数の v2 拒否を v3 のみへ
   - reserve_ai_generation 正本: p_request_hmac_version <> 'generation-command.v3'
     → invalid_request_hmac（現行 identity 正本 20260728150000 L246–249 を superseded）
   - request 行 re-check / repair / その他 version 比較も v3 のみ
   - CREATE OR REPLACE で現行シグネチャを上書き

3. 旧 overload DROP
   - pg_proc 上の reserve_ai_generation / get_ai_usage_today 等で
     Task3 以前の arg list（quality 無し・旧版）が残っていれば DROP FUNCTION 明示
   - 生存 overload は Task6 最終シグネチャ 1 本のみ

4. grant inventory
   - 最終 public RPC: revoke all from public, anon, authenticated;
     grant execute to service_role（現行方針に合わせ authenticated 実行が必要な公開 RPC は
     既存 inventory と同じ grant を維持し、billing と混同しない）
   - 旧 overload への EXECUTE が残らないこと

5. pgTAP call site 全更新（上記 Files 列挙）
   - fixture / has_function 文字列 / reserve 呼び出しの
     'generation-command.v2' → 'generation-command.v3'
   - quality 系は v3 + p_quality_mode のみ
```

**Grep gates（Task6 GREEN 前・ホスト）— 適用範囲を誤らないこと:**

```bash
# (A) アプリ／Functions 生産者・消費者 — ヒット 0
grep -rn "generation-command\.v2\|generationCommandVersionV2" src shared netlify --include='*.ts' --include='*.tsx'
```

```bash
# (B) 現行 pgTAP — ヒット 0（call site が v3 のみ）
grep -rn "generation-command\.v2" supabase/tests/database --include='*.sql'
```

```bash
# (C) 歴史 migration はゲート対象外（supabase/migrations の過去 stamp に v2 が残ってよい）
# 禁止: 「supabase/migrations 全体で v2 ゼロ」を要求すること
# 実効制約は (D) と full db-test で固定する
```

```bash
# (D) マイグレ適用後の実効制約・関数定義（migrate 後・db-test 前後どちらかで確認）
# 例: information_schema / pg_get_constraintdef で request_hmac_version CHECK が v3 のみ
# 例: pg_get_functiondef(reserve…) が generation-command.v3 を参照し v2 を拒否
```

Expected: (A)(B) ヒット **0**。(C) は検査しない。(D) は v3 受入・v2 拒否。

**Interfaces:**
- Consumes: Task3 reserve 拡張土台、Task4 entitlement
- Produces:
  - `generationCommandVersionV3 = "generation-command.v3"`
  - Tables `private.ai_identity_quality_daily` (≤3), `private.ai_identity_quality_monthly` (≤20)
  - `reserve_ai_generation(..., p_quality_mode boolean default false)` 同一 TX
  - **DB:** `request_hmac_version` CHECK = v3 only。live RPC は v3 のみ受入、v2 は `invalid_request_hmac`
  - **M8 共消費ロック:** `p_quality_mode=true` 成功予約時、**通常 identity success reserved++ と identity attempt reserved++ と quality day/month reserved++ と global reserved++ を同一 TX** で行う。品質だけ増やして通常 success を飛ばす実装は **仕様違反**
  - Free / !plus / kill で `qualityMode:true` → **reserve 前 403** `quality_mode_requires_plus`。quality 台帳 **非接触**
  - Repair は request.`quality_mode` スナップショットで Plus リスト継承
  - **C3 release 対称（Task6 範囲）:** 拡張する RPC/helper 名:
    - `private.release_request_quota_reservations` — quality day/month **reserved** を request.quality_mode 時に戻す
    - fail finalize 経路（現行 `finalize_ai_generation_failure` 相当 / migration 内名に合わせる）
    - stale cleanup（maintenance が呼ぶ release）
    - `private.release_identity_and_global_for_user_processing` / `public.release_identity_and_global_for_user_processing` — processing 行の quality reserved も解放
  - pgTAP: quality reserve → fail finalize → day/month reserved = 0
  - pgTAP: **v3 accepted** / **v2 rejected with invalid_request_hmac**

**Canonical HMAC v3:** 既存 v2 キー順に **`qualityMode` 追加**。`canonicalizeGenerationCommandV3` の順を test 固定。

- [ ] **Step 1: RED — command v3 schema + producers**

```ts
it("requires generation-command.v3 with qualityMode boolean", () => {
  const cmd = {
    commandVersion: "generation-command.v3",
    kind: "new_menu",
    qualityMode: false,
    // … valid fields
  };
  expect(generationCommandSchema.parse(cmd).qualityMode).toBe(false);
});

it("rejects generation-command.v2", () => {
  expect(
    generationCommandSchema.safeParse({
      commandVersion: "generation-command.v2",
      qualityMode: false,
    }).success,
  ).toBe(false);
});
```

Browser producer RED 例（`planner-route.test.tsx`）:

```ts
it("builds generation-command.v3 with qualityMode false by default", () => {
  // trigger create
  expect(postedBody.commandVersion).toBe("generation-command.v3");
  expect(postedBody.qualityMode).toBe(false);
});
```

- [ ] **Step 2: RED — Free quality 403 before reserve + no ledger mutation**

```ts
it("rejects qualityMode on Free before calling reserve RPC", async () => {
  // expect quality_mode_requires_plus; reserve not called
});

it("does not mutate quality ledgers when Free requests qualityMode", async () => {
  // after 403, quality daily reserved_count still 0 (RPC or mock assert)
});
```

- [ ] **Step 3: RED — HMAC includes qualityMode**

```ts
it("changes HMAC when only qualityMode flips", () => {
  const a = generationRequestHmac({ ...cmd, qualityMode: false }, integrity, key);
  const b = generationRequestHmac({ ...cmd, qualityMode: true }, integrity, key);
  expect(a).not.toBe(b);
});
```

- [ ] **Step 4: RED — pgTAP DB v3 cutover + concurrent quality + release symmetry（C3 / Issue 1）**

`quality_mode_reserve.test.sql` および既存 suite 更新:

```sql
-- DB v3:
--   reserve with p_request_hmac_version = 'generation-command.v3' succeeds (happy path smoke)
--   reserve with p_request_hmac_version = 'generation-command.v2' → failure_code invalid_request_hmac
--   ai_generation_requests CHECK rejects insert with request_hmac_version = 'generation-command.v2'
--   no live overload of reserve_ai_generation without p_quality_mode (has_function / oid inventory)

-- quality:
--   two parallel p_quality_mode true cannot exceed day 3
--   quality reserve then fail finalize → quality reserved back to 0 AND identity reserved back to 0
--   quality success path would increment normal success on succeed (documented; unit/service assert)
```

- [ ] **Step 5: GREEN migration + RPC + DB v3 cutover**

```sql
-- truncate processing (L12)
delete from private.generation_regeneration_snapshots;
delete from private.ai_generation_requests;

create table private.ai_identity_quality_daily ( /* CHECK reserved+success <= 3 */ );
create table private.ai_identity_quality_monthly ( /* usage_month JST month start, <= 20 */ );
revoke all … from public, anon, authenticated, service_role;

alter table private.ai_generation_requests
  add column if not exists quality_mode boolean not null default false;

-- === generation-command.v3 DB cutover (Issue 1) ===
-- drop old CHECK on request_hmac_version; add CHECK (... = 'generation-command.v3')
-- CREATE OR REPLACE reserve_ai_generation(... p_quality_mode boolean default false ...):
--   reject p_request_hmac_version is distinct from 'generation-command.v3' → invalid_request_hmac
-- DROP FUNCTION 旧 overload（quality 無し・v2 専用シグネチャ）
-- re-grant EXECUTE inventory on surviving overloads only

-- reserve_ai_generation p_quality_mode:
--   when true: FOR UPDATE identity success + attempt + global + quality day + quality month
--   any limit hit → entire TX rollback (no partial reserved)
--   M8: quality path ALWAYS touches normal success/attempt ledgers too

-- private.release_request_quota_reservations(v_request, p_now):
--   existing identity/global reserved release
--   + if v_request.quality_mode then decrement quality day/month reserved

-- finalize failure / stale / release_identity_and_global_for_user_processing: call extended helper
```

- [ ] **Step 6: GREEN TS + all producers + all pgTAP fixtures**

- `generationCommandVersionV2` 削除。`generationCommandSchema = generationCommandV3Schema`。
- 上表の全 producer を v3 + `qualityMode` に更新。
- **全 `supabase/tests/database` call site** を v3 へ（歴史 migration は触らない）。
- env: `BILLING_ENABLED=true` 時 `OPENROUTER_PLUS_MODELS` ≥1。`parseOpenRouterModels` 同一ゲート。
- model resolve: quality_mode snapshot true → Plus list only。空 → `model_unavailable` + `quality_models_unconfigured`。
- usage-today merge に quality 投影を RPC/Function で追加（schema required）。
- factories / fixtures を quality 付きに一括更新。

- [ ] **Step 7: GREEN verify**

```bash
grep -rn "generation-command\.v2\|generationCommandVersionV2" src shared netlify --include='*.ts' --include='*.tsx'
```

（Expected: no hits）

```bash
grep -rn "generation-command\.v2" supabase/tests/database --include='*.sql'
```

（Expected: no hits）

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-command-integrity.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-repository.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-service.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/planner-route.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/history/hooks/use-regeneration.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/api/generation-api.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/model/pending-generation.test.ts
```

```bash
docker compose run --rm migrate
```

```bash
docker compose run --rm app npm run db:types
```

```bash
docker compose --profile test run --rm db-test
```

（Expected: **full** db-test PASS。v3 受入・v2 `invalid_request_hmac`・quality suite 含む）

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: Plus品質モード（generation-command.v3）とOPENROUTER_PLUS_MODELSを追加"
```

---

### Task 7: チラシ週間 + multimodal + try 台帳（PR7）

**Files:**
- Create: `supabase/migrations/20260729160000_flyer_weekly.sql`
- Create: `supabase/tests/database/flyer_weekly_reserve.test.sql`
- Create: `shared/contracts/flyer-weekly.ts` + test
- Create: `netlify/functions/flyer-weekly.ts`
- Create: `netlify/functions/_shared/flyer-image.ts`（magic bytes / sharp / 4MiB / 2048²）
- Modify: `package.json` — `sharp` exact pin
- Modify: `netlify/functions/_shared/openrouter.ts` — request `content: string | ContentPart[]`（**response `message.content` は string のまま** — ADV-25）
- Create: `netlify/functions/_shared/flyer-weekly-service.ts` + tests
- Modify: planner UI locked preview（Free）+ Plus upload
- Modify: `maintenance-cleanup` / SQL — flyer 台帳 12 週 retention
- **Modify: `tools/e2e-function-server.mjs` + `.test.mjs`** — `flyer-weekly.ts` を allowlist 追加（C2）
- Modify: **ADV-15** — factories / usage-today tests / UI mocks for required `flyerWeekly`
- Optional env: `OPENROUTER_FLYER_MODELS`（未設定時 Plus list。Q1）

**Interfaces:**
- Consumes: Task4 entitlement, Task6 Plus models
- Produces:
  - `POST /api/flyer-weekly` multipart field **`image` only**
  - RPC `reserve_flyer_weekly(...)` 順序 **S0→S1→S2→S3→S4**（A8/A11）
  - Codes + `issueMessages` exact:

| code | message（日本語・固定） |
|------|-------------------------|
| `flyer_requires_plus` | `チラシ写真から 1 週間の献立は Plus の機能です。` |
| `flyer_weekly_limit` | `今週のチラシ献立の作成上限に達しています。` |
| `flyer_weekly_try_limit` | `しばらくしてから再度お試しください。` |
| `flyer_invalid_image` | `画像を読み取れませんでした。別の写真でお試しください。` |
| `flyer_unsupported_media` | `対応している画像形式は JPEG / PNG / WebP です。` |
| `flyer_invalid_ai_response` | `週間献立を正しく確認できませんでした。` |

  - 日次 success **非消費**。attempt/global は送信分。short は mark/send 時
  - `usageTodayDataSchema.flyerWeekly` **required**
  - **C3 flyer release 対称:**
    - 処理行: `private.flyer_weekly_requests`（推奨・release 対象フラグ用）または generation と同型の request 行
    - `private.release_flyer_weekly_reservations(p_request, p_now)` または既存 helper 拡張:
      - OpenRouter 送信前 fail（S8）: flyer success reserved + try reserved + identity attempt reserved + global reserved を全解放
      - 送信後 validation fail（S9）: try は sent のまま、success reserved 解放、attempt/global sent 扱い
      - stale cleanup / account delete: 未送信 reserved を解放
    - pgTAP: reserve → release → reserved 0

**`reserve_flyer_weekly` 署名（固定）:**

```text
reserve_flyer_weekly(
  p_user_id uuid,
  p_identity_key text,
  p_idempotency_key text,
  p_attempt_limit integer,       -- 6|20
  p_short_window_limit integer,  -- 4|8 snapshot only
  p_global_limit integer,        -- 1..200
  p_quota_disabled boolean default false,
  p_now timestamptz default clock_timestamp()
) returns jsonb
-- S1 full → flyer_weekly_limit, NO mutations
-- S2 try full → flyer_weekly_try_limit
-- S3 attempt/global → existing codes
-- S4 → reserved++ flyer success, flyer try, identity attempt, global
```

**sharp / Netlify packaging（ADV-12 Must）:**

| 項目 | ロック |
|------|--------|
| Install | `docker compose run --rm --no-deps app npm install sharp --save-exact` |
| Netlify | `netlify.toml` または Functions bundler 設定で `sharp` を **external にしない / または platform linux-x64 を強制**。ドキュメント `docs/deployment/netlify.md` に「flyer Function は native sharp を同梱」節を追加 |
| Smoke | Task7 unit: `import sharp from "sharp"` が Node 上で成功。Task8 `npm run build` が sharp 解決を壊さないこと |
| 代替 | sharp が Netlify で解決不能なら **同一 Task 内で** pure decode に落とさず、blocker として報告（設計は sharp または同等）。実装者は silent に sharp を外さない |

- [ ] **Step 1: RED — OpenRouter multimodal type**

```ts
it("accepts content parts array for vision messages", () => {
  const msg: OpenRouterMessage = {
    role: "user",
    content: [
      { type: "text", text: "..." },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
    ],
  };
  expect(Array.isArray(msg.content)).toBe(true);
});
```

- [ ] **Step 2: RED — flyer success full no try mutation（A11）+ release**

```sql
-- success_count=2 → reserve always flyer_weekly_limit; tries unchanged
-- reserve then release_flyer → reserved 0
```

```ts
it("does not call OpenRouter when reserve returns flyer_weekly_limit", async () => {
  // openrouter call count 0
});
```

- [ ] **Step 3: RED — image pipeline**

```ts
it("rejects over 4 MiB with flyer_invalid_image", async () => {});
it("rejects non jpeg/png/webp magic with flyer_unsupported_media", async () => {});
it("imports sharp successfully in flyer-image module", async () => {
  await expect(import("./flyer-image.js")).resolves.toBeDefined();
});
```

- [ ] **Step 4: RED — Free 403 + e2e allowlist**

```ts
it("returns flyer_requires_plus without reserve when not plus entitled", async () => {});
```

```js
// e2e-function-server.test.mjs
it("registers flyer-weekly function module", () => {
  // includes /netlify/functions/flyer-weekly.ts
});
```

- [ ] **Step 4b: Install sharp exact**

```bash
docker compose run --rm --no-deps app npm install sharp --save-exact
```

- [ ] **Step 5: GREEN SQL + Function + multimodal + Netlify note**

1. S1 成功枠最優先  
2. S2 try  
3. S3 attempt/global  
4. S4 reserved++  
5. OpenRouter は S4 後のみ  
6. 画像非永続・filename 非ログ（SafeLog `flyer: true` のみ）  
7. server current safety only  
8. release helpers + maintenance 12 週  
9. `docs/deployment/netlify.md` sharp 節  

- [ ] **Step 6: GREEN UI locked preview**

文言: `チラシ写真から 1 週間の献立は Plus の機能です`

- [ ] **Step 7: GREEN verify**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/flyer-weekly.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/flyer-weekly-service.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/openrouter.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run tools/e2e-function-server.test.mjs
```

```bash
docker compose run --rm migrate
```

```bash
docker compose run --rm app npm run db:types
```

```bash
docker compose --profile test run --rm db-test
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: Plusチラシ画像から1週間献立（try上限付き）を追加"
```

---

### Task 8: delete-account Stripe・privacy・E2E・runbooks・preflight（PR8）

**Files:**
- Modify: `netlify/functions/delete-account.ts` + `netlify/functions/_tests/delete-account.test.ts`
- Modify: `src/features/account/delete-account-dialog.tsx` + test
- Modify: `shared/contracts/domain.ts` → `privacyNoticeVersion = "2026-07-29.v1"`
- Modify: 全 privacy 参照テスト / generation fixtures
- Modify: `src/features/privacy/privacy-copy.ts`（有料プラン・Stripe・trial 履歴の追記）
- Modify: `scripts/preflight-production.mjs`（STRIPE 鍵、`STRIPE_API_VERSION=2026-06-24.dahlia`、GLOBAL≤200、BILLING 整合）
- Modify: `docs/deployment/netlify.md`（sharp + Stripe env）、roadmap Locked Environment Contract 注記
- Modify: `package.json` `"db:test"` → `docker compose --profile test run --rm db-test`（ADV-23）
- Create/Modify: `e2e/specs/billing-plus.spec.ts`（既存命名に合わせる）
- **Verify: `tools/e2e-function-server.mjs`** に billing 4 + flyer-weekly が残っていること（Task4/7 依存。欠落ならここで追加）
- Ensure: `docs/runbooks/billing-reconcile.md` + Portal チェックリスト完了
- Modify: compose / `.env.example` 最終揃え

**Interfaces:**
- delete-account 順序（C3 + external Issue 4）:
  1. 認証 + 確認フレーズ
  2. **`public.release_identity_and_global_for_user_processing`**（Task6/7 拡張後: quality + flyer processing reserved も解放）
  3. 未完了 flyer request があれば flyer reserved 解放（helper 経由）
  4. billing cancel（**customer 単位で全 live subscription**）:
     ```text
     a. rpc get_billing_customer_by_user(userId) → { stripe_customer_id } or empty
     b. if no customer → skip Stripe; go to Auth delete
     c. stripe.subscriptions.list({ customer: stripe_customer_id, status: "all" })
        // 代替可: status を active+trialing+past_due+incomplete 等 non-terminal に絞る list を複数回
        // DB の 1 行だけを cancel 対象にしない（二重 sub 残差を取りこぼさない）
     d. for each subscription where status is live/non-terminal
        (not canceled / incomplete_expired 等の終端):
          try stripe.subscriptions.cancel(sub.id)
          catch → SafeLog billing_cancel_failed（opaque sub id / customer id のみ。email 禁止）
          continue  // 部分失敗でも残りを試行
     e. いずれの cancel 成否にかかわらず Auth delete へ進む
     ```
  5. Auth hard delete（CASCADE で billing_customers/subscriptions 行は消える。trial_history は identity 残存）
- ユーザー向け追加文: `有料プランに入っている場合、解約手続きもあわせて行います。請求の詳細はメール（Stripe）をご確認ください。`

- [ ] **Step 1: RED — privacy version**

```ts
expect(privacyNoticeVersion).toBe("2026-07-29.v1");
```

- [ ] **Step 2: RED — delete-account list+cancel all + release（Issue 4）**

```ts
it("skips Stripe when no billing customer and still deletes auth user", async () => {
  // get_billing_customer_by_user empty → subscriptions.list not called
  // auth.admin.deleteUser called
});

it("lists subscriptions by customer and cancels a single live sub before auth delete", async () => {
  // list({ customer, status: "all" }) → one active → subscriptions.cancel(that id)
  // auth.admin.deleteUser called
});

it("cancels every live subscription when customer has multiple", async () => {
  // list returns active + trialing (+ past_due) → cancel each id once
  // does not rely on DB billing_subscriptions single row alone
});

it("continues canceling remaining and still auth-deletes when one cancel fails", async () => {
  // first cancel throws → log billing_cancel_failed → second cancel still attempted
  // auth.admin.deleteUser still called
});

it("calls release_identity_and_global_for_user_processing before auth delete", async () => {
  // rpc called with user id
});
```

- [ ] **Step 3: RED — delete dialog copy**

```ts
expect(screen.getByText(/有料プランに入っている場合、解約手続きもあわせて行います/)).toBeVisible();
```

- [ ] **Step 4: GREEN implementations + fixture 一括更新**

```bash
grep -rn "2026-07-28.v1" shared src netlify e2e --include='*.ts' --include='*.tsx'
```

ヒットを `2026-07-29.v1` へ。

e2e allowlist 確認:

```bash
grep -n "billing-\|flyer-weekly" tools/e2e-function-server.mjs
```

Expected: checkout/portal/webhook/entitlement/flyer-weekly の 5 行が存在。

- [ ] **Step 5: GREEN focused unit（最終 AGENTS §8 の前段）**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/domain.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_tests/delete-account.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/account/delete-account-dialog.test.tsx
```

- [ ] **Step 6: E2E 前提シナリオ実装（mock billing）**

前提: Task4/7 で `functionModulePaths` 更新済み。mock webhook injector で subscription.created を注入。

必須シナリオ:

1. Free 硬上限 CTA 表示  
2. settings プラン価格表示  
3. mock webhook 後 usage limit 10  
4. trial 文面  
5. 削除ダイアログ課金文  
6. （任意）flyer locked preview Free  

preflight（§8 外の追加確認。失敗しても §8 を省略しない）:

```bash
docker compose run --rm --no-deps app npm run preflight:production
```

- [ ] **Step 7: 最終提出前 — AGENTS.md §8 必須 9 検証（external Issue 6）**

**規則:**

- **1 ツール呼び出し = 1 コマンド**（`&&` / `;` 連結禁止）
- 下表の **1→9 の順**を崩さない
- 失敗時: 原因を修正し、**失敗したステップから**再実行（成功済みの前段を省略して後段だけ走らせて「完了」としない）
- リポジトリ内 script（`reset-local-db.sh` / `run-e2e.sh`）実行前: 当該 script または呼び出し先に未確認差分があれば差分を確認し、破壊的操作・外部送信・シークレット参照がないことを確認する（AGENTS.md §8 注意）

| # | コマンド |
|---|----------|
| 1 | `docker compose run --rm --no-deps app npm run format:check` |
| 2 | `docker compose run --rm --no-deps app npm run lint` |
| 3 | `docker compose run --rm --no-deps app npm run typecheck` |
| 4 | `docker compose run --rm --no-deps app npx vitest run` |
| 5 | `./scripts/reset-local-db.sh` |
| 6 | `docker compose --profile test run --rm db-test` |
| 7 | `./scripts/run-e2e.sh` |
| 8 | `docker compose run --rm --no-deps app npm run build` |
| 9 | `git diff --check` |

独立コマンドとして順に実行（コピー用・それぞれ単独）:

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npx vitest run
```

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test
```

```bash
./scripts/run-e2e.sh
```

```bash
docker compose run --rm --no-deps app npm run build
```

```bash
git diff --check
```

Expected: 9 すべて PASS。

- [ ] **Step 8: Commit（§8 全パス後）**

```bash
git commit -m "feat: 課金削除連携とprivacy更新、E2E受け入れを追加"
```

---

## Cross-check matrix（設計受け入れ → Task）

| 設計シナリオ | Task |
|--------------|------|
| Free 成功 3 後 `user_daily_limit` + 硬上限 CTA | 3（枠）, 5（CTA） |
| L10-6 成功後 flyer upsell（週1・localStorage） | 5 |
| Plus active 成功 10 | 3（generationQuotaSchema+status）, 4 |
| Plus trialing ≡ active | 2, 4 |
| past_due グレース内 Plus 維持 + 支払い導線 | 2, 4, 5 |
| canceled 期間末まで entitled | 2, 4 |
| Free 品質要求 403 + gate CTA、上位リスト非送 | 6, 5 |
| Plus 品質 3/日のみブロック | 6 |
| Free チラシ locked + upload 403 | 7, 5 |
| Plus チラシ成功 2/週 | 7 |
| body `plan=plus` 無視 | 3, 4 |
| Webhook 署名不正 400 | 4 |
| アカウント削除 + customer 全 live sub cancel | 8 |
| `AI_QUOTA_DISABLED` ローカル個人枠無効 | 3（既存維持） |
| `BILLING_ENABLED=false`: Free 枠 + surfaces 閉 + Webhook 継続 | 4, 3 |
| entitlement 読取失敗 503 | 3, 4（A9） |
| Plus short 5 回目（枠 8） | 3（A1） |
| 並行 Checkout 409 | 4（A5） |
| Webhook 古い active delayed ignore | 4（A2） |
| Flyer try 7 / 週 | 7（A8） |
| Flyer 成功 2 済 → try 非変異 + OpenRouter 0 | 7（A11） |
| qualityMode Free → 403 before reserve | 6（A10） |
| past_due_since NULL fail-closed | 2, 4（A6） |
| trial_history first trialing\|active webhook | 4（A7） |
| privacy `2026-07-29.v1` | 8 |
| GLOBAL max 200 / 運用 80 | 3, 8 |

---

## Spec coverage checklist（self-review）

r2: external Codex open issues 1–6 closed in plan body（see Plan revision log + companion fix log）。

| 設計要求 | Task | 固定手段 | r1/r2 |
|----------|------|----------|-----|
| L1 Forever freemium Free 有用 | 1–3 | Free 3 維持 | ok |
| L2 単一 Plus | 1,4,5 | plan_code `plus` only | ok |
| L3 ¥580 / ¥5,800 / 7 trial | 4,5 | copy + Checkout trial_period_days | ok |
| L4 Free 成功 3 不削 | 1,3 | planQuota.free | ok |
| L5 枠→品質→チラシ | 3,6,7 | 実装順 | ok |
| L6 Free 3/6/4/600 | 1,3 | planQuota + RPC | ok |
| L7 Plus 10/20/8 | 1,3 | planQuota + RPC | ok |
| L8 品質 3/日・20/月 | 6 | quality tables + co-consume | **M8 fixed** |
| L9 チラシ 2/週 + Free preview | 7 | flyer ledgers | ok |
| L10 ファネル 1–6 | 5,6,7 | **#6 upsell Task5** | **M3 fixed** |
| L11 P0 only | 全 | P1 実装なし | ok |
| L12 後方互換不要 | 6,8 | v3 置換 TS+DB, privacy bump | **ADV-3/4 r2 DB cutover** |
| L13 Webhook 正本 | 2,4 | `process_billing_stripe_event` 単一 TX | **ADV-1 + Issue2** |
| L14 クライアント plan 非信頼 | 3,4 | server only | ok |
| L15 秘密・非ログ | 4,7,8 | SafeLog allowlist | **M4** |
| L16 接頭規則 | 1,5 | plan-tier + grep | ok |
| A1 short CHECK≤8 mark-time | 3 | discovery drop + pgTAP | **ADV-11** |
| A2 ignore-older / no evt_ lex | 2,4 | process RPC + abuse suite | **ADV-10 + Issue2** |
| A3 kill webhook stays up | 4 | integration RED | ok |
| A4 atomic + release symmetry | 6,7,8 | release helpers | **C3** |
| A5 double checkout lock 30m | 2,4 | acquire→bind→release RED | **Issue3** |
| A6 past_due_since NULL | 2,3 | pgTAP case table + unit | ok |
| A7 trial_history + identity_key path | 4 | admin email → HMAC | **ADV-9** |
| A8 flyer try 6 pre-OR | 7 | RPC order | ok |
| A9 entitlement 503 | 3 | repository test | ok |
| A10 qualityMode v3 | 6 | HMAC + producers + DB CHECK/RPC | **ADV-3/4 r2** |
| A11 flyer success-full no try | 7 | pgTAP+unit | ok |
| generationQuotaSchema 3\|10 | 3 | C1 RED | **C1** |
| usage-today plan merge | 3 | algorithm box | **ADV-6** |
| status() plan limits | 3 | repository | **ADV-8** |
| pgTAP signature inventory | 3,6 | Task3 plan args + Task6 v3 HMAC | **ADV-4 fixed_in_plan r2** |
| e2e function allowlist | 4,7,8 | e2e-function-server.mjs | **C2** |
| billing write RPCs | 2 | process + bind + locks | **ADV-1 + Issue2/3** |
| delete-account list all subs | 8 | subscriptions.list status all | **Issue4** |
| sequential Tasks + handoff | ops | 1→8 unique; no parallel | **Issue5** |
| AGENTS §8 nine cmds | 8 | format…diff-check | **Issue6** |
| stripe + API version pin | 4 | `22.3.2` + `2026-06-24.dahlia` | **ADV-13** |
| migrations > `20260729120000` | 2,3,6,7 | series 130000–160000 | ok |
| db:types no --no-deps | 2,3,6,7 | `docker compose run --rm app npm run db:types` | **M1** |
| billing-entitlement.test create | 3 | M5 | **M5** |
| GLOBAL 200 test matrix | 3 | env 0/201 reject, 21 ok | **ADV-14** |
| File map regeneration path | map | `components/` | **M7** |
| Task1 free-tier.test git add | 1 | M9 | **M9** |

## Placeholder scan

- TBD / TODO /「後で実装」逃げなし。
- `STRIPE_API_VERSION` は **`2026-06-24.dahlia` に固定**（placeholder 解消）。
- Task2 write RPC 名を列挙済み（`process_billing_stripe_event` / bind lock / direct DML 禁止）。
- Task6 v2 producer パスを列挙 + grep gate（**active code + pgTAP only**; 歴史 migration 非対象）。
- Task6 DB CHECK/RPC v3 cutover + 旧 overload DROP + grant inventory + full db-test を明記。
- Task3 pgTAP 署名感度ファイルを列挙（Task6 で v3 再更新）。
- usage-today merge / status limits / release symmetry RPC 名を明記。
- Checkout acquire→create→bind→release + Session expire 補償を明記。
- delete-account `subscriptions.list` + multi cancel RED を明記。
- sharp: Docker install + Netlify packaging 節 + import smoke。
- design mermaid `priceInterval` は **plan 正本 `interval`**（design-only fix は design 側）。
- 並列 Task 記述なし。一意逐次 1→8 + per-Task gate。
- Task8 に AGENTS §8 の 9 コマンドを同一順で列挙。

## Type consistency notes

| 名前 | 場所 | 型/値 |
|------|------|-------|
| `planQuota` | `shared/contracts/plan-quota.ts` | const object |
| `releaseQuota` | re-export from plan-quota | Free alias 3/6/4/600 |
| `PlanCode` | `"free" \| "plus"` | TS + Zod enum |
| `Entitlement` / `plusEntitled` | billing-entitlement.ts | camelCase wire |
| RPC JSON | snake_case `plus_entitled` | map only; no TS re-derive at runtime |
| `generationQuotaSchema` | remaining max 10, limit 3\|10 | C1 |
| `generation-command.v3` | generation.ts | v2 廃止 |
| `qualityMode` | command top-level boolean | HMAC 含む |
| Checkout body | `{ interval: "month"\|"year" }` | not priceInterval |
| `STRIPE_API_VERSION` | env | **`2026-06-24.dahlia`** |
| Stripe SDK | `stripe@22.3.2` | exact |
| GLOBAL | max **200**, local default 20, ops 80 | Task3/8 |
| identity RPC authority was | `20260728150000` | superseded by `20260729140000`+ |

## Plan revision log

### r2（2026-07-29）— external Codex review open 6 件

| ID | 変更概要 |
|----|----------|
| Issue1 critical / **ADV-4 → fixed_in_plan** | Task6: DB CHECK/RPC を `generation-command.v3` のみへ cutover; 旧 overload DROP; grant inventory; Task3 列挙 + quality 関連を含む全 pgTAP call site を v3; grep gate は active code + `supabase/tests/database` + 実効制約のみ（歴史 migration 非対象）; RED: v3 受入 / v2 `invalid_request_hmac` / full db-test |
| Issue2 critical | Task2/4: `process_billing_stripe_event` 単一 TX（claim+lock+order+project+processed）。単独 `insert_billing_webhook_event` 永久 duplicate を廃止。RED: claim-then-crash → retry 投影; delayed active 後 re-entitle なし |
| Issue3 major | Task2/4: acquire(`lock_token`, session NULL) → create → `bind_billing_checkout_session` → release by token/session; bind 失敗時 Session expire 補償。RED: happy + create-fail + bind-fail |
| Issue4 major | Task8: `subscriptions.list({ customer, status: "all" })` で live 全件 best-effort cancel → Auth delete。RED: 0/1/複数/部分失敗 |
| Issue5 major | 並列可削除。一意順 Task1→2→3→4→5→6→7→8。依存図は論理のみ。各 Task 後 per-Task gate（implementer→verifier→一次 reviewer→二次 reviewer→write-once handoff） |
| Issue6 major | Task8 Step7: AGENTS.md §8 の 9 コマンドを同一順・独立実行で列挙。失敗時は失敗ステップから再実行 |

Companion: `docs/superpowers/plans/2026-07-29-paid-plan-stripe-plan-fix-r2-external-codex.md`

### r1（2026-07-29）— secondary must_fix 反映

| ID | 変更概要 |
|----|----------|
| ADV-1 | Task2: billing write RPCs 全列挙 + REVOKE ALL tables; Task4 は RPC のみ |
| C1 | Task3: `generationQuotaSchema` + repository `user_daily_limit` 3\|10 |
| ADV-3 | Task6: v2 producers/tests 全パス表 + grep gate 0 hits |
| ADV-4 | Task3: signature-sensitive pgTAP ファイル列挙（**r2 で DB v3 cutover まで完了 → fixed_in_plan**） |
| C2 | Task4/7/8: `tools/e2e-function-server.mjs` allowlist |
| C3 | Task6/7/8: release/finalize/stale/account-delete reserved 対称 + RPC 名 |
| ADV-6 | Task3: usage-today merge アルゴリズム step 1–9 |
| ADV-8 | Task3: `status()` plan limits |
| ADV-10/M2 | Task4: dual-sub, unmapped, delayed re-entitle, A3 webhook RED |
| ADV-9 | Task4: trial identity_key = admin email + computeQuotaIdentityKey |
| ADV-11 | Task3: identity CHECK DO discovery |
| ADV-12 | Task7: sharp Netlify packaging + smoke |
| M1 | typegen: `docker compose run --rm app npm run db:types` |
| M3 | Task5: L10-6 flyer upsell + localStorage |
| M4 | Task4: SafeLog allowlist |
| M5 | Task3: create `billing-entitlement.test.ts` |
| ADV-14 | Task3: GLOBAL max tests 0/201; 21 valid |
| ADV-15 | Task6/7: factories/fixtures listed |
| ADV-13 | pin `STRIPE_API_VERSION=2026-06-24.dahlia` |
| M7 | File map regeneration-sheet path |
| M8 | Task6 quality co-consumes normal success/attempt |
| M9 | Task1 git add free-tier.test.ts |
| minors | checkout TTL 30m, Portal checklist, package.json db:test, interval wire, A6 case table |

Companion: `docs/superpowers/plans/2026-07-29-paid-plan-stripe-plan-fix-r1.md`

---

## 実行順序（一意・逐次のみ — external Issue 5）

**実装・検証・レビュー・handoff は必ず次の一意順:**

```text
Task1 → Task2 → Task3 → Task4 → Task5 → Task6 → Task7 → Task8
```

- **並列実行は禁止**（「Task1 ∥ Task2」等の記述は r2 で削除済み）。
- 次 Task は直前 Task の **per-Task gate 完了 + write-once handoff 発行**の後にのみ開始（`AGENTS.md` / `SubAgents.md`）。
- 下図は **論理依存の説明専用**であり、実装並列や handoff スキップの許可ではない。

### 論理依存図（説明用・実行順を上書きしない）

```text
Task1 (planQuota) ──► Task3 (quota RPC) ──► Task6 (quality+v3 DB) ──► Task7 (flyer)
Task2 (billing DB) ──► Task3
Task2 ───────────────► Task4 (Stripe API) ──► Task5 (UI)
Task4 ──────────────────────────────────────────► Task6 / Task7
Task5 + Task6 + Task7 ──────────────────────────► Task8 (delete/privacy/e2e/§8)
```

### Per-Task gate（各 Task 末尾で必須）

`AGENTS.md` / `SubAgents.md` / `CLAUDE.md` に従い、**Task ごとに**次をこの順で完了してから次 Task の handoff を発行する:

1. **Implementer** — RED → GREEN → REFACTOR（本計画の Task 本文）
2. **Verifier** — Task の focused tests + typecheck / lint / format:check（および migration/pgTAP がある Task では migrate + db-test）。Docker 出力は要約でよい
3. **Primary reviewer** — 設計・本計画・セキュリティ・敵対的入力の read-only レビュー（Implementer と別スレッド）
4. **Secondary reviewer** — 一次指摘の深掘り検証（一次とコンテキスト共有しない別 Reviewer）
5. **Write-once handoff** — `.superpowers/sdd/handoff-plan-…-task-<completed>-to-task-<next>-<head7>.md` を新規作成（既存 leaf 上書き禁止）。次 Task スレッドへは **exact path のみ**渡す
6. progress ledger（`.superpowers/sdd/progress.md`）を更新

Task8 のみ、最終 commit 前に **AGENTS.md §8 の 9 コマンド**（本計画 Task8 Step7）を追加で必須とする。

---

## 検証コマンド早見（Task 完了ごと）

各 Task の GREEN 末尾で、変更に応じて（いずれも **1 コマンド = 1 呼び出し**）:

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

Migration 変更時:

```bash
docker compose run --rm migrate
```

```bash
docker compose --profile test run --rm db-test
```

**最終（Task8）— AGENTS.md §8 をこの順で全部（Task8 Step7 正本）:**

1. `format:check`
2. `lint`
3. `typecheck`
4. `npx vitest run`（full）
5. `./scripts/reset-local-db.sh`
6. `docker compose --profile test run --rm db-test`
7. `./scripts/run-e2e.sh`
8. `build`
9. `git diff --check`

失敗時は修正のうえ **失敗ステップ以降を再実行**。

---

## Self-review note（r2）

External Codex review（`2026-07-29-paid-plan-stripe-external-review-codex-gpt5.md`）の open issues **1–6 はすべて計画本文へ反映済み**（companion fix log の Response を正）。prior `ADV-4` は Task6 DB v3 cutover により **fixed_in_plan**。製品スコープの追加発明なし。

---

*End of plan. Authority: `docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md` r2. Codebase anchors: `/tmp/grok-1000/paid-plan-codebase-inventory.md`. Plan revision: r2.*
