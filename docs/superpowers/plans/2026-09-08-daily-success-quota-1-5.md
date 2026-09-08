# 日次献立成功枠 Free 1 / Plus 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1 日献立の成功上限を Free 1 / Plus 5 にし、試行・短時間・週次・品質は現行のままにする。

**Architecture:** Free 成功の正本は `plan-quota-constants.mjs`、Plus 成功は `plan-quota.ts` の `plusQuota.successPerDay`。SQL の `p_user_limit` 許可リストは dual-write 残差なので新規 migration で `(1, 5)` に一括切替する。スナップショット CHECK は discovery drop してから named `in (1, 3, 5, 10)` を付け直す。Functions と SQL は同一メンテ窓。エージェントは deploy しない。

**Tech Stack:** TypeScript strict / Zod、Netlify Functions、Supabase Postgres + pgTAP、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-08-daily-success-quota-1-5-design.md`（レビュー確定分反映済み。U-C1 / U-I1..U-I6 を含む。executor は spec 全文を読むこと）。

## Global Constraints

- Node.js `>=24 <25`、ESM、TypeScript `strict: true`。network/DB 境界で `any`・unchecked cast 禁止。
- ユーザー向け文言は日本語。識別子・テストタイトルは英語。コメント・コミットメッセージは日本語。
- 成功枠だけ変える: Free **1** / Plus **5**。試行 6/20、短時間 4/8/600s、品質 3/20、チラシ・週献立 2/6 は変えない。
- SQL `p_user_limit` は `(1, 5)` のみ。`(1, 3, 5, 10)` 併用は禁止。
- identity CHECK `reserved + success <= 10` は下げない。
- 歴史行の `quota_success_limit` 3|10 は書き換えない。
- RPC はファイル単位コピー禁止。関数本体だけ。whitelist 行以外はバイト一致。
- スナップショット CHECK は discovery drop → named re-add。ADD だけの ALTER 禁止。
- 裸の成功枠リテラルを増やさない。Free fill は `planQuota.free.successPerDay`。
- `docs/archive/` と隣接現行 spec の 3/10 記述は編集しない。`database.generated.ts` は手編集しない。
- git push / PR / deploy / 本番 Netlify `env:set` はしない。
- Node コマンドは `docker compose run --rm --no-deps app ...`。`db:test` は `docker compose --profile test run --rm db-test`。e2e は `./scripts/run-e2e.sh`。`&&` で連結しない。
- Task 1 と Task 2 の間はローカル全スタックが壊れる（Functions が 1|5、SQL が 3|10、または逆）。連続して実施し、間で e2e / 実アプリ検証をしない。

---

## ファイル構成

| ファイル | 種別 | 責務 |
|---|---|---|
| `shared/contracts/plan-quota-constants.mjs` | 変更 | Free 成功 1 / ENV `"1"` |
| `shared/contracts/plan-quota.ts` | 変更 | Plus 成功 5（defense は自動で 5） |
| `shared/contracts/plan-quota.test.ts` | 変更 | ロック値 1/5 |
| `shared/testing/factories.ts` | 変更 | success の remaining を Free 1 とバランス |
| `shared/contracts/generation.test.ts` | 変更 | 非製品 5→10\|3、Plus remaining ≤5 |
| `netlify/functions/_shared/generation-repository.ts` | 変更 | fill リテラル 3 → `planQuota.free.successPerDay` |
| `src/features/billing/plus-cta.tsx` | 変更 | `PLUS_HARD_LIMIT_COPY` を planQuota から組み立て |
| `src/features/billing/plan-settings-section.tsx` | 変更 | 「1 日最大 5 回」 |
| `compose.yaml` / `.env.example` | 変更 | `USER_DAILY_AI_LIMIT=1` |
| `supabase/migrations/20260908120000_daily_success_quota_1_5.sql` | 新設 | CHECK drop/re-add + 3 RPC whitelist |
| `supabase/tests/database/daily_success_quota_1_5.test.sql` | 新設 | CHECK 1 本、INSERT 1\|5\|3\|10、拒否 2\|4\|3\|10 |
| pgTAP 既存艦隊 | 変更 | `3, 6, 4`→`1, 6, 4`、`10, 20, 8`→`5, 20, 8` |
| `README.md` / `docs/deployment/netlify.md` / `docs/deployment/README.md` | 変更 | 運用値 1/5 とリリース順 |
| `e2e/specs/billing-plus.spec.ts` | 変更 | 文言と mock 5 |

触るな: 品質 `perDay: 3`、flyer 2/6、試行 6、短時間 4/8、`repeat('3', 64)`、品質台帳 `success_count = 3`、identity CHECK 10。

---

### Task 1: 契約定数・ENV・文言・unit テスト

**Files:**
- Modify: `shared/contracts/plan-quota-constants.mjs`
- Modify: `shared/contracts/plan-quota.ts`（`plusQuota.successPerDay` のみ）
- Modify: `shared/contracts/plan-quota.test.ts`
- Modify: `shared/testing/factories.ts`
- Modify: `shared/contracts/generation.test.ts`
- Modify: `netlify/functions/_shared/generation-repository.ts`（fill の `3` とコメント 3\|10）
- Modify: `src/features/billing/plus-cta.tsx`
- Modify: `src/features/billing/plan-settings-section.tsx`
- Modify: `compose.yaml`、`.env.example`
- Modify: ENV fixture / 文言 / `userDailyLimit: 3` / Plus `limit: 10` の unit 艦隊（下記一覧）
- Test: 同変更ファイルの既存テスト

**Interfaces:**
- Consumes: なし（本 Task が SSOT を改訂する）
- Produces: `FREE_SUCCESS_PER_DAY === 1`、`FREE_SUCCESS_PER_DAY_ENV === "1"`、`planQuota.plus.successPerDay === 5`、`planQuota.defense.maxSuccessPerDay === 5`、`PLUS_HARD_LIMIT_COPY` が「1 日最大 5 回」を含む。後続 Task の Functions は `limitsForPlan` 経由で 1|5 を `p_user_limit` に送る。

- [ ] **Step 1: 失敗するロックテストを書く**

`shared/contracts/plan-quota.test.ts` の期待を先に 1/5 にする（実装はまだ 3/10）。

```ts
    expect(planQuota.free).toEqual({
      successPerDay: 1,
      attemptsPerDay: 6,
      shortWindowLimit: 4,
      shortWindowSeconds: 600,
    });
    expect(planQuota.plus).toEqual({
      successPerDay: 5,
      attemptsPerDay: 20,
      shortWindowLimit: 8,
      shortWindowSeconds: 600,
    });
    expect(planQuota.defense).toEqual({
      maxSuccessPerDay: 5,
      maxAttemptsPerDay: 20,
      maxShortWindow: 8,
      maxFlyerSuccessPerWeek: 2,
      maxFlyerTriesPerWeek: 6,
    });
