import type { GeneratedMenu, MenuValidationIssue } from "../../../shared/contracts/generation.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
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

/** loadCurrentSafety が 1 回だけ読む現行 safety snapshot（HR5: FP と validate を同一 tick に閉じる） */
export type LoadedCurrentSafety = {
  fingerprint: string;
  allergenCatalogVersion: string;
  foodRuleVersion: string;
  /** loadCurrentSafetyContext の生結果。validate はこれを再利用し二重読取しない */
  safety: CurrentSafetyContext;
};

export type RevalidationDeps = {
  loadMenu(userId: string, menuId: string): Promise<StoredMenuAggregate>;
  loadCurrentSafety(userId: string, stored: StoredMenuAggregate): Promise<LoadedCurrentSafety>;
  validateStoredCurrentSafety(input: {
    stored: StoredMenuAggregate;
    userId: string;
    /** HR5: loadCurrentSafety と同一 snapshot。省略時は実装側で load（直接呼び出し互換） */
    safety?: CurrentSafetyContext;
  }): Promise<{
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
 *
 * HR5: loadCurrentSafety を 1 回だけ呼び、返却 FP と validate の issues/ok を
 * 同一 safety snapshot に閉じる（T1/T2 二重読取 TOCTOU を塞ぐ）。
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
    safety: current.safety,
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
