# 低価格有料 OpenRouter モデル導入 Implementation Plan

**Plan ID:** 8（handoff と progress で使用する数値 ID）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番の OpenRouter 利用を有料 allowlist（structured AND・単価上限・auto 禁止）に切り替え、利用上限を 3/6/20 に引き下げ、プライバシー説明 version を更新し、有料ベンチゲートを通過できる状態にする。

**Architecture:** モデル受理規則の正本を `scripts/openrouter-models-contract.mjs` に置き、`parseOpenRouterModels(value, { openRouterBaseUrl })` を env / verify / preflight の 3 鏡像で同一にする。mock 例外は exact mock base URL のみ。構造化は `structured_outputs` AND `response_format` を維持。クォータは `releaseQuota`・env ロック・SQL CHECK/RPC ハードコードを同時に 3/6/20 へ。privacy は単一 `privacyNoticeVersion` literal を上げ、旧同意を未同意扱いとする。

**Tech Stack:** TypeScript 5.9 / Zod 4 / Node 24 / Netlify Functions / Supabase Postgres 17 / Vitest / node:test / pgTAP / Playwright

**仕様書:** `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`

**二次検証反映:** `docs/reviews/2026-07-26-paid-openrouter-plan-secondary-review.md`（REVISE_BEFORE_EXECUTE → 本改訂で実行可能化）

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
- `acceptance-matrix.md` の **モデル系 title** 連動改訂は **Task 2 と同一コミット列**（matrix だけ先行禁止）。
- **行 17 のクォータ数値 Scenario（3/6/20）は Task 3 専任。** Task 2 は行 17 の数値を書き換えない。
- Task 2 / Task 3 完了時点で、当該 Task が触ったファイル群の **focused Vitest / node:test は緑**であること（次 Task に赤を残さない）。フルスイートは Task 3 後と Plan 完了ゲートで。
- Task 2 後〜Task 3 前は env/SQL がまだ 5/12/45 のまま。MVP 文書と CLAUDE は 3/6/20 へ更新済みになり得るが、**実装権威はコード/SQL が優先**し、数値の実装は Task 3 まで完了しない。

## File Structure

| ファイル | 責務 |
| --- | --- |
| `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` | free-only / 旧クォータ文面を本設計へ整合 |
| `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md` | 状態を「実装中」へ（Task 1） |
| `docs/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md` | Locked Environment Contract を有料・3/6/20 へ（Task 1） |
| `CLAUDE.md` | free-only / 5·12·45 を本設計値へ（Task 1） |
| `scripts/openrouter-models-contract.mjs` | 有料+mock 規則の正本とフィクスチャ（baseUrl 付き） |
| `scripts/verify-openrouter-models.mjs` | parse + remote AND + 単価 |
| `scripts/verify-openrouter-models.test.mjs` | 契約・remote・単価テスト |
| `scripts/preflight-production.mjs` | 本番 parse 鏡像・quota exact |
| `scripts/preflight-production.test.mjs` | preflight 期待値（有料 MODELS + 後に 3/6） |
| `netlify/functions/_shared/env.ts` | `parseOpenRouterModels(value, ctx)`・quota ロック・global max 20 |
| `netlify/functions/_shared/env.test.ts` | パース・mock 例外・quota |
| `netlify/functions/_shared/openrouter.ts` | runtime ガード（有料正常、空/重複/model 所属は据え置き） |
| `netlify/functions/_shared/openrouter.test.ts` | runtime ガード回帰（**有料拒否 → 許可の意味反転**） |
| `netlify/functions/_shared/openrouter.smoke.test.ts` | opt-in 実費スモーク（:free 期待削除） |
| `shared/contracts/generation.ts` | `releaseQuota` 3/6、`issueMessages.user_daily_limit` |
| `netlify/functions/_shared/generation-service.ts` | 同文言鏡像 |
| `supabase/migrations/<new>_paid_quota_3_6_20.sql` | CHECK と RPC の 5/12/45 → 3/6/20 |
| `supabase/tests/database/ai_control_and_quota.test.sql` 等 | 上限値期待の更新 |
| `shared/contracts/domain.ts` | `privacyNoticeVersion` |
| `src/features/privacy/**` | 説明コピー・version 表示 |
| `docs/testing/acceptance-matrix.md` | 行 18–19（Task 2）、行 17 数値（Task 3） |
| `docs/deployment/netlify.md` / `docs/runbooks/openrouter.md` / `docs/testing/release-checklist.md` / `README.md` | 運用文書 |
| `scripts/benchmark-paid-openrouter-models.mjs` | Task 5 機械フィルタ + N=10 ゲート |
| `compose.yaml` / CI / secrets 生成 / `tests/tooling/compose.test.mjs` | quota 既定 3/6/20（Task 3） |

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

