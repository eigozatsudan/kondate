import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import type { PantryItem } from "@shared/contracts/pantry";
import {
  collectPlannerRequestText,
  PLANNER_TARGET_MEMBER_LIMIT,
  plannerSubmissionSchema,
  type PlannerDraft,
  type PlannerDraftInput,
} from "@shared/contracts/planner";
import { privacyNoticeVersion } from "@shared/contracts/domain";
import { detectUnsupportedMedicalRequest } from "@shared/safety-pure/medical-scope";
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
import { expiryNotice } from "@/features/pantry/pantry-page";
import {
  claimPendingGeneration,
  clearPendingGeneration,
  createPendingGeneration,
  readPendingGeneration,
} from "@/features/generation/model/pending-generation";
import { reconcileTerminalPendingGeneration } from "@/features/generation/model/reconcile-terminal-pending";
import { savePendingGenerationMeta } from "@/features/generation/model/pending-generation-meta";
import { useResumablePendingAfterReconcile } from "@/features/generation/hooks/use-resumable-pending-after-reconcile";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import { historyKeys, listHistoryGroups } from "@/features/history/api/history-api";
import { getCurrentPrivacyConsent, hasCurrentPrivacyConsent } from "@/features/privacy/privacy-api";
import { privacyKeys } from "@/features/privacy/privacy-queries";
import { FLYER_WEEKLY_UI_ENABLED } from "@shared/contracts/flyer-weekly";
import { FlyerWeeklyPanel } from "@/features/flyer/flyer-weekly-panel";
import { PlannerWizard } from "./components/planner-wizard";
import { medicalRequestBlockedMessage } from "./components/review-step";
import type { HomeExpiringPantryItem } from "./home/home-expiring-pantry";
import { PlannerHome } from "./home/planner-home";
import {
  buildPlannerSubmissionFieldErrors,
  firstIncompletePlannerStep,
  type PlannerFieldName,
  type PlannerStep,
} from "./model/planner-wizard";
import type { PlannerSafetyMember } from "./planner-safety-member";
import {
  createPlannerAttempt,
  currentlyExpiredPantryItemIds,
  filterExpiredPantryChecksForSelections,
  hasCurrentExpiredConfirmation,
  isPastEnteredExpiry,
  persistSessionExpiredPantryChecks,
  type PlannerAttempt,
} from "./expired-pantry-checks";
import { resolvePlannerAllergyDisclosure } from "./planner-allergy-disclosure";
import { IncompleteDraftSaveError } from "./use-draft-autosave";
import {
  DraftRevisionConflictError,
  getPlannerDraft,
  plannerKeys,
  savePlannerDraft,
} from "./planner-api";
import { navigateAfterPlannerLeaveFlush, registerPlannerLeaveFlush } from "./planner-leave-flush";
import { useDraftAutosave } from "./use-draft-autosave";

/** ホームに載せる直近献立の件数上限（詰め込みすぎない）。 */
const HOME_RECENT_MENU_LIMIT = 5;
/** ホームに載せる期限注意食材の件数上限。 */
const HOME_EXPIRING_PANTRY_LIMIT = 5;

const emptyDraft: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  ingredientPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

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

/**
 * DB 行 (PlannerDraft) から入力形だけを取り出す。
 * id/revision/createdAt などを state に混ぜると autosave の strict schema が
 * 常に失敗し、確認画面で「保存できなかったため生成を開始しませんでした」になる。
 */
function toPlannerDraftInput(draft: PlannerDraft): PlannerDraftInput {
  return {
    mealType: draft.mealType,
    mainIngredients: draft.mainIngredients,
    cuisineGenre: draft.cuisineGenre,
    targetMode: draft.targetMode,
    targetMemberIds: [...draft.targetMemberIds],
    servings: draft.servings,
    timeLimitMinutes: draft.timeLimitMinutes,
    budgetPreference: draft.budgetPreference,
    ingredientPreference: draft.ingredientPreference,
    avoidIngredients: draft.avoidIngredients,
    memo: draft.memo,
    pantrySelections: draft.pantrySelections,
  };
}

