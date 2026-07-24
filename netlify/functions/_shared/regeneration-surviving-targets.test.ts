import { describe, expect, it } from "vitest";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import { makeGenerationContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";
import {
  buildDishRegenerationPrompt,
  projectMenuForSurvivingTargets,
  toRetainedDishPrompt,
} from "./regeneration-context.js";

describe("projectMenuForSurvivingTargets / dish-regen AI strip", () => {
  const dishId = "50000000-0000-4000-8000-000000000001";
  const stepId = "51000000-0000-4000-8000-000000000001";
  const ingredientId = "53000000-0000-4000-8000-000000000001";

  function menuWithDeletedMember() {
    return makeValidatedMenu({
      dishes: [
        {
          id: dishId,
          role: "main",
          position: 1,
          name: "元の主菜",
          description: "説明",
          cookingTimeMinutes: 20,
          ingredients: [
            {
              id: ingredientId,
              position: 1,
              name: "鶏肉",
              quantityValue: 200,
              quantityText: "200g",
              unit: "g",
              storeSection: "meat_fish",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [{ id: stepId, position: 1, instruction: "焼く" }],
        },
        {
          id: "50000000-0000-4000-8000-000000000002",
          role: "side",
          position: 2,
          name: "保持する副菜",
          description: "保持",
          cookingTimeMinutes: 10,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000002",
              position: 1,
              name: "にんじん",
              quantityValue: 1,
              quantityText: "1本",
              unit: "本",
              storeSection: "produce",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [
            {
              id: "51000000-0000-4000-8000-000000000002",
              position: 1,
              instruction: "和える",
            },
          ],
        },
      ],
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId,
          anonymousMemberRef: "member_1",
          portionText: "生存メンバーの取り分け",
          branchBeforeRecipeStepId: stepId,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "確認",
          safetyTags: [],
          safetyActions: [],
        },
        {
          id: "57000000-0000-4000-8000-000000000002",
          dishId,
          anonymousMemberRef: "member_2",
          portionText: "削除済みメンバー専用の取り分け文言",
          branchBeforeRecipeStepId: stepId,
          additionalCutting: "削除済み切断指示",
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "削除済み確認",
          safetyTags: [],
          safetyActions: [
            {
              kind: "cut_small",
              dishId,
              ingredientId,
              anonymousMemberRef: "member_2",
              beforeRecipeStepId: stepId,
              instruction: "削除済みメンバー向け小片指示",
            },
          ],
        },
      ],
      labelConfirmations: [
        {
          sourceType: "ingredient",
          sourceId: ingredientId,
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "鶏肉",
          allergenId: "egg",
          anonymousMemberRef: "member_2",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    });
  }

  it("projects adaptations and labels to surviving anonymous refs only", () => {
    const projected = projectMenuForSurvivingTargets(
      menuWithDeletedMember(),
      new Set(["member_1"]),
    );
    expect(projected.adaptations.map((row) => row.anonymousMemberRef)).toEqual(["member_1"]);
    expect(projected.labelConfirmations).toEqual([]);
    expect(projected.adaptations[0]?.portionText).toBe("生存メンバーの取り分け");
  });

  it("omits deleted-member free text from dish regeneration AI prompt", () => {
    const sourceMenu = menuWithDeletedMember();
    const source: StoredMenuAggregate = {
      menu: sourceMenu,
      userId: "85000000-0000-4000-8000-000000000001",
      safetyFingerprint: "source-fp",
      derivationGroupId: "a1000000-0000-4000-8000-000000000001",
      version: 1,
      targetMode: "household",
      preferenceSnapshot: {},
      targetMemberIds: ["55000000-0000-4000-8000-000000000001"],
      targetMembers: [
        {
          householdMemberId: "55000000-0000-4000-8000-000000000001",
          anonymousMemberRef: "member_1",
          displayNameSnapshot: "家族1",
          displayName: "家族1",
        },
        {
          householdMemberId: null,
          anonymousMemberRef: "member_2",
          displayNameSnapshot: "削除済み",
          displayName: "削除済み",
        },
      ],
    };
    const command: Extract<GenerationCommand, { kind: "regenerate_dish" }> = {
      commandVersion: "generation-command.v2",
      kind: "regenerate_dish",
      request: {
        sourceMenuId: sourceMenu.menuId,
        dishId,
        idempotencyKey: "82000000-0000-4000-8000-000000000001",
        changeReason: "simpler",
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    };
    const prompt = buildDishRegenerationPrompt({
      command,
      source,
      generationContext: makeGenerationContext(),
      retained: toRetainedDishPrompt(sourceMenu, command.request.dishId),
    });
    expect(prompt.sourceAdaptations.map((row) => row.anonymousMemberRef)).toEqual(["member_1"]);
    expect(prompt.sourceLabelConfirmations).toEqual([]);
    const joined = JSON.stringify(prompt);
    expect(joined).not.toContain("削除済みメンバー専用");
    expect(joined).not.toContain("削除済み切断指示");
    expect(joined).not.toContain("member_2");
  });
});
