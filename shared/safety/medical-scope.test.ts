import { expect, it } from "vitest";
import { detectUnsupportedMedicalRequest } from "./medical-scope.js";

it("distinguishes ordinary softness from unsupported medical care", () => {
  expect(detectUnsupportedMedicalRequest("やわらかめが希望です")).toEqual([]);
  expect(detectUnsupportedMedicalRequest("嚥下調整食にして")).toEqual(["swallowing_concern"]);
  expect(detectUnsupportedMedicalRequest("腎臓病の治療食にして")).toContain("therapeutic_diet");
});

it.each(["腎臓病なので塩分を減らした献立にして", "糖尿病の人向けに糖質を抑えて"])(
  "T5-FR-04 detects a natural disease-management request: %s",
  (requestText) => {
    expect(detectUnsupportedMedicalRequest(requestText)).toContain("therapeutic_diet");
  },
);

it.each(["塩分を少し控えめにして", "甘さ控えめにして"])(
  "T5-FR-04 keeps an ordinary preference in scope: %s",
  (requestText) => {
    expect(detectUnsupportedMedicalRequest(requestText)).toEqual([]);
  },
);