```

`releaseQuota` 期待も `userDailySuccessLimit: 1` にする。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/plan-quota.test.ts`

Expected: FAIL。`successPerDay` が 3/10 のまま。

- [ ] **Step 3: 最小実装（SSOT）**

`shared/contracts/plan-quota-constants.mjs`:

```js
/** Free 日次成功枠（USER_DAILY_AI_LIMIT）。 */
export const FREE_SUCCESS_PER_DAY = 1;
export const FREE_SUCCESS_PER_DAY_ENV = "1";
```

`shared/contracts/plan-quota.ts` の Plus のみ:

```ts
const plusQuota = {
  successPerDay: 5,
  attemptsPerDay: 20,
  shortWindowLimit: 8,
  shortWindowSeconds: FREE_SHORT_WINDOW_SECONDS,
} as const;
```

コメントの「3|10」があれば「1|5」に直す。defense は `plusQuota.successPerDay` 参照のまま触らない。

- [ ] **Step 4: ロックテストが通ることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/plan-quota.test.ts`

Expected: PASS。

- [ ] **Step 5: repository の fill リテラルを直す（U-I4。typecheck 阻塞）**

`netlify/functions/_shared/generation-repository.ts` はすでに `planQuota` を import している。`parseRequestPayload(..., 3)` を次に置換する（裸の `1` 禁止）。

```ts
            const terminal = parseRequestPayload(
              await rpc("finalize_ai_generation_failure", {
                p_request_id: lookup.requestId,
                p_failure_code: "quality_mode_requires_plus",
                p_retry_at: null,
              }),
              // 降格後は Free 投影。欠落時のみ埋める（S11: 未知 plan への fail-open ではない）
              planQuota.free.successPerDay,
            );
