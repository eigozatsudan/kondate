import { describe, expect, it, vi } from "vitest";
import { config, createHandler } from "./auth-continuation-create.js";

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
    const handler = createHandler({ origin: "https://app.test", ttlSeconds: 300, create });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "application/json" },
        body: JSON.stringify({
          state: "s".repeat(43),
          secret: "k".repeat(43),
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
});
