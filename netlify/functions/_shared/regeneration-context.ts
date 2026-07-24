import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  GeneratedMenu,
  GenerationCommand,
  ValidatedMenu,
} from "../../../shared/contracts/generation.js";
import { generatedMenuSchema } from "../../../shared/contracts/generation.js";
import {
  assertMaterializationRefUnion,
  dishRegenerationAiOutputSchema,
  dishRegenerationPromptSchema,
  retainedDishPromptSchema,
  type DishRegenerationPrompt,
  type RetainedDishPrompt,
} from "../../../shared/contracts/regeneration.js";
import {
  createDishSignature,
  createMenuSignature,
  isMateriallySameDish,
  isMateriallySameMenu,
  type DishSignatureInput,
} from "../../../shared/safety/deduplicate.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import { createIdeaSafetyFingerprint } from "../../../shared/safety/idea-fingerprint.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import type { AuthenticatedUser } from "./generation-repository.js";
import type { GenerationExecutionContext } from "./generation-service.js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { toStoredRevalidationCandidate, type StoredMenuAggregate } from "./stored-menu-loader.js";

type RegenerationCommand = Extract<
  GenerationCommand,
  { kind: "regenerate_menu" | "regenerate_dish" }
>;

const preferenceSnapshotSchema = z.record(z.string(), z.unknown()).readonly();

/** createDishSignature の JSON 形から material 比較用入力を復元する */
const dishSignaturePayloadSchema = z.tuple([z.string(), z.string(), z.array(z.string())]);

const dishSignatureInput = (dish: ValidatedMenu["dishes"][number]): DishSignatureInput => ({
  role: dish.role,
  name: dish.name,
  primaryIngredients: dish.ingredients.map((item) => item.name),
});


/**
 * 削除済みメンバーの取り分け・安全処理・ラベルを現行対象だけへ射影する。
 * 設計 §4.4: 削除済みは AI 入力にも新 version にも複製しない。
 * 再生成前の validate が target_member_mismatch で誤拒否するのも防ぐ。
 */
export function projectMenuForSurvivingTargets(
  menu: ValidatedMenu,
  survivingAnonymousRefs: ReadonlySet<string>,
): ValidatedMenu {
  return {
    ...menu,
    adaptations: menu.adaptations
      .filter((adaptation) => survivingAnonymousRefs.has(adaptation.anonymousMemberRef))
      .map((adaptation) => ({
        ...adaptation,
        safetyActions: adaptation.safetyActions.filter((action) =>
          survivingAnonymousRefs.has(action.anonymousMemberRef),
        ),
      })),
    labelConfirmations: menu.labelConfirmations.filter((label) =>
      survivingAnonymousRefs.has(label.anonymousMemberRef),
    ),
  };
}

/**
 * 既存 derivation のシグネチャ文字列を material 判定入力へ戻す。
 * 破損シグネチャは比較不能として null（一致扱いにしない）。
 */
function dishInputFromSignature(signature: string): DishSignatureInput | null {
  try {
    const parsed = dishSignaturePayloadSchema.safeParse(JSON.parse(signature));
    if (!parsed.success) return null;
    const [role, name, primaryIngredients] = parsed.data;
    return { role, name, primaryIngredients };
  } catch {
    return null;
  }
}

type RetainedPromptResult = {
  dto: readonly RetainedDishPrompt[];
  replaceTarget: RetainedDishPrompt | null;
  refMap: ReadonlyMap<string, string>;
};

/**
 * 保持料理を request-local ref 付き DTO へ投影する。
 * refMap は server 専用（localRef → 元 UUID）。prompt JSON には載せない。
 */
export function toRetainedDishPrompt(
  menu: ValidatedMenu,
  replaceDishId: string | null,
): RetainedPromptResult {
  const refMap = new Map<string, string>();
  const ordered = menu.dishes.toSorted((left, right) => left.position - right.position);
  const all = ordered.map((dish, dishIndex) => {
    const dishRef = `dish_${String(dishIndex + 1)}`;
    refMap.set(dishRef, dish.id);
    return {
      dishRef,
      role: dish.role,
      position: dish.position,
      name: dish.name,
      description: dish.description,
      cookingTimeMinutes: dish.cookingTimeMinutes,
      ingredients: dish.ingredients
        .toSorted((left, right) => left.position - right.position)
        .map((item, itemIndex) => {
          const ingredientRef = `ingredient_${String(dishIndex * 50 + itemIndex + 1)}`;
          refMap.set(ingredientRef, item.id);
          return {
            ingredientRef,
            position: item.position,
            name: item.name,
            quantityValue: item.quantityValue,
            quantityText: item.quantityText,
            unit: item.unit,
            storeSection: item.storeSection,
            pantryRef: null as string | null,
            labelConfirmationRequired: item.labelConfirmationRequired,
          };
        }),
      steps: dish.steps
        .toSorted((left, right) => left.position - right.position)
        .map((step, stepIndex) => {
          const stepRef = `step_${String(dishIndex * 30 + stepIndex + 1)}`;
          refMap.set(stepRef, step.id);
          return {
            stepRef,
            position: step.position,
            instruction: step.instruction,
          };
        }),
    };
  });
  const replaceIndex =
    replaceDishId === null ? -1 : ordered.findIndex((dish) => dish.id === replaceDishId);
  const replaceTarget = replaceIndex < 0 ? null : (all[replaceIndex] ?? null);
  const dto = all.filter((_, index) => index !== replaceIndex);
  return { dto, replaceTarget, refMap };
}

