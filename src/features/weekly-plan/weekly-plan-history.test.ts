import { describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ getBrowserSupabaseClient: vi.fn() }));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: supabase.getBrowserSupabaseClient,
}));

const { listWeeklyPlanHistory } = await import("./weekly-plan-history.js");

const USER_ID = "51000000-0000-4000-8000-000000000001";

function orderedClient(result: { data: unknown[] | null; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve(result),
        }),
      }),
    }),
  };
}

describe("listWeeklyPlanHistory", () => {
  it("returns rows in the order the query provides them", async () => {
    const memberIdA = "51000000-0000-4000-8000-0000000000a1";
    const memberIdB = "51000000-0000-4000-8000-0000000000b2";
    const rows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        week_start: "2026-09-14",
        created_at: "2026-09-08T00:00:00Z",
        preference_snapshot: { targetMemberIds: [memberIdA] },
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        week_start: "2026-09-07",
        created_at: "2026-09-01T00:00:00Z",
        preference_snapshot: { targetMemberIds: [memberIdA, memberIdB] },
      },
    ];
    supabase.getBrowserSupabaseClient.mockReturnValue(orderedClient({ data: rows, error: null }));

    const result = await listWeeklyPlanHistory(USER_ID);

    expect(result).toEqual(rows);
  });

  it("throws when the query returns an error", async () => {
    supabase.getBrowserSupabaseClient.mockReturnValue(
      orderedClient({ data: null, error: new Error("network") }),
    );

    await expect(listWeeklyPlanHistory(USER_ID)).rejects.toThrow(
      "週献立の履歴を読み込めませんでした",
    );
  });

  it("throws when preference_snapshot is malformed", async () => {
    supabase.getBrowserSupabaseClient.mockReturnValue(
      orderedClient({
        data: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            week_start: "2026-09-14",
            created_at: "2026-09-08T00:00:00Z",
            preference_snapshot: { somethingElse: true },
          },
        ],
        error: null,
      }),
    );

    await expect(listWeeklyPlanHistory(USER_ID)).rejects.toThrow();
  });
});
