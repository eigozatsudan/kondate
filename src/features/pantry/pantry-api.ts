import { type PantryItem, type PantryItemInput, pantryItemSchema } from "@shared/contracts/pantry";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables } from "@/shared/types/database.generated";

export const pantryKeys = {
  all: ["pantry"] as const,
  list: (userId: string) => ["pantry", userId] as const,
};

function mapRow(row: Tables<"pantry_items">): PantryItem {
  return pantryItemSchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    expiresOn: row.expires_on,
    expirationType: row.expiration_type,
    openedState: row.opened_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function writeRow(userId: string, input: PantryItemInput) {
  return {
    user_id: userId,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    expires_on: input.expiresOn,
    expiration_type: input.expirationType,
    opened_state: input.openedState,
  };
}

export class PantryVersionConflictError extends Error {
  readonly code = "pantry_version_conflict" as const;

  constructor() {
    super("冷蔵庫の内容が変わりました。最新の内容を確認してください");
    this.name = "PantryVersionConflictError";
  }
}

export async function listPantryItems(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PantryItem[]> {
  const { data, error } = await client
    .from("pantry_items")
    .select("*")
    .eq("user_id", userId)
    .order("expires_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error !== null) throw new Error("冷蔵庫の食材を読み込めませんでした");
  return data.map(mapRow);
}

export async function createPantryItem(
  client: BrowserSupabaseClient,
  userId: string,
  input: PantryItemInput,
): Promise<PantryItem> {
  const { data, error } = await client
    .from("pantry_items")
    .insert(writeRow(userId, input))
    .select("*")
    .single();
  if (error !== null) throw new Error("食材を追加できませんでした");
  return mapRow(data);
}

export async function updatePantryItem(
  client: BrowserSupabaseClient,
  userId: string,
  itemId: string,
  expectedUpdatedAt: string,
  input: PantryItemInput,
): Promise<PantryItem> {
  const { data, error } = await client
    .from("pantry_items")
    .update(writeRow(userId, input))
    .eq("id", itemId)
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error !== null) throw new Error("食材を更新できませんでした");
  if (data === null) throw new PantryVersionConflictError();
  return mapRow(data);
}

export async function deletePantryItem(
  client: BrowserSupabaseClient,
  userId: string,
  itemId: string,
  expectedUpdatedAt: string,
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("pantry_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (error !== null) throw new Error("食材を削除できませんでした");
  if (data === null) throw new PantryVersionConflictError();
  return data;
}
