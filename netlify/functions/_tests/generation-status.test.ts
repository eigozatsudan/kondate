import type { Context } from "@netlify/functions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generationFailureCodes,
  type GenerationFailureCode,
} from "../../../shared/contracts/generation.js";
import { requireUser } from "../_shared/auth.js";
import { createGenerationRepository } from "../_shared/generation-repository.js";
import { HttpError } from "../_shared/http.js";
import handler from "../generation-status.js";

vi.mock("../_shared/auth.js", () => ({ requireUser: vi.fn() }));
vi.mock("../_shared/generation-repository.js", () => ({
  createGenerationRepository: vi.fn(),
}));

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "token",
};
const key = "82000000-0000-4000-8000-000000000001";
const requestId = "81000000-0000-4000-8000-000000000001";
const menuId = "83000000-0000-4000-8000-000000000001";
const completedAt = "2026-07-11T00:00:01.000Z";
const startedAt = "2026-07-11T00:00:00.000Z";
const status = vi.fn();

function context(idempotencyKey?: string): Context {
  return { params: idempotencyKey === undefined ? {} : { idempotencyKey } } as Context;
}

function request(method = "GET"): Request {
  return new Request(`http://127.0.0.1:5173/api/generations/${key}/status`, {
    method,
    headers: { authorization: "Bearer token" },
  });
}