/** Plan 3 artifacts: unknown を閉じた Plan 4 形へ narrowing する */
type RegenerationArtifacts = {
  retainedDishes: readonly RetainedDishPrompt[];
  sourceDishToReplace: RetainedDishPrompt | null;
  promptDto: DishRegenerationPrompt | null;
  retainedRefMap: ReadonlyMap<string, string>;
};

/**
 * artifacts をパースし、serializable 3 フィールド + server-only Map を閉じる。
 * 不正なら OpenRouter / 永続化の前に fail-closed。
 */
export function requireRegenerationArtifacts(value: unknown): RegenerationArtifacts {
  const shell = z
    .object({
      retainedDishes: z.array(retainedDishPromptSchema).max(9),
      sourceDishToReplace: retainedDishPromptSchema.nullable(),
      promptDto: dishRegenerationPromptSchema.nullable(),
      retainedRefMap: z.unknown(),
    })
    .strict()
    .parse(value);

  if (!(shell.retainedRefMap instanceof Map)) {
    throw new Error("regeneration_artifacts_ref_map_invalid");
  }
  const retainedRefMap = shell.retainedRefMap as Map<unknown, unknown>;
  for (const [key, mapped] of retainedRefMap) {
    if (typeof key !== "string" || typeof mapped !== "string") {
      throw new Error("regeneration_artifacts_ref_map_invalid");
    }
  }
  return {
    retainedDishes: shell.retainedDishes,
    sourceDishToReplace: shell.sourceDishToReplace,
    promptDto: shell.promptDto,
    retainedRefMap: retainedRefMap as ReadonlyMap<string, string>,
  };
}

function reverseRefMap(refMap: ReadonlyMap<string, string>): Map<string, string> {
  const reversed = new Map<string, string>();
  for (const [ref, id] of refMap) {
    reversed.set(id, ref);
  }
  return reversed;
}

/**
 * 料理単位再生成のプロンプト DTO を source 集約と ref レジストリから一回構築する。
 * タイムライン等の横断セクションは local ref のみ。確認証跡（confirmedAt 等）は落とす。
 */
