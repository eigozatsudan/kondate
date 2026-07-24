import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  collectPlannerRequestText,
  plannerSubmissionSchema,
  type PlannerDraft,
  type PlannerDraftInput,
} from "@shared/contracts/planner";
import { privacyNoticeVersion } from "@shared/contracts/domain";
import { detectUnsupportedMedicalRequest } from "@shared/safety/medical-scope";
import {
  getProfile,
  listAllergenCatalog,
  listHouseholdMembers,
  listMemberAllergies,
  setOnboardingStatus,
} from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { listPantryItems, pantryKeys } from "@/features/pantry/pantry-api";
import { createPendingGeneration } from "@/features/generation/model/pending-generation";
import { useGenerationRecovery } from "@/features/generation/hooks/use-generation-recovery";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import { getCurrentPrivacyConsent, hasCurrentPrivacyConsent } from "@/features/privacy/privacy-api";
import { privacyKeys } from "@/features/privacy/privacy-queries";
import { PlannerWizard } from "./components/planner-wizard";
import { medicalRequestBlockedMessage } from "./components/review-step";
import {
  buildPlannerSubmissionFieldErrors,
  firstIncompletePlannerStep,
  type PlannerFieldName,
  type PlannerStep,
} from "./model/planner-wizard";
import type { PlannerSafetyMember } from "./planner-safety-member";
import { createPlannerAttempt, type PlannerAttempt } from "./expired-pantry-checks";
import {
  DraftRevisionConflictError,
  getPlannerDraft,
  plannerKeys,
  savePlannerDraft,
} from "./planner-api";
import { useDraftAutosave } from "./use-draft-autosave";

const emptyDraft: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

const targetMemberLimit = 20;

const ageLabels: Readonly<Record<string, string>> = {
  post_weaning_to_2: "離乳食完了後〜2歳",
  age_3_5: "3〜5歳",
  age_6_8: "6〜8歳",
  age_9_12: "9〜12歳",
  age_13_17: "13〜17歳",
  adult: "大人",
  senior: "高齢者",
};

const safetyLabels: Readonly<Record<string, string>> = {
  remove_bones: "骨を除く",
  cut_small: "小さく切る",
};

type PlannerSafetyData = {
  members: readonly PlannerSafetyMember[];
  eligibleMemberIds: readonly string[];
};

function sanitizeDraft(
  draft: PlannerDraft | null,
  eligibleMemberIds: readonly string[],
): PlannerDraftInput {
  const eligibleIds = new Set(eligibleMemberIds);
  if (draft === null) {
    const targetMemberIds = [...eligibleIds].slice(0, targetMemberLimit);
    return {
      ...emptyDraft,
      targetMemberIds,
      targetMode: targetMemberIds.length > 0 ? "household" : null,
      servings: null,
    };
  }
  if (draft.targetMode === "idea") {
    // idea 対象は家族選択を持たないため、人数はそのまま保持する。
    return { ...draft, targetMemberIds: [] };
  }
  const targetMemberIds = draft.targetMemberIds
    .filter((id) => eligibleIds.has(id))
    .slice(0, targetMemberLimit);
  return {
    ...draft,
    targetMemberIds,
    // household の無効家族を除いた結果 0 件になっても idea へ変えず、未選択へ戻す。
    targetMode: targetMemberIds.length > 0 ? "household" : null,
    servings: null,
  };
}

