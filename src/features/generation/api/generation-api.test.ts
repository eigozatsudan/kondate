import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import {
  GENERATION_POST_CLIENT_TIMEOUT_MS,
  generationEndpointFor,
  getGenerationStatus,
  postGeneration,
} from "./generation-api";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({ requireAccessToken: requireAccessTokenMock }));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));

const IDEMPOTENCY_KEY = "10000000-0000-4000-8000-000000000001";
const OTHER_KEY = "10000000-0000-4000-8000-000000000002";
const quota = {
  consumed: false,
  remaining: 2,
  userDailyLimit: 3,
  limitKind: null,
  retryAt: null,
} as const;
const processing: GenerationStatusData = {
  status: "processing",
  idempotencyKey: IDEMPOTENCY_KEY,
  requestId: "50000000-0000-4000-8000-000000000001",
  startedAt: "2026-07-11T00:00:00.000Z",
  quota,
};
const newMenuCommand: GenerationCommand = {
  commandVersion: "generation-command.v3",
  kind: "new_menu",
  qualityMode: false,
  request: {
    idempotencyKey: IDEMPOTENCY_KEY,
    draftId: "20000000-0000-4000-8000-000000000001",
    draftRevision: 3,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};
const regenerateMenuCommand: GenerationCommand = {
  commandVersion: "generation-command.v3",
  kind: "regenerate_menu",
  qualityMode: false,
  request: {
    idempotencyKey: IDEMPOTENCY_KEY,
    sourceMenuId: "60000000-0000-4000-8000-000000000001",
    changeReason: "simpler",
    changeReasonCustom: null,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};
const regenerateDishCommand: GenerationCommand = {
  commandVersion: "generation-command.v3",
  kind: "regenerate_dish",
  qualityMode: false,
  request: {
    ...regenerateMenuCommand.request,
    dishId: "70000000-0000-4000-8000-000000000001",
  },
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generation API", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("access-token");
  });

  it.each([
    [newMenuCommand, "/api/generations/menu"],
    [regenerateMenuCommand, "/api/generations/menu"],
    [regenerateDishCommand, "/api/generations/dish"],
  ] as const)("selects the $0.kind endpoint", (command, endpoint) => {
    expect(generationEndpointFor(command)).toBe(endpoint);
  });

  it("posts the canonical request with authentication and a client abort budget", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: processing }, 202)));
    await expect(postGeneration(newMenuCommand, { fetchImpl })).resolves.toEqual(processing);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("/api/generations/menu");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(newMenuCommand));
    expect(init.headers).toEqual({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    // G8: サーバ 55s と整合する POST 専用 AbortSignal（既定 58s）
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBe(58_000);
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBeGreaterThan(55_000);
  });

  it("G8: aborts a hung POST when the client timeout fires", async () => {
    const fetchImpl = vi.fn(
      ((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? null;
          if (signal === null) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        })) as typeof fetch,
    );
    // 実壁時計を短くして AbortSignal.timeout を確定させる（本番既定は 58s）
    await expect(
      postGeneration(newMenuCommand, { fetchImpl, postTimeoutMs: 20 }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses a valid envelope even when response.ok is false", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: processing }, 503)));
    await expect(postGeneration(newMenuCommand, { fetchImpl })).resolves.toEqual(processing);
  });

  it("throws the standard envelope error code", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        response(
          { ok: false, error: { code: "model_unavailable", message: "利用できません" } },
          503,
        ),
      ),
    );
    await expect(postGeneration(newMenuCommand, { fetchImpl })).rejects.toThrow(
      "model_unavailable",
    );
  });

  it("stops before fetch when authentication fails", async () => {
    const fetchImpl = vi.fn();
    requireAccessTokenMock.mockRejectedValue(new Error("auth"));
    await expect(postGeneration(newMenuCommand, { fetchImpl })).rejects.toThrow("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["POST", "GET"] as const)(
    "rejects a valid status envelope whose idempotency key mismatches %s",
    async (method) => {
      const mismatch = { ...processing, idempotencyKey: OTHER_KEY };
      const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: mismatch })));
      const operation =
        method === "POST"
          ? postGeneration(newMenuCommand, { fetchImpl })
          : getGenerationStatus(IDEMPOTENCY_KEY, { fetchImpl });
      await expect(operation).rejects.toBeInstanceOf(z.ZodError);
    },
  );

  it("gets status with a validated encoded key", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: processing })));
    await expect(getGenerationStatus(IDEMPOTENCY_KEY, { fetchImpl })).resolves.toEqual(processing);
    expect(fetchImpl).toHaveBeenCalledWith(`/api/generations/${IDEMPOTENCY_KEY}/status`, {
      method: "GET",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("rejects an invalid GET key before auth or fetch", async () => {
    const fetchImpl = vi.fn();
    requireAccessTokenMock.mockClear();
    await expect(getGenerationStatus("not-a-uuid", { fetchImpl })).rejects.toBeInstanceOf(
      z.ZodError,
    );
    expect(requireAccessTokenMock).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