**パーサ契約の注記:** TypeScript の `env.ts` では `context` を **必須**とする。`.mjs` 鏡像は CLI 都合で `context` 省略時に公式 URL へフォールバックしてよいが、**呼び出し 3 箇所（env / verify main / preflight）は常に明示渡し**し、テストの主経路を省略に依存させない。

---

### Task 1: MVP / エージェント権威文書の free-only 矛盾解消

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md`（§11.1 モデル設定、§11.2 上限、§18 運用、受入相当 L661/L668/L678 付近）
- Modify: `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`（状態を「実装中」へ）
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md`（Locked Environment Contract の free-only・5/12/45 と関連受入行）
- Modify: `CLAUDE.md`（`:free` のみ / 5·12·45 の Global constraints）
- **Do not modify in this Task:** `docs/testing/acceptance-matrix.md`（Task 2/3）、実装コード

**Interfaces:**
- Consumes: 設計書 `2026-07-26-paid-openrouter-models-design.md` 全文
- Produces: MVP・roadmap・CLAUDE が有料 allowlist・3/6/20・structured AND・自動有料フォールバック禁止を正とする

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

- [ ] **Step 4: roadmap Locked Environment Contract を本設計へ**

`docs/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md` の次を更新:

- `OPENROUTER_MODELS`: 有料 allowlist（`:free` 拒否、mock 例外は exact mock base のみ）
- `USER_DAILY_AI_LIMIT` / external / global: **3 / 6 / 20**
- 冒頭・受入行の free-only / production `:free` 文言を本設計と矛盾しないよう改訂
- 一文: **Plan 8（`2026-07-26-paid-openrouter-models`）以降、モデル・クォータの正本は当該設計／本 Plan。** 歴史的 free-only 記述は上書き済みとする

- [ ] **Step 5: CLAUDE.md の Global constraints を本設計値へ**

- `only :free model IDs` → 有料 allowlist + mock 例外（exact mock URL）
- Release-locked quota: **3 / 6 / 20**（短期 4/600・時間予算据え置き）
- roadmap 参照文は「Locked Environment Contract は Plan 8 改訂後の値」と矛盾しないこと
- `AGENTS.md` に free-only / 5·12·45 が無ければ **触らない**（「該当なし」で閉じる）

- [ ] **Step 6: 本設計の状態行を「実装中」へ**

```markdown
- 状態: 実装中（Plan: `docs/superpowers/plans/2026-07-26-paid-openrouter-models.md`）
```

- [ ] **Step 7: 文書 diff の自己確認**

Run:

```bash
git diff -- docs/superpowers/specs/2026-07-11-kondate-mvp-design.md docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md docs/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md CLAUDE.md
```

