import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptedModelLists, rejectedModelLists } from "./openrouter-models-contract.mjs";
import {
  main,
  modelsApiTimeoutMs,
  parseConfiguredModels,
  verifyRemoteModels,
} from "./verify-openrouter-models.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** 成功 remote フィクスチャ用: prompt+completion = $0.30 / 1M（上限 1.0 未満） */
const usablePricing = {
  prompt: "0.0000001",
  completion: "0.0000002",
};

for (const { raw, models, baseUrl } of acceptedModelLists) {
  test(`accepts ordered unique model IDs: ${raw}`, () => {
    assert.deepEqual(parseConfiguredModels(raw, { openRouterBaseUrl: baseUrl }), models);
  });
}

for (const { raw, baseUrl } of rejectedModelLists) {
  test(`rejects unsafe model configuration: ${raw || "empty"}`, () => {
    assert.throws(() => parseConfiguredModels(raw, { openRouterBaseUrl: baseUrl }));
  });
}

test("requires both structured output parameters from every configured model", () => {
  assert.throws(() =>
    verifyRemoteModels(
      ["vendor/a"],
      [
        {
          id: "vendor/a",
          supported_parameters: ["response_format"],
          pricing: usablePricing,
        },
      ],
    ),
  );
});

// fixture は structured_outputs のみ（response_format 欠落）。title を fixture に一致させる。
test("requires response_format when only structured_outputs is present", () => {
  assert.throws(
    () =>
      verifyRemoteModels(
        ["vendor/a"],
        [
          {
            id: "vendor/a",
            supported_parameters: ["structured_outputs"],
            pricing: usablePricing,
          },
        ],
      ),
    /does not support strict structured output/u,
  );
});

test("rejects missing usable pricing", () => {
  assert.throws(
    () =>
      verifyRemoteModels(
        ["vendor/a"],
        [
          {
            id: "vendor/a",
            supported_parameters: ["structured_outputs", "response_format"],
          },
        ],
      ),
    /missing usable pricing/u,
  );
});

// Number(null)===0 / Number("")===0 等で $0 と誤認しない（設計 fail-closed）
for (const [label, pricing] of [
  ["null fields", { prompt: null, completion: null }],
  ["empty strings", { prompt: "", completion: "" }],
  ["booleans", { prompt: false, completion: false }],
  ["whitespace string", { prompt: "  ", completion: "0.0000001" }],
  ["NaN string", { prompt: "NaN", completion: "0.0000001" }],
]) {
  test(`rejects non-numeric pricing coerced by Number(): ${label}`, () => {
    assert.throws(
      () =>
        verifyRemoteModels(
          ["vendor/a"],
          [
            {
              id: "vendor/a",
              supported_parameters: ["structured_outputs", "response_format"],
              pricing,
            },
          ],
        ),
      /missing usable pricing/u,
    );
  });
}

test("rejects prompt+completion above 4 USD per 1M tokens", () => {
  assert.throws(
    () =>
      verifyRemoteModels(
        ["vendor/a"],
        [
          {
            id: "vendor/a",
            supported_parameters: ["structured_outputs", "response_format"],
            // $2.10 + $2.10 = $4.20 / 1M > 4
            pricing: { prompt: "0.0000021", completion: "0.0000021" },
          },
        ],
      ),
    /exceeds max prompt\+completion/u,
  );
});

// F3: 合計上限ちょうど $4.00 / 1M は受理（> のみ拒否）
test("accepts prompt+completion exactly 4 USD per 1M tokens", () => {
  assert.doesNotThrow(() =>
    verifyRemoteModels(
      ["vendor/a"],
      [
        {
          id: "vendor/a",
          supported_parameters: ["structured_outputs", "response_format"],
          // $2.00 + $2.00 = $4.00 / 1M（上限ちょうど）
          pricing: { prompt: "0.000002", completion: "0.000002" },
        },
      ],
    ),
  );
});

