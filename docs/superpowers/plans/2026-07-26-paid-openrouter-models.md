# 低価格有料 OpenRouter モデル導入 Implementation Plan

**Plan ID:** 8（handoff と progress で使用する数値 ID）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番の OpenRouter 利用を有料 allowlist（structured AND・単価上限・auto 禁止）に切り替え、利用上限を 3/6/20 に引き下げ、プライバシー説明 version を更新し、有料ベンチゲートを通過できる状態にする。

**Architecture:** モデル受理規則の正本を `scripts/openrouter-models-contract.mjs` に置き、`parseOpenRouterModels(value, { openRouterBaseUrl })` を env / verify / preflight の 3 鏡像で同一にする。mock 例外は exact mock base URL のみ。構造化は `structured_outputs` AND `response_format` を維持。クォータは `releaseQuota`・env ロック・SQL CHECK/RPC ハードコードを同時に 3/6/20 へ。privacy は単一 `privacyNoticeVersion` literal を上げ、旧同意を未同意扱いとする。

**Tech Stack:** TypeScript 5.9 / Zod 4 / Node 24 / Netlify Functions / Supabase Postgres 17 / Vitest / node:test / pgTAP / Playwright

**仕様書:** `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`

## Global Constraints

- Node.js は `>=24 <25` のみ。Node/npm は `docker compose run --rm --no-deps app ...` で実行し、コマンドを `&&` や `;` で連結しない。
- 実装は Task 1 → 5 の順。各 Task で RED → GREEN → 対象リファクタ → 独立検証 → 一次レビュー → 別 Reviewer 二次検証を完了してから次へ。
- **設計を再導出・簡略化しない。** 特に structured の **AND**、mock 信号は **OPENROUTER_BASE_URL exact mock のみ**、クォータ **3/6/20** と相互作用の意図、privacy **互換パーサなし**。
- 構造化: Models API の `supported_parameters` に `structured_outputs` **と** `response_format` の両方。片方だけでは拒否。
- 単価: `pricing.prompt` + `pricing.completion` を 1M 換算した和 `<= 0.5`（ちょうど 0.5 可）。request/cache 系は加算しない。欠落・非数値は fail-closed。
- ルーター拒否: 少なくとも `openrouter/auto`、`openrouter/free`、`openrouter/auto-beta`。
- exact mock URL: `http://openrouter-mock:8787/api/v1`（既存 `isExactLocalMockBaseUrl` と同一）。`SERVER_SITE_ORIGIN` / `isLocal` を mock 例外に使わない。
- 時間予算 20s / 50s / 180s と短期窓 4/600s は変更しない。
- UI 文言・コードコメント・コミットメッセージは日本語。識別子とテスト名は英語。TypeScript strict、`any` と未検査 cast を追加しない。
- handoff は `AGENTS.md` 形式。1 Task 完了ごとに write-once handoff を新規作成。
- 本番有効化は Task 5 の有料ベンチゲート合格後。キー total limit 未解消のまま「完了」としない。
- `acceptance-matrix.md` のテスト title 連動改訂は **Task 2 と同一コミット列**（matrix だけ先行禁止）。

## File Structure

