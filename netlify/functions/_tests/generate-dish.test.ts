import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStatusData } from "../../../shared/contracts/generation.js";
import { requireUser } from "../_shared/auth.js";
import {
  createGenerationDeps,
  runGeneration,
  type GenerationDependencies,
} from "../_shared/generation-service.js";
import { HttpError } from "../_shared/http.js";
import { readLocalMockScenario } from "../_shared/local-mock-scenario.js";
import handler from "../generate-dish.js";

vi.mock("../_shared/auth.js", () => ({ requireUser: vi.fn() }));
vi.mock("../_shared/local-mock-scenario.js", () => ({
  readLocalMockScenario: vi.fn(() => undefined),
}));
vi.mock("../_shared/generation-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_shared/generation-service.js")>();
  return {
    ...original,
    createGenerationDeps: vi.fn(),
    runGeneration: vi.fn(),
  };
});

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "token",
};
const requestBody = {
  commandVersion: "generation-command.v2" as const,
  kind: "regenerate_dish" as const,
  request: {
    idempotencyKey: "82000000-0000-4000-8000-000000000001",
    sourceMenuId: "88000000-0000-4000-8000-000000000001",
    dishId: "89000000-0000-4000-8000-000000000001",
    changeReason: "simpler" as const,
    changeReasonCustom: null,
    expiredPantryConfirmations: [],
  },
};
const terminalResult: GenerationStatusData = {
  status: "succeeded",
  idempotencyKey: requestBody.request.idempotencyKey,
  requestId: "81000000-0000-4000-8000-000000000001",
  quota: {
    consumed: true,
    remaining: 4,
    userDailyLimit: 5,
    limitKind: null,
    retryAt: null,
  },
  menuId: "83000000-0000-4000-8000-000000000001",
  completedAt: "2026-07-11T00:00:01.000Z",
};

function postRequest(body: unknown = requestBody): Request {
  return new Request("http://127.0.0.1:5173/api/generations/dish", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(user);
  vi.mocked(createGenerationDeps).mockReturnValue({} as GenerationDependencies);
  vi.mocked(runGeneration).mockResolvedValue(terminalResult);
  vi.mocked(readLocalMockScenario).mockReturnValue(undefined);
});

describe("POST /api/generations/dish", () => {
  it("rejects other methods before authentication", async () => {
    const response = await handler(
      new Request("http://127.0.0.1:5173/api/generations/dish", { method: "GET" }),
    );
    expect(response.status).toBe(405);
    expect(requireUser).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("captures entry time before auth and routes regenerate_dish", async () => {
    const order: string[] = [];
    const now = vi.spyOn(performance, "now").mockImplementation(() => {
      order.push("time");
      return 1234.5;
    });
    vi.mocked(requireUser).mockImplementation(() => {
      order.push("auth");
      return Promise.resolve(user);
    });
    const deps = {} as GenerationDependencies;
    vi.mocked(createGenerationDeps).mockReturnValue(deps);

    const response = await handler(postRequest());

    expect(order.slice(0, 2)).toEqual(["time", "auth"]);
    expect(createGenerationDeps).toHaveBeenCalledWith(user, {
      requestStartedAtMonotonicMs: 1234.5,
    });
    expect(runGeneration).toHaveBeenCalledWith(deps, requestBody);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: terminalResult });
    now.mockRestore();
  });

  it("rejects missing change reason without orchestration", async () => {
    const response = await handler(
      postRequest({
        ...requestBody,
        request: { ...requestBody.request, changeReason: undefined },
      }),
    );
    expect(response.status).toBe(400);
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("maps auth failures", async () => {
    vi.mocked(requireUser).mockRejectedValue(
      new HttpError(401, "auth_required", "ログインが必要です"),
    );
    const response = await handler(postRequest());
    expect(response.status).toBe(401);
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("forwards localTestScenario when the local mock header is honored", async () => {
    vi.mocked(readLocalMockScenario).mockReturnValue("duplicate-menu");
    await handler(
      new Request("http://127.0.0.1:5173/api/generations/dish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
          "x-kondate-mock-scenario": "duplicate-menu",
        },
        body: JSON.stringify(requestBody),
      }),
    );
    const depsArgs = vi.mocked(createGenerationDeps).mock.calls[0];
    expect(depsArgs?.[0]).toEqual(user);
    expect(depsArgs?.[1]).toMatchObject({ localTestScenario: "duplicate-menu" });
    expect(typeof depsArgs?.[1]?.requestStartedAtMonotonicMs).toBe("number");
  });

  it("ignores mock scenario header path when readLocalMockScenario returns undefined", async () => {
    vi.mocked(readLocalMockScenario).mockReturnValue(undefined);
    await handler(
      new Request("http://127.0.0.1:5173/api/generations/dish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
          "x-kondate-mock-scenario": "duplicate-menu",
        },
        body: JSON.stringify(requestBody),
      }),
    );
    const depsArgs = vi.mocked(createGenerationDeps).mock.calls[0];
    expect(depsArgs?.[0]).toEqual(user);
    expect(depsArgs?.[1]).not.toHaveProperty("localTestScenario");
  });
});
