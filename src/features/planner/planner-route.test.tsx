import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import type { PantryItem } from "@shared/contracts/pantry";
import type { PlannerAttempt } from "./expired-pantry-checks";

// P6 は JST 当日 confirmation のみ有効。固定過去日だと submit 再検証で落ちる
const TEST_CHECKED_AT = new Date().toISOString();
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
  ingredientPreference: null,
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
  /** P7: init 後 draft 背景 refetch 失敗を再現 */
  draftIsError: false,
  pantry: {
    data: undefined as PantryItem[] | undefined,
    isError: false,
    isPending: false,
  },
  /** P1/P4: safety の eligible と soft error を制御 */
  safetyEligibleMemberIds: ["70000000-0000-4000-8000-000000000001"] as string[],
  safetyIsError: false,
  ownerBPending: false,
  privacyConsent: null as { user_id: string; notice_version: string } | null,
  privacyIsError: false,
  /** useSearchParams の mock 用。例: "resume=review" */
  search: "",
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
const getProfileMock = vi.hoisted(() => vi.fn());
const autosaveInputs = vi.hoisted(() => [] as unknown[]);
/** P1/P3/P2: flush が Incomplete / 通信失敗 / revision conflict を投げる経路を再現する */
const autosaveFlushMode = vi.hoisted(
  (): {
    mode: "save" | "incomplete" | "network_error" | "conflict";
  } => ({
    mode: "save",
  }),
);
/** P4: autosave UI state。saving 中でも privacy/settings/emergency が join できることを固定 */
const autosaveUiState = vi.hoisted((): { state: "idle" | "saving" | "saved" | "error" } => ({
  state: "saved",
}));
const navigateMock = vi.hoisted(() => vi.fn());
const setQueryDataMock = vi.hoisted(() => vi.fn());
// ensureQueryData 実装が cached を any にせず unknown として扱えるよう戻り値を明示する
const getQueryDataMock = vi.hoisted(() => vi.fn<(queryKey: readonly unknown[]) => unknown>());
const ensureQueryDataMock = vi.hoisted(() =>
  vi.fn(async (options: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }) => {
    const cached: unknown = getQueryDataMock(options.queryKey);
    if (cached !== undefined) return cached;
    return options.queryFn();
  }),
);
const cancelQueriesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const invalidateQueriesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
/** P4: 緊急 post-flush の list 再読を観測する */
const listPantryItemsMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(queryState.pantry.data ?? [])),
);

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: queryState.userId } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return {
    ...original,
    useNavigate: () => navigateMock,
    // Router 未 wrap の unit でも resume query を読めるようにする
    useSearchParams: () => [new URLSearchParams(queryState.search), vi.fn()],
    // FlyerWeeklyPanel の Free CTA が Link を使うため、Router 無しでも描画できるよう差し替え
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string;
      children?: React.ReactNode;
      className?: string;
      style?: React.CSSProperties;
      onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    }) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children}
      </a>
    ),
  };
});
vi.mock("@/features/household/household-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/household/household-api")>();
  return {
    ...original,
    setOnboardingStatus: setOnboardingStatusMock,
    getProfile: getProfileMock,
  };
});
// P3/P4: sticky pending / 緊急 post-flush 前の listPantryItems 再読は queryState.pantry を正とする
vi.mock("@/features/pantry/pantry-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/pantry/pantry-api")>();
  return {
    ...original,
    listPantryItems: listPantryItemsMock,
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    cancelQueries: cancelQueriesMock,
    getQueryData: getQueryDataMock,
    setQueryData: setQueryDataMock,
    ensureQueryData: ensureQueryDataMock,
    invalidateQueries: invalidateQueriesMock,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    // usage-today は成功残数表示のみ。生成開始とは独立して常に loaded を返す。
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
    if (queryKey[0] === "privacy") {
      return {
        data: queryState.privacyIsError ? undefined : queryState.privacyConsent,
        isError: queryState.privacyIsError,
        isPending: false,
        refetch: vi.fn(),
      };
    }
    // ホーム直近献立。空配列で十分（route の表示分岐検証は home 単体に任せる）。
    if (queryKey[0] === "history") {
      return {
        data: [],
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      };
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
          isError: queryState.draftIsError,
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
              : // soft error でも previous data を保持（実 TanStack Query と同型）
                {
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
                  eligibleMemberIds: queryState.safetyEligibleMemberIds,
                },
            isError: queryState.safetyIsError,
            isPending: isOwnerBPending,
            refetch: vi.fn(),
          };
  },
}));
vi.mock("./planner-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./planner-api")>();
  return { ...original, savePlannerDraft: savePlannerDraftMock };
});
vi.mock("./use-draft-autosave", async (importOriginal) => {
  const original = await importOriginal<typeof import("./use-draft-autosave")>();
  const { DraftRevisionConflictError } = await import("./planner-api");
  return {
    ...original,
    useDraftAutosave: (input: {
      value: PlannerDraftInput;
      baselineRevision: number;
      save(value: PlannerDraftInput, revision: number): Promise<PlannerDraft>;
    }) => {
      autosaveInputs.push(input);
      return {
        state: autosaveUiState.state,
        revision: 3,
        flush: vi.fn(() => {
          // P1/P3: Incomplete は RPC 前の意図的拒否。通信失敗とは別経路。
          if (autosaveFlushMode.mode === "incomplete") {
            return Promise.reject(new original.IncompleteDraftSaveError());
          }
          if (autosaveFlushMode.mode === "network_error") {
            return Promise.reject(new Error("network"));
          }
          // P2: 実 autosave は onConflict 後に DraftRevisionConflictError を再 throw
          if (autosaveFlushMode.mode === "conflict") {
            return Promise.reject(new DraftRevisionConflictError());
          }
          return input.save(input.value, input.baselineRevision);
        }),
      };
    },
  };
});

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
  privacyConsentLoadFailed?: boolean;
  onRetryPrivacyConsent?: () => void;
  onOpenPrivacyNotice(): void;
  hasDraftConflict?: boolean;
  draftConflictRefetchError?: boolean;
  canResolveDraftConflict?: boolean;
  onResolveDraftConflict?: () => void;
  onRetryDraftConflict?: () => void;
  onOpenEmergencyMenus?: () => void;
  /** 入力内容を空に戻し step を meal へ戻す。route が draft / autosave を所有する */
  onReset?: () => void;
  /** P2: 進行中 pending があるとき true（確認画面の再開注意用） */
  hasResumablePendingGeneration?: boolean;
  /** P4: soft safety/pantry 失敗中は主 CTA を止める */
  blockGenerationForStaleSafety?: boolean;
  onOpenSettings?: () => void;
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
        <output aria-label="has resumable pending">
          {String(props.hasResumablePendingGeneration ?? false)}
        </output>
        <output aria-label="block generation stale">
          {String(props.blockGenerationForStaleSafety ?? false)}
        </output>
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
        <output aria-label="privacy consent load failed">
          {String(props.privacyConsentLoadFailed ?? false)}
        </output>
        <output aria-label="has draft conflict">{String(props.hasDraftConflict ?? false)}</output>
        <button
          type="button"
          onClick={() => {
            // 実 UI 同様: 期限確認は選択中 pantry と対になる（P1 exact-set）
            props.onDraftChange({
              ...props.draft,
              pantrySelections: [
                {
                  pantryItemId: "74000000-0000-4000-8000-000000000001",
                  priority: "prefer_use",
                },
              ],
            });
            props.onAttemptChange({
              idempotencyKey: props.attempt.idempotencyKey,
              qualityMode: false,
              expiredPantryChecks: [
                {
                  pantryItemId: "74000000-0000-4000-8000-000000000001",
                  checkedAt: TEST_CHECKED_AT,
                },
              ],
            });
          }}
        >
          確認を反映
        </button>
        <button
          type="button"
          onClick={() => {
            // P1: 確認後に選択解除しても attempt に check が残る状況を模す
            props.onDraftChange({ ...props.draft, pantrySelections: [] });
            props.onAttemptChange({
              idempotencyKey: props.attempt.idempotencyKey,
              qualityMode: false,
              expiredPantryChecks: [
                {
                  pantryItemId: "74000000-0000-4000-8000-000000000001",
                  checkedAt: TEST_CHECKED_AT,
                },
              ],
            });
          }}
        >
          確認後に選択解除
        </button>
        <button
          type="button"
          onClick={() => {
            // P3: Free でも attempt.qualityMode true を載せる（onSubmit / startGeneration の clamp 検証用）
            props.onDraftChange({
              ...props.draft,
              pantrySelections: [
                {
                  pantryItemId: "74000000-0000-4000-8000-000000000001",
                  priority: "prefer_use",
                },
              ],
            });
            props.onAttemptChange({
              idempotencyKey: props.attempt.idempotencyKey,
              qualityMode: true,
              expiredPantryChecks: [
                {
                  pantryItemId: "74000000-0000-4000-8000-000000000001",
                  checkedAt: TEST_CHECKED_AT,
                },
              ],
            });
          }}
        >
          品質モードONで確認
        </button>
        <button
          type="button"
          disabled={props.isSaving || props.blockGenerationForStaleSafety === true}
          onClick={() => void props.onSubmit().catch(() => undefined)}
        >
          生成
        </button>
        <button
          type="button"
          onClick={() => {
            props.onReset?.();
          }}
        >
          入力をリセット
        </button>
        <button
          type="button"
          disabled={props.isSaving}
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
            props.onOpenSettings?.();
          }}
        >
          家族設定
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
            // 実 wizard と同じ: idea のときだけ confirm を await し、成功後だけ review へ進む
            void (async () => {
              if (
                props.draft.targetMode === "idea" &&
                props.onIdeaAudienceConfirmed !== undefined
              ) {
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
            // household など idea 以外は confirm を呼ばず step だけ進める
            props.onStepChange("review");
          }}
        >
          review へ進む
        </button>
      </div>
    );
  },
}));

