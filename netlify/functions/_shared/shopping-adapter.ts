import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "../../../src/shared/types/database.js";
import type {
  CreateShoppingListResponse,
  CurrentShoppingLabelWarning,
  ReconcileShoppingListResponse,
  RefreshShoppingListSafetyRpcResponse,
  ShoppingDraft,
  ShoppingLabelSnapshot,
  ShoppingList,
  ShoppingSourceIngredient,
} from "../../../shared/contracts/shopping.js";
import type { ResolvedShoppingDiff } from "../../../shared/shopping/diff.js";
import { reviewedShoppingAliases } from "../../../shared/shopping/reviewed-aliases.js";
import {
  createShoppingListResponseSchema,
  reconcileShoppingListResponseSchema,
  refreshShoppingListSafetyRpcResponseSchema,
  shoppingLabelSnapshotSchema,
  shoppingListSchema,
  shoppingSourceIngredientSchema,
} from "../../../shared/contracts/shopping.js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase, type UserSupabaseClient } from "./supabase-user.js";
import { createRevalidationDeps } from "./revalidation-adapter.js";
import {
  revalidateStoredMenu,
  type CurrentMenuLabelWarning,
  type RevalidationResult,
} from "./revalidation-service.js";
import { loadStoredMenu } from "./stored-menu-loader.js";

// 設計書 Task3 の listing は相対 import に拡張子を付けていないが、本リポジトリは
// ESM (package.json の "type": "module") かつ全既存 netlify/functions ファイルが
// 相対 import に必ず ".js" を付けている（例: revalidation-adapter.ts,
// stored-menu-loader.ts）。実行時に解決できないため、この補正だけを機械的に適用する。

export type ShoppingMenuAggregate = {
  menuId: string;
  version: number;
  derivationGroupId: string;
  ingredients: ShoppingSourceIngredient[];
  labels: ShoppingLabelSnapshot[];
};
export type ShoppingPantryAmount = { name: string; quantity: number | null; unit: string | null };

// 設計書 Task4: 買い物リスト単位の再検証で使う、所有者スコープの source 行。
// menuId は献立が削除されると null になる（shopping_list_sources.menu_id は
// on delete set null）。その場合は「現在の安全性を確認できない」扱いにするため、
// snapshot 側（source_menu_id_snapshot ほか）とは別のフィールドとして保持する。
export type ActiveShoppingSource = {
  menuId: string | null;
  sourceMenuIdSnapshot: string;
  sourceMenuVersion: number;
  sourceDerivationGroupId: string;
  itemSources: readonly { itemId: string; sourceIngredientIdSnapshot: string }[];
};

export type ShoppingDependencies = {
  loadMenu(
    menuId: string,
    currentLabelWarnings: readonly CurrentMenuLabelWarning[],
  ): Promise<ShoppingMenuAggregate>;
  revalidate(menuId: string): Promise<RevalidationResult>;
  loadPantry(): Promise<ShoppingPantryAmount[]>;
  loadActiveList(listId?: string): Promise<ShoppingList | null>;
  getSafetyFingerprint(menuId: string): Promise<string>;
  applyDraft(input: {
    userId: string;
    menuId: string;
    mode: "new" | "append";
    activeListId: string | null;
    expectedListVersion: number | null;
    safetyFingerprint: string;
    idempotencyKey: string;
    requestHash: string;
    draft: ShoppingDraft;
  }): Promise<CreateShoppingListResponse>;
  applyReconciliation(input: {
    userId: string;
    listId: string;
    expectedListVersion: number;
    sourceMenuId: string;
    sourceMenuVersion: number;
    safetyFingerprint: string;
    idempotencyKey: string;
    requestHash: string;
    resolvedDiff: ResolvedShoppingDiff;
  }): Promise<ReconcileShoppingListResponse>;
  findMutationReplay(input: {
    idempotencyKey: string;
    requestHash: string;
  }): Promise<CreateShoppingListResponse | null>;
  loadActiveListSources(listId: string): Promise<ActiveShoppingSource[]>;
  getListSafetyFingerprint(listId: string): Promise<string | null>;
  replaceCurrentSafetyProjection(input: {
    userId: string;
    listId: string;
    expectedFingerprint: string;
    warnings: readonly CurrentShoppingLabelWarning[];
  }): Promise<RefreshShoppingListSafetyRpcResponse>;
  aliases: ReadonlyMap<string, string>;
};

