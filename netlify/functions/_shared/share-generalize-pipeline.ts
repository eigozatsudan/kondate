/**
 * 共有一般化の AI 段（Pass1 → Pass2）。
 * generate 予約台帳・freemium 生成枠には非接触。publish 実 RPC は Task 7d。
 * 本モジュールは injectable の台帳・publish フックで成功/失敗を閉じる。
 */

import type { ValidatedMenu } from "../../../shared/contracts/generation.js";
import type { ShareFailureCode, ShareSkipReason } from "../../../shared/contracts/share-job.js";
import { OpenRouterCallError } from "./openrouter.js";
import type {
  ShareFreeTextPatch,
  ShareOpenRouterPassResult,
  SharePassKind,
} from "./share-openrouter.js";
import {
  captureShareIngredientGraphLock,
  type ShareIngredientGraphLock,
} from "./share-server-gate.js";

/** Pass 送信の閉じた形（OpenRouter 実体は share-openrouter） */
export type SharePassSender = (input: {
  pass: SharePassKind;
  menu: ValidatedMenu;
}) => Promise<ShareOpenRouterPassResult>;

/**
 * AI call 台帳。
 * 本番 7d は finish/publish の p_ai_call_count に集約して public RPC 経由で
 * private.share_increment_ai_calls が加算される。
 * 7c は injectable（モック可）。public 単独 increment RPC は無い。
 */
export type ShareAiCallLedger = (delta: number) => void | Promise<void>;

/** 成功時のみ呼ぶ publish フック（7c はモック、7d で実 RPC） */
export type SharePublishHook = (menu: ValidatedMenu) => void | Promise<void>;

/**
 * AP6/AP15: 各 sendPass 直前のガード結果。
 * continue で OpenRouter へ進む。skip は AI を呼ばず pipeline を skip 終端する。
 */
export type ShareBeforeEachPassResult = "continue" | { skip: ShareSkipReason };

export type RunShareGeneralizeAiPipelineInput = {
  /** Pass 前のカノニカルメニュー（数量ロックの基準） */
  menu: ValidatedMenu;
  /**
   * 材料グラフロック。省略時は menu から capture。
   * 通常は canonical 直後に capture したものを渡す。
   */
  lockedGraph?: ShareIngredientGraphLock;
  sendPass: SharePassSender;
  /** 1 Pass 試行ごとに 1 を加算（失敗した試行も含む） */
  recordAiCallLedger: ShareAiCallLedger;
  /** Pass1+Pass2 成功時のみ。失敗経路では呼ばない */
  publish: SharePublishHook;
  /**
   * AP6/AP15: 各 sendPass 直前に呼ぶ（同意再確認・削除後 contributor 消滅など）。
   * 省略時はガード無し（単体 pipeline テスト向け）。
   */
  beforeEachPass?: () => Promise<ShareBeforeEachPassResult>;
};

export type ShareGeneralizeAiPipelineResult =
  | {
      ok: true;
      menu: ValidatedMenu;
      aiCallCount: number;
      pass1Model: string;
      pass2Model: string;
    }
  | {
      ok: false;
      /** 失敗（OpenRouter / merge）。publish しない */
      skipped?: false;
      code: ShareFailureCode;
      aiCallCount: number;
      pass1Model: string | null;
      pass2Model: string | null;
    }
  | {
      ok: false;
      /** 同意失効など。AI 未呼出の Pass は台帳に載せない */
      skipped: true;
      code: ShareSkipReason;
      aiCallCount: number;
      pass1Model: string | null;
      pass2Model: string | null;
    };

/**
 * モデル自由文パッチをメニューへ merge し、グラフロックの数量・構成を復元する。
 * id 集合が一致しない・adaptation 数が崩れる場合は null（fail-closed）。
 */
