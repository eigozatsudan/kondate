import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import type {
  ExpiredPantryConfirmation,
  GenerationCommand,
} from "../../../shared/contracts/generation.js";

export const generationRequestHmacVersion = "generation-command.v1" as const;

// 期限切れ在庫確認は集合として扱い、保存順に依存しないよう正規化する
const sortedChecks = (
  values: readonly ExpiredPantryConfirmation[],
): readonly ExpiredPantryConfirmation[] =>
  [...values].toSorted(
    (left, right) =>
      left.pantryItemId.localeCompare(right.pantryItemId) ||
      left.checkedAt.localeCompare(right.checkedAt),
  );

// 冪等性比較の唯一の正規表現。リクエスト JSON やプロンプト本文は台帳に載せない
export function canonicalizeGenerationCommandV1(command: GenerationCommand): string {
  const base = {
    version: generationRequestHmacVersion,
    kind: command.kind,
    idempotencyKey: command.request.idempotencyKey,
  } as const;
  if (command.kind === "new_menu") {
    return JSON.stringify({
      ...base,
      draftId: command.request.draftId,
      draftRevision: command.request.draftRevision,
      privacyNoticeVersion: command.request.privacyNoticeVersion,
      expiredPantryConfirmations: sortedChecks(command.request.expiredPantryConfirmations),
    });
  }
  const regeneration = {
    ...base,
    sourceMenuId: command.request.sourceMenuId,
    dishId: command.kind === "regenerate_dish" ? command.request.dishId : null,
    changeReason: command.request.changeReason,
    changeReasonCustom: command.request.changeReasonCustom,
    expiredPantryConfirmations: sortedChecks(command.request.expiredPantryConfirmations),
  } as const;
  return JSON.stringify(regeneration);
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
export function generationRequestHmac(command: GenerationCommand, key: Uint8Array): string {
  return createHmac("sha256", key)
    .update(canonicalizeGenerationCommandV1(command), "utf8")
    .digest("hex");
}
