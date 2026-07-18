import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { plannerDraftInputSchema, type PlannerDraftInput } from "@shared/contracts/planner";

const mocks = vi.hoisted(() => ({
  eligibleMemberIds: Array.from(
    { length: 21 },
    (_, index) => `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ),
}));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "72000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ cancelQueries: vi.fn(), setQueryData: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) =>
    queryKey[0] === "planner"
      ? { data: null, isError: false, isPending: false, refetch: vi.fn() }
      : {
          data: {
            members: mocks.eligibleMemberIds.map((id, index) => ({
              id,
              displayName: `家族${String(index + 1)}`,
              ageBandLabel: "大人",
              allergyLabel: "アレルギーなし",
              safetyLabels: [],
              blockedReason: null,
            })),
            eligibleMemberIds: mocks.eligibleMemberIds,
          },
          isError: false,
          isPending: false,
        },
}));
vi.mock("./use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    state: "idle",
    revision: 0,
    flush: vi.fn(),
  }),
}));
vi.mock("./planner-page", () => ({
  PlannerForm: ({ initialValue }: { initialValue: PlannerDraftInput }) => (
    <>
      <output aria-label="対象家族数">{initialValue.targetMemberIds.length}</output>
      <output aria-label="下書き値">{JSON.stringify(initialValue)}</output>
    </>
  ),
}));

import { PlannerPage } from "./planner-route";

it("新規下書きの対象家族を適格な先頭20人までで初期化する", async () => {
  render(
    <MemoryRouter>
      <PlannerPage />
    </MemoryRouter>,
  );

  expect(await screen.findByLabelText("対象家族数")).toHaveTextContent("20");
  expect(
    plannerDraftInputSchema.safeParse(JSON.parse(screen.getByLabelText("下書き値").innerHTML))
      .success,
  ).toBe(true);
});