export function buildDishRegenerationPrompt(input: {
  command: Extract<GenerationCommand, { kind: "regenerate_dish" }>;
  source: StoredMenuAggregate;
  generationContext: GenerationContext;
  retained: RetainedPromptResult;
}): DishRegenerationPrompt {
  const { command, source, retained } = input;
  if (retained.replaceTarget === null) {
    throw new HttpError(404, "replace_dish_not_found", "変更する料理が見つかりません");
  }

  // 現行対象だけへ射影してから AI 入力を組み立てる（削除メンバーの自由文・ref を載せない）
  const survivingRefs = new Set(
    input.generationContext.targetMembers.map((member) => member.anonymousRef),
  );
  const projectedMenu = projectMenuForSurvivingTargets(source.menu, survivingRefs);

  // 保持 + 置換対象の全 dish/ingredient/step を id→ref に反転
  const full = toRetainedDishPrompt(source.menu, null);
  const idToRef = reverseRefMap(full.refMap);
  const mutableRefMap = new Map(full.refMap);

  // 横断セクション用 ref を追加登録
  let timelineIndex = 0;
  const sourceTimeline = source.menu.timeline
    .toSorted((left, right) => left.position - right.position)
    .map((row) => {
      timelineIndex += 1;
      const timelineRef = `timeline_${String(timelineIndex)}`;
      mutableRefMap.set(timelineRef, row.id);
      return {
        timelineRef,
        position: row.position,
        startMinute: row.startMinute,
        durationMinutes: row.durationMinutes,
        instruction: row.instruction,
        dishRef: row.dishId === null ? null : (idToRef.get(row.dishId) ?? null),
        stepRef: row.recipeStepId === null ? null : (idToRef.get(row.recipeStepId) ?? null),
      };
    });

  let adaptationIndex = 0;
  const sourceAdaptations = projectedMenu.adaptations.map((adaptation) => {
    adaptationIndex += 1;
    const adaptationRef = `adaptation_${String(adaptationIndex)}`;
    mutableRefMap.set(adaptationRef, adaptation.id);
    const dishRef = idToRef.get(adaptation.dishId);
    const beforeStepRef = idToRef.get(adaptation.branchBeforeRecipeStepId);
    // 正規化済み ValidatedMenu では通常到達しない。到達時も 500 ではなく閉じた 422 に揃える。
    if (dishRef === undefined || beforeStepRef === undefined) {
      throw new HttpError(422, "invalid_request", "献立の表示を確認できませんでした");
    }
    return {
      adaptationRef,
      dishRef,
      anonymousMemberRef: adaptation.anonymousMemberRef,
      portionText: adaptation.portionText,
      beforeStepRef,
      additionalCutting: adaptation.additionalCutting,
      additionalHeating: adaptation.additionalHeating,
      additionalSeasoning: adaptation.additionalSeasoning,
      servingCheck: adaptation.servingCheck,
      safetyTags: [...adaptation.safetyTags],
      safetyActions: adaptation.safetyActions.map((action) => {
        const actionDishRef = idToRef.get(action.dishId);
        const ingredientRef = idToRef.get(action.ingredientId);
        const actionStepRef = idToRef.get(action.beforeRecipeStepId);
        if (
          actionDishRef === undefined ||
          ingredientRef === undefined ||
          actionStepRef === undefined
        ) {
          throw new HttpError(422, "invalid_request", "献立の表示を確認できませんでした");
        }
        return {
          kind: action.kind,
          dishRef: actionDishRef,
          ingredientRef,
          anonymousMemberRef: action.anonymousMemberRef,
          beforeStepRef: actionStepRef,
          instruction: action.instruction,
        };
      }),
    };
  });

  // pantry: selectionId または pantryItemId を pantry_N に写す（現行コンテキスト順を優先）
  const pantryIdToRef = new Map<string, string>();
  input.generationContext.submission.pantrySelections.forEach((selection, index) => {
    pantryIdToRef.set(selection.pantryItemId, `pantry_${String(index + 1)}`);
  });
  let pantryFallback = pantryIdToRef.size;
  const sourcePantryUsage = source.menu.pantryUsage.map((usage) => {
    let pantryRef =
      (usage.pantryItemId !== null ? pantryIdToRef.get(usage.pantryItemId) : undefined) ??
      pantryIdToRef.get(usage.selectionId);
    if (pantryRef === undefined) {
      pantryFallback += 1;
      pantryRef = `pantry_${String(pantryFallback)}`;
    }
    mutableRefMap.set(pantryRef, usage.selectionId);
    return {
      pantryRef,
      pantryItemName: usage.pantryItemName,
      priority: usage.priority,
      usageStatus: usage.usageStatus,
      plannedQuantity: usage.plannedQuantity,
      inventoryQuantity: usage.inventoryQuantity,
      shortageQuantity: usage.shortageQuantity,
      unit: usage.unit,
      dishRefs: usage.dishIds.flatMap((id) => {
        const ref = idToRef.get(id);
        return ref === undefined ? [] : [ref];
      }),
      unusedReason: usage.unusedReason,
    };
  });

  // timeline / adaptation を id→ref に合流させる。label の sourceId は
  // dish/ingredient/step に限らず timeline・adaptation 行の UUID も取り得る。
  for (const [ref, id] of mutableRefMap) {
    if (!idToRef.has(id)) {
      idToRef.set(id, ref);
    }
  }

  let labelIndex = 0;
  const sourceLabelConfirmations = projectedMenu.labelConfirmations.map((label) => {
    labelIndex += 1;
    const labelRef = `label_${String(labelIndex)}`;
    // ラベル identity は sourceId をキーに登録（DB 行 id が無い generated 形）
    mutableRefMap.set(labelRef, label.sourceId);
    // local-ref スキーマは dish/ingredient/step/timeline/adaptation のみ
    // （recipe_step は step_ 名前空間の UUID を sourceId に持つ）
    const allowedSourceTypes = new Set([
      "dish",
      "ingredient",
      "recipe_step",
      "adaptation",
      "timeline",
    ]);
    if (!allowedSourceTypes.has(label.sourceType)) {
      throw new HttpError(422, "invalid_request", "献立の表示を確認できませんでした");
    }
    const sourceRef = idToRef.get(label.sourceId);
    if (sourceRef === undefined) {
      // 未登録 source は生 Error ではなく閉じた 422 に落とす（500 を出さない）
      throw new HttpError(422, "invalid_request", "献立の表示を確認できませんでした");
    }
    // sourceType に応じた ref 種別を検証（timeline ラベルが dish_ を指す等を拒否）
    const expectedKindPrefix: Record<string, string> = {
      dish: "dish_",
      ingredient: "ingredient_",
      recipe_step: "step_",
      timeline: "timeline_",
      adaptation: "adaptation_",
    };
    const prefix = expectedKindPrefix[label.sourceType];
    if (prefix === undefined || !sourceRef.startsWith(prefix)) {
      throw new HttpError(422, "invalid_request", "献立の表示を確認できませんでした");
    }
    return {
      labelRef,
      sourceType: label.sourceType,
      sourceRef,
      sourcePath: label.sourcePath,
      sourceText: label.sourceText,
      allergenId: label.allergenId,
      anonymousMemberRef: label.anonymousMemberRef,
      dictionaryVersion: label.dictionaryVersion,
      confirmationStatus: "pending" as const,
    };
  });

  const excludedDishSignatures = source.menu.dishes.map((dish) =>
    createDishSignature(dishSignatureInput(dish)),
  );

  return dishRegenerationPromptSchema.parse({
    mode: "dish",
    reason: command.request.changeReason,
    changeReasonCustom: command.request.changeReasonCustom,
    replaceDishRef: retained.replaceTarget.dishRef,
    sourceDishToReplace: retained.replaceTarget,
    retainedDishes: retained.dto,
    sourceTimeline,
    sourceAdaptations,
    sourcePantryUsage,
    sourceLabelConfirmations,
    excludedDishSignatures,
  });
}