const pendingGenerationMock = vi.hoisted(() => ({
  createPendingGeneration: vi.fn(),
  savePendingGeneration: vi.fn(),
  readPendingGeneration: vi.fn(),
  clearPendingGeneration: vi.fn(),
  savePendingGenerationMeta: vi.fn(),
}));
// G-R1: pending 再開判定で status GET する。既定 reject → keep → resume（hung 回避）
const getGenerationStatusMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/generation/api/generation-api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/api/generation-api")>();
  return {
    ...original,
    getGenerationStatus: getGenerationStatusMock,
  };
});
vi.mock("@/features/generation/model/pending-generation", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/model/pending-generation")>();
  return {
    ...original,
    createPendingGeneration: pendingGenerationMock.createPendingGeneration,
    savePendingGeneration: pendingGenerationMock.savePendingGeneration,
    readPendingGeneration: pendingGenerationMock.readPendingGeneration,
    clearPendingGeneration: pendingGenerationMock.clearPendingGeneration,
  };
});
vi.mock("@/features/generation/model/pending-generation-meta", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/model/pending-generation-meta")>();
  return {
    ...original,
    savePendingGenerationMeta: pendingGenerationMock.savePendingGenerationMeta,
  };
});

import { PlannerPage, PlannerRoutePage } from "./planner-route";
import {
  registerPlannerLeaveFlush,
  resetPlannerLeaveNavigateFlightForTests,
  runPlannerLeaveFlush,
} from "./planner-leave-flush";

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
  // P1/P2: 前テストの leave flight / register が次へ漏れないよう解除
  registerPlannerLeaveFlush(null);
  resetPlannerLeaveNavigateFlightForTests();
  autosaveInputs.length = 0;
  autosaveFlushMode.mode = "save";
  autosaveUiState.state = "saved";
  listPantryItemsMock.mockImplementation(() => Promise.resolve(queryState.pantry.data ?? []));
  queryState.userId = draft.userId;
  queryState.draft = draft;
  queryState.draftIsError = false;
  queryState.ownerBPending = false;
  queryState.pantry = {
    data: [pantryItem],
    isError: false,
    isPending: false,
  };
  queryState.safetyEligibleMemberIds = [...draft.targetMemberIds];
  queryState.safetyIsError = false;
  queryState.privacyConsent = { user_id: draft.userId, notice_version: "2026-07-29.v1" };
  queryState.privacyIsError = false;
  queryState.search = "";
  // flush 後の saved にクライアント入力（pantrySelections 等）を残す（P1 exact-set 検証用）
  savePlannerDraftMock.mockImplementation(
    (_client: unknown, _userId: string, next: PlannerDraftInput, revision: number) =>
      Promise.resolve({
        ...draft,
        ...next,
        id: draft.id,
        userId: draft.userId,
        revision: revision > 0 ? revision : draft.revision,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      }),
  );
  setOnboardingStatusMock.mockResolvedValue(undefined);
  getProfileMock.mockReset();
  getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
  // not_started|in_progress のときだけ skipped へ進める前提を再現する
  getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
  ensureQueryDataMock.mockImplementation(
    async (options: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }) => {
      const cached: unknown = getQueryDataMock(options.queryKey);
      if (cached !== undefined) return cached;
      return options.queryFn();
    },
  );
  pendingGenerationMock.createPendingGeneration.mockReset();
  pendingGenerationMock.savePendingGeneration.mockReset();
  pendingGenerationMock.readPendingGeneration.mockReset();
  pendingGenerationMock.clearPendingGeneration.mockReset();
  pendingGenerationMock.savePendingGenerationMeta.mockReset();
  getGenerationStatusMock.mockReset();
  // status 不明は keep→resume（G-R1 / G1）。進行中 fixture は各テストで上書き。
  getGenerationStatusMock.mockRejectedValue(new Error("status_not_stubbed"));
  pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
  pendingGenerationMock.createPendingGeneration.mockImplementation(
    (command: unknown, ownerUserId: string) => ({
      ownerUserId,
      createdAt: "2026-07-11T00:00:00.000Z",
      ...(command as object),
    }),
  );
});

