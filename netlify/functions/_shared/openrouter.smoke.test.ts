import { describe, expect, it } from "vitest";
import { sendMenuGeneration } from "./openrouter.js";

// --- OpenRouter 有料スモーク用 fail-closed preflight ---
// suite 名は real/paid を示す。標準 Compose の mock base / mock/*:free でも
// RUN_OPENROUTER_SMOKE=1 だけで PASS しないよう、実 fetch 前に公式 URL と有料モデルを強制する。

/** 設計ロック: 公式 OpenRouter base URL（完全一致のみ受理） */
export const OFFICIAL_OPENROUTER_SMOKE_BASE_URL = "https://openrouter.ai/api/v1";

/** openrouter.ts / env.ts と同趣旨の router ID 集合（有料スモークでは常に拒否） */
const OPENROUTER_ROUTER_MODEL_IDS = new Set([
  "openrouter/auto",
  "openrouter/free",
  "openrouter/auto-beta",
]);

export type RealPaidOpenRouterSmokeConfig = {
  baseUrl: string | undefined;
  /** 既に split 済みのモデル ID。カンマ区切り raw は呼び出し側で分割する */
  models: readonly string[] | undefined;
};

/**
 * 有料スモーク実行前の純関数 preflight。
 * mock URL / :free / mock/ / router / 空 models は明示的に Error で失敗する。
 * 実ネットワークは行わない（unit テストからも常に呼ぶ）。
 */
export function assertRealPaidOpenRouterSmokeConfig(config: RealPaidOpenRouterSmokeConfig): void {
  if (config.baseUrl !== OFFICIAL_OPENROUTER_SMOKE_BASE_URL) {
    throw new Error(
      `OpenRouter paid smoke requires OPENROUTER_BASE_URL exactly ${OFFICIAL_OPENROUTER_SMOKE_BASE_URL}; got ${JSON.stringify(config.baseUrl)} (mock/local configs must not pass this suite)`,
    );
  }
  const models = config.models ?? [];
  if (models.length === 0) {
    throw new Error(
      "OpenRouter paid smoke requires at least one non-free model in OPENROUTER_MODELS",
    );
  }
  for (const model of models) {
    if (model.length === 0) {
      throw new Error("OpenRouter paid smoke rejects empty OPENROUTER_MODELS elements");
    }
    if (model.endsWith(":free")) {
      throw new Error(
        `OpenRouter paid smoke rejects :free model: ${model} (use paid allowlist IDs only)`,
      );
    }
    if (model.startsWith("mock/")) {
      throw new Error(
        `OpenRouter paid smoke rejects mock/ model: ${model} (mock path must not pass this suite)`,
      );
    }
    if (OPENROUTER_ROUTER_MODEL_IDS.has(model)) {
      throw new Error(`OpenRouter paid smoke rejects router model ID: ${model}`);
    }
  }
}

/** process.env からスモーク preflight 入力を読む（getServerEnv の mock 受理経路を迂回） */
export function readRealPaidOpenRouterSmokeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RealPaidOpenRouterSmokeConfig {
  const rawModels = env.OPENROUTER_MODELS;
  const models =
    rawModels === undefined ? undefined : rawModels.split(",").map((item) => item.trim());
  return {
    baseUrl: env.OPENROUTER_BASE_URL,
    models,
  };
}

