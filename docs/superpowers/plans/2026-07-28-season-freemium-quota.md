# 季節・お気に入り・無料版文言・quota 強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship seasonal AI prompt bias, history favorites-only filter, freemium 「無料版は」 copy, email-HMAC identity daily quotas (delete-recreate resistant), and local-only `AI_QUOTA_DISABLED`, per the approved design.

**Architecture:** Pure shared helpers (`shared/copy`, `shared/season`) feed UI and Function prompt builders. Daily success/attempt ledgers move from `user_id` CASCADE tables to `private.ai_identity_*` keyed by server-only HMAC of normalized email; short-window stays per user; global stays global. Delete-account releases processing reservations then Auth-deletes; a BEFORE DELETE trigger is the second line of defense. Local quota skip is `ServerEnv.aiQuotaDisabled` plus `personal_quota_disabled` on the request row so finalize does not require reservation.

**Tech Stack:** Node 24, TypeScript strict, Zod, Vitest/RTL, Netlify Functions, Postgres/pgTAP, React 19, Playwright, Docker Compose `app` / `db-test` / `migrate`.

**Spec (authoritative):** `docs/superpowers/specs/2026-07-28-season-freemium-quota-design.md` (Approved). Do not re-derive L1–L7.

## Global Constraints

- Worktree: `/home/dev/projects/kondate/.worktrees/feat-season-freemium-quota`, branch `feat/season-freemium-quota`.
- Node/npm via `docker compose run --rm --no-deps app <cmd>` (one tool call per command; no `&&` chaining for Docker/git).
- User-facing copy + code comments: Japanese. Identifiers/tests: English.
- Never log email, identity_key, prompts, allergies free text, raw AI output.
- No `VITE_` secrets. No hand-edit of `package-lock.json`, `infra/supabase/**`, `src/shared/types/database.generated.ts` (use `npm run db:types` after migrations).
- No `git push`, no PR, no production deploy.
- Conventional Commit messages in Japanese.
- Quota product limits (Plan 8): success 3/day, attempts 6/day, short 4/600s, global 20.
- isLocal: `SERVER_SITE_ORIGIN === "http://127.0.0.1:5173"`.
- identity_key: lowercase hex HMAC-SHA256, `^[a-f0-9]{64}$`.
- Email normalize: NFKC → trim → lower.
- `privacyNoticeVersion` becomes `2026-07-28.v1`.
- Browser may import pure `@shared/*` only (no `node:crypto` in shared modules used by browser).

## File Structure

```text
shared/copy/free-tier.ts (+ .test.ts)
shared/season/jst-season.ts (+ .test.ts)
shared/contracts/domain.ts          # privacyNoticeVersion bump
src/features/privacy/privacy-copy.ts
src/features/account/delete-account-dialog.tsx (+ settings section)
src/features/history/pages/history-page.tsx (+ tests)
src/features/planner/components/review-step.tsx (+ tests)
src/features/generation/components/generation-status-panel.tsx (+ tests)
src/features/history/components/regeneration-sheet.tsx (+ tests)
netlify/functions/_shared/generation-prompt.ts (+ regen + tests)
netlify/functions/_shared/auth.ts   # requireUserWithEmail
netlify/functions/_shared/quota-identity.ts  # normalize + HMAC
netlify/functions/_shared/env.ts    # QUOTA_IDENTITY_HMAC_KEY, AI_QUOTA_DISABLED, isLocal, aiQuotaDisabled
netlify/functions/delete-account.ts
netlify/functions/usage-today.ts
netlify/functions/_shared/generation-repository.ts
supabase/migrations/YYYYMMDDHHMMSS_identity_daily_quota.sql
supabase/tests/database/...
scripts/generate-local-secrets.mjs / .env.example
docs/runbooks/account-deletion.md (if present)
docs/testing/database-access-matrix.md
e2e/specs/...
```

---

### Task 1: free-tier copy helper + JST season util

**Files:**
- Create: `shared/copy/free-tier.ts`
- Create: `shared/copy/free-tier.test.ts`
- Create: `shared/season/jst-season.ts`
- Create: `shared/season/jst-season.test.ts`

**Interfaces:**
- Produces:
  - `formatFreeTierQuotaCopy(body: string): string`
  - `type JstSeason = "spring" | "summer" | "autumn" | "winter"`
  - `type SeasonContext = { month: number; season: JstSeason; labelJa: "春" | "夏" | "秋" | "冬" }`
  - `getJstSeasonContext(now: Date): SeasonContext` — month/season from **Asia/Tokyo** calendar fields of `now`

- [ ] **Step 1: Write failing tests**