describe("idea audience 確定時の onboarding skipped 契約", () => {
  const ideaDraft = {
    ...draft,
    targetMode: "idea" as const,
    targetMemberIds: [] as string[],
    servings: 2,
  };

  function goToAudienceStepWithIdeaDraft(): void {
    const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
    // 実 wizard と同様: mode を idea に確定してから confirm ボタンを押す
    act(() => {
      props.onDraftChange(ideaDraft);
    });
    act(() => {
      const latest = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
      latest.onStepChange("audience");
    });
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
    expect((wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps).draft.targetMode).toBe(
      "idea",
    );
  }

  it("writes skipped when audience advances with idea and profile is not_started", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
    render(<PlannerPage />);
    goToAudienceStepWithIdeaDraft();

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
    // audience 確定だけでは生成 pending を書かない
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  });

  it("writes skipped when profile is in_progress", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "in_progress" });
    render(<PlannerPage />);
    goToAudienceStepWithIdeaDraft();

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
    goToAudienceStepWithIdeaDraft();

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
    goToAudienceStepWithIdeaDraft();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
  });

  it("fetches profile and writes skipped when cache is missing", async () => {
    const user = userEvent.setup();
    // /planner 直開き等で cache が無い場合は getProfile で権威取得する
    getQueryDataMock.mockReturnValue(undefined);
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    render(<PlannerPage />);
    goToAudienceStepWithIdeaDraft();

    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));

    await vi.waitFor(() => {
      expect(getProfileMock).toHaveBeenCalled();
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        draft.userId,
        "skipped",
      );
    });
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
  });

  it("stays on audience when profile fetch fails", async () => {
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue(undefined);
    getProfileMock.mockRejectedValue(new Error("network"));
    render(<PlannerPage />);
    goToAudienceStepWithIdeaDraft();

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
    goToAudienceStepWithIdeaDraft();

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

  it("writes skipped on review generate submit when idea draft resumes without audience", async () => {
    const user = userEvent.setup();
    // 完全な idea 下書きは firstIncomplete で review に着く。audience を踏まない経路の安全網。
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
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        draft.userId,
        "skipped",
      );
      expect(startGeneration).toHaveBeenCalled();
    });
  });

  it("does not generate when idea resume submit cannot load profile", async () => {
    const user = userEvent.setup();
    queryState.draft = {
      ...draft,
      targetMode: "idea",
      targetMemberIds: [],
      servings: 2,
    };
    getQueryDataMock.mockReturnValue(undefined);
    getProfileMock.mockRejectedValue(new Error("network"));
    const startGeneration = vi.fn().mockResolvedValue(undefined);
    render(<PlannerPage startGeneration={startGeneration} />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "家族設定の状態を確認できませんでした。再読み込みしてください。",
      );
    });
    expect(startGeneration).not.toHaveBeenCalled();
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
  });

  it("does not rewrite skipped on idea generate when profile is already complete", async () => {
    const user = userEvent.setup();
    queryState.draft = {
      ...draft,
      targetMode: "idea",
      targetMemberIds: [],
      servings: 2,
    };
    getQueryDataMock.mockReturnValue({ onboarding_status: "complete" });
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

  it("household draft のまま audience idea ボタンを押しても confirm しない", async () => {
    // mock が draft.targetMode を無視すると偽グリーンになるため、mode ゲートを固定する
    const user = userEvent.setup();
    getQueryDataMock.mockReturnValue({ onboarding_status: "not_started" });
    render(<PlannerPage />);
    const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
    expect(props.draft.targetMode).toBe("household");
    act(() => {
      props.onStepChange("audience");
    });
    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
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

it("P3: init 後の pantry 背景 refetch 失敗では wizard を破棄しない", () => {
  // 初回は data ありで初期化。その後 isError でも previous data があれば soft error。
  queryState.pantry = { data: [pantryItem], isError: false, isPending: false };
  const view = render(<PlannerPage />);
  expect(screen.getByLabelText("pantry status")).toHaveTextContent("loaded");

  queryState.pantry = { data: [pantryItem], isError: true, isPending: false };
  view.rerender(<PlannerPage />);

  // soft banner と wizard の status 系 output が同居するため role 単独は使わない
  expect(
    screen.getByText(
      "家族または冷蔵庫の最新情報を再取得できませんでした。表示は直前の内容です。最新を取得してから献立を作ってください。",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  // P4: soft 中は主 CTA をゲート（blockGenerationForStaleSafety）
  expect(screen.getByLabelText("block generation stale")).toHaveTextContent("true");
  // wizard は残る（全画面 error で破棄しない）
  expect(screen.getByLabelText("pantry status")).toHaveTextContent("loaded");
  expect(
    screen.queryByText("献立条件を読み込めませんでした。再読み込みしてください。"),
  ).not.toBeInTheDocument();
});

it("P4: soft safety/pantry 中の生成は onSubmit で止め startGeneration しない", async () => {
  queryState.pantry = { data: [pantryItem], isError: false, isPending: false };
  const startGeneration = vi.fn();
  const view = render(<PlannerPage startGeneration={startGeneration} />);
  queryState.pantry = { data: [pantryItem], isError: true, isPending: false };
  view.rerender(<PlannerPage startGeneration={startGeneration} />);

  // disabled でも mock 経路の直接 onSubmit を検証するため props 経由で呼ぶ
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();

  expect(startGeneration).not.toHaveBeenCalled();
  // soft banner は role=status。hard alert ではなく blockGenerationForStaleSafety でゲートする。
  expect(screen.getByLabelText("block generation stale")).toHaveTextContent("true");
  expect(
    screen.getByText(
      "家族または冷蔵庫の最新情報を再取得できませんでした。表示は直前の内容です。最新を取得してから献立を作ってください。",
    ),
  ).toBeInTheDocument();
});

it("P7: init 後の draft 背景 refetch 失敗は soft banner を出す", () => {
  queryState.draft = draft;
  queryState.draftIsError = false;
  const view = render(<PlannerPage />);
  expect(screen.getByLabelText("wizard step")).toBeInTheDocument();

  queryState.draftIsError = true;
  view.rerender(<PlannerPage />);

  expect(
    screen.getByText("下書きの最新情報を再取得できませんでした。表示は直前の内容です。"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  // draft soft だけでは生成ブロックしない（safety/pantry の stale ゲートと分離）
  expect(screen.getByLabelText("block generation stale")).toHaveTextContent("false");
  expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
});

it("P1: flush 中に eligibility strip すると startGeneration しない", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  const startGeneration = vi.fn();
  const user = userEvent.setup();
  const view = render(<PlannerPage startGeneration={startGeneration} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "生成" }));
  // flush 待機中
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");

  // safety が選択家族を ineligible に → strip
  queryState.safetyEligibleMemberIds = [];
  view.rerender(<PlannerPage startGeneration={startGeneration} />);

  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "作る相手の条件が変わったため、対象の選び直しが必要です。家族を確認してください。",
  );

  // 遅延 flush を完了させても生成は走らない
  deferred.resolve({
    ...draft,
    pantrySelections: [
      {
        pantryItemId: "74000000-0000-4000-8000-000000000001",
        priority: "prefer_use",
      },
    ],
    revision: 4,
  });
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
  });
  expect(startGeneration).not.toHaveBeenCalled();
});

it("P3: flush 中に pantry が消えると post-flush 再検証で startGeneration しない", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  const startGeneration = vi.fn();
  const user = userEvent.setup();
  const view = render(<PlannerPage startGeneration={startGeneration} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "生成" }));
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");

  // flush 中に選択 ID が pantry から消える（削除 TOCTOU）
  queryState.pantry = { data: [], isError: false, isPending: false };
  view.rerender(<PlannerPage startGeneration={startGeneration} />);
  // pantryRowsRef を effect で同期してから flush を進める
  await vi.waitFor(() => {
    expect(screen.getByLabelText("pantry names")).toHaveTextContent("");
  });

  deferred.resolve({
    ...draft,
    pantrySelections: [
      {
        pantryItemId: "74000000-0000-4000-8000-000000000001",
        priority: "prefer_use",
      },
    ],
    revision: 4,
  });

  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "冷蔵庫から削除された食材の選択を解除してから献立を作ってください。",
    );
  });
  expect(startGeneration).not.toHaveBeenCalled();
  expect(screen.getByLabelText("wizard step")).toHaveTextContent("review");
});

