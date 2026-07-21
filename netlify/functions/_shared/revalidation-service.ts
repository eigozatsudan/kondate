import type { GeneratedMenu, MenuValidationIssue } from "../../../shared/contracts/generation.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";

export type RevalidationStatus = "valid" | "changed" | "invalid";

export type CurrentMenuLabelWarning = {
  confirmationId: string;
  sourceType: GeneratedMenu["labelConfirmations"][number]["sourceType"];
  sourceId: string;
  sourcePath: string;
  sourceText: string;
  allergenId: string;
  allergenName: string;
  anonymousMemberRef: string;
  memberLabel: string;
  dictionaryVersion: string;
  confirmationStatus: "pending" | "confirmed";
};

export type RevalidationResult = {
  status: RevalidationStatus;
  safetyFingerprint: string;
  allergenCatalogVersion: string;
  foodRuleVersion: string;
  issues: readonly MenuValidationIssue[];
  changedDetails: readonly (
    "pantry_item_removed" | "pantry_quantity_changed" | "preference_changed"
  )[];
  currentLabelWarnings: readonly CurrentMenuLabelWarning[];
};

export type RevalidationDeps = {
  loadMenu(userId: string, menuId: string): Promise<StoredMenuAggregate>;
  loadCurrentSafety(
    userId: string,
    stored: StoredMenuAggregate,
  ): Promise<{
    fingerprint: string;
    allergenCatalogVersion: string;
    foodRuleVersion: string;
  }>;
  validateStoredCurrentSafety(input: { stored: StoredMenuAggregate; userId: string }): Promise<{
    ok: boolean;
    candidate: GeneratedMenu;
    issues: readonly MenuValidationIssue[];
    changedDetails: RevalidationResult["changedDetails"];
  }>;
  reconcileCurrentLabelWarnings(input: {
    stored: StoredMenuAggregate;
    candidate: GeneratedMenu;
    safetyFingerprint: string;
  }): Promise<readonly CurrentMenuLabelWarning[]>;
  save(input: RevalidationResult & { userId: string; menuId: string }): Promise<void>;
};

/**
 * 履歴献立を「保存時スナップショット」ではなく現行の家族安全条件で再検証する。
 * 所有権は loadMenu が owner-scoped で先に証明し、現行 fingerprint / issues /
 * label warning を menu_revalidations に 1 行 upsert する。
 */
export async function revalidateStoredMenu(
  deps: RevalidationDeps,
  input: { userId: string; menuId: string },
): Promise<RevalidationResult> {
  const menu = await deps.loadMenu(input.userId, input.menuId);
  const current = await deps.loadCurrentSafety(input.userId, menu);
  const validation = await deps.validateStoredCurrentSafety({
    stored: menu,
    userId: input.userId,
  });
  const currentLabelWarnings = validation.ok
    ? await deps.reconcileCurrentLabelWarnings({
        stored: menu,
        candidate: validation.candidate,
        safetyFingerprint: current.fingerprint,
      })
    : [];
  const persisted: RevalidationResult = {
    status: validation.ok
      ? menu.safetyFingerprint === current.fingerprint && validation.changedDetails.length === 0
        ? "valid"
        : "changed"
      : "invalid",
    safetyFingerprint: current.fingerprint,
    allergenCatalogVersion: current.allergenCatalogVersion,
    foodRuleVersion: current.foodRuleVersion,
    issues: validation.ok ? [] : validation.issues,
    changedDetails: validation.changedDetails,
    currentLabelWarnings,
  };
  await deps.save({ ...persisted, ...input });
  return persisted;
}
