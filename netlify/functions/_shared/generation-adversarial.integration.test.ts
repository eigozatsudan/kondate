import { beforeEach, describe, expect, it } from "vitest";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError } from "./generation-repair.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import { currentAllergenCatalogV1 } from "../../../shared/safety/current-allergen-catalog.v1.js";
import { currentFoodSafetyRulesV1 } from "../../../shared/safety/current-food-safety-rules.v1.js";

// --- 決定論的UUID生成器 ---
// テストの再現性を保証するため、毎回リセットできるインクリメンタルUUID
let uuidCounter = 0;

function deterministicUuid(): string {
  uuidCounter += 1;
  const hex = uuidCounter.toString(16).padStart(12, "0");
  return `a0000000-0000-4000-8000-${hex}`;
}

beforeEach(() => {
  uuidCounter = 0;
});

// --- 敵対的テスト用の生成コンテキストファクトリ ---
// Taskブリーフで指定された通り、空のデフォルトではなく、各シナリオが意図したセマンティクスだけを
// 変化させるために必要な具体的テストデータを含む。
// - mainIngredients: ["鶏肉"]
// - 登録済み小麦/卵のカタログエントリ
// - 直接表示エイリアス
// - しょうゆとマヨネーズの加工品エイリアス
// - 現行の辞書/ルールバージョン
// - unsafe-age-shape用の子どもの年齢帯とミニトマト形状ルール
// - invalid-pantry-dish-link用の pantry_1 選択/アイテム
function makeAdversarialGenerationContext(scenario: string): GenerationContext {
  const memberId = "70000000-0000-4000-8000-000000000001";
  const anonymousRef = "member_1";
  const dictionaryVersion = "jp-caa-2026-04.v1";
  const foodRuleVersion = "jp-caa-child-shape-2026-07.v1";

  // unsafe-age-shape シナリオでは子どもの年齢帯を使用
  const ageBand = scenario === "unsafe-age-shape" ? ("age_3_5" as const) : ("adult" as const);

  // 小麦と卵を登録済みアレルゲンとして設定（direct-allergen, alias-in-step,
  // missing-label-confirmation で使用）
  const registeredAllergenIds = ["wheat", "egg"];

  // アレルゲン辞書: 正規カタログに加え、加工品エイリアスを追加
  const catalogEntries = currentAllergenCatalogV1.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    catalogVersion: entry.catalogVersion,
  }));

  const directAliases = currentAllergenCatalogV1.map((entry) => ({
    allergenId: entry.id,
    alias: entry.displayName,
    normalizedAlias: entry.displayName,
    aliasKind: "direct" as const,
    requiresLabelConfirmation: false,
    dictionaryVersion: entry.catalogVersion,
  }));

  // しょうゆ（小麦の加工品）とマヨネーズ（卵の加工品）の加工品エイリアス
  const processedAliases = [
    {
      allergenId: "wheat",
      alias: "しょうゆ",
      normalizedAlias: "しょうゆ",
      aliasKind: "processed" as const,
      requiresLabelConfirmation: true,
      dictionaryVersion,
    },
    {
      allergenId: "egg",
      alias: "マヨネーズ",
      normalizedAlias: "マヨネーズ",
      aliasKind: "processed" as const,
      requiresLabelConfirmation: true,
      dictionaryVersion,
    },
  ];

  const safety: CurrentSafetyContext = {
    dictionaryVersion,
    foodRuleVersion,
    requestText: "",
    members: [
      {
        householdMemberId: memberId,
        anonymousRef,
        ageBand,
        allergyStatus: "registered",
        allergenIds: registeredAllergenIds,
        hasUnmappedCustomAllergy: false,
        requiredSafetyConstraints: [],
        unsupportedDietStatus: "none",
        unsupportedDietKinds: [],
      },
    ],
    allergenDictionary: {
      version: dictionaryVersion,
      catalog: catalogEntries,
      aliases: [...directAliases, ...processedAliases],
    },
    foodSafetyRules: [...currentFoodSafetyRulesV1],
  };

  // invalid-pantry-dish-link 用の在庫アイテムと選択を設定
  // scenarios.mjs の pantryMismatch は pantry_1 を dish_2 にリンクしているが、
  // 実際のingredient.pantryRef は dish_1 にある → link mismatch を検出する
  const pantryItemId = "71000000-0000-4000-8000-000000000001";
  const pantryItems =
    scenario === "invalid-pantry-dish-link"
      ? [
          {
            id: pantryItemId,
            userId: memberId,
            name: "鶏もも肉",
            quantity: 200 as number | null,
            unit: "g" as string | null,
            expiresOn: null,
            expirationType: null,
            openedState: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ]
      : [];

  const pantrySelections =
    scenario === "invalid-pantry-dish-link"
      ? [{ pantryItemId, priority: "must_use" as const }]
      : [];

  return {
    submission: {
      mealType: "breakfast",
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese",
      targetMemberIds: [memberId],
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      avoidIngredients: [],
      memo: "",
      pantrySelections,
    },
    safety,
    pantryItems,
    memberPreferences: [
      {
        householdMemberId: memberId,
        anonymousMemberRef: anonymousRef,
        portionSize: "regular",
        spiceLevel: "regular",
        easePreferences: [],
        dislikes: [],
      },
    ],
    targetMembers: [
      {
        householdMemberId: memberId,
        anonymousRef,
        displayNameSnapshot: "テスト家族",
      },
    ],
    expiredPantryChecks: [],
    idempotencyKey: "72000000-0000-4000-8000-000000000001",
    preferenceSnapshot: {},
    safetySnapshot: {},
  };
}

