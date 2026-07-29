import { useCallback } from "react";
import { useNavigate } from "react-router";
import { privacyNoticeVersion, type ChangeReason } from "@shared/contracts/domain";
import type { ExpiredPantryConfirmation } from "@shared/contracts/generation";
import { useAuth } from "@/features/auth/use-auth";
import {
  createPendingGeneration,
  readPendingGeneration,
  savePendingGeneration,
} from "@/features/generation/model/pending-generation";
import { isRevalidationActionable, type RevalidationResult } from "../api/revalidation-api";
import type { RevalidationPhaseName } from "./use-menu-revalidation";

export type RegenerationReasonInput = {
  changeReason: ChangeReason;
  changeReasonCustom: string | null;
  /** design §269: 再生成では元の期限確認を引き継がず、今回集めた確認だけを載せる */
  expiredPantryConfirmations?: readonly ExpiredPantryConfirmation[];
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
      // 単一スロット kondate:generation:v2 を上書きすると、進行中の作成 ID が失われ
      // generation_in_progress 端末で pending ごと消える（C2）。既存 pending は再開のみ。
      // 終端（failed 等）の pending は RecoveryLinks の onClear と結果/履歴詳細の
      // clearPendingGeneration で消す前提。残っていれば /generation で再開表示する。
      if (readPendingGeneration(userId, new Date()) !== null) {
        void navigate("/generation?resumed=1");
        return Promise.resolve();
      }
      const changeReasonCustom =
        reason.changeReason === "custom" ? reason.changeReasonCustom : null;
      const pending = createPendingGeneration(
        {
          commandVersion: "generation-command.v3",
          kind: "regenerate_menu",
          qualityMode: false,
          request: {
            idempotencyKey: crypto.randomUUID(),
            sourceMenuId: menuId,
            changeReason: reason.changeReason,
            changeReasonCustom,
            // 再生成も現行 privacy 説明への同意版を wire に載せる（server が DB と照合）
            privacyNoticeVersion,
            // design §269: 元献立の期限確認は引き継がない。シートで集めた今回分だけ。
            expiredPantryConfirmations: [...(reason.expiredPantryConfirmations ?? [])],
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
      if (readPendingGeneration(userId, new Date()) !== null) {
        void navigate("/generation?resumed=1");
        return Promise.resolve();
      }
      const changeReasonCustom =
        reason.changeReason === "custom" ? reason.changeReasonCustom : null;
      const pending = createPendingGeneration(
        {
          commandVersion: "generation-command.v3",
          kind: "regenerate_dish",
          qualityMode: false,
          request: {
            idempotencyKey: crypto.randomUUID(),
            sourceMenuId: menuId,
            dishId,
            changeReason: reason.changeReason,
            changeReasonCustom,
            // 再生成も現行 privacy 説明への同意版を wire に載せる（server が DB と照合）
            privacyNoticeVersion,
            expiredPantryConfirmations: [...(reason.expiredPantryConfirmations ?? [])],
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