function sanitizeDraft(
  draft: PlannerDraft | null,
  eligibleMemberIds: readonly string[],
): PlannerDraftInput {
  const eligibleIds = new Set(eligibleMemberIds);
  if (draft === null) {
    // 新規は対象未選択のまま。世帯+全員で埋めない（C-I4 / §8.3）
    return {
      ...emptyDraft,
      targetMemberIds: [],
      targetMode: null,
      servings: null,
    };
  }
  const input = toPlannerDraftInput(draft);
  if (input.targetMode === "idea") {
    // idea 対象は家族選択を持たないため、人数はそのまま保持する。
    return { ...input, targetMemberIds: [] };
  }
  const targetMemberIds = input.targetMemberIds
    .filter((id) => eligibleIds.has(id))
    .slice(0, PLANNER_TARGET_MEMBER_LIMIT);
  return {
    ...input,
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
    // U3-I6: 一部だけ解決できたとき、未解決分を silently drop しない
    let unresolvedAllergyCount = 0;
    const allergyNames = memberAllergies.flatMap((allergy) => {
      if (allergy.allergen_id !== null) {
        const displayName = allergenNames.get(allergy.allergen_id);
        if (displayName === undefined) {
          unresolvedAllergyCount += 1;
          return [];
        }
        return [displayName];
      }
      if (allergy.custom_confirmed && allergy.custom_name !== null) {
        return [allergy.custom_name];
      }
      if (allergy.custom_confirmed) {
        unresolvedAllergyCount += 1;
      }
      return [];
    });
    const blockedReason =
      member.allergy_status === "unconfirmed"
        ? "アレルギー確認が完了していません"
        : member.unsupported_diet_status === "unconfirmed"
          ? "対応対象の確認が完了していません"
          : member.unsupported_diet_status === "present"
            ? "離乳食・嚥下調整食・治療食には対応できません"
            : null;
    // §7.1 / P3: 具体名を常時表示。none でも未解決残存があれば「なし」に落とさない
    const rawAllergyStatus = member.allergy_status;
    const allergyStatus: "none" | "registered" | "unconfirmed" | null =
      rawAllergyStatus === "none" ||
      rawAllergyStatus === "registered" ||
      rawAllergyStatus === "unconfirmed"
        ? rawAllergyStatus
        : null;
    const disclosure = resolvePlannerAllergyDisclosure({
      allergyStatus,
      allergyNames,
      unresolvedAllergyCount,
    });
    return {
      id: member.id,
      displayName: member.display_name?.trim() || `家族${String(index + 1)}`,
      ageBandLabel:
        member.age_band === null ? "年齢未確認" : (ageLabels[member.age_band] ?? "年齢未確認"),
      allergyLabel: disclosure.allergyLabel,
      // カタログ解決不能・none+未解決・一部解決+未解決は allergyBlockedReason で選択不可
      blockedReason: blockedReason ?? disclosure.allergyBlockedReason,
      safetyLabels: member.required_safety_constraints.map(
        (constraint) => safetyLabels[constraint] ?? "安全上の個別対応",
      ),
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

// ルーターが実際にマウントする献立ページ。
// 「献立を作る」では pending を保存してすぐ /generation へ移る。
// POST は GenerationPage の useGenerationRecovery が recover して行う
// （再生成 useRegeneration と同型。planner で await startGeneration すると
//  POST 完了まで画面が切り替わらず、成功時に pending が消えて /generation が
//  idle→planner へ落ちるレースも起きる）。
// PlannerPage 自体はテスト向けに startGeneration を注入可能な薄いラッパーのまま変更しない。
export function PlannerRoutePage() {
  const userId = useAuth().session?.user.id;
  const navigate = useNavigate();
  // P3: startGeneration 内でも plan / quality.available を参照し qualityMode を再 clamp
  // （onSubmit 一枚依存を避ける）
  const usage = useUsageToday(userId ?? "");
  const planCode = usage.isSuccess ? usage.data.plan : null;
  const qualityAvailable = usage.isSuccess ? usage.data.quality.available : null;
  const startGeneration = useCallback(
    async (draft: PlannerDraft, attempt: PlannerAttempt, signal: AbortSignal): Promise<boolean> => {
      if (userId === undefined) return false;
      // 進行中 pending を上書きすると作成 ID が失われる（C2）。既存は再開のみ。
      // false を返し startNewAttempt を抑止する。true だと未消費 attempt
      // （期限確認など）が回転して捨てられる。
      // G-R1: terminal 済み sticky は status GET で clear し、新規作成を許す。
      // processing / status 失敗は keep→再開（G1/G2 維持。無条件 clear しない）。
      if (readPendingGeneration(userId, new Date()) !== null) {
        const outcome = await reconcileTerminalPendingGeneration(userId);
        if (outcome === "kept") {
          if (signal.aborted) return false;
          // 新規条件は送っていない。review の pending 注意文 + /generation?resumed=1 で明示する
          void navigate("/generation?resumed=1");
          return false;
        }
        // cleared / none: 下へ進み新 pending を書く
      }
      // P2: mode 判定は savePendingGeneration より前。throw 後に sticky pending を残さない。
      // household 補助文用 meta も new_menu のみ・draft.targetMode を正本に upsert。
      const mode = draft.targetMode;
      if (mode !== "household" && mode !== "idea") {
        // submission 通過後の経路では通常到達しない。pending を書かず生成開始も止める。
        throw new Error("target_mode_required");
      }
      // P1: 送信 confirmation は選択中 ∩ 期限切れのみ（attempt 残存 surplus を載せない）
      // onSubmit が selected∩expired 済みの checks を渡す前提。ここは選択中のみ再絞り。
      // P2/P3/P5: Free / 非 Plus / plan 未取得 / quality 枠なしでは qualityMode を必ず false
      // （onSubmit clamp をすり抜けた注入・将来呼び出しでも pending に true を載せない）
      const candidate = createPendingGeneration(
        {
          commandVersion: "generation-command.v3",
          kind: "new_menu",
          qualityMode: planCode === "plus" && qualityAvailable === true && attempt.qualityMode,
          request: {
            idempotencyKey: attempt.idempotencyKey,
            draftId: draft.id,
            draftRevision: draft.revision,
            privacyNoticeVersion,
            expiredPantryConfirmations: filterExpiredPantryChecksForSelections(
              attempt.expiredPantryChecks,
              draft.pantrySelections,
              // 期限切れは onSubmit 済み。選択 ∩ 残 checks で非選択 extra だけ落とす
              new Set(attempt.expiredPantryChecks.map((check) => check.pantryItemId)),
            ),
          },
        },
        userId,
      );
      // P1: dual-tab check-then-act を claim（Web Locks + 書込後 re-read）で閉じる。
      // 無条件 save だと他タブの進行中 sticky を last-writer で消す。負けたら C2 再開のみ。
      const claim = await claimPendingGeneration(candidate, userId, new Date());
      if (!claim.claimed) {
        if (signal.aborted) return false;
        // 他タブ（または先行）の sticky を上書きしていない。resumed で明示する
        void navigate("/generation?resumed=1");
        return false;
      }
      const pending = claim.pending;
      // savePendingGeneration 本体は targetMode を知らないため meta はここで書く。
      // P2: body→meta は非アトミック。meta が QuotaExceeded 等で throw すると body だけ sticky
      // に残り C2 再開導線と矛盾する。meta 失敗時は body+meta をまとめて消してから再 throw。
      // claimed 時のみ meta を書き、負けタブは他 sticky の meta を触らない。
      try {
        savePendingGenerationMeta({
          kind: "new_menu",
          targetMode: mode,
          idempotencyKey: pending.request.idempotencyKey,
          ownerUserId: userId,
          createdAt: pending.createdAt,
        });
      } catch (error) {
        clearPendingGeneration();
        throw error;
      }
      // strip/abort が claim 後に走った場合は自タブ sticky 再開導線を残さない
      if (signal.aborted) {
        clearPendingGeneration();
        return false;
      }
      void navigate("/generation");
      return true;
    },
    [navigate, planCode, qualityAvailable, userId],
  );
  return <PlannerPage startGeneration={startGeneration} />;
}

type PlannerPageForOwnerProps = {
  userId: string | undefined;
  startGeneration: PlannerPageProps["startGeneration"];
};

function PlannerPageForOwner({ userId, startGeneration }: PlannerPageForOwnerProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const client = getBrowserSupabaseClient();
  // G-R4: home/review の再開 UI は status reconcile 後の kept のみ（localStorage 非 null だけでは出さない）
  const { hasResumablePending, pendingDisplayReady } = useResumablePendingAfterReconcile(userId);
  const draftQuery = useQuery({
    queryKey: plannerKeys.draft(userId ?? "missing"),
    queryFn: () => getPlannerDraft(client, userId ?? ""),
    enabled: userId !== undefined,
  });
  const safetyQuery = useQuery({
    queryKey: [...householdKeys.members(userId ?? "missing"), "planner-safety"],
    queryFn: () => loadPlannerSafetyData(userId ?? ""),
    enabled: userId !== undefined,
    // P11: default staleTime 30s だと同一 ID のアレルギー強化が最大 30s 開示遅延する
    staleTime: 0,
  });
  const pantryQuery = useQuery({
    queryKey: pantryKeys.list(userId ?? "missing"),
    queryFn: () => listPantryItems(client, userId ?? ""),
    enabled: userId !== undefined,
    // P12: default 30s だと expiresOn 変更が最大 ~30s 遅延。safety と同様 0 で即再検証。
    staleTime: 0,
  });
  const usage = useUsageToday(userId ?? "");
  const privacyQuery = useQuery({
    queryKey: privacyKeys.current(userId ?? "missing"),
    queryFn: () => getCurrentPrivacyConsent(client, userId ?? ""),
    enabled: userId !== undefined,
  });
  // ホームの直近献立。取得失敗はホーム内 soft error に留め、ウィザード契約は壊さない。
  const historyQuery = useQuery({
    queryKey: historyKeys.groups(userId ?? "missing"),
    queryFn: () => listHistoryGroups(),
    enabled: userId !== undefined,
    staleTime: 30_000,
  });
  const [value, setValue] = useState<PlannerDraftInput>(emptyDraft);
  const [initialized, setInitialized] = useState(false);
  /**
   * ホーム vs ウィザード。
   * - `?resume=` 付き → 常にウィザード（不変契約 4b の深リンク）
   * - 生成中断（resumable pending）あり → ホーム優先（再開 CTA を最上位に）
   * - 下書き進捗あり・pending なし → ウィザード復帰
   * - 空下書き・pending なし → ホーム
   */
  const [wizardOpen, setWizardOpen] = useState(false);
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
  // P6/P8: privacy・settings 遷移中は isSaving に載せ二重 flush/navigate を抑止
  const [isOpeningPrivacy, setIsOpeningPrivacy] = useState(false);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);
  // P5: leave-flush 中も isSaving に載せる（generate 無言 no-op / post-flush 編集窓を閉じる）
  // ref は同期ガード、state は disabled 再描画用（privacy/settings と同型）。
  const [isLeaving, setIsLeaving] = useState(false);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  // 緊急献立遷移の single-flight と unmount 後の遅延 navigate 抑止。
  const mountedRef = useRef(true);
  const emergencyOperationIdRef = useRef(0);
  // P1: 生成 submit の operationId。strip で無効化し flush 後の startGeneration を止める
  const submitOperationIdRef = useRef(0);
  // P8: isSubmitting の再描画前に二重 onSubmit しない同期ガード
  const submittingRef = useRef(false);
  // P6: privacy/settings の single-flight（再描画前の連打抑止）
  const privacyOpeningRef = useRef(false);
  const settingsOpeningRef = useRef(false);
  // P1: 緊急献立 open の同期 single-flight（state 再描画前に generate と二重 flight しない）
  const emergencyOpeningRef = useRef(false);
  // P1: leave-flush 中の同期 single-flight。generate/settings/privacy/emergency が mid-leave に
  // 起動しないよう武装し、post-flush でも submitting/opening を再確認する。
  // proceed 時は unmount まで落さない（handler return → shell navigate の隙間に generate を許さない）。
  // P5: isLeaving state と対で isSaving に載せ、wizard 編集・生成 CTA を visually disable する。
  const leaveInFlightRef = useRef(false);
  // timeout 後の遅延 flush が proceed ロックを再武装しないよう flight 世代で stale 判定する。
  const leaveFlightIdRef = useRef(0);
  // P2: leave-flush handler は mount 時のみ register。state は ref で読み stale クロージャと
  // deps 更新時 cleanup→null の窓を避ける（submittingRef と同型）。
  const hasDraftConflictRef = useRef(false);
  const isOpeningEmergencyMenusRef = useRef(false);
  const isOpeningPrivacyRef = useRef(false);
  const isOpeningSettingsRef = useRef(false);
  const flushDraftRef = useRef<() => Promise<PlannerDraft>>(() =>
    Promise.reject(new Error("flush_not_ready")),
  );
  hasDraftConflictRef.current = hasDraftConflict;
  isOpeningEmergencyMenusRef.current = isOpeningEmergencyMenus;
  isOpeningPrivacyRef.current = isOpeningPrivacy;
  isOpeningSettingsRef.current = isOpeningSettings;
  // P1: 利用者 reset 直後だけ route が flush を await する印（conflict resolve の resetToken とは分離）
  const resetFlushGenerationRef = useRef(0);
  const pendingResetFlushRef = useRef(false);
  // P1: onSubmit の flush 後再検証用。render クロージャの safetyData より最新の eligible を見る
  const eligibleMemberIdsRef = useRef<readonly string[]>([]);
  // P3: flush 後の pantry 再検証用。pre-flush 時点の snapshot だけでは削除/期限更新 TOCTOU が残る
  const pantryRowsRef = useRef<readonly PantryItem[]>([]);
  const startNewAttempt = useCallback(() => {
    setAttempt(createPlannerAttempt());
  }, []);

  useEffect(() => {
    if (safetyQuery.data === undefined) return;
    eligibleMemberIdsRef.current = safetyQuery.data.eligibleMemberIds;
  }, [safetyQuery.data]);

  useEffect(() => {
    if (pantryQuery.data === undefined) return;
    pantryRowsRef.current = pantryQuery.data;
  }, [pantryQuery.data]);

  // P2/P5: Free / plan 未取得 / quality 枠なしへ降格したら qualityMode を false に同期
  // （UI checked と state のズレ防止。サーバ quality_*_limit 前の sticky true を避ける）
  const planCode = usage.isSuccess ? usage.data.plan : null;
  const qualityAvailable = usage.isSuccess ? usage.data.quality.available : null;
  useEffect(() => {
    if (planCode === "plus" && qualityAvailable === true) return;
    if (!attempt.qualityMode) return;
    setAttempt((current) => (current.qualityMode ? { ...current, qualityMode: false } : current));
  }, [attempt.qualityMode, planCode, qualityAvailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      emergencyOperationIdRef.current += 1;
      generationAbortControllerRef.current?.abort();
    };
  }, []);

  // P6: post-init の ?resume= 反応で最新 value を読む（search 変更時だけ step を触る）
  const valueForResumeRef = useRef(emptyDraft);

  useEffect(() => {
    // G-R4: sticky pending の terminal/in-flight 照合が終わるまで init しない
    // （照合前に home「作成中」や draft 進捗での wizard を確定させない）
    if (
      draftQuery.data === undefined ||
      safetyQuery.data === undefined ||
      initialized ||
      !pendingDisplayReady
    ) {
      return;
    }
    const sanitized = sanitizeDraft(draftQuery.data, safetyQuery.data.eligibleMemberIds);
    setValue(sanitized);
    valueForResumeRef.current = sanitized;
    setBaselineRevision(draftQuery.data?.revision ?? 0);
    // 下書きの回答状況からresume先stepを判定する（brief: 「resumes an incomplete
    // target draft at audience without losing answers」）。
    // privacy 往復後の resume=review は、下書きが確認まで揃っているときだけ step を固定する
    // （本命は openPrivacyNotice の flush+cache。resume は二重の安全策）。
    const firstIncomplete = firstIncompletePlannerStep(sanitized);
    if (searchParams.get("resume") === "review" && firstIncomplete === "review") {
      setStep("review");
    } else {
      setStep(firstIncomplete);
    }
    // ホーム / ウィザードの初期分岐:
    // 1) ?resume= は深リンク契約を最優先してウィザード（privacy 往復など）
    // 2) 進行中 pending（G-R4: reconcile kept）があるときはホームを優先し再開 CTA を最上位に
    //    （設計意図: 生成が中断されている場合はそれが最優先で目に入ること）
    //    完全回答済み下書きは firstIncomplete が必ず "review" になるため、pending を
    //    見ずに hasDraftProgress だけで分岐するとホームの再開導線に永久に届かない。
    // 3) 再開対象 pending 無しで下書き進捗があるときだけウィザードへ自動復帰
    //    （terminal sticky は G-R1 clear 後ここに落ち、新規作成可能な wizard へ）
    const hasResumeQuery = searchParams.get("resume") !== null;
    const hasDraftProgress = firstIncomplete !== "meal";
    setWizardOpen(hasResumeQuery || (hasDraftProgress && !hasResumablePending));
    setInitialized(true);
  }, [
    draftQuery.data,
    hasResumablePending,
    initialized,
    pendingDisplayReady,
    safetyQuery.data,
    searchParams,
    userId,
  ]);

  // value 更新を resume 用 ref へ同期（P6 effect は searchParams 変化時だけ読む）
  useEffect(() => {
    valueForResumeRef.current = value;
  }, [value]);

  // P6: 既に mount 済みの /planner でも ?resume= 後付けでウィザードを開く（不変契約 4b の同一インスタンス）。
  // init effect は initialized 後 no-op のため、resume 文字列変化専用の経路を持つ。
  // searchParams オブジェクト参照ではなく get("resume") 結果に依存し、毎 render の再実行を避ける。
  // P5: eligible を渡し、strip 前でも blocked ID のまま review に着地しない。
  const resumeQuery = searchParams.get("resume");
  useEffect(() => {
    if (!initialized) return;
    if (resumeQuery === null) return;
    const eligible =
      safetyQuery.data !== undefined ? new Set(safetyQuery.data.eligibleMemberIds) : undefined;
    const firstIncomplete = firstIncompletePlannerStep(valueForResumeRef.current, eligible);
    if (resumeQuery === "review" && firstIncomplete === "review") {
      setStep("review");
    } else {
      setStep(firstIncomplete);
    }
    setWizardOpen(true);
  }, [initialized, resumeQuery, safetyQuery.data]);

  // Plan 2: 家族の利用可否が後から変わった場合も、無効メンバーを下書きに残さない。
  // idea は家族 ID を持たないため触らない。household が 0 件になっても idea へ自動降格しない。
  // 緊急献立への遷移中に対象が消えたら navigate を中止し、無言で /emergency-menus へ落ちない。
  // P1: 生成 submit 中の strip も operationId 無効化 + abort で startGeneration を止める（緊急と同型）。
  // GP-I1 / guided §10: 選択家族が削除・未完了・利用不可になったら対象ステップへ戻す。
  // P7: setValue は functional updater で concurrent memo/pantry 編集を last-writer-wins で潰さない。
  // deps は targetMode/targetMemberIds に絞り、無関係な value 変更で strip を再走らせない。
  const stripTargetMode = value.targetMode;
  const stripTargetMemberIds = value.targetMemberIds;
  useEffect(() => {
    if (!initialized || safetyQuery.data === undefined) return;
    if (stripTargetMode === "idea") return;
    const eligibleIds = new Set(safetyQuery.data.eligibleMemberIds);
    const needsStrip = stripTargetMemberIds.some((id) => !eligibleIds.has(id));
    if (!needsStrip) return;
    if (isOpeningEmergencyMenus || emergencyOpeningRef.current) {
      // strip で緊急 flight を無効化し、同期 ref も落として generate を再解放する
      emergencyOperationIdRef.current += 1;
      emergencyOpeningRef.current = false;
      setIsOpeningEmergencyMenus(false);
      setSubmissionError("作る相手の条件が変わったため、緊急献立への移動を中止しました。");
    } else if (
      isSubmitting ||
      submittingRef.current ||
      generationAbortControllerRef.current !== null
    ) {
      // flush 中〜startGeneration 中の strip: 進行中 submit を無効化し audience へ戻す
      submitOperationIdRef.current += 1;
      generationAbortControllerRef.current?.abort();
      generationAbortControllerRef.current = null;
      submittingRef.current = false;
      setIsSubmitting(false);
      setSubmissionError(
        "作る相手の条件が変わったため、対象の選び直しが必要です。家族を確認してください。",
      );
    } else {
      setSubmissionError(
        "作る相手の条件が変わったため、対象の選び直しが必要です。家族を確認してください。",
      );
    }
    // P7: クロージャ snapshot を広げず prev を基準に members だけ差し替える
    setValue((prev) => {
      if (prev.targetMode === "idea") return prev;
      const nextIds = prev.targetMemberIds.filter((id) => eligibleIds.has(id));
      if (nextIds.length === prev.targetMemberIds.length) return prev;
      return {
        ...prev,
        targetMemberIds: nextIds,
        targetMode: nextIds.length > 0 ? "household" : null,
        servings: null,
      };
    });
    setStep("audience");
  }, [
    initialized,
    isOpeningEmergencyMenus,
    isSubmitting,
    safetyQuery.data,
    stripTargetMemberIds,
    stripTargetMode,
  ]);

  const save = useCallback(
    async (next: PlannerDraftInput, revision: number) => {
      try {
        return await savePlannerDraft(client, userId ?? "", next, revision);
      } catch (error) {
        // 生成成功後に下書きは soft-delete され revision も進む。クライアントが古い
        // revision を掴んだままだと conflict になる。live 行が無いときだけ rev=0 で
        // 復活保存を1回試す（save_generation_draft の undelete 経路）。
        if (!(error instanceof DraftRevisionConflictError) || revision === 0) {
          throw error;
        }
        if (userId === undefined) throw error;
        let live: PlannerDraft | null;
        try {
          live = await getPlannerDraft(client, userId);
        } catch {
          // live 確認自体が失敗したら元の conflict を維持（競合 UI / 再取得経路へ）
          throw error;
        }
        if (live !== null) throw error;
        return await savePlannerDraft(client, userId, next, 0);
      }
    },
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
    // P2: setState 再描画前に leave-flush が conflict を読めるよう ref を先に武装
    hasDraftConflictRef.current = true;
    setHasDraftConflict(true);
    setLatestConflictDraft(undefined);
    await loadLatestConflictDraft();
  }, [loadLatestConflictDraft]);
  // autosave 確定後に draft cache を進め、reset/離脱後の remount で旧下書きが戻らないようにする
  const onDraftSaved = useCallback(
    (draft: PlannerDraft) => {
      const key = plannerKeys.draft(userId ?? "missing");
      const current = queryClient.getQueryData<PlannerDraft | null>(key);
      if (current !== undefined && current !== null && current.revision > draft.revision) {
        return;
      }
      queryClient.setQueryData(key, draft);
    },
    [queryClient, userId],
  );
  const autosave = useDraftAutosave({
    value,
    enabled: initialized && userId !== undefined,
    baselineRevision,
    resetToken,
    save,
    onConflict,
    onSaved: onDraftSaved,
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
  // P2: leave-flush は mount 時 handler 固定のため、最新 flush を ref 経由で読む
  flushDraftRef.current = flushDraft;

  const resolveDraftConflict = useCallback((): void => {
    // Plan 2 §5: 最新行への切替は利用者の明示操作後だけ。取得完了だけでは value を触らない。
    if (latestConflictDraft === undefined || safetyQuery.data === undefined) return;
    const sanitized = sanitizeDraft(latestConflictDraft, safetyQuery.data.eligibleMemberIds);
    // 同じ render で表示値・保存 baseline・reset 世代を切り替え、混在状態を作らない。
    setValue(sanitized);
    // P5: 最新が incomplete でも step を review に残さず firstIncomplete へ再整列する
    setStep(firstIncompletePlannerStep(sanitized));
    setWizardOpen(true);
    setBaselineRevision(latestConflictDraft?.revision ?? 0);
    setResetToken((current) => current + 1);
    setLatestConflictDraft(undefined);
    hasDraftConflictRef.current = false;
    setHasDraftConflict(false);
    setDraftConflictRefetchError(false);
  }, [latestConflictDraft, safetyQuery.data]);

  /** 利用者の明示操作で入力を空に戻す。autosave が resetToken 経由で空下書きをサーバへ保存する（P1）。 */
  const resetPlannerDraft = useCallback((): void => {
    // 生成成功後の navigate commit 前に sticky pending を捨てると /generation が idle へ落ちる。
    if (submittingRef.current) {
      return;
    }
    generationAbortControllerRef.current?.abort();
    // 進行中の作成 ID（pending）を残すと、再「献立を作る」が C2 再開専用になり
    // offline/processing から抜けられず操作不能になる。入力リセットは作成の破棄も兼ねる。
    clearPendingGeneration();
    const empty = { ...emptyDraft };
    setValue(empty);
    setStep("meal");
    setFieldErrors({});
    setSubmissionError(null);
    setAudienceStatusError(null);
    setAttempt(createPlannerAttempt());
    hasDraftConflictRef.current = false;
    setHasDraftConflict(false);
    setLatestConflictDraft(undefined);
    setDraftConflictRefetchError(false);
    // hydrate 時の baseline ではなく、autosave が把握している現 revision を渡す。
    // 古い baseline のまま resetToken すると revisionRef が巻き戻り conflict になる。
    setBaselineRevision(autosave.revision);
    // P1: 強制 empty の完了を後続 effect が await する（fire-and-forget 握りつぶし禁止）
    resetFlushGenerationRef.current += 1;
    pendingResetFlushRef.current = true;
    setResetToken((current) => current + 1);
    // 強制 empty 保存完了前の remount で旧 cache が戻らないよう、入力フィールドだけ空に揃える
    const key = plannerKeys.draft(userId ?? "missing");
    const current = queryClient.getQueryData<PlannerDraft | null>(key);
    if (current !== undefined && current !== null) {
      queryClient.setQueryData(key, { ...current, ...empty });
    }
  }, [autosave.revision, queryClient, userId]);

  // P1: 利用者 reset 直後だけ強制 empty 保存を await し、失敗を submissionError で可視化する。
  // resolveDraftConflict の resetToken バンプでは走らせない（autosave 側の force save に任せる）。
  // flush は pending force save を await するため二重 RPC にはならない（成功時は同一結果）。
  useEffect(() => {
    if (!pendingResetFlushRef.current) return;
    pendingResetFlushRef.current = false;
    const generation = resetFlushGenerationRef.current;
    void (async () => {
      try {
        await flushDraft();
      } catch (error) {
        if (!mountedRef.current || generation !== resetFlushGenerationRef.current) return;
        if (error instanceof IncompleteDraftSaveError) return;
        if (error instanceof DraftRevisionConflictError) return;
        // P7: 画面は空でもサーバ旧下書きが残る可能性を明示（楽観 reset の残差）
        setSubmissionError(
          "入力のリセットをサーバへ保存できませんでした。画面上は空ですが、通信が直るまで以前の条件が残っている可能性があります。通信を確認し、再試行またはもう一度リセットしてください。",
        );
      }
    })();
  }, [flushDraft, resetToken]);

  // 同意のみが生成許可。拒否（「今はAIを使わない」）は永続化せず、毎回ゲートする。
  // AP9 residual-intentional: hasAcceptedOrDeclinedPrivacy 名は declined 永続を意味しない。
  // AP5: isError かつ data 無しは未同意に潰さず loadFailed としてエラー UI へ（生成は fail-closed）。
  const privacyConsentLoadFailed = privacyQuery.isError && privacyQuery.data === undefined;
  const hasAcceptedPrivacy = privacyConsentLoadFailed
    ? false
    : hasCurrentPrivacyConsent(privacyQuery.data ?? null);
  const retryPrivacyConsent = useCallback((): void => {
    void privacyQuery.refetch();
  }, [privacyQuery]);
  /**
   * privacy へ flush→navigate する本体。
   * P6/P8: single-flight + conflict/緊急 ガード。成功時 true。
   * P4: autosave saving 中は leave と同型で同一キューへ join（無言 early-return しない）。
   * onSubmit から await して委譲完了まで submitting を維持する。
   */
  const runPrivacyNavigation = useCallback(async (): Promise<boolean> => {
    if (
      privacyOpeningRef.current ||
      emergencyOpeningRef.current ||
      leaveInFlightRef.current ||
      isOpeningEmergencyMenus ||
      isOpeningSettings ||
      hasDraftConflict
    ) {
      return false;
    }
    privacyOpeningRef.current = true;
    setIsOpeningPrivacy(true);
    setSubmissionError(null);
    try {
      // privacy 往復前に下書きを flush し、react-query cache へ同期する。
      // 未 flush だと return 時に stale な draft で step 1 へ巻き戻る。
      await flushDraft();
      if (!mountedRef.current) return false;
      // review resume 付きの returnTo で /privacy へ往復する（brief step 9）。
      // sanitizeReturnPath と同じ形へ揃えるため、pathとqueryをまとめて
      // encodeURIComponent した固定文字列を使う（"/planner?resume=review"）。
      void navigate("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
      return true;
    } catch (error) {
      // P10: Incomplete は schema 非 persistable の意図的拒否（RPC しない）。
      // leave/settings と同型で privacy 往復を通信文言で塞がない。
      if (error instanceof IncompleteDraftSaveError) {
        if (!mountedRef.current) return false;
        void navigate("/privacy?returnTo=%2Fplanner%3Fresume%3Dreview");
        return true;
      }
      // P2: revision conflict は onConflict が競合 chrome を武装済み。
      // 通信障害文言と並立させず chrome に一本化する。
      if (error instanceof DraftRevisionConflictError) {
        return false;
      }
      if (mountedRef.current) {
        setSubmissionError("献立条件を保存できなかったため、説明画面へ進めませんでした。");
      }
      return false;
    } finally {
      privacyOpeningRef.current = false;
      if (mountedRef.current) {
        setIsOpeningPrivacy(false);
      }
    }
  }, [flushDraft, hasDraftConflict, isOpeningEmergencyMenus, isOpeningSettings, navigate]);

  // シグネチャは () => void のまま（wizard の onOpenPrivacyNotice）。
  // 生成 submit 中の privacy ボタンは isSaving で disabled。single-flight は run 本体。
  const openPrivacyNotice = useCallback((): void => {
    if (isSubmitting || submittingRef.current) return;
    void runPrivacyNavigation();
  }, [isSubmitting, runPrivacyNavigation]);

  // 設計 §5.1: AI を使わない緊急献立への導線。route が flush 後に navigate を所有する。
  // P1: privacy/settings/generate と同型の同期 single-flight（submittingRef / emergencyOpeningRef）。
  // P4: autosave saving 中は leave と同型で同一キューへ join（無言 early-return しない）。
  const openEmergencyMenus = useCallback((): void => {
    if (
      emergencyOpeningRef.current ||
      leaveInFlightRef.current ||
      isOpeningEmergencyMenus ||
      isSubmitting ||
      submittingRef.current ||
      privacyOpeningRef.current ||
      settingsOpeningRef.current ||
      isOpeningPrivacy ||
      isOpeningSettings ||
      hasDraftConflict
    ) {
      return;
    }
    // P7: 生成主 CTA と同型。safety/pantry soft 失敗中は previous 期限データで緊急を進めない。
    const staleSafetyPantry =
      initialized &&
      ((safetyQuery.isError && safetyQuery.data !== undefined) ||
        (pantryQuery.isError && pantryQuery.data !== undefined));
    if (staleSafetyPantry) {
      setSubmissionError("家族または冷蔵庫の最新情報を再取得してから緊急献立を開いてください。");
      return;
    }
    // PE4: 生成と同型。未確認の期限切れ pantry があるうちは緊急へ進めない。
    // サーバも expires_on でスコア対象から外すが、導線で実物確認を先に求める。
    // pantryData 定数は後段 early-return の後に置くため、ここでは query.data を直接見る。
    const pantryRows = pantryQuery.data ?? [];
    const nowForExpiry = new Date();
    const hasUnconfirmedExpired = value.pantrySelections.some((selection) => {
      const item = pantryRows.find((entry) => entry.id === selection.pantryItemId);
      if (item === undefined) return false;
      return (
        isPastEnteredExpiry(item, nowForExpiry) &&
        !hasCurrentExpiredConfirmation(attempt, item.id, nowForExpiry)
      );
    });
    if (hasUnconfirmedExpired) {
      setSubmissionError(
        "期限切れの食材が選ばれています。冷蔵庫の食材で確認してから緊急献立を開いてください。",
      );
      return;
    }
    // P1: setState 再描画前に ref を武装し、generate onSubmit との二重 flight を同期抑止
    const operationId = ++emergencyOperationIdRef.current;
    emergencyOpeningRef.current = true;
    setIsOpeningEmergencyMenus(true);
    setSubmissionError(null);
    void (async () => {
      try {
        const saved = await flushDraft();
        if (!mountedRef.current || operationId !== emergencyOperationIdRef.current) {
          return;
        }
        // P4: 生成 onSubmit と同型。sticky/navigate 前に list を再読し client cache と
        // サーバ期限集合のズレ（PE8 session TOCTOU）を縮める。再読失敗時は既存 ref で続行。
        if (userId !== undefined) {
          try {
            const freshPantry = await listPantryItems(client, userId);
            // await 跨ぎ: CFA が mounted/operationId を畳まないよう関数経由で再読
            if (!isPlannerOperationStillActive(mountedRef, operationId, emergencyOperationIdRef)) {
              return;
            }
            pantryRowsRef.current = freshPantry;
            queryClient.setQueryData(pantryKeys.list(userId), freshPantry);
          } catch {
            // 既存 pantryRowsRef でゲート・session を組み立てる
          }
        }
        // P3: flush 中の pantry 削除/期限更新 TOCTOU を pantryRowsRef で再検証（生成 post-flush と同型）。
        // pre-flush 成功だけでは session に載せてから失敗したときの stale handoff が残る。
        {
          const pantryRowsLatest = pantryRowsRef.current;
          const pantryIdSetLatest = new Set(pantryRowsLatest.map((item) => item.id));
          if (
            saved.pantrySelections.some(
              (selection) => !pantryIdSetLatest.has(selection.pantryItemId),
            )
          ) {
            setSubmissionError(
              "冷蔵庫から削除された食材の選択を解除してから緊急献立を開いてください。",
            );
            return;
          }
          const nowForExpiryPostFlush = new Date();
          const hasUnconfirmedExpiredPostFlush = saved.pantrySelections.some((selection) => {
            const item = pantryRowsLatest.find((entry) => entry.id === selection.pantryItemId);
            if (item === undefined) return false;
            return (
              isPastEnteredExpiry(item, nowForExpiryPostFlush) &&
              !hasCurrentExpiredConfirmation(attempt, item.id, nowForExpiryPostFlush)
            );
          });
          if (hasUnconfirmedExpiredPostFlush) {
            setSubmissionError(
              "期限切れの食材が選ばれています。冷蔵庫の食材で確認してから緊急献立を開いてください。",
            );
            return;
          }
        }
        // PE8: post-flush 通過後・navigate 直前だけ session に載せる。
        // flush 失敗や post-flush ゲート失敗で planner に留まる経路に stale 当日確認を残さない。
        // P8: 非選択・期限切れ解消後の attempt surplus は session に載せない
        // （緊急側 hasExpiredPantryConfirmation が dialog を誤抑止しないよう selected∩expired）。
        // list 再読 await 後なので operationId を再確認してから session/navigate する。
        // CFA が 843 の判定で畳まないよう submit と同型の関数経由。
        if (!isPlannerOperationStillActive(mountedRef, operationId, emergencyOperationIdRef)) {
          return;
        }
        if (userId !== undefined) {
          const nowForSession = new Date();
          persistSessionExpiredPantryChecks(
            userId,
            filterExpiredPantryChecksForSelections(
              attempt.expiredPantryChecks,
              saved.pantrySelections,
              currentlyExpiredPantryItemIds(pantryRowsRef.current, nowForSession),
              nowForSession,
            ),
            nowForSession,
          );
        }
        void navigate("/emergency-menus");
      } catch (error) {
        if (mountedRef.current && operationId === emergencyOperationIdRef.current) {
          // C-I14: 緊急導線の保存失敗は生成失敗と別文言（生成していないのに「生成」と言わない）。
          // idea+人数未設定の Incomplete は通信障害と誤認しない
          // P2: revision conflict は onConflict の競合 chrome に一本化（通信文言を立てない）
          if (error instanceof IncompleteDraftSaveError) {
            setSubmissionError(
              "人数など必要な条件が未設定のため、緊急献立を開けませんでした。確認画面で内容を見直してください。",
            );
          } else if (!(error instanceof DraftRevisionConflictError)) {
            setSubmissionError(
              "条件を保存できなかったため、緊急献立を開けませんでした。通信を確認して再度お試しください。",
            );
          }
        }
      } finally {
        // 遷移後もフラグを落とす。route が残る経路で isSaving が固着し wizard が死ぬのを防ぐ。
        // strip が operationId を進めて ref を落としている場合は上書きしない。
        if (operationId === emergencyOperationIdRef.current) {
          emergencyOpeningRef.current = false;
          if (mountedRef.current) {
            setIsOpeningEmergencyMenus(false);
          }
        }
      }
    })();
  }, [
    attempt,
    client,
    flushDraft,
    hasDraftConflict,
    initialized,
    isOpeningEmergencyMenus,
    isOpeningPrivacy,
    isOpeningSettings,
    isSubmitting,
    navigate,
    pantryQuery.data,
    pantryQuery.isError,
    queryClient,
    safetyQuery.data,
    safetyQuery.isError,
    userId,
    value.pantrySelections,
  ]);

  // P5: settings 遷移も privacy/緊急と同様に flush 完了を待ってから navigate する。
  // Link 直遷移だと unmount dirty flush の失敗が黙殺され、サーバ旧下書きが正本のまま残る。
  // P6: 緊急と同型の conflict/submitting/single-flight ガード。
  // P4: autosave saving 中は leave と同型で同一キューへ join（無言 early-return しない）。
  const openSettings = useCallback((): void => {
    if (
      settingsOpeningRef.current ||
      emergencyOpeningRef.current ||
      leaveInFlightRef.current ||
      isOpeningEmergencyMenus ||
      isOpeningPrivacy ||
      isSubmitting ||
      submittingRef.current ||
      hasDraftConflict
    ) {
      return;
    }
    settingsOpeningRef.current = true;
    setIsOpeningSettings(true);
    setSubmissionError(null);
    void (async () => {
      try {
        await flushDraft();
        if (!mountedRef.current) return;
        void navigate("/settings");
      } catch (error) {
        if (!mountedRef.current) return;
        // P3: Incomplete は意図的に非 persist な途中状態。settings は complete 不要のため
        // アレルギー直し導線を塞がず proceed（通信失敗文言に畳まない）。
        if (error instanceof IncompleteDraftSaveError) {
          void navigate("/settings");
          return;
        }
        // P2: revision conflict は onConflict の競合 chrome に一本化（通信文言を立てない）
        if (error instanceof DraftRevisionConflictError) {
          return;
        }
        setSubmissionError(
          "条件を保存できなかったため、家族設定を開けませんでした。通信を確認して再度お試しください。",
        );
      } finally {
        settingsOpeningRef.current = false;
        if (mountedRef.current) {
          setIsOpeningSettings(false);
        }
      }
    })();
  }, [
    flushDraft,
    hasDraftConflict,
    isOpeningEmergencyMenus,
    isOpeningPrivacy,
    isSubmitting,
    navigate,
  ]);

  // P2: シェル下ナビ leave でも settings と同型に flush を await し、失敗を submissionError で可視化する。
  // unmount enqueue の握りつぶしだけだと黙ってサーバ旧 revision が正本のまま残る。
  // saving 中は flush が同一キューを await するのでガードせず join する。
  // P2: mount 時のみ register。handler は ref 経由で最新 conflict / opening / flush を読む。
  // deps 更新のたび cleanup で null すると下ナビ click が即 proceed になる窓が残る。
  useEffect(() => {
    registerPlannerLeaveFlush(
      async () => {
        // P1: 既に leave 中なら二重 leave しない（module mutex の第二防衛）。
        if (leaveInFlightRef.current) {
          return "blocked";
        }
        // P4: ガード blocked は無言 stay にせず理由を可視化する。
        // 競合中は chrome に委任し、home では chrome が無いため wizard を開く。
        if (hasDraftConflictRef.current) {
          if (mountedRef.current) {
            setWizardOpen(true);
          }
          return "blocked";
        }
        if (
          settingsOpeningRef.current ||
          emergencyOpeningRef.current ||
          privacyOpeningRef.current ||
          isOpeningEmergencyMenusRef.current ||
          isOpeningPrivacyRef.current ||
          isOpeningSettingsRef.current
        ) {
          if (mountedRef.current) {
            setSubmissionError(
              "別の操作の処理中のため、移動できませんでした。完了後にもう一度お試しください。",
            );
          }
          return "blocked";
        }
        if (submittingRef.current) {
          if (mountedRef.current) {
            setSubmissionError(
              "献立の作成処理中のため、移動できませんでした。完了後にもう一度お試しください。",
            );
          }
          return "blocked";
        }
        // P1: flush await 前に武装。generate/openers が mid-leave を見られるようにする。
        // P5: isLeaving を立て isSaving 経由で CTA/編集を disable（無言 generate no-op と post-flush 編集を防ぐ）。
        const flightId = ++leaveFlightIdRef.current;
        leaveInFlightRef.current = true;
        if (mountedRef.current) {
          setIsLeaving(true);
        }
        const isCurrentLeaveFlight = (): boolean => leaveFlightIdRef.current === flightId;
        const releaseLeaveUnlessProceeding = (proceeding: boolean): void => {
          if (!isCurrentLeaveFlight()) {
            // timeout 後の遅延完了。proceed ロックを再武装しない
            return;
          }
          if (!proceeding) {
            leaveInFlightRef.current = false;
            if (mountedRef.current) {
              setIsLeaving(false);
            }
          }
          // proceed 時は unmount まで維持（shell navigate 前の generate 起動・編集窓を閉じる）
        };
        const otherOpInFlightAfterFlush = (): boolean =>
          submittingRef.current ||
          settingsOpeningRef.current ||
          emergencyOpeningRef.current ||
          privacyOpeningRef.current ||
          isOpeningEmergencyMenusRef.current ||
          isOpeningPrivacyRef.current ||
          isOpeningSettingsRef.current;
        try {
          await flushDraftRef.current();
          if (!isCurrentLeaveFlight()) {
            return "blocked";
          }
          // P1: flush 成功後も generate/openers が await 中に武装していないか再確認
          if (otherOpInFlightAfterFlush()) {
            if (mountedRef.current) {
              setSubmissionError(
                "別の操作の処理中のため、移動できませんでした。完了後にもう一度お試しください。",
              );
            }
            releaseLeaveUnlessProceeding(false);
            return "blocked";
          }
          releaseLeaveUnlessProceeding(true);
          return "proceed";
        } catch (error) {
          if (!isCurrentLeaveFlight()) {
            return "blocked";
          }
          // P1: Incomplete は schema 非 persistable の意図的拒否（RPC しない）。
          // pre-leave-flush 同様に離脱可とし、通信失敗文言で封鎖しない。
          if (error instanceof IncompleteDraftSaveError) {
            if (otherOpInFlightAfterFlush()) {
              if (mountedRef.current) {
                setSubmissionError(
                  "別の操作の処理中のため、移動できませんでした。完了後にもう一度お試しください。",
                );
              }
              releaseLeaveUnlessProceeding(false);
              return "blocked";
            }
            releaseLeaveUnlessProceeding(true);
            return "proceed";
          }
          // P2: revision conflict は onConflict が競合 chrome を武装済み。
          // 通信障害文言と並立させず、home では wizard を開いて chrome を見せる。
          if (error instanceof DraftRevisionConflictError) {
            if (mountedRef.current) {
              setWizardOpen(true);
            }
            releaseLeaveUnlessProceeding(false);
            return "blocked";
          }
          if (mountedRef.current) {
            setSubmissionError(
              "条件を保存できなかったため、移動できませんでした。通信を確認して再度お試しください。",
            );
          }
          releaseLeaveUnlessProceeding(false);
          return "blocked";
        }
      },
      {
        onTimeout: () => {
          // withTimeout 後も handler は続く。世代を進め route ロックを同期で落とす。
          leaveFlightIdRef.current += 1;
          leaveInFlightRef.current = false;
          if (mountedRef.current) {
            setIsLeaving(false);
          }
        },
      },
    );
    return () => {
      leaveFlightIdRef.current += 1;
      registerPlannerLeaveFlush(null);
      leaveInFlightRef.current = false;
    };
  }, []);

  // P3: 初回 data 未取得の失敗だけ全画面。init 後の背景 refetch 失敗は previous data で wizard 継続。
  const safetyLoadFatal = safetyQuery.isError && safetyQuery.data === undefined;
  const pantryLoadFatal = pantryQuery.isError && pantryQuery.data === undefined;
  // 背景 refetch 失敗時の soft 状態（wizard は破棄しない。P4: 生成 CTA はゲートする）
  const staleBackgroundSafetyPantry =
    initialized &&
    ((safetyQuery.isError && safetyQuery.data !== undefined) ||
      (pantryQuery.isError && pantryQuery.data !== undefined));
  // P7: draft も init 後背景失敗を soft banner に載せる（safety/pantry と対称）
  const staleBackgroundDraft = initialized && draftQuery.isError && draftQuery.data !== undefined;
  // 背景 refetch 失敗時のソフトエラー（wizard は破棄しない。focus 再取得や下の再試行で回復）
  const backgroundRefetchErrorMessage = staleBackgroundSafetyPantry
    ? "家族または冷蔵庫の最新情報を再取得できませんでした。表示は直前の内容です。最新を取得してから献立を作ってください。"
    : staleBackgroundDraft
      ? "下書きの最新情報を再取得できませんでした。表示は直前の内容です。"
      : null;

  if ((!initialized && draftQuery.isError) || safetyLoadFatal || pantryLoadFatal) {
    return (
      <main className="page-frame stack">
        <p role="alert">献立条件を読み込めませんでした。再読み込みしてください。</p>
        <button
          className="secondary-button min-h-11"
          type="button"
          onClick={() => {
            if (!initialized && draftQuery.isError) void draftQuery.refetch();
            if (safetyLoadFatal) void safetyQuery.refetch();
            if (pantryLoadFatal) void pantryQuery.refetch();
          }}
        >
          再試行
        </button>
      </main>
    );
  }
  // isPending 中は data が常に undefined（placeholder 無し）。previous data がある背景 refetch は isPending=false。
  if (draftQuery.isPending || safetyQuery.isPending || pantryQuery.isPending || !initialized) {
    return (
      <main className="page-frame">
        <p>献立条件を読み込み中…</p>
      </main>
    );
  }
  // fatal(error かつ data 無し) と pending を通過済み → data は利用可能（型も non-null）
  const safetyData = safetyQuery.data;
  const pantryData = pantryQuery.data;
  // hasResumablePending は useResumablePendingAfterReconcile（G-R4: kept のみ）
  // 有料プラン方針が固まるまでチラシ入口は非表示（契約フラグで再開可能）
  const flyerFooter = FLYER_WEEKLY_UI_ENABLED ? (
    <FlyerWeeklyPanel
      plusEntitled={usage.isSuccess ? usage.data.plusEntitled : false}
      hasAcceptedPrivacy={hasAcceptedPrivacy}
      privacyConsentLoadFailed={privacyConsentLoadFailed}
      onRetryPrivacyConsent={retryPrivacyConsent}
      // P2: review の privacy 導線と同型（flush + resume=review）。素 Link だと dirty 未 flush。
      onOpenPrivacyNotice={openPrivacyNotice}
    />
  ) : null;
  // history 未取得・失敗時は空。mock が非配列を返しても壊さない。
  const historyGroups = Array.isArray(historyQuery.data) ? historyQuery.data : [];
  const recentMenus = historyGroups.slice(0, HOME_RECENT_MENU_LIMIT).map((group) => ({
    id: group.representative.id,
    title: group.representative.title.length > 0 ? group.representative.title : "献立",
  }));
  const expiringItems: HomeExpiringPantryItem[] = pantryData
    .flatMap((item) => {
      if (item.expiresOn === null) return [];
      const notice = expiryNotice(item.expiresOn);
      if (notice.tone === null) return [];
      return [
        {
          id: item.id,
          name: item.name,
          expiresOn: item.expiresOn,
          tone: notice.tone,
          suffix: notice.suffix,
        },
      ];
    })
    .slice(0, HOME_EXPIRING_PANTRY_LIMIT);

  // ホーム: 空下書き、または生成中断（pending）優先。?resume= 時はここへ来ない。
  if (!wizardOpen) {
    return (
      <PlannerHome
        remainingToday={usage.isSuccess ? usage.data.success.remaining : null}
        onStartWizard={() => {
          setWizardOpen(true);
          // P5: eligible を渡し、blocked 家族 ID が残っていても review に着地しない
          // （fatal/pending 通過後なので safetyData は利用可能）
          setStep(firstIncompletePlannerStep(value, new Set(safetyData.eligibleMemberIds)));
        }}
        hasResumablePending={hasResumablePending}
        onResumePending={() => {
          // 既存 C2 再開と同経路（pending を壊さず generation へ）。
          // P1: 下ナビ leave と同型。dirty 未 flush のまま generation へ出ない。
          void navigateAfterPlannerLeaveFlush(navigate, "/generation?resumed=1");
        }}
        recentMenus={recentMenus}
        recentMenusLoading={historyQuery.isPending}
        recentMenusError={historyQuery.isError}
        onRetryRecentMenus={() => {
          void historyQuery.refetch();
        }}
        expiringItems={expiringItems}
        footer={flyerFooter}
        // P1: leave-flush / strip / 明示保存失敗を home でも role=alert で可視化（wizard と同型）
        error={submissionError}
        disabled={
          isLeaving ||
          isSubmitting ||
          isOpeningEmergencyMenus ||
          isOpeningPrivacy ||
          isOpeningSettings
        }
        banner={
          backgroundRefetchErrorMessage !== null ? (
            <div className="home-soft-banner stack">
              <p role="status">{backgroundRefetchErrorMessage}</p>
              <button
                className="secondary-button min-h-11"
                type="button"
                onClick={() => {
                  if (safetyQuery.isError) void safetyQuery.refetch();
                  if (pantryQuery.isError) void pantryQuery.refetch();
                  if (draftQuery.isError) void draftQuery.refetch();
                }}
              >
                再試行
              </button>
            </div>
          ) : null
        }
      />
    );
  }

  return (
    <>
      {backgroundRefetchErrorMessage !== null ? (
        <div className="page-frame stack">
          <p role="status">{backgroundRefetchErrorMessage}</p>
          <button
            className="secondary-button min-h-11"
            type="button"
            onClick={() => {
              if (safetyQuery.isError) void safetyQuery.refetch();
              if (pantryQuery.isError) void pantryQuery.refetch();
              if (draftQuery.isError) void draftQuery.refetch();
            }}
          >
            再試行
          </button>
        </div>
      ) : null}
      <PlannerWizard
        key={resetToken}
        draft={value}
        step={step}
        eligibleMembers={safetyData.members}
        isSaving={
          // P4: debounce autosave 中は leave / privacy navigate と同様に flush join で進める。
          // saving を isSaving に載せると privacy/settings/emergency が無言 disable になる。
          // 競合 UI は hasDraftConflict（onConflict）で止める。undelete プローブ中の固着は
          // save() 側で live 確認後に conflict を再 throw して onConflict を発火させる。
          // P5: leave-flush 中は privacy/settings と同型で isSaving に載せ、generate の見た目有効
          // ＋無言 early-return、および proceed 後 unmount 前の編集窓を閉じる。
          isSubmitting ||
          hasDraftConflict ||
          isOpeningEmergencyMenus ||
          isOpeningPrivacy ||
          isOpeningSettings ||
          isLeaving
        }
        // P4: safety/pantry soft 失敗中は stale 送信を禁止（主 CTA のみ。編集は previous data で継続）
        blockGenerationForStaleSafety={staleBackgroundSafetyPantry}
        error={
          // 競合 chrome は wizard 側の明示 UI に任せる。短時間枠・成功残数は review の生成ボタン近く
          // （設計 §10.3）。ここでは audience skipped / submission のみ。
          audienceStatusError ?? submissionError
        }
        usageRemaining={usage.isSuccess ? usage.data.success.remaining : null}
        plan={usage.isSuccess ? usage.data.plan : null}
        // P5: Plus quality 枠。未取得は null（トグルは plan 未取得と同様ロック）
        qualityAvailable={usage.isSuccess ? usage.data.quality.available : null}
        attemptsRemaining={usage.isSuccess ? usage.data.attempts.remaining : null}
        globalAvailable={usage.isSuccess ? usage.data.globalAvailable : null}
        shortWindowRetryAt={
          usage.isSuccess && usage.data.shortWindow.remaining === 0
            ? usage.data.shortWindow.retryAt
            : null
        }
        // G-R4: reconcile kept の進行中のみ「再開のみ」注意。terminal は出さない（clear→新規可）
        hasResumablePendingGeneration={hasResumablePending}
        autosaveState={autosave.state}
        onRetryAutosave={() => {
          void autosave.flush().catch(() => {
            // flush 失敗は state=error のまま。UI の再試行で再度呼べる
          });
        }}
        fieldErrors={fieldErrors}
        onDraftChange={setValue}
        onStepChange={setStep}
        onIdeaAudienceConfirmed={async () => {
          // 設計 §10: audience で idea を確定した時点で skipped を書く（主経路）。
          // P7 残差（意図的）: 生成 success より前に skipped が永続する。idea 導線で
          // onboarding を閉じる製品契約。生成失敗・離脱後も skipped のまま戻さない。
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
        pantryItems={pantryData}
        pantryItemsStatus="loaded"
        attempt={attempt}
        onAttemptChange={setAttempt}
        hasAcceptedOrDeclinedPrivacy={hasAcceptedPrivacy}
        privacyConsentLoadFailed={privacyConsentLoadFailed}
        onRetryPrivacyConsent={retryPrivacyConsent}
        onOpenPrivacyNotice={openPrivacyNotice}
        onOpenSettings={openSettings}
        hasDraftConflict={hasDraftConflict}
        draftConflictRefetchError={draftConflictRefetchError}
        canResolveDraftConflict={latestConflictDraft !== undefined}
        onResolveDraftConflict={resolveDraftConflict}
        onRetryDraftConflict={() => {
          void loadLatestConflictDraft();
        }}
        onOpenEmergencyMenus={openEmergencyMenus}
        onReset={resetPlannerDraft}
        // L10-3: チラシ入口。page-frame 内に置き幅・下余白をウィザードと揃える
        footer={flyerFooter}
        onSubmit={async () => {
          // P8: React 再描画前の二重 click を同期 ref で抑止（idea audience の confirmingRef と同型）
          // P1: 緊急 open / leave-flush 中は generate を受け付けない
          // （二重 flush / sticky pending と route 乖離を防ぐ）
          if (submittingRef.current || emergencyOpeningRef.current || leaveInFlightRef.current) {
            return;
          }
          setSubmissionError(null);
          setFieldErrors({});
          // P4: safety/pantry soft 失敗中は stale previous data で送信しない
          if (staleBackgroundSafetyPantry) {
            setSubmissionError(
              "家族または冷蔵庫の最新情報を再取得できないため、献立を開始できません。再試行してからお試しください。",
            );
            setStep("review");
            return;
          }
          const submissionCandidate: PlannerDraftInput = {
            mealType: value.mealType,
            mainIngredients: value.mainIngredients,
            cuisineGenre: value.cuisineGenre,
            targetMode: value.targetMode,
            targetMemberIds: value.targetMemberIds,
            servings: value.servings,
            timeLimitMinutes: value.timeLimitMinutes,
            budgetPreference: value.budgetPreference,
            ingredientPreference: value.ingredientPreference,
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
          // 医療と同様、期限切れ未確認・削除済み pantry を submit でも再検証する
          const pantryRows = pantryData;
          const pantryIdSet = new Set(pantryRows.map((item) => item.id));
          if (
            value.pantrySelections.some((selection) => !pantryIdSet.has(selection.pantryItemId))
          ) {
            setSubmissionError(
              "冷蔵庫から削除された食材の選択を解除してから献立を作ってください。",
            );
            setStep("review");
            return;
          }
          const nowForExpiry = new Date();
          const hasUnconfirmedExpired = value.pantrySelections.some((selection) => {
            const item = pantryRows.find((entry) => entry.id === selection.pantryItemId);
            if (item === undefined) return false;
            return (
              isPastEnteredExpiry(item, nowForExpiry) &&
              !hasCurrentExpiredConfirmation(attempt, item.id, nowForExpiry)
            );
          });
          if (hasUnconfirmedExpired) {
            setSubmissionError(
              "期限切れの食材が選ばれています。冷蔵庫の食材で確認してから献立を作ってください。",
            );
            setStep("review");
            return;
          }
          if (startGeneration === undefined) return;
          // P1: strip が flush 中に走ったら operationId 不一致で startGeneration を止める
          const submitOperationId = ++submitOperationIdRef.current;
          submittingRef.current = true;
          setIsSubmitting(true);
          setAudienceStatusError(null);
          // 生成成功（/generation 遷移）後は finally で isSaving を落とさない
          let generationProceeded = false;
          try {
            const saved = await flushDraft();
            // strip は operationId を先に無効化するので submittingRef の再読は冗長
            if (!mountedRef.current || submitOperationId !== submitOperationIdRef.current) {
              return;
            }
            // P1: flush 済み saved を最新 eligibility で再検証（strip 前 snapshot での生成禁止）
            if (saved.targetMode === "household") {
              const eligibleIds = new Set(eligibleMemberIdsRef.current);
              const stillEligible =
                saved.targetMemberIds.length > 0 &&
                saved.targetMemberIds.every((id) => eligibleIds.has(id));
              if (!stillEligible) {
                setSubmissionError(
                  "作る相手の条件が変わったため、対象の選び直しが必要です。家族を確認してください。",
                );
                setStep("audience");
                return;
              }
            } else if (saved.targetMode !== "idea") {
              // P2 接続: flush 中 strip で targetMode null になった saved は生成しない
              setSubmissionError(
                "作る相手の条件が変わったため、対象の選び直しが必要です。家族を確認してください。",
              );
              setStep("audience");
              return;
            }
            // AP5: 読取失敗中は /privacy 誘導せず再試行（未同意と誤認しない）
            if (privacyConsentLoadFailed) {
              setSubmissionError(
                "AI情報の確認状態を読み込めませんでした。通信を確認して再試行してください。",
              );
              return;
            }
            if (!hasAcceptedPrivacy) {
              // P8: privacy 委譲の flush/navigate 完了まで submitting を維持（finally で解除）
              await runPrivacyNavigation();
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
            // await 跨ぎで strip が operationId を進めている可能性がある（ref は制御フロー外）
            if (
              !isPlannerOperationStillActive(mountedRef, submitOperationId, submitOperationIdRef)
            ) {
              return;
            }
            // P3: flush 後に pantry 削除/期限更新が入り得る（staleTime:0 の背景 refetch）。
            // eligibility と同型で最新 ref を再検証し、navigate+sticky pending 後の端末失敗を避ける。
            // sticky pending 前に list を再読し、client cache とサーバ期限集合のズレ（doom C2）を縮める。
            // 再読失敗時は既存 ref で続行（サーバ validateTransientChecks は fail-closed のまま）。
            if (userId !== undefined) {
              try {
                const freshPantry = await listPantryItems(client, userId);
                if (
                  !isPlannerOperationStillActive(
                    mountedRef,
                    submitOperationId,
                    submitOperationIdRef,
                  )
                ) {
                  return;
                }
                pantryRowsRef.current = freshPantry;
                queryClient.setQueryData(pantryKeys.list(userId), freshPantry);
              } catch {
                // 既存 pantryRowsRef でゲート・command を組み立てる
              }
            }
            {
              const pantryRowsLatest = pantryRowsRef.current;
              const pantryIdSetLatest = new Set(pantryRowsLatest.map((item) => item.id));
              if (
                saved.pantrySelections.some(
                  (selection) => !pantryIdSetLatest.has(selection.pantryItemId),
                )
              ) {
                setSubmissionError(
                  "冷蔵庫から削除された食材の選択を解除してから献立を作ってください。",
                );
                setStep("review");
                return;
              }
              const nowForExpiryPostFlush = new Date();
              const hasUnconfirmedExpiredPostFlush = saved.pantrySelections.some((selection) => {
                const item = pantryRowsLatest.find((entry) => entry.id === selection.pantryItemId);
                if (item === undefined) return false;
                return (
                  isPastEnteredExpiry(item, nowForExpiryPostFlush) &&
                  !hasCurrentExpiredConfirmation(attempt, item.id, nowForExpiryPostFlush)
                );
              });
              if (hasUnconfirmedExpiredPostFlush) {
                setSubmissionError(
                  "期限切れの食材が選ばれています。冷蔵庫の食材で確認してから献立を作ってください。",
                );
                setStep("review");
                return;
              }
            }
            // 生成へ渡す attempt は selected∩currently-expired のみ・非 Plus / quality 枠なしは qualityMode を落とす
            // （上の再読後 ref を使い、sticky に載せる confirmation をサーバ集合へ近づける）
            const nowForCommand = new Date();
            const commandAttempt: PlannerAttempt = {
              ...attempt,
              qualityMode: planCode === "plus" && qualityAvailable === true && attempt.qualityMode,
              expiredPantryChecks: filterExpiredPantryChecksForSelections(
                attempt.expiredPantryChecks,
                saved.pantrySelections,
                currentlyExpiredPantryItemIds(pantryRowsRef.current, nowForCommand),
                nowForCommand,
              ),
            };
            const controller = new AbortController();
            generationAbortControllerRef.current?.abort();
            generationAbortControllerRef.current = controller;
            try {
              const result = await startGeneration(saved, commandAttempt, controller.signal);
              if (controller.signal.aborted || result === false) return;
              startNewAttempt();
              // true は /generation へ遷移済み。navigate commit まで isSaving を維持する。
              generationProceeded = result === true;
            } finally {
              if (generationAbortControllerRef.current === controller) {
                generationAbortControllerRef.current = null;
              }
            }
          } catch (error) {
            // P2: target_mode_required は pending を消し専用文言（汎用保存失敗に畳まない）
            if (error instanceof Error && error.message === "target_mode_required") {
              clearPendingGeneration();
              setSubmissionError(
                "作る相手が未設定のため、生成を開始できません。対象を選び直してください。",
              );
              setStep("audience");
              return;
            }
            // P3: revision conflict は onConflict の競合 chrome に一本化。
            // leave/settings/privacy/emergency と同型で汎用保存失敗文言を立てない。
            if (error instanceof DraftRevisionConflictError) {
              return;
            }
            // IncompleteDraft は通信失敗と分けて人数未設定を伝える
            // （pending は startGeneration 内の meta 失敗 rollback / mode 判定で処理済み。
            //  flush 失敗時に既存 C2 resume pending を誤って消さないようここでは clear しない）
            setSubmissionError(
              error instanceof IncompleteDraftSaveError
                ? "人数など必要な条件が未設定のため、生成を開始しませんでした。確認画面で内容を見直してください。"
                : "献立条件を保存できなかったため、生成を開始しませんでした。",
            );
          } finally {
            // strip が既に operation を無効化して ref を落としている場合は上書きしない
            // 生成成功後は unmount まで isSaving / submittingRef を維持し reset で sticky を捨てない
            if (submitOperationId === submitOperationIdRef.current && !generationProceeded) {
              submittingRef.current = false;
              setIsSubmitting(false);
            }
          }
        }}
      />
    </>
  );
}

/** await 跨ぎの strip/unmount を ref 再読で検知する（制御フロー解析に畳まれないよう関数経由）。 */
function isPlannerOperationStillActive(
  mountedRef: { current: boolean },
  operationId: number,
  operationIdRef: { current: number },
): boolean {
  return mountedRef.current && operationId === operationIdRef.current;
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
