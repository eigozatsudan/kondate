/**
 * 生成品質レビュー用 entry（scripts から esbuild される）。
 * idea ベンチ固定コンテキストで OpenRouter → materialize → validate し、
 * 検証済み献立の要約と調理可能性スコアを返す。raw wire は返さない。
 */
import type { IdeaGenerationContext } from "../../../shared/safety/generation-context.js";
import { ideaSafetySnapshot } from "../../../shared/safety/idea-fingerprint.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import { ATTEMPT_TIMEOUT_MS } from "./generation-service.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError } from "./generation-repair.js";
import { createOpenRouterGenerationSender, OpenRouterCallError } from "./openrouter.js";

const benchmarkIdempotencyKey = "91000000-0000-4000-8000-000000000002";
const benchmarkDraftId = "91000000-0000-4000-8000-000000000003";

function ideaContext(): IdeaGenerationContext {
  return {
    targetMode: "idea",
    submission: {
      mealType: "breakfast",
      mainIngredients: ["鶏もも肉"],
      cuisineGenre: "japanese",
      targetMode: "idea",
      targetMemberIds: [],
      servings: 2,
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      ingredientPreference: null,
      noveltyPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety: null,
    pantryItems: [],
    memberPreferences: [],
    targetMembers: [],
    allergenVersion: null,
    foodRuleVersion: null,
    expiredPantryChecks: [],
    idempotencyKey: benchmarkIdempotencyKey,
    preferenceSnapshot: {},
    safetySnapshot: ideaSafetySnapshot,
  };
}

function createUuidFactory(): () => string {
  let counter = 10;
  return () => {
    counter += 1;
    return `92000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`;
  };
}

type Score = {
  total: number;
  max: number;
  failFlags: string[];
  checks: Record<string, boolean>;
};

type MenuLike = {
  mealType: string;
  cuisineGenre: string;
  servings: number;
  totalElapsedMinutes: number;
  dishes: readonly {
    role: string;
    name: string;
    description: string;
    cookingTimeMinutes: number;
    ingredients: readonly {
      name: string;
      quantityText: string;
      quantityValue: number | null;
      unit: string | null;
      pantrySelectionId: string | null;
    }[];
    steps: readonly { instruction: string }[];
  }[];
  timeline: readonly {
    startMinute: number;
    durationMinutes: number;
    instruction: string;
  }[];
  pantryUsage: readonly unknown[];
  adaptations: readonly unknown[];
};

function scoreCookability(menu: MenuLike, context: IdeaGenerationContext): Score {
  const failFlags: string[] = [];
  const checks: Record<string, boolean> = {};
  const add = (key: string, ok: boolean, flag?: string) => {
    checks[key] = ok;
    if (!ok && flag) failFlags.push(flag);
  };

  add("servings_match", menu.servings === context.submission.servings, "servings_mismatch");
  add("meal_type", menu.mealType === context.submission.mealType, "meal_type_mismatch");
  add(
    "genre",
    context.submission.cuisineGenre === "any" ||
      menu.cuisineGenre === context.submission.cuisineGenre,
    "genre_mismatch",
  );
  add(
    "time_budget",
    context.submission.timeLimitMinutes === null ||
      menu.totalElapsedMinutes <= context.submission.timeLimitMinutes,
    "over_time_budget",
  );
  // 朝/昼の最低品数は 2。上限内の増品（メイン食材分散）は合格とする。
  add("dish_count_min_2", menu.dishes.length >= 2, "dish_count_below_min");
  const roles = new Set(menu.dishes.map((d) => d.role));
  add(
    "roles_breakfast",
    (roles.has("main") || roles.has("staple")) && roles.has("side"),
    "missing_roles",
  );
  add("adaptations_empty", menu.adaptations.length === 0, "unexpected_adaptations");
  add("pantry_usage_empty", menu.pantryUsage.length === 0, "unexpected_pantry_usage");
  add(
    "no_pantry_links",
    menu.dishes.every((d) => d.ingredients.every((i) => i.pantrySelectionId === null)),
    "invented_pantry_link",
  );

  const identity = menu.dishes
    .flatMap((d) => [d.name, d.description, ...d.ingredients.map((i) => i.name)])
    .join("\0");
  const mainOk =
    /鶏もも|鶏肉|もも肉|チキン/u.test(identity) ||
    identity.includes(context.submission.mainIngredients[0] ?? "");
  add("main_ingredient_present", mainOk, "main_ingredient_missing");

  add(
    "all_dishes_have_ingredients",
    menu.dishes.every((d) => d.ingredients.length >= 1),
    "empty_ingredients",
  );
  add(
    "all_dishes_have_steps",
    menu.dishes.every((d) => d.steps.length >= 1),
    "empty_steps",
  );
  add(
    "quantity_text_present",
    menu.dishes.every((d) =>
      d.ingredients.every(
        (i) => typeof i.quantityText === "string" && i.quantityText.trim().length > 0,
      ),
    ),
    "missing_quantity_text",
  );
  const badQty = menu.dishes.some((d) =>
    d.ingredients.some((i) => {
      if (i.quantityValue !== null && i.quantityValue > 5000) return true;
      if (i.unit !== null && i.unit.length > 12) return true;
      return false;
    }),
  );
  add("quantity_not_absurd", !badQty, "absurd_quantity");
  add(
    "steps_actionable_length",
    menu.dishes.every((d) =>
      d.steps.every((s) => s.instruction.trim().length >= 4 && s.instruction.trim().length <= 500),
    ),
    "step_length_bad",
  );
  add("timeline_nonempty", menu.timeline.length >= 1, "empty_timeline");
  add(
    "timeline_within_total",
    menu.timeline.every((t) => t.startMinute + t.durationMinutes <= menu.totalElapsedMinutes),
    "timeline_overflow",
  );
  const procedureText = [
    ...menu.dishes.flatMap((d) => d.steps.map((s) => s.instruction)),
    ...menu.timeline.map((t) => t.instruction),
  ].join("");
  add(
    "has_cooking_verbs",
    /切|焼|煮|炒|茹|蒸|和え|混ぜ|温|加熱|焼く|煮る/u.test(procedureText),
    "no_cooking_verbs",
  );
  add(
    "no_raw_chicken_hint",
    !/生のまま食|生食.*鶏|鶏.*生食/u.test(procedureText),
    "raw_chicken_hint",
  );

  // 家庭キッチンでやりにくい機器
  add(
    "no_pro_equipment",
    !/真空|ソスヴィ|blast chiller|パコジェット|中華レンジ/iu.test(procedureText + identity),
    "pro_equipment",
  );
  // 手順が「市販を温めるだけ」で主材料を無視していないか（粗い）
  const onlyReadyMeal = /レンジでチン|温めるだけ|開けて盛/u.test(procedureText) && !mainOk;
  add("not_only_ready_meal_without_main", !onlyReadyMeal, "ready_meal_skip_main");

  const max = Object.keys(checks).length;
  const total = Object.values(checks).filter(Boolean).length;
  return { total, max, failFlags: [...new Set(failFlags)], checks };
}

function summarizeMenu(menu: MenuLike) {
  return {
    mealType: menu.mealType,
    cuisineGenre: menu.cuisineGenre,
    servings: menu.servings,
    totalElapsedMinutes: menu.totalElapsedMinutes,
    dishes: menu.dishes.map((d) => ({
      role: d.role,
      name: d.name,
      description: d.description,
      cookingTimeMinutes: d.cookingTimeMinutes,
      ingredients: d.ingredients.map((i) => ({
        name: i.name,
        quantityText: i.quantityText,
        unit: i.unit,
      })),
      steps: d.steps.map((s) => s.instruction),
    })),
    timeline: menu.timeline.map((t) => ({
      startMinute: t.startMinute,
      durationMinutes: t.durationMinutes,
      instruction: t.instruction,
    })),
  };
}

export async function reviewGenerationQuality(input: {
  modelId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{
  ok: boolean;
  outcome: string;
  failureCodes: readonly string[];
  responseModel: string | null;
  elapsedMs: number;
  score: Score | null;
  menuSummary: ReturnType<typeof summarizeMenu> | null;
  validateOk: boolean | null;
}> {
  const generationContext = ideaContext();
  const started = performance.now();
  let responseModel: string | null = null;
  const uuid = createUuidFactory();

  const messages = buildGenerationMessages({
    kind: "new_menu",
    command: {
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: benchmarkIdempotencyKey,
        draftId: benchmarkDraftId,
        draftRevision: 1,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    requestId: "91000000-0000-4000-8000-000000000001",
    generationContext,
    expectedSafetyFingerprint: "idea",
    startedAtMonotonicMs: started,
    deadlineAtMonotonicMs: started + 55_000,
    regeneration: null,
    recentDishHints: [],
  });

  const sender = createOpenRouterGenerationSender({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    models: [input.modelId],
    timeoutMs: ATTEMPT_TIMEOUT_MS,
  });

  try {
    const result = await sender({
      messages,
      timeoutMs: ATTEMPT_TIMEOUT_MS,
      mode: "full_menu",
    });
    responseModel = result.modelId;
    const elapsedMs = Math.round(performance.now() - started);

    if (result.mode !== "full_menu") {
      return {
        ok: false,
        outcome: "wrong_mode",
        failureCodes: ["invalid_provider_menu"],
        responseModel,
        elapsedMs,
        score: null,
        menuSummary: null,
        validateOk: null,
      };
    }
    if (result.output.outcome !== "success") {
      return {
        ok: false,
        outcome: "constraint_conflict",
        failureCodes: [
          "constraint_conflict",
          ...result.output.conflicts.map((c) => c.code).filter(Boolean),
        ],
        responseModel,
        elapsedMs,
        score: null,
        menuSummary: null,
        validateOk: null,
      };
    }

    try {
      const menu = materializeAiGeneratedMenu(result.output.menu, generationContext, uuid);
      const checked = validateGeneratedMenu(menu, generationContext);
      if (!checked.ok) {
        return {
          ok: false,
          outcome: "validate_fail",
          failureCodes: checked.issues.map((i) => i.code),
          responseModel,
          elapsedMs,
          score: null,
          menuSummary: summarizeMenu(menu),
          validateOk: false,
        };
      }
      const score = scoreCookability(checked.menu, generationContext);
      return {
        ok: true,
        outcome: "primary_success",
        failureCodes: [],
        responseModel,
        elapsedMs,
        score,
        menuSummary: summarizeMenu(checked.menu),
        validateOk: true,
      };
    } catch (error) {
      const codes =
        error instanceof GenerationOutputError
          ? error.issues.map((i) => i.code)
          : ["invalid_provider_menu"];
      return {
        ok: false,
        outcome: "materialize_fail",
        failureCodes: codes,
        responseModel,
        elapsedMs,
        score: null,
        menuSummary: null,
        validateOk: false,
      };
    }
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - started);
    if (error instanceof OpenRouterCallError) {
      return {
        ok: false,
        outcome: error.code,
        failureCodes: [error.code],
        responseModel: error.modelId ?? responseModel,
        elapsedMs,
        score: null,
        menuSummary: null,
        validateOk: null,
      };
    }
    return {
      ok: false,
      outcome: "runner_error",
      failureCodes: ["runner_error"],
      responseModel,
      elapsedMs,
      score: null,
      menuSummary: null,
      validateOk: null,
    };
  }
}
