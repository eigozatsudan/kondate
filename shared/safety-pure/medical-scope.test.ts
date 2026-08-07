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

it.each([
  "とろみをつけてほしい",
  "とろみ付けの食事にして",
  "透析中なので食事を調整して",
  "透析向けの献立にして",
  "CKD の食事制限に合わせて",
  "CKDでタンパク制限の献立",
  "タンパク制限の食事にして",
  "たんぱく制限でお願い",
  "えんげが不安なので柔らかく",
  "透析中なのでメニュー調整",
])("detects paraphrased unsupported medical request: %s", (requestText) => {
  const kinds = detectUnsupportedMedicalRequest(requestText);
  expect(kinds.length).toBeGreaterThan(0);
});

it.each(["とろみがないスープが好き", "透析の話を聞いた", "タンパク質を多めに"])(
  "keeps ordinary non-medical phrasing in scope: %s",
  (requestText) => {
    expect(detectUnsupportedMedicalRequest(requestText)).toEqual([]);
  },
);

it("detects medical keywords with Cf/ZWJ inserted after normalize (S5)", () => {
  // 書式制御 \u200b を挟んでも normalizeFoodTextBase で除去され検出される
  expect(detectUnsupportedMedicalRequest("治\u200b療食")).toContain("therapeutic_diet");
  expect(detectUnsupportedMedicalRequest("嚥\u200b下調整")).toContain("swallowing_concern");
  expect(detectUnsupportedMedicalRequest("離\u200b乳食")).toContain("weaning_food");
  // ラテン略語は lower-case 後も検出
  expect(detectUnsupportedMedicalRequest("CKD の食事制限に合わせて")).toContain("therapeutic_diet");
});
