import { z } from "zod";

import { PENDING_GENERATION_TTL_MS, readPendingGeneration } from "./pending-generation";

/**
 * new_menu 提出時に targetMode を pending と同一寿命で保持する client メタ。
 * HTTP status に targetMode を足さず、GenerationStatusPanel の household 補助文判定に使う。
 * key は pending v3 と並ぶ専用キー（legacy sessionStorage generation-target-mode は使わない）。
 */
const metaKey = "kondate:generation:v3:meta";

export const pendingGenerationMetaSchema = z
  .object({
    kind: z.literal("new_menu"),
    targetMode: z.enum(["household", "idea"]),
    idempotencyKey: z.uuid(),
    ownerUserId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type PendingGenerationMeta = z.infer<typeof pendingGenerationMetaSchema>;

type MetaReadStorage = Pick<Storage, "getItem" | "removeItem">;
type MetaWriteStorage = Pick<Storage, "setItem">;
type MetaRemoveStorage = Pick<Storage, "removeItem">;

export function savePendingGenerationMeta(
  meta: PendingGenerationMeta,
  storage: MetaWriteStorage = localStorage,
): void {
  storage.setItem(metaKey, JSON.stringify(pendingGenerationMetaSchema.parse(meta)));
}

/**
 * pending と突合して有効な meta だけを返す。
 * pending 欠落・owner/TTL/idempotencyKey 不一致・破損は null（必要なら meta を掃除）。
 */
export function readPendingGenerationMeta(
  userId: string,
  now: Date,
  storage: MetaReadStorage = localStorage,
): PendingGenerationMeta | null {
  const pending = readPendingGeneration(userId, now, storage);
  if (pending === null) {
    // pending が無い・期限切れなら meta も捨てる（単独 meta の誤表示を防ぐ）
    clearPendingGenerationMeta(storage);
    return null;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(metaKey);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }

  try {
    const parsed = pendingGenerationMetaSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error("invalid_pending_meta");
    }
    const meta = parsed.data;
    const age = now.getTime() - new Date(meta.createdAt).getTime();
    if (
      meta.ownerUserId !== userId ||
      meta.idempotencyKey !== pending.request.idempotencyKey ||
      pending.kind !== "new_menu" ||
      !Number.isFinite(age) ||
      age < 0 ||
      age >= PENDING_GENERATION_TTL_MS
    ) {
      throw new Error("stale_or_mismatched_meta");
    }
    return meta;
  } catch {
    try {
      storage.removeItem(metaKey);
    } catch {
      // UI 継続のため削除失敗を吸収
    }
    return null;
  }
}

export function clearPendingGenerationMeta(storage: MetaRemoveStorage = localStorage): void {
  try {
    storage.removeItem(metaKey);
  } catch {
    // UI と認証の後始末を継続するため削除失敗を吸収する
  }
}