type AuthenticatedUser = { userId: string; accessToken: string };

export function createShoppingWarningKey(input: {
  sourceMenuId: string;
  sourceType: string;
  sourceId: string;
  sourcePath: string;
  allergenId: string;
  anonymousMemberRef: string;
  dictionaryVersion: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: "shopping-warning.v1",
        sourceMenuId: input.sourceMenuId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourcePath: input.sourcePath,
        allergenId: input.allergenId,
        anonymousMemberRef: input.anonymousMemberRef,
        dictionaryVersion: input.dictionaryVersion,
      }),
      "utf8",
    )
    .digest("hex");
}

function dbFailure(message: string): HttpError {
  return new HttpError(503, "shopping_unavailable", message);
}

function mapRpcError(error: { message: string }): never {
  const known: Record<string, [number, string, string]> = {
    safety_fingerprint_changed: [
      409,
      "safety_fingerprint_changed",
      "家族設定が変わったため、もう一度確認してください",
    ],
    list_version_conflict: [
      409,
      "list_version_conflict",
      "買い物リストが更新されました。再読み込みしてください",
    ],
    source_menu_version_conflict: [
      409,
      "source_menu_version_conflict",
      "献立が更新されたため、差分を作り直してください",
    ],
    protected_item_conflict: [
      409,
      "protected_item_conflict",
      "購入済みまたは手動変更した項目があるため、差分を作り直してください",
    ],
    idempotency_payload_mismatch: [
      409,
      "idempotency_payload_mismatch",
      "前回と異なる内容で再送できません",
    ],
    menu_version_already_in_list: [
      409,
      "menu_version_already_in_list",
      "この献立はすでに今の買い物リストへ追加されています",
    ],
    menu_not_found: [404, "menu_not_found", "献立が見つかりません"],
  };
  const match = Object.entries(known).find(([code]) => error.message.includes(code));
  if (match !== undefined) {
    const [status, code, message] = match[1];
    throw new HttpError(status, code, message);
  }
  throw dbFailure("買い物リストを更新できませんでした");
}

async function loadShoppingMenu(
  client: UserSupabaseClient,
  userId: string,
  menuId: string,
  currentLabelWarnings: readonly CurrentMenuLabelWarning[],
): Promise<ShoppingMenuAggregate> {
  const stored = await loadStoredMenu(client, userId, menuId);
  const ingredients: ShoppingSourceIngredient[] = stored.menu.dishes.flatMap((dish) =>
    dish.ingredients.map((item) =>
      shoppingSourceIngredientSchema.parse({
        ingredientId: item.id,
        dishId: dish.id,
        dishName: dish.name,
        name: item.name,
        quantityValue: item.quantityValue,
        quantityText: item.quantityText,
        unit: item.unit,
        storeSection: item.storeSection,
      }),
    ),
  );
  const labels: ShoppingLabelSnapshot[] = currentLabelWarnings.map((item) =>
    shoppingLabelSnapshotSchema.parse({
      confirmationId: item.confirmationId,
      warningKey: createShoppingWarningKey({
        sourceMenuId: stored.menu.menuId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourcePath: item.sourcePath,
        allergenId: item.allergenId,
        anonymousMemberRef: item.anonymousMemberRef,
        dictionaryVersion: item.dictionaryVersion,
      }),
      sourceMenuId: stored.menu.menuId,
      sourceDerivationGroupId: stored.derivationGroupId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourcePath: item.sourcePath,
      allergenId: item.allergenId,
      sourceDisplayName: item.sourceText,
      allergenDisplayName: item.allergenName,
      anonymousMemberRef: item.anonymousMemberRef,
      memberDisplayName: item.memberLabel,
      dictionaryVersion: item.dictionaryVersion,
      confirmationStatus: "pending",
    }),
  );
  return {
    menuId: stored.menu.menuId,
    version: stored.version,
    derivationGroupId: stored.derivationGroupId,
    ingredients,
    labels,
  };
}