async function loadPlannerSafetyData(userId: string): Promise<PlannerSafetyData> {
  const client = getBrowserSupabaseClient();
  const [memberRows, catalog] = await Promise.all([
    listHouseholdMembers(client, userId),
    listAllergenCatalog(client),
  ]);
  const completeRows = memberRows.filter((member) => member.status === "complete");
  const allergies = await Promise.all(
    completeRows.map((member) => listMemberAllergies(client, userId, member.id)),
  );
  const allergenNames = new Map(catalog.map((item) => [item.id, item.display_name]));
  const members = completeRows.map<PlannerSafetyMember>((member, index) => {
    const memberAllergies = allergies[index] ?? [];
    const allergyNames = memberAllergies.flatMap((allergy) => {
      if (allergy.allergen_id !== null) {
        const displayName = allergenNames.get(allergy.allergen_id);
        return displayName === undefined ? [] : [displayName];
      }
      return allergy.custom_confirmed && allergy.custom_name !== null ? [allergy.custom_name] : [];
    });
    const blockedReason =
      member.allergy_status === "unconfirmed"
        ? "アレルギー確認が完了していません"
        : member.unsupported_diet_status === "unconfirmed"
          ? "対応対象の確認が完了していません"
          : member.unsupported_diet_status === "present"
            ? "離乳食・嚥下調整食・治療食には対応できません"
            : null;
    return {
      id: member.id,
      displayName: member.display_name?.trim() || `家族${String(index + 1)}`,
      ageBandLabel:
        member.age_band === null ? "年齢未確認" : (ageLabels[member.age_band] ?? "年齢未確認"),
      allergyLabel:
        member.allergy_status === "none"
          ? "アレルギーなし"
          : allergyNames.length > 0
            ? allergyNames.join("・")
            : member.allergy_status === "unconfirmed"
              ? "アレルギー未確認"
              : "登録アレルギーあり",
      safetyLabels: member.required_safety_constraints.map(
        (constraint) => safetyLabels[constraint] ?? "安全上の個別対応",
      ),
      blockedReason,
    };
  });
  return {
    members,
    eligibleMemberIds: members
      .filter((member) => member.blockedReason === null)
      .map((member) => member.id),
  };
}

export type PlannerPageProps = {
  startGeneration?: (draft: PlannerDraft, attempt: PlannerAttempt, signal: AbortSignal) => unknown;
};

export function PlannerPage({ startGeneration }: PlannerPageProps = {}) {
  const userId = useAuth().session?.user.id;
  return (
    <PlannerPageForOwner
      key={userId ?? "missing"}
      userId={userId}
      startGeneration={startGeneration}
    />
  );
}

// ルーターが実際にマウントする献立ページ。復旧付き生成フックを結線し、
// 「献立を作る」操作から保留中の生成コマンドを保存してPOSTし、作成状況画面へ遷移する。
// PlannerPage 自体はテスト向けに startGeneration を注入可能な薄いラッパーのまま変更しない。
export function PlannerRoutePage() {
  const userId = useAuth().session?.user.id;
  const navigate = useNavigate();
  const recovery = useGenerationRecovery();
  const startGeneration = useCallback(
    async (draft: PlannerDraft, attempt: PlannerAttempt, signal: AbortSignal): Promise<boolean> => {
      if (userId === undefined) return false;
      const pending = createPendingGeneration(
        {
          commandVersion: "generation-command.v2",
          kind: "new_menu",
          request: {
            idempotencyKey: attempt.idempotencyKey,
            draftId: draft.id,
            draftRevision: draft.revision,
            privacyNoticeVersion,
            expiredPantryConfirmations: [...attempt.expiredPantryChecks],
          },
        },
        userId,
      );
      await recovery.startGeneration(pending);
      if (signal.aborted) return false;
      void navigate("/generation");
      return true;
    },
    [navigate, recovery, userId],
  );
  return <PlannerPage startGeneration={startGeneration} />;
}

type PlannerPageForOwnerProps = {
  userId: string | undefined;
  startGeneration: PlannerPageProps["startGeneration"];
};

