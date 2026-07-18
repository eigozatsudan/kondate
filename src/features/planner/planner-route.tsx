import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import {
  listAllergenCatalog,
  listHouseholdMembers,
  listMemberAllergies,
} from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { useAuth } from "@/features/auth/use-auth";
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
  startGeneration?: (draft: PlannerDraft, attempt: PlannerAttempt) => unknown;
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
  const [attempt, setAttempt] = useState<PlannerAttempt>(createPlannerAttempt);
  const startNewAttempt = useCallback(() => {
    setAttempt(createPlannerAttempt());
  }, []);

  useEffect(() => {
    if (draftQuery.data === undefined || safetyQuery.data === undefined || initialized) return;
    const eligibleMemberIds = new Set(safetyQuery.data.eligibleMemberIds);
    setValue(
      draftQuery.data === null
        ? {
            ...emptyDraft,
            targetMemberIds: [...eligibleMemberIds].slice(0, targetMemberLimit),
          }
        : {
            ...draftQuery.data,
            targetMemberIds: draftQuery.data.targetMemberIds
              .filter((id) => eligibleMemberIds.has(id))
              .slice(0, targetMemberLimit),
          },
    );
    setInitialized(true);
  }, [draftQuery.data, initialized, safetyQuery.data]);

  const save = useCallback(
    (next: PlannerDraftInput, revision: number) =>
      savePlannerDraft(client, userId ?? "", next, revision),
    [client, userId],
  );
  const { refetch: refetchDraft } = draftQuery;
  const onConflict = useCallback(() => {
    // 競合時点の表示値は失われた保存前提のため、サーバーの最新下書きが届き次第
    // 初期化フローをやり直して value と revision を作り直す（自動保存も再開する）。
    setInitialized(false);
    void refetchDraft();
  }, [refetchDraft]);
  const autosave = useDraftAutosave({
    value,
    enabled: initialized && userId !== undefined,
    initialRevision: draftQuery.data?.revision ?? 0,
    save,
    onConflict,
  });

  if (draftQuery.isError || safetyQuery.isError || pantryQuery.isError) {
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
      initialValue={value}
      members={safetyQuery.data.members}
      pantryItems={pantryQuery.data}
      pantryItemsStatus="loaded"
      saveState={autosave.state}
      attempt={attempt}
      onAttemptChange={setAttempt}
      onStartNewAttempt={startNewAttempt}
      onChange={setValue}
      flush={autosave.flush}
      onGenerate={async (draft, currentAttempt) => {
        if (startGeneration === undefined || currentAttempt === undefined) return false;
        const result = await startGeneration(draft, currentAttempt);
        if (result === false) return false;
        startNewAttempt();
        return true;
      }}
    />
  );
}
