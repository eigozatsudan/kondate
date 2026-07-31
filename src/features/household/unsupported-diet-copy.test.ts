import { describe, expect, it } from "vitest";
import { unsupportedDietKinds } from "@shared/contracts/domain";
import {
  ADD_SCOPE_NOTICE_BODY,
  ADD_SCOPE_NOTICE_CANCEL,
  ADD_SCOPE_NOTICE_CONTINUE,
  ADD_SCOPE_NOTICE_FOOTNOTE,
  ADD_SCOPE_NOTICE_ITEMS,
  ADD_SCOPE_NOTICE_TITLE,
  UNSUPPORTED_DIET_EMPTY_ADD_HELP,
  UNSUPPORTED_DIET_KIND_LABELS,
  UNSUPPORTED_DIET_KINDS_LEGEND,
  UNSUPPORTED_DIET_KINDS_REQUIRED,
  UNSUPPORTED_DIET_ONBOARDING_INTRO,
  UNSUPPORTED_DIET_PRESENT_HELP,
  UNSUPPORTED_DIET_STATUS_HELP,
  UNSUPPORTED_DIET_STATUS_LABEL,
  UNSUPPORTED_DIET_STATUS_REQUIRED,
  UNSUPPORTED_DIET_UNCONFIRMED_HELP,
} from "./unsupported-diet-copy";
import { householdSettingsSchema } from "./household-settings-schema";

describe("unsupported-diet-copy", () => {
  it("exposes design-locked status and kind labels", () => {
    expect(UNSUPPORTED_DIET_STATUS_LABEL).toBe(
      "離乳食・飲み込みの不安・治療食など、このアプリで献立を作れない事情はありますか",
    );
    expect(UNSUPPORTED_DIET_STATUS_HELP).toContain("アレルギーや苦手");
    expect(UNSUPPORTED_DIET_KIND_LABELS.weaning_food).toBe("離乳食が必要");
    expect(UNSUPPORTED_DIET_KIND_LABELS.swallowing_concern).toBe("飲み込み・むせに不安がある");
    expect(UNSUPPORTED_DIET_KIND_LABELS.therapeutic_diet).toBe("医師等から治療食の指示がある");
    expect(Object.keys(UNSUPPORTED_DIET_KIND_LABELS).sort()).toEqual(
      [...unsupportedDietKinds].sort(),
    );
    expect(UNSUPPORTED_DIET_KINDS_LEGEND).toBe("該当する事情");
    expect(UNSUPPORTED_DIET_PRESENT_HELP).toContain("治療食の指示内容はここでは入力できません");
    expect(UNSUPPORTED_DIET_UNCONFIRMED_HELP).toContain("作れない事情を確認するまで");
    expect(UNSUPPORTED_DIET_STATUS_REQUIRED).toBe("作れない事情があるか選んでください");
    expect(UNSUPPORTED_DIET_KINDS_REQUIRED).toBe("該当する事情を選んでください");
    expect(UNSUPPORTED_DIET_ONBOARDING_INTRO).toContain("作れない事情の3項目");
    expect(UNSUPPORTED_DIET_EMPTY_ADD_HELP).toContain("登録の前に確認が表示されます");
  });

  it("exposes design-locked add-scope notice copy", () => {
    expect(ADD_SCOPE_NOTICE_TITLE).toBe("登録の前に");
    expect(ADD_SCOPE_NOTICE_BODY).toContain("その方個人向け");
    expect(ADD_SCOPE_NOTICE_BODY).toContain("他の家族向け");
    expect(ADD_SCOPE_NOTICE_ITEMS).toEqual([
      "離乳食が必要",
      "飲み込み・むせに不安がある",
      "医師等から治療食の指示がある",
    ]);
    expect(ADD_SCOPE_NOTICE_FOOTNOTE).toContain("この人には献立を作らない");
    expect(ADD_SCOPE_NOTICE_CONTINUE).toBe("登録を続ける");
    expect(ADD_SCOPE_NOTICE_CANCEL).toBe("やめる");
  });

  it("schema validation messages use shared copy constants", () => {
    // portionSize / spiceLevel は domain の "regular"（計画文の "normal" は誤り）
    const missingStatus = householdSettingsSchema.safeParse({
      displayName: null,
      ageBand: "adult",
      allergyStatus: "none",
      // unsupportedDietStatus omitted → invalid
      unsupportedDietKinds: [],
      requiredSafetyConstraints: [],
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
    });
    expect(missingStatus.success).toBe(false);
    if (!missingStatus.success) {
      const messages = missingStatus.error.issues.map((i) => i.message);
      expect(messages).toContain(UNSUPPORTED_DIET_STATUS_REQUIRED);
    }

    const presentEmptyKinds = householdSettingsSchema.safeParse({
      displayName: null,
      ageBand: "adult",
      allergyStatus: "none",
      unsupportedDietStatus: "present",
      unsupportedDietKinds: [],
      requiredSafetyConstraints: [],
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
    });
    expect(presentEmptyKinds.success).toBe(false);
    if (!presentEmptyKinds.success) {
      const messages = presentEmptyKinds.error.issues.map((i) => i.message);
      expect(messages).toContain(UNSUPPORTED_DIET_KINDS_REQUIRED);
    }
  });
});
