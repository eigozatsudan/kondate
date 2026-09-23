import { z } from "zod";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

const profileRowSchema = z.object({ taste_learning_enabled: z.boolean() }).strict();

/** 設定画面用の読み取り。household の select("*") とは別に持つ */
export async function getTasteLearningEnabled(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("profiles")
    .select("taste_learning_enabled")
    .eq("user_id", userId)
    .single();
  if (error !== null) throw new Error("taste_learning_read_failed");
  return profileRowSchema.parse(data).taste_learning_enabled;
}

/** 更新は RPC 経由のみ。profiles のテーブル単位 UPDATE は revoke されたまま */
export async function setTasteLearningEnabled(
  client: BrowserSupabaseClient,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await client.rpc("set_taste_learning_enabled", { p_enabled: enabled });
  if (error !== null) throw new Error("taste_learning_write_failed");
  return z.boolean().parse(data);
}

/** 好みの学習設定の React Query キー。share-consent-queries と同じ命名規則。 */
export const tasteLearningKeys = {
  current: (userId: string) => ["taste-learning", "current", userId] as const,
};
