# Paid OpenRouter Response Format Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenRouter の strict structured outputs で受理できる root-object wire schema を導入し、本番の primary + repair 経路と同じ単位で有料モデル構成を評価できるようにする。

**Architecture:** 内部の `AiGenerationResponse` discriminated union は変更せず、provider 境界だけに root-object wire schema と fail-closed adapter を置く。validator の診断コードを先に閉集合化して repair とベンチ証跡の可観測性を確保し、その後 `runGeneration` を使う隔離 production-service harness へベンチを移行する。

**Tech Stack:** TypeScript、Zod、Vitest、Node test runner、Netlify Functions、Docker Compose、OpenRouter API

---

## Global Constraints

- Authority: `docs/superpowers/specs/2026-07-27-paid-openrouter-response-format-revision-proposal.md`
- Parent design: `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`
- Task order is fixed: Task 6 (C) → Task 7 (A) → Task 8 (B) → Task 9 (live N=10).
- Keep internal `aiGenerationResponseSchema` and `AiGenerationResponse` unchanged.
- Do not change 20s/send, 50s/unit, 180s handler, 22s pre-send, quota 3/6/20, price ceiling, provider parameter AND rule, router ban, privacy version, or maximum two recommended IDs.
- Gemini schema reduction and pantry prompt wording are out of scope.
- Every behavior change follows RED → GREEN → refactor. Node/npm commands run through Docker.
- Each Task uses fresh Implementer, Verifier, primary Reviewer, and secondary Reviewer threads as required by `AGENTS.md` and `SubAgents.md`.

### Locked cross-Task interfaces

```ts
export type MenuValidationIssueCode = (typeof menuValidationIssueCodes)[number];

export const aiGenerationWireResponseSchema: z.ZodType<AiGenerationWireResponse>;
export type AiGenerationWireResponse = z.infer<typeof aiGenerationWireResponseSchema>;
export function toAiGenerationResponse(
  wire: AiGenerationWireResponse,
): AiGenerationResponse;

export const paidOpenRouterModelConfigurations = Object.freeze([
  Object.freeze(["openai/gpt-4.1-nano"]),
  Object.freeze(["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"]),
  Object.freeze(["openai/gpt-4.1-nano", "openai/gpt-oss-120b"]),
]);
```

---

### Task 6: 診断コードを閉集合化して repair・ベンチ証跡へ保持する

**Files:**
- Modify: `shared/contracts/generation.ts`
- Modify: `shared/contracts/generation.test.ts`
- Modify: `shared/safety/validate-generated-menu.ts`
- Modify: `shared/safety/validate-generated-menu.test.ts`
- Modify: `netlify/functions/_shared/generation-repair.ts`
- Modify: `netlify/functions/_shared/generation-repair.test.ts`
- Modify: `netlify/functions/_shared/benchmark-app-response-gate.ts`
- Modify: `netlify/functions/_shared/benchmark-app-response-gate.test.ts`

**Interfaces:**
- Produces the locked `menuValidationIssueCodes` / `MenuValidationIssueCode`.
- Adds `servings_mismatch` to `generationRepairCodes`.
- Maps `servings_mismatch` to the privacy-safe repair path `menu.servings`.
- App-gate validation failure evidence contains only closed issue codes, never issue path/message, prompt, or provider output.

- [ ] **Step 1: Add RED contract and repair tests**

Add a contract test that proves `MenuValidationIssue.code` rejects an arbitrary string at compile time and a repair test that proves every validation code is included:

```ts
import {
  menuValidationIssueCodes,
  type MenuValidationIssue,
} from "../../../shared/contracts/generation.js";

it("covers every menu validation code with a repair code", () => {
  expect(menuValidationIssueCodes.every((code) => generationRepairCodes.includes(code))).toBe(
    true,
  );
});

it("maps servings mismatch to the stable menu path", () => {
  expect(toRepairDiagnostics([{ code: "servings_mismatch", path: "servings" }])).toEqual([
    { code: "servings_mismatch", path: "menu.servings" },
  ]);
});

const closedIssue: MenuValidationIssue = {
  code: "servings_mismatch",
  path: "servings",
  message: "人数が一致しません",
};
expect(closedIssue.code).toBe("servings_mismatch");
```

