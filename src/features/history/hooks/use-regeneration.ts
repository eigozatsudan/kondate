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
import { reconcileTerminalPendingGeneration } from "@/features/generation/model/reconcile-terminal-pending";
import { isRevalidationActionable, type RevalidationResult } from "../api/revalidation-api";
import type { RevalidationPhaseName } from "./use-menu-revalidation";

export type RegenerationReasonInput = {
  changeReason: ChangeReason;
  changeReasonCustom: string | null;
  /** design §269: 再生成では元の期限確認を引き継がず、今回集めた確認だけを載せる */
  expiredPantryConfirmations?: readonly ExpiredPantryConfirmation[];
};

/** startWhole / startDish の結果。既存 pending 再開と新規開始を呼び出し側で区別できる。 */
export type RegenerationStartResult = { kind: "started" } | { kind: "resumed_existing" };

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
      /** HR1: soft 再検査飛行中は canRegenerate を閉じる（phase は checked のまま） */
      isSoftRechecking?: boolean;
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
        isRevalidationActionable(input.result) &&
        // soft 飛行中は旧 actionable のまま POST しない（HR1）
        !(input.isSoftRechecking ?? false);

  const startWhole = useCallback(
    async (reason: RegenerationReasonInput): Promise<RegenerationStartResult> => {
      if (!canRegenerate || userId === undefined) {
        return Promise.reject(new Error("revalidation_required"));
      }
      // 単一スロットを上書きすると進行中の作成 ID が失われる（C2）。進行中は再開のみ。
      // G-R1: terminal 済み sticky は status GET で clear し新規再生成を許す。
      // processing / status 失敗は keep→再開（G1/G2。無条件 clear しない）。
      // HR5: 別献立からの再生成でも silent 上書きはしない。
      if (readPendingGeneration(userId, new Date()) !== null) {
        const outcome = await reconcileTerminalPendingGeneration(userId);
        if (outcome === "kept") {
          void navigate("/generation?resumed=1");
          return { kind: "resumed_existing" };
        }
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
      return { kind: "started" };
    },
    [canRegenerate, menuId, navigate, userId],
  );

  const startDish = useCallback(
    async (dishId: string, reason: RegenerationReasonInput): Promise<RegenerationStartResult> => {
      if (!canRegenerate || userId === undefined) {
        return Promise.reject(new Error("revalidation_required"));
      }
      // HR5 / C2 / G-R1: 進行中は再開。terminal は clear して新規を許す。
      if (readPendingGeneration(userId, new Date()) !== null) {
        const outcome = await reconcileTerminalPendingGeneration(userId);
        if (outcome === "kept") {
          void navigate("/generation?resumed=1");
          return { kind: "resumed_existing" };
        }
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
      return Promise.resolve({ kind: "started" });
    },
    [canRegenerate, menuId, navigate, userId],
  );

  return { canRegenerate, startWhole, startDish };
}
