# Task 14 Invalid AI Response Test Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task 14の固定OpenRouter mockとE2E入力を整合させ、実HTTP境界を通った正常応答が決定論的validatorで誤って `invalid_ai_response` になる状態を解消する。

**Architecture:** productionのOpenRouter・materializer・validatorは変更しない。テスト用Function Serverへ生成ルートと「handler完了後にクライアント応答だけを破棄する」fault seamを追加し、E2Eは固定 `success` fixtureと同じ朝食・小麦アレルギー条件を作る。Task 15の `/menus/:menuId` routeが未実装でも、生成APIの `succeeded` とroute不在を別々に観測する。

**Tech Stack:** Node.js 24、ESM、TypeScript strict、Vitest、Node Test Runner、Playwright、Docker Compose、Supabase local stack、Netlify fetch-style Functions。

## Global Constraints

- Use Node.js `>=24 <25`; Node 24 is LTS. Do not use Node 26 Current for production.
- Use ESM and TypeScript `strict: true`; do not introduce `any` or unchecked type assertions at network and database boundaries.
- Normal automated tests use the deterministic local OpenRouter mock and consume no external quota.
- Never log names, emails, allergies, free-form conditions, prompts, request bodies, or raw AI responses.
- Every behavior change follows red-green-refactor: failing focused test, observed expected failure, minimum implementation, observed pass, then one small commit.
- `/menus/:menuId` のrouter結線はPlan 3 Task 15へ残す。
- コードコメントとコミットメッセージは `AGENTS.md` に従い日本語にする。
- ユーザーが用意した未コミット4ファイルを破棄、stash、reset、checkoutしない。

---

## File Structure

- `netlify/functions/_shared/generation-adversarial.integration.test.ts`: 固定adversarial scenarioを実 `sendMenuGeneration()` とlocal HTTP mockへ通す。
- `tools/e2e-function-server.mjs`: E2Eで必要な生成Function route、任意path parameter、応答喪失fault seamを提供する。
- `tools/e2e-function-server.test.mjs`: 上記ルーティングと「handlerは完了するがfetchは失敗する」fault seamを検証する。
- `e2e/specs/generation-recovery-results.spec.ts`: 固定success fixtureに一致する家族・planner条件と接続断復旧を検証する。
- `.superpowers/sdd/task-14-report.md`: 修正ラウンドの実測結果と未解決境界を記録する。
- `.superpowers/sdd/progress.md`: Task 14の新しいcommitと正確な状態を追記する。
- `.superpowers/sdd/handoff-plan-3-task-14-to-task-15-<head7>.md`: 新HEAD用のwrite-once handoff。既存handoffは変更しない。

### Task 1: Prove the adversarial service matrix through the local HTTP boundary

**Files:**
- Modify: `netlify/functions/_shared/generation-adversarial.integration.test.ts`

**Interfaces:**
- Consumes: `sendMenuGeneration(input)`, `runGeneration(deps, command)`, `parseServerEnv(env)`, `scenarios`。
- Produces: 8 terminal scenarioについて、実HTTP送信2回以下、予約1回、repair予約1回、primary除外、両model ID、成功永続化なし、成功quota消費なしの回帰証拠。

- [ ] **Step 1: REDの既存service matrixを確認する**

現状の未コミット差分を読み、`callOpenRouter` がfixtureを直接返すmockではなく、次の実関数を使用する設計になっていることを確認する。

```ts
callOpenRouter: sendMenuGeneration,
```

変更前HEAD `d32763b` のtestはlocal HTTP mockを通らないため、Task 14 briefの「Through the real local HTTP mock」を満たさないことがREDである。

- [ ] **Step 2: local HTTP mock向けの厳密な環境を構築する**

`getServerEnv` だけをVitestで差し替え、schema parseは実 `parseServerEnv()` を通す。

```ts
const httpModels = ["mock/kondate-primary:free", "mock/kondate-repair:free"] as const;
const httpMockServerConfig = parseServerEnv({
  VITE_SUPABASE_URL: "http://127.0.0.1:8000",
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
  SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
  AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_CONTINUATION_TTL_SECONDS: "300",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  OPENROUTER_API_KEY: "local-mock-key",
  OPENROUTER_MODELS: httpModels.join(","),
  OPENROUTER_BASE_URL: "http://openrouter-mock:8787/api/v1",
  USER_DAILY_AI_LIMIT: "5",
  USER_DAILY_EXTERNAL_CALL_LIMIT: "12",
  USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4",
  USER_SHORT_WINDOW_SECONDS: "600",
});
```

各caseの前に `OPENROUTER_MOCK_SCENARIO` を設定し、終了後は元の環境へ復元する。

- [ ] **Step 3: service terminal assertionsを完成させる**

各scenarioで次を直接検証する。

```ts
expect(repository.reserve).toHaveBeenCalledTimes(1);
expect(repository.markSent).toHaveBeenCalledTimes(2);
expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
expect(repository.succeed).not.toHaveBeenCalled();
expect(repository.recordModel).toHaveBeenCalledWith(requestId, httpModels[0]);
expect(repository.recordModel).toHaveBeenCalledWith(requestId, httpModels[1]);
expect(result).toMatchObject({ status: "failed", quota: { consumed: false } });
```