// F3: 負の prompt/completion は数値・文字列とも拒否
for (const [label, pricing] of [
  ["numeric negative prompt", { prompt: -0.0000001, completion: "0.0000001" }],
  ["numeric negative completion", { prompt: "0.0000001", completion: -0.0000001 }],
  ["string negative prompt", { prompt: "-0.0000001", completion: "0.0000001" }],
  ["string negative completion", { prompt: "0.0000001", completion: "-0.0000001" }],
]) {
  test(`rejects negative pricing: ${label}`, () => {
    assert.throws(
      () =>
        verifyRemoteModels(
          ["vendor/a"],
          [
            {
              id: "vendor/a",
              supported_parameters: ["structured_outputs", "response_format"],
              pricing,
            },
          ],
        ),
      /missing usable pricing/u,
    );
  });
}

// F3: request / internal_reasoning / cache 系は判定に使わない
// （prompt+completion が合格なら他フィールドが高額でも受理）
test("ignores pricing.request, internal_reasoning, and cache fields when prompt+completion pass", () => {
  assert.doesNotThrow(() =>
    verifyRemoteModels(
      ["vendor/a"],
      [
        {
          id: "vendor/a",
          supported_parameters: ["structured_outputs", "response_format"],
          pricing: {
            ...usablePricing,
            request: "999",
            internal_reasoning: "999",
            input_cache_read: "999",
            input_cache_write: "999",
          },
        },
      ],
    ),
  );
});

test("accepts a model that exposes both structured output parameters and usable pricing", () => {
  assert.doesNotThrow(() =>
    verifyRemoteModels(
      ["vendor/a"],
      [
        {
          id: "vendor/a",
          supported_parameters: ["structured_outputs", "response_format"],
          pricing: usablePricing,
        },
      ],
    ),
  );
});

test("rejects a configured model missing from the remote catalog", () => {
  assert.throws(() => verifyRemoteModels(["vendor/missing"], []));
});

test("bounds the live Models API request and closes transport failures", async () => {
  const signal = AbortSignal.abort(new Error("test abort"));
  const fetchImpl = async (_url, init) => {
    assert.equal(init.signal, signal);
    throw new Error("sensitive transport detail");
  };
  await assert.rejects(
    main(
      {
        OPENROUTER_MODELS: "vendor/a",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      },
      fetchImpl,
      () => signal,
      ["--remote"],
    ),
    /openrouter_models_unavailable/u,
  );
});

test("uses a five-second Models API timeout budget", () => {
  assert.equal(modelsApiTimeoutMs, 5_000);
});

test("skips the remote call without --remote", async () => {
  let called = false;
  await main(
    {
      OPENROUTER_MODELS: "vendor/a",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    },
    async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
    () => AbortSignal.timeout(1),
    [],
  );
  assert.equal(called, false);
});

test("skips remote fetch on exact local mock base even with --remote", async () => {
  let called = false;
  await main(
    {
      OPENROUTER_MODELS: "mock/kondate-primary:free,mock/kondate-repair:free",
      OPENROUTER_BASE_URL: "http://openrouter-mock:8787/api/v1",
    },
    async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
    () => AbortSignal.timeout(1),
    ["--remote"],
  );
  assert.equal(called, false);
});

test("rejects non-official production OPENROUTER_BASE_URL before remote fetch", async () => {
  let called = false;
  await assert.rejects(
    main(
      {
        OPENROUTER_MODELS: "vendor/a",
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
          OPENROUTER_MODELS: "vendor/a",
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
        OPENROUTER_MODELS: "vendor/a",
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
  assert.match(compose, /^\s{6}FUNCTION_TOTAL_BUDGET_MS: "150000"$/mu);
  assert.match(compose, /^\s{6}AI_PROCESSING_STALE_SECONDS: "180"$/mu);
  assert.match(compose, /^\s{6}OPENROUTER_TIMEOUT_MS: "60000"$/mu);
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
