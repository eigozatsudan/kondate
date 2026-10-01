import { describe, expect, it } from "vitest";
import {
  dislikeIdentity,
  dislikeNameLength,
  normalizeDislikeName,
} from "./member-dislike-identity";

describe("dislikeIdentity", () => {
  it("matches after NFKC, trim, and case folding", () => {
    expect(dislikeIdentity("  Ａ  ")).toBe(dislikeIdentity("a"));
    expect(dislikeIdentity("  Pepper ")).toBe("pepper");
    expect(normalizeDislikeName("  Ａ  ")).toBe("A");
  });

  it("does not fold hiragana and katakana", () => {
    expect(dislikeIdentity("ピーマン")).not.toBe(dislikeIdentity("ぴーまん"));
  });
});

describe("dislikeNameLength", () => {
  it("rejects an empty name and a name over 80 characters", () => {
    expect(dislikeNameLength("   ")).toBe("empty");
    expect(dislikeNameLength("あ".repeat(81))).toBe("too_long");
  });

  it("accepts 80 characters after normalization", () => {
    expect(dislikeNameLength(`  ${"あ".repeat(80)}  `)).toBe("ok");
    expect(normalizeDislikeName(`  ${"あ".repeat(80)}  `)).toHaveLength(80);
  });
});