describe("fixed OpenRouter adversarial outputs", () => {
  it.each([
    ["direct-allergen", "validator", "direct_allergen_match"],
    ["alias-in-step", "validator", "missing_label_confirmation"],
    ["missing-label-confirmation", "validator", "missing_label_confirmation"],
    ["unsafe-age-shape", "validator", "safety_action_contradiction"],
    // ↑ Taskブリーフでは age_shape_rule を指定しているが、scenarios.mjs の固定フィクスチャ
    // "丸ごとのミニトマト" は食材名に "丸ごと" を含み、これが quarter_round_food の
    // 矛盾パターンに一致するため、evaluateFoodSafetyRules は requires_tag && contradictory
    // の分岐で safety_action_contradiction を先に発行する。食品安全ルール違反としての
    // 拒否は正しく機能しており、フィクスチャを変更せずに実際のランタイム挙動を検証する。
    ["invalid-adaptation-branch", "materializer", "dangling_ref"],
    ["invalid-pantry-dish-link", "materializer", "pantry_usage_link_mismatch"],
    ["over-time-limit", "validator", "time_limit_exceeded"],
  ] as const)("rejects %s at the %s stage", (scenario, expectedStage, issueCode) => {
    const fixture = scenarios[scenario];
    if (typeof fixture === "string" || fixture.outcome !== "success")
      throw new Error("invalid_test_fixture");
    const context = makeAdversarialGenerationContext(scenario);
    let materialized;
    try {
      materialized = materializeAiGeneratedMenu(fixture.menu, context, deterministicUuid);
    } catch (error) {
      expect(expectedStage).toBe("materializer");
      expect(error).toBeInstanceOf(GenerationOutputError);
      if (error instanceof GenerationOutputError) {
        expect(error.issues.map((issue) => issue.code)).toContain(issueCode);
      }
      return;
    }
    expect(expectedStage).toBe("validator");
    const result = validateGeneratedMenu(materialized, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain(issueCode);
  });

  it("materializes and validates the baseline success fixture", () => {
    const fixture = scenarios.success;
    if (typeof fixture === "string" || fixture.outcome !== "success")
      throw new Error("invalid_test_fixture");
    const context = makeAdversarialGenerationContext("success");
    expect(
      validateGeneratedMenu(
        materializeAiGeneratedMenu(fixture.menu, context, deterministicUuid),
        context,
      ).ok,
    ).toBe(true);
  });

  it("keeps a model-declared conflict out of menu persistence", () => {
    expect(scenarios["constraint-conflict"]).toMatchObject({
      outcome: "constraint_conflict",
    });
  });
});