| ファイル | 責務 |
| --- | --- |
| `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` | free-only / 旧クォータ文面を本設計へ整合 |
| `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md` | 状態を実装中へ（必要なら） |
| `scripts/openrouter-models-contract.mjs` | 有料+mock 規則の正本とフィクスチャ |
| `scripts/verify-openrouter-models.mjs` | parse + remote AND + 単価 |
| `scripts/verify-openrouter-models.test.mjs` | 契約・remote・単価テスト |
| `scripts/preflight-production.mjs` | 本番 parse 鏡像・quota exact |
| `scripts/preflight-production.test.mjs` | preflight 期待値 |
| `netlify/functions/_shared/env.ts` | `parseOpenRouterModels(value, ctx)`・quota ロック・global max 20 |
| `netlify/functions/_shared/env.test.ts` | パース・mock 例外・quota |
| `netlify/functions/_shared/openrouter.ts` | runtime ガード（有料正常、空/重複/model 所属は据え置き） |
| `netlify/functions/_shared/openrouter.test.ts` | runtime ガード回帰 |
| `netlify/functions/_shared/openrouter.smoke.test.ts` | opt-in 実費スモーク（:free 期待削除） |
| `shared/contracts/generation.ts` | `releaseQuota` 3/6、`issueMessages.user_daily_limit` |
| `netlify/functions/_shared/generation-service.ts` | 同文言鏡像 |
| `supabase/migrations/<new>_paid_quota_3_6_20.sql` | CHECK と RPC の 5/12/45 → 3/6/20 |
| `supabase/tests/database/ai_control_and_quota.test.sql` 等 | 上限値期待の更新 |
| `shared/contracts/domain.ts` | `privacyNoticeVersion` |
| `src/features/privacy/**` | 説明コピー・version 表示 |
| `docs/testing/acceptance-matrix.md` | 行 17–19 等 |
| `docs/deployment/netlify.md` / `docs/runbooks/openrouter.md` / `docs/testing/release-checklist.md` / `README.md` | 運用文書 |
| `scripts/benchmark-paid-openrouter-models.mjs` | Task 5 機械フィルタ + N=10 ゲート（任意の運用スクリプト） |
| `compose.yaml` / CI / secrets 生成 | quota 既定が触られていれば 3/6/20 |

### Locked interfaces produced by this plan

```ts
export type OpenRouterModelsParseContext = {
  openRouterBaseUrl: string;
};

/** 実 API: 有料 ID のみ。mock base のときだけ mock/*:free */
export function parseOpenRouterModels(
  value: string,
  context: OpenRouterModelsParseContext,
): readonly string[];

export const officialOpenRouterBaseUrl = "https://openrouter.ai/api/v1";
export const exactLocalMockOpenRouterBaseUrl = "http://openrouter-mock:8787/api/v1";
export const maxPromptPlusCompletionUsdPerMillion = 0.5;

export const releaseQuota = {
  userDailySuccessLimit: 3,
  userDailyExternalCallLimit: 6,
  userShortWindowExternalCallLimit: 4,
  userShortWindowSeconds: 600,
} as const;

// GLOBAL_DAILY_AI_LIMIT default/max → 20
// privacyNoticeVersion → "2026-07-26.v1"
```

---