`shared/copy/free-tier.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatFreeTierQuotaCopy } from "./free-tier.js";

describe("formatFreeTierQuotaCopy", () => {
  it("prefixes 無料版は", () => {
    expect(formatFreeTierQuotaCopy("本日あと3回作成できます")).toBe(
      "無料版は本日あと3回作成できます",
    );
  });
  it("does not double-prefix", () => {
    expect(formatFreeTierQuotaCopy("無料版は本日あと1回作成できます")).toBe(
      "無料版は本日あと1回作成できます",
    );
  });
  it("trims then prefixes", () => {
    expect(formatFreeTierQuotaCopy("  あと0回  ")).toBe("無料版はあと0回");
  });
  it("returns empty for blank", () => {
    expect(formatFreeTierQuotaCopy("   ")).toBe("");
  });
});
```

`shared/season/jst-season.test.ts` — use UTC instants that are unambiguous in JST:
```ts
import { describe, expect, it } from "vitest";
import { getJstSeasonContext } from "./jst-season.js";

describe("getJstSeasonContext", () => {
  it("maps July JST to summer", () => {
    // 2026-07-15 12:00 JST = 2026-07-15T03:00:00.000Z
    expect(getJstSeasonContext(new Date("2026-07-15T03:00:00.000Z"))).toEqual({
      month: 7,
      season: "summer",
      labelJa: "夏",
    });
  });
  it("maps March 1 JST to spring", () => {
    expect(getJstSeasonContext(new Date("2026-02-28T15:00:00.000Z"))).toEqual({
      month: 3,
      season: "spring",
      labelJa: "春",
    });
  });
  it("maps February JST to winter", () => {
    expect(getJstSeasonContext(new Date("2026-02-15T03:00:00.000Z"))).toEqual({
      month: 2,
      season: "winter",
      labelJa: "冬",
    });
  });
  it("maps December JST to winter", () => {
    expect(getJstSeasonContext(new Date("2026-12-01T03:00:00.000Z"))).toEqual({
      month: 12,
      season: "winter",
      labelJa: "冬",
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (missing modules)**

```bash
docker compose run --rm --no-deps app npx vitest run shared/copy/free-tier.test.ts shared/season/jst-season.test.ts
```

- [ ] **Step 3: Implement**

`shared/copy/free-tier.ts`:
```ts
/** 制限説明文の文頭に「無料版は」を付ける。二重付与しない。 */
export function formatFreeTierQuotaCopy(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.startsWith("無料版は")) return trimmed;
  return `無料版は${trimmed}`;
}
```

`shared/season/jst-season.ts`:
```ts
export type JstSeason = "spring" | "summer" | "autumn" | "winter";

export type SeasonContext = {
  month: number;
  season: JstSeason;
  labelJa: "春" | "夏" | "秋" | "冬";
};

const labelBySeason: Record<JstSeason, SeasonContext["labelJa"]> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

function jstMonth(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
  }).formatToParts(now);
  const month = parts.find((p) => p.type === "month")?.value;
  if (month === undefined) throw new Error("jst_month_unavailable");
  return Number(month);
}

