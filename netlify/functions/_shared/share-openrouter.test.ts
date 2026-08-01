// @vitest-environment node

import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeValidatedMenu } from "../../../shared/testing/factories.js";
import {
  seedOpenRouterRuntimeModelPolicyOkForTests,
  resetOpenRouterRuntimeModelPolicyCacheForTests,
} from "./openrouter.js";
import {
  buildSharePassMessages,
  extractShareFreeTextForPrompt,
  sendShareGeneralizationPass,
  shareFreeTextPatchSchema,
  shareFreeTextResponseFormat,
  type ShareFreeTextPatch,
} from "./share-openrouter.js";

afterEach(() => {
  resetOpenRouterRuntimeModelPolicyCacheForTests();
  vi.restoreAllMocks();
});

function patchFromMenu(): ShareFreeTextPatch {
  return extractShareFreeTextForPrompt(makeValidatedMenu());
}

function successfulResponse(patch: ShareFreeTextPatch, model = "share/model-a"): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: JSON.stringify(patch) } }],
    }),
    { status: 200 },
  );
}

function requestBodyString(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): string {
  const body = fetchImpl.mock.calls[0]?.[1]?.body;
  return typeof body === "string" ? body : "";
}

describe("share-openrouter", () => {
  it("never calls reserve_ai_generation (source and runtime)", async () => {
    const source = await readFile(new URL("./share-openrouter.ts", import.meta.url), "utf8");
    // import / 呼び出し禁止（コメント以外のトークン）
    const importSpecifiers = [
      ...source.matchAll(/from\s+["']([^"']+)["']/gu),
      ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]!);
    expect(importSpecifiers.some((s) => s.includes("generation-repository"))).toBe(false);
    expect(source).not.toMatch(/["']reserve_ai_generation["']/);
    expect(source).not.toMatch(/\.rpc\s*\(\s*["']reserve_ai_generation["']/);

    const patch = patchFromMenu();
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(successfulResponse(patch)));
    seedOpenRouterRuntimeModelPolicyOkForTests();
    await sendShareGeneralizationPass(
      { pass: "pass1", menu: makeValidatedMenu(), timeoutMs: 5_000 },
      {
        apiKey: "secret",
        baseUrl: "https://openrouter.ai/api/v1",
        models: ["share/model-a"],
        timeoutMs: 24_000,
        fetchImpl,
      },
    );
    expect(requestBodyString(fetchImpl)).not.toMatch(/reserve_ai_generation/);
  });

  it("sends strict structured response_format for free-text patch", async () => {
    const patch = patchFromMenu();
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(successfulResponse(patch)));
    seedOpenRouterRuntimeModelPolicyOkForTests();
    await sendShareGeneralizationPass(
      { pass: "pass1", menu: makeValidatedMenu(), timeoutMs: 5_000 },
      {
        apiKey: "secret",
        baseUrl: "https://openrouter.ai/api/v1",
        models: ["share/model-a"],
        timeoutMs: 24_000,
        fetchImpl,
      },
    );
    const rawBody = requestBodyString(fetchImpl);
    expect(rawBody.length).toBeGreaterThan(0);
    const body = JSON.parse(rawBody) as {
      response_format: typeof shareFreeTextResponseFormat;
      models: string[];
    };
    expect(body.response_format).toEqual(shareFreeTextResponseFormat);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.models).toEqual(["share/model-a"]);
  });

  it("parses a valid free-text patch from the model", async () => {
    const base = patchFromMenu();
    const generalized: ShareFreeTextPatch = {
      ...base,
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, name: "朝のごはん", description: "手早く作れる主食" } : dish,
      ),
    };
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(successfulResponse(generalized, "share/model-b")),
    );
    seedOpenRouterRuntimeModelPolicyOkForTests();
    const result = await sendShareGeneralizationPass(
      { pass: "pass2", menu: makeValidatedMenu(), timeoutMs: 5_000 },
      {
        apiKey: "secret",
        baseUrl: "https://openrouter.ai/api/v1",
        models: ["share/model-b"],
        timeoutMs: 24_000,
        fetchImpl,
      },
    );
    expect(result.modelId).toBe("share/model-b");
    expect(result.patch.dishes[0]?.name).toBe("朝のごはん");
    expect(shareFreeTextPatchSchema.safeParse(result.patch).success).toBe(true);
  });

  it("buildSharePassMessages uses pass-specific system role without quantities", () => {
    const menu = makeValidatedMenu();
    const messages = buildSharePassMessages("pass1", menu);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toMatch(/一般化/);
    const user = messages[1]?.content;
    expect(typeof user).toBe("string");
    if (typeof user !== "string") return;
    expect(user).not.toMatch(/quantityValue|quantityText|"unit"/);
    expect(user).toMatch(/dishes/);
  });
});