### Task 1: MVP 設計書と本設計の free-only 矛盾解消

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md`（§11.1 モデル設定、§11.2 上限、§18 運用、受入相当 L661/L668/L678 付近）
- Modify: `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`（状態を「実装 Plan 作成済み」へ）
- **Do not modify in this Task:** `docs/testing/acceptance-matrix.md`（Task 2）

**Interfaces:**
- Consumes: 設計書 `2026-07-26-paid-openrouter-models-design.md` 全文
- Produces: MVP 本文が有料 allowlist・3/6/20・structured AND・自動有料フォールバック禁止を正とする

- [ ] **Step 1: MVP §11.1 を有料規則へ置換**

置換の要旨（文言は日本語のまま、値は設計どおり）:

- `OPENROUTER_MODELS` は有料の明示 ID（`:free` 不可）。`openrouter/auto` 等ルーター禁止。
- 構造化は `structured_outputs` **と** `response_format` の両方。
- 単価 prompt+completion ≤ $0.50/1M。
- mock base URL のときだけ `mock/*:free`。
- 無料が使えないときの有料自動切替は行わない（本設計では **最初から有料のみ**）。

- [ ] **Step 2: MVP §11.2 上限を 3 / 6 / 20 に更新**

- `USER_DAILY_AI_LIMIT`: 3  
- `USER_DAILY_EXTERNAL_CALL_LIMIT`: 6  
- `GLOBAL_DAILY_AI_LIMIT` 初期: 20  
- 短期 4/600s・時間予算は据え置き  
- 成功 3×repair と attempt 6 の相互作用（成功保証ではない）を一文で残す  

- [ ] **Step 3: §18 と受入箇条書きの free-only を改訂**

- 「有料へ自動移行しない」→ 運営が env で有料 allowlist を明示する前提に更新  
- 「`:free` 以外で起動失敗」→「有料規則違反（:free / auto / 単価 / structured 欠落）で起動・デプロイ検証失敗」  

- [ ] **Step 4: 本設計の状態行を更新**

```markdown
- 状態: 実装 Plan 作成済み（`docs/superpowers/plans/2026-07-26-paid-openrouter-models.md`）
```

- [ ] **Step 5: 文書 diff の自己確認**

Run:

```bash
git diff -- docs/superpowers/specs/2026-07-11-kondate-mvp-design.md docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md
```

Expected: free-only の残存が MVP 本文に無い（歴史的言及を残す場合は「廃止」と明記）。

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-11-kondate-mvp-design.md docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md
git commit -m "$(cat <<'EOF'
docs: MVP 設計を有料 OpenRouter allowlist 方針へ整合する
EOF
)"
```

---

### Task 2: モデル契約・パーサ・検証・runtime・matrix

**Files:**
- Modify: `scripts/openrouter-models-contract.mjs`
- Modify: `scripts/verify-openrouter-models.mjs`
- Modify: `scripts/verify-openrouter-models.test.mjs`
- Modify: `scripts/preflight-production.mjs`
- Modify: `scripts/preflight-production.test.mjs`
- Modify: `netlify/functions/_shared/env.ts`
- Modify: `netlify/functions/_shared/env.test.ts`
- Modify: `netlify/functions/_shared/openrouter.ts`
- Modify: `netlify/functions/_shared/openrouter.test.ts`
- Modify: `netlify/functions/_shared/openrouter.smoke.test.ts`
- Modify: `docs/testing/acceptance-matrix.md`（行 17–19 付近）
- Modify: `docs/deployment/netlify.md`
- Modify: `docs/runbooks/openrouter.md`
- Modify: `docs/testing/release-checklist.md`（OpenRouter 関連）
- Test: 上記 test ファイル + `tests/tooling` で契約参照がある場合

**Interfaces:**
- Consumes: Task 1 の仕様文言
- Produces: `parseOpenRouterModels(value, { openRouterBaseUrl })`、remote AND+単価、runtime 有料ガード

- [ ] **Step 1: RED — 契約フィクスチャを有料+mock に書き換え（まずテストを落す）**

`scripts/openrouter-models-contract.mjs` の規則コメントとフィクスチャを次の意図に合わせる（実装は Step 3）:

```js
// 受理例（実 API base 文脈）
{ raw: "mistralai/mistral-small-3.2-24b-instruct,openai/gpt-oss-120b",
  models: ["mistralai/mistral-small-3.2-24b-instruct", "openai/gpt-oss-120b"],
  baseUrl: "https://openrouter.ai/api/v1" }

// 受理例（mock base 文脈）
{ raw: "mock/kondate-primary:free,mock/kondate-repair:free",
  models: ["mock/kondate-primary:free", "mock/kondate-repair:free"],
  baseUrl: "http://openrouter-mock:8787/api/v1" }

// 拒否: free on official base, paid on mock without mock/ prefix, auto, duplicates, empty
```

`verify-openrouter-models.test.mjs` を context 付き呼び出しに更新し、旧「:free only accept」が失敗することを確認する。

- [ ] **Step 2: Run RED**

```bash
docker compose run --rm --no-deps app node --test scripts/verify-openrouter-models.test.mjs
```

Expected: FAIL（parse が context 未対応 / free 必須のまま）

- [ ] **Step 3: GREEN — `parseConfiguredModels` / 契約 / 単価**

`verify-openrouter-models.mjs` に概ね次を実装する（関数名は既存 export を維持しつつ引数追加）:

```js
export const officialOpenRouterBaseUrl = "https://openrouter.ai/api/v1";
export const exactLocalMockOpenRouterBaseUrl = "http://openrouter-mock:8787/api/v1";
export const maxPromptPlusCompletionUsdPerMillion = 0.5;

export function isExactLocalMockBaseUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "openrouter-mock" &&
      parsed.port === "8787" &&
      parsed.pathname === "/api/v1" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

export function parseConfiguredModels(raw, context = {}) {
  const openRouterBaseUrl =
    typeof context.openRouterBaseUrl === "string" && context.openRouterBaseUrl.length > 0
      ? context.openRouterBaseUrl
      : officialOpenRouterBaseUrl;
  const models = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (models.length === 0) throw new Error("OPENROUTER_MODELS must not be empty");
  if (new Set(models).size !== models.length) {
    throw new Error("OPENROUTER_MODELS must not contain duplicates");
  }
  const mockPath = isExactLocalMockBaseUrl(openRouterBaseUrl);
  const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
  for (const id of models) {
    if (routers.has(id)) {
      throw new Error("OPENROUTER_MODELS rejects router model IDs");
    }
    if (mockPath) {
      if (!id.startsWith("mock/") || !id.endsWith(":free")) {
        throw new Error("OPENROUTER_MODELS mock path accepts only mock/*:free IDs");
      }
    } else if (id.endsWith(":free")) {
      throw new Error("OPENROUTER_MODELS rejects :free models on non-mock base URL");
    }
  }
  return models;
}

function usdPerMillion(tokenPrice) {
  const n = Number(tokenPrice);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * 1e6;
}

export function verifyRemoteModels(configured, remote) {
  const byId = new Map(remote.map((model) => [model.id, model]));
  for (const id of configured) {
    const model = byId.get(id);
    if (!model) throw new Error(`${id} is not present in the OpenRouter Models API`);
    const parameters = new Set(
      Array.isArray(model.supported_parameters) ? model.supported_parameters : [],
    );
    // AND 必須（片方だけでは不足）— 緩和禁止
    if (!parameters.has("structured_outputs") || !parameters.has("response_format")) {
      throw new Error(`${id} does not support strict structured output`);
    }
    const prompt = usdPerMillion(model.pricing?.prompt);
    const completion = usdPerMillion(model.pricing?.completion);
    if (prompt === null || completion === null) {
      throw new Error(`${id} is missing usable pricing.prompt/completion`);
    }
    if (prompt + completion > maxPromptPlusCompletionUsdPerMillion) {
      throw new Error(`${id} exceeds max prompt+completion USD per 1M tokens`);
    }
  }
}
```

`main` 内:

```js
const configured = parseConfiguredModels(env.OPENROUTER_MODELS ?? "", {
  openRouterBaseUrl: env.OPENROUTER_BASE_URL || officialOpenRouterBaseUrl,
});
// --remote 時: mock path なら remote を skip（構造化はフィクスチャ保証）
if (argv.includes("--remote") && isExactLocalMockBaseUrl(env.OPENROUTER_BASE_URL || "")) {
  return;
}
```

- [ ] **Step 4: GREEN — env.ts 鏡像**

```ts
export type OpenRouterModelsParseContext = {
  openRouterBaseUrl: string;
};

export function parseOpenRouterModels(
  value: string,
  context: OpenRouterModelsParseContext,
): readonly string[] {
  // verify-openrouter-models.mjs と同一規則（コメントで契約ファイルを正本と明記）
}

// parseServerEnv 内:
models: parseOpenRouterModels(result.data.OPENROUTER_MODELS, {
  openRouterBaseUrl: result.data.OPENROUTER_BASE_URL,
}),
```

`validServerEnv` のテスト用 MODELS は **mock base とセット**にするか、有料 ID に変更する。compose 既定は mock base + mock models のまま通ること。

- [ ] **Step 5: GREEN — preflight 鏡像**

```js
parseOpenRouterModels(env.OPENROUTER_MODELS, {
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
});
```

- [ ] **Step 6: GREEN — openrouter.ts runtime**

```ts
const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
const rejectsRouterOrEmptyOrDup =
  config.models.length === 0 ||
  new Set(config.models).size !== config.models.length ||
  config.models.some((model) => routers.has(model));
const rejectsFreeOnRealApi =
  !isExactLocalMockBaseUrl(config.baseUrl) &&
  config.models.some((model) => model.endsWith(":free"));
if (rejectsRouterOrEmptyOrDup || rejectsFreeOnRealApi) {
  throw new OpenRouterCallError("model_unavailable");
}
// 据え置き: excluded 後 empty、timeout、response model ∈ models
```

- [ ] **Step 7: smoke テスト**

`openrouter.smoke.test.ts` から「modelId.endsWith(":free")」を削除し、コメントで **実費が発生する** ことを日本語で明記。

- [ ] **Step 8: acceptance-matrix と運用 docs（同一 Task）**

| 行 | 新 title 方針 |
|----|----------------|
| 17 | Quotas **3/6/4**/global20 …（実装は Task 3 後にフル整合。matrix 文言は Task 2 でモデル規則、数値は Task 3 で確定でも可だが **最終的に 3/6/20**） |
| 18 | Free-model only emergency… → モデル障害時の緊急献立（有料 allowlist でも維持） |
| 19 | Non-`:free` fails… → **Invalid paid-model config**（:free on real base / auto / missing structured AND / over price） fails startup/deploy verify |

