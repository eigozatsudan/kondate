import { z } from "zod";

import {
  generationCommandVersionV3,
  generationCommandV3Schema,
  newMenuGenerationRequestSchema,
  regenerateDishRequestSchema,
  regenerateMenuRequestSchema,
  type GenerationCommand,
} from "@shared/contracts/generation";
import { clearPendingGenerationMeta } from "./pending-generation-meta";

// storage key は v3 cutover に合わせる（旧 v2 pending は読まず best-effort 削除）
const key = "kondate:generation:v3";
/** 旧 cutover 前キー。v3 reader が触れたタイミングで破棄する */
const legacyV2Key = "kondate:generation:v2";

/** 端末 recovery 用 TTL（30min）。G15 residual-intentional: 超過後は自動 /menus 遷移を失い履歴依存。延長は製品判断。 */
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
/** setItem 必須。regenerate 保存時の meta clear 用に removeItem を任意で受ける */
type PendingGenerationWriteStorage = Pick<Storage, "setItem"> &
  Partial<Pick<Storage, "removeItem">>;
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
  // regenerate_* は household 補助文の対象外。残存 meta で誤表示しないよう落とす。
  // meta の upsert は planner-route が draft.targetMode を知る new_menu 時のみ行い、
  // ここからは targetMode 無しで meta を書かない。
  if (value.kind !== "new_menu") {
    const removeItem = storage.removeItem;
    if (typeof removeItem === "function") {
      clearPendingGenerationMeta({ removeItem: removeItem.bind(storage) });
    }
  }
}

/**
 * dual-tab claim 用。shopping の pendingShoppingCommandClaimLockName と同型。
 * ロック保持は sticky mint のみ（navigate / POST は外）。
 */
export const pendingGenerationClaimLockName = "kondate:generation:v3:claim" as const;

export type ClaimPendingGenerationResult = {
  pending: PendingGeneration;
  /**
   * true: 自タブが first-writer として sticky を確保した。
   * false: 既存または他タブ勝者の sticky を採用（上書きしない。C2 再開）。
   */
  claimed: boolean;
};

type PendingGenerationClaimStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * P1: dual-tab localStorage pending の check-then-act last-writer-wins を閉じる。
 * shopping の claimShoppingCommand / claimItemMutationSticky と同型:
 * - Web Locks で読取→書込を直列化（pre-write TOCTOU を閉じる）
 * - Locks 非対応は localStorage fallback lock（PE-R3 同型）で同一オリジンを直列化し、
 *   書込後 re-read + 1 ティック再確認で他 sticky を見たら負け
 * G6: 1 ティック再読だけでは先勝ち確定後に後タブが last-writer で上書きし、
 * 先勝ち key が端末から消える。fallback lock 保持中だけ mint する。
 * C2: 既に有効 pending があるときは上書きせず claimed=false（同一タブ再開と同契約）。
 * recovery 中の requestId 更新など「同一 sticky の上書き」は savePendingGeneration を直接使う。
 */
export async function claimPendingGeneration(
  candidate: PendingGeneration,
  currentUserId: string,
  now: Date = new Date(),
  storage: PendingGenerationClaimStorage = localStorage,
): Promise<ClaimPendingGenerationResult> {
  const run = (): ClaimPendingGenerationResult =>
    decideClaimAfterWrite(candidate, currentUserId, now, storage);

  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks !== undefined && typeof locks.request === "function") {
    return locks.request(pendingGenerationClaimLockName, () => run());
  }
  return claimPendingGenerationWithoutLocks(candidate, currentUserId, now, storage);
}

function sameClaimIdempotencyKey(left: PendingGeneration, right: PendingGeneration): boolean {
  return left.request.idempotencyKey === right.request.idempotencyKey;
}

function decideClaimAfterWrite(
  candidate: PendingGeneration,
  currentUserId: string,
  now: Date,
  storage: PendingGenerationClaimStorage,
): ClaimPendingGenerationResult {
  const existing = readPendingGeneration(currentUserId, now, storage);
  if (existing !== null) {
    return { pending: existing, claimed: false };
  }
  savePendingGeneration(candidate, storage);
  // 書込後 re-read: Locks 無し競合で他タブが後勝ちした場合は共有 sticky を優先する
  const again = readPendingGeneration(currentUserId, now, storage);
  if (again === null) {
    // setItem 成功後に読めない異常。candidate を自 claim として返し呼び出し側が進める
    return { pending: candidate, claimed: true };
  }
  const claimed = sameClaimIdempotencyKey(again, candidate);
  return { pending: again, claimed };
}

