import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENROUTER_MAX_BODY_BYTES,
  benchLatencyBudgetMs,
  benchTrialCount,
  candidateModelIds,
  evaluateMechanicalFilter,
  extractDecodedContent,
  filterCandidatesMechanically,
  loadAppResponseGate,
  meetsMinimumSuccessShape,
  readResponseBodyWithByteCap,
  resetAppResponseGateLoaderForTests,
  runOneChatTrial,
  runPaidBenchmark,
  usdPerMillion,
} from "./benchmark-paid-openrouter-models.mjs";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";

/** 成功 remote フィクスチャ: prompt+completion = $0.30 / 1M（上限 0.5 未満） */
const usablePricing = {
  prompt: "0.0000001",
  completion: "0.0000002",
};

const bothParams = ["structured_outputs", "response_format"];

function remoteEntry(id, overrides = {}) {
  return {
    id,
    supported_parameters: bothParams,
    pricing: usablePricing,
    ...overrides,
  };
}

test("candidate shortlist matches design §4.4 five IDs in order", () => {
  assert.deepEqual(
    [...candidateModelIds],
    [
      "mistralai/mistral-small-3.2-24b-instruct",
      "openai/gpt-oss-120b",
      "google/gemma-3-27b-it",
      "qwen/qwen3-30b-a3b-instruct-2507",
      "meta-llama/llama-3.1-8b-instruct",
    ],
  );
});

test("gate constants lock N=10 and 20s latency budget", () => {
  assert.equal(benchTrialCount, 10);
  assert.equal(benchLatencyBudgetMs, 20_000);
  assert.equal(maxPromptPlusCompletionUsdPerMillion, 0.5);
});

test("mechanical filter keeps models with structured AND and usable pricing", () => {
  const byId = new Map([["vendor/a", remoteEntry("vendor/a")]]);
  const result = evaluateMechanicalFilter("vendor/a", byId);
  assert.equal(result.ok, true);
});

test("mechanical filter excludes missing IDs", () => {
  const result = evaluateMechanicalFilter("vendor/missing", new Map());
  assert.equal(result.ok, false);
  assert.match(result.reason, /not present/u);
});

test("mechanical filter requires structured_outputs AND response_format", () => {
  const onlyResponse = evaluateMechanicalFilter(
    "vendor/a",
    new Map([["vendor/a", remoteEntry("vendor/a", { supported_parameters: ["response_format"] })]]),
  );
  assert.equal(onlyResponse.ok, false);
  assert.match(onlyResponse.reason, /AND/u);

  const onlyStructured = evaluateMechanicalFilter(
    "vendor/b",
    new Map([
      ["vendor/b", remoteEntry("vendor/b", { supported_parameters: ["structured_outputs"] })],
    ]),
  );
  assert.equal(onlyStructured.ok, false);
});

test("mechanical filter rejects missing or over-cap pricing", () => {
  const missing = evaluateMechanicalFilter(
    "vendor/a",
    new Map([
      [
        "vendor/a",
        {
          id: "vendor/a",
          supported_parameters: bothParams,
        },
      ],
    ]),
  );
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /pricing/u);

  const over = evaluateMechanicalFilter(
    "vendor/b",
    new Map([
      [
        "vendor/b",
        remoteEntry("vendor/b", {
          // $0.30 + $0.30 = $0.60 / 1M > 0.5
          pricing: { prompt: "0.0000003", completion: "0.0000003" },
        }),
      ],
    ]),
  );
  assert.equal(over.ok, false);
  assert.match(over.reason, /exceeds/u);
});

// Number(null)===0 等で単価 $0 と誤認しない（設計 §4.1.7 fail-closed）
test("usdPerMillion rejects null empty boolean and non-numeric strings", () => {
  assert.equal(usdPerMillion(null), null);
  assert.equal(usdPerMillion(undefined), null);
  assert.equal(usdPerMillion(""), null);
  assert.equal(usdPerMillion("  "), null);
  assert.equal(usdPerMillion(false), null);
  assert.equal(usdPerMillion(true), null);
  assert.equal(usdPerMillion("NaN"), null);
  assert.equal(usdPerMillion(Number.NaN), null);
  assert.equal(usdPerMillion(-0.1), null);
  // 0x0 等は Number() が 0 を返すが 10 進のみ受理するため拒否
  assert.equal(usdPerMillion("0x0"), null);
  assert.equal(usdPerMillion("0x10"), null);
  assert.equal(usdPerMillion("1e-6"), null);
  // 1e-6 USD/token → 1 USD/1M（浮動小数の丸めを避ける代表値）
  assert.equal(usdPerMillion("0.000001"), 1);
  assert.equal(usdPerMillion(0.000001), 1);
  assert.equal(usdPerMillion(0), 0);
});

test("readResponseBodyWithByteCap accepts max bytes and rejects max+1", async () => {
  assert.equal(OPENROUTER_MAX_BODY_BYTES, 1 * 1024 * 1024);
  const exact = "a".repeat(64);
  await assert.doesNotReject(() =>
    readResponseBodyWithByteCap(new Response(exact), 64).then((text) => {
      assert.equal(text, exact);
    }),
  );
  await assert.rejects(
    () => readResponseBodyWithByteCap(new Response("a".repeat(65)), 64),
    /response_body_over_byte_cap/u,
  );
});

