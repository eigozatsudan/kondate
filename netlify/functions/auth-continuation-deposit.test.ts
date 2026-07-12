import { describe, expect, it, vi } from "vitest";
import { config, createHandler } from "./auth-continuation-deposit.js";

describe("auth continuation deposit", () => {
  it("reads the ID only from the route params and rejects an ID in JSON", async () => {
    expect(config).toMatchObject({
      path: "/api/auth/continuations/:continuationId/callback",
      method: "POST",
      rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
    });
    const deposit = vi.fn().mockResolvedValue(true);
    const handler = createHandler({
      origin: "https://app.test",
      encryptionKey: new Uint8Array(32),
      deposit,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "application/json" },
        body: JSON.stringify({
          id: "10000000-0000-4000-8000-000000000001",
          state: "s".repeat(43),
          code: "code",
        }),
      }),
      { params: { continuationId: "10000000-0000-4000-8000-000000000001" } },
    );
    expect(response.status).toBe(400);
    expect(deposit).not.toHaveBeenCalled();
  });
});