// preflight の unit は SMOKE フラグに依存せず常に実行する（課金・ネットワーク不要）
describe("assertRealPaidOpenRouterSmokeConfig", () => {
  it.each([
    {
      name: "mock base URL",
      config: {
        baseUrl: "http://openrouter-mock:8787/api/v1",
        models: ["mistralai/mistral-small-3.2-24b-instruct"],
      },
      message: /OPENROUTER_BASE_URL exactly|mock\/local/u,
    },
    {
      name: "lookalike base URL",
      config: {
        baseUrl: "https://openrouter.ai/api/v1/extra",
        models: ["mistralai/mistral-small-3.2-24b-instruct"],
      },
      message: /OPENROUTER_BASE_URL exactly/u,
    },
    {
      name: "undefined base URL",
      config: {
        baseUrl: undefined,
        models: ["mistralai/mistral-small-3.2-24b-instruct"],
      },
      message: /OPENROUTER_BASE_URL exactly/u,
    },
    {
      name: "free model on official base",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: ["vendor/a:free"],
      },
      message: /:free model/u,
    },
    {
      name: "mock model on official base",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: ["mock/kondate-primary:free"],
      },
      message: /:free model|mock\/ model/u,
    },
    {
      name: "mock/ prefix without :free",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: ["mock/vendor-paid"],
      },
      message: /mock\/ model/u,
    },
    {
      name: "router openrouter/auto",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: ["openrouter/auto"],
      },
      message: /router model ID/u,
    },
    {
      name: "router openrouter/free",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: ["openrouter/free"],
      },
      message: /router model ID/u,
    },
    {
      name: "router openrouter/auto-beta",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: ["openrouter/auto-beta"],
      },
      message: /router model ID/u,
    },
    {
      name: "empty models",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: [],
      },
      message: /at least one non-free model/u,
    },
    {
      name: "undefined models",
      config: {
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: undefined,
      },
      message: /at least one non-free model/u,
    },
    {
      name: "standard compose mock pair",
      config: {
        baseUrl: "http://openrouter-mock:8787/api/v1",
        models: ["mock/kondate-primary:free", "mock/kondate-repair:free"],
      },
      message: /OPENROUTER_BASE_URL exactly|mock\/local/u,
    },
  ] as const)("rejects $name before any fetch", ({ config, message }) => {
    expect(() => {
      assertRealPaidOpenRouterSmokeConfig(config);
    }).toThrow(message);
  });

  it("accepts official base URL with paid allowlist model shapes", () => {
    expect(() => {
      assertRealPaidOpenRouterSmokeConfig({
        baseUrl: OFFICIAL_OPENROUTER_SMOKE_BASE_URL,
        models: ["mistralai/mistral-small-3.2-24b-instruct", "openai/gpt-oss-120b"],
      });
    }).not.toThrow();
  });

  it("readRealPaidOpenRouterSmokeConfigFromEnv maps OPENROUTER_* env keys", () => {
    const config = readRealPaidOpenRouterSmokeConfigFromEnv({
      OPENROUTER_BASE_URL: "http://openrouter-mock:8787/api/v1",
      OPENROUTER_MODELS: "mock/kondate-primary:free, mock/kondate-repair:free",
    });
    expect(config).toEqual({
      baseUrl: "http://openrouter-mock:8787/api/v1",
      models: ["mock/kondate-primary:free", "mock/kondate-repair:free"],
    });
    // 標準 Compose 相当 env は preflight で明示失敗する
    expect(() => {
      assertRealPaidOpenRouterSmokeConfig(config);
    }).toThrow(/OPENROUTER_BASE_URL exactly|mock\/local/u);
  });
});

// --- OpenRouter実環境スモークテスト ---
// RUN_OPENROUTER_SMOKE=1 を明示設定した場合だけ実行される。
// 通常のテストゲートでは実行されず、実際のOpenRouterへのリクエストは発生しない。
// オペレータが有料 allowlist 上の構造化出力対応モデルを選んで手動実行するためのテスト。
// 注意: 実 API 呼び出しのためクレジット消費（実費）が発生する。
// fail-closed: 公式 base + non-:free / non-mock/ / non-router のみ。mock 成功を実 API 成功と誤認しない。
describe.skipIf(process.env.RUN_OPENROUTER_SMOKE !== "1")("real OpenRouter", () => {
  it("returns one structurally valid response through one application HTTP request", async () => {
    // 実 fetch 前に公式 URL・有料モデルを強制（mock 構成での誤 PASS を防ぐ）
    assertRealPaidOpenRouterSmokeConfig(readRealPaidOpenRouterSmokeConfigFromEnv());
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required");
    // fetch呼出し回数を計測し、内部リトライが発生していないことを確認する
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return originalFetch(...args);
    };
    try {
      const result = await sendMenuGeneration({
        timeoutMs: 20_000,
        messages: [
          { role: "system", content: "指定されたJSON Schemaだけを返してください。" },
          { role: "user", content: "匿名の大人1人向け、15分の和食朝食2品を生成してください。" },
        ],
      });
      expect(result.mode).toBe("full_menu");
      if (result.mode !== "full_menu") throw new Error("expected full_menu");
      expect(["success", "constraint_conflict"]).toContain(result.output.outcome);
      // 有料 allowlist 上の ID が返る（:free 必須ではない）
      expect(result.modelId.length).toBeGreaterThan(0);
      // 1アプリケーションリクエスト = 1 HTTP fetch のみ
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 70_000);
});
