import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import type { PantryItem } from "@shared/contracts/pantry";
import type { PlannerAttempt } from "./expired-pantry-checks";
import type { PlannerFieldName, PlannerStep } from "./model/planner-wizard";

const draft: PlannerDraft = {
  id: "71000000-0000-4000-8000-000000000001",
  userId: "72000000-0000-4000-8000-000000000001",
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMode: "household",
  targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
  revision: 3,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const pantryItem: PantryItem = {
  id: "74000000-0000-4000-8000-000000000001",
  userId: draft.userId,
  name: "キャベツ",
  quantity: 1,
  unit: "個",
  expiresOn: "2026-07-10",
  expirationType: "use_by",
  openedState: "opened",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const queryState = vi.hoisted(() => ({
  userId: "72000000-0000-4000-8000-000000000001",
  draft: undefined as PlannerDraft | null | undefined,
  pantry: {
    data: undefined as PantryItem[] | undefined,
    isError: false,
    isPending: false,
  },
  ownerBPending: false,
  privacyConsent: null as { user_id: string; notice_version: string } | null,
}));

const ownerBId = "72000000-0000-4000-8000-000000000002";
const ownerBDraft: PlannerDraft = {
  ...draft,
  id: "71000000-0000-4000-8000-000000000002",
  userId: ownerBId,
  mainIngredients: ["鮭"],
  memo: "owner B の下書き",
  revision: 7,
};

const savePlannerDraftMock = vi.hoisted(() => vi.fn());
const autosaveInputs = vi.hoisted(() => [] as unknown[]);
const navigateMock = vi.hoisted(() => vi.fn());
const setQueryDataMock = vi.hoisted(() => vi.fn());
const getQueryDataMock = vi.hoisted(() => vi.fn());
const cancelQueriesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: queryState.userId } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return { ...original, useNavigate: () => navigateMock };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    cancelQueries: cancelQueriesMock,
    getQueryData: getQueryDataMock,
    setQueryData: setQueryDataMock,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    // usage-today は成功残数表示のみ。生成開始とは独立して常に loaded を返す。
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
    if (queryKey[0] === "privacy") {
      return { data: queryState.privacyConsent, isError: false, isPending: false };
    }
    const ownerId = queryKey[0] === "pantry" ? queryKey[1] : queryKey[2];
    const isOwnerBPending = ownerId === ownerBId && queryState.ownerBPending;
    return queryKey[0] === "planner"
      ? {
          data: isOwnerBPending
            ? undefined
            : ownerId === ownerBId
              ? ownerBDraft
              : (queryState.draft ?? (queryState.draft === null ? null : draft)),
          isError: false,
          isPending: isOwnerBPending,
          refetch: vi.fn().mockResolvedValue({ isError: false, data: draft }),
        }
      : queryKey[0] === "pantry"
        ? isOwnerBPending
          ? { data: undefined, isError: false, isPending: true }
          : queryState.pantry
        : {
            data: isOwnerBPending
              ? undefined
              : {
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
            isPending: isOwnerBPending,
          };
  },
}));
vi.mock("./planner-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./planner-api")>();
  return { ...original, savePlannerDraft: savePlannerDraftMock };
});
vi.mock("./use-draft-autosave", () => ({
  useDraftAutosave: (input: {
    value: PlannerDraftInput;
    baselineRevision: number;
    save(value: PlannerDraftInput, revision: number): Promise<PlannerDraft>;
  }) => {
    autosaveInputs.push(input);
    return {
      state: "saved",
      revision: 3,
      flush: vi.fn(() => input.save(input.value, input.baselineRevision)),
    };
  },
}));

