import { z } from "zod";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

const profileRowSchema = z.object({ taste_learning_enabled: z.boolean() }).strict();

/** timeout 時に in-flight RPC を abort するための任意 signal。 */
export type TasteLearningRpcOptions = {
  signal?: AbortSignal;
};

/**
 * supabase-js の rpc builder は thenable + abortSignal。
 * signal が無い既存呼び出しは引数形を変えない（share-consent-api と同じ形）。
 */
async function awaitTasteLearningRpc<T>(
  query: PromiseLike<T> & { abortSignal: (signal: AbortSignal) => PromiseLike<T> },
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return await query;
  }
  return await query.abortSignal(signal);
}

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
  options?: TasteLearningRpcOptions,
): Promise<boolean> {
  const { data, error } = await awaitTasteLearningRpc(
    client.rpc("set_taste_learning_enabled", { p_enabled: enabled }),
    options?.signal,
  );
  if (error !== null) throw new Error("taste_learning_write_failed");
  return z.boolean().parse(data);
}

/** 好みの学習設定の React Query キー。share-consent-queries と同じ命名規則。 */
export const tasteLearningKeys = {
  current: (userId: string) => ["taste-learning", "current", userId] as const,
};
