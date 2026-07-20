import { beforeEach, describe, expect, it, vi } from "vitest";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError } from "./generation-repair.js";
import { runGeneration, type GenerationDependencies } from "./generation-service.js";
import { OpenRouterCallError } from "./openrouter.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
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
    ["unsafe-age-shape", "validator", "age_shape_rule"],
    // unsafe-age-shape: scenarios.mjs の "丸ごとのミニトマト" は "丸ごと" を含み
    // contradiction も同時に発火するが、テストではフィクスチャを "ミニトマト" に
    // 書き換えて missing-evidence 経路（age_shape_rule）のみを検証する。
    // contradiction 経路は下のsafety_action_contradiction専用テストで検証する。
    ["invalid-adaptation-branch", "materializer", "dangling_ref"],
    ["invalid-pantry-dish-link", "materializer", "pantry_usage_link_mismatch"],
    ["over-time-limit", "validator", "time_limit_exceeded"],
  ] as const)("rejects %s at the %s stage", (scenario, expectedStage, issueCode) => {
    const fixture = scenarios[scenario];
    if (typeof fixture === "string" || fixture.outcome !== "success")
      throw new Error("invalid_test_fixture");
    const context = makeAdversarialGenerationContext(scenario);

    // unsafe-age-shape: scenarios.mjs のフィクスチャは "丸ごとのミニトマト" だが、
    // "丸ごと" が quarter_round_food contradiction パターンに一致してしまうため、
    // age_shape_rule（missing-evidence分岐）を検証するにはcontradictionを回避する
    // 必要がある。食材名を "ミニトマト" に書き換えてmissing-evidence経路を通す。
    const menu =
      scenario === "unsafe-age-shape"
        ? structuredClone({
            ...fixture.menu,
            dishes: fixture.menu.dishes.map((dish, i) =>
              i === 1
                ? {
                    ...dish,
                    ingredients: dish.ingredients.map((ing, j) =>
                      j === 0 ? { ...ing, name: "ミニトマト" } : ing,
                    ),
                  }
                : dish,
            ),
          })
        : fixture.menu;

    let materialized;
    try {
      materialized = materializeAiGeneratedMenu(menu, context, deterministicUuid);
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

  // scenarios.mjs の "丸ごとのミニトマト" は同時に contradiction パターンにも一致する。
  // この経路を独立して確認する。
  it("rejects unsafe-age-shape with contradiction when ingredient contains '丸ごと'", () => {
    const fixture = scenarios["unsafe-age-shape"];
    if (typeof fixture === "string" || fixture.outcome !== "success")
      throw new Error("invalid_test_fixture");
    const context = makeAdversarialGenerationContext("unsafe-age-shape");
    const materialized = materializeAiGeneratedMenu(fixture.menu, context, deterministicUuid);
    const result = validateGeneratedMenu(materialized, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("safety_action_contradiction");
    }
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

// --- サービス層adversarial統合テスト ---
// vi.mock を使わず、runGeneration に scenario 固有 fixture を callOpenRouter から返し、
// 実際の materializeAiGeneratedMenu / validateGeneratedMenu を経由して拒否されることを
// 証明する。各シナリオで:
// - primary model ID を記録し repair 時に除外する
// - 最大2回の送信（markSent）で終端する（3回目なし）
// - 成功persistence（succeed）が呼ばれない
// - quota.consumed === false
describe("adversarial scenarios through runGeneration with real materializer/validator", () => {
  const models = ["mock/primary:free", "mock/repair:free"] as const;
  const requestId = "90000000-0000-4000-8000-000000000001";
  const key = "91000000-0000-4000-8000-000000000001";
  const command: GenerationCommand = {
    kind: "new_menu",
    request: {
      idempotencyKey: key,
      draftId: "92000000-0000-4000-8000-000000000001",
      draftRevision: 1,
      privacyNoticeVersion: "2026-07-11.v1",
      expiredPantryConfirmations: [],
    },
  };

  function makeServiceRepository() {
    return {
      reserve: vi.fn(() =>
        Promise.resolve({
          request_id: requestId,
          idempotency_key: key,
          status: "processing" as const,
          remaining: 5,
          user_daily_limit: 5 as const,
          consumed: false,
          started_at: "2026-07-11T00:00:00.000Z",
          completed_at: null,
          completed_menu_id: null,
          failure_code: null,
          terminal_details: null,
          replayed: false,
        }),
      ),
      markSent: vi.fn(() =>
        Promise.resolve({
          request_id: requestId,
          idempotency_key: key,
          status: "processing" as const,
          remaining: 5,
          user_daily_limit: 5 as const,
          consumed: false,
          started_at: "2026-07-11T00:00:00.000Z",
          completed_at: null,
          completed_menu_id: null,
          failure_code: null,
          terminal_details: null,
          replayed: false,
        }),
      ),
      reserveRepair: vi.fn<GenerationDependencies["repository"]["reserveRepair"]>(() =>
        Promise.resolve({ reserved: true, retry_at: null }),
      ),
      recordModel: vi.fn<GenerationDependencies["repository"]["recordModel"]>(() =>
        Promise.resolve(undefined),
      ),
      fail: vi.fn((_id: string, code: string) =>
        Promise.resolve({
          request_id: requestId,
          idempotency_key: key,
          status: "failed" as const,
          remaining: 5,
          user_daily_limit: 5 as const,
          consumed: false,
          started_at: "2026-07-11T00:00:00.000Z",
          completed_at: "2026-07-11T00:00:01.000Z",
          completed_menu_id: null,
          failure_code: code,
          terminal_details: null,
          replayed: false,
        }),
      ),
      conflict: vi.fn(),
      succeed: vi.fn(),
      status: vi.fn(() =>
        Promise.resolve({
          request_id: requestId,
          idempotency_key: key,
          status: "failed" as const,
          remaining: 5,
          user_daily_limit: 5 as const,
          consumed: false,
          started_at: "2026-07-11T00:00:00.000Z",
          completed_at: "2026-07-11T00:00:01.000Z",
          completed_menu_id: null,
          failure_code: "invalid_ai_response",
          terminal_details: null,
          replayed: false,
        }),
      ),
    };
  }

  // callOpenRouter が scenario 固有の fixture を返すファクトリ。
  // malformed-json は文字列なので OpenRouterCallError を投げる。
  // それ以外は outcome:"success" の menu を返す（不正な内容だが構造的には valid）。
  function makeScenarioCallOpenRouter(scenario: string) {
    const fixture = scenarios[scenario];
    if (typeof fixture === "string") {
      // malformed-json: パース不能 → OpenRouterCallError
      return vi
        .fn<GenerationDependencies["callOpenRouter"]>()
        .mockRejectedValueOnce(new OpenRouterCallError("invalid_ai_response", models[0]))
        .mockRejectedValueOnce(new OpenRouterCallError("invalid_ai_response", models[1]));
    }
    // 他のシナリオ: outcome は success だが menu 内容が不正
    return vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValueOnce({ output: fixture, modelId: models[0] })
      .mockResolvedValueOnce({ output: fixture, modelId: models[1] });
  }

  function makeServiceDeps(
    scenario: string,
    repository: ReturnType<typeof makeServiceRepository>,
    callOpenRouter: ReturnType<typeof makeScenarioCallOpenRouter>,
  ): GenerationDependencies {
    const context = makeAdversarialGenerationContext(scenario);
    return {
      user: { userId: "93000000-0000-4000-8000-000000000001", accessToken: "token" },
      repository,
      models,
      loadExecutionContext: vi.fn(() => Promise.resolve({ generationContext: context })),
      validatePreflight: () => ({ ok: true }),
      buildMessages: () => [{ role: "user", content: "prompt" }],
      callOpenRouter,
      now: () => new Date("2026-07-11T00:00:00.000Z"),
      openRouterTimeoutMs: 20_000,
      requestStartedAtMonotonicMs: 0,
      functionTotalBudgetMs: 50_000,
      uuid: deterministicUuid,
      ...({} as Record<string, never>),
    };
  }

  it.each([
    "malformed-json",
    "direct-allergen",
    "alias-in-step",
    "missing-label-confirmation",
    "unsafe-age-shape",
    "invalid-adaptation-branch",
    "invalid-pantry-dish-link",
    "over-time-limit",
  ])(
    "%s: at most one repair, primary model excluded, no third send, no success quota",
    async (scenario) => {
      const repository = makeServiceRepository();
      const callOpenRouter = makeScenarioCallOpenRouter(scenario);
      const deps = makeServiceDeps(scenario, repository, callOpenRouter);

      const result = await runGeneration(deps, command);

      // 1. 結果は失敗
      expect(result.status).toBe("failed");
      expect(result).toMatchObject({ quota: { consumed: false } });

      // 2. 最大2回の送信（primary + repair）
      expect(repository.markSent).toHaveBeenCalledTimes(2);
      expect(callOpenRouter).toHaveBeenCalledTimes(2);

      // 3. 修復は1回だけ予約される
      expect(repository.reserveRepair).toHaveBeenCalledTimes(1);

      // 4. 成功persistenceは呼ばれない
      expect(repository.succeed).not.toHaveBeenCalled();

      // 5. primary model IDが記録される
      expect(repository.recordModel).toHaveBeenCalledWith(requestId, models[0]);

      // 6. repair呼び出しではprimary modelが除外される
      const repairCall = callOpenRouter.mock.calls[1];
      if (repairCall !== undefined) {
        expect(repairCall[0].excludedModelIds).toEqual([models[0]]);
      }

      // 7. repair model IDも記録される
      expect(repository.recordModel).toHaveBeenCalledWith(requestId, models[1]);
    },
  );
});
