import { describe, expect, it } from "vitest";
import { makeValidatedMenu } from "../testing/factories.js";
import {
  displayTextHitsGuaranteePhrase,
  validatedMenuHitsGuaranteePhrase,
} from "./guarantee-phrases-display.js";

describe("displayTextHitsGuaranteePhrase", () => {
  it("hits the generation-core phrase 安全です after fold", () => {
    expect(displayTextHitsGuaranteePhrase("小麦アレルギーでも安全です")).toBe(true);
    expect(displayTextHitsGuaranteePhrase("安　全です")).toBe(true);
  });

  it("hits share denylist endorsement phrases", () => {
    expect(displayTextHitsGuaranteePhrase("アレルギーでも安心チキン")).toBe(true);
  });

  it("does not treat the fixed disclaimer as an endorsement", () => {
    expect(displayTextHitsGuaranteePhrase("食べて安全であることを保証するものではありません")).toBe(
      false,
    );
  });
});

describe("validatedMenuHitsGuaranteePhrase", () => {
  it("detects a leftover phrase on a dish description", () => {
    const menu = makeValidatedMenu();
    expect(validatedMenuHitsGuaranteePhrase(menu)).toBe(false);
    const withPhrase = {
      ...menu,
      dishes: menu.dishes.map((dish, index) =>
        index === 0 ? { ...dish, description: "小麦アレルギーでも安全です" } : dish,
      ),
    };
    expect(validatedMenuHitsGuaranteePhrase(withPhrase)).toBe(true);
  });
});