Keep the existing unknown-code collapse test: unknown provider values still become `invalid_provider_menu`.

- [ ] **Step 2: Add RED validator and app-gate evidence tests**

Extend the existing servings mismatch test to assert the validator emits the closed code. Replace the fixed `validate_generated_menu_fail` expectation with code-only evidence and canaries:

```ts
expect(result).toEqual({
  ok: false,
  detail: "validate_generated_menu_fail",
  validationCodes: ["servings_mismatch"],
});
expect(JSON.stringify(result)).not.toContain("人数が一致しません");
expect(JSON.stringify(result)).not.toContain('"path":');
expect(JSON.stringify(result)).not.toContain('"message":');
```

The assertions must not reject the legitimate `servings_mismatch` code while proving path/message fields are absent.

- [ ] **Step 3: Run RED tests**

Run each command separately:

```bash
docker compose run --rm --no-deps app npx vitest run shared/contracts/generation.test.ts
docker compose run --rm --no-deps app npx vitest run shared/safety/validate-generated-menu.test.ts
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-repair.test.ts
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/benchmark-app-response-gate.test.ts
```

Expected: new tests fail because the closed tuple, repair code/path, and code-only evidence do not exist.

- [ ] **Step 4: Implement the closed validation-code contract**

In `shared/contracts/generation.ts`, define the full set emitted by `validateGeneratedMenu`, `evaluateAllergens`, and `evaluateFoodSafetyRules`:

```ts
export const menuValidationIssueCodes = [
  "invalid_menu_structure",
  "meal_type_mismatch",
  "genre_mismatch",
  "time_limit_exceeded",
  "required_dish_role_missing",
  "main_ingredient_missing",
  "avoid_ingredient_used",
  "pantry_selection_mismatch",
  "prefer_use_reason_missing",
  "pantry_usage_link_mismatch",
  "must_use_missing",
  "unsupported_medical_request",
  "target_member_mismatch",
  "unexpected_label_confirmation",
  "servings_mismatch",
  "member_preference_mismatch",
  "safety_context_incomplete",
  "allergy_unconfirmed",
  "allergen_missing",
  "unmapped_custom_allergy",
  "unsupported_diet_unconfirmed",
  "unsupported_diet_present",
  "missing_label_confirmation",
  "direct_allergen_match",
  "age_shape_rule",
  "required_safety_action",
  "safety_action_contradiction",
] as const;

export type MenuValidationIssueCode = (typeof menuValidationIssueCodes)[number];
export type MenuValidationIssue = {
  code: MenuValidationIssueCode;
  path: string;
  message: string;
};
```

Let TypeScript expose any omitted validator literal; do not widen the type back to `string`.

- [ ] **Step 5: Implement repair coverage and code-only evidence**

Add `"servings_mismatch"` to `generationRepairCodes`, add:

```ts
servings_mismatch: "menu.servings",
```

and keep the `satisfies Record<GenerationRepairCode, string>` exhaustiveness check. Add a type/test inclusion check from `menuValidationIssueCodes` to `generationRepairCodes`.

Change app-gate validation failure to:

```ts
return {
  ok: false,
  detail: "validate_generated_menu_fail",
  validationCodes: validation.issues.map((issue) => issue.code),
};
```

Do not serialize `path`, `message`, prompt text, or raw AI output.

- [ ] **Step 6: Run GREEN and Task verification**

