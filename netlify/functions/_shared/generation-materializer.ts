import {
  aiGeneratedMenuPayloadSchema,
  type AiGeneratedMenuPayload,
} from "../../../shared/contracts/ai-generation-output.js";
import {
  generatedMenuSchema,
  isAllowedMenuDishCount,
  type GeneratedMenu,
} from "../../../shared/contracts/generation.js";
import { normalizeFoodText } from "../../../shared/safety/allergens.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import { formatQuantityValue } from "../../../shared/shopping/normalize.js";
import { normalizeIngredientQuantity } from "../../../shared/shopping/quantity-display.js";
import { GenerationOutputError, type GenerationRepairCode } from "./generation-repair.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function outputError(code: GenerationRepairCode): never {
  throw new GenerationOutputError([code]);
}

function containsUuid(value: unknown): boolean {
  if (typeof value === "string") return uuidPattern.test(value);
  if (Array.isArray(value)) return value.some(containsUuid);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(containsUuid);
}

function uniqueMap<T>(values: readonly T[], ref: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = ref(value);
    if (result.has(key)) outputError("duplicate_ref");
    result.set(key, value);
  }
  return result;
}

function required<T>(map: ReadonlyMap<string, T>, ref: string): T {
  const value = map.get(ref);
  if (value === undefined) outputError("dangling_ref");
  return value;
}

function exactThousandths(value: number): number {
  const scaled = Math.round(value * 1000);
  if (!Number.isSafeInteger(scaled) || scaled / 1000 !== value) {
    outputError("pantry_unit_mismatch");
  }
  return scaled;
}

function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return values.size === left.length && right.every((value) => values.has(value));
}