it("P6: 生成 submit 中は settings をガードし navigate しない", async () => {
  const user = userEvent.setup();
  // isSubmitting 中ガード: 遅延 flush の生成中に settings を呼ぶ
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "生成" }));
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
  });

  // isSaving で disabled。props 直呼びでガードを検証
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  props.onOpenSettings?.();
  expect(navigateMock).not.toHaveBeenCalledWith("/settings");

  deferred.resolve({ ...draft, revision: 4 });
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
  });
});

it("P1: 生成 submit 中は emergency をガードし navigate / 二重 flush しない", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  const startGeneration = vi.fn().mockResolvedValue(true);
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={startGeneration} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "生成" }));
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
  });

  // isSaving で disabled。props 直呼びで submittingRef ガードを検証
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  props.onOpenEmergencyMenus?.();
  expect(navigateMock).not.toHaveBeenCalledWith("/emergency-menus");
  // 生成の flush 1 回のみ（緊急が第二 flight を起こさない）
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);

  deferred.resolve({ ...draft, revision: 4 });
  await vi.waitFor(() => {
    expect(startGeneration).toHaveBeenCalled();
  });
  expect(navigateMock).not.toHaveBeenCalledWith("/emergency-menus");
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
});

it("P1: emergency open 中は generate をガードし startGeneration / sticky pending しない", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  const startGeneration = vi.fn().mockResolvedValue(true);
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={startGeneration} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
  });

  // emergencyOpeningRef で onSubmit を同期抑止（mock は disabled でも props 直呼び）
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();
  expect(startGeneration).not.toHaveBeenCalled();
  expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);

  deferred.resolve({ ...draft, revision: 4 });
  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/emergency-menus");
  });
  expect(startGeneration).not.toHaveBeenCalled();
  expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
});

