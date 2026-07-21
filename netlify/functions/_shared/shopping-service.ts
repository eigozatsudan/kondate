import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import type {
  CreateShoppingListRequest,
  CreateShoppingListResponse,
  ReconcileShoppingListRequest,
  ReconcileShoppingListResponse,
  ShoppingDiff,
} from "../../../shared/contracts/shopping.js";
import { buildShoppingDraft } from "../../../shared/shopping/aggregate.js";
import { computeShoppingDiff, resolveApprovedDiff } from "../../../shared/shopping/diff.js";
import type { ShoppingDependencies } from "./shopping-adapter.js";

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

async function validatedDraft(deps: ShoppingDependencies, menuId: string) {
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
  const list = await deps.loadActiveList(command.listId);
  if (list === null)
    throw new HttpError(404, "shopping_list_not_found", "買い物リストが見つかりません");
  if (list.version !== command.expectedListVersion)
    throw new HttpError(409, "list_version_conflict", "買い物リストが更新されました");
  const { menu, draft } = await validatedDraft(deps, command.sourceMenuId);
  if (menu.version !== command.sourceMenuVersion)
    throw new HttpError(409, "source_menu_version_conflict", "献立が更新されました");
  return computeShoppingDiff(list, draft);
}

export async function reconcileShoppingList(
  deps: ShoppingDependencies,
  command: ReconcileShoppingListRequest & UserCommand & { listId: string },
): Promise<ReconcileShoppingListResponse> {
  const requestHash = createReconciliationRequestHash(command);
  const replay = await deps.findMutationReplay({
    idempotencyKey: command.idempotencyKey,
    requestHash,
  });
  if (replay !== null) return replay;
  const list = await deps.loadActiveList(command.listId);
  if (list === null)
    throw new HttpError(404, "shopping_list_not_found", "買い物リストが見つかりません");
  if (list.version !== command.expectedListVersion) {
    throw new HttpError(409, "list_version_conflict", "買い物リストが更新されました");
  }
  const { menu, draft, safetyFingerprint } = await validatedDraft(deps, command.sourceMenuId);
  if (menu.version !== command.sourceMenuVersion) {
    throw new HttpError(409, "source_menu_version_conflict", "献立が更新されました");
  }
  const resolved = resolveApprovedDiff(computeShoppingDiff(list, draft), command.approval);
  return deps.applyReconciliation({
    ...command,
    requestHash,
    safetyFingerprint,
    resolvedDiff: resolved,
  });
}
