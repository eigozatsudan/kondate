// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeUnit } from "./normalize.js";

describe("normalizeUnit (PE8)", () => {
  it("maps Japanese gram synonyms to g for pantry/shopping match", () => {
    expect(normalizeUnit("グラム")).toBe("g");
    expect(normalizeUnit("ｇ")).toBe("g");
    expect(normalizeUnit("g")).toBe("g");
    expect(normalizeUnit("G")).toBe("g");
  });

  it("maps ml/L synonyms and leaves unknown units intact", () => {
    expect(normalizeUnit("ミリリットル")).toBe("ml");
    expect(normalizeUnit("ml")).toBe("ml");
    expect(normalizeUnit("リットル")).toBe("l");
    expect(normalizeUnit("本")).toBe("本");
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit("  ")).toBeNull();
  });
});
