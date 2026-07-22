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

export type UseRegenerationInput = {
  menuId: string;
  phase: RevalidationPhaseName;
  result: RevalidationResult | undefined;
};

/**
 * 再生成コマンドを PendingGeneration として永続化し、/generation へ遷移する。
 * POST は GenerationPage の useGenerationRecovery が pending を recover して行う。
 * （結果画面インスタンスで await startGeneration すると、成功時に pending が消え
 *  /generation が idle→planner へ落ちるレースが起きる。）
 */
export function useRegeneration({ menuId, phase, result }: UseRegenerationInput) {
  const userId = useAuth().session?.user.id;
  const navigate = useNavigate();

  const canRegenerate =
    phase === "checked" && result !== undefined && isRevalidationActionable(result);

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
