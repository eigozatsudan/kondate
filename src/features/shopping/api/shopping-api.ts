import { z } from "zod";
import {
  createShoppingListResponseSchema,
  previewShoppingDiffResponseSchema,
  reconcileShoppingListResponseSchema,
  shoppingItemMutationRequestSchema,
  shoppingItemMutationResponseSchema,
  shoppingListSafetyDataSchema,
  shoppingListSchema,
  type CreateShoppingListRequest,
  type CreateShoppingListResponse,
  type ReconcileShoppingListRequest,
  type ReconcileShoppingListResponse,
  type ShoppingDiff,
  type ShoppingItemMutationRequest,
  type ShoppingItemMutationResponse,
  type ShoppingList,
  type ShoppingListSafetyData,
} from "@shared/contracts/shopping";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

function envelopeSchema<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data }), failureSchema]);
}

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const client = getBrowserSupabaseClient();
  const token = await requireAccessToken(client);
  const response = await fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = envelopeSchema(schema).safeParse(await response.json());
  if (!parsed.success) throw new Error("買い物リストの応答を確認できませんでした");
  if (!parsed.data.ok)
    throw Object.assign(new Error(parsed.data.error.message), {
      code: parsed.data.error.code,
    });
  return parsed.data.data;
}

const rowLabel = (row: {
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
}) => ({
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

export async function fetchActiveShoppingList(): Promise<ShoppingList | null> {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client
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
    .eq("status", "active")
    .maybeSingle();
  if (error !== null) throw new Error("買い物リストを読み込めませんでした");
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
        .map(rowLabel),
    })),
    listLabelWarnings: data.shopping_label_confirmations
      .filter((label) => label.item_id === null)
      .map(rowLabel),
  });
}

export const createShoppingList = (
  input: CreateShoppingListRequest,
): Promise<CreateShoppingListResponse> =>
  post("/api/shopping-lists/from-menu", input, createShoppingListResponseSchema);

export const reconcileShoppingListRequest = (
  listId: string,
  input: ReconcileShoppingListRequest,
): Promise<ReconcileShoppingListResponse> =>
  post(`/api/shopping-lists/${listId}/reconcile`, input, reconcileShoppingListResponseSchema);

export const previewShoppingDiff = (
  menuId: string,
  menuVersion: number,
  list: ShoppingList,
): Promise<ShoppingDiff> =>
  post(
    `/api/shopping-lists/${list.id}/preview`,
    {
      sourceMenuId: menuId,
      sourceMenuVersion: menuVersion,
      expectedListVersion: list.version,
    },
    previewShoppingDiffResponseSchema,
  );

export const revalidateActiveShoppingList = (listId: string): Promise<ShoppingListSafetyData> =>
  post(`/api/shopping-lists/${listId}/revalidate`, {}, shoppingListSafetyDataSchema);

export async function mutateShoppingItem(
  input: ShoppingItemMutationRequest,
): Promise<ShoppingItemMutationResponse> {
  const parsed = shoppingItemMutationRequestSchema.parse(input);
  const args = {
    p_list_id: parsed.listId,
    p_expected_list_version: parsed.expectedListVersion,
    p_expected_safety_fingerprint: parsed.expectedSafetyFingerprint,
    p_operation: parsed.operation,
    // 生成型は p_item_id を非 null な uuid として出力するが、SQL 側の
    // p_item_id uuid は nullable で、add_manual は必ず null を送る。
    // Zod で検証済みの値を実シグネチャへ合わせるための限定的な型合わせ。
    p_item_id: parsed.itemId as string,
    p_idempotency_key: parsed.idempotencyKey,
    p_payload: parsed.payload,
  };
  const { data, error } = await getBrowserSupabaseClient().rpc("mutate_shopping_item", args);
  if (error !== null) {
    if (error.message.includes("list_version_conflict")) {
      throw Object.assign(new Error("買い物リストが更新されました"), {
        code: "list_version_conflict",
      });
    }
    if (error.message.includes("idempotency_payload_mismatch")) {
      throw Object.assign(new Error("前回と異なる内容で再送できません"), {
        code: "idempotency_payload_mismatch",
      });
    }
    if (error.message.includes("shopping_safety_fingerprint_changed")) {
      throw Object.assign(new Error("家族設定が変わりました"), {
        code: "shopping_safety_fingerprint_changed",
      });
    }
    throw new Error("買い物項目を更新できませんでした");
  }
  return shoppingItemMutationResponseSchema.parse(data);
}