Expected: free-only / 5·12·45 がエージェント権威文書に残っていない（歴史的言及は「廃止」と明記）。

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-07-11-kondate-mvp-design.md docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md docs/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: MVP・roadmap・CLAUDE を有料 OpenRouter allowlist 方針へ整合する
EOF
)"
```

---

### Task 2: モデル契約・パーサ・検証・runtime・matrix（モデル行のみ）

**Files（必須更新 — fixture / 意味反転を含む）:**
- Modify: `scripts/openrouter-models-contract.mjs`
- Modify: `scripts/verify-openrouter-models.mjs`
- Modify: `scripts/verify-openrouter-models.test.mjs`
- Modify: `scripts/preflight-production.mjs`
- Modify: `scripts/preflight-production.test.mjs`（MODELS を有料 ID に。**quota exact 5/12/45 は Task 3**）
- Modify: `netlify/functions/_shared/env.ts`
- Modify: `netlify/functions/_shared/env.test.ts`
- Modify: `netlify/functions/_shared/openrouter.ts`
- Modify: `netlify/functions/_shared/openrouter.test.ts`（**有料拒否ケースの削除・逆転**）
- Modify: `netlify/functions/_shared/openrouter.smoke.test.ts`
- Modify: `docs/testing/acceptance-matrix.md`（**行 18–19 とモデル title のみ。行 17 数値は触らない**）
- Modify: `docs/deployment/netlify.md`
- Modify: `docs/runbooks/openrouter.md`（ローカル mock / 公式 base 手順を含む）
- Modify: `docs/testing/release-checklist.md`（OpenRouter 関連）
- Test: 上記 + `tests/tooling` で契約 / OPENROUTER_MODELS を参照する場合

**Interfaces:**
- Consumes: Task 1 の仕様文言
- Produces: `parseOpenRouterModels(value, { openRouterBaseUrl })`、remote AND+単価、runtime 有料ガード

#### 必須: 現行テストの意味反転チェックリスト（実装前に読む）

| 現行 | Task 2 後の期待 |
|------|-----------------|
| `openrouter.test.ts` の `["non-free", ["paid/model"]]` が **有料を拒否** | **削除**。代わりに real base 上の `:free` 拒否、router 集合拒否を追加。有料 ID は正常系になり得る |
| `openrouter.test.ts` の `config` / `getServerEnvMock` が free MODELS + 非 exact mock base | **公式 base + 有料 ID**、または **exact mock URL + mock/*:free** の組に統一。混在は parse / runtime のどちらかで落ちる |
| `env.test.ts` が `parseOpenRouterModels(raw)` 1 引数 + `acceptedFreeModelLists` | **全呼び出しが context を渡す**。契約配列は `baseUrl` 付き accept（paid-path / mock-path） |
| `validServerEnv` が free MODELS + 公式既定 base | 有料 MODELS + 公式 base、または mock MODELS + exact mock `OPENROUTER_BASE_URL` |
| `preflight-production.test.mjs` の `OPENROUTER_MODELS: "...:free"` | **有料 ID**（preflight は常に公式 base） |
| remote 成功フィクスチャに pricing なし | `pricing.prompt` / `pricing.completion` 必須。欠落・片方 structured・単価超過の RED を先に書く |
| 契約 export 名 `acceptedFreeModelLists` | 有料規則向けにリネーム可（`acceptedModelLists` 等）。残すならコメントで「free 必須ではない」と明記 |

- [ ] **Step 1: RED — 契約フィクスチャと verify テストを有料+mock+pricing に**

`scripts/openrouter-models-contract.mjs` の規則コメントとフィクスチャ:

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
// isLocal だけでは mock 例外にならない（SERVER_SITE_ORIGIN を context に渡さない）
```

`verify-openrouter-models.test.mjs`:

1. すべて `parseConfiguredModels(raw, { openRouterBaseUrl })` で呼ぶ
2. remote 成功ケースに `supported_parameters: ["structured_outputs","response_format"]` と **usable pricing** を付与
3. RED 追加: structured 片方のみ → 拒否、pricing 欠落 → 拒否、prompt+completion > 0.5 → 拒否

- [ ] **Step 2: Run RED（verify 契約）**

```bash
docker compose run --rm --no-deps app node --test scripts/verify-openrouter-models.test.mjs
```

Expected: FAIL（parse が context 未対応 / free 必須のまま / pricing 未検査）

- [ ] **Step 3: GREEN — `parseConfiguredModels` / 契約 / 単価**

