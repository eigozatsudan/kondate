import { expect, it } from "vitest";
import { detectUnsupportedMedicalRequest } from "./medical-scope.js";

it("distinguishes ordinary softness from unsupported medical care", () => {
  expect(detectUnsupportedMedicalRequest("やわらかめが希望です")).toEqual([]);
  expect(detectUnsupportedMedicalRequest("嚥下調整食にして")).toEqual(["swallowing_concern"]);
  expect(detectUnsupportedMedicalRequest("腎臓病の治療食にして")).toContain("therapeutic_diet");
});
