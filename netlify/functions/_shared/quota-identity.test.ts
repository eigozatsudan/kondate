import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeQuotaIdentityKey, normalizeQuotaEmail } from "./quota-identity.js";

const secret = Buffer.alloc(32, 9);

describe("normalizeQuotaEmail", () => {
  it("applies NFKC, trims, and lowercases", () => {
    // 全角英字は NFKC で半角へ、前後空白は除去、大文字は小文字へ
    expect(normalizeQuotaEmail("  ＦＯＯ@Example.COM  ")).toBe("foo@example.com");
  });

  it("does not strip plus-tags or dots (non-goal)", () => {
    expect(normalizeQuotaEmail("User+tag@example.com")).toBe("user+tag@example.com");
    expect(normalizeQuotaEmail("u.ser@gmail.com")).toBe("u.ser@gmail.com");
  });
});

describe("computeQuotaIdentityKey", () => {
  it("returns lowercase hex of length 64", () => {
    const key = computeQuotaIdentityKey(secret, "owner@example.com");
    expect(key).toMatch(/^[a-f0-9]{64}$/u);
    expect(key).toBe(
      createHmac("sha256", secret).update("owner@example.com", "utf8").digest("hex"),
    );
  });

  it("is stable across equivalent normalizations", () => {
    const a = computeQuotaIdentityKey(secret, "  Owner@Example.COM ");
    const b = computeQuotaIdentityKey(secret, "owner@example.com");
    expect(a).toBe(b);
  });

  it("differs when the HMAC secret differs", () => {
    const other = Buffer.alloc(32, 1);
    expect(computeQuotaIdentityKey(secret, "a@b.com")).not.toBe(
      computeQuotaIdentityKey(other, "a@b.com"),
    );
  });
});
