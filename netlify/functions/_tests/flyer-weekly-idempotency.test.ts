import { describe, expect, it } from "vitest";
import { resolveFlyerIdempotencyKey } from "../flyer-weekly.js";

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

  it("server-assigns when key is missing or invalid", () => {
    const request = new Request("http://127.0.0.1/api/flyer-weekly", { method: "POST" });
    const a = resolveFlyerIdempotencyKey(request, formWith({}));
    const b = resolveFlyerIdempotencyKey(
      request,
      formWith({ idempotencyKey: "bad key with spaces!!!" }),
    );
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
    expect(b).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
    expect(a).not.toBe(b);
  });
});
