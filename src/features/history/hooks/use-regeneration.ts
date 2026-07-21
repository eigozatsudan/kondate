import { useCallback } from "react";
import { useNavigate } from "react-router";
import type { ChangeReason } from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/use-auth";
import { useGenerationRecovery } from "@/features/generation/hooks/use-generation-recovery";
import { createPendingGeneration } from "@/features/generation/model/pending-generation";
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
 * 再生成コマンドを Plan 3 の PendingGeneration として永続化し、
 * useGenerationRecovery 経由で kind から導出した endpoint へ POST する。
 * 現行マウントの再検証が成功していない限りコマンドを組み立てない。
 */
export function useRegeneration({ menuId, phase, result }: UseRegenerationInput) {
  const userId = useAuth().session?.user.id;
  const recovery = useGenerationRecovery();
  const navigate = useNavigate();

  const canRegenerate =
    phase === "checked" && result !== undefined && isRevalidationActionable(result);

  const startWhole = useCallback(
    async (reason: RegenerationReasonInput) => {
      if (!canRegenerate || userId === undefined) {
        throw new Error("revalidation_required");
      }
      const changeReasonCustom =
        reason.changeReason === "custom" ? reason.changeReasonCustom : null;
      const pending = createPendingGeneration(
        {
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
      await recovery.startGeneration(pending);
      void navigate("/generation");
    },
    [canRegenerate, menuId, navigate, recovery, userId],
  );

  const startDish = useCallback(
    async (dishId: string, reason: RegenerationReasonInput) => {
      if (!canRegenerate || userId === undefined) {
        throw new Error("revalidation_required");
      }
      const changeReasonCustom =
        reason.changeReason === "custom" ? reason.changeReasonCustom : null;
      const pending = createPendingGeneration(
        {
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
      await recovery.startGeneration(pending);
      void navigate("/generation");
    },
    [canRegenerate, menuId, navigate, recovery, userId],
  );

  return { canRegenerate, startWhole, startDish };
}