test("runOneChatTrial rejects body over the 1 MiB production cap", async () => {
  const oversize = "x".repeat(OPENROUTER_MAX_BODY_BYTES + 1);
  const result = await runOneChatTrial({
    modelId: "vendor/a",
    apiKey: "test-key",
    responseFormat: { type: "json_schema" },
    evaluateGate: () => ({ ok: true, detail: "ok" }),
    fetchImpl: async () => new Response(oversize, { status: 200 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.detail, "response_body_over_byte_cap");
});

test("default loadAppResponseGate path runs without paid credits", async () => {
  resetAppResponseGateLoaderForTests();
  const gate = await loadAppResponseGate();
  assert.equal(typeof gate.evaluateAppResponseGate, "function");
  // 最低キー形状は default loader 経由でも不合格（無課金）
  const weak = {
    model: "vendor/a",
    choices: [
      {
        message: {
          content: JSON.stringify({
            outcome: "success",
            menu: { dishes: [{}] },
            conflicts: null,
          }),
        },
      },
    ],
  };
  const result = gate.evaluateAppResponseGate(weak, "vendor/a");
  assert.equal(result.ok, false);
});

test("mechanical filter rejects pricing fields that Number() would coerce to 0", () => {
  for (const pricing of [
    { prompt: null, completion: "0.0000001" },
    { prompt: "", completion: "0.0000001" },
    { prompt: false, completion: "0.0000001" },
  ]) {
    const result = evaluateMechanicalFilter(
      "vendor/a",
      new Map([["vendor/a", remoteEntry("vendor/a", { pricing })]]),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /pricing/u);
  }
});

test("mechanical filter accepts exact 0.5 USD per 1M boundary", () => {
  // 0.00000025 * 1e6 * 2 = 0.5
  const result = evaluateMechanicalFilter(
    "vendor/a",
    new Map([
      [
        "vendor/a",
        remoteEntry("vendor/a", {
          pricing: { prompt: "0.00000025", completion: "0.00000025" },
        }),
      ],
    ]),
  );
  assert.equal(result.ok, true);
});

test("mechanical filter rejects :free and router IDs without looking up catalog", () => {
  assert.equal(evaluateMechanicalFilter("vendor/a:free", new Map()).ok, false);
  assert.equal(evaluateMechanicalFilter("openrouter/auto", new Map()).ok, false);
  assert.equal(evaluateMechanicalFilter("openrouter/free", new Map()).ok, false);
  assert.equal(evaluateMechanicalFilter("openrouter/auto-beta", new Map()).ok, false);
});

test("filterCandidatesMechanically reports exclusions and survivors", () => {
  const remote = [
    remoteEntry("keep/me"),
    remoteEntry("drop/shape", { supported_parameters: ["response_format"] }),
  ];
  const { survivors, exclusions } = filterCandidatesMechanically(
    ["keep/me", "drop/shape", "drop/missing"],
    remote,
  );
  assert.deepEqual(survivors, ["keep/me"]);
  assert.equal(exclusions.length, 2);
  assert.equal(exclusions[0].id, "drop/shape");
  assert.equal(exclusions[1].id, "drop/missing");
});

test("meetsMinimumSuccessShape is not a production gate (legacy helper only)", () => {
  // 最低キー形状はゲート合格条件ではない。本番ゲートは evaluateAppResponseGate。
  assert.equal(meetsMinimumSuccessShape({ outcome: "success", menu: { dishes: [{}] } }), true);
  assert.equal(meetsMinimumSuccessShape({ outcome: "constraint_conflict", conflicts: [] }), false);
  assert.equal(meetsMinimumSuccessShape(null), false);
});

test("extractDecodedContent parses the first choice message content", () => {
  assert.deepEqual(
    extractDecodedContent({
      choices: [{ message: { content: '{"outcome":"success"}' } }],
    }),
    { outcome: "success" },
  );
  assert.equal(extractDecodedContent({ choices: [] }), null);
  assert.equal(extractDecodedContent({ choices: [{ message: { content: "not-json" } }] }), null);
});

/** ユニット試験用: 本番ゲート成功を差し込む */
function passGate() {
  return { ok: true, detail: "ok" };
}

function failGate() {
  return { ok: false, detail: "ai_generation_schema_fail" };
}

test("runOneChatTrial passes only after gate success and includes post-body elapsed", async () => {
  const payload = { model: "vendor/a", choices: [{ message: { content: "{}" } }] };
  let gateCalls = 0;
  const stamps = [];
  const result = await runOneChatTrial({
    modelId: "vendor/a",
    apiKey: "test-key",
    responseFormat: { type: "json_schema" },
    fetchImpl: async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    evaluateGate: (envelope, modelId) => {
      gateCalls += 1;
      assert.equal(modelId, "vendor/a");
      assert.equal(envelope.model, "vendor/a");
      return passGate(envelope, modelId);
    },
    now: (() => {
      let t = 0;
      return () => {
        t += 25;
        stamps.push(t);
        return t;
      };
    })(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.detail, "ok");
  assert.equal(gateCalls, 1);
  // started と finish の 2 回 now()。elapsed は gate 後に確定する。
  assert.equal(result.elapsedMs, 25);
  assert.equal(stamps.length, 2);
});

test("runOneChatTrial fails on non-200 and app-gate failure", async () => {
  const httpFail = await runOneChatTrial({
    modelId: "vendor/a",
    apiKey: "test-key",
    responseFormat: { type: "json_schema" },
    evaluateGate: passGate,
    fetchImpl: async () => new Response("nope", { status: 403 }),
  });
  assert.equal(httpFail.ok, false);
  assert.match(httpFail.detail, /http_403/u);

  const gateFail = await runOneChatTrial({
    modelId: "vendor/a",
    apiKey: "test-key",
    responseFormat: { type: "json_schema" },
    evaluateGate: failGate,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          model: "vendor/a",
          choices: [
            {
              message: {
                content: '{"outcome":"constraint_conflict","menu":null,"conflicts":[]}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
  });
  assert.equal(gateFail.ok, false);
  assert.equal(gateFail.detail, "ai_generation_schema_fail");
});

test("runOneChatTrial preserves code-only validation evidence", async () => {
  const validationCodes = ["servings_mismatch"];
  const result = await runOneChatTrial({
    modelId: "vendor/a",
    apiKey: "test-key",
    responseFormat: { type: "json_schema" },
    evaluateGate: () => ({
      ok: false,
      detail: "validate_generated_menu_fail",
      validationCodes,
    }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          model: "vendor/a",
          choices: [{ message: { content: "{}" } }],
        }),
        { status: 200 },
      ),
  });

  assert.deepEqual(result, {
    ok: false,
    elapsedMs: result.elapsedMs,
    detail: "validate_generated_menu_fail",
    validationCodes,
  });
});

test("runOneChatTrial fails when elapsed after gate exceeds budget", async () => {
  // started=now(10), finish=now(20) → elapsed 10。timeoutMs 10 なら >= で超過。
  const result = await runOneChatTrial({
    modelId: "vendor/a",
    apiKey: "test-key",
    responseFormat: { type: "json_schema" },
    timeoutMs: 10,
    evaluateGate: passGate,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ model: "vendor/a", choices: [{ message: { content: "{}" } }] }),
        {
          status: 200,
        },
      ),
    now: (() => {
      let t = 0;
      return () => {
        t += 10;
        return t;
      };
    })(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.detail, "latency_budget_exceeded");
});

test("runPaidBenchmark excludes via mechanical filter without chat calls", async () => {
  let chatCalls = 0;
  const logs = [];
  const result = await runPaidBenchmark({
    apiKey: "test-key",
    candidateIds: ["vendor/missing"],
    trialCount: 10,
    evaluateGate: passGate,
    fetchImpl: async (url) => {
      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      chatCalls += 1;
      return new Response("{}", { status: 500 });
    },
    loadFormat: async () => ({ type: "json_schema" }),
    log: (line) => logs.push(line),
  });
  assert.equal(result.ok, false);
  assert.equal(result.survivors.length, 0);
  assert.equal(chatCalls, 0);
  assert.ok(logs.some((line) => line.includes("EXCLUDE vendor/missing")));
});

test("runPaidBenchmark marks pass only when all trials succeed", async () => {
  const successBody = {
    model: "vendor/a",
    choices: [{ message: { content: "{}" } }],
  };
  let chatCalls = 0;
  const result = await runPaidBenchmark({
    apiKey: "test-key",
    candidateIds: ["vendor/a"],
    trialCount: 3,
    evaluateGate: passGate,
    fetchImpl: async (url) => {
      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({ data: [remoteEntry("vendor/a")] }), {
          status: 200,
        });
      }
      chatCalls += 1;
      return new Response(JSON.stringify(successBody), { status: 200 });
    },
    loadFormat: async () => ({ type: "json_schema" }),
    log: () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.passedModels, ["vendor/a"]);
  assert.equal(chatCalls, 3);
});

test("runPaidBenchmark fails and stops trials after first chat failure", async () => {
  let chatCalls = 0;
  const result = await runPaidBenchmark({
    apiKey: "test-key",
    candidateIds: ["vendor/a"],
    trialCount: 10,
    evaluateGate: passGate,
    fetchImpl: async (url) => {
      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({ data: [remoteEntry("vendor/a")] }), {
          status: 200,
        });
      }
      chatCalls += 1;
      return new Response("quota", { status: 403 });
    },
    loadFormat: async () => ({ type: "json_schema" }),
    log: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.passedModels.length, 0);
  // 課金抑制: 1 回失敗で打ち切り
  assert.equal(chatCalls, 1);
});

test("runPaidBenchmark requires API key", async () => {
  await assert.rejects(
    () =>
      runPaidBenchmark({
        apiKey: "",
        evaluateGate: passGate,
        fetchImpl: async () => new Response("{}", { status: 200 }),
        log: () => {},
      }),
    /OPENROUTER_API_KEY/u,
  );
});