Run the four focused commands from Step 3, then separately:

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
git diff --check
```

Expected: all exit 0.

- [ ] **Step 7: Self-review and commit**

Confirm the validator code tuple is exhaustive, unknown external codes still collapse, the 64-diagnostic cap is unchanged, and no private evidence escaped.

```bash
git add shared/contracts/generation.ts shared/contracts/generation.test.ts shared/safety/validate-generated-menu.ts shared/safety/validate-generated-menu.test.ts netlify/functions/_shared/generation-repair.ts netlify/functions/_shared/generation-repair.test.ts netlify/functions/_shared/benchmark-app-response-gate.ts netlify/functions/_shared/benchmark-app-response-gate.test.ts
git commit -m "fix: 生成検証コードをrepair診断へ欠落なく渡す"
```

---

### Task 7: root-object wire schema と送信全区間の20秒境界を導入する

**Files:**
- Modify: `shared/contracts/generation.ts`
- Modify: `shared/contracts/generation.test.ts`
- Modify: `netlify/functions/_shared/openrouter.ts`
- Modify: `netlify/functions/_shared/openrouter.test.ts`
- Modify: `netlify/functions/_shared/openrouter-mock.test.ts`
- Modify: `netlify/functions/_shared/benchmark-app-response-gate.ts`
- Modify: `netlify/functions/_shared/benchmark-app-response-gate.test.ts`
- Modify: `tools/openrouter-mock/fixtures/menu-response-format.json`
- Modify: `tools/openrouter-mock/server.mjs`
- Modify: `tools/openrouter-mock/server.test.mjs`
- Modify: `scripts/benchmark-paid-openrouter-models.mjs`
- Modify: `scripts/benchmark-paid-openrouter-models.test.mjs`

**Interfaces:**
- Consumes Task 6 code-only validation evidence.
- Produces the locked wire schema and adapter.
- `menuResponseFormat.json_schema.schema` is a root object without `$schema` or root `oneOf`.
- `sendMenuGeneration` parses full-menu responses as wire → adapter and treats elapsed `>= timeoutMs` as `generation_timeout`.
- `replacement_dish` remains unchanged.

- [ ] **Step 1: Add RED wire-schema and adapter tests**

Add tests for valid success/conflict conversion and branch mismatch rejection:

```ts
expect(menuResponseFormat.json_schema.schema).toMatchObject({ type: "object" });
expect(menuResponseFormat.json_schema.schema).not.toHaveProperty("$schema");
expect(menuResponseFormat.json_schema.schema).not.toHaveProperty("oneOf");

expect(
  toAiGenerationResponse({
    outcome: "success",
    menu: validProviderMenu,
    conflicts: null,
  }),
).toEqual({ outcome: "success", menu: validProviderMenu });

expect(() =>
  toAiGenerationResponse({
    outcome: "constraint_conflict",
    menu: null,
    conflicts: [],
  }),
).toThrow();
```

Also cover success with `menu: null`, success with non-empty conflicts, conflict with non-null menu, and unknown keys.

- [ ] **Step 2: Add RED OpenRouter deadline and precedence tests**

Use an injected monotonic `now` dependency or an equivalent deterministic seam. Add:

- 19,999ms completion returns successfully.
- 20,000ms completion throws `OpenRouterCallError("generation_timeout")`.
- JSON parsing, envelope parsing, wire parsing, and adapter work that crosses 20,000ms is timeout, even when the abort callback cannot run during synchronous work.
- body byte-cap detection followed by a pending `reader.cancel()` that races with Abort reports timeout.
- timeout overrides invalid JSON, invalid envelope, outside-model, wire mismatch, adapter failure, and body failure once deadline/Abort is established.

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/openrouter.test.ts
```

Expected: new tests fail against the direct union parse and timer-only implementation.

- [ ] **Step 3: Implement root-object wire schema and fail-closed adapter**

Keep `aiGenerationResponseSchema` unchanged. Add:

```ts
export const aiGenerationWireResponseSchema = z
  .object({
    outcome: z.enum(["success", "constraint_conflict"]),
    menu: aiGeneratedMenuPayloadSchema.nullable(),
    conflicts: z.array(generationConflictSchema).max(12).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.outcome === "success"
        ? value.menu !== null && (value.conflicts === null || value.conflicts.length === 0)
        : value.conflicts !== null && value.conflicts.length >= 1 && value.menu === null,
    { message: "outcome_branch_mismatch" },
  );

export type AiGenerationWireResponse = z.infer<typeof aiGenerationWireResponseSchema>;

export function toAiGenerationResponse(
  wire: AiGenerationWireResponse,
): AiGenerationResponse {
  const parsed = aiGenerationWireResponseSchema.parse(wire);
  if (parsed.outcome === "success") {
    if (parsed.menu === null) throw new Error("outcome_branch_mismatch");
    return { outcome: "success", menu: parsed.menu };
  }
  if (parsed.menu !== null || parsed.conflicts === null || parsed.conflicts.length === 0) {
    throw new Error("outcome_branch_mismatch");
  }
  return { outcome: "constraint_conflict", conflicts: parsed.conflicts };
}
```