mock serverがrepair requestを `models: ["mock/kondate-repair:free"]` 以外では400にするため、repair model記録はHTTP境界でprimaryが除外された証拠になる。

- [ ] **Step 4: focused testを実行してGREENを確認する**

Run:

```bash
docker compose up -d --wait
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-adversarial.integration.test.ts
```

Expected: 18 tests PASS。`openrouter-mock` へ到達できなければskipせずFAILする。

- [ ] **Step 5: Task 1をコミットする**

```bash
git add netlify/functions/_shared/generation-adversarial.integration.test.ts
git commit -m "test: 敵対的生成を実HTTP境界で検証"
```

### Task 2: Align E2E generation context and make response-loss deterministic

**Files:**
- Modify: `tools/e2e-function-server.mjs`
- Modify: `tools/e2e-function-server.test.mjs`
- Modify: `e2e/specs/generation-recovery-results.spec.ts`

**Interfaces:**
- Consumes: exported Netlify Function `config.path` / `config.method`、固定 `scenarios.success` の朝食・小麦label confirmation、`completedOnboardingPage`。
- Produces: `/api/generations/menu`、`/api/generations/:idempotencyKey/status` のE2E routing、`X-Kondate-E2E-Drop-Response: after-handler` fault seam、固定fixtureと一致するE2E入力。

- [ ] **Step 1: Function Serverの失敗をNode testへ固定する**

`tools/e2e-function-server.test.mjs` のfake module mapへ生成routeを追加し、通常routingと任意parameterを検証する。

```js
[
  "/netlify/functions/generate-menu.ts",
  {
    config: { path: "/api/generations/menu", method: "POST" },
    default: async (request) =>
      Response.json({ body: await request.text(), method: request.method }),
  },
],
[
  "/netlify/functions/generation-status.ts",
  {
    config: { path: "/api/generations/:idempotencyKey/status", method: "GET" },
    default: async (_request, context) => Response.json(context.params),
  },
],
```

さらにfault seamについて、handler side effectが完了する一方、client fetchはrejectするtestを追加する。

```js
await assert.rejects(
  fetch(`${origin}/api/generations/menu`, {
    method: "POST",
    headers: { "X-Kondate-E2E-Drop-Response": "after-handler" },
    body: '{"idempotencyKey":"test"}',
  }),
);
assert.equal(generateMenuCalls, 2);
```

Run:

```bash
docker compose run --rm --no-deps app node --test tools/e2e-function-server.test.mjs
```

Expected RED: 生成routeまたはfault seam未実装なら404、fetch resolve、あるいはcall count不一致でFAILする。

- [ ] **Step 2: Function Serverへ生成routeと汎用matcherを実装する**

`functionModulePaths` へ次を追加する。

```js
"/netlify/functions/generate-menu.ts",
"/netlify/functions/generation-status.ts",
```

path parameterを任意名へ一般化する。

```js
if (segment.startsWith(":")) return `(?<${segment.slice(1)}>[^/]+)`;
```

handler完了後、test-only headerが指定された場合だけNode responseを破棄する。

```js
const shouldDropResponse =
  nodeRequest.headers["x-kondate-e2e-drop-response"] === "after-handler";
const functionResponse = await route.handler(request, { params });
if (shouldDropResponse) {
  nodeResponse.destroy();
  return;
}
await writeResponse(functionResponse, nodeResponse);
```

このseamはE2E専用serverにだけ存在し、production Functionには追加しない。

- [ ] **Step 3: Node testをGREENにする**

Run:

```bash
docker compose run --rm --no-deps app node --test tools/e2e-function-server.test.mjs
```

Expected: 全test PASS。

- [ ] **Step 4: E2E前提データのREDを明示する**

現状の320px testを実行し、生成POSTが422 `invalid_ai_response` であることを確認する。

```bash
./scripts/run-e2e.sh e2e/specs/generation-recovery-results.spec.ts --project=desktop-chromium -g "320px"
```

Expected RED: `/api/generations/menu` が422で、DB ledgerはprimary/repair両model IDを持つ。

- [ ] **Step 5: E2E家族・planner条件を固定success fixtureへ合わせる**

`completeMinimumPlanner()` を次の順序にする。

```ts
await page.goto("/settings");
await page.getByLabel("呼び名").fill("家族1");
await page.getByLabel("アレルギーの確認").selectOption("registered");
await page.getByRole("button", { name: "小麦を追加" }).click();
await page.getByRole("button", { name: "この家族の設定を完了" }).click();
await page.goto("/planner");
await page.getByRole("radio", { name: "朝食" }).check();
await page.getByLabel("メイン食材").fill("鶏肉");
await page.getByRole("button", { name: "追加" }).click();
await page.getByRole("radio", { name: "和食" }).check();
await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 10_000 });
```

- [ ] **Step 6: 応答喪失testをfault seamへ切り替える**

POST応答だけを失うtestでは、`route.abort()` や固定3秒待ちを使わず、実handlerを完了させてから接続を破棄する。