it("P3: emergency flush 中に pantry が消えると post-flush 再検証で navigate せず PE8 session も書かない", async () => {
  sessionStorage.clear();
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  const user = userEvent.setup();
  const view = render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
  // PE8: post-flush 通過前（flush 中）は session に載せない
  expect(sessionStorage.getItem(`kondate:expired-pantry-confirm:v1:${draft.userId}`)).toBeNull();

  // flush 中に選択 ID が pantry から消える（削除 TOCTOU）。
  // list 再読 mock も空を返し、post-flush ゲートが削除を検知する。
  queryState.pantry = { data: [], isError: false, isPending: false };
  listPantryItemsMock.mockResolvedValue([]);
  view.rerender(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("pantry names")).toHaveTextContent("");
  });

  deferred.resolve({
    ...draft,
    pantrySelections: [
      {
        pantryItemId: "74000000-0000-4000-8000-000000000001",
        priority: "prefer_use",
      },
    ],
    revision: 4,
  });

  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "冷蔵庫から削除された食材の選択を解除してから緊急献立を開いてください。",
    );
  });
  expect(navigateMock).not.toHaveBeenCalledWith("/emergency-menus");
  // post-flush 失敗経路でも PE8 session を残さない
  expect(sessionStorage.getItem(`kondate:expired-pantry-confirm:v1:${draft.userId}`)).toBeNull();
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
});

it("P1: leave flush の IncompleteDraft は proceed（通信失敗で封鎖しない）", async () => {
  autosaveFlushMode.mode = "incomplete";
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("P1: leave flush の通信失敗は blocked + 通信文言", async () => {
  autosaveFlushMode.mode = "network_error";
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  await expect(runPlannerLeaveFlush()).resolves.toBe("blocked");
  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "条件を保存できなかったため、移動できませんでした。通信を確認して再度お試しください。",
    );
  });
});

it("P1: home 面でも leave flush 通信失敗を role=alert で表示する", async () => {
  // 空下書き + pending なし → ホーム着地（wizard の error スロットに依存しない）
  queryState.draft = null;
  pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
  autosaveFlushMode.mode = "network_error";
  render(<PlannerRoutePage />);
  await vi.waitFor(() => {
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeInTheDocument();
  });

  await expect(runPlannerLeaveFlush()).resolves.toBe("blocked");
  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "条件を保存できなかったため、移動できませんでした。通信を確認して再度お試しください。",
    );
  });
});

it("P2: leave flush の DraftRevisionConflictError は通信文言を立てない", async () => {
  autosaveFlushMode.mode = "conflict";
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  await expect(runPlannerLeaveFlush()).resolves.toBe("blocked");
  expect(
    screen.queryByText(
      "条件を保存できなかったため、移動できませんでした。通信を確認して再度お試しください。",
    ),
  ).toBeNull();
});

it("P1: leave flush 中は generate をガードし startGeneration / 二重 flush しない", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  const startGeneration = vi.fn().mockResolvedValue(true);
  render(<PlannerPage startGeneration={startGeneration} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  const leavePromise = runPlannerLeaveFlush();
  await vi.waitFor(() => {
    expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  });

  // leaveInFlightRef で onSubmit を同期抑止（mock は disabled でも props 直呼び）
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();
  expect(startGeneration).not.toHaveBeenCalled();
  expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);

  deferred.resolve({ ...draft, revision: 4 });
  await expect(leavePromise).resolves.toBe("proceed");
  expect(startGeneration).not.toHaveBeenCalled();
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
});

