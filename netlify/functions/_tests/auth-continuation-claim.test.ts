import { describe, expect, it, vi } from "vitest";
import { config, createHandler } from "../auth-continuation-claim.js";

describe("auth continuation claim", () => {
  it("uses state and secret binding and hides unavailable continuations", async () => {
    expect(config).toMatchObject({
      path: "/api/auth/continuations/:continuationId/claim",
      method: "POST",
      rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
    });
    const claim = vi.fn().mockResolvedValue(null);
    const handler = createHandler({
      origin: "https://app.test",
      encryptionKey: new Uint8Array(32),
      claim,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "application/json" },
        body: JSON.stringify({ secret: "k".repeat(43), state: "s".repeat(43) }),
      }),
      { params: { continuationId: "10000000-0000-4000-8000-000000000001" } },
    );
    expect(response.status).toBe(404);
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000001",
        origin: "https://app.test",
      }),
    );
  });
});
