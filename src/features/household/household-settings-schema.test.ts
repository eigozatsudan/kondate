import { describe, expect, it } from "vitest";
import {
  householdSettingsSchema,
  householdSettingsValueFromDbRow,
  persistableHouseholdSettings,
  sanitizeRequiredSafetyConstraintsForAgeBand,
  toHouseholdFieldErrors,
  type HouseholdMemberSettingsRow,
  type HouseholdSettingsFormValue,
} from "./household-settings-schema";

const validRow: HouseholdMemberSettingsRow = {
  display_name: "太郎",
  age_band: "adult",
  allergy_status: "none",
  unsupported_diet_status: "none",
  unsupported_diet_kinds: [],
  required_safety_constraints: [],
  portion_size: "regular",
  spice_level: "regular",
  ease_preferences: [],
};

describe("householdSettingsValueFromDbRow (H12)", () => {
  it("returns schema-valid values for a complete member row without casts", () => {
    const value = householdSettingsValueFromDbRow(validRow);
    const parsed = householdSettingsSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(value).toEqual({
      displayName: "太郎",
      ageBand: "adult",
      allergyStatus: "none",
      unsupportedDietStatus: "none",
      unsupportedDietKinds: [],
      requiredSafetyConstraints: [],
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
    });
  });

  it("maps null required enums to empty selects and adult defaults for portion/spice", () => {
    const value = householdSettingsValueFromDbRow({
      ...validRow,
      display_name: null,
      age_band: null,
      allergy_status: null,
      unsupported_diet_status: null,
      portion_size: null,
      spice_level: null,
    });
    expect(value.displayName).toBeNull();
    expect(value.ageBand).toBe("");
    expect(value.allergyStatus).toBe("");
    expect(value.unsupportedDietStatus).toBe("");
    // null 年齢時の量・辛さは adult 既定（従来 memberValue と同型）
    expect(value.portionSize).toBe("regular");
    expect(value.spiceLevel).toBe("regular");
  });

  it("drops invalid enum scalars to empty or age defaults instead of trusting raw strings", () => {
    const value = householdSettingsValueFromDbRow({
      ...validRow,
      age_band: "legacy_child",
      allergy_status: "maybe",
      unsupported_diet_status: "sometimes",
      portion_size: "huge",
      spice_level: "extra_hot",
    });
    expect(value.ageBand).toBe("");
    expect(value.allergyStatus).toBe("");
    expect(value.unsupportedDietStatus).toBe("");
    // 年齢不正時も adult 既定で量・辛さを埋める（不正文字列を select に載せない）
    expect(value.portionSize).toBe("regular");
    expect(value.spiceLevel).toBe("regular");
  });

  it("uses toddler defaults when age is valid but portion/spice are corrupt", () => {
    const value = householdSettingsValueFromDbRow({
      ...validRow,
      age_band: "age_3_5",
      portion_size: "not-a-size",
      spice_level: "not-a-spice",
    });
    expect(value.ageBand).toBe("age_3_5");
    expect(value.portionSize).toBe("small");
    expect(value.spiceLevel).toBe("none");
  });

  it("filters invalid array elements and caps to schema max", () => {
    const value = householdSettingsValueFromDbRow({
      ...validRow,
      ease_preferences: ["soft", "INVALID", "boneless", "small_pieces", "soft"],
      required_safety_constraints: ["remove_bones", "not_real", "cut_small", "extra"],
      unsupported_diet_kinds: ["weaning_food", "bogus", "therapeutic_diet", "swallowing_concern"],
      unsupported_diet_status: "present",
    });
    expect(value.easePreferences).toEqual(["soft", "boneless", "small_pieces"]);
    // validRow は adult（規則対象外）のため remove_bones は落ち、有効な cut_small だけ残る
    expect(value.requiredSafetyConstraints).toEqual(["cut_small"]);
    // max 3: weaning + therapeutic + swallowing の順で採用し bogus は捨てる
    expect(value.unsupportedDietKinds).toEqual([
      "weaning_food",
      "therapeutic_diet",
      "swallowing_concern",
    ]);
    expect(value.unsupportedDietStatus).toBe("present");
  });

  it("keeps a valid portion when only age_band is corrupt", () => {
    const value = householdSettingsValueFromDbRow({
      ...validRow,
      age_band: "???",
      portion_size: "large",
      spice_level: "mild",
    });
    expect(value.ageBand).toBe("");
    expect(value.portionSize).toBe("large");
    expect(value.spiceLevel).toBe("mild");
  });

  it.each([["post_weaning_to_2"], ["age_3_5"], ["senior"]] as const)(
    "keeps stored remove_bones for rule-applicable band %s",
    (ageBand) => {
      const value = householdSettingsValueFromDbRow({
        ...validRow,
        age_band: ageBand,
        required_safety_constraints: ["remove_bones", "cut_small"],
      });
      expect(value.requiredSafetyConstraints).toEqual(["remove_bones", "cut_small"]);
    },
  );

  it.each([["adult"], ["age_6_8"], ["age_9_12"]] as const)(
    "drops stored remove_bones for non-applicable band %s",
    (ageBand) => {
      // 規則対象外の帯では validator が remove_bones を評価しない。非表示 UI と
      // 保存値が乖離しないようフォーム初期値から落とす（cut_small は残す）。
      const value = householdSettingsValueFromDbRow({
        ...validRow,
        age_band: ageBand,
        required_safety_constraints: ["remove_bones", "cut_small"],
      });
      expect(value.requiredSafetyConstraints).toEqual(["cut_small"]);
    },
  );

  it("H1: maps whitespace-only display_name from DB to null so the form is schema-valid", () => {
    // onboarding が空白のみを書いた行は CHECK を通る。raw のまま残すと trim().min(1) で
    // 安全項目の save 全体が落ちるため、未設定（null）へ正規化する。
    const value = householdSettingsValueFromDbRow({
      ...validRow,
      display_name: "   ",
    });
    expect(value.displayName).toBeNull();
    expect(householdSettingsSchema.safeParse(value).success).toBe(true);
  });
});