`verify-openrouter-models.mjs`（関数名は既存 export を維持しつつ引数追加）:

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

// context 省略時のみ公式 URL（CLI 互換）。本番パスは常に明示渡し。
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

`isExactLocalMockBaseUrl` は `openrouter.ts` 既存と **規則同一**（鏡像可。共有モジュール化は必須ではないが、差分を出さない）。

- [ ] **Step 4: GREEN — env.ts 鏡像 + env.test 反転**

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

- `validServerEnv`: 有料 MODELS + 公式 base、**または** mock MODELS + exact mock base（後者が compose 現実に近い）。
- `parseOpenRouterModels` の it.each は **context 付き**契約フィクスチャのみ。
- **quota 数値（5/12、global 45）は Task 3 まで変更しない。** Task 2 では MODELS 受理だけ緑にする。

- [ ] **Step 5: GREEN — preflight 鏡像 + preflight テスト**

```js
parseOpenRouterModels(String(env.OPENROUTER_MODELS), {
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
});
```

`completeEnv` の `OPENROUTER_MODELS` を有料 ID に変更。**USER_DAILY_* の exact 5/12 と global max 45 は Task 3。**

- [ ] **Step 6: GREEN — openrouter.ts runtime + テスト意味反転（Critical）**

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

テスト更新（必須）:

1. `["non-free", ["paid/model"]]` を **削除**
2. 追加例: real base + `["vendor/a:free"]` → `model_unavailable`
3. 追加例: `openrouter/free` / `openrouter/auto-beta` → 拒否
4. 正常系 happy path の models を **有料 ID** にするか、base を exact mock にして `mock/*:free` にする
5. `getServerEnvMock` / デフォルト `config` の baseUrl と models を新規則と一致

- [ ] **Step 7: smoke テスト**

`openrouter.smoke.test.ts` から `modelId.endsWith(":free")` を削除し、コメントで **実費が発生する** ことを日本語で明記。

- [ ] **Step 8: acceptance-matrix（モデル行のみ）と運用 docs**

| 行 | Task 2 でやること |
|----|-------------------|
| **17** | **数値 Scenario（5/12/45 や 3/6/20）は変更しない。** title の citation がモデル検証を誤って要求していなければそのまま |
| **18** | 緊急献立 Scenario。**モデル verify title を emergency 証拠から外す**（または emergency 専用 title のみ残す）。有料 allowlist でも緊急導線は維持 |
| **19** | Non-`:free` fails… → **Invalid paid-model config**（:free on real base / auto / missing structured AND / over price） fails startup/deploy verify。backtick title は実 `it`/`test` と一字一句一致 |

matrix の backtick 内 title は `scripts/verify-acceptance-matrix.mjs` を通す。

**運用 docs（必須追記）** — `docs/runbooks/openrouter.md` および必要なら README:

- 公式 `OPENROUTER_BASE_URL` + `:free` MODELS は Task 2 以降 **起動検証失敗**
- ローカル既定: exact mock base + `mock/kondate-*:free`（compose / `generate-local-secrets` 既定で可）
- 実 API 試すとき: 有料 allowlist + クレジット。戻すときは mock base+models に戻し `app` を recreate
- `isLocal` / `SERVER_SITE_ORIGIN` だけでは mock 例外にならない

- [ ] **Step 9: 検証（Task 2 完了条件: 下記がすべて PASS）**

