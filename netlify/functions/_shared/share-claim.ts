/**
 * 共有一般化 job の claim 境界（service_role → public.claim_share_generalization_jobs）。
 * AI / pipeline / OpenRouter はここから import しない（Task 7a スケルトン）。
 */
import { z } from "zod";
import { shareQuota } from "../../../shared/contracts/share-quota.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";

/** claim RPC が返す 1 job。本文・menu_payload は含まない。 */
export const shareClaimedJobSchema = z
  .object({
    id: z.uuid(),
    source_menu_id: z.uuid().nullable(),
    contributor_user_id: z.uuid().nullable(),
    status: z.literal("running"),
    claimed_at: z.string().min(1),
    heartbeat_at: z.string().min(1),
    created_at: z.string().min(1),
  })
  .strict();

export type ShareClaimedJob = z.infer<typeof shareClaimedJobSchema>;

const claimShareJobsResultSchema = z
  .object({
    jobs: z.array(shareClaimedJobSchema),
  })
  .strict();

export type ClaimShareGeneralizationJobsInput = {
  admin: Pick<AdminSupabaseClient, "rpc">;
  /** 1..50。省略時は maxGlobalRunning（=4） */
  limit?: number;
};

const closedClaimError = () => new Error("share_claim_failed");

/**
 * pending→running を原子的に claim。Zod で閉じた形だけを返す。
 * 上限は RPC 側（maxGlobalRunning / maxPerUserRunning）が正。
 */
export async function claimShareGeneralizationJobs(
  input: ClaimShareGeneralizationJobsInput,
): Promise<ShareClaimedJob[]> {
  const rawLimit = input.limit ?? shareQuota.maxGlobalRunning;
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    throw closedClaimError();
  }

  let data: unknown;
  try {
    const result = await input.admin.rpc("claim_share_generalization_jobs", {
      p_limit: rawLimit,
    });
    if (result.error) {
      throw closedClaimError();
    }
    data = result.data;
  } catch (error) {
    if (error instanceof Error && error.message === "share_claim_failed") {
      throw error;
    }
    throw closedClaimError();
  }

  const parsed = claimShareJobsResultSchema.safeParse(data);
  if (!parsed.success) {
    throw closedClaimError();
  }
  return parsed.data.jobs;
}
