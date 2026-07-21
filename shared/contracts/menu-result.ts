import type { ValidatedMenu } from "./generation.js";
import type { PantryItem } from "./pantry.js";

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

export type MenuResultViewModel = {
  menu: ValidatedMenu;
  memberLabels: Readonly<Record<string, string>>;
  labelConfirmations: readonly {
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
  }[];
  pantryPostCookTargets: readonly PantryPostCookTarget[];
};
