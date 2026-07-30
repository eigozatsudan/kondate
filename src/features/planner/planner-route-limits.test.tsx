import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";

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
          plan: "free" as const,
          plusEntitled: false,
          success: { consumed: 0, limit: 3, remaining: 3 },
          attempts: { sent: 0, limit: 6, remaining: 6 },
          shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
          quality: {
            day: { consumed: 0, limit: 3, remaining: 3 },
            month: { consumed: 0, limit: 20, remaining: 20 },
            available: false,
          },
          flyerWeekly: {
            successConsumed: 0,
            successLimit: 2,
            successRemaining: 2,
            triesConsumed: 0,
            triesLimit: 6,
            triesRemaining: 6,
            weekStartJst: "2026-07-27",
          },
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
        data: { user_id: "72000000-0000-4000-8000-000000000001", notice_version: "2026-07-29.v1" },
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

it("新規下書きは対象を自動埋めせず、household 選択後も上限20人まで手選択する", async () => {
  // MealStep が useAppToast を使うため Provider 必須
  render(
    <MemoryRouter>
      <AppToastProvider>
        <PlannerPage />
      </AppToastProvider>
    </MemoryRouter>,
  );

  // audience step まで進む（適格家族は 21 人モック）
  await userEvent.click(await screen.findByRole("radio", { name: "夕食" }));
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));
  await userEvent.type(screen.getByLabelText("メイン食材"), "鶏肉");
  await userEvent.click(screen.getByRole("button", { name: "追加" }));
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));
  await userEvent.click(screen.getByRole("radio", { name: "和食" }));
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));

  // C-I4 / §8.3: 新規下書きは対象未選択。適格家族がいても household を自動埋めしない。
  expect(screen.getByRole("radio", { name: "家族に合わせて作る" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" })).not.toBeChecked();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

  await userEvent.click(screen.getByRole("radio", { name: "家族に合わせて作る" }));
  // 一覧は全適格メンバーを出すが、初期選択は 0。上限 20 までしかチェックできない。
  const checkboxes = screen.getAllByRole("checkbox");
  expect(checkboxes).toHaveLength(21);
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);

  for (const checkbox of checkboxes.slice(0, 20)) {
    await userEvent.click(checkbox);
  }
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(20);
  expect(checkboxes[20]).toBeDisabled();
});
