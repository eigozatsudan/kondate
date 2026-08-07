import { describe, expect, it } from "vitest";
import { deleteAccountEnvelopeSchema, deleteAccountRequestSchema } from "./account.js";

describe("deleteAccountRequestSchema", () => {
  it("accepts only the Japanese confirmation literal", () => {
    expect(deleteAccountRequestSchema.parse({ confirmation: "削除する" })).toEqual({
      confirmation: "削除する",
    });
    expect(deleteAccountRequestSchema.safeParse({ confirmation: "delete" }).success).toBe(false);
  });
});

describe("deleteAccountEnvelopeSchema (S9)", () => {
  it("accepts closed error codes and rejects huge/open messages", () => {
    expect(
      deleteAccountEnvelopeSchema.safeParse({
        ok: true,
        data: { deleted: true },
      }).success,
    ).toBe(true);
    expect(
      deleteAccountEnvelopeSchema.safeParse({
        ok: false,
        error: { code: "unauthorized", message: "もう一度ログインしてください" },
      }).success,
    ).toBe(true);
    expect(
      deleteAccountEnvelopeSchema.safeParse({
        ok: false,
        error: { code: "Unauthorized", message: "ng" },
      }).success,
    ).toBe(false);
    expect(
      deleteAccountEnvelopeSchema.safeParse({
        ok: false,
        error: { code: "request_failed", message: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
