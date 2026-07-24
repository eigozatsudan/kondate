import { z } from "zod";

/** アカウント削除 API の確認フレーズは日本語リテラル固定（英語・別表記を拒否）。 */
export const deleteAccountRequestSchema = z.object({
  confirmation: z.literal("削除する"),
});

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
export type DeleteAccountResult = { deleted: true };