export type LoaderDeps = {
  loadSource(user: AuthenticatedUser, menuId: string): Promise<StoredMenuAggregate>;
  loadGroup(user: AuthenticatedUser, groupId: string): Promise<readonly StoredMenuAggregate[]>;
  loadRecent(user: AuthenticatedUser, limit: number): Promise<readonly StoredMenuAggregate[]>;
  buildCurrentContext(input: {
    user: AuthenticatedUser;
    stored: StoredMenuAggregate;
    /** request snapshot.target_mode。idea/household 分岐の唯一の正本 */
    authorityTargetMode: "household" | "idea";
    idempotencyKey: string;
    expiredPantryConfirmations: RegenerationCommand["request"]["expiredPantryConfirmations"];
    now: Date;
  }): Promise<GenerationContext>;
  requestStartedAtMonotonicMs: number;
  now(): Date;
  monotonicNow(): number;
};

/**
 * Plan 3 の GenerationExecutionContext を埋める唯一の再生成ローダー。
 * 実行 union を再宣言しない。
 */
const regenerationSnapshotRowSchema = z
  .object({
    request_id: z.uuid(),
    user_id: z.uuid(),
    kind: z.enum(["regenerate_menu", "regenerate_dish"]),
    source_menu_id: z.uuid(),
    source_menu_version: z.number().int().positive(),
    replace_dish_id: z.uuid().nullable(),
    target_mode: z.enum(["household", "idea"]),
    servings: z.number().int().min(1).max(20),
    target_member_ids: z.array(z.uuid()),
    created_at: z.string(),
  })
  .strict();

/**
 * request-bound snapshot を正本として読み、live source の owner/version と照合する。
 * 不一致・削除は外部送信前に source_menu_changed で fail-closed する。
 */
async function loadRegenerationSnapshot(
  requestId: string,
  userId: string,
): Promise<z.infer<typeof regenerationSnapshotRowSchema>> {
  const { data, error } = await getSupabaseAdmin().rpc("get_ai_generation_regeneration_snapshot", {
    p_request_id: requestId,
    p_user_id: userId,
  });
  if (error !== null) {
    throw new HttpError(500, "internal_error", "再生成の予約情報を確認できませんでした。");
  }
  const rows = z.array(regenerationSnapshotRowSchema).parse(data);
  const snapshot = rows[0];
  if (snapshot === undefined) {
    throw new HttpError(500, "internal_error", "再生成の予約情報が見つかりません。");
  }
  return snapshot;
}

