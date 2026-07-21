import { z } from "zod";
import { labelSourceTypes } from "@shared/contracts/generation";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

/** 閉じた changedDetails コード。サーバーと同一集合。 */
export const changedDetailCodes = [
  "pantry_item_removed",
  "pantry_quantity_changed",
  "preference_changed",
] as const;

const menuValidationIssueSchema = z
  .object({
    code: z.string().min(1).max(80),
    path: z.string().min(1).max(200),
    message: z.string().min(1).max(500),
  })
  .strict();

const currentLabelWarningSchema = z
  .object({
    confirmationId: z.uuid(),
    sourceType: z.enum(labelSourceTypes),
    sourceId: z.uuid(),
    sourcePath: z.string().trim().min(1).max(200),
    // reconcile RPC の source_text_snapshot をそのまま受け取る
    sourceText: z.string().trim().min(1).max(500),
    allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    allergenName: z.string().trim().min(1).max(80),
    anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/u),
    memberLabel: z.string().trim().min(1).max(80),
    dictionaryVersion: z.string().trim().min(1).max(80),
    confirmationStatus: z.enum(["pending", "confirmed"]),
  })
  .strict();

/** ブラウザが信頼する現行安全再検証の厳密スキーマ。未知フィールドは拒否する。 */
export const revalidationResultSchema = z
  .object({
    status: z.enum(["valid", "changed", "invalid"]),
    safetyFingerprint: z.string().min(1).max(200),
    allergenCatalogVersion: z.string().min(1).max(80),
    foodRuleVersion: z.string().min(1).max(80),
    issues: z.array(menuValidationIssueSchema).max(100),
    changedDetails: z.array(z.enum(changedDetailCodes)).max(20),
    currentLabelWarnings: z.array(currentLabelWarningSchema).max(200),
  })
  .strict();

export type RevalidationResult = z.infer<typeof revalidationResultSchema>;
export type CurrentMenuLabelWarning = z.infer<typeof currentLabelWarningSchema>;

const revalidationEnvelopeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      data: revalidationResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export class RevalidationApiError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = "RevalidationApiError";
    this.code = code;
  }
}

/**
 * 履歴・結果画面の唯一のブラウザ再検証境界。
 * アクセストークンを付けて POST /api/menus/:menuId/revalidate し、
 * 厳密 Zod で envelope を閉じる。直接 Supabase は呼ばない。
 */
export async function revalidateMenu(
  menuId: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<RevalidationResult> {
  const parsedMenuId = z.uuid().safeParse(menuId);
  if (!parsedMenuId.success) {
    throw new RevalidationApiError("invalid_menu_id", "献立を確認できませんでした");
  }
  const accessToken = await requireAccessToken(getBrowserSupabaseClient());
  const response = await (deps.fetchImpl ?? fetch)(
    `/api/menus/${encodeURIComponent(parsedMenuId.data)}/revalidate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  );
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new RevalidationApiError("invalid_envelope", "現在の家族設定で確認できませんでした");
  }
  const envelope = revalidationEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new RevalidationApiError("invalid_envelope", "現在の家族設定で確認できませんでした");
  }
  if (!envelope.data.ok) {
    throw new RevalidationApiError(
      envelope.data.error.code,
      envelope.data.error.message || "現在の家族設定で確認できませんでした",
    );
  }
  return envelope.data.data;
}

/** 調理・再生成・買い物操作を許可する閉じた判定。manual-success は存在しない。 */
export function isRevalidationActionable(result: RevalidationResult): boolean {
  return result.status === "valid" || (result.status === "changed" && result.issues.length === 0);
}