async function loadActiveShoppingList(
  client: UserSupabaseClient,
  userId: string,
  listId?: string,
): Promise<ShoppingList | null> {
  let query = client
    .from("shopping_lists")
    .select(
      `
    id,status,version,
    shopping_items(id,list_id,display_name,normalized_name,store_section,quantity_value,
      quantity_text,unit,pantry_check_required,is_checked,is_manual,is_manually_edited,
      is_removed_by_user,shopping_label_confirmations(*)),
    shopping_label_confirmations(*)
  `,
    )
    .eq("user_id", userId)
    .eq("status", "active");
  if (listId !== undefined) query = query.eq("id", listId);
  const { data, error } = await query.maybeSingle();
  if (error !== null) throw dbFailure("買い物リストを読み込めませんでした");
  if (data === null) return null;
  return shoppingListSchema.parse({
    id: data.id,
    status: data.status,
    version: data.version,
    items: data.shopping_items.map((item) => ({
      id: item.id,
      listId: item.list_id,
      displayName: item.display_name,
      normalizedName: item.normalized_name,
      storeSection: item.store_section,
      quantityValue: item.quantity_value,
      quantityText: item.quantity_text,
      unit: item.unit,
      pantryCheckRequired: item.pantry_check_required,
      isChecked: item.is_checked,
      isManual: item.is_manual,
      isManuallyEdited: item.is_manually_edited,
      isRemovedByUser: item.is_removed_by_user,
      labelWarnings: item.shopping_label_confirmations
        .filter((label) => label.item_id !== null)
        .map(toLabel),
    })),
    listLabelWarnings: data.shopping_label_confirmations
      .filter((label) => label.item_id === null)
      .map(toLabel),
  });
}
function toLabel(row: {
  menu_label_confirmation_id: string | null;
  source_warning_key: string;
  source_menu_id_snapshot: string;
  source_derivation_group_id: string;
  source_type: string;
  source_id_snapshot: string;
  source_path: string;
  source_display_name: string;
  allergen_id: string;
  allergen_display_name: string;
  anonymous_member_ref: string;
  member_display_name: string;
  dictionary_version: string;
  confirmation_status: string;
}): ShoppingLabelSnapshot {
  return shoppingLabelSnapshotSchema.parse({
    confirmationId: row.menu_label_confirmation_id,
    warningKey: row.source_warning_key,
    sourceMenuId: row.source_menu_id_snapshot,
    sourceDerivationGroupId: row.source_derivation_group_id,
    sourceType: row.source_type,
    sourceId: row.source_id_snapshot,
    sourcePath: row.source_path,
    sourceDisplayName: row.source_display_name,
    allergenId: row.allergen_id,
    allergenDisplayName: row.allergen_display_name,
    anonymousMemberRef: row.anonymous_member_ref,
    memberDisplayName: row.member_display_name,
    dictionaryVersion: row.dictionary_version,
    confirmationStatus: row.confirmation_status,
  });
}

// 設計書 Task4: adapter は返す前に全フィールドを UUID / 正のバージョンとして検証する。
// DB 由来の生の行をそのまま service へ渡さないための境界。
const activeShoppingSourceSchema = z
  .object({
    menuId: z.uuid().nullable(),
    sourceMenuIdSnapshot: z.uuid(),
    sourceMenuVersion: z.number().int().positive(),
    sourceDerivationGroupId: z.uuid(),
    itemSources: z.array(
      z.object({ itemId: z.uuid(), sourceIngredientIdSnapshot: z.uuid() }).strict(),
    ),
  })
  .strict();

