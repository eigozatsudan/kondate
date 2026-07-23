import type { ValidatedMenu } from "./generation.js";
import type { PantryItem } from "./pantry.js";
import type { PlannerSubmission, TargetMode } from "./planner.js";

/** 調理後の冷蔵庫操作対象。世代スナップショットではなく live row を保持する。 */
export type PantryPostCookTarget = {
  selectionId: string;
  pantryItemId: string | null;
  pantryItemName: string;
  plannedQuantity: number | null;
  unit: string | null;
  currentPantryRow: Pick<
    PantryItem,
    | "id"
    | "name"
    | "quantity"
    | "unit"
    | "expiresOn"
    | "expirationType"
    | "openedState"
    | "updatedAt"
  > | null;
};

/**
 * idea/household の権威ある判定元。DBの menus.target_mode をそのまま持ち、
 * UI 側で家族安全表示を出すかどうかはこの値だけで決める（brief step 11）。
 */
export type MenuResultLabelConfirmation = {
  confirmationId: string;
  sourceType: ValidatedMenu["labelConfirmations"][number]["sourceType"];
  sourceId: string;
  sourcePath: string;
  sourceText: string;
  allergenName: string;
  memberLabel: string;
  dictionaryVersion: string;
  confirmationStatus: "pending" | "confirmed";
  requirementSafetyFingerprint: string;
  isCurrent: true;
  confirmedAt: string | null;
  confirmedBy: string | null;
};

export type MenuResultViewModel = {
  targetMode: TargetMode;
  /**
   * preference_snapshot.submission を plannerSubmissionSchema.safeParse した結果。
   * 成功時だけ値を持ち、解析できない・欠落している場合は null（家族条件の
   * 再現に失敗した場合でも安全側へ倒し、存在しない条件を捏造しない）。
   */
  sourceSubmission: PlannerSubmission | null;
  menu: ValidatedMenu;
  memberLabels: Readonly<Record<string, string>>;
  labelConfirmations: readonly MenuResultLabelConfirmation[];
  pantryPostCookTargets: readonly PantryPostCookTarget[];
};
