import { z } from "zod";

/** アカウント削除 API の確認フレーズは日本語リテラル固定（英語・別表記を拒否）。 */
export const deleteAccountRequestSchema = z.object({
  confirmation: z.literal("削除する"),
});

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
export type DeleteAccountResult = { deleted: true };

/** Function 応答 envelope。ネットワーク境界では safeParse で検証する。 */
export const deleteAccountEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.object({ deleted: z.literal(true) }) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type DeleteAccountEnvelope = z.infer<typeof deleteAccountEnvelopeSchema>;
