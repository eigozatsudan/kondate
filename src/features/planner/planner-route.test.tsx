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
const startPlannerDraftKeepaliveSaveMock = vi.hoisted(() => vi.fn());
const setOnboardingStatusMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getProfileMock = vi.hoisted(() => vi.fn());
const autosaveInputs = vi.hoisted(() => [] as unknown[]);
/** P1/P3/P2: flush が Incomplete / 通信失敗 / revision conflict を投げる経路を再現する */
const autosaveFlushMode = vi.hoisted(
  (): {
    mode: "save" | "incomplete" | "network_error" | "conflict" | "lastSaved";
  } => ({
    mode: "save",
  }),
);
/** P4: autosave UI state。saving 中でも privacy/settings/emergency が join できることを固定 */
const autosaveUiState = vi.hoisted((): { state: "idle" | "saving" | "saved" | "error" } => ({
  state: "saved",
}));
const navigateMock = vi.hoisted(() => vi.fn());
/** P5: PlannerRoutePage の POP useBlocker。Router 無し unit が throw しないよう default unblocked。 */
const blockerHarness = vi.hoisted(() => {
  const proceed = vi.fn();
  const reset = vi.fn();
  const location = {
    pathname: "/planner",
    search: "",
    hash: "",
    state: null,
    key: "default",
  };
  type BlockerState = "unblocked" | "blocked" | "proceeding";
  type ShouldBlock = (args: {
    historyAction: "POP" | "PUSH" | "REPLACE";
    currentLocation: { pathname: string };
    nextLocation: { pathname: string };
  }) => boolean;
  // state ごとに安定した identity。rerender で blocked にしたときだけ effect が再走するようにする。
  const snapshots: Record<
    BlockerState,
    { state: BlockerState; proceed: typeof proceed; reset: typeof reset; location: typeof location }
  > = {
    unblocked: { state: "unblocked", proceed, reset, location },
    blocked: { state: "blocked", proceed, reset, location },
    proceeding: { state: "proceeding", proceed, reset, location },
  };
  const harness: {
    state: BlockerState;
    proceed: typeof proceed;
    reset: typeof reset;
    lastShouldBlock: ShouldBlock | undefined;
    current: () => (typeof snapshots)[BlockerState];
    /** react-router 8.3 の blocked→blocked 差し替え（2 回目 Back）を再現する。 */
    replaceBlockedIdentity: () => void;
  } = {
    state: "unblocked",
    proceed,
    reset,
    lastShouldBlock: undefined,
    current() {
      return snapshots[this.state];
    },
    replaceBlockedIdentity() {
      snapshots.blocked = {
        state: "blocked",
        proceed,
        reset,
        location,
      };
    },
  };
  return harness;
});
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
/** P-R2: flush 短絡前の live refetch。既定は cache と同じ live 行。 */
const draftQueryRefetchMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ isError: false, data: undefined as PlannerDraft | null | undefined }),
);
/** P4: 緊急 post-flush の list 再読を観測する */
const listPantryItemsMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(queryState.pantry.data ?? [])),
);

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session: { user: { id: queryState.userId }, access_token: "planner-access-token" },
  }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return {
    ...original,
    useNavigate: () => navigateMock,
    // Router 未 wrap の unit でも resume query を読めるようにする
    useSearchParams: () => [new URLSearchParams(queryState.search), vi.fn()],
    // P5: data router 必須の useBlocker を差し替え。既存 PlannerRoutePage テストが throw しない。
    useBlocker: (
      shouldBlock: (args: {
        historyAction: "POP" | "PUSH" | "REPLACE";
        currentLocation: { pathname: string };
        nextLocation: { pathname: string };
      }) => boolean,
    ) => {
      blockerHarness.lastShouldBlock = shouldBlock;
      return blockerHarness.current();
    },
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
          refetch: draftQueryRefetchMock,
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
  return {
    ...original,
    savePlannerDraft: savePlannerDraftMock,
    startPlannerDraftKeepaliveSave: startPlannerDraftKeepaliveSaveMock,
  };
});
vi.mock("./use-draft-autosave", async (importOriginal) => {
  const original = await importOriginal<typeof import("./use-draft-autosave")>();
  const { DraftRevisionConflictError } = await import("./planner-api");
  return {
    ...original,
    useDraftAutosave: (input: {
      value: PlannerDraftInput;
      baselineRevision: number;
      holdLiveRevision?: boolean;
      save(value: PlannerDraftInput, revision: number): Promise<PlannerDraft>;
      saveOnUnload?(value: PlannerDraftInput, revision: number): void;
      refreshLiveDraft?: () => Promise<PlannerDraft | null>;
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
          // P-R2: lastSaved 短絡（RPC なし）。stale live は refresh が null なら落とす。
          if (autosaveFlushMode.mode === "lastSaved") {
            return (async () => {
              const live = await input.refreshLiveDraft?.();
              if (live === null) {
                throw new original.IncompleteDraftSaveError();
              }
              return {
                ...draft,
                ...input.value,
                revision: input.baselineRevision,
              };
            })();
          }
          // P-R5: 公開 pin 中は mock でも live を進めない（flushDraft 短絡の第二防衛）。
          if (input.holdLiveRevision === true) {
            return Promise.resolve({
              ...draft,
              ...input.value,
              revision: input.baselineRevision,
            });
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
          disabled={props.isSaving}
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
  readPendingGenerationMeta: vi.fn(),
  // P1: dual-tab claim。既定は first-writer 成功（save を経由して既存アサートを維持）
  claimPendingGeneration: vi.fn(),
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
    claimPendingGeneration: pendingGenerationMock.claimPendingGeneration,
  };
});
vi.mock("@/features/generation/model/pending-generation-meta", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/model/pending-generation-meta")>();
  return {
    ...original,
    savePendingGenerationMeta: pendingGenerationMock.savePendingGenerationMeta,
    readPendingGenerationMeta: pendingGenerationMock.readPendingGenerationMeta,
  };
});

import { PlannerPage, PlannerRoutePage } from "./planner-route";
import {
  PLANNER_LEAVE_FLUSH_TIMEOUT_MS,
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
  // P5: 前テストの blocked が次の PlannerRoutePage mount で即 flush しないよう戻す
  blockerHarness.state = "unblocked";
  blockerHarness.lastShouldBlock = undefined;
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
  pendingGenerationMock.readPendingGenerationMeta.mockReset();
  pendingGenerationMock.claimPendingGeneration.mockReset();
  getGenerationStatusMock.mockReset();
  // status 不明は keep→resume（G-R1 / G1）。進行中 fixture は各テストで上書き。
  getGenerationStatusMock.mockRejectedValue(new Error("status_not_stubbed"));
  pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
  pendingGenerationMock.readPendingGenerationMeta.mockReturnValue(null);
  draftQueryRefetchMock.mockReset();
  draftQueryRefetchMock.mockImplementation(() =>
    Promise.resolve({
      isError: false,
      data: queryState.draft === undefined ? draft : queryState.draft,
    }),
  );
  pendingGenerationMock.createPendingGeneration.mockImplementation(
    (command: unknown, ownerUserId: string) => ({
      ownerUserId,
      createdAt: "2026-07-11T00:00:00.000Z",
      ...(command as object),
    }),
  );
  // P1: claim 成功時は save 経由（既存「save が呼ばれた」アサートを維持）
  pendingGenerationMock.claimPendingGeneration.mockImplementation((candidate: unknown) => {
    pendingGenerationMock.savePendingGeneration(candidate);
    return Promise.resolve({ pending: candidate, claimed: true });
  });
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

it("P2: persistable dirty の document unload 用に session token の keepalive 保存を渡す", () => {
  render(<PlannerPage />);
  const latestAutosave = autosaveInputs.at(-1) as {
    saveOnUnload?(next: PlannerDraftInput, revision: number): void;
  };
  const edited = { ...draft, memo: "野菜多め" };
  latestAutosave.saveOnUnload?.(edited, 3);
  expect(startPlannerDraftKeepaliveSaveMock).toHaveBeenCalledTimes(1);
  expect(startPlannerDraftKeepaliveSaveMock).toHaveBeenCalledWith(
    "planner-access-token",
    edited,
    3,
  );
  expect(savePlannerDraftMock).not.toHaveBeenCalled();
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

it("P7: leave flush 中は home CTA を disabled にする", async () => {
  queryState.draft = null;
  pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  render(<PlannerRoutePage />);
  await vi.waitFor(() => {
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeEnabled();
  });

  const leavePromise = runPlannerLeaveFlush();
  await vi.waitFor(() => {
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeDisabled();
  });

  deferred.resolve({ ...draft, revision: 4 });
  await expect(leavePromise).resolves.toBe("proceed");
  // proceed 後も unmount まで disabled（wizard isSaving と同型）
  expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeDisabled();
});

it("C5: leave flush 中はホームの冷蔵庫リンクも disabled にする", async () => {
  queryState.draft = null;
  pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  render(<PlannerRoutePage />);
  const pantryLink = await screen.findByRole("link", { name: "冷蔵庫を見る" });
  expect(pantryLink).not.toHaveAttribute("aria-disabled", "true");

  const leavePromise = runPlannerLeaveFlush();
  await vi.waitFor(() => {
    expect(screen.getByRole("link", { name: "冷蔵庫を見る" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  deferred.resolve({ ...draft, revision: 4 });
  await expect(leavePromise).resolves.toBe("proceed");
  expect(screen.getByRole("link", { name: "冷蔵庫を見る" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
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

it("P5: leave flush 中は isSaving が true（generate disabled / 編集窓を閉じる）", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");

  const leavePromise = runPlannerLeaveFlush();
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
  });
  // mock wizard の生成ボタンも isSaving で disabled
  expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();

  deferred.resolve({ ...draft, revision: 4 });
  await expect(leavePromise).resolves.toBe("proceed");
  // proceed 後も unmount まで isSaving を維持（post-flush 編集窓を閉じる）
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
});

it("P1: leave flush timeout 後はロックを落とし、遅延 proceed で固着しない", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  const startGeneration = vi.fn().mockResolvedValue(true);
  render(<PlannerPage startGeneration={startGeneration} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  // withTimeout の壁時計を fake で進める。実タイマー起動後に fake へ切ると
  // 本物の 15s timeout が残って leavePromise が解決せず、次テストの single-flight を汚す。
  vi.useFakeTimers();
  try {
    const leavePromise = runPlannerLeaveFlush();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLANNER_LEAVE_FLUSH_TIMEOUT_MS + 10);
    });
    await expect(leavePromise).resolves.toBe("blocked");
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
  } finally {
    vi.useRealTimers();
  }

  // timeout 後に遅延 flush が成功しても proceed ロックを再武装しない
  deferred.resolve({ ...draft, revision: 4 });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");

  // ロックが残ると generate が isLeaving / leaveInFlightRef で止まる。
  // 再離脱を proceed させると成功経路がロックを再武装するので、ここでは生成だけ見る。
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();
  await vi.waitFor(() => {
    expect(startGeneration).toHaveBeenCalled();
  });
});

it("P1: leave flush timeout 後は never-settle の flush に join せず generate できる", async () => {
  // timeout は元 Promise を cancel しない。flight を残すと次の generate が
  // 同じ never-settle GET/RPC に join し isSubmitting が解けない。
  const hang = new Promise<PlannerDraft>(() => undefined);
  savePlannerDraftMock.mockImplementationOnce(() => hang);
  const startGeneration = vi.fn().mockResolvedValue(true);
  render(<PlannerPage startGeneration={startGeneration} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  vi.useFakeTimers();
  try {
    const leavePromise = runPlannerLeaveFlush();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLANNER_LEAVE_FLUSH_TIMEOUT_MS + 10);
    });
    await expect(leavePromise).resolves.toBe("blocked");
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
  } finally {
    vi.useRealTimers();
  }

  // hang は resolve しない。2 回目の save は既定 mock で settle する。
  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();
  await vi.waitFor(() => {
    expect(startGeneration).toHaveBeenCalled();
  });
});

it("P9: pendingDisplayReady 前の leave flush は空下書きを正本にしない", async () => {
  pendingGenerationMock.readPendingGeneration.mockReturnValue({
    ownerUserId: draft.userId,
    createdAt: "2026-07-11T00:00:00.000Z",
    commandVersion: "generation-command.v3",
    kind: "new_menu",
    qualityMode: false,
    request: {
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      draftId: draft.id,
      draftRevision: draft.revision,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  });
  getGenerationStatusMock.mockReturnValue(new Promise(() => undefined));
  render(<PlannerRoutePage />);
  expect(screen.getByText("献立条件を読み込み中…")).toBeInTheDocument();

  await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
  expect(savePlannerDraftMock).not.toHaveBeenCalled();
});

it("P-R1: hydratedDraft は ineligible 家族を除いた sanitize 済み入力を渡す", async () => {
  // lastSaved 種が raw 行だと fingerprint（sanitize 済み）と字面がずれ Incomplete になる。
  const ineligibleId = "70000000-0000-4000-8000-000000000099";
  const eligibleId = draft.targetMemberIds[0] ?? "70000000-0000-4000-8000-000000000001";
  queryState.draft = {
    ...draft,
    targetMemberIds: [eligibleId, ineligibleId],
  };
  queryState.safetyEligibleMemberIds = [eligibleId];
  render(<PlannerPage />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  const latestAutosave = autosaveInputs.at(-1) as {
    hydratedDraft: PlannerDraft | null;
  };
  expect(latestAutosave.hydratedDraft?.id).toBe(draft.id);
  expect(latestAutosave.hydratedDraft?.revision).toBe(draft.revision);
  expect(latestAutosave.hydratedDraft?.targetMemberIds).toEqual([eligibleId]);
});

it("P-R2: lastSaved flush は cache null のとき ghost を戻さない", async () => {
  // 他タブ soft-delete 後。flush 短絡が削除済み行を返すと setQueryData が cache を戻す。
  autosaveFlushMode.mode = "lastSaved";
  getQueryDataMock.mockImplementation((queryKey: readonly unknown[]) => {
    if (queryKey[0] === "planner") return null;
    return { onboarding_status: "not_started" };
  });
  setQueryDataMock.mockClear();
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
  expect(savePlannerDraftMock).not.toHaveBeenCalled();
  expect(setQueryDataMock).not.toHaveBeenCalledWith(
    ["planner", "draft", draft.userId],
    expect.anything(),
  );
});

it("P-R2: cache null の lastSaved flush は生成を開始しない", async () => {
  autosaveFlushMode.mode = "lastSaved";
  getQueryDataMock.mockImplementation((queryKey: readonly unknown[]) => {
    if (queryKey[0] === "planner") return null;
    return { onboarding_status: "not_started" };
  });
  const startGeneration = vi.fn();
  render(<PlannerPage startGeneration={startGeneration} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();
  expect(startGeneration).not.toHaveBeenCalled();
  expect(savePlannerDraftMock).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "人数など必要な条件が未設定のため、生成を開始しませんでした。確認画面で内容を見直してください。",
    );
  });
});

it("P-R2: stale live cache でも refetch が null なら lastSaved を生成に使わない", async () => {
  // 他タブ soft-delete 後も既定 30s で cache に live が残る。短絡前の refetch を見る。
  autosaveFlushMode.mode = "lastSaved";
  draftQueryRefetchMock.mockResolvedValue({ isError: false, data: null });
  getQueryDataMock.mockImplementation((queryKey: readonly unknown[]) => {
    if (queryKey[0] === "planner") return draft;
    return { onboarding_status: "not_started" };
  });
  const startGeneration = vi.fn();
  render(<PlannerPage startGeneration={startGeneration} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });
  expect((autosaveInputs.at(-1) as { refreshLiveDraft?: unknown }).refreshLiveDraft).toEqual(
    expect.any(Function),
  );

  const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
  await props.onSubmit();
  expect(startGeneration).not.toHaveBeenCalled();
  expect(savePlannerDraftMock).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "人数など必要な条件が未設定のため、生成を開始しませんでした。確認画面で内容を見直してください。",
    );
  });
});

it("P1: 生成後 empty / rev=0 hydrate の leave は undelete しない", async () => {
  // new_menu 成功後は draft cache null。init は empty + baseline=0。
  // 実 flush は persistable でも fingerprint === baseline なら Incomplete（RPC しない）。
  // leave は Incomplete を proceed し、save(empty, 0) の undelete に落とさない。
  queryState.draft = null;
  pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
  autosaveFlushMode.mode = "incomplete";
  render(<PlannerRoutePage />);
  await vi.waitFor(() => {
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeInTheDocument();
  });

  await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
  expect(savePlannerDraftMock).not.toHaveBeenCalled();
});

it("C6: leave flush timeout は通信失敗と同系統の理由を出す", async () => {
  const deferred = createDeferred<PlannerDraft>();
  savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  vi.useFakeTimers();
  try {
    const leavePromise = runPlannerLeaveFlush();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLANNER_LEAVE_FLUSH_TIMEOUT_MS + 10);
    });
    await expect(leavePromise).resolves.toBe("blocked");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "条件の保存が時間内に終わらなかったため、移動できませんでした。通信を確認して再度お試しください。",
    );
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
  } finally {
    vi.useRealTimers();
  }
});

