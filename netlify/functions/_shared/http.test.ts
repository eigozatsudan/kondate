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

describe("parseJson content-type and field error closing", () => {
  it("rejects non-JSON content type", async () => {
    const promise = parseJson(
      new Request("https://functions.test", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ ok: true }),
      }),
      z.object({ ok: z.boolean() }),
    );
    await expect(promise).rejects.toMatchObject({
      status: 400,
      code: "invalid_json",
    } satisfies Partial<HttpError>);
  });

  it("accepts application/json with charset and +json", async () => {
    for (const contentType of ["application/json; charset=utf-8", "application/vnd.api+json"]) {
      const value = await parseJson(
        new Request("https://functions.test", {
          method: "POST",
          headers: { "content-type": contentType },
          body: JSON.stringify("ok"),
        }),
        z.string(),
      );
      expect(value).toBe("ok");
    }
  });

  it("maps fieldErrors messages to generic invalid without embedding input", async () => {
    await expect(
      parseJson(
        new Request("https://functions.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x".repeat(3) }),
        }),
        z.object({
          name: z.string().min(10, "名前は10文字以上: 入力値をそのまま出さない"),
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
      details: { fields: { name: ["invalid"] } },
    });
  });
});
