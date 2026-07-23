import { useCallback } from "react";
import { useNavigate } from "react-router";
import type { ChangeReason } from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/use-auth";
import {
  createPendingGeneration,
  savePendingGeneration,
} from "@/features/generation/model/pending-generation";
import { isRevalidationActionable, type RevalidationResult } from "../api/revalidation-api";
import type { RevalidationPhaseName } from "./use-menu-revalidation";

export type RegenerationReasonInput = {
  changeReason: ChangeReason;
  changeReasonCustom: string | null;
};

/**
 * household は現行安全再検証が actionable になるまで再生成を拒否する。
 * idea は家族 revalidation を受け取らず、owner・pending・quota 制御だけを共有する。
 * mode/servings/member IDs は wire に載せず、server が snapshot から複製する。
 */
export type UseRegenerationInput =
  | {
      targetMode: "household";
      menuId: string;
      phase: RevalidationPhaseName;
      result: RevalidationResult | undefined;
    }
  | {
      targetMode: "idea";
      menuId: string;
      phase: null;
      result: null;
    };

/**
 * 再生成コマンドを PendingGeneration として永続化し、/generation へ遷移する。
 * POST は GenerationPage の useGenerationRecovery が pending を recover して行う。
 * （結果画面インスタンスで await startGeneration すると、成功時に pending が消え
 *  /generation が idle→planner へ落ちるレースが起きる。）
 */
export function useRegeneration(input: UseRegenerationInput) {
  const userId = useAuth().session?.user.id;
  const navigate = useNavigate();
  const { menuId, targetMode } = input;

  const canRegenerate =
    targetMode === "idea"
      ? true
      : input.phase === "checked" &&
        input.result !== undefined &&
        isRevalidationActionable(input.result);

  const startWhole = useCallback(
    (reason: RegenerationReasonInput) => {
      if (!canRegenerate || userId === undefined) {
        return Promise.reject(new Error("revalidation_required"));
      }
      const changeReasonCustom =
        reason.changeReason === "custom" ? reason.changeReasonCustom : null;
      const pending = createPendingGeneration(
        {
          commandVersion: "generation-command.v2",
          kind: "regenerate_menu",
          request: {
            idempotencyKey: crypto.randomUUID(),
            sourceMenuId: menuId,
            changeReason: reason.changeReason,
            changeReasonCustom,
            // 元献立の期限確認は引き継がない。今回新たに集めた分だけを載せる。
            expiredPantryConfirmations: [],
          },
        },
        userId,
      );
      savePendingGeneration(pending);
      void navigate("/generation");
      return Promise.resolve();
    },
    [canRegenerate, menuId, navigate, userId],
  );

  const startDish = useCallback(
    (dishId: string, reason: RegenerationReasonInput) => {
      if (!canRegenerate || userId === undefined) {
        return Promise.reject(new Error("revalidation_required"));
      }
      const changeReasonCustom =
        reason.changeReason === "custom" ? reason.changeReasonCustom : null;
      const pending = createPendingGeneration(
        {
          commandVersion: "generation-command.v2",
          kind: "regenerate_dish",
          request: {
            idempotencyKey: crypto.randomUUID(),
            sourceMenuId: menuId,
            dishId,
            changeReason: reason.changeReason,
            changeReasonCustom,
            expiredPantryConfirmations: [],
          },
        },
        userId,
      );
      savePendingGeneration(pending);
      void navigate("/generation");
      return Promise.resolve();
    },
    [canRegenerate, menuId, navigate, userId],
  );

  return { canRegenerate, startWhole, startDish };
}