```

コメント「planQuota の 3|10 リテラル」を「1|5」へ。

- [ ] **Step 6: 文言を planQuota から組み立てる**

`src/features/billing/plus-cta.tsx`:

```ts
import { planQuota } from "@shared/contracts/plan-quota";

/** Free 硬上限時の固定コピー（L10-1）。テスト exact 一致。 */
export const PLUS_HARD_LIMIT_COPY =
  `Plus なら 1 日最大 ${planQuota.plus.successPerDay} 回まで作成できます`;
```

`src/features/billing/plan-settings-section.tsx` に `import { planQuota } from "@shared/contracts/plan-quota";` を足し:

```tsx
<p>こんだて日和 Plus なら、1 日最大 {planQuota.plus.successPerDay} 回まで献立を作れます。</p>
```

`shared/copy/plan-tier.test.ts` の入力と期待を `Plusでは1日最大5回まで作成できます。` にする（関数は数値を書き換えない。exact 固定を製品に合わせるだけ）。

- [ ] **Step 7: factories の success remaining（U-I3）**

`shared/testing/factories.ts` の **success** 2 箇所だけ:

```ts
success: { consumed: 0, limit: releaseQuota.userDailySuccessLimit, remaining: 1 },
```

shortWindow の `remaining: 2`（limit 4）と quality `limit: 3` は触るな。

- [ ] **Step 8: generation.test.ts の非製品 5 を逆転させる**

1. `it("rejects success limit outside 3|10")` → `outside 1|5`。payload の `limit: 5, remaining: 5` を `limit: 10, remaining: 10` にする（10 が非製品）。
2. `it("rejects the retired 5/12 daily limits")` の success `limit: 5` を `limit: 10` にする（attempts `limit: 12` は現行どおり退役）。タイトルは `retired 10/12`。
3. Plus `userDailyLimit: 10, remaining: 7` を `userDailyLimit: 5, remaining: 3` にする。テスト名の 10 も 5 へ。
4. `remaining: 11` / `userDailyLimit: 10` の拒否は `remaining: 6` / `userDailyLimit: 5`（defense max 5 超過）。
5. 「非製品 limit（例: 5）」ブロックを `userDailyLimit: 10` と `userDailyLimit: 3` の両方で拒否する。
6. Plus usage `limit: 10 as const, remaining: 10` を 5/5 にする。
7. `userDailyLimit: 3`（678 行付近）を `planQuota.free.successPerDay` または `1` に。

- [ ] **Step 9: ENV / compose**

- `compose.yaml`: `USER_DAILY_AI_LIMIT: "1"`
- `.env.example`: `USER_DAILY_AI_LIMIT=1`
- `tests/tooling/compose.test.mjs`: `'USER_DAILY_AI_LIMIT: "1"'`
- `scripts/preflight-production.test.mjs`: `USER_DAILY_AI_LIMIT: "1"`
- `netlify/functions/_shared/env.test.ts`: fixture `"1"`。`it.each` の拒否に `["USER_DAILY_AI_LIMIT", "3"]` を追加（`"5"` は ENV として今も不正なので残す）
- `netlify/functions/_shared/openrouter.test.ts`: `"1"`
- `netlify/functions/_shared/generation-adversarial.integration.test.ts`: `"1"`

- [ ] **Step 10: unit 艦隊の機械置換**

成功枠の 3/10 だけ。品質 3・試行 6・短時間 4 は置換しない。

`userDailyLimit: 3` → `userDailyLimit: 1`（`3 as const` も `1 as const`）対象:

- `src/app/accessibility.test.tsx`
- `netlify/functions/_tests/billing-portal.test.ts`
- `netlify/functions/_tests/billing-checkout.test.ts`
- `netlify/functions/_tests/generate-menu.test.ts`
- `netlify/functions/_tests/generate-dish.test.ts`
- `netlify/functions/_shared/generation-repository.test.ts`
- `netlify/functions/_shared/generation-service.test.ts`
- `netlify/functions/_shared/billing-webhook.test.ts`
- `src/features/generation/components/generation-status-panel.test.tsx`
- `src/features/generation/model/reconcile-terminal-pending.test.ts`
- `src/features/generation/model/pending-generation.test.ts`
- `src/features/generation/model/generation-machine.test.ts`
- `src/features/generation/hooks/use-resumable-pending-after-reconcile.test.tsx`
- `src/features/generation/hooks/use-generation-recovery.test.tsx`
- `src/features/generation/pages/generation-page.test.tsx`
- `src/features/generation/api/generation-api.test.ts`
- `src/features/history/hooks/use-regeneration.test.tsx`
- `src/features/planner/planner-route.test.tsx`

Plus 成功 10 → 5（attempts 20 / short 8 は残す）:

- `netlify/functions/_shared/billing-entitlement.test.ts` の `successPerDay: 10` → `5`
- `netlify/functions/_shared/generation-repository.test.ts` の `p_user_limit: 10` → `5`、`user_daily_limit: 10` → `5`
- `netlify/functions/_tests/usage-today.test.ts` の `p_user_limit: 3` → `1`、Plus `{ consumed: 1, limit: 10, remaining: 9 }` → `{ consumed: 1, limit: 5, remaining: 4 }`。retired success limit 5 の拒否テストは retired 10 に。
- `src/features/generation/hooks/use-usage-today.test.tsx` の `limit: 10, remaining: 10` → `5, 5`
- `src/features/generation/components/generation-status-panel.test.tsx` の `{ consumed: 10, limit: 10, remaining: 0 }` → `{ consumed: 5, limit: 5, remaining: 0 }`
- `src/shared/types/database.test.ts` の `p_user_limit: 3` → `1`

文言テスト:

- `generation-status-panel.test.tsx` / `planner-wizard.test.tsx` / `regeneration-sheet.test.tsx` の `/Plus なら 1 日最大 10 回/` を `/Plus なら 1 日最大 5 回/` に。

- [ ] **Step 11: スキャンして取りこぼしを潰す**

ホストで（Docker 不要）:

```bash
rg -n 'userDailyLimit:\s*3\b|p_user_limit:\s*3\b|p_user_limit:\s*10\b|successPerDay:\s*10\b|USER_DAILY_AI_LIMIT:\s*"3"|USER_DAILY_AI_LIMIT=3|1 日最大 10|1日最大10' --glob '!docs/archive/**' --glob '!docs/superpowers/**'
```

ヒットしてよいのは歴史 spec / 本計画 / 本設計だけ。`docs/superpowers/specs` の他ファイル（週献立・収益化判断）は編集しない。

success remaining の `remaining: 2` は factories の **success** に残っていてはいけない。shortWindow の `remaining: 2` は残ってよい。

- [ ] **Step 12: 検証**

Run: `docker compose run --rm --no-deps app npm run format:check`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/plan-quota.test.ts shared/contracts/generation.test.ts shared/copy/plan-tier.test.ts src/features/billing/plus-cta.test.tsx src/features/billing/plus-landing-page.test.tsx netlify/functions/_shared/env.test.ts netlify/functions/_shared/billing-entitlement.test.ts netlify/functions/_shared/generation-repository.test.ts tests/tooling/compose.test.mjs scripts/preflight-production.test.mjs`