function seasonForMonth(month: number): JstSeason {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** JST カレンダー月に基づく季節。生成の権威ある now は Function 側で渡す。 */
export function getJstSeasonContext(now: Date): SeasonContext {
  const month = jstMonth(now);
  const season = seasonForMonth(month);
  return { month, season, labelJa: labelBySeason[season] };
}
```

- [ ] **Step 4: Re-run tests — PASS**
- [ ] **Step 5: Commit** `feat: 無料版文言ヘルパとJST季節ユーティリティを追加`

---

### Task 2: 履歴「お気に入りだけを表示」トグル

**Files:**
- Modify: `src/features/history/pages/history-page.tsx`
- Modify: `src/features/history/pages/history-page.test.tsx`

**Interfaces:**
- Consumes: `HistoryGroup.representative.isFavorite` from `group-history.ts`
- Produces: session-only `favoritesOnly` switch UI

- [ ] **Step 1: Write/extend failing tests** in `history-page.test.tsx`:
  - With mixed favorite groups, switch ON shows only favorites
  - Filtered empty shows「お気に入りがありません」and button「すべての献立を表示」turns filter off
  - Switch has `role="switch"`, `min-h-11`, label「お気に入りだけを表示」
  - When `groups.length === 0`, switch is not shown (existing empty)

- [ ] **Step 2: Run focused tests — FAIL**
- [ ] **Step 3: Implement** in `HistoryPageContent`:
  - `const [favoritesOnly, setFavoritesOnly] = useState(false)`
  - When `groups.length > 0`, render switch before list
  - `const visible = favoritesOnly ? groups.filter((g) => g.representative.isFavorite) : groups`
  - If `favoritesOnly && visible.length === 0`, show empty card + button that sets favoritesOnly false
  - Else list `visible` as today

- [ ] **Step 4: PASS tests**
- [ ] **Step 5: Commit** `feat: 履歴にお気に入りだけ表示トグルを追加`

---

### Task 3: 生成プロンプト + 確認UI に季節

**Files:**
- Modify: `netlify/functions/_shared/generation-prompt.ts`
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`
- Modify: `netlify/functions/_shared/regeneration-prompt.ts` and/or callers that build messages (ensure whole/dish paths include season)
- Modify: `src/features/planner/components/review-step.tsx` (+ test)

**Interfaces:**
- Consumes: `getJstSeasonContext` from `@shared/season/jst-season`
- Produces: `GenerationPromptDto.seasonContext`; system CORE season sentence; UI line

- [ ] **Step 1: Failing tests**
  - Prompt builder with fixed `now` via optional param **or** inject season into build path: prefer adding optional `now?: Date` defaulting to `new Date()` on the public build entry used by generation-service (minimal: compute inside `buildBaseGenerationMessages` with injectable clock only if already patterned; else test month by mocking — **preferred design**: export `buildBaseGenerationMessages(context, options?: { now?: Date })` and pass from service as `new Date()`).
  - Expect system content includes constraint-respecting season sentence and user payload JSON includes `"season":"summer"` for July.
  - Regeneration messages also include seasonContext.
  - `review-step` shows `いまは夏（7月）の食材を優先して提案します` when rendering with mocked season **or** real `getJstSeasonContext(new Date())` — for stable test, pass optional prop `seasonContext` defaulting to `getJstSeasonContext(new Date())`.

- [ ] **Step 2: FAIL then implement**
  - Append to `GENERATION_SYSTEM_PROMPT_CORE` (end):  
    `入力のseasonContextは日本の現在月・季節です。制約（アレルギー・安全・must_use・品数・時間）を満たす範囲で旬の食材や季節感を優先してください。季節のために制約を破らないでください。`
  - Add `seasonContext` to every `GenerationPromptDto` built for base/regen.
  - **Do not** accept season from client integrity/command.
  - review-step: one status line near usage copy.

- [ ] **Step 3: PASS + commit** `feat: 献立生成プロンプトと確認UIに季節を反映`

---

### Task 4: 「無料版は」を制限説明 UI に適用

**Files:**
- Modify: `review-step.tsx`, `generation-status-panel.tsx`, `regeneration-sheet.tsx` and their tests
- Any failure UI that displays `issueMessages` for `user_daily_limit` | `user_attempt_limit` | `user_short_window_limit`

**Allowlist / denylist:** design Feature 2.1 / 2.2 exactly.

- [ ] **Step 1: Update tests** to expect `無料版は…` on remaining-count and blocker bodies; **not** on global congestion, loading, `成功回数には含まれません`.
- [ ] **Step 2: Wrap leaf strings** with `formatFreeTierQuotaCopy`.
- [ ] **Step 3: For short-window banner**, wrap the full composed sentence including datetime.
- [ ] **Step 4: PASS + commit** `feat: 利用回数表示に無料版は接頭を通す`

---

### Task 5: identity 日次 quota + delete pre-release + personal_quota_disabled

**This is the critical path.** Spec Feature 3–4 SQL semantics.

**Files (expected):**
- Create: `supabase/migrations/<timestamp>_identity_daily_quota.sql`
- Create/update: `supabase/tests/database/identity_daily_quota.test.sql` (or extend `ai_control_and_quota.test.sql`)
- Modify: all RPCs that touch `ai_user_daily_usage` / `ai_user_daily_external_attempts` (inventory in design §3.4)
- Create: `netlify/functions/_shared/quota-identity.ts` (+ test)
- Modify: `auth.ts` → add `requireUserWithEmail`
- Modify: `env.ts` → `QUOTA_IDENTITY_HMAC_KEY` (required always); prepare `AI_QUOTA_DISABLED` parse but full local gate wiring can complete in Task 6 — **still add key + identity path here**
- Modify: `generation-repository.ts`, `usage-today.ts`, generate handlers, `delete-account.ts`
- Modify: maintenance cleanup for 40-day identity purge
- Update: `docs/testing/database-access-matrix.md`, runbook if exists
- Run: `npm run db:types` after migration (via docker)

**Interfaces:**
- Produces:
  - `normalizeQuotaEmail(email: string): string`
  - `computeQuotaIdentityKey(secret: Uint8Array, email: string): string` // 64 hex lower
  - `requireUserWithEmail(request): Promise<{ userId, accessToken, email }>`
  - RPC `release_identity_and_global_for_user_processing(p_user_id uuid)` public wrapper, service_role only
  - Tables `private.ai_identity_daily_usage`, `private.ai_identity_daily_external_attempts`
  - Columns on `ai_generation_requests`: `identity_key`, `personal_quota_disabled`
  - Drop `private.ai_user_daily_usage`, `private.ai_user_daily_external_attempts`

**Implementation guidance (do not dual-write):**

1. Read latest definitions of `reserve_ai_generation`, finalize success, cleanup, `get_ai_usage_today` from migrations (including Plan 8 and later overrides). Produce a **new migration** that:
   - Creates identity tables with CHECK `<= 3` / `<= 6`
   - Adds request columns
   - Replaces function bodies to use `p_identity_key` / request.identity_key
   - Adds `p_quota_disabled boolean default false` to reserve/repair; when true: skip identity/short personal increments, set `personal_quota_disabled=true`, keep global/processing rules
   - Finalize success: if `personal_quota_disabled` then skip identity success accounting and **do not** raise `user_reservation_missing`
   - BEFORE DELETE trigger on `private.ai_generation_requests` releasing identity+global reserved
   - public SECURITY DEFINER wrappers granted to service_role only
   - Drop old user daily tables after functions no longer reference them
   - Maintenance: delete identity rows older than 40 JST days

2. Function side always computes identity_key; never trusts client.

3. delete-account: call release RPC then deleteUser.

4. pgTAP required cases from design Testing Strategy (delete while processing, identity survives user delete, same key shares limit, authenticated no EXECUTE).

5. secrets: update `scripts/generate-local-secrets.mjs` / `.env.example` for `QUOTA_IDENTITY_HMAC_KEY`.

- [ ] **Step 1: RED** — unit tests for quota-identity + requireUserWithEmail; sketch pgTAP expectations
- [ ] **Step 2: GREEN** — migration + TS wiring
- [ ] **Step 3: Verify** focused vitest; `docker compose run --rm migrate` if stack available; `docker compose --profile test run --rm db-test` for new tests (host, not inside app)
- [ ] **Step 4: Commit** `feat: identity日次quotaと削除時予約解放を導入`  
  (may split follow-up `fix:` if typegen separate)

---

### Task 6: AI_QUOTA_DISABLED env gate + usage-today projection

**Files:**
- Modify: `netlify/functions/_shared/env.ts` (+ tests)
- Wire `aiQuotaDisabled` into reserve call sites / repository
- usage-today full remaining when disabled
- preflight if present: reject prod misconfig
- Compose / e2e env: flag **off** by default

**Interfaces:**
- `ServerEnv.isLocal: boolean`
- `ServerEnv.aiQuotaDisabled: boolean` // true only if AI_QUOTA_DISABLED==="true" && isLocal
- Prod + true → throw at parse
- Invalid values (`1`, `yes`) → throw
- `VITE_AI_QUOTA_DISABLED` present → throw

- [ ] **Step 1–4:** TDD env tests, wire repository `p_quota_disabled: env.aiQuotaDisabled`, usage-today projection
- [ ] **Commit** `feat: ローカルAI枠無効化フラグを追加`

---

### Task 7: プライバシー・削除文言・privacyNoticeVersion

**Files:**
- `shared/contracts/domain.ts` → `privacyNoticeVersion = "2026-07-28.v1"`
- `src/features/privacy/privacy-copy.ts` — abuse-prevention identity retention
- `delete-account-dialog.tsx`, `account-settings-section.tsx`, login post-delete message
- Update all tests hardcoding `2026-07-26.v1`
- `docs/runbooks/account-deletion.md` if present

- [ ] **Step 1:** Grep `2026-07-26.v1` and update; fail tests then fix copy per design 3.5 matrix
- [ ] **Commit** `feat: 削除とプライバシーにidentity保持説明を追加`

---

### Task 8: E2E 更新と全体グリーン

**Files:**
- `e2e/specs/*` that assert quota strings, history, account deletion, privacy
- Fix any broken expectations for `無料版は`, favorites toggle, privacy version

**Verify (host / docker as AGENTS.md):**

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
# if DB changes:
docker compose --profile test run --rm db-test
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm run build
git diff --check
```

- [ ] Fix until green
- [ ] Commit `test: 季節・無料版・quota強化のE2Eを更新` and any `fix:` follow-ups

---

## Spec coverage checklist

| Design item | Task |
|-------------|------|
| Favorites toggle | 2 |
| Free-tier allowlist/denylist | 1, 4 |
| Season prompt + UI | 1, 3 |
| Identity tables + RPC | 5 |
| Delete pre-release + DELETE trigger | 5 |
| personal_quota_disabled finalize | 5–6 |
| AI_QUOTA_DISABLED / isLocal | 6 |
| Privacy version + delete copy | 7 |
| E2E | 8 |
| 40-day retention | 5 |
| requireUserWithEmail 503 closed | 5 |

## Execution

Use **subagent-driven-development**: one implementer per Task, review package, reviewer, verifier as per `SubAgents.md` / skill. Work only in the feature worktree. Continuous execution without pausing between tasks unless BLOCKED.
