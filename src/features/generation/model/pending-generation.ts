import { z } from "zod";

import {
  generationCommandVersionV3,
  generationCommandV3Schema,
  newMenuGenerationRequestSchema,
  regenerateDishRequestSchema,
  regenerateMenuRequestSchema,
  type GenerationCommand,
} from "@shared/contracts/generation";

// storage key は v3 cutover に合わせる（旧 v2 pending は読まず best-effort 削除）
const key = "kondate:generation:v3";
/** 旧 cutover 前キー。v3 reader が触れたタイミングで破棄する */
const legacyV2Key = "kondate:generation:v2";

export const PENDING_GENERATION_TTL_MS = 1_800_000 as const;

const pendingGenerationMetadataSchema = {
  ownerUserId: z.uuid(),
  requestId: z.uuid().optional(),
  createdAt: z.iso.datetime({ offset: true }),
};

// 端末 pending は commandVersion v3 + qualityMode だけを受理する
export const pendingGenerationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...pendingGenerationMetadataSchema,
      commandVersion: z.literal(generationCommandVersionV3),
      kind: z.literal("new_menu"),
      qualityMode: z.boolean(),
      request: newMenuGenerationRequestSchema,
    })
    .strict(),
  z
    .object({
      ...pendingGenerationMetadataSchema,
      commandVersion: z.literal(generationCommandVersionV3),
      kind: z.literal("regenerate_menu"),
      qualityMode: z.boolean(),
      request: regenerateMenuRequestSchema,
    })
    .strict(),
  z
    .object({
      ...pendingGenerationMetadataSchema,
      commandVersion: z.literal(generationCommandVersionV3),
      kind: z.literal("regenerate_dish"),
      qualityMode: z.boolean(),
      request: regenerateDishRequestSchema,
    })
    .strict(),
]);

export type PendingGeneration = z.infer<typeof pendingGenerationSchema>;

type PendingGenerationReadStorage = Pick<Storage, "getItem" | "removeItem">;
type PendingGenerationWriteStorage = Pick<Storage, "setItem">;
type PendingGenerationRemoveStorage = Pick<Storage, "removeItem">;

export function createPendingGeneration(
  command: GenerationCommand,
  ownerUserId: string,
  now: () => Date = () => new Date(),
): PendingGeneration {
  return pendingGenerationSchema.parse({
    ...generationCommandV3Schema.parse(command),
    ownerUserId,
    createdAt: now().toISOString(),
  });
}

export function pendingGenerationCommand(value: PendingGeneration): GenerationCommand {
  return generationCommandV3Schema.parse({
    commandVersion: value.commandVersion,
    kind: value.kind,
    qualityMode: value.qualityMode,
    request: value.request,
  });
}

/** 旧 v2 pending を best-effort で削除（v3 専用 cutover。読取パースはしない） */
export function clearLegacyPendingGenerationV2(
  storage: Pick<Storage, "getItem" | "removeItem"> = localStorage,
): void {
  try {
    // 存在確認してから削除（テストの removeItem 回数と実機 I/O を抑える）
    if (storage.getItem(legacyV2Key) === null) return;
    storage.removeItem(legacyV2Key);
  } catch {
    // UI 継続のため削除失敗を吸収
  }
}

export function readPendingGeneration(
  currentUserId: string,
  now: Date,
  storage: PendingGenerationReadStorage = localStorage,
): PendingGeneration | null {
  // v3 読取のたびに旧キーを掃除（残留 v2 が容量・混乱を残さない）
  clearLegacyPendingGenerationV2(storage);

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }

  if (raw === null) {
    return null;
  }

  try {
    const parsed = pendingGenerationSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error("invalid_pending");
    }

    const age = now.getTime() - new Date(parsed.data.createdAt).getTime();
    if (
      parsed.data.ownerUserId !== currentUserId ||
      !Number.isFinite(age) ||
      age < 0 ||
      age >= PENDING_GENERATION_TTL_MS
    ) {
      throw new Error("expired_or_foreign_pending");
    }

    return parsed.data;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // UIと認証の後始末を継続するため削除失敗を吸収する。
    }
    return null;
  }
}

export function savePendingGeneration(
  value: PendingGeneration,
  storage: PendingGenerationWriteStorage = localStorage,
): void {
  storage.setItem(key, JSON.stringify(pendingGenerationSchema.parse(value)));
}

export function clearPendingGeneration(
  storage: PendingGenerationRemoveStorage = localStorage,
): void {
  try {
    storage.removeItem(key);
  } catch {
    // UIと認証の後始末を継続するため削除失敗を吸収する。
  }
}