```ts
await page.route("**/api/generations/menu", async (route) => {
  await route.continue({
    headers: {
      ...route.request().headers(),
      "X-Kondate-E2E-Drop-Response": "after-handler",
    },
  });
});
await page.getByRole("button", { name: "献立を作る" }).click();
await expect(page.getByText("通信を確認しています")).toBeVisible({ timeout: 10_000 });
```

tab-close testも同じ同期点でpageを閉じ、`/generation` を開き直してpending commandから復旧させる。初回POST acceptance前abort testは既存どおりabort完了をPromiseで待ち、POST回数2回と両key同一を直接assertする。

- [ ] **Step 7: result detail assertionsを固定fixtureの実値へ合わせる**

320px testは空pantry stateと正確な免責を検証する。

```ts
await expect(page.getByText("しょうゆ：小麦")).toBeVisible();
await expect(page.getByText("今回選んだ冷蔵庫食材はありません。")).toBeVisible();
await expect(
  page.getByText(
    "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。",
  ),
).toBeVisible();
```

- [ ] **Step 8: focused E2Eでinvalid response解消を確認する**

Run:

```bash
./scripts/run-e2e.sh e2e/specs/generation-recovery-results.spec.ts --project=desktop-chromium
```

Expected before Task 15: 生成POST/statusは `succeeded` へ到達する。`/menus/:menuId` が未結線のためresult headingで失敗する場合は、そのfailureだけをTask 15 blockerとして区別する。`invalid_ai_response`、404 Function route、固定時間待ちtimeoutは残さない。

- [ ] **Step 9: Task 2のfocused static gatesを実行する**

Run each command independently:

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
git diff --check
```

Expected: all exit 0。

- [ ] **Step 10: Task 2をコミットする**

```bash
git add tools/e2e-function-server.mjs tools/e2e-function-server.test.mjs e2e/specs/generation-recovery-results.spec.ts
git commit -m "fix: E2E生成条件と応答喪失を修正"
```

### Task 3: Run independent verification, review, and issue a safe Task 15 handoff

**Files:**
- Modify: `.superpowers/sdd/task-14-report.md`
- Modify: `.superpowers/sdd/progress.md`
- Create: `.superpowers/sdd/handoff-plan-3-task-14-to-task-15-<head7>.md`

**Interfaces:**
- Consumes: Task 1–2 commits、Task 14 brief、Plan 3設計書、必須gate出力、一次/二次review結果。
- Produces: 実測と一致するTask 14 report/progress、新HEAD専用write-once handoff exact path。

- [ ] **Step 1: mandatory verificationを独立Verifierで実行する**

clean baselineを保存してから、各commandを独立して順番に実行する。

```bash
docker compose config --quiet
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

各Docker command前後でstaged、unstaged、untrackedを比較し、意図しないhost変更があれば停止する。実OpenRouter smokeはoperator secretなしでは実行しない。

- [ ] **Step 2: 一次reviewと独立二次検証を行う**

Task 14開始base `933eecd` ではなく、この修正roundのbase `fe3f349` と最終HEADからreview packageを生成する。新規ReviewerはTask 14 brief、設計書、修正spec、report、packageだけを読み、Spec/Quality verdictとCritical/Important/Minorを報告する。別の新規Reviewerが一次findingを独立に深掘りする。

- [ ] **Step 3: blocking findingがあれば同じTask内で修正を反復する**

CriticalまたはImportantがあればcombined findingsを新規Implementerへ渡し、focused verification、Verifier、一次Reviewer、二次Reviewerを新commitに対して再実行する。open findingがある状態でTask 15 handoffを発行しない。

- [ ] **Step 4: reportとprogressを実測へ更新する**

`task-14-report.md` は以下を区別する。

- `invalid_ai_response` が解消しgenerationが `succeeded` へ到達した証拠。
- 通過したfocused/full gate。
- Task 15の `/menus/:menuId` route待ちで残るE2E failure。
- 実行していないreal OpenRouter smoke。
- 一次/二次review verdictと未解決blocker。

既存のwrite-once handoffは編集しない。

- [ ] **Step 5: 新しいwrite-once handoffを安全に発行する**

最終HEADの小文字7文字を使い、次のexact pathを新規作成する。

```text
.superpowers/sdd/handoff-plan-3-task-14-to-task-15-<head7>.md
```

作成前にGit正本からworktree rootを解決し、全祖先が実directoryかつ非symlink、親canonical pathがworktree内、leaf不存在を確認する。作成後は通常file・非symlink・canonical path・内容とHEADを再確認する。既存leafは絶対に上書きしない。

- [ ] **Step 6: workspace-only記録を再照合してTask 14で停止する**

`.superpowers/` は `.gitignore` 対象なので、report、progress、handoffをforce-addまたはcommitしない。Task 1–2の最終実装commitをHEADとして、三つの記録が同じbranch・HEAD・review結果・gate結果を示すことを再確認する。

```bash
git status --short --branch
git rev-parse HEAD
```

Expected: tracked worktree/indexはcleanで、HEADはhandoff filename/contentの `<head7>` と一致する。Task 15は開始せず、Task 14の結果をユーザーへ報告して停止する。