it("P5: leave flush が blocked なら isSaving を解除する", async () => {
  let rejectSave: ((error: Error) => void) | undefined;
  savePlannerDraftMock.mockImplementationOnce(
    () =>
      new Promise<PlannerDraft>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  render(<PlannerPage startGeneration={vi.fn()} />);
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
  });

  const leavePromise = runPlannerLeaveFlush();
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
  });

  rejectSave?.(new Error("network"));
  await expect(leavePromise).resolves.toBe("blocked");
  await vi.waitFor(() => {
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
  });
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

  it("P3: startGeneration は pantry 再読後の JST 当日以外 confirmation を載せない", async () => {
    // list 前に閉じた now のままだと、再読が JST 0:00 を跨いだあと昨日 checkedAt が残る。
    const beforeMidnight = new Date("2026-08-17T14:59:00.000Z");
    const afterMidnight = new Date("2026-08-17T15:00:30.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(beforeMidnight);
    try {
      let pantryReads = 0;
      listPantryItemsMock.mockImplementation(() => {
        pantryReads += 1;
        if (pantryReads >= 2) {
          vi.setSystemTime(afterMidnight);
        }
        return Promise.resolve(queryState.pantry.data ?? []);
      });
      render(<PlannerRoutePage />);
      act(() => {
        const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
        props.onDraftChange({
          ...props.draft,
          pantrySelections: [
            {
              pantryItemId: pantryItem.id,
              priority: "prefer_use",
            },
          ],
        });
        const latest = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
        latest.onAttemptChange({
          idempotencyKey: latest.attempt.idempotencyKey,
          qualityMode: false,
          expiredPantryChecks: [
            {
              pantryItemId: pantryItem.id,
              checkedAt: "2026-08-17T14:50:00.000Z",
            },
          ],
        });
      });
      const submitProps = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
      await submitProps.onSubmit();

      await vi.waitFor(() => {
        expect(pendingGenerationMock.createPendingGeneration).toHaveBeenCalled();
      });
      const command = pendingGenerationMock.createPendingGeneration.mock.calls[0]?.[0] as {
        request: { expiredPantryConfirmations: unknown[] };
      };
      expect(command.request.expiredPantryConfirmations).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("P6: startGeneration は期限切れ解消済み confirmation を sticky に載せない", async () => {
    // onSubmit 再読時点では期限切れ、claim 前再読で未来日。第 3 引数が checks 自身だと surplus 422。
    const resolved = { ...pantryItem, expiresOn: "2099-12-31" };
    listPantryItemsMock.mockResolvedValueOnce([pantryItem]).mockResolvedValueOnce([resolved]);
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(pendingGenerationMock.createPendingGeneration).toHaveBeenCalled();
    });
    const command = pendingGenerationMock.createPendingGeneration.mock.calls[0]?.[0] as {
      request: { expiredPantryConfirmations: unknown[] };
    };
    expect(command.request.expiredPantryConfirmations).toEqual([]);
  });

  it("P6: 生成成功直後は isSaving を維持し reset しても pending を捨てない", async () => {
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation");
    });
    expect(pendingGenerationMock.savePendingGeneration).toHaveBeenCalled();
    // navigate は fire-and-forget。commit 前に isSaving が落ちると reset で sticky が消える
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "入力をリセット" })).toBeDisabled();

    const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
    props.onReset?.();
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
  });

  it("C3: kept resume 直後は isSaving を維持し reset しても pending を捨てない", async () => {
    // startGeneration は kept で false を返すが /generation?resumed=1 済み。
    // finally が isSaving を落とすと reset が sticky を消せる（P6 成功経路と同型）。
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: { idempotencyKey: "existing" },
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "入力をリセット" })).toBeDisabled();

    const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
    props.onReset?.();
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
  });

  it("C3: claim 負け resume 直後は isSaving を維持し reset しても pending を捨てない", async () => {
    const otherPending = {
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3" as const,
      kind: "new_menu" as const,
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    pendingGenerationMock.claimPendingGeneration.mockImplementation(() => {
      pendingGenerationMock.readPendingGeneration.mockReturnValue(otherPending);
      pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
        kind: "new_menu",
        targetMode: "household",
        idempotencyKey: otherPending.request.idempotencyKey,
        ownerUserId: draft.userId,
        createdAt: otherPending.createdAt,
      });
      return Promise.resolve({ pending: otherPending, claimed: false });
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(screen.getByLabelText("wizard saving")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "入力をリセット" })).toBeDisabled();

    const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
    props.onReset?.();
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
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

  it("P2: 他タブ claim の storage 後は確認に再開注意を出す", async () => {
    render(<PlannerRoutePage />);
    expect(await screen.findByLabelText("wizard step")).toHaveTextContent("review");
    expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("false");

    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: { idempotencyKey: "existing" },
    });
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "kondate:generation:v3",
          newValue: "{}",
        }),
      );
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("true");
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("P2: 再開注意前の generate は旧 sticky を再開しない", async () => {
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    expect(await screen.findByLabelText("wizard step")).toHaveTextContent("review");
    expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("false");

    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: { idempotencyKey: "existing" },
    });

    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(navigateMock).not.toHaveBeenCalledWith("/generation?resumed=1");
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(pendingGenerationMock.createPendingGeneration).not.toHaveBeenCalled();
    expect(pendingGenerationMock.claimPendingGeneration).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("true");
    });

    await user.click(screen.getByRole("button", { name: "生成" }));
    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(pendingGenerationMock.createPendingGeneration).not.toHaveBeenCalled();
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
    expect(pendingGenerationMock.claimPendingGeneration).not.toHaveBeenCalled();
    // resume は return false → startNewAttempt しない（期限確認を捨てない）
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);
    expect(screen.getByLabelText("check count")).toHaveTextContent("1");
  });

  it("P1: claim 負け（dual-tab 他 sticky）は上書きせず resumed 再開し attempt を回さない", async () => {
    // pre-read は null（両タブ同時 null 観測後の claim 競合）。claim だけ他タブ sticky を返す。
    // P3: 負けタブは winner の sticky/meta が読めることを確認してから resumed する。
    const otherPending = {
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3" as const,
      kind: "new_menu" as const,
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    // init / claim 前は pending なし（reconcile 再開に落とさない）。
    // claim 負け後だけ winner の sticky/meta を読めるようにする。
    pendingGenerationMock.claimPendingGeneration.mockImplementation(() => {
      pendingGenerationMock.readPendingGeneration.mockReturnValue(otherPending);
      pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
        kind: "new_menu",
        targetMode: "household",
        idempotencyKey: otherPending.request.idempotencyKey,
        ownerUserId: draft.userId,
        createdAt: otherPending.createdAt,
      });
      return Promise.resolve({ pending: otherPending, claimed: false });
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(pendingGenerationMock.claimPendingGeneration).toHaveBeenCalled();
    // 負けタブは meta を書かず・clear しない（勝者 sticky を壊さない）
    expect(pendingGenerationMock.savePendingGenerationMeta).not.toHaveBeenCalled();
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    // return false → startNewAttempt しない
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);
  });

  it("P3: claim 負け後に winner が rollback して pending が空なら resumed しない", async () => {
    // 勝ちタブが savePendingGenerationMeta throw / abort で clear したあと、
    // 負けタブが空 pending のまま /generation?resumed=1 すると idle→planner で
    // 両タブが作成 ID を失う。pending が読めないなら generation へ飛ばさない。
    const otherPending = {
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3" as const,
      kind: "new_menu" as const,
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    pendingGenerationMock.claimPendingGeneration.mockResolvedValue({
      pending: otherPending,
      claimed: false,
    });
    pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue(null);
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(pendingGenerationMock.claimPendingGeneration).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
    });
    expect(navigateMock).not.toHaveBeenCalledWith("/generation?resumed=1");
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "献立の作成を開始できませんでした。もう一度お試しください。",
    );
  });

  it("P3: claim 負け待ちのあいだに winner が clear したら空 resume しない", async () => {
    const otherPending = {
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3" as const,
      kind: "new_menu" as const,
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue(null);
    // init は pending なし（wizard を出す）。claim 後だけ winner body→rollback を再現する。
    pendingGenerationMock.claimPendingGeneration.mockImplementation(() => {
      let pendingReads = 0;
      pendingGenerationMock.readPendingGeneration.mockImplementation(() => {
        pendingReads += 1;
        return pendingReads === 1 ? otherPending : null;
      });
      return Promise.resolve({ pending: otherPending, claimed: false });
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(pendingGenerationMock.claimPendingGeneration).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
    });
    expect(navigateMock).not.toHaveBeenCalledWith("/generation?resumed=1");
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "献立の作成を開始できませんでした。もう一度お試しください。",
    );
  });

  it("入力をリセットすると進行中 pending も捨てる", async () => {
    const user = userEvent.setup();
    render(<PlannerPage />);
    // 未公開の自 key（body のみ・meta 無し）と一致するときだけ clear する（C7 の対照）
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: attemptKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(pendingGenerationMock.clearPendingGeneration).toHaveBeenCalledTimes(1);
    // 未公開の自 key は従来どおり empty をサーバへ揃える（P-R1 の対照）
    expect(savePlannerDraftMock).toHaveBeenCalled();
  });

  it("P2: 公開済み同一 key の sticky は reset しても共有 pending を消さない", async () => {
    // 勝ちタブの attempt key と sticky が一致しても、claim+meta 済みなら
    // 負けタブの /generation?resumed=1 が作成 ID を読むため残す。
    const user = userEvent.setup();
    render(<PlannerPage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: attemptKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: attemptKey,
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
  });

  it("P-R1: 公開済み同一 key の reset は empty をサーバへ強制保存しない", async () => {
    // empty は persistable。force-save すると live revision が N+1 になり、
    // 負けタブの pin した draftRevision=N が lookup miss → draft_not_found になる。
    const user = userEvent.setup();
    render(<PlannerPage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: attemptKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: attemptKey,
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    savePlannerDraftMock.mockClear();
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("meal");
  });

  it("P-R5: 公開 sticky 中の reset 後 leave flush は empty を expected=N で書かない", async () => {
    // P-R1 は reset 本体だけ止めた。leave の明示 flush は persistable empty を
    // そのまま書くため、負けタブの draftRevision=N pin が外れる。
    const user = userEvent.setup();
    render(<PlannerPage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: attemptKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: attemptKey,
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    savePlannerDraftMock.mockClear();

    await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
  });

  it("P-R5: 公開 sticky 中の reset 後 settings flush は empty を書かない", async () => {
    const user = userEvent.setup();
    render(<PlannerPage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: attemptKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: attemptKey,
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    savePlannerDraftMock.mockClear();

    await user.click(screen.getByRole("button", { name: "家族設定" }));
    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/settings");
    });
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
  });

  it("P-R5: 公開 sticky 中の generate flush は live revision を進めず C2 再開する", async () => {
    // 公開 pin 中に献立を作る flush が expected=N で書くと同じ lookup miss。
    // C2 は既存 pending 再開のみ。draftRevision は N のまま。
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    savePlannerDraftMock.mockClear();
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  });

  it("P3: 公開 sticky 中の医療メモでも確認 CTA は C2 再開する", async () => {
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    act(() => {
      const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
      props.onDraftChange({ ...props.draft, memo: "離乳食" });
    });
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(screen.queryByText(/離乳食、飲み込み・嚥下/u)).not.toBeInTheDocument();
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  });

  it("P3: 公開 sticky 中の privacy 未同意でも確認 CTA は C2 再開する", async () => {
    queryState.privacyConsent = null;
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(navigateMock).not.toHaveBeenCalledWith("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  });

  it("P-R6: 公開 sticky 中の strip 後 generate は pin household の eligibility で止めず C2 再開する", async () => {
    // 短絡 flush は cache の pin household を返す。strip は local value だけ落とす。
    // eligibility を C2 より前に saved で見ると、残る家族を選び直しても再開できない。
    const memberA = "70000000-0000-4000-8000-000000000001";
    const memberB = "70000000-0000-4000-8000-000000000002";
    queryState.draft = { ...draft, targetMemberIds: [memberA, memberB] };
    queryState.safetyEligibleMemberIds = [memberA, memberB];
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    const view = render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));

    queryState.safetyEligibleMemberIds = [memberA];
    view.rerender(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
    });

    await user.click(screen.getByRole("button", { name: "review へ進む" }));
    savePlannerDraftMock.mockClear();
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).not.toHaveTextContent("audience");
  });

  it("P-R6: 公開 sticky 中に idea へ選び直しても短絡 household で止めず C2 再開する", async () => {
    // idea 再選択でも saved.targetMode は pin household のまま。eligibility に使わない。
    const memberA = "70000000-0000-4000-8000-000000000001";
    const memberB = "70000000-0000-4000-8000-000000000002";
    queryState.draft = { ...draft, targetMemberIds: [memberA, memberB] };
    queryState.safetyEligibleMemberIds = [memberA, memberB];
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    const view = render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));

    queryState.safetyEligibleMemberIds = [memberA];
    view.rerender(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
    });

    act(() => {
      const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
      props.onDraftChange({
        ...props.draft,
        targetMode: "idea",
        targetMemberIds: [],
        servings: 2,
      });
    });
    await user.click(screen.getByRole("button", { name: "audience idea を確定" }));
    savePlannerDraftMock.mockClear();
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  });

  it("P2: 公開 sticky 中に削除済み pantry を UI 解除した generate は pin の古い ID で止めず C2 再開する", async () => {
    // 短絡 flush は cache の pin を返す。pin に削除済み ID が残っていても、
    // 確認 UI で解除した local 選択でゲートし、C2 再開へ進む。
    const deletedPantryId = "74000000-0000-4000-8000-000000000099";
    queryState.draft = {
      ...draft,
      pantrySelections: [{ pantryItemId: deletedPantryId, priority: "prefer_use" }],
    };
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    act(() => {
      const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
      props.onDraftChange({
        ...props.draft,
        pantrySelections: [],
      });
    });
    savePlannerDraftMock.mockClear();
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
  });

  it("P8: 公開 sticky 中に削除済み pantry を UI 解除した緊急は pin の古い ID で止めず navigate する", async () => {
    // 短絡 flush は cache の pin を返す。pin に削除済み ID が残っていても、
    // 確認 UI で解除した local 選択でゲートし、/emergency-menus へ進む。
    const deletedPantryId = "74000000-0000-4000-8000-000000000099";
    queryState.draft = {
      ...draft,
      pantrySelections: [{ pantryItemId: deletedPantryId, priority: "prefer_use" }],
    };
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: "80000000-0000-4000-8000-000000000099",
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    act(() => {
      const props = wizardPropsSpy.mock.calls.at(-1)?.[0] as WizardMockProps;
      props.onDraftChange({
        ...props.draft,
        pantrySelections: [],
      });
    });
    savePlannerDraftMock.mockClear();
    await user.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/emergency-menus");
    });
    expect(savePlannerDraftMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText("冷蔵庫から削除された食材の選択を解除してから緊急献立を開いてください。"),
    ).not.toBeInTheDocument();
  });

  it("P4: flush〜claim のあいだに pending が消えたら pin で新規 sticky を書かない", async () => {
    // 公開 pin の flush 短絡後、pantry 再読のあいだに他タブが terminal 完了して
    // sticky を消し draft を soft-delete する。確認 copy は再開のみなので、
    // 削除済み pin の draftId+revision で新規 sticky を書いてはいけない。
    const existingPending = {
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3" as const,
      kind: "new_menu" as const,
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    pendingGenerationMock.readPendingGeneration.mockReturnValue(existingPending);
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: existingPending.request.idempotencyKey,
      ownerUserId: draft.userId,
      createdAt: existingPending.createdAt,
    });
    const pantryDeferred = createDeferred<PantryItem[]>();
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    listPantryItemsMock.mockImplementationOnce(() => pantryDeferred.promise);
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(listPantryItemsMock).toHaveBeenCalled();
    });

    pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue(null);
    queryState.draft = null;
    draftQueryRefetchMock.mockResolvedValue({ isError: false, data: null });
    act(() => {
      pantryDeferred.resolve(queryState.pantry.data ?? []);
    });

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "献立の作成を開始できませんでした。もう一度お試しください。",
      );
    });
    expect(pendingGenerationMock.createPendingGeneration).not.toHaveBeenCalled();
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
    expect(pendingGenerationMock.claimPendingGeneration).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(navigateMock).not.toHaveBeenCalledWith("/generation?resumed=1");
  });

  it("P4: startGeneration の reconcile が cleared なら pin で新規 sticky を書かない", async () => {
    // G-R4 init は status 不明 keep。生成時の reconcile だけ succeeded → clear。
    // 確認は再開のみ。削除済み pin で新規 createPendingGeneration しない。
    const existingPending = {
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3" as const,
      kind: "new_menu" as const,
      qualityMode: false,
      request: {
        idempotencyKey: "80000000-0000-4000-8000-000000000099",
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
    pendingGenerationMock.readPendingGeneration.mockReturnValue(existingPending);
    pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
      kind: "new_menu",
      targetMode: "household",
      idempotencyKey: existingPending.request.idempotencyKey,
      ownerUserId: draft.userId,
      createdAt: existingPending.createdAt,
    });
    const user = userEvent.setup();
    render(<PlannerRoutePage />);
    await user.click(await screen.findByRole("button", { name: "今日の献立をつくる" }));
    expect(screen.getByLabelText("has resumable pending")).toHaveTextContent("true");

    getGenerationStatusMock.mockResolvedValue({
      status: "succeeded",
      idempotencyKey: existingPending.request.idempotencyKey,
      requestId: "50000000-0000-4000-8000-000000000099",
      menuId: "61000000-0000-4000-8000-000000000001",
      completedAt: "2026-07-20T05:01:00.000Z",
      quota: {
        consumed: true,
        remaining: 1,
        userDailyLimit: 3,
        limitKind: "user",
        retryAt: null,
      },
    });
    pendingGenerationMock.clearPendingGeneration.mockImplementation(() => {
      pendingGenerationMock.readPendingGeneration.mockReturnValue(null);
      pendingGenerationMock.readPendingGenerationMeta.mockReturnValue(null);
    });

    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "献立の作成を開始できませんでした。もう一度お試しください。",
      );
    });
    expect(pendingGenerationMock.createPendingGeneration).not.toHaveBeenCalled();
    expect(pendingGenerationMock.savePendingGeneration).not.toHaveBeenCalled();
    expect(pendingGenerationMock.claimPendingGeneration).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
    expect(navigateMock).not.toHaveBeenCalledWith("/generation?resumed=1");
  });

  it("C7: reset does not clear another tab's claimed pending after strip abort", async () => {
    const user = userEvent.setup();
    render(<PlannerPage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    const winnerKey = "80000000-0000-4000-8000-000000000099";
    // 勝ちタブ sticky。画面の attempt は負けタブ側の別キーのまま
    pendingGenerationMock.readPendingGeneration.mockReturnValue({
      ownerUserId: draft.userId,
      createdAt: "2026-07-11T00:00:00.000Z",
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: winnerKey,
        draftId: draft.id,
        draftRevision: draft.revision,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    });
    expect(attemptKey).not.toBe(winnerKey);
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
    expect(screen.getByLabelText("wizard step")).toHaveTextContent("meal");
    expect(screen.getByLabelText("attempt key").textContent).not.toBe(attemptKey);
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

  it("P4: claim 後の strip abort は公開済み sticky を消さない", async () => {
    // 勝ちタブが claim+meta したあと strip が abort しても、負けタブが
    // /generation?resumed=1 済みなら共有 sticky を残す（C7 は未公開の自 key だけ消す）。
    const deferredClaim = createDeferred<{ pending: unknown; claimed: boolean }>();
    pendingGenerationMock.claimPendingGeneration.mockImplementation((candidate: unknown) => {
      pendingGenerationMock.savePendingGeneration(candidate);
      return deferredClaim.promise.then(() => ({ pending: candidate, claimed: true }));
    });
    const user = userEvent.setup();
    const view = render(<PlannerRoutePage />);
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));
    await vi.waitFor(() => {
      expect(pendingGenerationMock.claimPendingGeneration).toHaveBeenCalled();
    });

    queryState.safetyEligibleMemberIds = [];
    view.rerender(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
    });

    deferredClaim.resolve({
      pending: pendingGenerationMock.claimPendingGeneration.mock.calls[0]?.[0],
      claimed: true,
    });
    await vi.waitFor(() => {
      expect(pendingGenerationMock.savePendingGenerationMeta).toHaveBeenCalled();
    });
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
  });

  it("P2: claim+meta 済みのあと strip abort しても reset は同一 key の共有 pending を消さない", async () => {
    // strip が submittingRef を落とすと「入力をリセット」が押せる。
    // 公開済み sticky を同じ key で消すと、負けタブの作成 ID が失われる。
    const deferredClaim = createDeferred<{ pending: unknown; claimed: boolean }>();
    pendingGenerationMock.claimPendingGeneration.mockImplementation((candidate: unknown) => {
      pendingGenerationMock.savePendingGeneration(candidate);
      return deferredClaim.promise.then(() => {
        const claimed = candidate as { request: { idempotencyKey: string } };
        pendingGenerationMock.readPendingGeneration.mockReturnValue({
          ownerUserId: draft.userId,
          createdAt: "2026-07-11T00:00:00.000Z",
          commandVersion: "generation-command.v3",
          kind: "new_menu",
          qualityMode: false,
          request: {
            idempotencyKey: claimed.request.idempotencyKey,
            draftId: draft.id,
            draftRevision: draft.revision,
            privacyNoticeVersion: "2026-07-29.v1",
            expiredPantryConfirmations: [],
          },
        });
        pendingGenerationMock.readPendingGenerationMeta.mockReturnValue({
          kind: "new_menu",
          targetMode: "household",
          idempotencyKey: claimed.request.idempotencyKey,
          ownerUserId: draft.userId,
          createdAt: "2026-07-11T00:00:00.000Z",
        });
        return { pending: candidate, claimed: true };
      });
    });
    const user = userEvent.setup();
    const view = render(<PlannerRoutePage />);
    const attemptKey = screen.getByLabelText("attempt key").textContent;
    await user.click(screen.getByRole("button", { name: "確認を反映" }));
    await user.click(screen.getByRole("button", { name: "生成" }));
    await vi.waitFor(() => {
      expect(pendingGenerationMock.claimPendingGeneration).toHaveBeenCalled();
    });

    queryState.safetyEligibleMemberIds = [];
    view.rerender(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toHaveTextContent("audience");
    });

    deferredClaim.resolve({
      pending: pendingGenerationMock.claimPendingGeneration.mock.calls[0]?.[0],
      claimed: true,
    });
    await vi.waitFor(() => {
      expect(pendingGenerationMock.savePendingGenerationMeta).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard saving")).toHaveTextContent("false");
    });
    expect(screen.getByRole("button", { name: "入力をリセット" })).toBeEnabled();
    expect(screen.getByLabelText("attempt key")).toHaveTextContent(attemptKey);

    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(pendingGenerationMock.clearPendingGeneration).not.toHaveBeenCalled();
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

  it("P1: blocked 中の再 POP で in-flight flush を捨てず成功後は proceed する", async () => {
    const deferred = createDeferred<PlannerDraft>();
    savePlannerDraftMock.mockImplementationOnce(() => deferred.promise);
    const view = render(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
    });

    blockerHarness.state = "blocked";
    view.rerender(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
    });

    // 第 2 Back: blocker 参照だけ変わる。in-flight を cancelled にしてはいけない。
    blockerHarness.replaceBlockedIdentity();
    view.rerender(<PlannerRoutePage />);

    deferred.resolve({ ...draft, revision: 4 });
    await vi.waitFor(() => {
      expect(blockerHarness.proceed).toHaveBeenCalled();
    });
    expect(blockerHarness.reset).not.toHaveBeenCalled();
  });

  it("POP blocker calls proceed when leave flush returns proceed", async () => {
    const view = render(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
    });

    blockerHarness.state = "blocked";
    view.rerender(<PlannerRoutePage />);

    await vi.waitFor(() => {
      expect(blockerHarness.proceed).toHaveBeenCalled();
    });
    expect(blockerHarness.reset).not.toHaveBeenCalled();
  });

  it("POP blocker calls reset and not proceed when leave flush returns blocked", async () => {
    autosaveFlushMode.mode = "network_error";
    const view = render(<PlannerRoutePage />);
    await vi.waitFor(() => {
      expect(screen.getByLabelText("wizard step")).toBeInTheDocument();
    });

    blockerHarness.state = "blocked";
    view.rerender(<PlannerRoutePage />);

    await vi.waitFor(() => {
      expect(blockerHarness.reset).toHaveBeenCalled();
    });
    expect(blockerHarness.proceed).not.toHaveBeenCalled();
  });

  it("does not block PUSH navigations", () => {
    render(<PlannerRoutePage />);
    const shouldBlock = blockerHarness.lastShouldBlock;
    expect(shouldBlock).toEqual(expect.any(Function));
    expect(
      shouldBlock?.({
        historyAction: "PUSH",
        currentLocation: { pathname: "/planner" },
        nextLocation: { pathname: "/generation" },
      }),
    ).toBe(false);
    expect(
      shouldBlock?.({
        historyAction: "REPLACE",
        currentLocation: { pathname: "/planner" },
        nextLocation: { pathname: "/settings" },
      }),
    ).toBe(false);
    expect(
      shouldBlock?.({
        historyAction: "POP",
        currentLocation: { pathname: "/planner" },
        nextLocation: { pathname: "/history" },
      }),
    ).toBe(true);
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