matrix の backtick 内テスト title 文字列は、実際の `it("...")` / `test("...")` と **一字一句一致**させる。`scripts/verify-acceptance-matrix.mjs` を通す。

- [ ] **Step 9: 検証**

```bash
docker compose run --rm --no-deps app node --test scripts/verify-openrouter-models.test.mjs
docker compose run --rm --no-deps app node --test scripts/preflight-production.test.mjs
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/env.test.ts netlify/functions/_shared/openrouter.test.ts
docker compose run --rm --no-deps app node scripts/verify-acceptance-matrix.mjs
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

Expected: すべて PASS（quota 数値テストがまだ 5/12 の場合は Task 2 では MODELS 周りだけ通し、quota 期待は Task 3 で一括更新してよい。**ただし env.test の MODELS 受理が free 必須で落ちないこと**）

- [ ] **Step 10: Commit**

```bash
git add scripts/openrouter-models-contract.mjs scripts/verify-openrouter-models.mjs scripts/verify-openrouter-models.test.mjs scripts/preflight-production.mjs scripts/preflight-production.test.mjs netlify/functions/_shared/env.ts netlify/functions/_shared/env.test.ts netlify/functions/_shared/openrouter.ts netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/openrouter.smoke.test.ts docs/testing/acceptance-matrix.md docs/deployment/netlify.md docs/runbooks/openrouter.md docs/testing/release-checklist.md
git commit -m "$(cat <<'EOF'
feat: OpenRouter を有料 allowlist 契約へ切り替える
EOF
)"
```

---

### Task 3: クォータ 3/6/20（env・SQL・コピー）

**Files:**
- Modify: `shared/contracts/generation.ts`（`releaseQuota`、`issueMessages.user_daily_limit`）
- Modify: `netlify/functions/_shared/generation-service.ts`（文言鏡像）
- Modify: `netlify/functions/_shared/env.ts`（`GLOBAL_DAILY_AI_LIMIT` max/default 20、USER locks 3/6）
- Modify: `scripts/preflight-production.mjs`（exact 3/6）
- Create: `supabase/migrations/<cli-generated>_paid_openrouter_quota_3_6_20.sql`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql` ほか 5/12/45 を参照する pgTAP
- Modify: `shared/testing/factories.ts`、`shared/contracts/generation.test.ts`、compose/CI の env 既定、adversarial テスト env
- Modify: `docs/testing/acceptance-matrix.md` 行 17 の 3/6/20（Task 2 で仮置きした場合は確定）

