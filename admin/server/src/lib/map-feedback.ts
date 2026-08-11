import type { FeedbackDetail, FeedbackListItem } from "../../../shared/schemas.js";
import {
  feedbackDetailSchema,
  feedbackListItemSchema,
} from "../../../shared/schemas.js";
import { formatIso } from "./jst.js";

type FeedbackRow = {
  id: string;
  created_at: Date | string;
  category: string;
  client_path: string | null;
  user_id: string;
  body_preview: string;
  body?: string | null;
};

export function mapFeedbackListItem(row: FeedbackRow): FeedbackListItem {
  return feedbackListItemSchema.parse({
    id: row.id,
    createdAt: formatIso(row.created_at) ?? "",
    category: row.category,
    clientPath: row.client_path,
    userId: row.user_id,
    bodyPreview: row.body_preview,
  });
}

export function mapFeedbackDetail(
  row: FeedbackRow,
  includeBody: boolean,
): FeedbackDetail {
  return feedbackDetailSchema.parse({
    ...mapFeedbackListItem(row),
    body: includeBody ? (row.body ?? null) : null,
  });
}