it("P1: leave flush 中は emergency / settings をガードする", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  const leavePromise = runPlannerLeaveFlush();
  await vi.waitFor(() => {
    expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  });

  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  props.onOpenEmergencyMenus?.();
  props.onOpenSettings?.();
  expect(navigateMock).not.toHaveBeenCalledWith("/emergency-menus");
  expect(navigateMock).not.toHaveBeenCalledWith("/settings");
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);

  deferred.resolve({ ...draft, revision: 4 });
  await expect(leavePromise).resolves.toBe("proceed");
  expect(navigateMock).not.toHaveBeenCalledWith("/emergency-menus");
  expect(navigateMock).not.toHaveBeenCalledWith("/settings");
});

it("P3: 生成 flush の DraftRevisionConflictError は汎用保存失敗文言を立てない", async () => {
  autosaveFlushMode.mode = "conflict";
  const startGeneration = vi.fn().mockResolvedValue(true);
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={startGeneration} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "生成" }));

  await vi.waitFor(() => {
    expect(startGeneration).not.toHaveBeenCalled();
  });
  expect(
    screen.queryByText("献立条件を保存できなかったため、生成を開始しませんでした。"),
  ).toBeNull();
  // Incomplete 専用文言も出さない（conflict は chrome 一本化）
  expect(
    screen.queryByText(
      "人数など必要な条件が未設定のため、生成を開始しませんでした。確認画面で内容を見直してください。",
    ),
  ).toBeNull();
});

it("P7: soft safety/pantry 中は緊急 open を止める", async () => {
  queryState.pantry = { data: [pantryItem], isError: false, isPending: false };
  const view = render(<PlannerPage startGeneration={vi.fn()} />);
  queryState.pantry = { data: [pantryItem], isError: true, isPending: false };
  view.rerender(<PlannerPage startGeneration={vi.fn()} />);

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));

  expect(navigateMock).not.toHaveBeenCalledWith("/emergency-menus");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "家族または冷蔵庫の最新情報を再取得してから緊急献立を開いてください。",
  );
});

it("P4: autosave saving 中でも settings は flush join で /settings へ進む", async () => {
  // 旧実装は state===saving で無言 early-return。leave と同型の join を固定する。
  autosaveUiState.state = "saving";
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "家族設定" }));
  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/settings");
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("P4: autosave saving 中でも privacy は flush join で進む", async () => {
  autosaveUiState.state = "saving";
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "privacy notice" }));
  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
  });
});

it("P4: autosave saving 中は isSaving を true にしない（無言 disable しない）", async () => {
  autosaveUiState.state = "saving";
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
});

it("P3: openSettings の IncompleteDraft は /settings へ proceed（通信文言で塞がない）", async () => {
  autosaveFlushMode.mode = "incomplete";
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "家族設定" }));
  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/settings");
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("P3: openSettings の通信失敗は /settings 非遷移 + 保存失敗文言", async () => {
  autosaveFlushMode.mode = "network_error";
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "家族設定" }));
  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "条件を保存できなかったため、家族設定を開けませんでした。通信を確認して再度お試しください。",
    );
  });
  expect(navigateMock).not.toHaveBeenCalledWith("/settings");
});

it("P4: emergency open は post-flush で listPantryItems を再読し query cache を更新する", async () => {
  sessionStorage.clear();
  const freshPantry: PantryItem[] = [
    {
      ...pantryItem,
      // 期限切れを解消した最新集合
      expiresOn: "2099-01-01",
    },
  ];
  listPantryItemsMock.mockResolvedValue(freshPantry);
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  listPantryItemsMock.mockClear();
  setQueryDataMock.mockClear();
  await user.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));

  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/emergency-menus");
  });
  expect(listPantryItemsMock).toHaveBeenCalled();
  expect(setQueryDataMock).toHaveBeenCalledWith(["pantry", draft.userId], freshPantry);
});

it("P8: privacy 未同意の生成は委譲完了まで再 generate を受け付けない", async () => {
  queryState.privacyConsent = null;
  const deferred = createDeferred<PlannerDraft>();
  let flushCalls = 0;
  savePlannerDraftMock.mockImplementation(() => {
    flushCalls += 1;
    if (flushCalls === 1) return deferred.promise;
    return Promise.resolve({ ...draft, revision: draft.revision + flushCalls });
  });
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  // 1 回目 generate → privacy 委譲のための flush 待ち
  await user.click(screen.getByRole("button", { name: "生成" }));
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
  });
  // 再押下は submittingRef で弾く（mock は disabled でも props 直呼び）
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();
  // 1 回目 flush のみ（2 回目 onSubmit は early return）
  expect(flushCalls).toBe(1);

  deferred.resolve({ ...draft, revision: 4 });
  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
  });
});

