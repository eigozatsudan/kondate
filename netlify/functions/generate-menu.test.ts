import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStatusData } from "../../shared/contracts/generation.js";
import { requireUser } from "./_shared/auth.js";
import {
  createGenerationDeps,
  runGeneration,
  type GenerationDependencies,
} from "./_shared/generation-service.js";
import { HttpError } from "./_shared/http.js";
import handler from "./generate-menu.js";

vi.mock("./_shared/auth.js", () => ({ requireUser: vi.fn() }));
vi.mock("./_shared/generation-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/generation-service.js")>();
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
  idempotencyKey: "82000000-0000-4000-8000-000000000001",
  draftId: "84000000-0000-4000-8000-000000000001",
  draftRevision: 1,
  privacyNoticeVersion: "2026-07-11.v1",
  expiredPantryConfirmations: [],
};
const terminalResult: GenerationStatusData = {
  status: "succeeded",
  idempotencyKey: requestBody.idempotencyKey,
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

function postRequest(body: unknown = requestBody, headers?: Record<string, string>): Request {
  return new Request("http://127.0.0.1:5173/api/generations/menu", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(user);
  vi.mocked(createGenerationDeps).mockReturnValue({} as GenerationDependencies);
  vi.mocked(runGeneration).mockResolvedValue(terminalResult);
});

describe("POST /api/generations/menu", () => {
  it("rejects other methods before authentication or orchestration", async () => {
    const response = await handler(
      new Request("http://127.0.0.1:5173/api/generations/menu", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requireUser).not.toHaveBeenCalled();
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("rejects a request without a verified access token", async () => {
    vi.mocked(requireUser).mockRejectedValue(
      new HttpError(401, "auth_required", "ログインが必要です"),
    );

    const response = await handler(postRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "auth_required", message: "ログインが必要です" },
    });
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{sentinel", "invalid_json"],
    ["unknown field", { ...requestBody, sentinel: true }, "invalid_request"],
    ["missing consent", { ...requestBody, privacyNoticeVersion: undefined }, "invalid_request"],
    ["invalid consent", { ...requestBody, privacyNoticeVersion: "sentinel" }, "invalid_request"],
  ])("rejects %s without orchestration", async (_label, body, code) => {
    const response = await handler(postRequest(body));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code } });
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("rejects an oversized body through the existing parser boundary", async () => {
    const response = await handler(postRequest(requestBody, { "content-length": "65537" }));

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "request_too_large" },
    });
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("keeps the existing boundary without adding origin or content-type requirements", async () => {
    const response = await handler(
      new Request("http://127.0.0.1:5173/api/generations/menu", {
        method: "POST",
        headers: { authorization: "Bearer token", origin: "https://sentinel.invalid" },
        body: JSON.stringify(requestBody),
      }),
    );

    expect(response.status).toBe(200);
    expect(runGeneration).toHaveBeenCalledTimes(1);
  });

  it("captures entry time before authentication and projects terminal replay canonically", async () => {
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
    expect(runGeneration).toHaveBeenCalledTimes(1);
    expect(runGeneration).toHaveBeenCalledWith(deps, {
      kind: "new_menu",
      request: requestBody,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, data: terminalResult });
    now.mockRestore();
  });
});
