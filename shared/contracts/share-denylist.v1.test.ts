import { describe, expect, it } from "vitest";
import {
  shareDenylistVersion,
  shareGuaranteePhrases,
  sharePiiGivenNameBareStems,
  sharePiiGivenNameStems,
  sharePiiLiteralPhrases,
  textHitsShareDenylist,
} from "./share-denylist.v1.js";

describe("share-denylist.v1", () => {
  it("locks a single denylist version", () => {
    expect(shareDenylistVersion).toBe("2026-08-15.v5");
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

  it("AP2: flags 太郎が / suffix-less 太郎 / パパ用 without loosening existing hits", () => {
    expect(sharePiiLiteralPhrases).toContain("太郎が");
    expect(sharePiiLiteralPhrases).toContain("花子が");
    expect(sharePiiLiteralPhrases).toContain("パパ用");
    expect(sharePiiLiteralPhrases).toContain("ママ用");
    expect(sharePiiGivenNameStems).toContain("太郎");
    expect(sharePiiGivenNameStems).toContain("花子");
    expect(sharePiiGivenNameBareStems).toContain("太郎");
    expect(sharePiiGivenNameBareStems).toContain("花子");
    expect(textHitsShareDenylist("太郎が好きなハンバーグ")).toBe(true);
    expect(textHitsShareDenylist("太郎ハンバーグ")).toBe(true);
    expect(textHitsShareDenylist("花子と一緒に")).toBe(true);
    expect(textHitsShareDenylist("パパ用の取り分け")).toBe(true);
    expect(textHitsShareDenylist("ママ用に薄味")).toBe(true);
    expect(textHitsShareDenylist("1歳用の取り分け")).toBe(true);
    // 既存ヒットは緩めない
    expect(textHitsShareDenylist("太郎の特製みそ")).toBe(true);
    expect(textHitsShareDenylist("パパの残り")).toBe(true);
  });

  it("flags 母の / 父の without loosening ママの / パパの", () => {
    expect(sharePiiLiteralPhrases).toContain("母の");
    expect(sharePiiLiteralPhrases).toContain("父の");
    expect(textHitsShareDenylist("母の特製だれ")).toBe(true);
    expect(textHitsShareDenylist("父の残り野菜")).toBe(true);
    expect(textHitsShareDenylist("ママの特製だれ")).toBe(true);
    expect(textHitsShareDenylist("パパの残り")).toBe(true);
  });

  it("flags NFKC / format-control variants of existing needles", () => {
    expect(textHitsShareDenylist("太郎の特製みそ")).toBe(true);
    expect(textHitsShareDenylist("太郎\u200bの特製みそ")).toBe(true);
    expect(textHitsShareDenylist("連絡は family@example.com まで")).toBe(true);
    expect(textHitsShareDenylist("連絡は family＠example.com まで")).toBe(true);
  });

  it("does not flag ordinary food phrases", () => {
    expect(textHitsShareDenylist("ごはんを握る")).toBe(false);
    expect(textHitsShareDenylist("にんじん")).toBe(false);
    expect(textHitsShareDenylist("年齢と食欲に合わせた量")).toBe(false);
    expect(textHitsShareDenylist("鶏肉を焼く")).toBe(false);
    // 食品複合の「桃太郎」は suffix 無し stem で落とさない
    expect(textHitsShareDenylist("桃太郎トマトを切る")).toBe(false);
  });

  it("flags email-like residue", () => {
    expect(textHitsShareDenylist("連絡は family@example.com まで")).toBe(true);
  });
});
