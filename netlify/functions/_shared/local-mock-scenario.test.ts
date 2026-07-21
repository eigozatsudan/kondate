import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "./env.js";
import { LOCAL_OPENROUTER_MOCK_BASE_URL, readLocalMockScenario } from "./local-mock-scenario.js";

const { getServerEnvMock } = vi.hoisted(() => ({
  getServerEnvMock: vi.fn<() => Pick<ServerEnv, "openRouter">>(),
}));

vi.mock("./env.js", () => ({
  getServerEnv: getServerEnvMock,
}));

function requestWithScenario(scenario: string): Request {
  return new Request("http://127.0.0.1:5173/api/generations/menu", {
    method: "POST",
    headers: { "x-kondate-mock-scenario": scenario },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("readLocalMockScenario", () => {
  it("honors the header only for the exact Compose mock base URL", () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { baseUrl: LOCAL_OPENROUTER_MOCK_BASE_URL },
    } as Pick<ServerEnv, "openRouter">);

    expect(readLocalMockScenario(requestWithScenario("duplicate-menu"))).toBe("duplicate-menu");
  });

  it("ignores the header for https://openrouter.ai/api/v1", () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { baseUrl: "https://openrouter.ai/api/v1" },
    } as Pick<ServerEnv, "openRouter">);

    expect(readLocalMockScenario(requestWithScenario("duplicate-menu"))).toBeUndefined();
  });

  it("ignores empty scenario headers even on the local mock base", () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { baseUrl: LOCAL_OPENROUTER_MOCK_BASE_URL },
    } as Pick<ServerEnv, "openRouter">);

    const request = new Request("http://127.0.0.1:5173/api/generations/menu", {
      method: "POST",
      headers: { "x-kondate-mock-scenario": "   " },
    });
    expect(readLocalMockScenario(request)).toBeUndefined();
  });
});