Expected: すべて PASS。

続けて全 unit（SQL 不要）:

Run: `docker compose run --rm --no-deps app npx vitest run`

Expected: PASS。失敗したら Step 10 の取りこぼし。

- [ ] **Step 13: Commit**

```bash
git add shared/contracts/plan-quota-constants.mjs shared/contracts/plan-quota.ts shared/contracts/plan-quota.test.ts shared/testing/factories.ts shared/contracts/generation.test.ts shared/copy/plan-tier.test.ts netlify/functions/_shared/generation-repository.ts netlify/functions/_shared/env.test.ts netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/billing-entitlement.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/billing-webhook.test.ts netlify/functions/_tests src/features/billing/plus-cta.tsx src/features/billing/plan-settings-section.tsx src/features compose.yaml .env.example tests/tooling/compose.test.mjs scripts/preflight-production.test.mjs src/app/accessibility.test.tsx src/shared/types/database.test.ts
```

変更したテストファイルが上に無いものは `git add` に足す。`git status` で Task 1 範囲外（SQL / e2e / 運用文書）を混ぜない。

```bash
git commit -m "feat: 日次献立の成功枠を Free 1 / Plus 5 にする"
```

---

### Task 2: SQL 許可リストとスナップショット CHECK

**Files:**
- Create: `supabase/migrations/20260908120000_daily_success_quota_1_5.sql`
- Create: `supabase/tests/database/daily_success_quota_1_5.test.sql`
- Modify: `supabase/tests/database/plan_aware_quota.test.sql`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Modify: `supabase/tests/database/ai_control_and_quota_races.test.sql`
- Modify: `supabase/tests/database/quality_mode_reserve.test.sql`（`10, 20, 8` のみ。`success_count = 3` は触るな）
- Modify: `supabase/tests/database/quality_monthly_retry_and_usage_stale.test.sql`
- Modify: `supabase/tests/database/user_feedback.test.sql`
- Modify: `supabase/tests/database/identity_daily_quota.test.sql`（任意。不正 identity の `3, 6, 4` を `1, 6, 4` にしてもよい）

