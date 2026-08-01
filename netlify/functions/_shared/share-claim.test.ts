// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  claimShareGeneralizationJobs,
  type ClaimShareGeneralizationJobsInput,
} from "./share-claim.js";

const jobRow = {
  id: "d1000000-0000-4000-8000-000000000001",
  source_menu_id: "b1000000-0000-4000-8000-0000000000b1",
  contributor_user_id: "a1000000-0000-4000-8000-0000000000a1",
  status: "running" as const,
  claimed_at: "2026-08-01T12:00:00.000Z",
  heartbeat_at: "2026-08-01T12:00:00.000Z",
  created_at: "2026-08-01T11:00:00.000Z",
};

function makeAdmin(rpcImpl?: ReturnType<typeof vi.fn>) {
  const rpc = rpcImpl ?? vi.fn(() => Promise.resolve({ data: { jobs: [jobRow] }, error: null }));
  const admin = { rpc } as unknown as ClaimShareGeneralizationJobsInput["admin"];
  return { admin, rpc };
}

describe("claimShareGeneralizationJobs", () => {
  it("calls claim RPC with limit and returns parsed jobs", async () => {
    const { admin, rpc } = makeAdmin();
    const jobs = await claimShareGeneralizationJobs({ admin, limit: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("claim_share_generalization_jobs", { p_limit: 2 });
    expect(jobs).toEqual([jobRow]);
  });

  it("defaults limit to maxGlobalRunning (4)", async () => {
    const { admin, rpc } = makeAdmin();
    await claimShareGeneralizationJobs({ admin });
    expect(rpc).toHaveBeenCalledWith("claim_share_generalization_jobs", { p_limit: 4 });
  });

  it("returns empty array when no jobs claimed", async () => {
    const { admin } = makeAdmin(vi.fn(() => Promise.resolve({ data: { jobs: [] }, error: null })));
    await expect(claimShareGeneralizationJobs({ admin })).resolves.toEqual([]);
  });

  it("throws closed error on rpc error field", async () => {
    const { admin } = makeAdmin(
      vi.fn(() =>
        Promise.resolve({
          data: null,
          error: { message: "permission denied", code: "42501" },
        }),
      ),
    );
    await expect(claimShareGeneralizationJobs({ admin })).rejects.toThrow("share_claim_failed");
  });

  it("throws closed error on malformed payload (no free-text leak path)", async () => {
    const { admin } = makeAdmin(
      vi.fn(() =>
        Promise.resolve({
          data: { jobs: [{ ...jobRow, title: "肉じゃが" }] },
          error: null,
        }),
      ),
    );
    await expect(claimShareGeneralizationJobs({ admin })).rejects.toThrow("share_claim_failed");
  });

  it("rejects invalid limit without calling rpc", async () => {
    const { admin, rpc } = makeAdmin();
    await expect(claimShareGeneralizationJobs({ admin, limit: 0 })).rejects.toThrow(
      "share_claim_failed",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
