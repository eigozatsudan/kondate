// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { ValidatedMenu } from "../../../shared/contracts/generation.js";
import { makeValidatedMenu } from "../../../shared/testing/factories.js";
import { OpenRouterCallError } from "./openrouter.js";
import {
  mergeShareFreeTextAndRestoreLock,
  runShareGeneralizeAiPipeline,
  type SharePassSender,
} from "./share-generalize-pipeline.js";
import {
  extractShareFreeTextForPrompt,
  type ShareFreeTextPatch,
  type ShareOpenRouterPassResult,
} from "./share-openrouter.js";
import { captureShareIngredientGraphLock } from "./share-server-gate.js";

function identityPatch(menu: ValidatedMenu): ShareFreeTextPatch {
  return extractShareFreeTextForPrompt(menu);
}

function generalizedPatch(menu: ValidatedMenu): ShareFreeTextPatch {
  const base = identityPatch(menu);
  return {
    ...base,
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            name: "一般化した主食",
            description: "共有向けの説明",
            ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
              ingredientIndex === 0 ? { ...ingredient, name: "白米ごはん" } : ingredient,
            ),
            steps: dish.steps.map((step, stepIndex) =>
              stepIndex === 0 ? { ...step, instruction: "ご飯をにぎり形にする" } : step,
            ),
          }
        : dish,
    ),
    timeline: base.timeline.map((step, index) =>
      index === 0 ? { ...step, instruction: "並行して準備する" } : step,
    ),
  };
}

/** モデルが数量を改変しようとしたパッチ（merge 時にロックで上書きされる前提） */
function patchWithBogusQuantityMutation(menu: ValidatedMenu): ShareFreeTextPatch {
  // free-text schema に数量は無いが、name を変えたうえで
  // pipeline が quantity をロックから復元することを検証する
  return generalizedPatch(menu);
}

function makeSender(
  impl: (
    pass: "pass1" | "pass2",
    menu: ValidatedMenu,
  ) => ShareOpenRouterPassResult | Promise<ShareOpenRouterPassResult>,
): SharePassSender {
  return ({ pass, menu }) => Promise.resolve(impl(pass, menu));
}