**Interfaces:**
- Consumes: Task 1 の `planQuota` 1|5（Functions が送る値）。本 Task は SQL 側を一致させる。
- Produces: live `reserve_ai_generation` / `get_ai_usage_today` / `get_ai_generation_status` が `p_user_limit in (1, 5)` のみ受理。`quota_success_limit` CHECK が 1 本 `in (1, 3, 5, 10)`、DEFAULT 1。

- [ ] **Step 1: 失敗する pgTAP を書く**

`supabase/tests/database/daily_success_quota_1_5.test.sql` を新設する。現行 DB（旧 CHECK / 旧 whitelist）では RED。

```sql
\ir 000_helpers.sql

begin;
select plan(11);

create extension if not exists pgtap with schema extensions;

select tests.isolate_local_ai_global_usage();

select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'daily-success-quota-1-5@example.invalid'
);

-- CHECK は 1 本だけ in (1, 3, 5, 10)
select is(
  (
    select count(*)::integer
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private'
      and t.relname = 'ai_generation_requests'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%quota_success_limit%'
  ),
  1,
  'quota_success_limit has exactly one CHECK'
);

select ok(
  (
    select pg_get_constraintdef(c.oid) ilike '%(1, 3, 5, 10)%'
       or pg_get_constraintdef(c.oid) ilike '%(1,3,5,10)%'
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private'
      and t.relname = 'ai_generation_requests'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%quota_success_limit%'
  ),
  'quota_success_limit CHECK allows 1, 3, 5, 10'
);

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'ai_generation_requests'
      and column_name = 'quota_success_limit'
  ),
  '1',
  'quota_success_limit default is 1'
);

-- Plus 5 受理
select lives_ok(
  $$select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000001'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('c', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    5, 20, 8, 20, false, false, 180, now()
  )$$,
  'reserve accepts Plus limits 5/20/8'
);

-- 旧 Free 3 / 旧 Plus 10 は mismatch
select throws_ok(
  $$select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000003'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('d', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    3, 6, 4, 20, false, false, 180, now()
  )$$,
  '22023',
  'release_quota_mismatch',
  'reserve rejects retired p_user_limit 3'
);

select throws_ok(
  $$select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000010'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('e', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    10, 20, 8, 20, false, false, 180, now()
  )$$,
  '22023',
  'release_quota_mismatch',
  'reserve rejects retired p_user_limit 10'
);

select finish();
rollback;
```

