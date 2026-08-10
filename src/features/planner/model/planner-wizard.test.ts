import { describe, expect, it } from "vitest";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import {
  firstIncompletePlannerStep,
  isAudienceComplete,
  mapPlannerIssuePathToField,
  neutralizeAudienceForPersistence,
  normalizeAudienceForModeChange,
} from "./planner-wizard";

/**
 * 4質問 + household対象を全て満たした「完成状態」の下書き。
 * 各テストではここから欠落させたいフィールドだけを上書きして
 * 「どのフィールドが欠けているとどのstepへ戻るか」を検証する。
 */
const completeQuestionAnswers: PlannerDraftInput = {
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMode: "household",
  targetMemberIds: ["81000000-0000-4000-8000-000000000001"],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  ingredientPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

describe("firstIncompletePlannerStep", () => {
  it("returns meal when mealType is unanswered", () => {
    expect(firstIncompletePlannerStep({ ...completeQuestionAnswers, mealType: null })).toBe("meal");
  });

  it("returns ingredients when mainIngredients is empty", () => {
    expect(firstIncompletePlannerStep({ ...completeQuestionAnswers, mainIngredients: [] })).toBe(
      "ingredients",
    );
  });

  it("returns cuisine when cuisineGenre is unanswered", () => {
    expect(firstIncompletePlannerStep({ ...completeQuestionAnswers, cuisineGenre: null })).toBe(
      "cuisine",
    );
  });

  it("resumes an incomplete target draft at audience without losing answers", () => {
    expect(
      firstIncompletePlannerStep({
        ...completeQuestionAnswers,
        targetMode: null,
        targetMemberIds: [],
        servings: null,
      }),
    ).toBe("audience");
  });

  it("returns audience when household mode has no selected members", () => {
    expect(
      firstIncompletePlannerStep({
        ...completeQuestionAnswers,
        targetMode: "household",
        targetMemberIds: [],
      }),
    ).toBe("audience");
  });

  it("returns audience when idea mode is missing servings", () => {
    expect(
      firstIncompletePlannerStep({
        ...completeQuestionAnswers,
        targetMode: "idea",
        targetMemberIds: [],
        servings: null,
      }),
    ).toBe("audience");
  });

  it("returns review when all questions are answered", () => {
    expect(firstIncompletePlannerStep(completeQuestionAnswers)).toBe("review");
  });

  it("returns review for a fully answered idea draft", () => {
    expect(
      firstIncompletePlannerStep({
        ...completeQuestionAnswers,
        targetMode: "idea",
        targetMemberIds: [],
        servings: 2,
      }),
    ).toBe("review");
  });

  it("P5: eligible set が無いと blocked 選択でも review、渡すと audience", () => {
    const memberId = completeQuestionAnswers.targetMemberIds[0] ?? "missing";
    // 省略時は length のみ → home/resume が review に着地し得る
    expect(firstIncompletePlannerStep(completeQuestionAnswers)).toBe("review");
    // eligible を渡すと blocked ID は audience（home start の incomplete 判定と一致）
    expect(firstIncompletePlannerStep(completeQuestionAnswers, new Set())).toBe("audience");
    expect(firstIncompletePlannerStep(completeQuestionAnswers, new Set(["other"]))).toBe(
      "audience",
    );
    expect(firstIncompletePlannerStep(completeQuestionAnswers, new Set([memberId]))).toBe("review");
  });
});

describe("mapPlannerIssuePathToField", () => {
  it.each<[readonly PropertyKey[], string]>([
    [["mealType"], "mealType"],
    [["mainIngredients"], "mainIngredients"],
    [["mainIngredients", 0], "mainIngredients"],
    [["cuisineGenre"], "cuisineGenre"],
    [["targetMode"], "targetMode"],
    [["targetMemberIds"], "targetMemberIds"],
    [["targetMemberIds", 0], "targetMemberIds"],
    [["servings"], "servings"],
    [["timeLimitMinutes"], "timeLimitMinutes"],
    [["budgetPreference"], "budgetPreference"],
    [["avoidIngredients"], "avoidIngredients"],
    [["avoidIngredients", 3], "avoidIngredients"],
    [["memo"], "memo"],
    [["pantrySelections"], "pantrySelections"],
    [["pantrySelections", 0], "pantrySelections"],
    [["pantrySelections", 0, "pantryItemId"], "pantrySelections"],
  ])("normalizes %j to %s", (path, expected) => {
    expect(mapPlannerIssuePathToField(path)).toBe(expected);
  });

  it("returns null for an unknown root field", () => {
    expect(mapPlannerIssuePathToField(["unknownField"])).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(mapPlannerIssuePathToField([])).toBeNull();
  });
});

describe("isAudienceComplete", () => {
  it("household は1人以上で完成、0人は未完成", () => {
    expect(isAudienceComplete(completeQuestionAnswers)).toBe(true);
    expect(isAudienceComplete({ ...completeQuestionAnswers, targetMemberIds: [] })).toBe(false);
  });

  it("P7: eligibleMemberIds を渡すと非 eligible 選択は未完成", () => {
    const memberId = completeQuestionAnswers.targetMemberIds[0] ?? "missing";
    expect(isAudienceComplete(completeQuestionAnswers, new Set([memberId]))).toBe(true);
    expect(isAudienceComplete(completeQuestionAnswers, new Set())).toBe(false);
    expect(isAudienceComplete(completeQuestionAnswers, new Set(["other-id"]))).toBe(false);
  });

  it("idea は servings 必須、null は未完成", () => {
    expect(
      isAudienceComplete({
        ...completeQuestionAnswers,
        targetMode: "idea",
        targetMemberIds: [],
        servings: 2,
      }),
    ).toBe(true);
    expect(
      isAudienceComplete({
        ...completeQuestionAnswers,
        targetMode: "idea",
        targetMemberIds: [],
        servings: null,
      }),
    ).toBe(false);
  });

  it("targetMode 未選択は未完成", () => {
    expect(
      isAudienceComplete({
        ...completeQuestionAnswers,
        targetMode: null,
        targetMemberIds: [],
        servings: null,
      }),
    ).toBe(false);
  });
});

describe("neutralizeAudienceForPersistence", () => {
  it("P3: meal 等を残しつつ audience だけ null/空へ中立化する", () => {
    const next = neutralizeAudienceForPersistence(completeQuestionAnswers);
    expect(next.mealType).toBe("dinner");
    expect(next.mainIngredients).toEqual(["鶏肉"]);
    expect(next.cuisineGenre).toBe("japanese");
    expect(next.targetMode).toBeNull();
    expect(next.targetMemberIds).toEqual([]);
    expect(next.servings).toBeNull();
  });
});

describe("normalizeAudienceForModeChange", () => {
  it("household モードへ切り替えたら idea 用の人数指定を残さない", () => {
    const next = normalizeAudienceForModeChange(completeQuestionAnswers, "household");
    expect(next.targetMode).toBe("household");
    expect(next.servings).toBeNull();
    // household へ切替直後はまだ対象未選択のため、以前の idea 人数選択を household の
    // targetMemberIds として引き継いではならない（誤った家族条件で送信されないための不変条件）。
    expect(next.targetMemberIds).toEqual([]);
  });

  it("idea モードへ切り替えたら以前の家族選択を残さない", () => {
    const next = normalizeAudienceForModeChange(completeQuestionAnswers, "idea");
    expect(next.targetMode).toBe("idea");
    expect(next.targetMemberIds).toEqual([]);
    expect(next.servings).toBeNull();
  });

  it("対象未選択に戻す場合は家族と人数の両方を空にする", () => {
    const next = normalizeAudienceForModeChange(completeQuestionAnswers, null);
    expect(next.targetMode).toBeNull();
    expect(next.targetMemberIds).toEqual([]);
    expect(next.servings).toBeNull();
  });

  it(
    "household 選択後に対象家族が0件になった場合は mode 未選択へ戻し、" + "idea へ自動降格しない",
    () => {
      // 「利用可能な家族が0人になった」というUI側の判定結果を受け取り、
      // household draft をそのまま残さず mode 未選択へ戻す不変条件を固定する。
      // ここで idea へ降格してしまうと、ユーザーが意図しない人数指定モードへ
      // 無断で切り替わってしまうため、明示的に禁止する。
      const next = normalizeAudienceForModeChange(completeQuestionAnswers, "household", {
        eligibleMemberCount: 0,
      });
      expect(next.targetMode).toBeNull();
      expect(next.targetMemberIds).toEqual([]);
      expect(next.servings).toBeNull();
    },
  );
});
