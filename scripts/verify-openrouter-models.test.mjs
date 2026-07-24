import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptedFreeModelLists, rejectedFreeModelLists } from "./openrouter-models-contract.mjs";
import {
  main,
  modelsApiTimeoutMs,
  parseConfiguredModels,
  verifyRemoteModels,
} from "./verify-openrouter-models.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

for (const { raw, models } of acceptedFreeModelLists) {
  test(`accepts ordered unique free model IDs: ${raw}`, () => {
    assert.deepEqual(parseConfiguredModels(raw), models);
  });
}

for (const value of rejectedFreeModelLists) {
  test(`rejects unsafe model configuration: ${value || "empty"}`, () => {
    assert.throws(() => parseConfiguredModels(value));
  });
}

test("requires both structured output parameters from every configured model", () => {
  assert.throws(() =>
    verifyRemoteModels(
      ["vendor/a:free"],
      [
        {
          id: "vendor/a:free",
          supported_parameters: ["response_format"],
        },
      ],
    ),
  );
});

test("requires structured_outputs when only that flag is missing", () => {
  assert.throws(() =>
    verifyRemoteModels(
      ["vendor/a:free"],
      [
        {
          id: "vendor/a:free",
          supported_parameters: ["structured_outputs"],
        },
      ],
    ),
  );
});

test("accepts a model that exposes both structured output parameters", () => {
  assert.doesNotThrow(() =>
    verifyRemoteModels(
      ["vendor/a:free"],
      [
        {
          id: "vendor/a:free",
          supported_parameters: ["structured_outputs", "response_format"],
        },
      ],
    ),
  );
});

test("rejects a configured model missing from the remote catalog", () => {
  assert.throws(() => verifyRemoteModels(["vendor/missing:free"], []));
});

test("bounds the live Models API request and closes transport failures", async () => {
  const signal = AbortSignal.abort(new Error("test abort"));
  const fetchImpl = async (_url, init) => {
    assert.equal(init.signal, signal);
    throw new Error("sensitive transport detail");
  };
  await assert.rejects(
    main({ OPENROUTER_MODELS: "vendor/a:free" }, fetchImpl, () => signal, ["--remote"]),
    /openrouter_models_unavailable/u,
  );
});

test("uses a five-second Models API timeout budget", () => {
  assert.equal(modelsApiTimeoutMs, 5_000);
});

test("skips the remote call without --remote", async () => {
  let called = false;
  await main(
    { OPENROUTER_MODELS: "vendor/a:free" },
    async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
    () => AbortSignal.timeout(1),
    [],
  );
  assert.equal(called, false);
});

test("rejects non-official production OPENROUTER_BASE_URL before remote fetch", async () => {
  let called = false;
  await assert.rejects(
    main(
      {
        OPENROUTER_MODELS: "vendor/a:free",
        CONTEXT: "production",
        OPENROUTER_BASE_URL: "https://openrouter.example/api/v1",
      },
      async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
      () => AbortSignal.timeout(1),
      ["--remote"],
    ),
    /production OPENROUTER_BASE_URL must equal https:\/\/openrouter\.ai\/api\/v1/u,
  );
  assert.equal(called, false);
});

for (const unsafe of [
  "http://openrouter.ai/api/v1",
  "https://openrouter.ai/api/v1/",
  "https://openrouter.ai/api/v1/models",
  "https://user:pass@openrouter.ai/api/v1",
  "https://openrouter.ai/api/v1?x=1",
  "https://openrouter.ai/api/v1#frag",
  "https://evil.openrouter.ai/api/v1",
  "https://openrouter.ai.evil.example/api/v1",
]) {
  test(`rejects production OPENROUTER_BASE_URL lookalike: ${unsafe}`, async () => {
    await assert.rejects(
      main(
        {
          OPENROUTER_MODELS: "vendor/a:free",
          CONTEXT: "production",
          OPENROUTER_BASE_URL: unsafe,
        },
        async () => new Response("{}", { status: 200 }),
        () => AbortSignal.timeout(1),
        [],
      ),
      /production OPENROUTER_BASE_URL must equal https:\/\/openrouter\.ai\/api\/v1/u,
    );
  });
}

test("accepts exact production OPENROUTER_BASE_URL without requiring --remote", async () => {
  await assert.doesNotReject(() =>
    main(
      {
        OPENROUTER_MODELS: "vendor/a:free",
        CONTEXT: "production",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      },
      async () => {
        throw new Error("remote must not run");
      },
      () => AbortSignal.timeout(1),
      [],
    ),
  );
});

// 廃止名をリテラルで置かない（plan の grep 対象 scripts/ で偽陽性になるため）
const obsoleteSyncDeadlineName = ["GENERATION", "SYNC", "DEADLINE", "MS"].join("_");

test("compose locks deadline controls and retires the obsolete sync-deadline env name", () => {
  const compose = readFileSync(join(repoRoot, "compose.yaml"), "utf8");
  assert.match(compose, /^\s{6}FUNCTION_TOTAL_BUDGET_MS: "50000"$/mu);
  assert.match(compose, /^\s{6}AI_PROCESSING_STALE_SECONDS: "180"$/mu);
  assert.match(compose, /^\s{6}OPENROUTER_TIMEOUT_MS: "20000"$/mu);
  assert.equal(compose.includes(obsoleteSyncDeadlineName), false);
});

test("source tree retires the obsolete sync-deadline env name and keeps one budget runtime read", () => {
  const roots = ["compose.yaml", ".env.example", "netlify/functions", "scripts"].map((relative) =>
    join(repoRoot, relative),
  );
  const obsoleteHits = [];

  function walk(path) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry === "node_modules" || entry === ".git") continue;
        walk(join(path, entry));
      }
      return;
    }
    if (!/\.(?:ts|mjs|js|yaml|yml|example|json)$/u.test(path)) return;
    const text = readFileSync(path, "utf8");
    // join で組み立てた完成形のみを検出する（本ファイルの断片は一致しない）
    if (text.includes(obsoleteSyncDeadlineName)) {
      obsoleteHits.push(path);
    }
  }

  for (const root of roots) {
    walk(root);
  }

  assert.deepEqual(obsoleteHits, []);
  // 正本の runtime 写像が env.ts に1系統だけあることを固定する
  const envSource = readFileSync(join(repoRoot, "netlify/functions/_shared/env.ts"), "utf8");
  assert.ok(envSource.includes("functionTotalBudgetMs: result.data.FUNCTION_TOTAL_BUDGET_MS"));
  assert.equal(
    (envSource.match(/functionTotalBudgetMs:\s*result\.data\.FUNCTION_TOTAL_BUDGET_MS/gu) ?? [])
      .length,
    1,
  );
});