`lives_ok` の Plus reserve は source_menu が無いと別エラーになり得る。その場合は `plan_aware_quota.test.sql` と同じメニュー fixture 手順を同ファイル先頭にコピーする（`plan_aware_quota.test.sql` の Plus 受理ケースを正本にする）。CHECK / DEFAULT / throws_ok(3) / throws_ok(10) は reserve なしでも成立するので残す。

歴史 3|10 と不正 2|4 の INSERT は、既存 `quality_monthly_retry_and_usage_stale.test.sql` 117–134 行の列リストを使い `quota_success_limit` だけ 1 / 5 / 3 / 10 / 2 / 4 に変えた `lives_ok` / `throws_ok` を同じファイルに足す。`plan()` の数をテスト数に合わせる。

- [ ] **Step 2: 新テストが失敗することを確認する**

Run: `docker compose --profile test run --rm db-test`

Expected: FAIL。`daily_success_quota_1_5` が旧 CHECK / 旧 whitelist で落ちる（throws_ok(10) が lives、CHECK が `(3, 10)`）。

- [ ] **Step 3: migration を書く（U-C1 / U-I1）**

`supabase/migrations/20260908120000_daily_success_quota_1_5.sql` を新設。古い migration は編集しない。

先頭（discovery drop → named CHECK → DEFAULT）:

```sql
-- 日次成功枠 Free 1 / Plus 5。p_user_limit allowlist と snapshot CHECK のみ改訂。
-- identity CHECK <= 10 は維持。attempt/short は触らない。

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private'
      and t.relname = 'ai_generation_requests'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%quota_success_limit%'
  loop
    execute format(
      'alter table private.ai_generation_requests drop constraint %I',
      r.conname
    );
  end loop;
end $$;

alter table private.ai_generation_requests
  add constraint ai_generation_requests_quota_success_limit_check
    check (quota_success_limit in (1, 3, 5, 10));

alter table private.ai_generation_requests
  alter column quota_success_limit set default 1;
```

続けて 3 関数を **本体だけ** 載せる。ファイルを丸コピーしない。

| 関数 | コピー元（行） | 同じファイルで触るなもの |
| --- | --- | --- |
| `reserve_ai_generation` | `20260831120000_novelty_preference.sql` 140–608 | `save_generation_draft`、`get_ai_generation_submission_snapshot`。`20260808` / `20260729` の stale reserve |
| `get_ai_usage_today` | `20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql` 500–715 | 同ファイル 25 行の stale reserve。`20260729` の usage |
| `get_ai_generation_status` | `20260729140000_plan_aware_quota.sql` 573–619 | 同ファイルの stale reserve / usage |

各本体で次の 1 行だけを変える。

```
if p_user_limit is null or p_user_limit not in (3, 10)
```

↓

```
if p_user_limit is null or p_user_limit not in (1, 5)
```

`p_attempt_limit in (6, 20)`、`p_short_window_limit in (4, 8)`、usage の quality 3 / flyer 2/6、`least(consumed, p_user_limit)`、reserve の `novelty_preference` 写しはバイト一致のまま。

