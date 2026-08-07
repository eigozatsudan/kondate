import { describe, expect, it } from "vitest";
import {
  MAX_MULTIPART_BYTES,
  readFlyerRequestBodyWithLimit,
  resolveFlyerIdempotencyKey,
} from "../flyer-weekly.js";
import { HttpError } from "../_shared/http.js";

function formWith(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

describe("resolveFlyerIdempotencyKey", () => {
  it("prefers Idempotency-Key header over form field", () => {
    const request = new Request("http://127.0.0.1/api/flyer-weekly", {
      method: "POST",
      headers: { "Idempotency-Key": "11111111-1111-4111-8111-111111111111" },
    });
    const key = resolveFlyerIdempotencyKey(
      request,
      formWith({ idempotencyKey: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(key).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("accepts form idempotencyKey when header is absent", () => {
    const request = new Request("http://127.0.0.1/api/flyer-weekly", { method: "POST" });
    const key = resolveFlyerIdempotencyKey(
      request,
      formWith({ idempotencyKey: "client-retry-key-01" }),
    );
    expect(key).toBe("client-retry-key-01");
  });

  it("PE4: rejects missing or invalid key without minting a random UUID", () => {
    const request = new Request("http://127.0.0.1/api/flyer-weekly", { method: "POST" });
    expect(() => resolveFlyerIdempotencyKey(request, formWith({}))).toThrow(HttpError);
    expect(() =>
      resolveFlyerIdempotencyKey(request, formWith({ idempotencyKey: "bad key with spaces!!!" })),
    ).toThrow(HttpError);
    try {
      resolveFlyerIdempotencyKey(request, formWith({}));
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    }
  });
});

describe("readFlyerRequestBodyWithLimit (PE10)", () => {
  it("rejects when Content-Length exceeds max before reading body", async () => {
    const request = new Request("http://127.0.0.1/api/flyer-weekly", {
      method: "POST",
      headers: { "content-length": String(MAX_MULTIPART_BYTES + 1) },
      body: "x",
    });
    await expect(readFlyerRequestBodyWithLimit(request, MAX_MULTIPART_BYTES)).rejects.toMatchObject(
      { status: 400, code: "flyer_invalid_image" },
    );
  });

  it("rejects oversized body without Content-Length by counting stream bytes", async () => {
    const max = 16;
    const over = new Uint8Array(max + 4).fill(1);
    const request = new Request("http://127.0.0.1/api/flyer-weekly", {
      method: "POST",
      // CL 欠落: 旧経路は formData 全読後まで拒否できない
      body: over,
    });
    // undici が CL を自動付与する場合はストリーム経路の上限違反として同様に 400
    await expect(readFlyerRequestBodyWithLimit(request, max)).rejects.toMatchObject({
      status: 400,
      code: "flyer_invalid_image",
    });
  });

  it("returns body bytes when under the limit", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const request = new Request("http://127.0.0.1/api/flyer-weekly", {
      method: "POST",
      headers: { "content-length": "4" },
      body: payload,
    });
    await expect(readFlyerRequestBodyWithLimit(request, 16)).resolves.toEqual(payload);
  });
});
