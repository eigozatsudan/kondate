import type { ShareJobListItem } from "../../../shared/schemas.js";
import { shareJobListItemSchema } from "../../../shared/schemas.js";
import { formatIso } from "./jst.js";

type ShareRow = {
  id: string;
  created_at: Date | string;
  status: string;
  failure_code: string | null;
  skip_reason: string | null;
  claimed_at: Date | string | null;
  heartbeat_at: Date | string | null;
  finished_at: Date | string | null;
  pass1_model: string | null;
  pass2_model: string | null;
  contributor_user_id: string | null;
  source_menu_id: string | null;
};

export function mapShareJob(row: ShareRow): ShareJobListItem {
  return shareJobListItemSchema.parse({
    id: row.id,
    createdAt: formatIso(row.created_at) ?? "",
    status: row.status,
    failureCode: row.failure_code,
    skipReason: row.skip_reason,
    claimedAt: formatIso(row.claimed_at),
    heartbeatAt: formatIso(row.heartbeat_at),
    finishedAt: formatIso(row.finished_at),
    pass1Model: row.pass1_model,
    pass2Model: row.pass2_model,
    contributorUserId: row.contributor_user_id,
    sourceMenuId: row.source_menu_id,
  });
}