export async function loadRegenerationExecutionContext(
  deps: LoaderDeps,
  user: AuthenticatedUser,
  command: RegenerationCommand,
  requestId: string,
  deadlineAtMonotonicMs: number,
): Promise<GenerationExecutionContext> {
  // request snapshot を正本とし、live source は owner+version 付きで再取得する
  const snapshot = await loadRegenerationSnapshot(requestId, user.userId);
  if (
    snapshot.kind !== command.kind ||
    snapshot.source_menu_id !== command.request.sourceMenuId ||
    (command.kind === "regenerate_dish" && snapshot.replace_dish_id !== command.request.dishId)
  ) {
    throw new HttpError(
      422,
      "source_menu_changed",
      "元の献立が更新されたため、もう一度操作してください",
    );
  }

  // 所有権は owner クエリが先。admin は buildCurrentContext 内でのみ。
  // loadStoredMenu の menu_not_found は source_menu_changed へ写像する（snapshot 後の削除）。
  let source: StoredMenuAggregate;
  try {
    source = await deps.loadSource(user, command.request.sourceMenuId);
  } catch (error) {
    if (error instanceof HttpError && error.code === "menu_not_found") {
      throw new HttpError(
        422,
        "source_menu_changed",
        "元の献立が更新されたため、もう一度操作してください",
      );
    }
    throw error;
  }
  if (source.version !== snapshot.source_menu_version) {
    throw new HttpError(
      422,
      "source_menu_changed",
      "元の献立が更新されたため、もう一度操作してください",
    );
  }
  // version 直後・空メンバー前: live mode と snapshot の構造不一致は source_menu_changed
  if (source.targetMode !== snapshot.target_mode) {
    throw new HttpError(
      422,
      "source_menu_changed",
      "元の献立が更新されたため、もう一度操作してください",
    );
  }
  if (snapshot.target_mode === "household" && source.targetMemberIds.length === 0) {
    throw new HttpError(422, "current_target_member_required", "現在の家族を1人以上選んでください");
  }
  const replaceDishId = command.kind === "regenerate_dish" ? command.request.dishId : null;
  if (replaceDishId !== null && !source.menu.dishes.some((dish) => dish.id === replaceDishId)) {
    throw new HttpError(404, "replace_dish_not_found", "変更する料理が見つかりません");
  }

  const [group, recent, generationContext] = await Promise.all([
    deps.loadGroup(user, source.derivationGroupId),
    deps.loadRecent(user, 20),
    deps.buildCurrentContext({
      user,
      stored: source,
      // 分岐の正本は request snapshot。preference / live から mode を推測しない
      authorityTargetMode: snapshot.target_mode,
      idempotencyKey: command.request.idempotencyKey,
      expiredPantryConfirmations: command.request.expiredPantryConfirmations,
      now: deps.now(),
    }),
  ]);

  // 再検証ゲートは snapshot 一本。generationContext との OR は dual-source を許すため禁止
  if (snapshot.target_mode === "household") {
    const survivingRefs = new Set(
      generationContext.targetMembers.map((member) => member.anonymousRef),
    );
    const projectedForGate = projectMenuForSurvivingTargets(source.menu, survivingRefs);
    const validation = validateGeneratedMenu(
      toStoredRevalidationCandidate(projectedForGate, generationContext),
      generationContext,
    );
    if (!validation.ok) {
      throw new HttpError(
        422,
        "current_safety_revalidation_required",
        "現在の家族設定ではこの献立を利用できません",
      );
    }
  }

  const versions = new Map([...group, ...recent].map((item) => [item.menu.menuId, item]));
  // source 自身も除外集合へ（group に含まれない場合の保険）
  if (!versions.has(source.menu.menuId)) {
    versions.set(source.menu.menuId, source);
  }
  const existingDerivationMenus = [...versions.values()].map((item) => ({
    menuId: item.menu.menuId,
    menuSignature: createMenuSignature({
      dishes: item.menu.dishes.map(dishSignatureInput),
    }),
    dishSignatures: item.menu.dishes.map((dish) => createDishSignature(dishSignatureInput(dish))),
  }));

  const retained = toRetainedDishPrompt(source.menu, replaceDishId);
  let promptDto: DishRegenerationPrompt | null = null;
  if (command.kind === "regenerate_dish") {
    promptDto = buildDishRegenerationPrompt({
      command,
      source,
      generationContext,
      retained,
    });
    // 除外シグネチャは derivation 全体を正とする
    promptDto = dishRegenerationPromptSchema.parse({
      ...promptDto,
      excludedDishSignatures: existingDerivationMenus.flatMap((menu) => menu.dishSignatures),
    });
  }

  const regenerationBase = {
    sourceMenuId: source.menu.menuId,
    sourceMenu: source.menu,
    derivationGroupId: source.derivationGroupId,
    retainedDishIds: source.menu.dishes
      .filter((dish) => dish.id !== replaceDishId)
      .map((dish) => dish.id),
    excludedDishIds: [...versions.values()].flatMap((item) =>
      item.menu.dishes.map((dish) => dish.id),
    ),
    sourceSafetyFingerprint: source.safetyFingerprint,
    sourcePreferenceSnapshot: preferenceSnapshotSchema.parse(source.preferenceSnapshot),
    existingDerivationMenus,
    artifacts: {
      retainedDishes: retained.dto,
      sourceDishToReplace: retained.replaceTarget,
      promptDto,
      retainedRefMap: retained.refMap,
    },
  };

  const executionBase = {
    requestId,
    generationContext,
    expectedSafetyFingerprint:
      generationContext.targetMode === "idea"
        ? createIdeaSafetyFingerprint()
        : createCurrentSafetyFingerprint(generationContext.safety),
    startedAtMonotonicMs: deps.requestStartedAtMonotonicMs,
    deadlineAtMonotonicMs,
  };

  if (command.kind === "regenerate_menu") {
    return {
      ...executionBase,
      kind: command.kind,
      command,
      regeneration: { ...regenerationBase, replaceDishId: null },
    };
  }
  return {
    ...executionBase,
    kind: command.kind,
    command,
    regeneration: { ...regenerationBase, replaceDishId: command.request.dishId },
  };
}

function materializeError(code: string): never {
  throw new Error(code);
}

/**
 * 置換料理 AI 出力 + 保持料理を、現行 GenerationContext 向けの完全 GeneratedMenu に合成する。
 * 集約所有 UUID はすべて新規採番。ラベルは pending のみ。
 */