**Interfaces:**
- Consumes: Task 2 の env パーサ
- Produces: 全権威が success=3, attempt=6, global max/default=20

- [ ] **Step 1: RED — releaseQuota と文言**

```ts
// shared/contracts/generation.ts
export const releaseQuota = {
  userDailySuccessLimit: 3,
  userDailyExternalCallLimit: 6,
  userShortWindowExternalCallLimit: 4,
  userShortWindowSeconds: 600,
} as const;

// issueMessages
user_daily_limit: "今日は3回利用しました。明日0:00（日本時間）から利用できます",
```

```ts
// generation-service.ts 同一文言
```

まず `generation.test.ts` / `env.test.ts` の旧 5/12 期待を **新期待に更新してから** 実装すると RED が取れる。旧値のままテストを残し実装だけ新値にすると意図と逆。

- [ ] **Step 2: env / preflight の releaseLockedInteger**

```ts
USER_DAILY_AI_LIMIT: releaseLockedInteger(releaseQuota.userDailySuccessLimit, "3"),
USER_DAILY_EXTERNAL_CALL_LIMIT: releaseLockedInteger(
  releaseQuota.userDailyExternalCallLimit,
  "6",
),
GLOBAL_DAILY_AI_LIMIT: globalDailyLimit(20), // max and default 20
```

