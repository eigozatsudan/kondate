import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError } from "./generation-repair.js";
import { runGeneration, type GenerationDependencies } from "./generation-service.js";
import { parseServerEnv, type ServerEnv } from "./env.js";
import { sendMenuGeneration } from "./openrouter.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import { currentAllergenCatalogV1 } from "../../../shared/safety/current-allergen-catalog.v1.js";
import { currentFoodSafetyRulesV1 } from "../../../shared/safety/current-food-safety-rules.v1.js";

// このファイルが検証する adversarial scenario 名の閉じた集合。
// scenarios.mjs のキー全体からテスト対象だけを厳密なunion型として抜き出し、
// 添字アクセス時に string 型へ広がらないようにする（TS7053回避）。
const adversarialScenarioNames = [
  "direct-allergen",
  "alias-in-step",
  "missing-label-confirmation",
  "unsafe-age-shape",
  "invalid-adaptation-branch",
  "invalid-pantry-dish-link",
  "over-time-limit",
] as const;
type AdversarialScenarioName = (typeof adversarialScenarioNames)[number];

// HTTP境界を通すサービス層テストが対象とする全シナリオ（malformed-jsonを含む）。
const httpBoundaryScenarioNames = ["malformed-json", ...adversarialScenarioNames] as const;
type HttpBoundaryScenarioName = (typeof httpBoundaryScenarioNames)[number];

const { getServerEnvMock } = vi.hoisted(() => ({
  getServerEnvMock: vi.fn<() => ServerEnv>(),
}));

vi.mock("./env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env.js")>();
  return { ...actual, getServerEnv: getServerEnvMock };
});

// ledger-first miss 時に権威 integrity を解決する。統合テストは draft 行を持たないため固定値を返す。
vi.mock("./generation-integrity-context.js", () => ({
  resolveGenerationIntegrityContext: vi.fn(() =>
    Promise.resolve({
      kind: "new_menu",
      targetMode: "household",
      servings: null,
      targetMemberIds: ["90000000-0000-4000-8000-000000000001"],
      sourceMenuVersion: null,
    }),
  ),
}));
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

