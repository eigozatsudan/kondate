import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { PlannerDraft } from "@shared/contracts/planner";
import type { PlannerAttempt } from "./expired-pantry-checks";

const draft: PlannerDraft = {
  id: "71000000-0000-0000-0000-000000000001",
  userId: "72000000-0000-0000-0000-000000000001",
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMemberIds: ["70000000-0000-0000-0000-000000000001"],
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
  revision: 3,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

vi.mock("@/features/auth/auth-provider", () => ({
  useAuth: () => ({ session: { user: { id: draft.userId } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) =>
    queryKey[0] === "planner"
      ? {
          data: draft,
          isError: false,
          isPending: false,
          refetch: vi.fn(),
        }
      : {
          data: {
            members: [
              {
                id: draft.targetMemberIds[0],
                displayName: "子ども",
                ageBandLabel: "3〜5歳",
                allergyLabel: "アレルギーなし",
                safetyLabels: [],
                blockedReason: null,
              },
            ],
            eligibleMemberIds: draft.targetMemberIds,
          },
          isError: false,
          isPending: false,
        },
}));
vi.mock("./use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    state: "saved",
    revision: 3,
    flush: vi.fn().mockResolvedValue(draft),
  }),
}));
vi.mock("./planner-page", () => ({
  PlannerForm: (props: {
    attempt: PlannerAttempt;
    onAttemptChange(next: PlannerAttempt): void;
    onStartNewAttempt(): void;
    onGenerate(saved: PlannerDraft, attempt: PlannerAttempt): Promise<void>;
  }) => (
    <div>
      <output aria-label="attempt key">{props.attempt.idempotencyKey}</output>
      <output aria-label="check count">{props.attempt.expiredPantryChecks.length}</output>
      <button
        type="button"
        onClick={() => {
          props.onAttemptChange({
            idempotencyKey: props.attempt.idempotencyKey,
            expiredPantryChecks: [
              {
                pantryItemId: "74000000-0000-0000-0000-000000000001",
                checkedAt: "2026-07-11T03:00:00.000Z",
              },
            ],
          });
        }}
      >
        確認を反映
      </button>
      <button
        type="button"
        onClick={() => void props.onGenerate(draft, props.attempt).catch(() => undefined)}
      >
        生成
      </button>
      <button
        type="button"
        onClick={() => {
          props.onStartNewAttempt();
        }}
      >
        新しい試行
      </button>
    </div>
  ),
}));

import { PlannerPage } from "./planner-route";

beforeEach(() => {
  vi.clearAllMocks();
});

it("route が更新された exact attempt を生成へ渡し新しい試行ではキーと確認を更新する", async () => {
  const user = userEvent.setup();
  const startGeneration = vi.fn();
  render(<PlannerPage startGeneration={startGeneration} />);
  const firstKey = screen.getByLabelText("attempt key").textContent;

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  expect(screen.getByLabelText("check count")).toHaveTextContent("1");
  await user.click(screen.getByRole("button", { name: "生成" }));
  expect(startGeneration).toHaveBeenCalledWith(draft, {
    idempotencyKey: firstKey,
    expiredPantryChecks: [
      {
        pantryItemId: "74000000-0000-0000-0000-000000000001",
        checkedAt: "2026-07-11T03:00:00.000Z",
      },
    ],
  });

  await user.click(screen.getByRole("button", { name: "新しい試行" }));
  expect(screen.getByLabelText("attempt key").textContent).not.toBe(firstKey);
  expect(screen.getByLabelText("check count")).toHaveTextContent("0");
});

it("生成成功の完了後だけ attempt を新しいキーと空の確認へ更新する", async () => {
  const user = userEvent.setup();
  const startGeneration = vi.fn(
    (draftArg: PlannerDraft, attemptArg: PlannerAttempt): Promise<undefined> => {
      expect(draftArg).toEqual(draft);
      expect(attemptArg.expiredPantryChecks).toHaveLength(1);
      return Promise.resolve(undefined);
    },
  );
  render(<PlannerPage startGeneration={startGeneration} />);
  const firstKey = screen.getByLabelText("attempt key").textContent;
  await user.click(screen.getByRole("button", { name: "確認を反映" }));

  await user.click(screen.getByRole("button", { name: "生成" }));

  await vi.waitFor(() => {
    expect(screen.getByLabelText("attempt key").textContent).not.toBe(firstKey);
    expect(screen.getByLabelText("check count")).toHaveTextContent("0");
  });
  expect(startGeneration.mock.calls[0]).toEqual([
    draft,
    {
      idempotencyKey: firstKey,
      expiredPantryChecks: [
        {
          pantryItemId: "74000000-0000-0000-0000-000000000001",
          checkedAt: "2026-07-11T03:00:00.000Z",
        },
      ],
    },
  ]);
});

it.each([
  ["拒否", vi.fn().mockRejectedValue(new Error("failed"))],
  ["失敗結果", vi.fn().mockResolvedValue(false)],
])("%s した生成は再試行用の exact attempt を保つ", async (_name, startGeneration) => {
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={startGeneration} />);
  const firstKey = screen.getByLabelText("attempt key").textContent;
  await user.click(screen.getByRole("button", { name: "確認を反映" }));

  await user.click(screen.getByRole("button", { name: "生成" }));

  await vi.waitFor(() => {
    expect(startGeneration).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByLabelText("attempt key")).toHaveTextContent(firstKey);
  expect(screen.getByLabelText("check count")).toHaveTextContent("1");
});
