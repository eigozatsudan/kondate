import { z } from "zod";

import {
  generationCommandVersionV2,
  generationCommandV2Schema,
  newMenuGenerationRequestSchema,
  regenerateDishRequestSchema,
  regenerateMenuRequestSchema,
  type GenerationCommand,
} from "@shared/contracts/generation";

const key = "kondate:generation:v2";

export const PENDING_GENERATION_TTL_MS = 1_800_000 as const;

const pendingGenerationMetadataSchema = {
  ownerUserId: z.uuid(),
  requestId: z.uuid().optional(),
  createdAt: z.iso.datetime({ offset: true }),
};

// 端末 pending は commandVersion を持つ v2 だけを受理する（旧版 reader は置かない）
export const pendingGenerationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...pendingGenerationMetadataSchema,
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("new_menu"),
      request: newMenuGenerationRequestSchema,
    })
    .strict(),
  z
    .object({
      ...pendingGenerationMetadataSchema,
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("regenerate_menu"),
      request: regenerateMenuRequestSchema,
    })
    .strict(),
  z
    .object({
      ...pendingGenerationMetadataSchema,
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("regenerate_dish"),
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
    ...generationCommandV2Schema.parse(command),
    ownerUserId,
    createdAt: now().toISOString(),
  });
}

export function pendingGenerationCommand(value: PendingGeneration): GenerationCommand {
  return generationCommandV2Schema.parse({
    commandVersion: value.commandVersion,
    kind: value.kind,
    request: value.request,
  });
}

export function readPendingGeneration(
  currentUserId: string,
  now: Date,
  storage: PendingGenerationReadStorage = localStorage,
): PendingGeneration | null {
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