export function mergeShareFreeTextAndRestoreLock(
  menu: ValidatedMenu,
  patch: ShareFreeTextPatch,
  lockedGraph: ShareIngredientGraphLock,
): ValidatedMenu | null {
  if (patch.dishes.length !== menu.dishes.length) return null;
  if (patch.timeline.length !== menu.timeline.length) return null;
  if (patch.adaptations.length !== menu.adaptations.length) return null;
  if (lockedGraph.dishes.length !== menu.dishes.length) return null;

  const dishes: ValidatedMenu["dishes"] = [];
  for (let dishIndex = 0; dishIndex < menu.dishes.length; dishIndex += 1) {
    const sourceDish = menu.dishes[dishIndex];
    const patchDish = patch.dishes[dishIndex];
    const lockedDish = lockedGraph.dishes[dishIndex];
    if (sourceDish === undefined || patchDish === undefined || lockedDish === undefined) {
      return null;
    }
    // id / role / position はロックと一致必須（モデルが id をずらしたら閉じる）
    if (
      patchDish.id !== sourceDish.id ||
      patchDish.id !== lockedDish.id ||
      sourceDish.role !== lockedDish.role ||
      sourceDish.position !== lockedDish.position
    ) {
      return null;
    }
    if (patchDish.ingredients.length !== sourceDish.ingredients.length) return null;
    if (patchDish.steps.length !== sourceDish.steps.length) return null;
    if (lockedDish.ingredients.length !== sourceDish.ingredients.length) return null;

    const ingredients: ValidatedMenu["dishes"][number]["ingredients"] = [];
    for (
      let ingredientIndex = 0;
      ingredientIndex < sourceDish.ingredients.length;
      ingredientIndex += 1
    ) {
      const sourceIngredient = sourceDish.ingredients[ingredientIndex];
      const patchIngredient = patchDish.ingredients[ingredientIndex];
      const lockedIngredient = lockedDish.ingredients[ingredientIndex];
      if (
        sourceIngredient === undefined ||
        patchIngredient === undefined ||
        lockedIngredient === undefined
      ) {
        return null;
      }
      if (
        patchIngredient.id !== sourceIngredient.id ||
        patchIngredient.id !== lockedIngredient.id ||
        sourceIngredient.position !== lockedIngredient.position
      ) {
        return null;
      }
      // name はモデル自由文。数量・単位・区画は常にロックから復元（モデル改変を無視）
      ingredients.push({
        ...sourceIngredient,
        name: patchIngredient.name,
        quantityValue: lockedIngredient.quantityValue,
        quantityText: lockedIngredient.quantityText,
        unit: lockedIngredient.unit,
        storeSection: lockedIngredient.storeSection,
      });
    }

    const steps: ValidatedMenu["dishes"][number]["steps"] = [];
    for (let stepIndex = 0; stepIndex < sourceDish.steps.length; stepIndex += 1) {
      const sourceStep = sourceDish.steps[stepIndex];
      const patchStep = patchDish.steps[stepIndex];
      if (sourceStep === undefined || patchStep === undefined) return null;
      if (patchStep.id !== sourceStep.id) return null;
      steps.push({
        ...sourceStep,
        instruction: patchStep.instruction,
      });
    }

    dishes.push({
      ...sourceDish,
      name: patchDish.name,
      description: patchDish.description,
      ingredients,
      steps,
    });
  }

  const timeline: ValidatedMenu["timeline"] = [];
  for (let timelineIndex = 0; timelineIndex < menu.timeline.length; timelineIndex += 1) {
    const sourceStep = menu.timeline[timelineIndex];
    const patchStep = patch.timeline[timelineIndex];
    if (sourceStep === undefined || patchStep === undefined) return null;
    if (patchStep.id !== sourceStep.id) return null;
    timeline.push({
      ...sourceStep,
      instruction: patchStep.instruction,
    });
  }

  const adaptations: ValidatedMenu["adaptations"] = [];
  for (let adaptationIndex = 0; adaptationIndex < menu.adaptations.length; adaptationIndex += 1) {
    const sourceAdaptation = menu.adaptations[adaptationIndex];
    const patchAdaptation = patch.adaptations[adaptationIndex];
    if (sourceAdaptation === undefined || patchAdaptation === undefined) return null;
    if (patchAdaptation.id !== sourceAdaptation.id) return null;
    if (patchAdaptation.safetyActions.length !== sourceAdaptation.safetyActions.length) {
      return null;
    }

    const safetyActions: ValidatedMenu["adaptations"][number]["safetyActions"] = [];
    for (
      let actionIndex = 0;
      actionIndex < sourceAdaptation.safetyActions.length;
      actionIndex += 1
    ) {
      const sourceAction = sourceAdaptation.safetyActions[actionIndex];
      const patchAction = patchAdaptation.safetyActions[actionIndex];
      if (sourceAction === undefined || patchAction === undefined) return null;
      // kind / 参照 id は構造ロック。instruction のみ自由文
      if (
        patchAction.kind !== sourceAction.kind ||
        patchAction.ingredientId !== sourceAction.ingredientId ||
        patchAction.beforeRecipeStepId !== sourceAction.beforeRecipeStepId
      ) {
        return null;
      }
      safetyActions.push({
        ...sourceAction,
        instruction: patchAction.instruction,
      });
    }

    adaptations.push({
      ...sourceAdaptation,
      portionText: patchAdaptation.portionText,
      additionalCutting: patchAdaptation.additionalCutting,
      additionalHeating: patchAdaptation.additionalHeating,
      additionalSeasoning: patchAdaptation.additionalSeasoning,
      servingCheck: patchAdaptation.servingCheck,
      safetyActions,
    });
  }

  return {
    ...menu,
    dishes,
    timeline,
    adaptations,
  };
}