GRANT は `CREATE OR REPLACE` が維持する。再 GRANT は不要。

- [ ] **Step 4: 既存 pgTAP 艦隊を 1|5 に合わせる（U-I2）**

機械規則:

- `3, 6, 4` → `1, 6, 4`（成功枠だけ。試行 6・短時間 4 は残る）
- `10, 20, 8` → `5, 20, 8`

`plan_aware_quota.test.sql`:

- Plus 受理の `10, 20, 8` → `5, 20, 8`。説明 `'reserve_ai_generation accepts Plus limits 5/20/8'`
- 拒否 fixture の `5, 6, 4` を **やめる**。代わりに `3, 6, 4` と（別テストで）`10, 20, 8` を `throws_ok` + `'release_quota_mismatch'`。説明 `'reserve rejects p_user_limit outside 1|5'`
- スナップショット `quota_success_limit = 10` → `= 5`
- usage の `10, 20, 8` → `5, 20, 8`
- `select plan(13)` はテストを増やしたら数を合わせる

`ai_control_and_quota.test.sql` の Free 残数:

- `get_ai_usage_today(..., 3, 6, 4, ...)` → `1, 6, 4`
- `consumed + remaining <> 3` → `<> 1`
- 空台帳 `remaining <> 3` / `limit <> 3` → `1`
- 「成功 2 + 予約 1」は limit 1 では製品超過。`success_count = 1, reserved_count = 0` にし、consumed 期待 1、remaining 0。または reserved-only（success 0 / reserved 1）だけ残して 2+1 ブロックを削除する。attempt の `<> 6` は触るな。

`quality_mode_reserve.test.sql` の `10, 20, 8` のみ 5。`success_count = 3`（品質台帳）は残す。

`quality_monthly_retry_and_usage_stale.test.sql` の `10, 20, 8` と remaining 期待 10 を 5 に。品質 limit 3 は残す。

`user_feedback.test.sql` の `3, 6, 4` → `1, 6, 4`。

`ai_control_and_quota_races.test.sql` の `3, 6, 4` → `1, 6, 4`。

確認:

```bash
rg -n '3, 6, 4|10, 20, 8|p_user_limit not in \(3, 10\)|quota_success_limit in \(3, 10\)' supabase/tests/database supabase/migrations/20260908120000_daily_success_quota_1_5.sql
```

新 migration に `(3, 10)` の whitelist が残っていたら失敗。テストの `3, 6, 4` / `10, 20, 8` は 0 件。品質の `success_count = 3` は残ってよい。

- [ ] **Step 5: db:test 全体が通ることを確認する**

Run: `docker compose --profile test run --rm db-test`

Expected: PASS（新 migration 適用後の関数と CHECK を検証。scoped 実行だけで完了としない）。

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260908120000_daily_success_quota_1_5.sql supabase/tests/database/daily_success_quota_1_5.test.sql supabase/tests/database/plan_aware_quota.test.sql supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/ai_control_and_quota_races.test.sql supabase/tests/database/quality_mode_reserve.test.sql supabase/tests/database/quality_monthly_retry_and_usage_stale.test.sql supabase/tests/database/user_feedback.test.sql supabase/tests/database/identity_daily_quota.test.sql
```

```bash
git commit -m "fix: 日次成功枠の SQL 許可リストを 1 と 5 にする"
```

---

### Task 3: 運用文書・e2e・リリース手順

**Files:**
- Modify: `README.md`（枠表 3/10、Webhook 後の「枠 10」、スモーク「成功枠 10」。`USER_DAILY_AI_LIMIT` キーは新設しない）
- Modify: `docs/deployment/netlify.md`（`USER_DAILY_AI_LIMIT` を `1`。リリース順を追記）
- Modify: `docs/deployment/README.md`（`USER_DAILY_AI_LIMIT=3` → `1`。ENV 先行禁止）
- Modify: `e2e/specs/billing-plus.spec.ts`

**Interfaces:**
- Consumes: Task 1 の `PLUS_HARD_LIMIT_COPY`（「1 日最大 5 回」）と usage `limit: 5`
- Produces: 運用者が新デプロイと `USER_DAILY_AI_LIMIT=1` を同時にすること。e2e が 5 を見る。

- [ ] **Step 1: e2e 期待を 5 に変える（まだ mock が 10 なら RED）**

`e2e/specs/billing-plus.spec.ts`:

```ts
/** usage/today を Plus 枠（success limit 5）に見せる mock（webhook 投影後の UI 相当）。 */
```

```ts
          success: { consumed: 0, limit: 5, remaining: 5 },