Generate `menuResponseFormat` from this schema and remove only the root `$schema` metadata key. Do not encode branch consistency in provider JSON Schema; Zod enforces it after receipt.

- [ ] **Step 4: Implement full send deadline and wire parsing**

Start the monotonic clock at the same point as `AbortController`/`setTimeout`. Centralize deadline precedence:

```ts
const assertWithinDeadline = (): void => {
  if (controller.signal.aborted || now() - startedAt >= timeoutMs) {
    throw new OpenRouterCallError("generation_timeout");
  }
};
```

Apply it after body read, JSON parse, model extraction/check, envelope parse, wire parse, adapter, and immediately before success return. In `catch`, check Abort/deadline before mapping any other error. Keep the timer active until `finally`.

For full-menu responses:

```ts
const wire = aiGenerationWireResponseSchema.safeParse(decodedContent);
if (!wire.success) throw new OpenRouterCallError("invalid_ai_response");
const response = toAiGenerationResponse(wire.data);
assertWithinDeadline();
return { response, responseModel: envelope.data.model };
```

Do not modify replacement-dish parsing.

- [ ] **Step 5: Update mock and benchmark boundaries**

Update the fixture and every mock response to the provider wire shape:

```json
{
  "outcome": "success",
  "menu": {},
  "conflicts": null
}
```

The actual fixture must contain the full generated JSON Schema, not the abbreviated example. Conflict responses use `"menu": null` and a non-empty `"conflicts"` array. Update mock/app-gate tests to parse wire then adapter. Update the benchmark fixture helper and script consumer the same way.

- [ ] **Step 6: Run GREEN and Task verification**

Run separately:

```bash
docker compose run --rm --no-deps app npx vitest run shared/contracts/generation.test.ts
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/openrouter.test.ts
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/openrouter-mock.test.ts
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/benchmark-app-response-gate.test.ts
docker compose run --rm --no-deps app node --test scripts/benchmark-paid-openrouter-models.test.mjs
docker compose run --rm --no-deps app npx vitest run tools/openrouter-mock/server.test.mjs
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
git diff --check
```

Expected: all exit 0 and fixture equality proves the mock mirrors the contract.

- [ ] **Step 7: Self-review and commit**

Confirm there is no internal-union API break, all full-menu provider boundaries use the adapter, timeout has priority over competing body/parse/model errors, and the timer is cleared on every exit.

```bash
git add shared/contracts/generation.ts shared/contracts/generation.test.ts netlify/functions/_shared/openrouter.ts netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/openrouter-mock.test.ts netlify/functions/_shared/benchmark-app-response-gate.ts netlify/functions/_shared/benchmark-app-response-gate.test.ts tools/openrouter-mock/fixtures/menu-response-format.json tools/openrouter-mock/server.mjs tools/openrouter-mock/server.test.mjs scripts/benchmark-paid-openrouter-models.mjs scripts/benchmark-paid-openrouter-models.test.mjs
git commit -m "fix: OpenRouter応答をstrict互換wire形式で受理する"
```

---

### Task 8: exactモデル構成を本番service harnessで評価する

**Files:**
- Create: `netlify/functions/_shared/paid-openrouter-benchmark-harness.ts`
- Create: `netlify/functions/_shared/paid-openrouter-benchmark-harness.test.ts`
- Modify: `netlify/functions/_shared/openrouter.ts`
- Modify: `netlify/functions/_shared/openrouter.test.ts`
- Modify: `scripts/benchmark-paid-openrouter-models.mjs`
- Modify: `scripts/benchmark-paid-openrouter-models.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md`
- Modify: `docs/runbooks/openrouter.md`

**Interfaces:**
- Consumes Task 7 wire adapter and complete 20s send boundary.
- The harness calls exported `runGeneration`; it must not copy private `composeCandidate`.
- Each unit uses a fresh in-memory repository and performs no production DB/quota writes.
- The exact ordered model configuration is identical in `GenerationDependencies.models` and every outgoing OpenRouter request.
- Evidence records configuration order, per-send models, response model, excluded model, primary/repair outcome, elapsed values, and closed failure codes only.

- [ ] **Step 1: Add RED configuration and harness transition tests**

Replace the old shortlist expectation with:

```js
assert.deepEqual(candidateModelIds, [
  "openai/gpt-4.1-nano",
  "meta-llama/llama-3.1-8b-instruct",
  "openai/gpt-oss-120b",
]);
assert.deepEqual(paidOpenRouterModelConfigurations, [
  ["openai/gpt-4.1-nano"],
  ["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"],
  ["openai/gpt-4.1-nano", "openai/gpt-oss-120b"],
]);
```

In the TypeScript harness test, cover:

- primary valid → success, one external send;
- primary invalid with known response model → one repair send excluding that model;
- primary invalid with unknown response model → repair reuses the exact configuration;
- single-model primary invalid with known model → no repair send;
- timeout, model unavailable, and constraint conflict → no repair;
- repair invalid/conflict/call error → no third send;
- fresh repository resets counters between units while preserving markSent/reserveRepair/finalize semantics within one unit;
- 22s pre-send and 50s total boundaries match `runGeneration`.

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/paid-openrouter-benchmark-harness.test.ts
docker compose run --rm --no-deps app node --test scripts/benchmark-paid-openrouter-models.test.mjs
```

Expected: fail because the harness and configuration-level runner do not exist.

- [ ] **Step 2: Make OpenRouter model configuration injectable without changing production defaults**

Refactor `sendMenuGeneration` so production still defaults to `getServerEnv().openRouter.models`, while the harness can pass an exact frozen array. The request body and returned evidence must use that same array:

```ts
type OpenRouterGenerationInput = {
  // existing fields remain
  models?: readonly string[];
};

const configuredModels = input.models ?? config.models;
```

`generation-service` dependencies and OpenRouter call input must agree on this value. Add a test proving an injected array, including order, appears unchanged in the request body.

- [ ] **Step 3: Implement an isolated production-service harness**

Create a harness entry that builds the approved fixed non-PII generation context/prompt, a fresh in-memory `GenerationRepository`, deterministic IDs/clock, and a recording OpenRouter dependency, then calls `runGeneration`.

```ts
export type PaidBenchmarkUnitResult = Readonly<{
  ok: boolean;
  configuration: readonly string[];
  sends: readonly Readonly<{
    models: readonly string[];
    responseModel: string | null;
    excludedModel: string | null;
    elapsedMs: number;
  }>[];
  outcome: "primary_success" | "repair_success" | "failure";
  failureCodes: readonly string[];
  totalElapsedMs: number;
}>;

export async function runPaidBenchmarkUnit(
  input: Readonly<{
    configuration: readonly string[];
    apiKey: string;
    baseUrl: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
  }>,
): Promise<PaidBenchmarkUnitResult>;
```

The repository implements the real interface transitions used by `runGeneration`: lookup/reserve, `markSent`, `reserveRepair`, `recordModel`, fail, succeed/finalize, and status reads. Initialize it anew for every call. Never import a Supabase client.

- [ ] **Step 4: Convert the benchmark from model-ID trials to configuration units**

Mechanical-filter the union of the three shortlist IDs once. A configuration is eligible only when all its IDs survive. For each eligible exact configuration, execute 10 fresh harness units and stop that configuration on first failure.

Output code-only evidence in a deterministic summary:

```js
{
  configuration,
  passedUnits,
  firstAttemptSuccesses,
  sends: [{ models, responseModel, excludedModel, elapsedMs }],
  outcome,
  failureCodes,
}
```

Exit non-zero when no exact configuration passes all 10 units. Recommend only a passing exact configuration, preserving order. Do not combine individual-ID results.

- [ ] **Step 5: Revise design and runbook**

In `2026-07-26-paid-openrouter-models-design.md`:

- replace §4.4 shortlist with the three approved IDs;
- replace §4.4.2 with the approved production-service-harness text from the revision spec;
- replace Key Decision 5 with exact ordered configuration evaluation.

In the runbook, document the three configurations, fresh in-memory ledger, 20s/send, 22s pre-send, 50s/unit, N=10, first-attempt success count, no production DB writes, and non-zero behavior.

- [ ] **Step 6: Run GREEN and Task verification**

Run separately:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/paid-openrouter-benchmark-harness.test.ts
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/generation-service.test.ts
docker compose run --rm --no-deps app node --test scripts/benchmark-paid-openrouter-models.test.mjs
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
git diff --check
```

Expected: all exit 0.

- [ ] **Step 7: Self-review and commit**

