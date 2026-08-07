import { describe, expect, it } from "vitest";
import {
  shareDenylistVersion,
  shareGuaranteePhrases,
  sharePiiGivenNameStems,
  sharePiiLiteralPhrases,
  textHitsShareDenylist,
} from "./share-denylist.v1.js";

describe("share-denylist.v1", () => {
  it("locks a single denylist version", () => {
    expect(shareDenylistVersion).toBe("2026-08-07.v3");
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
      "さんの",
      "自宅の",
      "本名",
    ] as const) {
      expect(sharePiiLiteralPhrases).toContain(phrase);
      expect(textHitsShareDenylist(`${phrase}残り`), phrase).toBe(true);
    }
  });

  it("AP5: flags unlisted-class given name 健太の before OpenRouter", () => {
    expect(sharePiiGivenNameStems).toContain("健太");
    expect(textHitsShareDenylist("健太の特製だれ")).toBe(true);
    expect(textHitsShareDenylist("美咲は好きな味付け")).toBe(true);
  });

  it("AP5: flags honorific person-name residue beyond closed 太郎 list", () => {
    // リスト外の短い和名 + 敬称（stem 未収録でも拾う）
    expect(textHitsShareDenylist("りおちゃんの残り野菜")).toBe(true);
    expect(textHitsShareDenylist("こうきくんを喜ばせる")).toBe(true);
  });

  it("AP5: flags postal / address-like residue", () => {
    expect(textHitsShareDenylist("届け先 〒100-0001 の食材")).toBe(true);
    expect(textHitsShareDenylist("東京都千代田区の市場で買った")).toBe(true);
  });

  it("does not flag ordinary food phrases", () => {
    expect(textHitsShareDenylist("ごはんを握る")).toBe(false);
    expect(textHitsShareDenylist("にんじん")).toBe(false);
    expect(textHitsShareDenylist("年齢と食欲に合わせた量")).toBe(false);
    expect(textHitsShareDenylist("鶏肉を焼く")).toBe(false);
  });

  it("flags email-like residue", () => {
    expect(textHitsShareDenylist("連絡は family@example.com まで")).toBe(true);
  });
});