// PlannerRoutePage が実際にマウントするのは PlannerWizard であることを固定するため、
// wizardは独立してmockし、routeから渡されたpropsだけをUIへ露出する。
type WizardMockProps = {
  draft: PlannerDraftInput;
  step: PlannerStep;
  isSaving: boolean;
  error: string | null;
  fieldErrors: Partial<Record<PlannerFieldName, string>>;
  onDraftChange(next: PlannerDraftInput): void;
  onStepChange(next: PlannerStep): void;
  onSubmit(): Promise<void>;
  attempt: PlannerAttempt;
  onAttemptChange(next: PlannerAttempt): void;
  pantryItems: readonly PantryItem[];
  pantryItemsStatus: "loading" | "loaded";
  hasAcceptedOrDeclinedPrivacy: boolean;
  onOpenPrivacyNotice(): void;
  hasDraftConflict?: boolean;
  draftConflictRefetchError?: boolean;
  canResolveDraftConflict?: boolean;
  onResolveDraftConflict?: () => void;
  onRetryDraftConflict?: () => void;
  onOpenEmergencyMenus?: () => void;
};
const wizardPropsSpy = vi.hoisted(() => vi.fn());
vi.mock("./components/planner-wizard", () => ({
  PlannerWizard: (props: WizardMockProps) => {
    wizardPropsSpy(props);
    return (
      <div>
        <output aria-label="wizard step">{props.step}</output>
        <output aria-label="wizard saving">{String(props.isSaving)}</output>
        <output aria-label="wizard error">{props.error ?? ""}</output>
        <output aria-label="pantry status">{props.pantryItemsStatus}</output>
        <output aria-label="pantry names">
          {props.pantryItems.map((item) => item.name).join("・")}
        </output>
        <output aria-label="draft memo">{props.draft.memo}</output>
        <output aria-label="attempt key">{props.attempt.idempotencyKey}</output>
        <output aria-label="check count">{props.attempt.expiredPantryChecks.length}</output>
        <output aria-label="privacy accepted or declined">
          {String(props.hasAcceptedOrDeclinedPrivacy)}
        </output>
        <output aria-label="has draft conflict">{String(props.hasDraftConflict ?? false)}</output>
        <button
          type="button"
          onClick={() => {
            props.onAttemptChange({
              idempotencyKey: props.attempt.idempotencyKey,
              expiredPantryChecks: [
                {
                  pantryItemId: "74000000-0000-4000-8000-000000000001",
                  checkedAt: "2026-07-11T03:00:00.000Z",
                },
              ],
            });
          }}
        >
          確認を反映
        </button>
        <button type="button" onClick={() => void props.onSubmit().catch(() => undefined)}>
          生成
        </button>
        <button
          type="button"
          onClick={() => {
            props.onOpenPrivacyNotice();
          }}
        >
          privacy notice
        </button>
        <button
          type="button"
          disabled={props.isSaving}
          onClick={() => {
            props.onOpenEmergencyMenus?.();
          }}
        >
          AIを使わない緊急献立を見る
        </button>
      </div>
    );
  },
}));

const generationRecoveryMock = vi.hoisted(() => ({ startGeneration: vi.fn() }));
vi.mock("@/features/generation/hooks/use-generation-recovery", () => ({
  useGenerationRecovery: () => generationRecoveryMock,
}));

import { PlannerPage, PlannerRoutePage } from "./planner-route";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  autosaveInputs.length = 0;
  queryState.userId = draft.userId;
  queryState.draft = draft;
  queryState.ownerBPending = false;
  queryState.pantry = {
    data: [pantryItem],
    isError: false,
    isPending: false,
  };
  queryState.privacyConsent = { user_id: draft.userId, notice_version: "2026-07-11.v1" };
  savePlannerDraftMock.mockResolvedValue(draft);
  generationRecoveryMock.startGeneration.mockReset();
  generationRecoveryMock.startGeneration.mockResolvedValue(undefined);
});

it("同一 mount の owner 変更で前 owner の表示・attempt・保存 closure を破棄する", async () => {
  const view = render(<PlannerPage />);
  const ownerAAttemptKey = screen.getByLabelText("attempt key").textContent;

  await userEvent.click(screen.getByRole("button", { name: "確認を反映" }));
  expect(screen.getByLabelText("check count")).toHaveTextContent("1");

  queryState.userId = ownerBId;
  queryState.ownerBPending = true;
  view.rerender(<PlannerPage />);

  expect(screen.getByText("献立条件を読み込み中…")).toBeInTheDocument();
  expect(screen.queryByLabelText("draft memo")).not.toBeInTheDocument();

  queryState.ownerBPending = false;
  view.rerender(<PlannerPage />);

  await vi.waitFor(() => {
    expect(screen.getByLabelText("draft memo")).toHaveTextContent("owner B の下書き");
  });
  expect(screen.getByLabelText("attempt key").textContent).not.toBe(ownerAAttemptKey);
  expect(screen.getByLabelText("check count")).toHaveTextContent("0");

  const latestAutosave = autosaveInputs.at(-1) as {
    value: PlannerDraft;
    save(next: PlannerDraft, revision: number): Promise<PlannerDraft>;
  };
  await latestAutosave.save(latestAutosave.value, 8);
  expect(savePlannerDraftMock).toHaveBeenLastCalledWith(
    {},
    ownerBId,
    expect.objectContaining({ memo: "owner B の下書き" }),
    8,
  );
});

it("owner の冷蔵庫一覧を loaded 状態で planner wizard へ渡す", () => {
  render(<PlannerPage />);

  expect(screen.getByLabelText("pantry status")).toHaveTextContent("loaded");
  expect(screen.getByLabelText("pantry names")).toHaveTextContent("キャベツ");
});

it("冷蔵庫一覧の取得中は planner wizard を確定表示しない", () => {
  queryState.pantry = { data: undefined, isError: false, isPending: true };

  render(<PlannerPage />);

  expect(screen.getByText("献立条件を読み込み中…")).toBeInTheDocument();
  expect(screen.queryByLabelText("pantry status")).not.toBeInTheDocument();
});

