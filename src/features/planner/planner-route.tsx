import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import {
  listAllergenCatalog,
  listHouseholdMembers,
  listMemberAllergies,
} from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { useAuth } from "@/features/auth/auth-provider";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { listPantryItems, pantryKeys } from "@/features/pantry/pantry-api";
import type { PlannerSafetyMember } from "./planner-safety-member";
import { createPlannerAttempt, type PlannerAttempt } from "./expired-pantry-checks";
import { getPlannerDraft, plannerKeys, savePlannerDraft } from "./planner-api";
import { PlannerForm } from "./planner-page";
import { useDraftAutosave } from "./use-draft-autosave";

const emptyDraft: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMemberIds: [],
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
  return draft === null
    ? {
        ...emptyDraft,
        targetMemberIds: [...eligibleIds].slice(0, targetMemberLimit),
      }
    : {
        ...draft,
        targetMemberIds: draft.targetMemberIds
          .filter((id) => eligibleIds.has(id))
          .slice(0, targetMemberLimit),
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
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const startNewAttempt = useCallback(() => {
    setAttempt(createPlannerAttempt());
  }, []);

  useEffect(
    () => () => {
      generationAbortControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (draftQuery.data === undefined || safetyQuery.data === undefined || initialized) return;
    setValue(sanitizeDraft(draftQuery.data, safetyQuery.data.eligibleMemberIds));
    setBaselineRevision(draftQuery.data?.revision ?? 0);
    setInitialized(true);
  }, [draftQuery.data, initialized, safetyQuery.data]);

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
    // 緊急献立側が staleTime 内の古い下書きを再利用しないよう、保存結果を遷移前に同期する。
    queryClient.setQueryData(plannerKeys.draft(userId ?? "missing"), saved);
    return saved;
  }, [flushAutosave, queryClient, userId]);

  const resolveDraftConflict = useCallback((): void => {
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
    <PlannerForm
      key={resetToken}
      initialValue={value}
      members={safetyQuery.data.members}
      pantryItems={pantryQuery.data}
      pantryItemsStatus="loaded"
      saveState={autosave.state}
      attempt={attempt}
      onAttemptChange={setAttempt}
      onStartNewAttempt={startNewAttempt}
      onChange={setValue}
      flush={flushDraft}
      onOpenEmergencyMenus={() => {
        void navigate("/emergency-menus");
        return Promise.resolve();
      }}
      draftConflict={hasDraftConflict}
      canResolveDraftConflict={latestConflictDraft !== undefined}
      draftConflictRefetchError={draftConflictRefetchError}
      onResolveDraftConflict={resolveDraftConflict}
      onRetryDraftConflict={() => void loadLatestConflictDraft()}
      onGenerate={async (draft, currentAttempt) => {
        if (startGeneration === undefined || currentAttempt === undefined) return false;
        const controller = new AbortController();
        generationAbortControllerRef.current?.abort();
        generationAbortControllerRef.current = controller;
        try {
          const result = await startGeneration(draft, currentAttempt, controller.signal);
          if (controller.signal.aborted || result === false) return false;
          startNewAttempt();
          return true;
        } finally {
          if (generationAbortControllerRef.current === controller) {
            generationAbortControllerRef.current = null;
          }
        }
      }}
    />
  );
}