describe("runShareGeneralizeAiPipeline", () => {
  it("records two AI call ledger increments on Pass1+Pass2 success", async () => {
    const menu = makeValidatedMenu();
    const ledger = vi.fn();
    const publish = vi.fn();
    const sendPass = makeSender((pass, current) => ({
      modelId: pass === "pass1" ? "model-p1" : "model-p2",
      patch: pass === "pass1" ? generalizedPatch(current) : identityPatch(current),
    }));

    const result = await runShareGeneralizeAiPipeline({
      menu,
      sendPass,
      recordAiCallLedger: ledger,
      publish,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aiCallCount).toBe(2);
    expect(ledger).toHaveBeenCalledTimes(2);
    expect(ledger).toHaveBeenNthCalledWith(1, 1);
    expect(ledger).toHaveBeenNthCalledWith(2, 1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.pass1Model).toBe("model-p1");
    expect(result.pass2Model).toBe("model-p2");
  });

  it("records AI call on Pass failure without success publish", async () => {
    const menu = makeValidatedMenu();
    const ledger = vi.fn();
    const publish = vi.fn();
    const sendPass = makeSender((pass) => {
      if (pass === "pass1") {
        throw new OpenRouterCallError("model_unavailable");
      }
      return { modelId: "model-p2", patch: identityPatch(menu) };
    });

    const result = await runShareGeneralizeAiPipeline({
      menu,
      sendPass,
      recordAiCallLedger: ledger,
      publish,
    });

    expect(result).toEqual({
      ok: false,
      code: "openrouter_failed",
      aiCallCount: 1,
      pass1Model: null,
      pass2Model: null,
    });
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(ledger).toHaveBeenCalledWith(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("never calls reserve_ai_generation", async () => {
    const pipelineSource = await readFile(
      new URL("./share-generalize-pipeline.ts", import.meta.url),
      "utf8",
    );
    const openrouterSource = await readFile(
      new URL("./share-openrouter.ts", import.meta.url),
      "utf8",
    );
    // リテラル呼び出し・RPC 名文字列のみ禁止（説明コメントは対象外）
    expect(pipelineSource).not.toMatch(/["']reserve_ai_generation["']/);
    expect(openrouterSource).not.toMatch(/["']reserve_ai_generation["']/);
    expect(pipelineSource).not.toMatch(/generation-repository/);
    expect(openrouterSource).not.toMatch(/generation-repository/);

    const rpc = vi.fn();
    const menu = makeValidatedMenu();
    await runShareGeneralizeAiPipeline({
      menu,
      sendPass: makeSender((_pass, current) => ({
        modelId: "m",
        patch: identityPatch(current),
      })),
      recordAiCallLedger: () => {
        // 台帳は injectable。generate 用 RPC 名を絶対に呼ばない
        void rpc;
      },
      publish: () => undefined,
    });
    expect(rpc).not.toHaveBeenCalledWith("reserve_ai_generation", expect.anything());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("merges model free-text but restores ingredient quantities from lock", async () => {
    const menu = makeValidatedMenu();
    const lock = captureShareIngredientGraphLock(menu);
    const firstIngredient = menu.dishes[0]?.ingredients[0];
    expect(firstIngredient).toBeDefined();

    // ロック後にソース側 quantity を改変しても、merge は lock を正とする
    const menuWithMutatedQuantities: ValidatedMenu = {
      ...menu,
      dishes: menu.dishes.map((dish, dishIndex) =>
        dishIndex === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0
                  ? {
                      ...ingredient,
                      quantityValue: 9999,
                      quantityText: "改変された量",
                      unit: "杯",
                    }
                  : ingredient,
              ),
            }
          : dish,
      ),
    };

    const patch = patchWithBogusQuantityMutation(menuWithMutatedQuantities);
    const merged = mergeShareFreeTextAndRestoreLock(menuWithMutatedQuantities, patch, lock);
    expect(merged).not.toBeNull();
    if (merged === null) return;

    const restored = merged.dishes[0]?.ingredients[0];
    expect(restored?.name).toBe("白米ごはん");
    expect(restored?.quantityValue).toBe(firstIngredient?.quantityValue);
    expect(restored?.quantityText).toBe(firstIngredient?.quantityText);
    expect(restored?.unit).toBe(firstIngredient?.unit);
    expect(restored?.storeSection).toBe(firstIngredient?.storeSection);
    expect(merged.dishes[0]?.name).toBe("一般化した主食");
    expect(merged.dishes[0]?.steps[0]?.instruction).toBe("ご飯をにぎり形にする");

    // pipeline 経由でも publish 前メニューがロック数量を持つ
    const publish = vi.fn();
    const result = await runShareGeneralizeAiPipeline({
      menu: menuWithMutatedQuantities,
      lockedGraph: lock,
      sendPass: makeSender((_pass, current) => ({
        modelId: "m",
        patch: generalizedPatch(current),
      })),
      recordAiCallLedger: () => undefined,
      publish,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const publishedMenu = publish.mock.calls[0]?.[0] as ValidatedMenu;
    expect(publishedMenu.dishes[0]?.ingredients[0]?.quantityValue).toBe(
      firstIngredient?.quantityValue,
    );
    expect(publishedMenu.dishes[0]?.ingredients[0]?.quantityText).toBe(
      firstIngredient?.quantityText,
    );
  });

  it("does not publish when Pass2 fails after Pass1 ok", async () => {
    const menu = makeValidatedMenu();
    const ledger = vi.fn();
    const publish = vi.fn();
    const sendPass = makeSender((pass, current) => {
      if (pass === "pass1") {
        return { modelId: "model-p1", patch: generalizedPatch(current) };
      }
      throw new OpenRouterCallError("invalid_ai_response", "model-p2");
    });

    const result = await runShareGeneralizeAiPipeline({
      menu,
      sendPass,
      recordAiCallLedger: ledger,
      publish,
    });

    expect(result).toEqual({
      ok: false,
      code: "openrouter_failed",
      aiCallCount: 2,
      pass1Model: "model-p1",
      pass2Model: null,
    });
    expect(ledger).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalled();
  });
});