it("冷蔵庫一覧の取得失敗を planner route の読み込み失敗として表示する", () => {
  queryState.pantry = { data: undefined, isError: true, isPending: false };

  render(<PlannerPage />);

  expect(screen.getByRole("alert")).toHaveTextContent(
    "献立条件を読み込めませんでした。再読み込みしてください。",
  );
  expect(screen.queryByLabelText("pantry status")).not.toBeInTheDocument();
});

it("再読み込み相当の remount では下書きと別管理の attempt key を作り直す", () => {
  const first = render(<PlannerPage />);
  const firstKey = screen.getByLabelText("attempt key").textContent;
  first.unmount();

  render(<PlannerPage />);

  expect(screen.getByLabelText("attempt key").textContent).not.toBe(firstKey);
  expect(screen.getByLabelText("check count")).toHaveTextContent("0");
});

it("route が更新された exact attempt を生成へ渡し新しい試行ではキーと確認を更新する", async () => {
  const user = userEvent.setup();
  const startGeneration = vi.fn();
  render(<PlannerPage startGeneration={startGeneration} />);
  const firstKey = screen.getByLabelText("attempt key").textContent;

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  expect(screen.getByLabelText("check count")).toHaveTextContent("1");
  await user.click(screen.getByRole("button", { name: "生成" }));
  expect(startGeneration).toHaveBeenCalledWith(
    draft,
    {
      idempotencyKey: firstKey,
      expiredPantryChecks: [
        {
          pantryItemId: "74000000-0000-4000-8000-000000000001",
          checkedAt: "2026-07-11T03:00:00.000Z",
        },
      ],
    },
    expect.any(AbortSignal),
  );
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
          pantryItemId: "74000000-0000-4000-8000-000000000001",
          checkedAt: "2026-07-11T03:00:00.000Z",
        },
      ],
    },
    expect.any(AbortSignal),
  ]);
});

it("生成開始後に下書き競合が確定したら処理を中止し遅延成功でも attempt を更新しない", async () => {
  const user = userEvent.setup();
  const deferredGeneration = createDeferred<undefined>();
  const startGeneration = vi.fn(
    (draftArg: PlannerDraft, attemptArg: PlannerAttempt, signalArg: AbortSignal) => {
      void draftArg;
      void attemptArg;
      void signalArg;
      return deferredGeneration.promise;
    },
  );
  render(<PlannerPage startGeneration={startGeneration} />);
  const firstKey = screen.getByLabelText("attempt key").textContent;
  await user.click(screen.getByRole("button", { name: "確認を反映" }));

  await user.click(screen.getByRole("button", { name: "生成" }));
  await vi.waitFor(() => {
    expect(startGeneration).toHaveBeenCalledTimes(1);
  });
  const signal = startGeneration.mock.calls[0]?.[2];

  const latestAutosave = autosaveInputs.at(-1) as {
    onConflict(): Promise<void>;
  };
  await act(async () => latestAutosave.onConflict());

  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(true);

  await act(async () => {
    deferredGeneration.resolve(undefined);
    await deferredGeneration.promise;
  });

  expect(screen.getByLabelText("attempt key")).toHaveTextContent(firstKey);
  expect(screen.getByLabelText("check count")).toHaveTextContent("1");
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

it("AI情報未確認では wizard へ hasAcceptedOrDeclinedPrivacy=false を渡す", () => {
  queryState.privacyConsent = null;
  render(<PlannerPage />);
  expect(screen.getByLabelText("privacy accepted or declined")).toHaveTextContent("false");
});

it("privacy notice への遷移操作は review resume 付きの returnTo を組み立てる", async () => {
  const user = userEvent.setup();
  render(<PlannerPage />);
  await user.click(screen.getByRole("button", { name: "privacy notice" }));
  expect(navigateMock).toHaveBeenCalledWith("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
});

describe("PlannerRoutePage", () => {
  it("献立を作る操作から復旧フックへ new_menu の保留コマンドを渡し完了後に作成状況画面へ移動する", async () => {
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;

    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(generationRecoveryMock.startGeneration).toHaveBeenCalledTimes(1);
    });
    const pending = generationRecoveryMock.startGeneration.mock.calls[0]?.[0] as {
      ownerUserId: string;
      kind: string;
      request: Record<string, unknown>;
    };
    expect(pending).toMatchObject({
      ownerUserId: draft.userId,
      commandVersion: "generation-command.v2",
      kind: "new_menu",
      request: {
        idempotencyKey: attemptKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-11.v1",
        expiredPantryConfirmations: [
          {
            pantryItemId: "74000000-0000-4000-8000-000000000001",
            checkedAt: "2026-07-11T03:00:00.000Z",
          },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation");
    });
  });

  it("復旧フックの startGeneration が拒否したら作成状況画面へ移動しない", async () => {
    generationRecoveryMock.startGeneration.mockRejectedValueOnce(new Error("生成操作が進行中です"));
    const user = userEvent.setup();
    render(<PlannerRoutePage />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(generationRecoveryMock.startGeneration).toHaveBeenCalledTimes(1);
    });
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
  });
});