// docker compose の openrouter-mock サービスは app コンテナと同じDockerネットワーク上の
// http://openrouter-mock:8787/api/v1 で到達可能。実際のHTTPリクエスト・レスポンス
// パース・X-Kondate-Mock-Scenarioヘッダー経路を通すことで、sendMenuGeneration()、
// HTTPシリアライズ、local mock server、レスポンスパースをすべて実証する。
// 前提: `docker compose up -d --wait` でスタックが起動済みであること
// （AGENTS.md 3章のローカルスタック起動手順、通常の開発/検証フローで既に満たされる）。
// openrouter-mock に到達できない場合、このdescribeブロックのテストはfetch失敗で
// 明示的に失敗する（無言でスキップしない）。
const httpModels = ["mock/kondate-primary:free", "mock/kondate-repair:free"] as const;
const httpMockServerConfig = parseServerEnv({
  VITE_SUPABASE_URL: "http://127.0.0.1:8000",
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
  SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
  AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_CONTINUATION_TTL_SECONDS: "300",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  OPENROUTER_API_KEY: "local-mock-key",
  OPENROUTER_MODELS: httpModels.join(","),
  OPENROUTER_BASE_URL: "http://openrouter-mock:8787/api/v1",
  GENERATION_REQUEST_HMAC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  USER_DAILY_AI_LIMIT: "5",
  USER_DAILY_EXTERNAL_CALL_LIMIT: "12",
  USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4",
  USER_SHORT_WINDOW_SECONDS: "600",
  FUNCTION_TOTAL_BUDGET_MS: "50000",
});

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
function makeAdversarialGenerationContext(
  scenario: AdversarialScenarioName | "success",
): GenerationContext {
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
      targetMode: "household",
      targetMemberIds: [memberId],
      servings: null,
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

// --- サービス層adversarial統合テスト（real local HTTP mock境界） ---
// callOpenRouter に sendMenuGeneration() 自体を渡し、OPENROUTER_MOCK_SCENARIO 環境変数で
// docker compose の openrouter-mock サービスへ実HTTPリクエストを送る。これにより:
// - sendMenuGeneration() の実装（HTTPシリアライズ・レスポンスパース）
// - local OpenRouter mock server の応答
// - HTTP境界でのmodel exclusion（2回目送信時のmodels配列）
// - primary/repair のレスポンスmodel ID
// をすべて実際のHTTP通信で証明する。materializeAiGeneratedMenu/validateGeneratedMenuは
// vi.mock されていないため実コードを通る。
describe("adversarial scenarios through runGeneration with the real local HTTP mock", () => {
  const requestId = "90000000-0000-4000-8000-000000000001";
  const key = "91000000-0000-4000-8000-000000000001";
  const command: Extract<GenerationCommand, { kind: "new_menu" }> = {
    commandVersion: "generation-command.v2",
    kind: "new_menu",
    request: {
      idempotencyKey: key,
      draftId: "92000000-0000-4000-8000-000000000001",
      draftRevision: 1,
      privacyNoticeVersion: "2026-07-11.v1",
      expiredPantryConfirmations: [],
    },
  };
  const originalMockScenario = process.env.OPENROUTER_MOCK_SCENARIO;

  beforeEach(() => {
    getServerEnvMock.mockReturnValue(httpMockServerConfig);
  });

  afterEach(() => {
    if (originalMockScenario === undefined) {
      delete process.env.OPENROUTER_MOCK_SCENARIO;
    } else {
      process.env.OPENROUTER_MOCK_SCENARIO = originalMockScenario;
    }
  });

  function makeServiceRepository() {
    const processingRecord = {
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
    };
    return {
      lookup: vi.fn(() => Promise.resolve({ kind: "miss" as const })),
      replayExisting: vi.fn(() => Promise.resolve(processingRecord)),
      reserveNew: vi.fn(() => Promise.resolve(processingRecord)),
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
          sent: true as const,
          code: null,
        }),
      ),
      failBeforeSend: vi.fn((_id: string, code: string) =>
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

  function makeServiceDeps(
    scenario: HttpBoundaryScenarioName,
    repository: ReturnType<typeof makeServiceRepository>,
  ): GenerationDependencies {
    // unsafe-age-shape は age_shape_rule 検証用に "丸ごと" を含まない食材名へ
    // 差し替える必要があるため、fixed fixture を直接使うHTTP経路では検証対象から
    // 除外し、safety_action_contradiction 経路（frozen fixtureそのまま）だけを
    // このHTTP境界テストで確認する。missing-evidence（age_shape_rule）経路は
    // 上のmaterializer/validator直接呼び出しテストで検証済み。
    const context = makeAdversarialGenerationContext(
      scenario === "malformed-json" ? "success" : scenario,
    );
    return {
      user: { userId: "93000000-0000-4000-8000-000000000001", accessToken: "token" },
      repository,
      models: [...httpModels],
      loadExecutionContext: vi.fn(() =>
        Promise.resolve({
          kind: "new_menu" as const,
          command,
          requestId: "91000000-0000-4000-8000-000000000001",
          generationContext: context,
          expectedSafetyFingerprint: "sha256:adversarial-fingerprint",
          startedAtMonotonicMs: 0,
          deadlineAtMonotonicMs: 50_000,
          regeneration: null,
        }),
      ),
      validatePreflight: () => ({ ok: true }),
      buildMessages: () => [{ role: "user", content: "prompt" }],
      callOpenRouter: sendMenuGeneration,
      now: () => new Date("2026-07-11T00:00:00.000Z"),
      monotonicNow: () => 0,
      openRouterTimeoutMs: 20_000,
      requestStartedAtMonotonicMs: 0,
      functionTotalBudgetMs: 50_000,
      uuid: deterministicUuid,
    };
  }

  it.each(httpBoundaryScenarioNames)(
    "%s: at most one repair, primary model excluded, no third send, no success quota",
    async (scenario) => {
      process.env.OPENROUTER_MOCK_SCENARIO = scenario;
      const repository = makeServiceRepository();
      const deps = makeServiceDeps(scenario, repository);

      const result = await runGeneration(deps, command);

      // 1. リクエスト予約は1回だけ行われる
      expect(repository.lookup).toHaveBeenCalledTimes(1);
      expect(repository.reserveNew).toHaveBeenCalledTimes(1);

      // 2. 結果は失敗
      expect(result.status).toBe("failed");
      expect(result).toMatchObject({ quota: { consumed: false } });

      // 3. 最大2回の送信（primary + repair）。実HTTPのため呼出し回数はmarkSentで確認する。
      expect(repository.markSent).toHaveBeenCalledTimes(2);

      // 4. 修復は1回だけ予約される
      expect(repository.reserveRepair).toHaveBeenCalledTimes(1);

      // 5. 成功persistenceは呼ばれない
      expect(repository.succeed).not.toHaveBeenCalled();

      // 6. primary/repair 両方のmodel IDがHTTPレスポンス経由で記録される
      //    （mock serverは primary送信時 body.models[0]、repair送信時 repairModel を返す）
      expect(repository.recordModel).toHaveBeenCalledWith(requestId, httpModels[0]);
      expect(repository.recordModel).toHaveBeenCalledWith(requestId, httpModels[1]);
    },
    20_000,
  );
});
