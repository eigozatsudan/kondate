import { describe, expect, it } from "vitest";
import { formatPlanQuotaCopy } from "./plan-tier.js";

describe("formatPlanQuotaCopy", () => {
  it("prefixes Free with 無料版は without double prefix", () => {
    expect(formatPlanQuotaCopy("本日の作成上限に達しています。", "free")).toBe(
      "無料版は本日の作成上限に達しています。",
    );
    expect(formatPlanQuotaCopy("無料版は既に付与済み。", "free")).toBe("無料版は既に付与済み。");
  });

  it("keeps Plus body neutral without Free prefix", () => {
    expect(formatPlanQuotaCopy("本日の作成上限に達しています。", "plus")).toBe(
      "本日の作成上限に達しています。",
    );
    expect(formatPlanQuotaCopy("Plusでは1日最大10回まで作成できます。", "plus")).toBe(
      "Plusでは1日最大10回まで作成できます。",
    );
  });

  it("returns empty trim for blank body", () => {
    expect(formatPlanQuotaCopy("  ", "free")).toBe("");
  });
});
