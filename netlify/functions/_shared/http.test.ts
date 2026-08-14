import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  closedHttpErrorDetails,
  handleError,
  HttpError,
  invalidRequest,
  parseJson,
  parseJsonRequest,
  requireOrigin,
} from "./http.js";

describe("continuation HTTP boundary", () => {
  it("requires a JSON content type and canonical origin", async () => {
    const request = new Request("https://functions.test", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJsonRequest(request)).resolves.toEqual({ value: "ok" });
    expect(requireOrigin(request, "https://app.test")).toBe(true);
    expect(requireOrigin(request, "https://other.test")).toBe(false);
  });

  it("C8: accepts application/json with charset parameters", async () => {
    const request = new Request("https://functions.test", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "https://app.test",
      },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJsonRequest(request)).resolves.toEqual({ value: "ok" });
  });

  it("rejects non-JSON content type for parseJsonRequest", async () => {
    const request = new Request("https://functions.test", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://app.test" },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJsonRequest(request)).rejects.toThrow("invalid_request");
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

describe("S8 closedHttpErrorDetails / handleError", () => {
  it("keeps only fields(invalid) and release_failed true; drops free-text keys", () => {
    expect(
      closedHttpErrorDetails({
        fields: { name: ["入力「太郎」は不可: canary@example.com"] },
        release_failed: true,
        raw: "<user body>",
        message: "内部 stack trace",
        allergy: ["卵"],
      }),
    ).toEqual({
      fields: { name: ["invalid"] },
      release_failed: true,
    });
  });

  it("handleError does not echo free-text details on the wire", async () => {
    const response = handleError(
      new HttpError(400, "invalid_request", "入力内容を確認してください", {
        raw: "secret-body canary@example.com",
        fields: { meal: ["unexpected free text 太郎"] },
        release_failed: true,
      }),
    );
    const body = (await response.json()) as {
      ok: false;
      error: { code: string; details?: Record<string, unknown> };
    };
    expect(body.error.details).toEqual({
      fields: { meal: ["invalid"] },
      release_failed: true,
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("canary@example.com");
    expect(text).not.toContain("太郎");
    expect(text).not.toContain("secret-body");
  });

  it("closes free-text code/message and keeps existing Japanese messages", async () => {
    const leaked = handleError(
      new HttpError(502, "openrouter said: canary@example.com", "stack prompt 太郎"),
    );
    const leakedBody = (await leaked.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(leakedBody.error.code).toBe("request_failed");
    expect(leakedBody.error.message).toBe("処理を完了できませんでした");
    const leakedText = JSON.stringify(leakedBody);
    expect(leakedText).not.toContain("canary@example.com");
    expect(leakedText).not.toContain("太郎");
    expect(leakedText).not.toContain("stack prompt");

    const kept = handleError(new HttpError(400, "invalid_request", "入力内容を確認してください"));
    const keptBody = (await kept.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(keptBody.error.code).toBe("invalid_request");
    expect(keptBody.error.message).toBe("入力内容を確認してください");

    const product = handleError(
      new HttpError(
        400,
        "flyer_unsupported_media",
        "対応している画像形式は JPEG / PNG / WebP です。",
      ),
    );
    const productBody = (await product.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(productBody.error.code).toBe("flyer_unsupported_media");
    expect(productBody.error.message).toBe("対応している画像形式は JPEG / PNG / WebP です。");
  });

  it("omits details entirely when only unknown keys were provided", async () => {
    const response = handleError(
      new HttpError(500, "request_failed", "処理を完了できませんでした", {
        stack: "Error: boom",
        prompt: "sensitive",
      }),
    );
    const body = (await response.json()) as {
      ok: false;
      error: { details?: unknown };
    };
    expect(body.error.details).toBeUndefined();
  });
});
