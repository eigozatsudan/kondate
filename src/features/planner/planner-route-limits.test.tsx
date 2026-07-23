import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

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
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    if (queryKey[0] === "usage-today") {
      return {
        data: {
          success: { consumed: 0, limit: 5, remaining: 5 },
          attempts: { sent: 0, limit: 12, remaining: 12 },
          shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
          globalAvailable: true,
          retryAt: null,
        },
        isError: false,
        isPending: false,
        isSuccess: true,
      };
    }
    if (queryKey[0] === "planner") {
      return { data: null, isError: false, isPending: false, refetch: vi.fn() };
    }
    if (queryKey[0] === "pantry") {
      return { data: [], isError: false, isPending: false };
    }
    if (queryKey[0] === "privacy") {
      return {
        data: { user_id: "72000000-0000-4000-8000-000000000001", notice_version: "2026-07-11.v1" },
        isError: false,
        isPending: false,
      };
    }
    return {
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
    };
  },
}));
vi.mock("./use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    state: "idle",
    revision: 0,
    flush: vi.fn(),
  }),
}));

import { PlannerPage } from "./planner-route";

it("新規下書きの対象家族を適格な先頭20人までで初期化する", async () => {
  render(
    <MemoryRouter>
      <PlannerPage />
    </MemoryRouter>,
  );

  // audience stepまで進み、household選択済みの対象家族数を確認する。
  await userEvent.click(await screen.findByRole("radio", { name: "夕食" }));
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));
  await userEvent.type(screen.getByLabelText("メイン食材"), "鶏肉");
  await userEvent.click(screen.getByRole("button", { name: "追加" }));
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));
  await userEvent.click(screen.getByRole("radio", { name: "和食" }));
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));

  expect(screen.getByRole("radio", { name: "家族に合わせて作る" })).toBeChecked();
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(20);
});