Confirm the benchmark uses `runGeneration`, exact arrays do not diverge between service and HTTP body, unit ledgers cannot leak across runs, no PII/raw output is logged, and all design lock values remain unchanged.

```bash
git add netlify/functions/_shared/paid-openrouter-benchmark-harness.ts netlify/functions/_shared/paid-openrouter-benchmark-harness.test.ts netlify/functions/_shared/openrouter.ts netlify/functions/_shared/openrouter.test.ts scripts/benchmark-paid-openrouter-models.mjs scripts/benchmark-paid-openrouter-models.test.mjs docs/superpowers/specs/2026-07-26-paid-openrouter-models-design.md docs/runbooks/openrouter.md
git commit -m "feat: 有料モデル構成を本番生成経路で評価する"
```

---

### Task 9: exact 3構成をlive N=10で再評価する

**Files:**
- Modify: `docs/bugfix/2026-07-27-plan8-production-gate-evidence.md`
- Modify only after a passing configuration exists: `README.md`
- Modify only after a passing configuration exists: `docs/runbooks/openrouter.md`

**Preconditions:**
- Tasks 6–8 are committed, verified, and approved by both review rounds.
- The operator has supplied a funded `OPENROUTER_API_KEY`.
- A total credit hard limit is confirmed.
- `OPENROUTER_BASE_URL` is exactly `https://openrouter.ai/api/v1`.
- External network/cost authorization is available.

- [ ] **Step 1: Run the live configuration benchmark**

```bash
docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs
```

Expected: at least one exact configuration passes 10/10 units. Record first-attempt success count separately. If all three fail, keep the command non-zero, do not propose production env, and record the closed failure evidence.

- [ ] **Step 2: Record evidence without secrets or raw model output**

Record date, commit, exact ordered configurations, unit counts, per-send model arrays/response models/exclusions/elapsed, primary-vs-repair result, closed failure codes, total credit limit confirmation, and final exit code. Never record API key, prompt, path/message, or raw AI output.

- [ ] **Step 3: Update production recommendation only on PASS**

For a passing configuration only:

```dotenv
OPENROUTER_MODELS=openai/gpt-4.1-nano,meta-llama/llama-3.1-8b-instruct
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Use the actual passing exact configuration; do not use the example when it failed. Keep at most two IDs and preserve order. A zero-pass result leaves production ship blocked.

- [ ] **Step 4: Run the full submission gate**

Run every command separately and in this order:

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

Expected: all exit 0. Save summaries, not raw long logs.

- [ ] **Step 5: Commit evidence and recommendation**

Passing case:

```bash
git add docs/bugfix/2026-07-27-plan8-production-gate-evidence.md README.md docs/runbooks/openrouter.md .superpowers/sdd/progress.md
git commit -m "docs: OpenRouter本番モデル構成の合格証跡を記録する"
```

No-pass case:

```bash
git add docs/bugfix/2026-07-27-plan8-production-gate-evidence.md .superpowers/sdd/progress.md
git commit -m "docs: OpenRouterモデル構成の再評価結果を記録する"
```

---

## Self-Review

### Spec coverage

| Approved revision | Task |
|---|---|
| C: closed validator/repair diagnostics | Task 6 |
| A: root-object wire schema and adapter | Task 7 |
| A: 19,999/20,000ms and failure precedence | Task 7 |
| B: production service harness and fresh ledger | Task 8 |
| B: exact ordered configurations and shortlist/design revision | Task 8 |
| Live exact-configuration N=10 and production recommendation | Task 9 |
| Gemini and pantry prompt remain out of scope | Global Constraints |

### Placeholder scan

No `TBD`, `TODO`, “similar to”, or unspecified error-handling steps remain. Task 9 uses a visibly labeled dotenv example and explicitly requires replacing it with the actual passing exact configuration.

### Type consistency

Task 6 exports `MenuValidationIssueCode`; Task 7 preserves `AiGenerationResponse` and exports the wire adapter; Task 8 consumes that adapter through the production send path and exports configuration-level evidence. All later Tasks use the locked names declared above.

---

## Execution Handoff

Use subagent-driven development in this session. Do not pause between Tasks unless a genuine blocker, unresolved Critical/Important finding, unavailable funded-key authorization, or zero passing live configuration prevents progress.
