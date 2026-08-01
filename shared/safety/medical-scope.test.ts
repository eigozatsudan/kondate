/**
 * 互換: 旧パスのテストを dual-surface 正本へ転送。
 * 詳細ケースは shared/safety-pure/medical-scope.test.ts が正。
 */
import { expect, it } from "vitest";
import { detectUnsupportedMedicalRequest } from "./medical-scope.js";

it("re-exports detectUnsupportedMedicalRequest from safety-pure", () => {
  expect(detectUnsupportedMedicalRequest("嚥下調整食にして")).toEqual(["swallowing_concern"]);
});