it("選択解除後も attempt に残った confirmation は生成 command から落とす (P1)", async () => {
  const user = userEvent.setup();
  const startGeneration = vi.fn();
  render(<PlannerPage startGeneration={startGeneration} />);
  await user.click(screen.getByRole("button", { name: "確認後に選択解除" }));
  expect(screen.getByLabelText("check count")).toHaveTextContent("1");
  await user.click(screen.getByRole("button", { name: "生成" }));
  await vi.waitFor(() => {
    expect(startGeneration).toHaveBeenCalled();
  });
  const attemptArg = startGeneration.mock.calls[0]?.[1] as PlannerAttempt;
  expect(attemptArg.expiredPantryChecks).toEqual([]);
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
    expect.objectContaining({
      pantrySelections: [
        {
          pantryItemId: "74000000-0000-4000-8000-000000000001",
          priority: "prefer_use",
        },
      ],
    }),
    {
      idempotencyKey: firstKey,
      qualityMode: false,
      expiredPantryChecks: [
        {
          pantryItemId: "74000000-0000-4000-8000-000000000001",
          checkedAt: TEST_CHECKED_AT,
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
      expect(draftArg.pantrySelections).toEqual([
        {
          pantryItemId: "74000000-0000-4000-8000-000000000001",
          priority: "prefer_use",
        },
      ]);
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
  expect(startGeneration.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      pantrySelections: [
        {
          pantryItemId: "74000000-0000-4000-8000-000000000001",
          priority: "prefer_use",
        },
      ],
    }),
  );
  expect(startGeneration.mock.calls[0]?.[1]).toEqual({
    idempotencyKey: firstKey,
    qualityMode: false,
    expiredPantryChecks: [
      {
        pantryItemId: "74000000-0000-4000-8000-000000000001",
        checkedAt: TEST_CHECKED_AT,
      },
    ],
  });
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
  expect(screen.getByLabelText("privacy consent load failed")).toHaveTextContent("false");
});

it("AP5: privacy 読取 isError は未同意に潰さず privacyConsentLoadFailed=true を渡す", () => {
  queryState.privacyConsent = null;
  queryState.privacyIsError = true;
  render(<PlannerPage />);
  expect(screen.getByLabelText("privacy accepted or declined")).toHaveTextContent("false");
  expect(screen.getByLabelText("privacy consent load failed")).toHaveTextContent("true");
});

it("privacy notice への遷移操作は review resume 付きの returnTo を組み立てる", async () => {
  const user = userEvent.setup();
  render(<PlannerPage />);
  await user.click(screen.getByRole("button", { name: "privacy notice" }));
  // flushDraft 完了後に navigate するため waitFor する
  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
  });
});

it("P10: privacy の IncompleteDraft は resume=review へ proceed（通信文言で塞がない）", async () => {
  autosaveFlushMode.mode = "incomplete";
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "privacy notice" }));
  await vi.waitFor(() => {
    expect(navigateMock).toHaveBeenCalledWith("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("P10: privacy の通信失敗は非遷移 + 保存失敗文言", async () => {
  autosaveFlushMode.mode = "network_error";
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "privacy notice" }));
  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "献立条件を保存できなかったため、説明画面へ進めませんでした。",
    );
  });
  expect(navigateMock).not.toHaveBeenCalledWith("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
});

