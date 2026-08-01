import { describe, expect, it } from "vitest";
import {
  shareDenylistVersion,
  shareGuaranteePhrases,
  sharePiiLiteralPhrases,
  textHitsShareDenylist,
} from "./share-denylist.v1.js";

describe("share-denylist.v1", () => {
  it("locks a single denylist version", () => {
    expect(shareDenylistVersion).toBe("2026-08-01.v2");
  });

  it("flags guarantee phrase アレルギーでも安心", () => {
    expect(shareGuaranteePhrases).toContain("アレルギーでも安心");
    expect(textHitsShareDenylist("この献立はアレルギーでも安心です")).toBe(true);
  });

  it("flags PII-like ingredient fragment 太郎の", () => {
    expect(sharePiiLiteralPhrases).toContain("太郎の");
    expect(textHitsShareDenylist("太郎の特製みそ")).toBe(true);
  });

  it("flags expanded kinship / household PII fragments", () => {
    for (const phrase of [
      "うちの",
      "うちの冷蔵庫",
      "弟の",
      "姉の",
      "息子の",
      "娘の",
      "子供の",
      "こどもの",
      "ちゃんの",
      "くんの",
      "自宅の",
      "本名",
    ] as const) {
      expect(sharePiiLiteralPhrases).toContain(phrase);
      expect(textHitsShareDenylist(`${phrase}残り`), phrase).toBe(true);
    }
  });

  it("does not flag ordinary food phrases", () => {
    expect(textHitsShareDenylist("ごはんを握る")).toBe(false);
    expect(textHitsShareDenylist("にんじん")).toBe(false);
    expect(textHitsShareDenylist("年齢と食欲に合わせた量")).toBe(false);
  });

  it("flags email-like residue", () => {
    expect(textHitsShareDenylist("連絡は family@example.com まで")).toBe(true);
  });
});
