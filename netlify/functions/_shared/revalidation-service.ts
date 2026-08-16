import type {
  GeneratedMenu,
  MenuValidationIssue,
  MenuValidationIssueCode,
} from "../../../shared/contracts/generation.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";

export type RevalidationStatus = "valid" | "changed" | "invalid";

/** DB に書く再検証 issue。閉じた code + path のみ。表示名・アレルゲン名・食品名は持たない。 */
export type PersistedRevalidationIssue = {
  code: MenuValidationIssueCode;
  path: string;
};

/**
 * HR8: 読取（200 / UI）用の閉じた日本語。表示名・アレルゲン名・食品名は埋め込まない。
 * 既存の利用者向けコピー族を残し、人名付きテンプレートは組み立てない。
 */
const closedRevalidationIssueMessages = {
  direct_allergen_match: "登録アレルギーが献立に残っています",
  allergy_unconfirmed: "アレルギー確認が必要です",
  allergen_missing: "登録アレルゲンを選んでください",
  unmapped_custom_allergy: "自由登録アレルギーを固定候補へ対応付けできません",
  unsupported_diet_unconfirmed: "対象外条件の確認が必要です",
  unsupported_diet_present: "対象外条件のあるメンバーは対象にできません",
  required_safety_action: "必要な安全工程がありません",
  safety_action_contradiction: "安全対応と料理手順が矛盾しています",
} as const satisfies Partial<Record<MenuValidationIssueCode, string>>;

const genericRevalidationIssueMessage = "現在の家族設定ではこの献立を利用できません";

export function toPersistedRevalidationIssues(
  issues: readonly Pick<MenuValidationIssue, "code" | "path">[],
): readonly PersistedRevalidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
  }));
}

function displayRevalidationIssueMessage(issue: MenuValidationIssue): string {
  const closed =
    issue.code in closedRevalidationIssueMessages
      ? closedRevalidationIssueMessages[issue.code as keyof typeof closedRevalidationIssueMessages]
      : undefined;
  if (closed !== undefined) return closed;
  // age_shape_rule 等はカタログ固定文。人名敬称が混ざったときだけ閉じる。
  if (/[一-龯ぁ-んァ-ン]{1,4}(?:ちゃん|くん|さん|様)/u.test(issue.message)) {
    return genericRevalidationIssueMessage;
  }
  return issue.message;
}

/** 読取時に利用者向け日本語を組み立てる。永続ペイロードには使わない。 */
export function toDisplayRevalidationIssues(
  issues: readonly MenuValidationIssue[],
): readonly MenuValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: displayRevalidationIssueMessage(issue),
  }));
}

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
  save(
    input: Omit<RevalidationResult, "issues"> & {
      userId: string;
      menuId: string;
      issues: readonly PersistedRevalidationIssue[];
    },
  ): Promise<void>;
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
    // HR8: 200 は読取時組み立て。DB へは code+path だけ渡す。
    issues: validation.ok ? [] : toDisplayRevalidationIssues(validation.issues),
    changedDetails: validation.changedDetails,
    currentLabelWarnings,
  };
  await deps.save({
    ...persisted,
    ...input,
    issues: toPersistedRevalidationIssues(persisted.issues),
  });
  return persisted;
}
