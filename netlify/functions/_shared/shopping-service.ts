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
  // residual-intentional (SHOP1): pantry / draft は hash に含めない。
  // 失応答 resume は作成時 items スナップショットを replay し、在庫変化は再 apply しない。
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

function currentSafetyRequired(): never {
  throw new HttpError(
    409,
    "current_safety_revalidation_required",
    "現在の家族設定で献立を確認してから買い物リストを作ってください",
  );
}

async function revalidateMenuOrThrow(deps: ShoppingDependencies, menuId: string) {
  const revalidation = await deps.revalidate(menuId);
  if (revalidation.status === "invalid" || revalidation.issues.length > 0) {
    currentSafetyRequired();
  }
  return revalidation;
}

async function validatedDraft(deps: ShoppingDependencies, menuId: string) {
  // identity で idea を先に拒否し、full aggregate・家族 revalidation へ進まない
  await assertHouseholdMenuIdentity(deps, menuId);
  const revalidation = await revalidateMenuOrThrow(deps, menuId);
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

/**
 * SHOP2: active list の既存 source を現行 safety で確認する。
 * append が単一 menu fingerprint だけ見ると、他 source が invalid でも 200 になり得る。
 * dead source（menu_id null）は SQL list_unverifiable と同趣旨で拒否する。
 */
// residual-intentional (SHOP4/SHOP11): SQL 側 FP は世帯 fingerprint 自己一致のみ。
// メニュー allergen invalid の権威は本 service revalidate。service_role 直 RPC の DiD は migration 非変更で残す。
async function assertActiveListSourcesCurrentlySafe(
  deps: ShoppingDependencies,
  listId: string,
): Promise<void> {
  const sources = await deps.loadActiveListSources(listId);
  if (sources.some((source) => source.menuId === null)) {
    throw new HttpError(
      409,
      "list_unverifiable",
      "削除された献立が残っているため、新しい買い物リストを作り直してください",
    );
  }
  const seen = new Set<string>();
  for (const source of sources) {
    if (source.menuId === null || seen.has(source.menuId)) continue;
    seen.add(source.menuId);
    await assertHouseholdMenuIdentity(deps, source.menuId);
    await revalidateMenuOrThrow(deps, source.menuId);
  }
}

/**
 * SHOP1: 30 日 idempotent replay でも現行 safety を再解釈する。
 * 保存済み {listId,version} をそのまま 200 にすると、家族条件変更後も「成功」表示になる。
 *
 * ただし create 成功後に source 献立を削除したリストは製品仕様上残る。
 * その場合 validatedDraft(command.menuId) は常に失敗するため、
 * **list 上の live source だけ**再検証する（menu_id null の snapshot source は許容）。
 * list 自体が消えているときだけ 409。
 */
async function assertReplayStillCurrentlySafe(
  deps: ShoppingDependencies,
  input: { menuId: string; listId: string },
): Promise<void> {
  const list = await deps.loadActiveList(input.listId);
  if (list === null) {
    throw new HttpError(
      409,
      "current_safety_revalidation_required",
      "買い物リストの状態が変わったため、もう一度確認してください",
    );
  }
  const sources = await deps.loadActiveListSources(input.listId);
  const liveMenuIds = [
    ...new Set(
      sources
        .map((source) => source.menuId)
        .filter((menuId): menuId is string => menuId !== null && menuId.length > 0),
    ),
  ];
  // live source が残っていれば現行 safety を当てる。全て削除済みならリスト保持のまま replay 可。
  // residual-intentional (SHOP2): live 0 件は revalidate ループ無しで 200 replay（製品のリスト保持仕様）。
  for (const menuId of liveMenuIds) {
    await assertHouseholdMenuIdentity(deps, menuId);
    await revalidateMenuOrThrow(deps, menuId);
  }
  // command.menuId がまだ live なら明示的に再確認（create 直後の条件変更）
  if (liveMenuIds.includes(input.menuId)) {
    await validatedDraft(deps, input.menuId);
  }
}

/**
 * list_version_conflict 後に同一 key+hash の mutation が既にあれば replay する。
 * 並行 create/reconcile で敗者が SQL の version 競合だけ見て 409 になる非対称を閉じる（SHOP3）。
 * 真の stale version（mutation 無し）は 409 のまま。
 * 応答形は create/reconcile とも { listId, version, replayed }。
 */
async function replayAfterListVersionConflict(
  deps: ShoppingDependencies,
  input: {
    idempotencyKey: string;
    requestHash: string;
    menuId: string;
  },
  error: unknown,
): Promise<CreateShoppingListResponse | null> {
  if (!(error instanceof HttpError) || error.code !== "list_version_conflict") {
    return null;
  }
  const concurrentReplay = await deps.findMutationReplay({
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
  });
  if (concurrentReplay === null) return null;
  await assertReplayStillCurrentlySafe(deps, {
    menuId: input.menuId,
    listId: concurrentReplay.listId,
  });
  return concurrentReplay;
}

export async function createShoppingListFromMenu(
  deps: ShoppingDependencies,
  command: CreateShoppingListRequest & UserCommand,
): Promise<CreateShoppingListResponse> {
  const requestHash = createShoppingCommandHash(command);
  // 有効期限内 replay を最初に read-only で拾うが、SHOP1 により現行 safety は再確認する
  const replay = await deps.findMutationReplay({
    idempotencyKey: command.idempotencyKey,
    requestHash,
  });
  if (replay !== null) {
    await assertReplayStillCurrentlySafe(deps, {
      menuId: command.menuId,
      listId: replay.listId,
    });
    return replay;
  }
  // SHOP8: idea / owner は full aggregate より前（SQL の identity 優先と同順）
  const { menu, draft, safetyFingerprint } = await validatedDraft(deps, command.menuId);
  // SHOP2: append は active list 全 live source の現行 safety を先に確認
  if (command.mode === "append" && command.activeListId !== null) {
    await assertActiveListSourcesCurrentlySafe(deps, command.activeListId);
    // SHOP4: 同 lineage（同一 menu / derivation group）が既に list にあるときは
    // append の二重行を拒否し reconcile 入口へ誘導する（UI CTA と対称のサーバ DiD）。
    if (
      await hasSourceLineageOnList(
        deps,
        command.activeListId,
        command.menuId,
        menu.derivationGroupId,
      )
    ) {
      throw new HttpError(
        409,
        "reconcile_required",
        "この献立は買い物リストに取り込まれています。差分から反映してください",
      );
    }
  }
  try {
    const result = await deps.applyDraft({
      ...command,
      requestHash,
      safetyFingerprint,
      draft,
    });
    // SHOP1: SQL early-replay（replayed:true）成功後も現行 safety を再確認する。
    // 両者が service find を miss した並行同一 key で、勝者 commit 後に世帯が変わり
    // 敗者が SQL early だけ踏む TOCTOU を閉じる（先読み hit / conflict 枝と同契約）。
    if (result.replayed) {
      await assertReplayStillCurrentlySafe(deps, {
        menuId: command.menuId,
        listId: result.listId,
      });
    }
    return result;
  } catch (error: unknown) {
    // SHOP3: 並行同一 key+hash で敗者が list_version_conflict になった場合は
    // 勝者が書いた mutation を再読して 200 replayed にする（逐次再送と対称）
    const concurrent = await replayAfterListVersionConflict(
      deps,
      {
        idempotencyKey: command.idempotencyKey,
        requestHash,
        menuId: command.menuId,
      },
      error,
    );
    if (concurrent !== null) return concurrent;
    throw error;
  }
}

/** 再照合対象 item を同一献立 lineage（menu id / derivation group）に限定する */
async function scopeItemIdsForSourceMenu(
  deps: ShoppingDependencies,
  listId: string,
  sourceMenuId: string,
  sourceDerivationGroupId: string,
): Promise<ReadonlySet<string>> {
  const sources = await deps.loadActiveListSources(listId);
  const ids = new Set<string>();
  for (const source of sources) {
    const sameMenu = source.menuId === sourceMenuId || source.sourceMenuIdSnapshot === sourceMenuId;
    const sameGroup = source.sourceDerivationGroupId === sourceDerivationGroupId;
    if (!sameMenu && !sameGroup) continue;
    for (const item of source.itemSources) {
      ids.add(item.itemId);
    }
  }
  return ids;
}

/**
 * SHOP3: lineage 有無は items 件数に依存させない。
 * sources に無い献立の reconcile は純 add 入口にせず、create append へ誘導する。
 */
async function hasSourceLineageOnList(
  deps: ShoppingDependencies,
  listId: string,
  sourceMenuId: string,
  sourceDerivationGroupId: string,
): Promise<boolean> {
  // residual-intentional (SHOP5): lineage は source 行の menu/group 一致のみ（items 件数非依存）。
  // ingredient が辿れず scope 空でも 409 にせず、orphan plain 温存 + add 寄りの窓は意図的。
  const sources = await deps.loadActiveListSources(listId);
  return sources.some((source) => {
    const sameMenu = source.menuId === sourceMenuId || source.sourceMenuIdSnapshot === sourceMenuId;
    const sameGroup = source.sourceDerivationGroupId === sourceDerivationGroupId;
    return sameMenu || sameGroup;
  });
}

function rejectReconcileSourceNotInList(): never {
  throw new HttpError(
    409,
    "reconcile_source_not_in_list",
    "この献立は買い物リストに取り込まれていません",
  );
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
  // SHOP8: idea は list_version_conflict より先（dual-fault 契約）
  const { menu, draft } = await validatedDraft(deps, command.sourceMenuId);
  if (menu.version !== command.sourceMenuVersion)
    throw new HttpError(409, "source_menu_version_conflict", "献立が更新されました");
  const list = await deps.loadActiveList(command.listId);
  if (list === null)
    throw new HttpError(404, "shopping_list_not_found", "買い物リストが見つかりません");
  if (list.version !== command.expectedListVersion)
    throw new HttpError(409, "list_version_conflict", "買い物リストが更新されました");
  // SHOP1: append と同様、active list の他 live source も現行 safety で止める。
  // 対象 menu だけ valid でも他 source invalid のまま diff を返さない。
  await assertActiveListSourcesCurrentlySafe(deps, command.listId);
  if (
    !(await hasSourceLineageOnList(
      deps,
      command.listId,
      command.sourceMenuId,
      menu.derivationGroupId,
    ))
  ) {
    rejectReconcileSourceNotInList();
  }
  const scopeItemIds = await scopeItemIdsForSourceMenu(
    deps,
    command.listId,
    command.sourceMenuId,
    menu.derivationGroupId,
  );
  return computeShoppingDiff(list, draft, { scopeItemIds });
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

/**
 * reconcile の承認検証と resolvedDiff 組み立て。
 * SHOP2（add/replace 完全承認）と R1（remove 未承認時の版刻印延期）を一箇所に閉じる。
 */
function prepareReconcileApply(
  list: NonNullable<Awaited<ReturnType<ShoppingDependencies["loadActiveList"]>>>,
  draft: ReturnType<typeof buildShoppingDraft>,
  scopeItemIds: ReadonlySet<string>,
  approval: ReconcileShoppingListRequest["approval"],
): {
  resolvedDiff: ReturnType<typeof resolveApprovedDiff>;
  stampSourceVersion: boolean;
} {
  const diff = computeShoppingDiff(list, draft, { scopeItemIds });
  const hasPendingDiff = diff.add.length > 0 || diff.replace.length > 0 || diff.remove.length > 0;
  const hasApproval =
    approval.addKeys.length > 0 ||
    approval.replaceItemIds.length > 0 ||
    approval.removeItemIds.length > 0;
  // SHOP5: pending 無しの reconcile は source 刻印と version だけ進むため拒否する
  if (!hasPendingDiff) {
    throw new HttpError(422, "empty_approval", "反映する変更がありません");
  }
  // U5-002: サーバ diff があるのに承認がすべて空だと版だけ登録され再 reconcile 不能になる。
  if (!hasApproval) {
    throw new HttpError(422, "empty_approval", "反映する変更を1つ以上選んでください");
  }
  // SHOP2: 追加・数量変更の部分集合承認は menu version 刻印後に残り差分を
  // menu_version_already_in_list で閉塞する。外す候補だけ任意（D-C2）とし、
  // add/replace はサーバ diff と完全一致を要求して一回で閉じる。
  const approvedAddKeys = new Set(approval.addKeys);
  const approvedReplaceIds = new Set(approval.replaceItemIds);
  const addFullyApproved =
    approvedAddKeys.size === diff.add.length &&
    diff.add.every((item) => approvedAddKeys.has(item.key));
  const replaceFullyApproved =
    approvedReplaceIds.size === diff.replace.length &&
    diff.replace.every((item) => approvedReplaceIds.has(item.itemId));
  if (!addFullyApproved || !replaceFullyApproved) {
    throw new HttpError(
      422,
      "partial_approval_not_allowed",
      "追加と数量変更はすべて選んで反映してください。外す候補だけ選べます",
    );
  }
  // R1: remove をすべて選んだ／候補が無いときだけ stamp。未承認 remove 残存時は
  // 刻印延期 → 同 version 再 reconcile と CTA（maxRegistered < current）を維持。
  const approvedRemoveIds = new Set(approval.removeItemIds);
  const stampSourceVersion = diff.remove.every((item) => approvedRemoveIds.has(item.itemId));
  return {
    resolvedDiff: resolveApprovedDiff(diff, approval),
    stampSourceVersion,
  };
}

export async function reconcileShoppingList(
  deps: ShoppingDependencies,
  command: ReconcileShoppingListRequest & UserCommand & { listId: string },
): Promise<ReconcileShoppingListResponse> {
  const requestHash = createReconciliationRequestHash(command);
  // create と同様、replay hit でも SHOP1 の現行 safety 再確認を行う
  const replay = await deps.findMutationReplay({
    idempotencyKey: command.idempotencyKey,
    requestHash,
  });
  if (replay !== null) {
    await assertReplayStillCurrentlySafe(deps, {
      menuId: command.sourceMenuId,
      listId: replay.listId,
    });
    return replay;
  }
  // SQL apply_shopping_reconciliation と同じ identity 優先順:
  // menu owner / expected source version / mode を list version より先に判定する。
  // dual-fault（idea 出典 + stale list version）では list_version_conflict ではなく
  // idea_menu_not_supported を返す契約と一致させる（SHOP8）。
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
  // SHOP1: append と同様、全 live source の現行 safety を apply 前に確認する。
  // 単一 source fingerprint だけ見ると、他 source invalid でも reconcile 200 になり得る。
  await assertActiveListSourcesCurrentlySafe(deps, command.listId);
  // SHOP3: items 空でも lineage 無し reconcile は拒否（create append が multi-source 入口）
  if (
    !(await hasSourceLineageOnList(
      deps,
      command.listId,
      command.sourceMenuId,
      menu.derivationGroupId,
    ))
  ) {
    rejectReconcileSourceNotInList();
  }
  const scopeItemIds = await scopeItemIdsForSourceMenu(
    deps,
    command.listId,
    command.sourceMenuId,
    menu.derivationGroupId,
  );
  // try が成功するか throw するかのどちらかなので、成功後の参照は安全。
  let prepared!: {
    resolvedDiff: ReturnType<typeof resolveApprovedDiff>;
    stampSourceVersion: boolean;
  };
  try {
    prepared = prepareReconcileApply(list, draft, scopeItemIds, command.approval);
  } catch (error: unknown) {
    if (error instanceof HttpError) throw error;
    // クライアント承認キーとサーバ再計算 diff の不一致は 4xx として閉じる（500 にしない）。
    if (error instanceof Error && error.message === "approved_diff_mismatch") {
      throw new HttpError(409, "approved_diff_mismatch", "買い物リストの差分が一致しません");
    }
    throw error;
  }
  let result: ReconcileShoppingListResponse;
  try {
    result = await deps.applyReconciliation({
      ...command,
      requestHash,
      safetyFingerprint,
      resolvedDiff: prepared.resolvedDiff,
      stampSourceVersion: prepared.stampSourceVersion,
    });
  } catch (error: unknown) {
    // SHOP3: create と同じく、並行 apply 敗者が list_version_conflict でも
    // 同一 key+hash mutation があれば 200 replayed に畳む
    const concurrent = await replayAfterListVersionConflict(
      deps,
      {
        idempotencyKey: command.idempotencyKey,
        requestHash,
        menuId: command.sourceMenuId,
      },
      error,
    );
    if (concurrent !== null) return concurrent;
    throw error;
  }
  // SHOP1: create と同様、SQL early-replay 成功後も現行 safety を再確認する
  if (result.replayed) {
    await assertReplayStillCurrentlySafe(deps, {
      menuId: command.sourceMenuId,
      listId: result.listId,
    });
  }
  // R2: scoped current delete 後、対象 group の projection が空のまま残る窓を
  // 応答前の list revalidate で閉じる。失敗しても reconcile 自体は成功済みなので握りつぶし、
  // 買い物画面着地時の revalidate に委ねる。
  // residual-intentional (SHOP9): best-effort 失敗時の投影空窓は 200 を取り消さない。
  try {
    await revalidateActiveShoppingList(deps, {
      userId: command.userId,
      listId: command.listId,
    });
  } catch {
    // best-effort: 投影復元の失敗で reconcile 200 を取り消さない
  }
  return result;
}
