import { describe, expect, it } from "vitest";
import { formatFreeTierQuotaCopy } from "./free-tier.js";

describe("formatFreeTierQuotaCopy", () => {
  it("prefixes 無料版は", () => {
    expect(formatFreeTierQuotaCopy("本日あと3回まで献立の作成を受け付けます")).toBe(
      "無料版は本日あと3回まで献立の作成を受け付けます",
    );
  });

  it("does not double-prefix", () => {
    expect(formatFreeTierQuotaCopy("無料版は本日あと1回まで献立の作成を受け付けます")).toBe(
      "無料版は本日あと1回まで献立の作成を受け付けます",
    );
  });

  it("attempts0 body does not become 無料版は本日は", () => {
    const body =
      "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。";
    const out = formatFreeTierQuotaCopy(body);
    expect(out).toBe(`無料版は${body}`);
    expect(out).not.toMatch(/無料版は本日は/u);
  });

  it("trims then prefixes", () => {
    expect(formatFreeTierQuotaCopy("  あと0回  ")).toBe("無料版はあと0回");
  });

  it("returns empty for blank", () => {
    expect(formatFreeTierQuotaCopy("   ")).toBe("");
  });
});
