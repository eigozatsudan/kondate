import type {
  GenerationDetail,
  GenerationListItem,
} from "../../../shared/schemas.js";
import { generationDetailSchema, generationListItemSchema } from "../../../shared/schemas.js";
import { formatIso } from "./jst.js";

type GenRow = {
  id: string;
  created_at: Date | string;
  status: string;
  request_kind: string;
  failure_code: string | null;
  duration_ms: number | null;
  actual_model_ids: string[] | null;
  quality_mode: boolean;
  repair_attempted: boolean;
  user_id: string;
  started_at?: Date | string | null;
  completed_at?: Date | string | null;
  user_usage_day?: string | null;
  global_sent_calls?: number | null;
  terminal_details?: unknown;
  change_reason?: string | null;
  draft_id?: string | null;
  source_menu_id?: string | null;
  replace_dish_id?: string | null;
  completed_menu_id?: string | null;
  processing_expires_at?: Date | string | null;
  quota_success_limit?: number | null;
};

export function mapGenerationListItem(row: GenRow): GenerationListItem {
  return generationListItemSchema.parse({
    id: row.id,
    createdAt: formatIso(row.created_at) ?? "",
    status: row.status,
    requestKind: row.request_kind,
    failureCode: row.failure_code,
    durationMs: row.duration_ms,
    actualModelIds: row.actual_model_ids ?? [],
    qualityMode: row.quality_mode,
    repairAttempted: row.repair_attempted,
    userId: row.user_id,
  });
}

export function mapGenerationDetail(row: GenRow): GenerationDetail {
  return generationDetailSchema.parse({
    ...mapGenerationListItem(row),
    startedAt: formatIso(row.started_at ?? null),
    completedAt: formatIso(row.completed_at ?? null),
    userUsageDay:
      row.user_usage_day == null
        ? null
        : typeof row.user_usage_day === "string"
          ? row.user_usage_day
          : String(row.user_usage_day),
    globalSentCalls: row.global_sent_calls ?? null,
    terminalDetails: row.terminal_details ?? null,
    changeReason: row.change_reason ?? null,
    draftId: row.draft_id ?? null,
    sourceMenuId: row.source_menu_id ?? null,
    replaceDishId: row.replace_dish_id ?? null,
    completedMenuId: row.completed_menu_id ?? null,
    processingExpiresAt: formatIso(row.processing_expires_at ?? null),
    quotaSuccessLimit: row.quota_success_limit ?? null,
  });
}
