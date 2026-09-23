import { z } from "zod";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

// taste_learning_seq は bigint だが、PostgREST は JSON の数値で返す。
// 1 操作で 1 しか進まないため安全な整数の範囲を出ることは現実的に無く、
// 範囲外や小数・負数は壊れた応答として信用しない。
const tasteLearningSeqSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const profileRowSchema = z
  .object({
    taste_learning_enabled: z.boolean(),
    taste_learning_seq: tasteLearningSeqSchema,
  })
  .strict();

const setResultSchema = z
  .object({
    enabled: z.boolean(),
    seq: tasteLearningSeqSchema,
    applied: z.boolean(),
  })
  .strict();

/** サーバーの現在値と、比較更新（CAS）に使う連番。 */
export type TasteLearningState = {
  enabled: boolean;
  seq: number;
};

/**
 * set_taste_learning_enabled の結果。applied が false のときは連番が合わず書かれておらず、
 * enabled / seq はサーバーの現在値を表す。
 */
export type TasteLearningSetResult = TasteLearningState & {
  applied: boolean;
};

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

/**
 * 設定画面用の読み取り。household の select("*") とは別に持つ。
 * 連番も一緒に読み、次の書き込みの期待値にする。
 */
export async function getTasteLearningState(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<TasteLearningState> {
  const { data, error } = await client
    .from("profiles")
    .select("taste_learning_enabled, taste_learning_seq")
    .eq("user_id", userId)
    .single();
  if (error !== null) throw new Error("taste_learning_read_failed");
  const row = profileRowSchema.parse(data);
  return { enabled: row.taste_learning_enabled, seq: row.taste_learning_seq };
}

/**
 * 更新は RPC 経由のみ。profiles のテーブル単位 UPDATE は revoke されたまま。
 * expectedSeq は最後に読んだ連番。サーバーは一致したときだけ書き（applied: true）、
 * 一致しなければ書かずに現在値を返す（applied: false）。
 */
export async function setTasteLearningEnabled(
  client: BrowserSupabaseClient,
  enabled: boolean,
  expectedSeq: number,
  options?: TasteLearningRpcOptions,
): Promise<TasteLearningSetResult> {
  const { data, error } = await awaitTasteLearningRpc(
    client.rpc("set_taste_learning_enabled", {
      p_enabled: enabled,
      p_expected_seq: expectedSeq,
    }),
    options?.signal,
  );
  if (error !== null) throw new Error("taste_learning_write_failed");
  return setResultSchema.parse(data);
}

/** 好みの学習設定の React Query キー。share-consent-queries と同じ命名規則。 */
export const tasteLearningKeys = {
  current: (userId: string) => ["taste-learning", "current", userId] as const,
  /** 確定できなかった書き込みの記録（サーバーへは問い合わせない、画面側だけの状態）。 */
  unconfirmed: (userId: string) => ["taste-learning", "unconfirmed", userId] as const,
  /**
   * トグルの書き込みと未確定の再試行（柵）の mutationKey。互いの disabled を
   * useIsMutating で cache から導き、画面を離れて戻っても走っている方を見失わないようにする。
   */
  toggleWrite: (userId: string) => ["taste-learning", "toggle-write", userId] as const,
  unconfirmedRetry: (userId: string) => ["taste-learning", "unconfirmed-retry", userId] as const,
};