```bash
docker compose run --rm --no-deps app node --test scripts/verify-openrouter-models.test.mjs
docker compose run --rm --no-deps app node --test scripts/preflight-production.test.mjs
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/env.test.ts netlify/functions/_shared/openrouter.test.ts
docker compose run --rm --no-deps app node scripts/verify-acceptance-matrix.mjs
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

Expected: すべて PASS。quota 期待はまだ 5/12/45 のままでよい。**MODELS / runtime / matrix モデル行が緑であること。**

- [ ] **Step 10: Commit**

```bash
git add scripts/openrouter-models-contract.mjs scripts/verify-openrouter-models.mjs scripts/verify-openrouter-models.test.mjs scripts/preflight-production.mjs scripts/preflight-production.test.mjs netlify/functions/_shared/env.ts netlify/functions/_shared/env.test.ts netlify/functions/_shared/openrouter.ts netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/openrouter.smoke.test.ts docs/testing/acceptance-matrix.md docs/deployment/netlify.md docs/runbooks/openrouter.md docs/testing/release-checklist.md
git commit -m "$(cat <<'EOF'
feat: OpenRouter を有料 allowlist 契約へ切り替える
EOF
)"
```

---

### Task 3: クォータ 3/6/20（env・SQL・コピー・全参照面）

**Files:**
- Modify: `shared/contracts/generation.ts`（`releaseQuota`、`issueMessages.user_daily_limit`）
- Modify: `netlify/functions/_shared/generation-service.ts`（文言鏡像）
- Modify: `netlify/functions/_shared/env.ts`（`GLOBAL_DAILY_AI_LIMIT` max/default 20、USER locks 3/6）
- Modify: `scripts/preflight-production.mjs`（exact 3/6、global max 20）
- Modify: `scripts/preflight-production.test.mjs`
- Create: `supabase/migrations/<cli-generated>_paid_openrouter_quota_3_6_20.sql`
- Modify: `supabase/tests/database/**` で 5/12/45 を参照する pgTAP
- Modify: `shared/testing/factories.ts`、`shared/contracts/generation.test.ts`
- Modify: `compose.yaml`、CI env、`tests/tooling/compose.test.mjs`、secrets 生成の quota 既定
- Modify: 全 `userDailyLimit: 5` / `limit: 5|12` / `globalDailyLimit: 45` / `p_user_limit: 5` の AI クォータ fixture（下記スキャン）
- Modify: `docs/testing/acceptance-matrix.md` **行 17** の Scenario を 3/6/4 + global20 に確定
- **Do not change:** feedback 等 **別機能**の `p_limit default 5` / 評価上限（AI 日次成功とは無関係）

**Interfaces:**
- Consumes: Task 2 の env パーサ
- Produces: 全権威が success=3, attempt=6, global max/default=20

#### 関数ごとの権威 migration（実装時に HEAD で再確認）

コピー元は「古い migration 全文を無差別に貼る」ではなく、**各関数の最終 CREATE を特定**してから数値だけ置換する。

| 関数 / オブジェクト | 権威の目安（2026-07-26 時点・HEAD で再確認） | 置換対象の例 |
|--------------------|-----------------------------------------------|--------------|
| `public.reserve_ai_generation` | `20260722225217_generation_command_v2.sql`（以降に CREATE が無いか確認） | `p_user_limit <> 5`→`3`、`>= 12`→`6`、`between 1 and 45`→`20` |
| `public.reserve_ai_repair_call` | `20260711002000_ai_control_and_quota.sql` 系の最終定義 | attempt 12、global 帯 |
| `public.get_ai_generation_status` | **必須。** `p_user_limit <> 5` と usage 内 `'limit', 5/12` | **3 / 6** に。漏らすと status 表示が 5 のまま / mismatch |
| `public.get_ai_usage_today` | `20260726120000_adversarial_review_fixes.sql` が最新候補 | `greatest(5 - …)` / `greatest(12 - …)`、`'limit', 5/12`、global `1..45` / default 45 → **3/6/20** |
| table CHECK | `20260711002000` の **無名** `check (reserved_count + success_count <= 5)` と `<= 12` | conname を `pg_constraint` で解決して drop → `<= 3` / `<= 6` |
| global table CHECK | 無い（関数帯のみ） | 関数内の 45 帯のみ 20 へ |

- [ ] **Step 1: RED — テスト期待を先に 3/6/20 へ（実装前）**

順序（純粋 RED）:

1. `generation.test.ts` / `env.test.ts` / `preflight-production.test.mjs` の 5/12/45 期待を **3/6/20** に更新
2. factories / usage-today / generation-service fixtures の `userDailyLimit` 等を 3/6 に
3. この時点でテストを走らせ **FAIL** を確認
4. その後 `releaseQuota` と env ロックを実装（GREEN）

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

`generation-service.ts` 同一文言。

- [ ] **Step 2: env / preflight の releaseLockedInteger**

```ts
USER_DAILY_AI_LIMIT: releaseLockedInteger(releaseQuota.userDailySuccessLimit, "3"),
USER_DAILY_EXTERNAL_CALL_LIMIT: releaseLockedInteger(
  releaseQuota.userDailyExternalCallLimit,
  "6",
),
GLOBAL_DAILY_AI_LIMIT: globalDailyLimit(20), // max and default 20
```

preflight: `requirePositiveIntegerString(env, "USER_DAILY_AI_LIMIT", 3)` 等、global max **20**。

- [ ] **Step 3: SQL migration**

```bash
docker compose run --rm --no-deps app npx supabase migration new paid_openrouter_quota_3_6_20
```

CLI が出力した path のみ使用。

**3a. CHECK（無名制約の conname 解決）**

ローカル DB で（reset 後でも可）:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in (
  'private.ai_user_daily_usage'::regclass,
  'private.ai_user_daily_external_attempts'::regclass
)
and contype = 'c';
```

`reserved_count + success_count <= 5` と `reserved_count + sent_count <= 12` の **実際の conname** を drop し、命名付きで `<= 3` / `<= 6` を add する。Plan 内の架空名をそのまま使わない。

**3b. 関数置換**

上記権威表の **4 関数すべて**を `create or replace`。v2 以降の HMAC / integrity 引数を巻き戻さない。migration 内で `5`/`12`/`45` の AI クォータ残存を grep して 0 件。

**3c. pgTAP** の remaining / 拒否ケースを 3/6/20 に。

- [ ] **Step 4: リポジトリ残存スキャン（必須・完了条件）**

ホストで（AI クォータ文脈）:

```bash
grep -RInE 'userDailyLimit:\s*5\b|USER_DAILY_AI_LIMIT.: ."5"|p_user_limit:\s*5\b|limit:\s*12\b|globalDailyLimit:\s*45\b|between 1 and 45|USER_DAILY_EXTERNAL_CALL_LIMIT.: ."12"|GLOBAL_DAILY_AI_LIMIT.: ."45"|今日は5回' \
  shared src netlify scripts tests supabase compose.yaml .github || true
```

- AI 日次成功・attempt・global に関するヒットは **0** にする
- **除外:** feedback 評価上限、menu `schemaVersion`、非 AI の `limit: 5` など。判断に迷う行は報告してから触る

compose / `tests/tooling/compose.test.mjs` の `"5"` / `"12"` / `"45"` を **3/6/20** に。

- [ ] **Step 5: matrix 行 17 確定**

Scenario を成功 **3** / attempt **6** / 短期 **4**/600s / global **20** に更新。citation title が変わるなら対応テスト title と同一コミット。

