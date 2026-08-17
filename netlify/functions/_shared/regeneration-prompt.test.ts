import { describe, expect, it } from "vitest";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import { createDishSignature } from "../../../shared/safety/deduplicate.js";
import { makeGenerationContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";
import {
  buildDishRegenerationPrompt,
  buildPantrySelectionIdToRef,
  toRetainedDishPrompt,
} from "./regeneration-context.js";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

describe("buildDishRegenerationPrompt", () => {
  it("includes retained text leaves and excludes stable UUIDs and PII", () => {
    const sourceMenu = makeValidatedMenu({
      dishes: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          role: "main",
          position: 1,
          name: "元の主菜",
          description: "置換される主菜の説明",
          cookingTimeMinutes: 20,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000001",
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
          steps: [
            {
              id: "51000000-0000-4000-8000-000000000001",
              position: 1,
              instruction: "中火で焼く",
            },
          ],
        },
        {
          id: "50000000-0000-4000-8000-000000000002",
          role: "side",
          position: 2,
          name: "保持する副菜",
          description: "保持説明テキスト",
          cookingTimeMinutes: 10,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000002",
              position: 1,
              name: "にんじんの千切り",
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
              instruction: "薄切りにして和える",
            },
          ],
        },
      ],
    });
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
      ],
    };
    const command: Extract<GenerationCommand, { kind: "regenerate_dish" }> = {
      commandVersion: "generation-command.v3",
      kind: "regenerate_dish",
      qualityMode: false,
      request: {
        sourceMenuId: sourceMenu.menuId,
        dishId: "50000000-0000-4000-8000-000000000001",
        idempotencyKey: "82000000-0000-4000-8000-000000000001",
        changeReason: "custom",
        changeReasonCustom: "もっとさっぱりした味にしたい",
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    const retained = toRetainedDishPrompt(sourceMenu, command.request.dishId);
    const prompt = buildDishRegenerationPrompt({
      command,
      source,
      generationContext: makeGenerationContext(),
      retained,
    });

    expect(prompt.mode).toBe("dish");
    expect(prompt.reason).toBe("custom");
    expect(prompt.changeReasonCustom).toBe("もっとさっぱりした味にしたい");
    expect(prompt.sourceDishToReplace.name).toBe("元の主菜");
    expect(prompt.retainedDishes[0]?.name).toBe("保持する副菜");
    expect(prompt.retainedDishes[0]?.ingredients[0]?.name).toBe("にんじんの千切り");
    expect(prompt.retainedDishes[0]?.steps[0]?.instruction).toBe("薄切りにして和える");
    expect(prompt.excludedDishSignatures).toEqual(
      expect.arrayContaining([
        createDishSignature({
          role: "main",
          name: "元の主菜",
          primaryIngredients: ["鶏肉"],
        }),
      ]),
    );

    const leaves = collectStrings(prompt);
    for (const leaf of leaves) {
      expect(leaf).not.toMatch(UUID_RE);
    }
    const joined = leaves.join("\n");
    expect(joined).not.toContain(source.userId);
    expect(joined).not.toContain("55000000-0000-4000-8000-000000000001");
    expect(joined).not.toContain("@");
    expect(joined).not.toContain("家族1");
  });

  // G29: source-only 在庫へ pantry_{n>selectionCount} を合成すると、モデルが echo して
  // materialize が unknown_pantry_ref → repair → attempt 消費する。プロンプトに載せない。
  const gonePantryItemId = "61000000-0000-4000-8000-000000000077";
  const goneSelectionId = "58000000-0000-4000-8000-000000000077";
  const currentPantryItemId = "61000000-0000-4000-8000-000000000088";
  const currentSelectionId = "58000000-0000-4000-8000-000000000088";
  const retainedDishId = "50000000-0000-4000-8000-000000000002";
  const replaceDishId = "50000000-0000-4000-8000-000000000001";

  function makeSourceOnlyUsage() {
    return {
      selectionId: goneSelectionId,
      pantryItemId: gonePantryItemId,
      pantryItemName: "消えた在庫",
      priority: "prefer_use" as const,
      usageStatus: "used" as const,
      plannedQuantity: 1,
      inventoryQuantity: 1,
      shortageQuantity: 0,
      unit: "個",
      dishIds: [retainedDishId],
      unusedReason: null,
    };
  }

  function makeCurrentUsage() {
    return {
      selectionId: currentSelectionId,
      pantryItemId: currentPantryItemId,
      pantryItemName: "にんじん",
      priority: "must_use" as const,
      usageStatus: "used" as const,
      plannedQuantity: 100,
      inventoryQuantity: 100,
      shortageQuantity: 0,
      unit: "g",
      dishIds: [retainedDishId],
      unusedReason: null,
    };
  }

  function buildPromptWithPantry(input: {
    pantryUsage: ReturnType<typeof makeValidatedMenu>["pantryUsage"];
    pantrySelections: { pantryItemId: string; priority: "must_use" | "prefer_use" }[];
  }) {
    const sourceMenu = makeValidatedMenu({ pantryUsage: [...input.pantryUsage] });
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
      ],
    };
    const command: Extract<GenerationCommand, { kind: "regenerate_dish" }> = {
      commandVersion: "generation-command.v3",
      kind: "regenerate_dish",
      qualityMode: false,
      request: {
        sourceMenuId: sourceMenu.menuId,
        dishId: replaceDishId,
        idempotencyKey: "82000000-0000-4000-8000-000000000001",
        changeReason: "simpler",
        changeReasonCustom: null,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    const pantrySelectionIdToRef = buildPantrySelectionIdToRef(sourceMenu, input.pantrySelections);
    return buildDishRegenerationPrompt({
      command,
      source,
      generationContext: makeGenerationContext({
        submission: {
          ...makeGenerationContext().submission,
          pantrySelections: input.pantrySelections,
        },
      }),
      retained: toRetainedDishPrompt(sourceMenu, command.request.dishId, pantrySelectionIdToRef),
    });
  }

  it("G29: omits source-only pantry instead of synthesizing pantry_N beyond selectionCount", () => {
    const emptyCurrent = buildPromptWithPantry({
      pantryUsage: [makeSourceOnlyUsage()],
      pantrySelections: [],
    });
    expect(emptyCurrent.sourcePantryUsage).toEqual([]);
    expect(emptyCurrent.sourcePantryUsage.map((row) => row.pantryRef)).not.toContain("pantry_1");

    const mixed = buildPromptWithPantry({
      pantryUsage: [makeCurrentUsage(), makeSourceOnlyUsage()],
      pantrySelections: [{ pantryItemId: currentPantryItemId, priority: "must_use" }],
    });
    expect(mixed.sourcePantryUsage.map((row) => row.pantryRef)).toEqual(["pantry_1"]);
    expect(mixed.sourcePantryUsage.map((row) => row.pantryRef)).not.toContain("pantry_2");
    expect(mixed.sourcePantryUsage[0]?.pantryItemName).toBe("にんじん");
  });

  it("G29: keeps source pantry that still exists in the current submission as pantry_N", () => {
    const prompt = buildPromptWithPantry({
      pantryUsage: [makeCurrentUsage()],
      pantrySelections: [{ pantryItemId: currentPantryItemId, priority: "must_use" }],
    });
    expect(prompt.sourcePantryUsage).toHaveLength(1);
    expect(prompt.sourcePantryUsage[0]?.pantryRef).toBe("pantry_1");
    expect(prompt.sourcePantryUsage[0]?.pantryItemName).toBe("にんじん");
    expect(prompt.sourcePantryUsage[0]?.dishRefs).toEqual(["dish_2"]);
  });
});
