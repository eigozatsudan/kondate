import { describe, expect, it } from "vitest";
import { invalidRequest, parseJsonRequest, requireOrigin } from "./http.js";

describe("continuation HTTP boundary", () => {
  it("requires the exact JSON content type and canonical origin", async () => {
    const request = new Request("https://functions.test", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJsonRequest(request)).resolves.toEqual({ value: "ok" });
    expect(requireOrigin(request, "https://app.test")).toBe(true);
    expect(requireOrigin(request, "https://other.test")).toBe(false);
  });

  it("returns only a closed error for invalid requests", async () => {
    const response = invalidRequest();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "invalid_request", message: "リクエストを確認してください" },
    });
  });
});