- [ ] **Step 6: 検証（Task 3 完了条件）**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts netlify/functions/_shared/env.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_tests/usage-today.test.ts
docker compose run --rm --no-deps app node --test scripts/preflight-production.test.mjs
docker compose run --rm --no-deps app node --test tests/tooling/compose.test.mjs
docker compose run --rm --no-deps app node scripts/verify-acceptance-matrix.mjs
docker compose run --rm --no-deps app npm run typecheck
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test
```

Expected: すべて PASS。残存スキャン（Step 4）が AI クォータ文脈で 0。

任意だが推奨: `docker compose run --rm --no-deps app npx vitest run` でフル緑を確認。

- [ ] **Step 7: Commit**

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
- Modify: 全 privacy 用途の `2026-07-11.v1` 参照（generation fixtures、privacy tests、planner returnTo 系）
- Modify: プライバシー説明 UI コピー（有料提供者を含む文面）
- Test: `shared/contracts/domain.test.ts`、`src/features/privacy/**`、生成リクエスト schema テスト

**Interfaces:**
- Consumes: 設計 §7
- Produces: 新 literal のみ受理。旧 version リクエストは Zod で失敗

- [ ] **Step 1: RED**

```ts
export const privacyNoticeVersion = "2026-07-26.v1" as const;
```

`domain.test.ts` を新値に更新。

**必須テスト 1 本:** privacy フィールド（または生成リクエスト body）に旧 `"2026-07-11.v1"` を載せたとき **Zod が失敗**すること。新 version のみ受理。

- [ ] **Step 2: 説明コピー**

利用者向けに、OpenRouter および設定モデルの提供者（有料を含み得る）へプロンプトが渡り得ることを平易な日本語で記載。内部 ID を本文に出さない。

- [ ] **Step 3: 全参照更新**

```bash
# ホストで
grep -R "2026-07-11.v1" --include='*.ts' --include='*.tsx' shared src netlify e2e || true
```

privacy 用途の旧 version を新 version へ。menu `schemaVersion: "2026-07-11.v1"` など **別契約の version は変更しない**。

- [ ] **Step 4: ロールアウト注記**

`docs/runbooks/openrouter.md` に:

- ブラウザと Function を同一デプロイで出す
- 旧同意は無効（再確認必須）
- 版ずれ時は再読み込み（422 系）
- 300s continuation 不整合は fail-closed
- 旧 version 互換パーサは追加しない

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

mock 戻り手順は維持（Task 2 で書いた手順と矛盾させない）。

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
| §4 モデル規則・mock・runtime・AND・単価 | Task 2（fixture 反転・pricing RED 含む） |
| §4.4 ゲート | Task 5 |
| §5 クォータ 3/6/20・SQL・コピー・相互作用 | Task 3（関数権威表・残存スキャン） |
| §7 privacy version・ロールアウト | Task 4（旧 version 拒否テスト必須） |
| §8 docs / matrix / CLAUDE / roadmap | Task 1–3（行 17 は Task 3） |
| §9 テスト・スモーク実費 | Task 2 / 5 |
| §14 PR 分割 | Task 1–5 に対応 |

### 二次検証対応（F1–F10）

| Finding | 対応 |
|---------|------|
| F1 Critical openrouter 有料拒否のまま | Task 2 チェックリスト + Step 6 で non-free 削除と逆転 |
| F2 Critical fixture/context/pricing | Task 2 Step 1–5 必須更新ファイルと RED |
| F3 Important SQL 権威・status 漏れ | Task 3 関数表 + get_ai_generation_status 必須 + conname |
| F4 Important 参照面の広さ | Step 4 スキャン + 検証ファイル拡張 + feedback 除外 |
| F5 Important CLAUDE/roadmap | Task 1 Step 4–5 |
| F6 Important matrix 行 17 | Global + Task 2 触らない / Task 3 確定 |
| F7 Important ローカル .env | Task 2 Step 8 runbook |
| F8 Minor context 既定 | Locked interfaces 注記 |
| F9 Minor Task1 状態 / RED 順 | Task 1 実装中、Task 3 RED 先 |
| F10 Minor 旧 privacy 拒否 | Task 4 必須 1 本 |

### Placeholder scan

TBD/TODO なし。SQL は conname 解決と HEAD での最終 CREATE 特定を指示（架空制約名を固定しない）。

### Type consistency

`parseOpenRouterModels(value, { openRouterBaseUrl })` と `releaseQuota` 3/6、`privacyNoticeVersion` `2026-07-26.v1`、global max 20 を全 Task で共有。

---

## Execution Handoff

Plan revised after secondary review and saved to `docs/superpowers/plans/2026-07-26-paid-openrouter-models.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 各 Task ごとに新規 subagent、Task 間でレビュー
2. **Inline Execution** — このセッションで `executing-plans` に従いチェックポイント付き実行

**Which approach?**