async function loadActiveShoppingListSources(
  client: UserSupabaseClient,
  userId: string,
  listId: string,
): Promise<ActiveShoppingSource[]> {
  const sources = await client
    .from("shopping_list_sources")
    .select("menu_id,source_menu_id_snapshot,source_menu_version,source_derivation_group_id")
    .eq("user_id", userId)
    .eq("list_id", listId);
  if (sources.error !== null) throw dbFailure("買い物リストの献立情報を読み込めませんでした");

  const items = await client
    .from("shopping_items")
    .select("id")
    .eq("user_id", userId)
    .eq("list_id", listId);
  if (items.error !== null) throw dbFailure("買い物リストの項目を読み込めませんでした");
  const itemIds = items.data.map((item) => item.id);

  const itemSourceRows =
    itemIds.length === 0
      ? []
      : await (async () => {
          const { data, error } = await client
            .from("shopping_item_sources")
            .select("item_id,source_ingredient_id_snapshot")
            .eq("user_id", userId)
            .in("item_id", itemIds);
          if (error !== null) throw dbFailure("買い物リストの由来情報を読み込めませんでした");
          return data;
        })();

  // どの item がどの献立由来かは、生きている dish_ingredients の menu_id でしか確定できない。
  // 献立が削除されて辿れなくなった行は意図的に捨て、source 側の menuId=null 判定で
  // unverifiable に倒す（名前一致での代替解決は安全側に倒れないため行わない）。
  const snapshotIds = [...new Set(itemSourceRows.map((row) => row.source_ingredient_id_snapshot))];
  const ingredientRows =
    snapshotIds.length === 0
      ? []
      : await (async () => {
          const { data, error } = await client
            .from("dish_ingredients")
            .select("id,menu_id")
            .eq("user_id", userId)
            .in("id", snapshotIds);
          if (error !== null) throw dbFailure("買い物リストの由来情報を読み込めませんでした");
          return data;
        })();
  const menuIdByIngredientId = new Map(ingredientRows.map((row) => [row.id, row.menu_id]));

  const itemSourcesByMenuId = new Map<
    string,
    { itemId: string; sourceIngredientIdSnapshot: string }[]
  >();
  for (const row of itemSourceRows) {
    const menuId = menuIdByIngredientId.get(row.source_ingredient_id_snapshot);
    if (menuId === undefined) continue;
    const bucket = itemSourcesByMenuId.get(menuId) ?? [];
    bucket.push({
      itemId: row.item_id,
      sourceIngredientIdSnapshot: row.source_ingredient_id_snapshot,
    });
    itemSourcesByMenuId.set(menuId, bucket);
  }

  return sources.data.map((row) =>
    activeShoppingSourceSchema.parse({
      menuId: row.menu_id,
      sourceMenuIdSnapshot: row.source_menu_id_snapshot,
      sourceMenuVersion: row.source_menu_version,
      sourceDerivationGroupId: row.source_derivation_group_id,
      itemSources: row.menu_id === null ? [] : (itemSourcesByMenuId.get(row.menu_id) ?? []),
    }),
  );
}

function parseRpcResponse<T>(data: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw dbFailure("買い物リストの応答を確認できませんでした");
  return parsed.data;
}