```

quality.day `limit: 3` は触るな。

```ts
  await expect(page.getByText(/1 日最大 5 回まで/u)).toBeVisible({ timeout: 15_000 });
```

コメントの「1 日最大 10 回」/ `success limit 10` も 5 に。テスト名 `success limit 10` も 5。

- [ ] **Step 2: 運用文書**

`README.md` 表:

```
| 成功生成 / 利用者 / JST 日     | 1                  | **5**                                               |
```

「枠 10 / 品質 / チラシ」→「枠 5 / 品質 / チラシ」。スモーク「成功枠 10」→「成功枠 5」。

`docs/deployment/netlify.md`:

```
| `USER_DAILY_AI_LIMIT` | `1` |
```

同じ節にリリース順を短く書く:

- 新コードと `USER_DAILY_AI_LIMIT=1` を同時にする。稼働中の旧デプロイへ先に `env:set` しない。
- ゲートは保護 runner の preflight とランタイム `parseServerEnv` の二段。`netlify.toml` の `build` は preflight を呼ばない。
- SQL `(1, 5)` と Functions の 1|5 送信は同一メンテ窓。片側だけだと reserve / status は 500 `release_quota_mismatch`、usage-today は 500 `request_failed`。
- ローカル正本は `compose.yaml` の `"1"`。`.env` だけでは app に入らない。

`docs/deployment/README.md` の `USER_DAILY_AI_LIMIT=3` を `1` にする。

- [ ] **Step 3: 検証**

Run: `docker compose run --rm --no-deps app npm run format:check`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run typecheck`

e2e はホスト:

Run: `./scripts/run-e2e.sh`

Expected: `billing-plus.spec.ts` の「1 日最大 5 回」と Plus usage mock が PASS。フルスイートが既存どおり通る。エージェント環境で e2e を回せない場合は人間にコマンドを渡し、本 Task を未検証として報告する（偽 GREEN にしない）。

- [ ] **Step 4: Commit**

```bash
git add README.md docs/deployment/netlify.md docs/deployment/README.md e2e/specs/billing-plus.spec.ts
```

```bash
git commit -m "docs: 日次成功枠 1/5 の運用手順と E2E を更新する"
```

---

## Spec coverage（自己レビュー）

| spec | Task |
| --- | --- |
| Free 1 / Plus 5、試行据え置き | 1, 2 |
| U-C1 discovery drop CHECK | 2 |
| U-I1 関数単位コピー | 2 |
| U-I2 pgTAP 拒否 3\|10、db:test 全体 | 2 |
| U-I3 factories / 非製品 5 逆転 / スキャン | 1 |
| U-I4 repository fill | 1 |
| U-I5 ENV 二段・compose 正本・同時デプロイ | 1, 3 |
| U-I6 片側適用の HTTP | 3（文書）。SQL 本体は 2 |
| 文言 5 回 | 1, 3 |
| 歴史 3\|10 非改変、identity CHECK 10 | 2（触らない） |
| 品質 3 / flyer 2/6 非改変 | 1, 2 の「触るな」 |
| `database.generated.ts` 非手編集 | 全 Task |
| エージェント deploy 禁止 | 3 は手順を書くだけ |

I-05（Plus 当日 6–10 / least cap）は spec 受け入れの任意文。実装変更なし。
