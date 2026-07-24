import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import type {
  CreateShoppingListRequest,
  CreateShoppingListResponse,
  CurrentShoppingLabelWarning,
  ReconcileShoppingListRequest,
  ReconcileShoppingListResponse,
  ShoppingDiff,
  ShoppingListSafetyData,
} from "../../../shared/contracts/shopping.js";
import {
  currentShoppingLabelWarningSchema,
  shoppingListSafetyDataSchema,
} from "../../../shared/contracts/shopping.js";
import { buildShoppingDraft } from "../../../shared/shopping/aggregate.js";
import { computeShoppingDiff, resolveApprovedDiff } from "../../../shared/shopping/diff.js";
import type { CurrentMenuLabelWarning } from "./revalidation-service.js";
import { createShoppingWarningKey, type ShoppingDependencies } from "./shopping-adapter.js";

// 設計書 Task3 の listing は相対 import に拡張子を付けていないが、本リポジトリの
// ESM 実行環境では全既存ファイルが ".js" を付けている（shopping-adapter.ts と同じ理由）。
// この補正だけを機械的に適用する。

type UserCommand = { userId: string };

export function createReconciliationRequestHash(
  command: ReconcileShoppingListRequest & UserCommand & { listId: string },
): string {
  const canonical = {
    listId: command.listId,
    expectedListVersion: command.expectedListVersion,
    sourceMenuId: command.sourceMenuId,
    sourceMenuVersion: command.sourceMenuVersion,
    approval: {
      addKeys: command.approval.addKeys.toSorted(),
      replaceItemIds: command.approval.replaceItemIds.toSorted(),
      removeItemIds: command.approval.removeItemIds.toSorted(),
    },
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function createShoppingCommandHash(
  command: CreateShoppingListRequest & UserCommand,
): string {
  const canonical = {
    menuId: command.menuId,
    mode: command.mode,
    activeListId: command.activeListId,
    expectedListVersion: command.expectedListVersion,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

/** idea を full aggregate / 家族再検証より前に拒否する固定契約 */
function rejectIdeaMenu(): never {
  throw new HttpError(422, "idea_menu_not_supported", "アイデア献立は買い物リストに利用できません");
}

async function assertHouseholdMenuIdentity(deps: ShoppingDependencies, menuId: string) {
  const identity = await deps.loadMenuIdentity(menuId);
  if (identity.targetMode !== "household") rejectIdeaMenu();
  return identity;
}

async function validatedDraft(deps: ShoppingDependencies, menuId: string) {
  // identity で idea を先に拒否し、full aggregate・家族 revalidation へ進まない
  await assertHouseholdMenuIdentity(deps, menuId);
  const revalidation = await deps.revalidate(menuId);
  if (revalidation.status === "invalid" || revalidation.issues.length > 0) {
    throw new HttpError(
      409,
      "current_safety_revalidation_required",
      "現在の家族設定で献立を確認してから買い物リストを作ってください",
    );
  }
  const fingerprintBefore = await deps.getSafetyFingerprint(menuId);
  const [menu, pantry] = await Promise.all([
    deps.loadMenu(menuId, revalidation.currentLabelWarnings),
    deps.loadPantry(),
  ]);
  const draft = buildShoppingDraft({
    menuId: menu.menuId,
    menuVersion: menu.version,
    ingredients: menu.ingredients,
    pantry,
    aliases: deps.aliases,
    labels: menu.labels,
  });
  const fingerprintAfter = await deps.getSafetyFingerprint(menuId);
  if (fingerprintBefore !== fingerprintAfter) {
    throw new HttpError(
      409,
      "safety_fingerprint_changed",
      "家族設定が変わったため、もう一度確認してください",
    );
  }
  return { menu, draft, safetyFingerprint: fingerprintAfter };
}

export async function createShoppingListFromMenu(
  deps: ShoppingDependencies,
  command: CreateShoppingListRequest & UserCommand,
): Promise<CreateShoppingListResponse> {
  const requestHash = createShoppingCommandHash(command);
  // 有効期限内 replay を最初に read-only で返し、出典削除・mode 変化後も live を再解釈しない
  const replay = await deps.findMutationReplay({
    idempotencyKey: command.idempotencyKey,
    requestHash,
  });
  if (replay !== null) return replay;
  const { draft, safetyFingerprint } = await validatedDraft(deps, command.menuId);
  return deps.applyDraft({ ...command, requestHash, safetyFingerprint, draft });
}

export async function previewShoppingListDiff(
  deps: ShoppingDependencies,
  command: {
    userId: string;
    listId: string;
    sourceMenuId: string;
    sourceMenuVersion: number;
    expectedListVersion: number;
  },
): Promise<ShoppingDiff> {
  // SQL apply_shopping_reconciliation と同じ identity 優先順:
  // owner / source_menu_version / mode を list version より先に判定する。
  // preview は mutation replay なし。list 不在は引き続き 404。
  const { menu, draft } = await validatedDraft(deps, command.sourceMenuId);
  if (menu.version !== command.sourceMenuVersion)
    throw new HttpError(409, "source_menu_version_conflict", "献立が更新されました");
  const list = await deps.loadActiveList(command.listId);
  if (list === null)
    throw new HttpError(404, "shopping_list_not_found", "買い物リストが見つかりません");
  if (list.version !== command.expectedListVersion)
    throw new HttpError(409, "list_version_conflict", "買い物リストが更新されました");
  return computeShoppingDiff(list, draft);
}

// --- 設計書 Task4: 買い物リスト単位の現在安全性の再検証 -------------------------------

type SafetyIssue = {
  code: "source_menu_unavailable" | "current_safety_invalid" | "safety_check_failed";
  message: string;
  sourceMenuId: string | null;
};

// 失敗系も必ず公開スキーマで parse してから返す。安全側に倒した結果でも
// 「fingerprint なし・現在警告なし・issue が1件以上」という契約は崩さない。
function closedSafetyResult(
  status: "invalid" | "unverifiable",
  checkedSourceMenuIds: readonly string[],
  issues: readonly SafetyIssue[],
): ShoppingListSafetyData {
  return shoppingListSafetyDataSchema.parse({
    status,
    safetyFingerprint: null,
    checkedSourceMenuIds: [...new Set(checkedSourceMenuIds)].sort(),
    currentLabelWarnings: [],
    issues,
  });
}

function safetyCheckFailed(checkedSourceMenuIds: readonly string[]): ShoppingListSafetyData {
  return closedSafetyResult("unverifiable", checkedSourceMenuIds, [
    {
      code: "safety_check_failed",
      message: "現在の家族設定を確認できませんでした",
      sourceMenuId: null,
    },
  ]);
}

// 現在の献立警告を、公開契約の CurrentShoppingLabelWarning へ明示的に組み替える。
// confirmationId / confirmationStatus は「現在の投影」には存在しない（不変の
// provenance 側にしか無い）ため、ここでは決して持ち込まない。
function composeCurrentWarning(input: {
  menuId: string;
  derivationGroupId: string;
  itemId: string | null;
  warning: CurrentMenuLabelWarning;
}): CurrentShoppingLabelWarning {
  const { menuId, derivationGroupId, itemId, warning } = input;
  const candidate = {
    itemId,
    warningKey: createShoppingWarningKey({
      sourceMenuId: menuId,
      sourceType: warning.sourceType,
      sourceId: warning.sourceId,
      sourcePath: warning.sourcePath,
      allergenId: warning.allergenId,
      anonymousMemberRef: warning.anonymousMemberRef,
      dictionaryVersion: warning.dictionaryVersion,
    }),
    sourceMenuId: menuId,
    sourceDerivationGroupId: derivationGroupId,
    sourceType: warning.sourceType,
    sourceId: warning.sourceId,
    sourcePath: warning.sourcePath,
    sourceDisplayName: warning.sourceText,
    allergenId: warning.allergenId,
    allergenDisplayName: warning.allergenName,
    anonymousMemberRef: warning.anonymousMemberRef,
    memberDisplayName: warning.memberLabel,
    dictionaryVersion: warning.dictionaryVersion,
  };
  const parsed = currentShoppingLabelWarningSchema.safeParse(candidate);
  if (!parsed.success) {
    // 501文字の source text など、境界を超えた人間向け文字列は安全側で閉じる。
    throw new HttpError(503, "safety_check_failed", "現在の家族設定を確認できませんでした");
  }
  return parsed.data;
}

export async function revalidateActiveShoppingList(
  deps: ShoppingDependencies,
  command: { userId: string; listId: string },
): Promise<ShoppingListSafetyData> {
  const list = await deps.loadActiveList(command.listId);
  if (list === null) {
    throw new HttpError(404, "shopping_list_not_found", "買い物リストが見つかりません");
  }
  const sources = await deps.loadActiveListSources(command.listId);

  // 献立が1つでも辿れないなら、この時点では何も検証していない。
  // checkedSourceMenuIds は「実際に検証した source」だけを載せる契約なので空になる。
  if (sources.some((source) => source.menuId === null)) {
    return closedSafetyResult(
      "unverifiable",
      [],
      [
        {
          code: "source_menu_unavailable",
          message: "献立が見つからないため、現在の安全性を確認できません",
          sourceMenuId: null,
        },
      ],
    );
  }
  const liveSources = sources.filter(
    (source): source is (typeof sources)[number] & { menuId: string } => source.menuId !== null,
  );

  // live source の identity を先に読み、idea 混入は家族 query / projection 書込み前に拒否
  for (const source of liveSources) {
    const identity = await deps.loadMenuIdentity(source.menuId);
    if (identity.targetMode !== "household") rejectIdeaMenu();
  }

  // itemId 解決は「同じ献立の source 行が持つ、完全一致の ingredient スナップショット」
  // だけを根拠にする。名前一致でのフォールバックは絶対に行わない。
  const itemIdByMenuAndIngredient = new Map<string, string>();
  const derivationGroupIdByMenuId = new Map<string, string>();
  for (const source of liveSources) {
    if (!derivationGroupIdByMenuId.has(source.menuId)) {
      derivationGroupIdByMenuId.set(source.menuId, source.sourceDerivationGroupId);
    }
    for (const itemSource of source.itemSources) {
      const key = `${source.menuId}|${itemSource.sourceIngredientIdSnapshot}`;
      const previous = itemIdByMenuAndIngredient.get(key);
      // 同じ (献立, ingredient スナップショット) が別々の item を指すのは曖昧な状態で、
      // どちらに警告を付けるかを行順に委ねてはならない。warningKey 側の重複と同じく
      // 安全側で閉じる（同じ献立が複数バージョンで登録されている場合、同一 itemId が
      // 複数行から重複して供給されるのは正常なので、値が食い違うときだけ閉じる）。
      if (previous !== undefined && previous !== itemSource.itemId) {
        throw new HttpError(503, "safety_check_failed", "現在の家族設定を確認できませんでした");
      }
      itemIdByMenuAndIngredient.set(key, itemSource.itemId);
    }
  }

  // 検証を始める前のリスト安全性 fingerprint。source ごとの再検証は1件ずつ
  // 現在の家族設定を読むため、ループの途中で設定が変わっても各再検証は成功しうる。
  // 前後で読み比べないと、古い設定で計算した警告に、新しい設定の fingerprint
  // トークンを添えて status:"valid" を返してしまう（Task3 の validatedDraft と同じ
  // before/after ガードを、リスト単位の同じ関数で行う）。
  const fingerprintBefore = await deps.getListSafetyFingerprint(command.listId);
  if (fingerprintBefore === null) return safetyCheckFailed([]);

  const checkedSourceMenuIds = [...new Set(liveSources.map((source) => source.menuId))].sort();
  const checked: string[] = [];
  const composed: CurrentShoppingLabelWarning[] = [];
  for (const menuId of [...new Set(liveSources.map((source) => source.menuId))]) {
    const revalidation = await deps.revalidate(menuId);
    checked.push(menuId);
    // "changed" は issues が空なら現在安全性としては通す（Plan4 と同じ判定）。
    if (revalidation.status === "invalid" || revalidation.issues.length > 0) {
      return closedSafetyResult(
        "invalid",
        checked,
        revalidation.issues.length === 0
          ? [
              {
                code: "current_safety_invalid",
                message: "現在の家族設定では、この献立を確認できません",
                sourceMenuId: menuId,
              },
            ]
          : revalidation.issues.map((issue) => ({
              code: "current_safety_invalid" as const,
              message: issue.message.slice(0, 200),
              sourceMenuId: menuId,
            })),
      );
    }
    const derivationGroupId = derivationGroupIdByMenuId.get(menuId) ?? "";
    for (const warning of revalidation.currentLabelWarnings) {
      composed.push(
        composeCurrentWarning({
          menuId,
          derivationGroupId,
          itemId:
            warning.sourceType === "ingredient"
              ? (itemIdByMenuAndIngredient.get(`${menuId}|${warning.sourceId}`) ?? null)
              : null,
          warning,
        }),
      );
    }
  }

  // (warningKey,itemId) で重複排除し、同じ順序規則で整列する。
  // 同じ warningKey が異なる itemId を持つのは DB の一意制約と矛盾するので閉じる。
  const deduplicated = new Map<string, CurrentShoppingLabelWarning>();
  const itemIdByWarningKey = new Map<string, string | null>();
  for (const warning of composed) {
    const previous = itemIdByWarningKey.get(warning.warningKey);
    if (previous !== undefined && previous !== warning.itemId) {
      throw new HttpError(503, "safety_check_failed", "現在の家族設定を確認できませんでした");
    }
    itemIdByWarningKey.set(warning.warningKey, warning.itemId);
    deduplicated.set(`${warning.warningKey}|${warning.itemId ?? ""}`, warning);
  }
  const currentLabelWarnings = [...deduplicated.values()].sort(
    (left, right) =>
      left.warningKey.localeCompare(right.warningKey) ||
      (left.itemId ?? "").localeCompare(right.itemId ?? ""),
  );

  // 検証後の再読み取り。消えた（null）場合も、値が変わった場合も、トークンは返さない。
  // ここから RPC commit までの窓は private.lock_and_check_shopping_list_safety が
  // p_expected と live 再計算値を突き合わせて閉じる。
  const fingerprint = await deps.getListSafetyFingerprint(command.listId);
  if (fingerprint === null || fingerprint !== fingerprintBefore) {
    return safetyCheckFailed(checkedSourceMenuIds);
  }

  let persisted;
  try {
    persisted = await deps.replaceCurrentSafetyProjection({
      userId: command.userId,
      listId: command.listId,
      expectedFingerprint: fingerprint,
      warnings: currentLabelWarnings,
    });
  } catch (error) {
    // source 削除・fingerprint レースは RPC 側でロールバックされている。
    // 現在投影を持たない safety_check_failed を、公開スキーマで別途 parse して返す。
    if (error instanceof HttpError && error.code === "safety_fingerprint_changed") {
      return safetyCheckFailed(checkedSourceMenuIds);
    }
    throw error;
  }
  if (persisted.listId !== command.listId || persisted.safetyFingerprint !== fingerprint) {
    throw new HttpError(503, "safety_check_failed", "現在の家族設定を確認できませんでした");
  }
  return shoppingListSafetyDataSchema.parse({
    status: "valid",
    safetyFingerprint: persisted.safetyFingerprint,
    checkedSourceMenuIds,
    currentLabelWarnings: persisted.currentLabelWarnings,
    issues: [],
  });
}

export async function reconcileShoppingList(
  deps: ShoppingDependencies,
  command: ReconcileShoppingListRequest & UserCommand & { listId: string },
): Promise<ReconcileShoppingListResponse> {
  const requestHash = createReconciliationRequestHash(command);
  // create と同様、replay hit は live mode を再解釈しない
  const replay = await deps.findMutationReplay({
    idempotencyKey: command.idempotencyKey,
    requestHash,
  });
  if (replay !== null) return replay;
  // SQL apply_shopping_reconciliation と同じ identity 優先順:
  // menu owner / expected source version / mode を list version より先に判定する。
  // dual-fault（idea 出典 + stale list version）では list_version_conflict ではなく
  // idea_menu_not_supported を返す契約と一致させる。
  const { menu, draft, safetyFingerprint } = await validatedDraft(deps, command.sourceMenuId);
  if (menu.version !== command.sourceMenuVersion) {
    throw new HttpError(409, "source_menu_version_conflict", "献立が更新されました");
  }
  const list = await deps.loadActiveList(command.listId);
  if (list === null)
    throw new HttpError(404, "shopping_list_not_found", "買い物リストが見つかりません");
  if (list.version !== command.expectedListVersion) {
    throw new HttpError(409, "list_version_conflict", "買い物リストが更新されました");
  }
  const resolved = resolveApprovedDiff(computeShoppingDiff(list, draft), command.approval);
  return deps.applyReconciliation({
    ...command,
    requestHash,
    safetyFingerprint,
    resolvedDiff: resolved,
  });
}