export function materializeDishRegenerationCandidate(
  execution: Extract<GenerationExecutionContext, { kind: "regenerate_dish" }>,
  rawOutput: unknown,
  uuid: () => string = randomUUID,
): GeneratedMenu {
  const artifacts = requireRegenerationArtifacts(execution.regeneration.artifacts);
  const output = dishRegenerationAiOutputSchema.parse(rawOutput);
  const sourceDish = artifacts.sourceDishToReplace;
  if (sourceDish === null) materializeError("source_dish_to_replace_missing");

  // 1. 置換料理は元と同 role / position を必須
  if (
    output.replacementDish.role !== sourceDish.role ||
    output.replacementDish.position !== sourceDish.position
  ) {
    materializeError("replacement_role_position_mismatch");
  }

  const serverKnownDeclarations = [
    ...artifacts.retainedDishes.flatMap((dish) => [
      dish.dishRef,
      ...dish.ingredients.map((item) => item.ingredientRef),
      ...dish.steps.map((step) => step.stepRef),
    ]),
  ];
  const replacementDeclarations = [
    output.replacementDish.dishRef,
    ...output.replacementDish.ingredients.map((item) => item.ingredientRef),
    ...output.replacementDish.steps.map((step) => step.stepRef),
    ...output.timeline.map((row) => row.timelineRef),
    ...output.adaptations.map((row) => row.adaptationRef),
    ...output.pantryUsage.map((row) => row.pantryRef),
    ...output.labelConfirmations.map((row) => row.labelRef),
  ];

  const referencedRefs = [
    ...output.timeline.flatMap((row) => {
      const refs: { expectedKind: "dish" | "step"; ref: string }[] = [];
      if (row.dishRef !== null) refs.push({ expectedKind: "dish", ref: row.dishRef });
      if (row.stepRef !== null) refs.push({ expectedKind: "step", ref: row.stepRef });
      return refs;
    }),
    ...output.adaptations.flatMap((row) => [
      { expectedKind: "dish" as const, ref: row.dishRef },
      { expectedKind: "step" as const, ref: row.beforeStepRef },
      ...row.safetyActions.flatMap((action) => [
        { expectedKind: "dish" as const, ref: action.dishRef },
        { expectedKind: "ingredient" as const, ref: action.ingredientRef },
        { expectedKind: "step" as const, ref: action.beforeStepRef },
      ]),
    ]),
    ...output.pantryUsage.flatMap((row) =>
      row.dishRefs.map((ref) => ({ expectedKind: "dish" as const, ref })),
    ),
  ];

  assertMaterializationRefUnion({
    serverKnownDeclarations,
    replacementDeclarations,
    referencedRefs,
    labelSourceRefs: output.labelConfirmations.map((row) => row.sourceRef),
  });

  // 置換対象の旧 local ref のうち、置換宣言に含まれないものへの参照だけ拒否。
  // 置換料理が同じ dish_N を再宣言するのは許可する（スロット再利用）。
  const replacementSet = new Set(replacementDeclarations);
  const removedOnlyRefs = new Set(
    [
      sourceDish.dishRef,
      ...sourceDish.ingredients.map((item) => item.ingredientRef),
      ...sourceDish.steps.map((step) => step.stepRef),
    ].filter((ref) => !replacementSet.has(ref)),
  );
  for (const ref of [
    ...output.timeline.flatMap((row) => [row.dishRef, row.stepRef]),
    ...output.adaptations.flatMap((row) => [
      row.dishRef,
      row.beforeStepRef,
      ...row.safetyActions.flatMap((action) => [
        action.dishRef,
        action.ingredientRef,
        action.beforeStepRef,
      ]),
    ]),
    ...output.pantryUsage.flatMap((row) => row.dishRefs),
    ...output.labelConfirmations.map((row) => row.sourceRef),
  ]) {
    if (ref === null) continue;
    if (removedOnlyRefs.has(ref)) {
      materializeError("ref_to_removed_target");
    }
  }

  // 2–3. 保持 + 置換へ fresh UUID を割当
  const dishIdByRef = new Map<string, string>();
  const ingredientIdByRef = new Map<string, string>();
  const stepIdByRef = new Map<string, string>();

  for (const dish of artifacts.retainedDishes) {
    dishIdByRef.set(dish.dishRef, uuid());
    for (const item of dish.ingredients) ingredientIdByRef.set(item.ingredientRef, uuid());
    for (const step of dish.steps) stepIdByRef.set(step.stepRef, uuid());
  }
  dishIdByRef.set(output.replacementDish.dishRef, uuid());
  for (const item of output.replacementDish.ingredients) {
    ingredientIdByRef.set(item.ingredientRef, uuid());
  }
  for (const step of output.replacementDish.steps) {
    stepIdByRef.set(step.stepRef, uuid());
  }

  const timelineIdByRef = new Map(output.timeline.map((row) => [row.timelineRef, uuid()] as const));
  const adaptationIdByRef = new Map(
    output.adaptations.map((row) => [row.adaptationRef, uuid()] as const),
  );
  const selectionIdByRef = new Map(
    output.pantryUsage.map((row) => [row.pantryRef, uuid()] as const),
  );

  const context = execution.generationContext;
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
      if (item === undefined) materializeError("unknown_pantry_ref");
      return [`pantry_${String(index + 1)}`, { selection, item }] as const;
    }),
  );
  const targetMemberRefs = new Set(context.targetMembers.map((member) => member.anonymousRef));

  const mapLocalDish = (dish: RetainedDishPrompt) => ({
    id: requiredMap(dishIdByRef, dish.dishRef),
    role: dish.role,
    position: dish.position,
    name: dish.name,
    description: dish.description,
    cookingTimeMinutes: dish.cookingTimeMinutes,
    ingredients: dish.ingredients.map((item) => ({
      id: requiredMap(ingredientIdByRef, item.ingredientRef),
      position: item.position,
      name: item.name,
      quantityValue: item.quantityValue,
      quantityText: item.quantityText,
      unit: item.unit,
      storeSection: item.storeSection,
      pantrySelectionId:
        item.pantryRef === null ? null : requiredMap(selectionIdByRef, item.pantryRef),
      labelConfirmationRequired: item.labelConfirmationRequired,
    })),
    steps: dish.steps.map((step) => ({
      id: requiredMap(stepIdByRef, step.stepRef),
      position: step.position,
      instruction: step.instruction,
    })),
  });

  const dishes = [
    ...artifacts.retainedDishes.map(mapLocalDish),
    mapLocalDish(output.replacementDish),
  ].toSorted((left, right) => left.position - right.position);

  // 保持料理カバレッジ: 元 retained 数 + 1 置換
  if (dishes.length !== artifacts.retainedDishes.length + 1) {
    materializeError("retained_dish_coverage_missing");
  }

  const sourceMenu = execution.regeneration.sourceMenu;
  const menuId = uuid();
  // ソース集約 ID の再利用を拒否
  const sourceOwnedIds = collectAggregateOwnedIds(sourceMenu);
  if (sourceOwnedIds.has(menuId)) materializeError("reused_source_aggregate_id");
  for (const id of [
    ...dishIdByRef.values(),
    ...ingredientIdByRef.values(),
    ...stepIdByRef.values(),
    ...timelineIdByRef.values(),
    ...adaptationIdByRef.values(),
    ...selectionIdByRef.values(),
  ]) {
    if (sourceOwnedIds.has(id)) materializeError("reused_source_aggregate_id");
  }

  const timeline = output.timeline.map((row) => ({
    id: requiredMap(timelineIdByRef, row.timelineRef),
    position: row.position,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    instruction: row.instruction,
    dishId: row.dishRef === null ? null : requiredMap(dishIdByRef, row.dishRef),
    recipeStepId: row.stepRef === null ? null : requiredMap(stepIdByRef, row.stepRef),
  }));

  const adaptations = output.adaptations.map((row) => {
    if (!targetMemberRefs.has(row.anonymousMemberRef)) materializeError("unknown_member_ref");
    return {
      id: requiredMap(adaptationIdByRef, row.adaptationRef),
      dishId: requiredMap(dishIdByRef, row.dishRef),
      anonymousMemberRef: row.anonymousMemberRef,
      portionText: row.portionText,
      branchBeforeRecipeStepId: requiredMap(stepIdByRef, row.beforeStepRef),
      additionalCutting: row.additionalCutting,
      additionalHeating: row.additionalHeating,
      additionalSeasoning: row.additionalSeasoning,
      servingCheck: row.servingCheck,
      safetyTags: [...row.safetyTags],
      safetyActions: row.safetyActions.map((action) => {
        if (!targetMemberRefs.has(action.anonymousMemberRef)) {
          materializeError("unknown_member_ref");
        }
        return {
          kind: action.kind,
          dishId: requiredMap(dishIdByRef, action.dishRef),
          ingredientId: requiredMap(ingredientIdByRef, action.ingredientRef),
          anonymousMemberRef: action.anonymousMemberRef,
          beforeRecipeStepId: requiredMap(stepIdByRef, action.beforeStepRef),
          instruction: action.instruction,
        };
      }),
    };
  });

  const pantryUsage = output.pantryUsage.map((usage) => {
    const trusted = pantryByRef.get(usage.pantryRef);
    if (trusted === undefined) {
      // 現行コンテキストに無い pantryRef は拒否（スキーマ外参照）
      materializeError("unknown_pantry_ref");
    }
    return {
      selectionId: requiredMap(selectionIdByRef, usage.pantryRef),
      pantryItemId: trusted.item.id,
      pantryItemName: trusted.item.name,
      priority: usage.priority,
      usageStatus: usage.usageStatus,
      plannedQuantity: usage.plannedQuantity,
      inventoryQuantity: trusted.item.quantity,
      shortageQuantity: usage.shortageQuantity,
      unit: trusted.item.unit,
      dishIds: usage.dishRefs.map((ref) => requiredMap(dishIdByRef, ref)),
      unusedReason: usage.unusedReason,
    };
  });

  // label sourceType: recipe_step は schema 上の recipe_step を維持しつつ sourceId は step UUID
  const labelConfirmations = output.labelConfirmations.map((label) => {
    if (!targetMemberRefs.has(label.anonymousMemberRef)) {
      materializeError("unknown_member_ref");
    }
    const prefix = label.sourceRef.split("_")[0];
    let sourceType: "dish" | "ingredient" | "recipe_step" | "timeline" | "adaptation";
    let sourceId: string;
    if (prefix === "dish") {
      sourceType = "dish";
      sourceId = requiredMap(dishIdByRef, label.sourceRef);
    } else if (prefix === "ingredient") {
      sourceType = "ingredient";
      sourceId = requiredMap(ingredientIdByRef, label.sourceRef);
    } else if (prefix === "step") {
      sourceType = "recipe_step";
      sourceId = requiredMap(stepIdByRef, label.sourceRef);
    } else if (prefix === "timeline") {
      sourceType = "timeline";
      sourceId = requiredMap(timelineIdByRef, label.sourceRef);
    } else if (prefix === "adaptation") {
      sourceType = "adaptation";
      sourceId = requiredMap(adaptationIdByRef, label.sourceRef);
    } else {
      materializeError("label_source_invalid");
    }
    return {
      sourceType,
      sourceId,
      sourcePath: label.sourcePath,
      sourceText: label.sourceText,
      allergenId: label.allergenId,
      anonymousMemberRef: label.anonymousMemberRef,
      dictionaryVersion: label.dictionaryVersion,
      confirmationStatus: "pending" as const,
    };
  });

  const totalElapsedMinutes = Math.max(
    ...timeline.map((row) => row.startMinute + row.durationMinutes),
    1,
  );

  return generatedMenuSchema.parse({
    schemaVersion: "2026-07-11.v1",
    menuId,
    mealType: sourceMenu.mealType,
    cuisineGenre: sourceMenu.cuisineGenre,
    servings: sourceMenu.servings,
    totalElapsedMinutes,
    safetyTags: [...sourceMenu.safetyTags],
    dishes,
    timeline,
    adaptations,
    pantryUsage,
    labelConfirmations,
  });
}