const validSettingsValue = {
  displayName: "太郎",
  ageBand: "adult",
  allergyStatus: "none",
  unsupportedDietStatus: "none",
  unsupportedDietKinds: [],
  requiredSafetyConstraints: [],
  portionSize: "regular",
  spiceLevel: "regular",
  easePreferences: [],
} as const;

describe("householdSettingsSchema displayName (H10)", () => {
  it("accepts a 30-character display name and null", () => {
    expect(
      householdSettingsSchema.safeParse({
        ...validSettingsValue,
        displayName: "あ".repeat(30),
      }).success,
    ).toBe(true);
    expect(
      householdSettingsSchema.safeParse({
        ...validSettingsValue,
        displayName: null,
      }).success,
    ).toBe(true);
  });

  it("rejects 31 characters with a Japanese field message, not Zod English", () => {
    const parsed = householdSettingsSchema.safeParse({
      ...validSettingsValue,
      displayName: "あ".repeat(31),
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    const message = toHouseholdFieldErrors(parsed.error).displayName;
    expect(message).toBe("呼び名は30文字以内で入力してください");
    expect(message).not.toMatch(/too big|expected string|characters/iu);
  });

  it("rejects whitespace-only with a Japanese field message, not Zod English", () => {
    // H-R1: 空白のみは value || null で残り、trim 後 min(1) が Zod 4 英語になる
    const parsed = householdSettingsSchema.safeParse({
      ...validSettingsValue,
      displayName: "   ",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    const message = toHouseholdFieldErrors(parsed.error).displayName;
    expect(message).toBe("呼び名は1文字以上で入力してください");
    expect(message).not.toMatch(/too small|expected string|characters/iu);
  });
});

describe("persistableHouseholdSettings (H3)", () => {
  const last: HouseholdSettingsFormValue = {
    displayName: "太郎",
    ageBand: "adult",
    allergyStatus: "none",
    unsupportedDietStatus: "none",
    unsupportedDietKinds: [],
    requiredSafetyConstraints: [],
    portionSize: "regular",
    spiceLevel: "regular",
    easePreferences: [],
  };

  it("returns the full next value when the form is schema-valid", () => {
    const next: HouseholdSettingsFormValue = { ...last, allergyStatus: "unconfirmed" };
    expect(persistableHouseholdSettings(next, last)).toEqual(next);
  });

  it("overlays a valid allergy onto last when age is empty", () => {
    const next: HouseholdSettingsFormValue = {
      ...last,
      ageBand: "",
      allergyStatus: "unconfirmed",
    };
    expect(persistableHouseholdSettings(next, last)).toEqual({
      ...last,
      allergyStatus: "unconfirmed",
    });
  });

  it("does not persist present+empty kinds or the age-linked defaults of an empty age", () => {
    const next: HouseholdSettingsFormValue = {
      ...last,
      ageBand: "",
      portionSize: "small",
      spiceLevel: "none",
      unsupportedDietStatus: "present",
      unsupportedDietKinds: [],
    };
    expect(persistableHouseholdSettings(next, last)).toEqual(last);
  });

  it("H-R2: overlays explicit safety constraints onto last when age is empty", () => {
    const next: HouseholdSettingsFormValue = {
      ...last,
      ageBand: "",
      requiredSafetyConstraints: ["cut_small"],
    };
    expect(persistableHouseholdSettings(next, last)).toEqual({
      ...last,
      requiredSafetyConstraints: ["cut_small"],
    });
  });

  it("does not persist adult empty-age constraint defaults over a child last", () => {
    const lastChild: HouseholdSettingsFormValue = {
      ...last,
      displayName: "子ども",
      ageBand: "age_3_5",
      requiredSafetyConstraints: ["remove_bones", "cut_small"],
      portionSize: "small",
      spiceLevel: "none",
      easePreferences: ["small_pieces", "boneless", "soft"],
    };
    const next: HouseholdSettingsFormValue = {
      ...lastChild,
      ageBand: "",
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
      requiredSafetyConstraints: [],
    };
    expect(persistableHouseholdSettings(next, lastChild)).toEqual(lastChild);
  });

  it("H-R3: keeps last child constraints when empty age then adds only cut_small", () => {
    // 空年齢の adult [] のあと「小さく切る」だけ入れると next は ["cut_small"]。
    // extra group が next で置換すると外していない remove_bones が落ちる。
    const lastChild: HouseholdSettingsFormValue = {
      ...last,
      displayName: "子ども",
      ageBand: "age_3_5",
      requiredSafetyConstraints: ["remove_bones", "cut_small"],
      portionSize: "small",
      spiceLevel: "none",
      easePreferences: ["small_pieces", "boneless", "soft"],
    };
    const next: HouseholdSettingsFormValue = {
      ...lastChild,
      ageBand: "",
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
      requiredSafetyConstraints: ["cut_small"],
    };
    expect(persistableHouseholdSettings(next, lastChild)).toEqual(lastChild);
  });

  it("H-R3: drops legacy age_6_8 remove_bones while unioning explicit cut_small when age is empty", () => {
    // age_6_8 は規則対象外。旧既定で残った remove_bones は和集合で復活しても
    // 出力サニタイズで落とし、全年齢帯で有効な cut_small だけを返す。
    const lastChild: HouseholdSettingsFormValue = {
      ...last,
      displayName: "子ども",
      ageBand: "age_6_8",
      requiredSafetyConstraints: ["remove_bones"],
      portionSize: "regular",
      spiceLevel: "mild",
      easePreferences: ["boneless"],
    };
    const next: HouseholdSettingsFormValue = {
      ...lastChild,
      ageBand: "",
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
      requiredSafetyConstraints: ["cut_small"],
    };
    expect(persistableHouseholdSettings(next, lastChild)).toEqual({
      ...lastChild,
      requiredSafetyConstraints: ["cut_small"],
    });
  });

  it("drops remove_bones from a schema-valid next when its band is not rule-applicable", () => {
    // 対象外帯へ年齢を変えた直後の full parse 成功経路でも、非表示になった
    // remove_bones が保存値に残らないよう返却値をサニタイズする。
    const next: HouseholdSettingsFormValue = {
      ...last,
      requiredSafetyConstraints: ["remove_bones", "cut_small"],
    };
    expect(persistableHouseholdSettings(next, last)).toEqual({
      ...next,
      requiredSafetyConstraints: ["cut_small"],
    });
  });

  it("keeps remove_bones from a schema-valid next when its band is rule-applicable", () => {
    const next: HouseholdSettingsFormValue = {
      ...last,
      ageBand: "senior",
      requiredSafetyConstraints: ["remove_bones", "cut_small"],
    };
    expect(persistableHouseholdSettings(next, last)).toEqual(next);
  });

  it("persists present+kinds together when the pair is valid", () => {
    const next: HouseholdSettingsFormValue = {
      ...last,
      unsupportedDietStatus: "present",
      unsupportedDietKinds: ["weaning_food"],
    };
    expect(persistableHouseholdSettings(next, last)).toEqual(next);
  });

  it("returns undefined when last persisted values are also invalid", () => {
    const invalidLast: HouseholdSettingsFormValue = { ...last, ageBand: "" };
    const next: HouseholdSettingsFormValue = { ...invalidLast, allergyStatus: "unconfirmed" };
    expect(persistableHouseholdSettings(next, invalidLast)).toBeUndefined();
  });
});

describe("sanitizeRequiredSafetyConstraintsForAgeBand", () => {
  it("returns constraints unchanged for rule-applicable bands", () => {
    // bones_for_young_and_senior の対象帯では remove_bones が実効を持つのでそのまま返す
    expect(
      sanitizeRequiredSafetyConstraintsForAgeBand("age_3_5", ["remove_bones", "cut_small"]),
    ).toEqual(["remove_bones", "cut_small"]);
  });

  it("drops only remove_bones for non-applicable or empty bands", () => {
    // cut_small は全年齢帯で有効。未選択 "" も対象外として扱い remove_bones は残さない。
    expect(
      sanitizeRequiredSafetyConstraintsForAgeBand("age_9_12", ["remove_bones", "cut_small"]),
    ).toEqual(["cut_small"]);
    expect(sanitizeRequiredSafetyConstraintsForAgeBand("", ["remove_bones"])).toEqual([]);
  });
});
