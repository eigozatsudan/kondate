import { expect, it } from "vitest";
import { resolvePlannerAllergyDisclosure } from "./planner-allergy-disclosure";

it("status=none かつ残存なしはアレルギーなしで選択可", () => {
  expect(
    resolvePlannerAllergyDisclosure({
      allergyStatus: "none",
      allergyNames: [],
      unresolvedAllergyCount: 0,
    }),
  ).toEqual({
    allergyLabel: "アレルギーなし",
    allergyBlockedReason: null,
  });
});

it("status=none でも未解決残存があれば「なし」にせず選択不可 (P3)", () => {
  const result = resolvePlannerAllergyDisclosure({
    allergyStatus: "none",
    allergyNames: [],
    unresolvedAllergyCount: 1,
  });
  expect(result.allergyLabel).toBe("名前を表示できないアレルギー項目があります");
  expect(result.allergyBlockedReason).toMatch(/アレルギー名を確認できない/);
});

it("解決名があれば status=none でも具体名を出し選択可 (H2)", () => {
  expect(
    resolvePlannerAllergyDisclosure({
      allergyStatus: "none",
      allergyNames: ["卵"],
      unresolvedAllergyCount: 0,
    }),
  ).toEqual({
    allergyLabel: "卵",
    allergyBlockedReason: null,
  });
});

it("一部解決+未解決は under-disclosure を label に載せ選択維持", () => {
  const result = resolvePlannerAllergyDisclosure({
    allergyStatus: "registered",
    allergyNames: ["卵"],
    unresolvedAllergyCount: 2,
  });
  expect(result.allergyLabel).toContain("卵");
  expect(result.allergyLabel).toContain("名前を表示できない項目あり");
  expect(result.allergyBlockedReason).toBeNull();
});

it("registered で名前 0 件は選択不可", () => {
  const result = resolvePlannerAllergyDisclosure({
    allergyStatus: "registered",
    allergyNames: [],
    unresolvedAllergyCount: 0,
  });
  expect(result.allergyLabel).toBe("名前を表示できないアレルギー項目があります");
  expect(result.allergyBlockedReason).not.toBeNull();
});