function requiredMap(map: ReadonlyMap<string, string>, ref: string): string {
  const value = map.get(ref);
  if (value === undefined) materializeError(`dangling_ref:${ref}`);
  return value;
}

function collectAggregateOwnedIds(menu: ValidatedMenu): Set<string> {
  const ids = new Set<string>([menu.menuId]);
  for (const dish of menu.dishes) {
    ids.add(dish.id);
    for (const item of dish.ingredients) ids.add(item.id);
    for (const step of dish.steps) ids.add(step.id);
  }
  for (const row of menu.timeline) ids.add(row.id);
  for (const row of menu.adaptations) ids.add(row.id);
  for (const row of menu.pantryUsage) ids.add(row.selectionId);
  return ids;
}

/**
 * 候補が derivation 上の既存案と衝突するか。
 * 完全一致シグネチャに加え、Task 2 の material 近傍一致も duplicate_output とする
 *（成功確定・成功枠消費の前に弾く）。
 */
export function isRegenerationDuplicate(
  menu: ValidatedMenu,
  execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" | "regenerate_dish" }>,
): boolean {
  if (execution.kind === "regenerate_menu") {
    const dishes = menu.dishes.map(dishSignatureInput);
    const signature = createMenuSignature({ dishes });
    return execution.regeneration.existingDerivationMenus.some((item) => {
      if (item.menuSignature === signature) return true;
      const existingDishes = item.dishSignatures
        .map(dishInputFromSignature)
        .filter((dish): dish is DishSignatureInput => dish !== null);
      // 破損シグネチャ混在時は material 比較を行わず exact のみにフォールバック
      if (existingDishes.length !== item.dishSignatures.length) return false;
      return isMateriallySameMenu({ dishes }, { dishes: existingDishes });
    });
  }
  const sourceReplace = execution.regeneration.sourceMenu.dishes.find(
    (dish) => dish.id === execution.regeneration.replaceDishId,
  );
  if (sourceReplace === undefined) return false;
  const replacement = menu.dishes.find(
    (dish) => dish.role === sourceReplace.role && dish.position === sourceReplace.position,
  );
  if (replacement === undefined) return false;
  const replacementInput = dishSignatureInput(replacement);
  const dishSig = createDishSignature(replacementInput);
  return execution.regeneration.existingDerivationMenus.some((item) =>
    item.dishSignatures.some((sig) => {
      if (sig === dishSig) return true;
      const existing = dishInputFromSignature(sig);
      return existing !== null && isMateriallySameDish(replacementInput, existing);
    }),
  );
}