export function materializeAiGeneratedMenu(
  output: AiGeneratedMenuPayload,
  context: GenerationContext,
  uuid: () => string,
): GeneratedMenu {
  const parsed = aiGeneratedMenuPayloadSchema.safeParse(output);
  if (!parsed.success) outputError("invalid_provider_menu");
  const menu = parsed.data;
  if (containsUuid(menu)) outputError("uuid_in_provider_output");

  const pantryById = new Map(context.pantryItems.map((item) => [item.id, item] as const));
  const pantryByRef = new Map<
    string,
    {
      selection: (typeof context.submission.pantrySelections)[number];
      item: (typeof context.pantryItems)[number];
    }
  >(
    context.submission.pantrySelections.map((selection, index) => {
      const item = pantryById.get(selection.pantryItemId);
      if (item === undefined) outputError("unknown_pantry_ref");
      return [`pantry_${String(index + 1)}`, { selection, item }] as const;
    }),
  );

  // R2/G5: pantryRef が正当な ingredient は name と unit を trusted 上書きする。
  // unit を AI 値のまま残すと dish 行と pantryUsage/在庫単位が乖離し、買い物・分量表示が壊れる。
  // plannedQuantity の単位整合は pantryUsage 側の pantry_unit_mismatch で fail-closed のまま
  //（unit だけ差し替えて成功にしない）。
  // G17: quantityValue は pantryUsage.plannedQuantity を正とする片方向ルール
  //（dish 行と planned の表示/買い物差分を閉じる。アレルギー hard は name 側）。
  // 以降の materialize / sourceByKey / label 経路はすべて working 値を使う。
  const usageByRef = new Map<string, (typeof menu.pantryUsage)[number]>();
  for (const usage of menu.pantryUsage) {
    if (usageByRef.has(usage.pantryRef)) outputError("pantry_usage_duplicate");
    usageByRef.set(usage.pantryRef, usage);
  }

  /** pantryRef 正当時: plannedQuantity → quantityValue（0 以下は契約 positive に載せられないので null） */
  const quantityValueFromPlanned = (
    pantryRef: string | null,
    providerQuantity: number | null,
  ): number | null => {
    if (pantryRef === null) return providerQuantity;
    const usage = usageByRef.get(pantryRef);
    if (usage === undefined) return providerQuantity;
    if (usage.plannedQuantity === null) return null;
    if (usage.plannedQuantity <= 0) return null;
    return usage.plannedQuantity;
  };

  /**
   * G4: pantry 連動時は quantityText を value+unit と揃える（value 片側だけ G17 で揃うのを閉じる）。
   * planned 無しで value が null のときは AI 文言を権威にせず固定「適量」（買い物側と同型）。
   */
  const quantityTextFromValue = (
    pantryRef: string | null,
    quantityValue: number | null,
    unit: string | null,
    providerText: string,
  ): string => {
    if (pantryRef === null) return providerText;
    if (quantityValue === null) return "適量";
    return `${formatQuantityValue(quantityValue)}${unit ?? ""}`;
  };

  const workingDishes = menu.dishes.map((dish) => ({
    ...dish,
    ingredients: dish.ingredients.map((ingredient) => {
      // pantry 連動: trusted 上書きのみ（単位換算しない）
      if (ingredient.pantryRef !== null) {
        const trusted = pantryByRef.get(ingredient.pantryRef);
        if (trusted === undefined) return ingredient;
        const quantityValue = quantityValueFromPlanned(
          ingredient.pantryRef,
          ingredient.quantityValue,
        );
        return {
          ...ingredient,
          name: trusted.item.name,
          unit: trusted.item.unit,
          quantityValue,
          // G4: planned 整合後の value/unit から text を再生成（AI の「999本」等を残さない）
          quantityText: quantityTextFromValue(
            ingredient.pantryRef,
            quantityValue,
            trusted.item.unit,
            ingredient.quantityText,
          ),
        };
      }
      // 買い足しのみ読みやすい分量へ（設計 §4.7）
      const normalized = normalizeIngredientQuantity({
        quantityValue: ingredient.quantityValue,
        quantityText: ingredient.quantityText,
        unit: ingredient.unit,
      });
      return {
        ...ingredient,
        quantityValue: normalized.quantityValue,
        quantityText: normalized.quantityText,
        unit: normalized.unit,
      };
    }),
  }));
  const workingMenu = { ...menu, dishes: workingDishes };

  const dishes = uniqueMap(workingMenu.dishes, (dish) => dish.dishRef);
  const ingredients = uniqueMap(
    workingMenu.dishes.flatMap((dish) => dish.ingredients),
    (ingredient) => ingredient.ingredientRef,
  );
  const steps = uniqueMap(
    workingMenu.dishes.flatMap((dish) => dish.steps),
    (step) => step.stepRef,
  );
  uniqueMap(workingMenu.timeline, (timeline) => timeline.timelineRef);
  uniqueMap(workingMenu.adaptations, (adaptation) => adaptation.adaptationRef);

  const ingredientDishRef = new Map(
    workingMenu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.ingredientRef, dish.dishRef] as const),
    ),
  );
  const stepDishRef = new Map(
    workingMenu.dishes.flatMap((dish) =>
      dish.steps.map((step) => [step.stepRef, dish.dishRef] as const),
    ),
  );
  for (const ref of usageByRef.keys()) {
    if (!pantryByRef.has(ref)) outputError("unknown_pantry_ref");
  }
  for (const [ref, trusted] of pantryByRef) {
    if (trusted.selection.priority !== "must_use") continue;
    const usage = usageByRef.get(ref);
    if (usage === undefined || usage.usageStatus !== "used") outputError("must_use_missing");
  }

  const menuId = uuid();
  const dishIdByRef = new Map(workingMenu.dishes.map((dish) => [dish.dishRef, uuid()] as const));
  const ingredientIdByRef = new Map(
    workingMenu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.ingredientRef, uuid()] as const),
    ),
  );
  const stepIdByRef = new Map(
    workingMenu.dishes.flatMap((dish) => dish.steps.map((step) => [step.stepRef, uuid()] as const)),
  );
  const timelineIdByRef = new Map(
    menu.timeline.map((timeline) => [timeline.timelineRef, uuid()] as const),
  );
  const adaptationIdByRef = new Map(
    menu.adaptations.map((adaptation) => [adaptation.adaptationRef, uuid()] as const),
  );
  const selectionIdByRef = new Map(
    menu.pantryUsage.map((usage) => [usage.pantryRef, uuid()] as const),
  );

  const targetMemberRefs = new Set(context.targetMembers.map((member) => member.anonymousRef));
  // workingMenu.dishes を正本にする（R2/G5 name・unit、G17 quantityValue 上書き後）
  const materializedDishes = workingMenu.dishes.map((dish) => ({
    id: required(dishIdByRef, dish.dishRef),
    role: dish.role,
    position: dish.position,
    name: dish.name,
    description: dish.description,
    cookingTimeMinutes: dish.cookingTimeMinutes,
    ingredients: dish.ingredients.map((ingredient) => {
      if (ingredient.pantryRef !== null && !usageByRef.has(ingredient.pantryRef)) {
        outputError("dangling_ref");
      }
      // pantryRef 正当時は name/unit/quantityValue を trusted 済み。不正 ref は pantryByRef 不在で mismatch。
      if (ingredient.pantryRef !== null) {
        const trusted = pantryByRef.get(ingredient.pantryRef);
        if (
          trusted === undefined ||
          normalizeFoodText(trusted.item.name) !== normalizeFoodText(ingredient.name)
        ) {
          outputError("pantry_name_mismatch");
        }
      }
      return {
        id: required(ingredientIdByRef, ingredient.ingredientRef),
        position: ingredient.position,
        name: ingredient.name,
        // G17: pantry 行は plannedQuantity 整合済み。買い足しは working 上で正規化済み。
        quantityValue: ingredient.quantityValue,
        // G4: working 上で pantry 連動 text も value/unit 整合済み。買い足しは正規化済み。
        quantityText: ingredient.quantityText,
        // working 上で trusted unit 済み（G5）。買い足し（pantryRef null）は正規化済み。
        unit: ingredient.unit,
        storeSection: ingredient.storeSection,
        pantrySelectionId:
          ingredient.pantryRef === null ? null : required(selectionIdByRef, ingredient.pantryRef),
        labelConfirmationRequired: ingredient.labelConfirmationRequired,
      };
    }),
    steps: dish.steps.map((step) => ({
      id: required(stepIdByRef, step.stepRef),
      position: step.position,
      instruction: step.instruction,
    })),
  }));

  const materializedTimeline = menu.timeline.map((timeline) => {
    if (timeline.dishRef !== null) required(dishes, timeline.dishRef);
    if (timeline.stepRef !== null) required(steps, timeline.stepRef);
    if (
      timeline.dishRef !== null &&
      timeline.stepRef !== null &&
      stepDishRef.get(timeline.stepRef) !== timeline.dishRef
    ) {
      outputError("dangling_ref");
    }
    return {
      id: required(timelineIdByRef, timeline.timelineRef),
      position: timeline.position,
      startMinute: timeline.startMinute,
      durationMinutes: timeline.durationMinutes,
      instruction: timeline.instruction,
      dishId: timeline.dishRef === null ? null : required(dishIdByRef, timeline.dishRef),
      recipeStepId: timeline.stepRef === null ? null : required(stepIdByRef, timeline.stepRef),
    };
  });

  const materializedAdaptations = menu.adaptations.map((adaptation) => {
    if (!targetMemberRefs.has(adaptation.anonymousMemberRef)) {
      outputError("unknown_member_ref");
    }
    required(dishes, adaptation.dishRef);
    required(steps, adaptation.beforeStepRef);
    if (stepDishRef.get(adaptation.beforeStepRef) !== adaptation.dishRef) {
      outputError("dangling_ref");
    }
    return {
      id: required(adaptationIdByRef, adaptation.adaptationRef),
      dishId: required(dishIdByRef, adaptation.dishRef),
      anonymousMemberRef: adaptation.anonymousMemberRef,
      portionText: adaptation.portionText,
      branchBeforeRecipeStepId: required(stepIdByRef, adaptation.beforeStepRef),
      additionalCutting: adaptation.additionalCutting,
      additionalHeating: adaptation.additionalHeating,
      additionalSeasoning: adaptation.additionalSeasoning,
      servingCheck: adaptation.servingCheck,
      // adaptation の AI tags も信頼せず strip（G10）
      safetyTags: [],
      safetyActions: adaptation.safetyActions.map((action) => {
        if (
          action.dishRef !== adaptation.dishRef ||
          action.anonymousMemberRef !== adaptation.anonymousMemberRef ||
          ingredientDishRef.get(action.ingredientRef) !== adaptation.dishRef ||
          stepDishRef.get(action.beforeStepRef) !== adaptation.dishRef
        ) {
          outputError("dangling_ref");
        }
        return {
          kind: action.kind,
          dishId: required(dishIdByRef, action.dishRef),
          ingredientId: required(ingredientIdByRef, action.ingredientRef),
          anonymousMemberRef: action.anonymousMemberRef,
          beforeRecipeStepId: required(stepIdByRef, action.beforeStepRef),
          instruction: action.instruction,
        };
      }),
    };
  });

  const materializedPantryUsage = menu.pantryUsage.map((usage) => {
    const trusted = pantryByRef.get(usage.pantryRef);
    if (trusted === undefined) outputError("unknown_pantry_ref");
    if (trusted.selection.priority !== usage.priority) outputError("pantry_priority_mismatch");
    const providerUnit = usage.unit?.trim() ?? null;
    const trustedUnit = trusted.item.unit?.trim() ?? null;
    if (providerUnit !== trustedUnit) outputError("pantry_unit_mismatch");
    if (usage.plannedQuantity !== null && trusted.item.quantity === null) {
      outputError("pantry_unit_mismatch");
    }
    const plannedThousandths =
      usage.plannedQuantity === null ? null : exactThousandths(usage.plannedQuantity);
    const inventoryThousandths =
      trusted.item.quantity === null ? null : exactThousandths(trusted.item.quantity);
    const actualDishRefs = menu.dishes
      .filter((dish) =>
        dish.ingredients.some((ingredient) => ingredient.pantryRef === usage.pantryRef),
      )
      .map((dish) => dish.dishRef);
    if (!equalStringSets(usage.dishRefs, actualDishRefs)) {
      outputError("pantry_usage_link_mismatch");
    }
    return {
      selectionId: required(selectionIdByRef, usage.pantryRef),
      pantryItemId: trusted.item.id,
      pantryItemName: trusted.item.name,
      priority: usage.priority,
      usageStatus: usage.usageStatus,
      plannedQuantity: usage.plannedQuantity,
      inventoryQuantity: trusted.item.quantity,
      shortageQuantity:
        plannedThousandths === null || inventoryThousandths === null
          ? null
          : Math.max(plannedThousandths - inventoryThousandths, 0) / 1000,
      unit: trusted.item.unit,
      dishIds: usage.dishRefs.map((ref) => required(dishIdByRef, ref)),
      unusedReason: usage.unusedReason,
    };
  });

  const sourceByKey = new Map<string, { id: string; paths: ReadonlyMap<string, string> }>();
  const sourceTypesByRef = new Map<string, Set<string>>();
  const addSource = (type: string, ref: string, id: string, paths: readonly [string, string][]) => {
    sourceByKey.set(`${type}:${ref}`, { id, paths: new Map(paths) });
    const sourceTypes = sourceTypesByRef.get(ref) ?? new Set<string>();
    sourceTypes.add(type);
    sourceTypesByRef.set(ref, sourceTypes);
  };
  workingMenu.dishes.forEach((dish, dishIndex) => {
    addSource("dish", dish.dishRef, required(dishIdByRef, dish.dishRef), [
      [`dishes.${String(dishIndex)}.name`, dish.name],
      [`dishes.${String(dishIndex)}.description`, dish.description],
    ]);
    dish.ingredients.forEach((ingredient, ingredientIndex) => {
      const base = `dishes.${String(dishIndex)}.ingredients.${String(ingredientIndex)}`;
      const paths: [string, string][] = [
        [`${base}.name`, ingredient.name],
        [`${base}.quantityText`, ingredient.quantityText],
      ];
      if (ingredient.unit !== null) paths.push([`${base}.unit`, ingredient.unit]);
      addSource(
        "ingredient",
        ingredient.ingredientRef,
        required(ingredientIdByRef, ingredient.ingredientRef),
        paths,
      );
    });
    dish.steps.forEach((step, stepIndex) => {
      addSource("recipe_step", step.stepRef, required(stepIdByRef, step.stepRef), [
        [`dishes.${String(dishIndex)}.steps.${String(stepIndex)}.instruction`, step.instruction],
      ]);
    });
  });
  workingMenu.timeline.forEach((timeline, index) => {
    addSource("timeline", timeline.timelineRef, required(timelineIdByRef, timeline.timelineRef), [
      [`timeline.${String(index)}.instruction`, timeline.instruction],
    ]);
  });
  workingMenu.adaptations.forEach((adaptation, index) => {
    const base = `adaptations.${String(index)}`;
    const paths: [string, string][] = [
      [`${base}.portionText`, adaptation.portionText],
      [`${base}.servingCheck`, adaptation.servingCheck],
    ];
    if (adaptation.additionalCutting !== null) {
      paths.push([`${base}.additionalCutting`, adaptation.additionalCutting]);
    }
    if (adaptation.additionalHeating !== null) {
      paths.push([`${base}.additionalHeating`, adaptation.additionalHeating]);
    }
    if (adaptation.additionalSeasoning !== null) {
      paths.push([`${base}.additionalSeasoning`, adaptation.additionalSeasoning]);
    }
    adaptation.safetyActions.forEach((action, actionIndex) => {
      paths.push([`${base}.safetyActions.${String(actionIndex)}.instruction`, action.instruction]);
    });
    addSource(
      "adaptation",
      adaptation.adaptationRef,
      required(adaptationIdByRef, adaptation.adaptationRef),
      paths,
    );
  });

  const labels = workingMenu.labelConfirmations.map((label) => {
    if (!targetMemberRefs.has(label.anonymousMemberRef)) outputError("unknown_member_ref");
    const expectedPrefix = {
      dish: "dish_",
      ingredient: "ingredient_",
      recipe_step: "step_",
      adaptation: "adaptation_",
      timeline: "timeline_",
    }[label.sourceType];
    if (!label.sourceRef.startsWith(expectedPrefix)) {
      outputError(
        sourceTypesByRef.has(label.sourceRef) ? "wrong_kind_ref" : "label_source_invalid",
      );
    }
    const source = sourceByKey.get(`${label.sourceType}:${label.sourceRef}`);
    if (source === undefined) outputError("label_source_invalid");
    const sourceText = source.paths.get(label.sourcePath);
    if (sourceText === undefined) outputError("label_source_invalid");
    // ingredient.name は working 上で trusted 済み（unit も G5 で trusted）。不正 ref のみ mismatch。
    if (label.sourceType === "ingredient") {
      const ingredient = required(ingredients, label.sourceRef);
      if (ingredient.pantryRef !== null) {
        const trusted = pantryByRef.get(ingredient.pantryRef);
        if (
          trusted === undefined ||
          normalizeFoodText(trusted.item.name) !== normalizeFoodText(ingredient.name)
        ) {
          outputError("pantry_name_mismatch");
        }
      }
    }
    return {
      sourceType: label.sourceType,
      sourceId: source.id,
      sourcePath: label.sourcePath,
      sourceText,
      allergenId: label.allergenId,
      anonymousMemberRef: label.anonymousMemberRef,
      dictionaryVersion: label.dictionaryVersion,
      confirmationStatus: "pending" as const,
    };
  });

  // AI payload は dishes 1–5 を許すが、内部 generatedMenuSchema は食事区分ごとの
  // 最低品数（朝/昼≥2、夕≥3、上限5）と timeline 整合などを superRefine する。
  // ここで opaque な invalid_provider_menu に潰すと repair/診断が評価不能になるため、
  // 内部構造失敗は invalid_menu_structure として閉じる（payload 自体の Zod 失敗は
  // 上記 invalid_provider_menu のまま）。
  // ちょうど N ではなく下限〜上限。超過（上限内）はメイン食材分散のために許容する。
  if (!isAllowedMenuDishCount(menu.mealType, workingMenu.dishes.length)) {
    outputError("invalid_menu_structure");
  }

  const result = generatedMenuSchema.safeParse({
    schemaVersion: menu.schemaVersion,
    menuId,
    mealType: menu.mealType,
    cuisineGenre: menu.cuisineGenre,
    servings: menu.servings,
    totalElapsedMinutes: menu.totalElapsedMinutes,
    // AI safetyTags は権威にしない。persist 残党を避けるため常に空（G10）。validate は actions 側。
    safetyTags: [],
    dishes: materializedDishes,
    timeline: materializedTimeline,
    adaptations: materializedAdaptations,
    pantryUsage: materializedPantryUsage,
    labelConfirmations: labels,
  });
  if (!result.success) outputError("invalid_menu_structure");
  return result.data;
}
