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
const setOnboardingStatusMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const autosaveInputs = vi.hoisted(() => [] as unknown[]);
const navigateMock = vi.hoisted(() => vi.fn());
const setQueryDataMock = vi.hoisted(() => vi.fn());
const getQueryDataMock = vi.hoisted(() => vi.fn());
const cancelQueriesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const invalidateQueriesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: queryState.userId } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return { ...original, useNavigate: () => navigateMock };
});
vi.mock("@/features/household/household-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/household/household-api")>();
  return { ...original, setOnboardingStatus: setOnboardingStatusMock };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    cancelQueries: cancelQueriesMock,
    getQueryData: getQueryDataMock,
    setQueryData: setQueryDataMock,
    invalidateQueries: invalidateQueriesMock,
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
  /** idea audience 確定時に route が await する。成功時のみ resolve、失敗は throw */
  onIdeaAudienceConfirmed?: () => Promise<void>;
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
        {props.error !== null && props.error !== "" ? <p role="alert">{props.error}</p> : null}
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
        <button
          type="button"
          onClick={() => {
            // 実 wizard と同じ: idea 確定は await 成功後だけ review へ進む（fire-and-forget 禁止）
            void (async () => {
              if (props.onIdeaAudienceConfirmed !== undefined) {
                try {
                  await props.onIdeaAudienceConfirmed();
                } catch {
                  return;
                }
              }
              props.onStepChange("review");
            })();
          }}
        >
          audience idea を確定
        </button>
        <button
          type="button"
          onClick={() => {
            props.onStepChange("review");
          }}
        >
          review へ進む
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
  setOnboardingStatusMock.mockResolvedValue(undefined);
  // not_started|in_progress のときだけ skipped へ進める前提を再現する
  getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
  generationRecoveryMock.startGeneration.mockReset();
  generationRecoveryMock.startGeneration.mockResolvedValue(undefined);
});

describe("idea audience 確定時の onboarding skipped 契約", () => {
  function goToAudienceStep(): void {
    const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
    act(() => {
      props.onStepChange("audience");
    });
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
  }

  it("writes skipped when audience advances with idea and profile is not_started", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
    render(<PlannerPage />);
    goToAudienceStep();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        draft.userId,
        "skipped",
      );
    });
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
    expect(invalidateQueriesMock).toHaveBeenCalled();
    expect(generationRecoveryMock.startGeneration).not.toHaveBeenCalled();
  });

  it("writes skipped when profile is in_progress", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "in_progress" });
    render(<PlannerPage />);
    goToAudienceStep();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        draft.userId,
        "skipped",
      );
    });
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
  });

  it("does not write when profile is complete", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "complete" });
    render(<PlannerPage />);
    goToAudienceStep();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
  });

  it("does not write when profile is already skipped", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "skipped" });
    render(<PlannerPage />);
    goToAudienceStep();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
  });

  it("does not write and stays on audience when profile cache is missing", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue(undefined);
    render(<PlannerPage />);
    goToAudienceStep();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "家族設定の状態を確認できませんでした。再読み込みしてください。",
    );
  });

  it("does not write and shows alert when profile query failed", async () => {
    // 取得失敗後は cache が無いか不正のため blocked と同じく書込せず audience に留める
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue(undefined);
    render(<PlannerPage />);
    goToAudienceStep();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "家族設定の状態を確認できませんでした。再読み込みしてください。",
      );
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
  });

  it("stays on audience and shows alert when setOnboardingStatus RPC fails", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockRejectedValue(new Error("rpc failed"));
    render(<PlannerPage />);
    goToAudienceStep();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "開始状態を保存できませんでした。もう一度お試しください",
      );
    });
    expect(setOnboardingStatusMock).toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
  });

  it("does not write skipped on planner mount only", async () => {
    getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
    render(<PlannerPage />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  it("does not call setOnboardingStatus from review generate submit", async () => {
    const user = userEvent.setup();
    // idea 下書きで review から生成しても skipped は audience 確定時の単一路だけ
    queryState.draft = {
      ...draft,
      targetMode: "idea",
      targetMemberIds: [],
      servings: 2,
    };
    getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
    const startGeneration = vi.fn().mockResolvedValue(undefined);
    render(<PlannerPage startGeneration={startGeneration} />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(startGeneration).toHaveBeenCalled();
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
  });

  it("household のまま review に進んでも onboarding を skipped にしない", async () => {
    const user = userEvent.setup();
    render(<PlannerPage />);
    expect((wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps).draft.targetMode).toBe(
      "household",
    );
    await user.click(screen.getByRole("button", { name: "review へ進む" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
  });
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