describe("PlannerRoutePage", () => {
  it("献立を作る操作で pending を保存し POST を待たずに作成状況画面へ移動する", async () => {
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;

    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(pendingGenerationMock.savePendingGeneration).toHaveBeenCalledTimes(1);
    });
    const pending = pendingGenerationMock.savePendingGeneration.mock.calls[0]?.[0] as {
      ownerUserId: string;
      kind: string;
      request: Record<string, unknown>;
    };
    expect(pending).toMatchObject({
      ownerUserId: draft.userId,
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: attemptKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [
          {
            pantryItemId: "74000000-0000-4000-8000-000000000001",
            checkedAt: TEST_CHECKED_AT,
          },
        ],
      },
    });
    // new_menu のみ draft.targetMode 付き meta を upsert（補助文判定用）
    expect(pendingGenerationMock.savePendingGenerationMeta).toHaveBeenCalledTimes(1);
    expect(pendingGenerationMock.savePendingGenerationMeta).toHaveBeenCalledWith({
      kind: "new_menu",
      targetMode: draft.targetMode,
      idempotencyKey: attemptKey,
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    // POST 完了を待たず、保存直後に遷移する（再生成経路と同型）
    expect(navigateMock).toHaveBeenCalledWith("/generation");
  });

  it("P3: Free plan では attempt.qualityMode true でも pending に false を載せる", async () => {
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    // usage mock は plan: free。onSubmit + startGeneration の二重 clamp を固定する
    await user.click(screen.getByRole("button", { name: "品質モードONで確認" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(pendingGenerationMock.createPendingGeneration).toHaveBeenCalled();
    });
    const command = pendingGenerationMock.createPendingGeneration.mock.calls[0]?.[0] as {
      qualityMode: boolean;
    };
    expect(command.qualityMode).toBe(false);
    const pending = pendingGenerationMock.savePendingGeneration.mock.calls[0]?.[0] as {
      qualityMode: boolean;
    };
    expect(pending.qualityMode).toBe(false);
  });

  it("生成中断（pending）があるときは下書きが揃っていてもホームを優先し再開 CTA を出す", async () => {
    // 完全回答済み下書きは firstIncomplete === "review" なので、pending を見ないと
    // 常にウィザードへ落ち、HomeGenerateCard の hasResumablePending 分岐に届かない。
    // G-R4: status 不明（既定 reject）→ keep → 再開 UI（G1）
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: { idempotencyKey: "existing" },
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);

    // reconcile（status GET）完了後にホーム再開 CTA
    expect(await screen.findByText(/作成中の献立があります/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成中の献立を続ける" })).toBeInTheDocument();
    // ウィザード（mock の attempt key 等）はまだ出さない
    expect(screen.queryByLabelText("attempt key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "作成中の献立を続ける" }));
    expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    // ホーム再開は pending を触らず generation へ渡す（C2 と同経路）
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
    // G-R4 display reconcile の GET 失敗 keep では clear しない（G1）
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
  });

  it("G-R4: terminal pending ではホームに作成中コピーを出さず下書き進捗なら wizard へ", async () => {
    // サーバ failed 済み sticky: G-R1 clear → 再開専用 UI を出さない（新規作成可と一致）
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: { idempotencyKey: "existing" },
    });
    getGenerationStatusMock.mockResolvedValue({
      status: "failed",
      idempotencyKey: "existing",
      requestId: "50000000-0000-4000-8000-000000000099",
      completedAt: "2026-07-20T05:01:00.000Z",
      error: {
        code: "generation_timeout",
        message: "作成に時間がかかりました。",
        retryable: true,
      },
      quota: {
        consumed: false,
        remaining: 2,
        userDailyLimit: 3,
        limitKind: "user",
        retryAt: null,
      },
    });
    // clear 後は sticky 無しとして扱う（実 storage と同型）
    pendingGenerationMock.clearPendingGeneration.mockImplementation(() => {
      pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
    });
    render(<PlannerRoutePage />);

    // terminal clear 後は完全回答済み下書き → wizard（ホーム「作成中」は出さない）
    expect(await screen.findByLabelText("wizard step")).toHaveTextContent("review");
    expect(screen.queryByText(/作成中の献立があります/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作成中の献立を続ける" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("false");
    expect(pendingGenerationMock.clearPendingGeneration).toHaveBeenCalled();
  });

  it("?resume= 付きは pending があってもウィザードを優先する（不変契約 4b）", async () => {
    queryState.search = "resume=review";
    // G-R4: status 不明 keep → review でも再開注意 true（processing 相当）
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: { idempotencyKey: "existing" },
    });
    render(<PlannerRoutePage />);
    // ホーム再開 CTA は出さず、確認 step の wizard を出す
    expect(await screen.findByLabelText("wizard step")).toHaveTextContent("review");
    expect(screen.queryByRole("button", { name: "作成中の献立を続ける" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("true");
  });

  it("P6: 初期化後に ?resume= が付くと同一インスタンスでもウィザードを開く", () => {
    // 空下書き + pending なし → ホーム着地（initialized 後）
    queryState.draft = null;
    queryState.search = "";
    pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
    const view = render(<PlannerRoutePage />);
    expect(screen.queryByLabelText("wizard step")).not.toBeInTheDocument();

    // 同一 mount のまま search だけ resume 付きへ（SPA 深リンク）
    queryState.search = "resume=review";
    view.rerender(<PlannerRoutePage />);
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
    // 空下書きなので firstIncomplete は meal
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("meal");
  });

  it("既存 pending がある状態でウィザードから生成すると上書きせず再開し attempt を回転しない", async () => {
    // G-R4: GET 失敗 keep → ホーム再開導線。生成押下も再開のみ（新 pending を書かない）
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: { idempotencyKey: "existing" },
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    // pending 優先でホーム着地 → 主 CTA からウィザードへ入る経路を固定する
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    // P2: 確認画面向けに pending 再開注意フラグを渡す（新条件破棄の押下前明示）
    expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("true");
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    expect(screen.getByLabelText("check count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
    expect(pendingGenerationMock.createPendingGeneration).not.toHaveBeenCalled();
    // resume は return false → startNewAttempt しない（期限確認を捨てない）
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);
    expect(screen.getByLabelText("check count")).toHaveTextContent("1");
  });

  it("入力をリセットすると進行中 pending も捨てる", async () => {
    const user = userEvent.setup();
    render(<PlannerPage />);
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(pendingGenerationMock.clearPendingGeneration).toHaveBeenCalledTimes(1);
  });

  it("pending 保存が失敗したら作成状況へ遷移せず attempt を保つ", async () => {
    pendingGenerationMock.savePendingGeneration.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    await user.click(screen.getByRole("button", { name: "確認を反映" }));

    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "献立条件を保存できなかったため、生成を開始しませんでした。",
      );
    });
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);
    expect(screen.getByLabelText("check count")).toHaveTextContent("1");
  });

  it("P2: meta 保存が失敗したら pending を消し遷移しない", async () => {
    // body だけ残る sticky pending を防ぐ（meta QuotaExceeded 等）
    pendingGenerationMock.savePendingGenerationMeta.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "献立条件を保存できなかったため、生成を開始しませんでした。",
      );
    });
    expect(pendingGenerationMock.savePendingGeneration).toHaveBeenCalled();
    expect(pendingGenerationMock.clearPendingGeneration).toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);
    // resume 導線は pending 無し（sticky にならない）
    expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("false");
  });

  it("P2: targetMode 無効の saved では pending を書かず専用文言を出す", async () => {
    // flush 結果だけ targetMode を落とす（strip 後 snapshot を模す）
    savePlannerDraftMock.mockImplementation(
      (_client: unknown, _userId: string, next: PlannerDraftInput, revision: number) =>
        Promise.resolve({
          ...draft,
          ...next,
          targetMode: null,
          targetMemberIds: [],
          id: draft.id,
          userId: draft.userId,
          revision: revision > 0 ? revision : draft.revision,
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
        }),
    );
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "作る相手の条件が変わったため、対象の選び直しが必要です。家族を確認してください。",
      );
    });
    // mode 判定は savePending 前 / onSubmit 再検証。sticky pending を作らない
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
    expect(pendingGenerationMock.savePendingGenerationMeta).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
  });
});

it("P2: startGeneration が target_mode_required のとき pending を消し専用文言を出す", async () => {
  const startGeneration = vi.fn().mockImplementation(() => {
    // 注入経路で throw。route catch が clear + 専用文言に分岐することを固定する
    throw new Error("target_mode_required");
  });
  const user = userEvent.setup();
  render(<PlannerPage startGeneration={startGeneration} />);
  await user.click(screen.getByRole("button", { name: "確認を反映" }));
  await user.click(screen.getByRole("button", { name: "生成" }));

  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "作る相手が未設定のため、生成を開始できません。対象を選び直してください。",
    );
  });
  expect(pendingGenerationMock.clearPendingGeneration).toHaveBeenCalled();
  expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
});
