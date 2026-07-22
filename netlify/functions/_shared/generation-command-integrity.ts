import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import type {
  ExpiredPantryConfirmation,
  GenerationCommandV2,
  GenerationIntegrityContextV2,
} from "../../../shared/contracts/generation.js";
import { generationCommandVersionV2 } from "../../../shared/contracts/generation.js";

export const generationRequestHmacVersion = generationCommandVersionV2;

// 期限切れ在庫確認は集合として扱い、保存順に依存しないよう正規化する
const sortedChecks = (
  values: readonly ExpiredPantryConfirmation[],
): readonly ExpiredPantryConfirmation[] =>
  [...values].toSorted(
    (left, right) =>
      left.pantryItemId.localeCompare(right.pantryItemId) ||
      left.checkedAt.localeCompare(right.checkedAt),
  );

// 対象家族 ID も集合として扱い、HMAC が並び順に依存しないよう正規化する
const sortedMemberIds = (values: readonly string[]): readonly string[] =>
  [...values].toSorted((left, right) => left.localeCompare(right));

/**
 * 冪等性比較の唯一の正規表現。key 順は固定し、kind に存在しない値は null とする。
 * リクエスト JSON やプロンプト本文は台帳に載せない。
 */
export function canonicalizeGenerationCommandV2(
  command: GenerationCommandV2,
  integrity: GenerationIntegrityContextV2,
): string {
  const isNewMenu = command.kind === "new_menu";
  // key 順は brief Step 4 の固定順。JSON.stringify は挿入順を保持する。
  return JSON.stringify({
    version: generationRequestHmacVersion,
    kind: command.kind,
    idempotencyKey: command.request.idempotencyKey,
    draftId: isNewMenu ? command.request.draftId : null,
    draftRevision: isNewMenu ? command.request.draftRevision : null,
    sourceMenuId: isNewMenu ? null : command.request.sourceMenuId,
    dishId: command.kind === "regenerate_dish" ? command.request.dishId : null,
    changeReason: isNewMenu ? null : command.request.changeReason,
    changeReasonCustom: isNewMenu ? null : command.request.changeReasonCustom,
    privacyNoticeVersion: isNewMenu ? command.request.privacyNoticeVersion : null,
    expiredPantryConfirmations: sortedChecks(command.request.expiredPantryConfirmations),
    targetMode: integrity.targetMode,
    servings: integrity.servings,
    targetMemberIds: sortedMemberIds(integrity.targetMemberIds),
    sourceMenuVersion: integrity.sourceMenuVersion,
  });
}

// 環境変数から 32 バイト HMAC 鍵を読み取る。非正規 base64 や長さ不一致は拒否する
export function parseGenerationRequestHmacKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
    throw new Error("GENERATION_REQUEST_HMAC_KEY must be canonical base64 for exactly 32 bytes");
  }
  return decoded;
}

// 正規化したコマンド文字列に対する HMAC-SHA-256（小文字 hex 64 桁）
export function generationRequestHmac(
  command: GenerationCommandV2,
  integrity: GenerationIntegrityContextV2,
  key: Uint8Array,
): string {
  return createHmac("sha256", key)
    .update(canonicalizeGenerationCommandV2(command, integrity), "utf8")
    .digest("hex");
}