/**
 * 送信済みだがレスポンスを取り逃した create / reconcile を、同じ idempotency key で
 * 自動再送するための保存領域。24時間を超えた記録・時計が巻き戻った記録・壊れた記録は
 * 送信前に必ず捨てる。
 */
export const pendingShoppingCommandStorageKey = (kind: "create" | "reconcile", targetId: string) =>
  `kondate:shopping:${kind}:${targetId}`;
export const pendingShoppingCommandTtlMs = 24 * 60 * 60 * 1_000;
export const pendingShoppingCommandEnvelopeSchema = <T>(schema: z.ZodType<T>) =>
  z
    .object({
      createdAtMs: z.number().int().nonnegative(),
      command: schema,
    })
    .strict();

export function persistedShoppingCommand<T>(
  kind: "create" | "reconcile",
  targetId: string,
  schema: z.ZodType<T>,
  build: (idempotencyKey: string) => T,
): T {
  const key = pendingShoppingCommandStorageKey(kind, targetId);
  const saved = sessionStorage.getItem(key);
  if (saved !== null) {
    try {
      const parsed = pendingShoppingCommandEnvelopeSchema(schema).safeParse(JSON.parse(saved));
      if (parsed.success) {
        const age = Date.now() - parsed.data.createdAtMs;
        if (age >= 0 && age <= pendingShoppingCommandTtlMs) return parsed.data.command;
      }
    } catch {
      /* 下の removeItem で捨てる */
    }
    sessionStorage.removeItem(key);
  }
  const command = schema.parse(build(crypto.randomUUID()));
  sessionStorage.setItem(key, JSON.stringify({ createdAtMs: Date.now(), command }));
  return command;
}

export const clearShoppingCommand = (kind: "create" | "reconcile", targetId: string) => {
  sessionStorage.removeItem(pendingShoppingCommandStorageKey(kind, targetId));
};

export type ReconcilableMenuSource = { sourceMenuId: string; sourceMenuVersion: number };

/**
 * 「使用中リストが同じ派生グループの古い版を取り込んでいる」判定。
 * 保存済みの警告 provenance ではなく、リストの取り込み元（shopping_list_sources）と
 * 献立の現在の版だけで決める。
 */
export async function fetchReconcilableMenuSource(
  menuId: string,
  listId: string,
): Promise<ReconcilableMenuSource | null> {
  const client = getBrowserSupabaseClient();
  const menu = await client
    .from("menus")
    .select("id,derivation_group_id,version")
    .eq("id", menuId)
    // Task 5 のHTTP/DB拒否（idea献立からの買い物リスト利用は不可）に対する
    // 防御層。サーバー側の拒否が万一漏れても、このクライアント側クエリでも
    // idea献立を読み込めなくする（fail closed）。
    .eq("target_mode", "household")
    .maybeSingle();
  if (menu.error !== null) throw new Error("献立を確認できませんでした");
  const menuRow = menu.data;
  if (menuRow === null) return null;
  const sources = await client
    .from("shopping_list_sources")
    .select("source_derivation_group_id,source_menu_version")
    .eq("list_id", listId);
  if (sources.error !== null) throw new Error("買い物リストの取り込み元を確認できませんでした");
  const stale = sources.data.some(
    (source) =>
      source.source_derivation_group_id === menuRow.derivation_group_id &&
      source.source_menu_version < menuRow.version,
  );
  return stale ? { sourceMenuId: menuRow.id, sourceMenuVersion: menuRow.version } : null;
}