preflight: `requirePositiveIntegerString(env, "USER_DAILY_AI_LIMIT", 3)` 等。

- [ ] **Step 3: SQL migration**

```bash
docker compose run --rm --no-deps app npx supabase migration new paid_openrouter_quota_3_6_20
```

CLI が出力した path のみ使用。migration で少なくとも:

1. CHECK 更新:

```sql
alter table private.ai_user_daily_usage
  drop constraint if exists ai_user_daily_usage_reserved_count_success_count_check;
-- 実際の constraint 名は \d で確認してから drop
alter table private.ai_user_daily_usage
  add constraint ai_user_daily_usage_quota_bounds_check
  check (reserved_count + success_count <= 3);

alter table private.ai_user_daily_external_attempts
  add constraint ... check (reserved_count + sent_count <= 6);
```

2. **現行の最新関数定義**（`reserve_ai_generation`、`reserve_ai_repair_call`、`get_ai_usage_today` 等）を最新 migration からコピーし、次を置換:

- `p_user_limit <> 5` → `<> 3`
- attempt `>= 12` → `>= 6`
- global `between 1 and 45` / default 45 / `< 45` → **20**
- ハードコード 12 / 5 / 45 の残存を migration 内 grep で 0 件にする

3. pgTAP の期待値（remaining、拒否ケース）を 3/6/20 に。

- [ ] **Step 4: 検証**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts netlify/functions/_shared/env.test.ts
docker compose run --rm --no-deps app npm run typecheck
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test
```

Expected: pgTAP 全通、env/contracts PASS。

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: AI 利用上限を成功3・attempt6・全体20へ引き下げる
EOF
)"
```

---

### Task 4: プライバシー説明 version 更新

**Files:**
- Modify: `shared/contracts/domain.ts`（`privacyNoticeVersion = "2026-07-26.v1"`）
- Modify: 全 `2026-07-11.v1` の privacy 参照（generation fixtures、privacy tests、planner returnTo 系）
- Modify: プライバシー説明 UI コピー（有料提供者を含む文面）
- Test: `shared/contracts/domain.test.ts`、`src/features/privacy/**`、生成リクエスト schema テスト

**Interfaces:**
- Consumes: 設計 §7
- Produces: 新 literal のみ受理。旧 version リクエストは Zod で失敗

- [ ] **Step 1: RED**

```ts
export const privacyNoticeVersion = "2026-07-26.v1" as const;
```

`domain.test.ts` を新値に更新。旧 version 文字列の fixture を1つ残したテストがあれば「reject」へ。

- [ ] **Step 2: 説明コピー**

利用者向けに、OpenRouter および設定モデルの提供者（有料を含み得る）へプロンプトが渡り得ることを平易な日本語で記載。内部 ID を本文に出さない。

- [ ] **Step 3: 全参照更新**

```bash
# ホストで
grep -R "2026-07-11.v1" --include='*.ts' --include='*.tsx' shared src netlify e2e || true
```

privacy 用途の旧 version を新 version へ。menu `schemaVersion: "2026-07-11.v1"` など **別契約の version は変更しない**。

- [ ] **Step 4: ロールアウト注記**

PR 説明または `docs/runbooks/openrouter.md` に:

- ブラウザと Function を同一デプロイで出す
- 旧同意は無効（再確認必須）
- 版ずれ時は再読み込み
- 300s continuation 不整合は fail-closed

- [ ] **Step 5: 検証**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/domain.test.ts shared/contracts/generation.test.ts src/features/privacy
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: AI 情報送信説明を有料モデル前提の version へ更新する
EOF
)"
```

---

### Task 5: 有料ベンチゲート・README・本番 env 例

**Files:**
- Create: `scripts/benchmark-paid-openrouter-models.mjs`（または `tools/` 配下。リポジトリ方針に合わせる）
- Modify: `README.md`（実 API 手順を有料 allowlist に）
- Modify: `docs/runbooks/openrouter.md`（機械フィルタ → N=10）
- **Do not commit:** API キー、生の課金ログに PII がある場合

**Interfaces:**
- Consumes: Task 2 の `verifyRemoteModels` 規則、設計 §4.4 候補 5 本
- Produces: 合格 1–2 ID の `OPENROUTER_MODELS` 推奨値とゲート証跡（キー無し）

- [ ] **Step 1: ベンチスクリプト**

入力: env の `OPENROUTER_API_KEY`、候補リスト定数（設計の 5 ID）。

処理順:

1. Models API 取得  
2. 各 ID: 不在 / structured AND 欠落 / 単価超過 → 除外し理由 print  
3. 残存 ID 各 10 回: 実 `menuResponseFormat`（`shared/contracts` から生成するか JSON を同梱）+ `require_parameters: true`  
4. 合格: 10/10 が 20s 未満かつ形状最低条件  

終了コード: 1 本も合格でなければ non-zero。

コメント先頭: **実行すると有料課金が発生する。**

- [ ] **Step 2: キーにクレジットがある環境で実行**

```bash
docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs
```

Expected: 合格 ID が 1 本以上。0 本なら **Plan 完了不可** — 候補変更または設計改訂へ戻す。

- [ ] **Step 3: README / runbook 更新**

```bash
# 例（実際の合格 ID に置換）
OPENROUTER_MODELS=mistralai/mistral-small-3.2-24b-instruct,openai/gpt-oss-120b
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

mock 戻り手順は維持。

- [ ] **Step 4: ローカル app を有料で再作成して 1 回手動生成（任意だが推奨）**

```bash
# .env 更新後
docker compose up -d --force-recreate --no-deps app
```

成功または明確な失敗コードを確認。成功クォータ非消費の失敗でも attempt が減ることを usage で確認できるとよい。

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-paid-openrouter-models.mjs README.md docs/runbooks/openrouter.md
git commit -m "$(cat <<'EOF'
chore: 有料 OpenRouter ベンチゲートと推奨モデル例を追加する
EOF
)"
```

- [ ] **Step 6: Plan 完了ゲート**

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm run build
git diff --check
```

Expected: すべて PASS。ベンチ 0 合格のまま build だけ通しても **本番 ship 不可**。

---

## Self-Review (plan author)

### Spec coverage

| 設計節 | Task |
|--------|------|
| §4 モデル規則・mock・runtime・AND・単価 | Task 2 |
| §4.4 ゲート | Task 5 |
| §5 クォータ 3/6/20・SQL・コピー | Task 3 |
| §7 privacy version・ロールアウト | Task 4 |
| §8 docs / matrix | Task 1–2 |
| §9 テスト・スモーク実費 | Task 2 / 5 |
| §14 PR 分割 | Task 1–5 に対応 |

### Placeholder scan

TBD/TODO なし。SQL は「最新関数定義をコピーして数値置換」と指示（関数全文のコピペは migration 時点の HEAD に依存するため、Plan に古い全文を固定しない）。

### Type consistency

`parseOpenRouterModels(value, { openRouterBaseUrl })` と `releaseQuota` 3/6、`privacyNoticeVersion` `2026-07-26.v1`、global max 20 を全 Task で共有。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-paid-openrouter-models.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 各 Task ごとに新規 subagent、Task 間でレビュー  
2. **Inline Execution** — このセッションで `executing-plans` に従いチェックポイント付き実行  

**Which approach?**