async function recordOneAiCall(
  recordAiCallLedger: ShareAiCallLedger,
  state: { count: number },
): Promise<void> {
  state.count += 1;
  await recordAiCallLedger(1);
}

/**
 * Pass1 → merge+restore → Pass2 → merge+restore → publish（成功時のみ）。
 * いずれの失敗でも publish しない。AI 試行は台帳へ 1 ずつ計上。
 * beforeEachPass が skip を返した Pass は OpenRouter を呼ばない（AP6/AP15）。
 */
export async function runShareGeneralizeAiPipeline(
  input: RunShareGeneralizeAiPipelineInput,
): Promise<ShareGeneralizeAiPipelineResult> {
  const lockedGraph = input.lockedGraph ?? captureShareIngredientGraphLock(input.menu);
  const ai = { count: 0 };
  let pass1Model: string | null = null;
  let pass2Model: string | null = null;
  let currentMenu = input.menu;

  const runBeforeEachPass = async (): Promise<ShareGeneralizeAiPipelineResult | null> => {
    if (input.beforeEachPass === undefined) return null;
    const gate = await input.beforeEachPass();
    if (gate === "continue") return null;
    return {
      ok: false,
      skipped: true,
      code: gate.skip,
      aiCallCount: ai.count,
      pass1Model,
      pass2Model,
    };
  };

  // --- Pass1 ---
  {
    const skipped = await runBeforeEachPass();
    if (skipped !== null) return skipped;
  }
  try {
    const pass1 = await input.sendPass({ pass: "pass1", menu: currentMenu });
    await recordOneAiCall(input.recordAiCallLedger, ai);
    pass1Model = pass1.modelId;
    const merged1 = mergeShareFreeTextAndRestoreLock(currentMenu, pass1.patch, lockedGraph);
    if (merged1 === null) {
      return {
        ok: false,
        code: "openrouter_failed",
        aiCallCount: ai.count,
        pass1Model,
        pass2Model,
      };
    }
    currentMenu = merged1;
  } catch (error) {
    // 呼出後の失敗も 1 計上（ネットワーク到達後の invalid 等）
    if (error instanceof OpenRouterCallError || error instanceof Error) {
      await recordOneAiCall(input.recordAiCallLedger, ai);
    }
    return {
      ok: false,
      code: "openrouter_failed",
      aiCallCount: ai.count,
      pass1Model,
      pass2Model,
    };
  }

  // --- Pass2 ---
  {
    const skipped = await runBeforeEachPass();
    if (skipped !== null) return skipped;
  }
  try {
    const pass2 = await input.sendPass({ pass: "pass2", menu: currentMenu });
    await recordOneAiCall(input.recordAiCallLedger, ai);
    pass2Model = pass2.modelId;
    const merged2 = mergeShareFreeTextAndRestoreLock(currentMenu, pass2.patch, lockedGraph);
    if (merged2 === null) {
      return {
        ok: false,
        code: "openrouter_failed",
        aiCallCount: ai.count,
        pass1Model,
        pass2Model,
      };
    }
    currentMenu = merged2;
  } catch (error) {
    if (error instanceof OpenRouterCallError || error instanceof Error) {
      await recordOneAiCall(input.recordAiCallLedger, ai);
    }
    return {
      ok: false,
      code: "openrouter_failed",
      aiCallCount: ai.count,
      pass1Model,
      pass2Model,
    };
  }

  // 両 Pass 成功後は model id が string に狭まる（制御フロー上 null 不可）
  const successPass1Model = pass1Model;
  const successPass2Model = pass2Model;

  // Pass1+Pass2 成功時のみ publish。7c ではフック、7d で実 RPC。
  try {
    await input.publish(currentMenu);
  } catch {
    // publish 失敗も非掲載（AI 台帳は既に計上済み）
    return {
      ok: false,
      code: "openrouter_failed",
      aiCallCount: ai.count,
      pass1Model: successPass1Model,
      pass2Model: successPass2Model,
    };
  }

  return {
    ok: true,
    menu: currentMenu,
    aiCallCount: ai.count,
    pass1Model: successPass1Model,
    pass2Model: successPass2Model,
  };
}