async function responseBody(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

function record(
  state: "not_started" | "processing" | "succeeded" | "failed" | "constraint_conflict",
) {
  return {
    ...(state === "not_started" ? {} : { request_id: requestId }),
    idempotency_key: key,
    status: state,
    failure_code: state === "failed" ? "internal_error" : null,
    retry_at: null,
    completed_menu_id: state === "succeeded" ? menuId : null,
    remaining: state === "succeeded" ? 4 : 5,
    user_daily_limit: 5 as const,
    consumed: state === "succeeded",
    terminal_details:
      state === "constraint_conflict" ? { conflictCodes: ["must_use_conflict"] } : null,
    started_at: state === "not_started" ? undefined : startedAt,
    completed_at: ["not_started", "processing"].includes(state) ? null : completedAt,
    replayed: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(user);
  vi.mocked(createGenerationRepository).mockReturnValue({ status } as never);
  status.mockResolvedValue(record("not_started"));
});

describe("GET /api/generations/:idempotencyKey/status", () => {
  it("rejects other methods before authentication or repository access", async () => {
    const response = await handler(request("POST"), context(key));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requireUser).not.toHaveBeenCalled();
    expect(createGenerationRepository).not.toHaveBeenCalled();
  });

  it("rejects a request without a verified access token", async () => {
    vi.mocked(requireUser).mockRejectedValue(
      new HttpError(401, "auth_required", "ログインが必要です"),
    );

    const response = await handler(request(), context(key));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createGenerationRepository).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it.each([[undefined], ["sentinel-path-value"]])(
    "rejects a missing or malformed path key before repository creation",
    async (idempotencyKey) => {
      const response = await handler(request(), context(idempotencyKey));
      const body = await responseBody(response);

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body).toEqual({
        ok: false,
        error: { code: "invalid_request", message: "入力内容を確認してください" },
      });
      expect(JSON.stringify(body)).not.toContain("sentinel-path-value");
      expect(createGenerationRepository).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
    },
  );

  it("makes an owner-scoped missing key indistinguishable from another user's key", async () => {
    const foreignOwnerId = "86000000-0000-4000-8000-000000000001";
    let storedOwnerId: string | null = null;
    const ownerLookups: { authenticatedUserId: string; storedOwnerId: string | null }[] = [];
    vi.mocked(createGenerationRepository).mockImplementation(
      (authenticatedUser) =>
        ({
          status: vi.fn((idempotencyKey: string) => {
            ownerLookups.push({
              authenticatedUserId: authenticatedUser.userId,
              storedOwnerId,
            });
            return Promise.resolve(
              idempotencyKey === key && storedOwnerId === authenticatedUser.userId
                ? record("succeeded")
                : record("not_started"),
            );
          }),
        }) as never,
    );

    const missingResponse = await handler(request(), context(key));
    const missingBody = await responseBody(missingResponse);
    storedOwnerId = foreignOwnerId;
    const otherOwnerResponse = await handler(request(), context(key));
    const otherOwnerBody = await responseBody(otherOwnerResponse);

    expect(otherOwnerResponse.status).toBe(200);
    expect(otherOwnerBody).toEqual(missingBody);
    expect(otherOwnerBody).toMatchObject({ ok: true, data: { status: "not_started" } });
    expect(createGenerationRepository).toHaveBeenNthCalledWith(1, user);
    expect(createGenerationRepository).toHaveBeenNthCalledWith(2, user);
    expect(ownerLookups).toEqual([
      { authenticatedUserId: user.userId, storedOwnerId: null },
      { authenticatedUserId: user.userId, storedOwnerId: foreignOwnerId },
    ]);
  });

  it.each([
    ["not_started", 200],
    ["processing", 202],
    ["succeeded", 200],
    ["constraint_conflict", 200],
  ] as const)("projects %s through the canonical response", async (state, expectedStatus) => {
    status.mockResolvedValue(record(state));

    const response = await handler(request(), context(key));

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { status: state } });
  });

  const expectedFailureStatus: Record<GenerationFailureCode, number> = Object.fromEntries(
    generationFailureCodes.map((code) => [
      code,
      ["user_daily_limit", "user_attempt_limit", "user_short_window_limit"].includes(code)
        ? 429
        : ["global_daily_limit", "model_unavailable", "generation_timeout"].includes(code)
          ? 503
          : 422,
    ]),
  ) as Record<GenerationFailureCode, number>;

  it.each(generationFailureCodes)(
    "projects failed %s through the canonical response",
    async (code) => {
      status.mockResolvedValue({ ...record("failed"), failure_code: code });

      const response = await handler(request(), context(key));

      expect(response.status).toBe(expectedFailureStatus[code]);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: { status: "failed", error: { code } },
      });
    },
  );

  it("closes an unknown stored failure code to the fixed internal error copy", async () => {
    status.mockResolvedValue({ ...record("failed"), failure_code: "sentinel-repository-error" });

    const response = await handler(request(), context(key));
    const body = await responseBody(response);

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      ok: true,
      data: {
        status: "failed",
        error: {
          code: "internal_error",
          message: "献立を作成できませんでした。成功回数には含まれません。",
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("sentinel-repository-error");
  });

  it("closes a repository rejection without reflecting its diagnostic", async () => {
    status.mockRejectedValue(new Error("sentinel-repository-error"));

    const response = await handler(request(), context(key));
    const body = await responseBody(response);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: false,
      error: { code: "request_failed", message: "処理を完了できませんでした" },
    });
    expect(JSON.stringify(body)).not.toContain("sentinel-repository-error");
  });

  it.each([
    ["processing without started_at", { ...record("processing"), started_at: undefined }],
    ["succeeded without completed_at", { ...record("succeeded"), completed_at: null }],
    ["failed without completed_at", { ...record("failed"), completed_at: null }],
    [
      "constraint conflict without completed_at",
      { ...record("constraint_conflict"), completed_at: null },
    ],
    ["succeeded without menu id", { ...record("succeeded"), completed_menu_id: null }],
  ])("closes malformed stored %s to the fixed 500 envelope", async (_label, storedRecord) => {
    status.mockResolvedValue(storedRecord);

    const response = await handler(request(), context(key));
    const body = await responseBody(response);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: false,
      error: { code: "request_failed", message: "処理を完了できませんでした" },
    });
    expect(JSON.stringify(body)).not.toContain("sentinel");
  });
});