function yieldClaimTurn(): Promise<void> {
  // 他タブの setItem が localStorage に見えるのは次マクロタスク以降。
  // queueMicrotask だと自タブの遅延書込と並び、両方 claimed のまま残る。
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function sleepClaimMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** G6: Locks 非対応 UA の同一オリジン向け。別端末は残差。 */
export const pendingGenerationClaimFallbackLockKey = "kondate:generation:v3:claim-lock" as const;
const pendingGenerationClaimFallbackLockTtlMs = 8_000;
const pendingGenerationClaimFallbackLockPollMs = 15;

function claimFallbackLockIsHeld(held: string | null, nowMs: number): boolean {
  if (held === null) return false;
  const heldAt = Number(held.split(":")[0]);
  return Number.isFinite(heldAt) && nowMs - heldAt <= pendingGenerationClaimFallbackLockTtlMs;
}

/**
 * Locks 非対応: 書いた直後の自 key を信じず、1 ティック後にもう一度読む。
 * 他 sticky が見えたら負け（両方 claimed にしない）。Locks 経路は触らない。
 */
async function confirmClaimAfterFirstWrite(
  candidate: PendingGeneration,
  currentUserId: string,
  now: Date,
  storage: PendingGenerationClaimStorage,
): Promise<ClaimPendingGenerationResult> {
  const first = decideClaimAfterWrite(candidate, currentUserId, now, storage);
  if (!first.claimed) {
    return first;
  }
  await yieldClaimTurn();
  const again = readPendingGeneration(currentUserId, now, storage);
  if (again === null) {
    return first;
  }
  if (!sameClaimIdempotencyKey(again, candidate)) {
    return { pending: again, claimed: false };
  }
  return { pending: again, claimed: true };
}

/**
 * G6: pantry PE-R3 同型の localStorage fallback lock。
 * 1 ティック再読の前に同一オリジンの mint を直列化し、先勝ち key の last-writer 消失を閉じる。
 * 期限切れは献立開始を止めず、ロック無しの 1 ティック再読へ落とす。
 */
async function runWithGenerationClaimFallbackLock<T>(
  storage: PendingGenerationClaimStorage,
  run: () => Promise<T>,
): Promise<T | null> {
  const token = `${Date.now().toString()}:${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + pendingGenerationClaimFallbackLockTtlMs;
  while (Date.now() < deadline) {
    if (
      !claimFallbackLockIsHeld(storage.getItem(pendingGenerationClaimFallbackLockKey), Date.now())
    ) {
      storage.setItem(pendingGenerationClaimFallbackLockKey, token);
      await yieldClaimTurn();
      if (storage.getItem(pendingGenerationClaimFallbackLockKey) === token) {
        try {
          return await run();
        } finally {
          if (storage.getItem(pendingGenerationClaimFallbackLockKey) === token) {
            storage.removeItem(pendingGenerationClaimFallbackLockKey);
          }
        }
      }
    }
    await sleepClaimMs(pendingGenerationClaimFallbackLockPollMs);
  }
  return null;
}

async function claimPendingGenerationWithoutLocks(
  candidate: PendingGeneration,
  currentUserId: string,
  now: Date,
  storage: PendingGenerationClaimStorage,
): Promise<ClaimPendingGenerationResult> {
  const locked = await runWithGenerationClaimFallbackLock(storage, () =>
    confirmClaimAfterFirstWrite(candidate, currentUserId, now, storage),
  );
  if (locked !== null) {
    return locked;
  }
  return confirmClaimAfterFirstWrite(candidate, currentUserId, now, storage);
}

export function clearPendingGeneration(
  storage: PendingGenerationRemoveStorage = localStorage,
): void {
  try {
    storage.removeItem(key);
  } catch {
    // UIと認証の後始末を継続するため削除失敗を吸収する。
  }
  // RecoveryLinks / clearGeneration / 結果離脱を含む全 clear 経路で meta も必ず落とす
  clearPendingGenerationMeta(storage);
}
