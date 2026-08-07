import { z } from "zod";

/** アカウント削除 API の確認フレーズは日本語リテラル固定（英語・別表記を拒否）。 */
export const deleteAccountRequestSchema = z.object({
  confirmation: z.literal("削除する"),
});

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
export type DeleteAccountResult = { deleted: true };

/** Function エラー code: SafeLog closedErrorCode と同形の snake_case（S9）。 */
const functionErrorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u);
/** 利用者向け message の天井。巨大プロキシ改変を構造拒否。 */
const functionErrorMessageSchema = z.string().min(1).max(500);

/** Function 応答 envelope。ネットワーク境界では safeParse で検証する。 */
export const deleteAccountEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.object({ deleted: z.literal(true) }) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: functionErrorCodeSchema, message: functionErrorMessageSchema }),
  }),
]);
export type DeleteAccountEnvelope = z.infer<typeof deleteAccountEnvelopeSchema>;