function PlannerPageForOwner({ userId, startGeneration }: PlannerPageForOwnerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const client = getBrowserSupabaseClient();
  const draftQuery = useQuery({
    queryKey: plannerKeys.draft(userId ?? "missing"),
    queryFn: () => getPlannerDraft(client, userId ?? ""),
    enabled: userId !== undefined,
  });
  const safetyQuery = useQuery({
    queryKey: [...householdKeys.members(userId ?? "missing"), "planner-safety"],
    queryFn: () => loadPlannerSafetyData(userId ?? ""),
    enabled: userId !== undefined,
  });
  const pantryQuery = useQuery({
    queryKey: pantryKeys.list(userId ?? "missing"),
    queryFn: () => listPantryItems(client, userId ?? ""),
    enabled: userId !== undefined,
  });
  const usage = useUsageToday(userId ?? "");
  const privacyQuery = useQuery({
    queryKey: privacyKeys.current(userId ?? "missing"),
    queryFn: () => getCurrentPrivacyConsent(client, userId ?? ""),
    enabled: userId !== undefined,
  });
  const [value, setValue] = useState<PlannerDraftInput>(emptyDraft);
  const [initialized, setInitialized] = useState(false);
  const [baselineRevision, setBaselineRevision] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [latestConflictDraft, setLatestConflictDraft] = useState<PlannerDraft | null | undefined>(
    undefined,
  );
  const [hasDraftConflict, setHasDraftConflict] = useState(false);
  const [draftConflictRefetchError, setDraftConflictRefetchError] = useState(false);
  const [attempt, setAttempt] = useState<PlannerAttempt>(createPlannerAttempt);
  const [step, setStep] = useState<PlannerStep>("meal");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PlannerFieldName, string>>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  // audience で idea 確定時の skipped 書込失敗・profile 未取得を示す再試行可能な alert
  const [audienceStatusError, setAudienceStatusError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpeningEmergencyMenus, setIsOpeningEmergencyMenus] = useState(false);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  // 緊急献立遷移の single-flight と unmount 後の遅延 navigate 抑止。
  const mountedRef = useRef(true);
  const emergencyOperationIdRef = useRef(0);
  const startNewAttempt = useCallback(() => {
    setAttempt(createPlannerAttempt());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      emergencyOperationIdRef.current += 1;
      generationAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (draftQuery.data === undefined || safetyQuery.data === undefined || initialized) return;
    const sanitized = sanitizeDraft(draftQuery.data, safetyQuery.data.eligibleMemberIds);
    setValue(sanitized);
    setBaselineRevision(draftQuery.data?.revision ?? 0);
    // 下書きの回答状況からresume先stepを判定する（brief: 「resumes an incomplete
    // target draft at audience without losing answers」）。
    setStep(firstIncompletePlannerStep(sanitized));
    setInitialized(true);
  }, [draftQuery.data, initialized, safetyQuery.data]);

  // Plan 2: 家族の利用可否が後から変わった場合も、無効メンバーを下書きに残さない。
  // idea は家族 ID を持たないため触らない。household が 0 件になっても idea へ自動降格しない。
  useEffect(() => {
    if (!initialized || safetyQuery.data === undefined) return;
    if (value.targetMode === "idea") return;
    const eligibleIds = new Set(safetyQuery.data.eligibleMemberIds);
    const nextIds = value.targetMemberIds.filter((id) => eligibleIds.has(id));
    if (nextIds.length === value.targetMemberIds.length) return;
    setValue({
      ...value,
      targetMemberIds: nextIds,
      targetMode: nextIds.length > 0 ? "household" : null,
      servings: null,
    });
  }, [initialized, safetyQuery.data, value]);

  const save = useCallback(
    (next: PlannerDraftInput, revision: number) =>
      savePlannerDraft(client, userId ?? "", next, revision),
    [client, userId],
  );
  const { refetch: refetchDraft } = draftQuery;
  const loadLatestConflictDraft = useCallback(async (): Promise<void> => {
    setDraftConflictRefetchError(false);
    const result = await refetchDraft();
    if (result.isError) {
      setDraftConflictRefetchError(true);
      return;
    }
    setLatestConflictDraft(result.data);
  }, [refetchDraft]);
  const onConflict = useCallback(async (): Promise<void> => {
    generationAbortControllerRef.current?.abort();
    setHasDraftConflict(true);
    setLatestConflictDraft(undefined);
    await loadLatestConflictDraft();
  }, [loadLatestConflictDraft]);
  const autosave = useDraftAutosave({
    value,
    enabled: initialized && userId !== undefined,
    baselineRevision,
    resetToken,
    save,
    onConflict,
  });
  const flushAutosave = autosave.flush;
  const flushDraft = useCallback(async (): Promise<PlannerDraft> => {
    const saved = await flushAutosave();
    // 保存完了前に始まった古い再取得で revision を逆行させないよう、cache 更新前に停止する。
    await queryClient.cancelQueries({
      queryKey: plannerKeys.draft(userId ?? "missing"),
      exact: true,
    });
    const current = queryClient.getQueryData<PlannerDraft | null>(
      plannerKeys.draft(userId ?? "missing"),
    );
    if (current !== undefined && current !== null && current.revision > saved.revision) {
      // 遅延した保存応答で別画面の新しい下書きを消さず、既存の明示的な競合解決へ合流させる。
      await onConflict();
      throw new DraftRevisionConflictError();
    }
    // 緊急献立側が staleTime 内の古い下書きを再利用しないよう、保存結果を遷移前に同期する。
    queryClient.setQueryData(plannerKeys.draft(userId ?? "missing"), saved);
    return saved;
  }, [flushAutosave, onConflict, queryClient, userId]);

  const resolveDraftConflict = useCallback((): void => {
    // Plan 2 §5: 最新行への切替は利用者の明示操作後だけ。取得完了だけでは value を触らない。
    if (latestConflictDraft === undefined || safetyQuery.data === undefined) return;
    const sanitized = sanitizeDraft(latestConflictDraft, safetyQuery.data.eligibleMemberIds);
    // 同じ render で表示値・保存 baseline・reset 世代を切り替え、混在状態を作らない。
    setValue(sanitized);
    setBaselineRevision(latestConflictDraft?.revision ?? 0);
    setResetToken((current) => current + 1);
    setLatestConflictDraft(undefined);
    setHasDraftConflict(false);
    setDraftConflictRefetchError(false);
  }, [latestConflictDraft, safetyQuery.data]);

  const hasAcceptedOrDeclinedPrivacy = hasCurrentPrivacyConsent(privacyQuery.data ?? null);
  const openPrivacyNotice = useCallback((): void => {
    // review resume 付きの returnTo で /privacy へ往復する（brief step 9）。
    // sanitizeReturnPath と同じ形へ揃えるため、pathとqueryをまとめて
    // encodeURIComponent した固定文字列を使う（"/planner?resume=review"）。
    void navigate("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
  }, [navigate]);

  // 設計 §5.1: AI を使わない緊急献立への導線。route が flush 後に navigate を所有する。
  const openEmergencyMenus = useCallback((): void => {
    if (
      isOpeningEmergencyMenus ||
      isSubmitting ||
      hasDraftConflict ||
      autosave.state === "saving"
    ) {
      return;
    }
    const operationId = ++emergencyOperationIdRef.current;
    setIsOpeningEmergencyMenus(true);
    setSubmissionError(null);
    void (async () => {
      try {
        await flushDraft();
        if (!mountedRef.current || operationId !== emergencyOperationIdRef.current) {
          return;
        }
        void navigate("/emergency-menus");
      } catch {
        if (mountedRef.current && operationId === emergencyOperationIdRef.current) {
          // 生成 flush 失敗と同じ文言で、保存できなかったことだけを伝える。
          setSubmissionError("献立条件を保存できなかったため、生成を開始しませんでした。");
          setIsOpeningEmergencyMenus(false);
        }
      }
    })();
  }, [
    autosave.state,
    flushDraft,
    hasDraftConflict,
    isOpeningEmergencyMenus,
    isSubmitting,
    navigate,
  ]);

  if ((!initialized && draftQuery.isError) || safetyQuery.isError || pantryQuery.isError) {
    return (
      <main className="page-frame">
        <p role="alert">献立条件を読み込めませんでした。再読み込みしてください。</p>
      </main>
    );
  }
  if (draftQuery.isPending || safetyQuery.isPending || pantryQuery.isPending || !initialized) {
    return (
      <main className="page-frame">
        <p>献立条件を読み込み中…</p>
      </main>
    );
  }
  return (
    <PlannerWizard
      key={resetToken}
      draft={value}
      step={step}
      eligibleMembers={safetyQuery.data.members}
      isSaving={
        autosave.state === "saving" || isSubmitting || hasDraftConflict || isOpeningEmergencyMenus
      }
      error={
        // 競合 chrome は wizard 側の明示 UI に任せる。ここでは audience skipped / submission / 利用上限。
        audienceStatusError ??
        submissionError ??
        (hasDraftConflict
          ? null
          : usage.data?.shortWindow.remaining === 0
            ? "10分間の通信試行上限に達しました。しばらくしてから再試行してください。"
            : null)
      }
      fieldErrors={fieldErrors}
      onDraftChange={setValue}
      onStepChange={setStep}
      onIdeaAudienceConfirmed={async () => {
        // 設計 §10: audience で idea を確定した時点で skipped を書く（主経路）。
        // fire-and-forget 禁止。profile 取得/RPC 失敗では throw して audience に留める。
        if (userId === undefined) {
          throw new Error("missing_user");
        }
        setAudienceStatusError(null);
        try {
          await ensureIdeaOnboardingSkipped(client, userId, queryClient);
        } catch (error) {
          if (error instanceof IdeaOnboardingSkipError && error.code === "profile_unavailable") {
            setAudienceStatusError(
              "家族設定の状態を確認できませんでした。再読み込みしてください。",
            );
          } else {
            setAudienceStatusError("開始状態を保存できませんでした。もう一度お試しください");
          }
          throw error instanceof Error ? error : new Error("onboarding_status_write_failed");
        }
      }}
      pantryItems={pantryQuery.data}
      pantryItemsStatus="loaded"
      attempt={attempt}
      onAttemptChange={setAttempt}
      hasAcceptedOrDeclinedPrivacy={hasAcceptedOrDeclinedPrivacy}
      onOpenPrivacyNotice={openPrivacyNotice}
      hasDraftConflict={hasDraftConflict}
      draftConflictRefetchError={draftConflictRefetchError}
      canResolveDraftConflict={latestConflictDraft !== undefined}
      onResolveDraftConflict={resolveDraftConflict}
      onRetryDraftConflict={() => {
        void loadLatestConflictDraft();
      }}
      onOpenEmergencyMenus={openEmergencyMenus}
      onSubmit={async () => {
        setSubmissionError(null);
        setFieldErrors({});
        const submissionCandidate: PlannerDraftInput = {
          mealType: value.mealType,
          mainIngredients: value.mainIngredients,
          cuisineGenre: value.cuisineGenre,
          targetMode: value.targetMode,
          targetMemberIds: value.targetMemberIds,
          servings: value.servings,
          timeLimitMinutes: value.timeLimitMinutes,
          budgetPreference: value.budgetPreference,
          avoidIngredients: value.avoidIngredients,
          memo: value.memo,
          pantrySelections: value.pantrySelections,
        };
        const parsed = plannerSubmissionSchema.safeParse(submissionCandidate);
        if (!parsed.success) {
          const { fieldErrors: nextFieldErrors, firstInvalidStep } =
            buildPlannerSubmissionFieldErrors(
              parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
            );
          setFieldErrors(nextFieldErrors);
          // brief: 「保存/APIの非field errorは上部alertだけへ表示」。
          // fieldへ正規化できたissueが1つ以上あるときはfield-local表示に委ね、
          // 全issueが未知pathだった場合だけ上部summaryへ出す。
          if (Object.keys(nextFieldErrors).length === 0) {
            setSubmissionError("入力内容を確認してください。");
          }
          if (firstInvalidStep !== null) setStep(firstInvalidStep);
          return;
        }
        // Plan 2 クライアント医療境界（サーバー preflight と同 detector）。
        // レビュー画面でも disabled にしているが、submit 経路でも再確認して AI 開始を止める。
        if (detectUnsupportedMedicalRequest(collectPlannerRequestText(value)).length > 0) {
          setSubmissionError(medicalRequestBlockedMessage);
          setStep("review");
          return;
        }
        if (startGeneration === undefined) return;
        setIsSubmitting(true);
        setAudienceStatusError(null);
        try {
          const saved = await flushDraft();
          if (!hasAcceptedOrDeclinedPrivacy) {
            openPrivacyNotice();
            return;
          }
          // resume で audience を踏まず review に着いた idea 下書きでも skipped を揃える安全網。
          // complete|skipped は no-op。取得/書込失敗では生成を開始しない（fail-closed）。
          if (parsed.data.targetMode === "idea" && userId !== undefined) {
            try {
              await ensureIdeaOnboardingSkipped(client, userId, queryClient);
            } catch (error) {
              if (
                error instanceof IdeaOnboardingSkipError &&
                error.code === "profile_unavailable"
              ) {
                setSubmissionError(
                  "家族設定の状態を確認できませんでした。再読み込みしてください。",
                );
              } else {
                setSubmissionError("開始状態を保存できませんでした。もう一度お試しください");
              }
              return;
            }
          }
          const controller = new AbortController();
          generationAbortControllerRef.current?.abort();
          generationAbortControllerRef.current = controller;
          try {
            const result = await startGeneration(saved, attempt, controller.signal);
            if (controller.signal.aborted || result === false) return;
            startNewAttempt();
          } finally {
            if (generationAbortControllerRef.current === controller) {
              generationAbortControllerRef.current = null;
            }
          }
        } catch {
          setSubmissionError("献立条件を保存できなかったため、生成を開始しませんでした。");
        } finally {
          setIsSubmitting(false);
        }
      }}
    />
  );
}

/** idea → skipped 書込の失敗理由。UI は code で文言を分岐する。 */
class IdeaOnboardingSkipError extends Error {
  readonly code: "profile_unavailable" | "write_failed";
  constructor(code: "profile_unavailable" | "write_failed", message?: string) {
    super(message ?? code);
    this.name = "IdeaOnboardingSkipError";
    this.code = code;
  }
}

/**
 * idea 確定時に not_started|in_progress なら skipped へ進める。
 * profile は cache miss 時に ensureQueryData → getProfile で権威取得する（/planner 直開き対応）。
 * complete|skipped は no-op。取得失敗・未知状態は profile_unavailable。RPC 失敗は write_failed。
 */
async function ensureIdeaOnboardingSkipped(
  client: ReturnType<typeof getBrowserSupabaseClient>,
  userId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<"written" | "skipped_noop"> {
  let profile: { onboarding_status?: string };
  try {
    profile = await queryClient.ensureQueryData({
      queryKey: householdKeys.profile(userId),
      queryFn: () => getProfile(client, userId),
    });
  } catch {
    throw new IdeaOnboardingSkipError("profile_unavailable");
  }
  const current = profile.onboarding_status;
  if (current === "complete" || current === "skipped") return "skipped_noop";
  if (current !== "not_started" && current !== "in_progress") {
    throw new IdeaOnboardingSkipError("profile_unavailable");
  }
  try {
    await setOnboardingStatus(client, userId, "skipped");
  } catch (error) {
    throw new IdeaOnboardingSkipError(
      "write_failed",
      error instanceof Error ? error.message : "write_failed",
    );
  }
  await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
  return "written";
}
