import { describe, expect, it, vi } from "vitest";
import { config, createHandler } from "../auth-continuation-create.js";
import { sha256 } from "../_shared/auth-continuation-crypto.js";

const ORIGIN = "https://app.test";
const STATE = "s".repeat(43);
const SECRET = "k".repeat(43);

function closedErrorBody(status: number, code: string) {
  return {
    status,
    body: {
      ok: false as const,
      error: {
        code,
        message: expect.any(String) as string,
      },
    },
  };
}

describe("auth continuation create", () => {
  it("uses the exact unauthenticated route and never returns a secret", async () => {
    expect(config).toMatchObject({
      path: "/api/auth/continuations",
      method: "POST",
      rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
    });
    const create = vi.fn().mockResolvedValue({
      id: "10000000-0000-4000-8000-000000000001",
      expiresAt: "2026-07-11T00:05:00Z",
    });
    const handler = createHandler({ origin: ORIGIN, ttlSeconds: 300, create });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          state: STATE,
          secret: SECRET,
          returnTo: "/planner",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { id: "10000000-0000-4000-8000-000000000001", expiresAt: "2026-07-11T00:05:00Z" },
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("secret");
  });

  it("rejects missing Origin with a closed invalid_request envelope", async () => {
    const create = vi.fn();
    const handler = createHandler({ origin: ORIGIN, ttlSeconds: 300, create });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, secret: SECRET, returnTo: "/planner" }),
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "invalid_request", message: "リクエストを確認してください" },
    });
    // 開いた error 形状を拒否する（stack / Zod issues / secret を出さない）
    expect(JSON.stringify(body)).not.toMatch(/secret|stack|issues|zod/iu);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects wrong Origin with a closed invalid_request envelope", async () => {
    const create = vi.fn();
    const handler = createHandler({ origin: ORIGIN, ttlSeconds: 300, create });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, secret: SECRET, returnTo: "/planner" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(closedErrorBody(400, "invalid_request").body);
    expect(create).not.toHaveBeenCalled();
  });

  it("hashes state and secret before the create transition and never returns them", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "10000000-0000-4000-8000-000000000002",
      expiresAt: "2026-07-11T00:05:00Z",
    });
    const handler = createHandler({ origin: ORIGIN, ttlSeconds: 300, create });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          state: STATE,
          secret: SECRET,
          returnTo: "/planner",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = create.mock.calls[0]?.[0] as {
      stateHash: Uint8Array;
      secretHash: Uint8Array;
      origin: string;
    };
    expect(payload.origin).toBe(ORIGIN);
    expect(payload.stateHash).toEqual(await sha256(STATE));
    expect(payload.secretHash).toEqual(await sha256(SECRET));
    const text = await response.clone().text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(STATE);
    expect(JSON.parse(text)).not.toHaveProperty("secret");
  });
});
