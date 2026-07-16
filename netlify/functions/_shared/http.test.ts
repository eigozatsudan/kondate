import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, invalidRequest, parseJson, parseJsonRequest, requireOrigin } from "./http.js";

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

describe("generic JSON boundary", () => {
  it.each([true, false])(
    "rejects a 65,537 byte UTF-8 body with declared length=%s",
    async (declared) => {
      const body = `"${"あ".repeat(21_845)}"`;
      const headers = new Headers({ "content-type": "application/json" });
      if (declared) headers.set("content-length", "65537");
      const promise = parseJson(
        new Request("https://functions.test", { method: "POST", headers, body }),
        z.string(),
      );
      await expect(promise).rejects.toMatchObject({
        status: 413,
        code: "request_too_large",
      } satisfies Partial<HttpError>);
    },
  );
});
