import { describe, it, expect } from "vitest";
import { buildPreviewFromPayload } from "./map-shared-recipe.js";

const VALID_SCHEMA = "2026-07-11.v1";
const menuId = "33333333-3333-4333-8333-333333333333";

/** preview 投影に十分な最小 payload（余分キーは strip される想定） */
function minimalValidPayload() {
  return {
    schemaVersion: VALID_SCHEMA,
    menuId,
    mealType: "dinner",
    cuisineGenre: "japanese",
    servings: 2,
    totalElapsedMinutes: 15,
    safetyTags: [],
    dishes: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        role: "main",
        position: 1,
        name: "肉じゃが",
        description: "定番",
        cookingTimeMinutes: 15,
        ingredients: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            position: 1,
            name: "じゃがいも",
            quantityValue: 2,
            quantityText: "2個",
            unit: null,
            storeSection: "produce",
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            position: 1,
            instruction: "切る",
          },
        ],
      },
    ],
    timeline: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        position: 1,
        startMinute: 0,
        durationMinutes: 5,
        instruction: "下ごしらえ",
        dishId: null,
        recipeStepId: null,
      },
    ],
    adaptations: [],
    pantryUsage: [{ shouldNot: "appear" }],
    labelConfirmations: [{ shouldNot: "appear" }],
  };
}

describe("buildPreviewFromPayload", () => {
  it("returns unsupported_schema_version for unknown version", () => {
    const r = buildPreviewFromPayload({ schemaVersion: "nope" });
    expect(r.preview).toBeNull();
    expect(r.previewError).toBe("unsupported_schema_version");
  });

  it("returns invalid_menu_payload for empty object", () => {
    const r = buildPreviewFromPayload({});
    expect(r.preview).toBeNull();
    expect(r.previewError).toBe("invalid_menu_payload");
  });

  it("maps valid payload without raw or forbidden keys", () => {
    const r = buildPreviewFromPayload(minimalValidPayload());
    expect(r.previewError).toBeNull();
    expect(r.preview).not.toBeNull();
    expect(r.preview?.dishes[0]?.name).toBe("肉じゃが");
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/menu_payload/i);
    expect(json).not.toMatch(/menuPayload/);
    expect(json).not.toMatch(/pantryUsage/);
    expect(json).not.toMatch(/labelConfirmations/);
    // dish UUID は preview から除外
    expect(json).not.toContain("44444444-4444-4444-8444-444444444444");
  });
});