export function createShoppingDependencies(user: AuthenticatedUser): ShoppingDependencies {
  const userClient = createUserScopedSupabase(user.accessToken);
  const admin = getSupabaseAdmin();
  return {
    loadMenu: (menuId, currentLabelWarnings) =>
      loadShoppingMenu(userClient, user.userId, menuId, currentLabelWarnings),
    revalidate: (menuId) =>
      revalidateStoredMenu(createRevalidationDeps(user), {
        userId: user.userId,
        menuId,
      }),
    async loadPantry() {
      const { data, error } = await userClient
        .from("pantry_items")
        .select("name,quantity,unit")
        .eq("user_id", user.userId);
      if (error !== null) throw dbFailure("冷蔵庫の内容を読み込めませんでした");
      return data;
    },
    loadActiveList: (listId) => loadActiveShoppingList(userClient, user.userId, listId),
    async getSafetyFingerprint(menuId) {
      const { data, error } = await admin.rpc("shopping_safety_fingerprint", {
        p_user_id: user.userId,
        p_menu_id: menuId,
      });
      if (error !== null) mapRpcError(error);
      return data;
    },
    async applyDraft(input) {
      // 補正: 生成済み Database 型は SQL 側の NULL 許容パラメータ（DEFAULT 未指定の
      // uuid/integer 引数）でも非 null 型を生成する既知の制限がある。マイグレーション
      // (apply_shopping_draft) は p_active_list_id / p_expected_list_version を
      // "is distinct from" で NULL-safe に比較しており、NULL 呼び出しは正当な入力。
      // 実引用の意味は変えず、型だけを SQL 契約に合わせて明示キャストする。
      const args: Database["public"]["Functions"]["apply_shopping_draft"]["Args"] = {
        p_user_id: input.userId,
        p_menu_id: input.menuId,
        p_mode: input.mode,
        p_active_list_id: input.activeListId as unknown as string,
        p_expected_list_version: input.expectedListVersion as unknown as number,
        p_safety_fingerprint: input.safetyFingerprint,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
        p_draft: input.draft,
      };
      const { data, error } = await admin.rpc("apply_shopping_draft", args);
      if (error !== null) mapRpcError(error);
      return parseRpcResponse(data, createShoppingListResponseSchema);
    },
    async applyReconciliation(input) {
      const { data, error } = await admin.rpc("apply_shopping_reconciliation", {
        p_user_id: input.userId,
        p_list_id: input.listId,
        p_expected_list_version: input.expectedListVersion,
        p_source_menu_id: input.sourceMenuId,
        p_source_menu_version: input.sourceMenuVersion,
        p_safety_fingerprint: input.safetyFingerprint,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
        p_resolved_diff: input.resolvedDiff,
      });
      if (error !== null) mapRpcError(error);
      return parseRpcResponse(data, reconcileShoppingListResponseSchema);
    },
    async findMutationReplay(input) {
      const { data, error } = await admin.rpc("get_shopping_mutation_replay", {
        p_user_id: user.userId,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
      });
      if (error !== null) mapRpcError(error);
      return data === null ? null : parseRpcResponse(data, createShoppingListResponseSchema);
    },
    loadActiveListSources: (listId) =>
      loadActiveShoppingListSources(userClient, user.userId, listId),
    async getListSafetyFingerprint(listId) {
      const { data, error } = await admin.rpc("shopping_list_safety_fingerprint", {
        p_user_id: user.userId,
        p_list_id: listId,
      });
      if (error !== null) mapRpcError(error);
      // 生成済み Database 型は plpgsql の "returns text" を非 null と推論するが、
      // SQL 側は「自分の active なリストではない」「menu_id が null の source を含む」
      // 場合に null を返す契約。ShoppingDependencies 側の戻り値型を string|null に
      // しているのはそのためで、ここでは実引用をそのまま通す。
      return data;
    },
    async replaceCurrentSafetyProjection(input) {
      const { data, error } = await admin.rpc("refresh_shopping_list_safety", {
        p_user_id: input.userId,
        p_list_id: input.listId,
        p_expected_fingerprint: input.expectedFingerprint,
        p_warnings: input.warnings.map((warning) => ({ ...warning })),
      });
      if (error !== null) mapRpcError(error);
      // data は service 専用 RPC の内部オブジェクト。公開 HTTP union
      // (shoppingListSafetyDataSchema) としては絶対に解釈せず、内部スキーマだけで
      // 厳密検証する。キー欠落・余剰キー・301件・不正な warning はここで閉じる。
      return parseRpcResponse(data as unknown, refreshShoppingListSafetyRpcResponseSchema);
    },
    aliases: reviewedShoppingAliases,
  };
}
