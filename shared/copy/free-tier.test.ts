import { describe, expect, it } from "vitest";
import { formatFreeTierQuotaCopy } from "./free-tier.js";

describe("formatFreeTierQuotaCopy", () => {
  it("prefixes 無料版は", () => {
    expect(formatFreeTierQuotaCopy("本日あと3回作成できます")).toBe(
      "無料版は本日あと3回作成できます",
    );
  });

  it("does not double-prefix", () => {
    expect(formatFreeTierQuotaCopy("無料版は本日あと1回作成できます")).toBe(
      "無料版は本日あと1回作成できます",
    );
  });

  it("trims then prefixes", () => {
    expect(formatFreeTierQuotaCopy("  あと0回  ")).toBe("無料版はあと0回");
  });

  it("returns empty for blank", () => {
    expect(formatFreeTierQuotaCopy("   ")).toBe("");
  });
});
