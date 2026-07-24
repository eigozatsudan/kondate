import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  easePreferences,
  unsupportedDietKinds,
  type AgeBand,
  type AllergyStatus,
  type EasePreference,
  type PortionSize,
  type RequiredSafetyConstraint,
  type SpiceLevel,
  type UnsupportedDietKind,
  type UnsupportedDietStatus,
} from "@shared/contracts/domain";
import { AccountSettingsSection } from "@/features/account/account-settings-section";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  addCustomMemberAllergy,
  addMemberDislike,
  addStandardMemberAllergy,
  completeHouseholdMember,
  createHouseholdMemberDraft,
  deleteHouseholdMember,
  deleteMemberAllergy,
  deleteMemberDislike,
  listAllergenCatalog,
  listAllergenAliases,
  listHouseholdMembers,
  listMemberAllergies,
  listMemberDislikes,
  updateCompleteHouseholdMember,
  updateHouseholdMemberDraft,
  type AllergenCatalogRow,
  type AllergenAliasRow,
  type HouseholdMemberPatch,
  type HouseholdMemberRow,
  type MemberAllergyRow,
  type MemberDislikeRow,
} from "./household-api";
import { AllergyEditor } from "./allergy-editor";
import { defaultsForAgeBand } from "./household-defaults";
import {
  householdSettingsSchema,
  toHouseholdFieldErrors,
  type HouseholdFieldErrors,
  type HouseholdSettingsValue,
} from "./household-settings-schema";
import { householdKeys, invalidateHouseholdSafetyDependents } from "./household-queries";

type PendingRegisteredIntent = {
  member: HouseholdMemberRow;
  values: HouseholdSettingsValue;
  revision: number;
  allergyRefetchPending: boolean;
  allergyRefetchStarted: boolean;
  allergyRefetchToken?: { settled: boolean };
  registeredSaveEvidence:
    "known-empty" | "unknown" | "query-error" | "allergy-query" | "allergy-insert";
  inFlight?: Promise<boolean | undefined>;
};

function registeredSaveBlockedMessage(
  evidence: PendingRegisteredIntent["registeredSaveEvidence"],
): string | undefined {
  if (evidence === "known-empty") return "登録ありの場合は1つ以上選んでください";
  if (evidence === "unknown") return "アレルギー情報を確認しています";
  if (evidence === "query-error")
    return "アレルギー情報を確認できませんでした。もう一度お試しください";
  return undefined;
}

export interface HouseholdSettingsApi {
  listMembers(): Promise<HouseholdMemberRow[]>;
  createDraft(sortOrder: number): Promise<HouseholdMemberRow>;
  updateDraft(memberId: string, patch: HouseholdMemberPatch): Promise<HouseholdMemberRow>;
  updateMember(memberId: string, patch: HouseholdMemberPatch): Promise<HouseholdMemberRow>;
  completeMember(memberId: string): Promise<HouseholdMemberRow>;
  deleteMember(memberId: string): Promise<void>;
  listCatalog(): Promise<AllergenCatalogRow[]>;
  listAliases?(): Promise<AllergenAliasRow[]>;
  listAllergies(memberId: string): Promise<MemberAllergyRow[]>;
  addStandardAllergy(memberId: string, allergenId: string): Promise<MemberAllergyRow>;
  addCustomAllergy(memberId: string, name: string, aliases: string[]): Promise<MemberAllergyRow>;
  removeAllergy(allergyId: string): Promise<void>;
  listDislikes(memberId: string): Promise<MemberDislikeRow[]>;
  addDislike(memberId: string, name: string): Promise<MemberDislikeRow>;
  removeDislike(dislikeId: string): Promise<void>;
  invalidateSafety(): Promise<void>;
}

function memberValue(member: HouseholdMemberRow): HouseholdSettingsValue {
  const ageBand = (member.age_band ?? "adult") as AgeBand;
  const defaults = defaultsForAgeBand(ageBand);
  return {
    displayName: member.display_name,
    ageBand: (member.age_band ?? "") as AgeBand,
    allergyStatus: (member.allergy_status ?? "") as AllergyStatus,
    unsupportedDietStatus: (member.unsupported_diet_status ?? "") as UnsupportedDietStatus,
    unsupportedDietKinds: member.unsupported_diet_kinds as UnsupportedDietKind[],
    requiredSafetyConstraints: member.required_safety_constraints as RequiredSafetyConstraint[],
    portionSize: (member.portion_size ?? defaults.portion_size) as PortionSize,
    spiceLevel: (member.spice_level ?? defaults.spice_level) as SpiceLevel,
    easePreferences: member.ease_preferences as EasePreference[],
  };
}

function toMemberPatch(value: HouseholdSettingsValue): HouseholdMemberPatch {
  return {
    display_name: value.displayName,
    age_band: value.ageBand,
    allergy_status: value.allergyStatus,
    unsupported_diet_status: value.unsupportedDietStatus,
    unsupported_diet_kinds: value.unsupportedDietKinds,
    required_safety_constraints: value.requiredSafetyConstraints,
    portion_size: value.portionSize,
    spice_level: value.spiceLevel,
    ease_preferences: value.easePreferences,
  };
}

function createHouseholdSettingsApi(
  userId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): HouseholdSettingsApi {
  const client = getBrowserSupabaseClient();
  const invalidateSafety = () => invalidateHouseholdSafetyDependents(queryClient, userId);
  return {
    listMembers: () => listHouseholdMembers(client, userId),
    createDraft: (sortOrder) => createHouseholdMemberDraft(client, userId, sortOrder),
    updateDraft: (memberId, patch) => updateHouseholdMemberDraft(client, userId, memberId, patch),
    updateMember: (memberId, patch) =>
      updateCompleteHouseholdMember(client, userId, memberId, patch),
    completeMember: (memberId) => completeHouseholdMember(client, userId, memberId),
    deleteMember: (memberId) => deleteHouseholdMember(client, userId, memberId),
    listCatalog: () => listAllergenCatalog(client),
    listAliases: () => listAllergenAliases(client),
    listAllergies: (memberId) => listMemberAllergies(client, userId, memberId),
    addStandardAllergy: (memberId, allergenId) =>
      addStandardMemberAllergy(client, userId, memberId, allergenId),
    addCustomAllergy: (memberId, name, aliases) =>
      addCustomMemberAllergy(client, userId, memberId, name, aliases),
    removeAllergy: (allergyId) => deleteMemberAllergy(client, userId, allergyId),
    listDislikes: (memberId) => listMemberDislikes(client, userId, memberId),
    addDislike: (memberId, name) => addMemberDislike(client, userId, memberId, name),
    removeDislike: (dislikeId) => deleteMemberDislike(client, userId, dislikeId),
    invalidateSafety,
  };
}

export function HouseholdSettingsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  if (auth.session === null) return null;
  return (
    <HouseholdSettingsForm
      userId={auth.session.user.id}
      api={createHouseholdSettingsApi(auth.session.user.id, queryClient)}
    />
  );
}

export function HouseholdSettingsForm({
  api,
  userId = "settings",
}: {
  api: HouseholdSettingsApi;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const membersKey = useMemo(() => householdKeys.members(userId), [userId]);
  const [selectedId, setSelectedId] = useState<string>();
  const [values, setValues] = useState<HouseholdSettingsValue>();
  const [allergyRefetchEpoch, setAllergyRefetchEpoch] = useState(0);
  const [errors, setErrors] = useState<HouseholdFieldErrors>({});
  const [message, setMessage] = useState("");
  const [dislike, setDislike] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HouseholdMemberRow>();
  const [deletingMemberIds, setDeletingMemberIds] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [pendingOperationVersion, setPendingOperationVersion] = useState(0);
  const [allergyMutationPendingMemberIds, setAllergyMutationPendingMemberIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const saveQueue = useRef(Promise.resolve(true));
  const valuesByMemberRef = useRef(new Map<string, HouseholdSettingsValue>());
  const pendingOperationCountsRef = useRef(new Map<string, number>());
  const failedSaveMemberIdsRef = useRef(new Set<string>());
  const allergyMutationPendingMemberIdsRef = useRef(new Set<string>());
  const deletingMemberIdsRef = useRef(new Set<string>());
  const selectedMemberIdRef = useRef<string | undefined>(undefined);
  const pendingRegisteredIntents = useRef(new Map<string, PendingRegisteredIntent>());
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const deleteConfirm = useRef<HTMLButtonElement>(null);
  const ageBandRef = useRef<HTMLSelectElement>(null);
  const allergyStatusRef = useRef<HTMLSelectElement>(null);
  const unsupportedDietStatusRef = useRef<HTMLSelectElement>(null);
  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => api.listMembers(),
  });
  const catalogQuery = useQuery({
    queryKey: ["settings-catalog"],
    queryFn: () => api.listCatalog(),
  });
  const aliasesQuery = useQuery({
    queryKey: ["settings-allergen-aliases"],
    queryFn: () => api.listAliases?.() ?? Promise.resolve([]),
  });
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const selected =
    selectedId === undefined ? members[0] : members.find((member) => member.id === selectedId);
  selectedMemberIdRef.current = selected?.id;
  const allergiesQuery = useQuery({
    queryKey: selected
      ? householdKeys.allergies("settings", selected.id)
      : ["settings-allergies", "none"],
    queryFn: () => api.listAllergies(selected?.id ?? "none"),
    enabled: selected !== undefined,
  });
  const currentAllergies = allergiesQuery.data ?? [];
  const dislikesQuery = useQuery({
    queryKey: selected
      ? householdKeys.dislikes("settings", selected.id)
      : ["settings-dislikes", "none"],
    queryFn: () => api.listDislikes(selected?.id ?? "none"),
    enabled: selected !== undefined,
  });

  useEffect(() => {
    if (selected !== undefined) {
      setSelectedId(selected.id);
      const latestSelected =
        queryClient
          .getQueryData<HouseholdMemberRow[]>(membersKey)
          ?.find((member) => member.id === selected.id) ?? selected;
      const pendingIntent = pendingRegisteredIntents.current.get(selected.id);
      const keepLocalSnapshot =
        (pendingOperationCountsRef.current.get(selected.id) ?? 0) > 0 ||
        failedSaveMemberIdsRef.current.has(selected.id);
      const baseValues = keepLocalSnapshot
        ? (valuesByMemberRef.current.get(selected.id) ?? memberValue(latestSelected))
        : memberValue(latestSelected);
      const initialValues =
        pendingIntent === undefined
          ? baseValues
          : keepLocalSnapshot
            ? pendingIntent.values
            : { ...baseValues, allergyStatus: pendingIntent.values.allergyStatus };
      valuesByMemberRef.current.set(selected.id, initialValues);
      setValues(initialValues);
    }
  }, [membersKey, pendingOperationVersion, queryClient, selected]);

  useEffect(() => {
    if (deleteTarget === undefined) return;
    if (
      selected?.id !== deleteTarget.id ||
      !members.some((member) => member.id === deleteTarget.id)
    ) {
      setDeleteTarget(undefined);
    }
  }, [deleteTarget, members, selected?.id]);

  useEffect(() => {
    if (deleteTarget === undefined) return;
    const trigger = deleteTrigger.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deletingMemberIdsRef.current.has(deleteTarget.id)) {
        setDeleteTarget(undefined);
      }
    };
    deleteConfirm.current?.focus();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [deleteTarget]);

  const update = (patch: Partial<HouseholdSettingsValue>) => {
    if (selected === undefined) return undefined;
    const current = valuesByMemberRef.current.get(selected.id);
    if (current === undefined) return undefined;
    const next = { ...current, ...patch };
    valuesByMemberRef.current.set(selected.id, next);
    setValues(next);
    return next;
  };
  const save = useCallback(
    async (member: HouseholdMemberRow, next: HouseholdSettingsValue): Promise<boolean> => {
      const parsed = householdSettingsSchema.safeParse(next);
      if (!parsed.success) {
        setErrors(toHouseholdFieldErrors(parsed.error));
        return false;
      }
      setErrors({});
      try {
        const patch = toMemberPatch(parsed.data);
        const saved =
          member.status === "draft"
            ? await api.updateDraft(member.id, patch)
            : await api.updateMember(member.id, patch);
        const cachedMember = { ...saved, ...patch };
        queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) =>
          current.map((currentMember) =>
            currentMember.id === saved.id ? cachedMember : currentMember,
          ),
        );
        await api.invalidateSafety();
        const pending = pendingRegisteredIntents.current.get(member.id);
        setMessage(
          pending?.values.allergyStatus === "registered"
            ? (registeredSaveBlockedMessage(pending.registeredSaveEvidence) ??
                "家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します")
            : "家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します",
        );
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "家族設定を保存できませんでした");
        return false;
      }
    },
    [api, membersKey, queryClient],
  );
  const beginPendingOperation = useCallback(
    (targetMember: HouseholdMemberRow, next?: HouseholdSettingsValue) => {
      const currentCount = pendingOperationCountsRef.current.get(targetMember.id) ?? 0;
      pendingOperationCountsRef.current.set(targetMember.id, currentCount + 1);
      valuesByMemberRef.current.set(
        targetMember.id,
        next ?? valuesByMemberRef.current.get(targetMember.id) ?? memberValue(targetMember),
      );
    },
    [],
  );
  const finishPendingOperation = useCallback((memberId: string) => {
    const currentCount = pendingOperationCountsRef.current.get(memberId);
    if (currentCount === undefined) return;
    if (currentCount <= 1) pendingOperationCountsRef.current.delete(memberId);
    else pendingOperationCountsRef.current.set(memberId, currentCount - 1);
    setPendingOperationVersion((current) => current + 1);
  }, []);
  const beginAllergyMutation = (memberId: string) => {
    // Editorが家族切替で再生成されても、同じ家族のアレルギー更新は重複開始させない。
    if (allergyMutationPendingMemberIdsRef.current.has(memberId)) return false;
    allergyMutationPendingMemberIdsRef.current.add(memberId);
    setAllergyMutationPendingMemberIds(new Set(allergyMutationPendingMemberIdsRef.current));
    return true;
  };
  const finishAllergyMutation = (memberId: string) => {
    allergyMutationPendingMemberIdsRef.current.delete(memberId);
    setAllergyMutationPendingMemberIds(new Set(allergyMutationPendingMemberIdsRef.current));
  };
  const runAllergyMutation = async (
    targetMember: HouseholdMemberRow,
    operation: () => Promise<void>,
  ) => {
    if (!beginAllergyMutation(targetMember.id)) return;
    try {
      await operation();
    } finally {
      finishAllergyMutation(targetMember.id);
    }
  };
  const queueSave = useCallback(
    (
      member: HouseholdMemberRow,
      localSnapshot: HouseholdSettingsValue,
      persistedValues: HouseholdSettingsValue = localSnapshot,
      shouldSave?: () => boolean,
    ) => {
      let skipped = false;
      beginPendingOperation(member, localSnapshot);
      saveQueue.current = saveQueue.current
        .then(() => {
          if (shouldSave !== undefined && !shouldSave()) {
            skipped = true;
            return true;
          }
          return save(member, persistedValues);
        })
        .catch(() => false)
        .then((saved) => {
          if (!skipped) {
            if (saved) failedSaveMemberIdsRef.current.delete(member.id);
            else failedSaveMemberIdsRef.current.add(member.id);
          }
          return saved;
        })
        .finally(() => {
          finishPendingOperation(member.id);
        });
      return saveQueue.current;
    },
    [beginPendingOperation, finishPendingOperation, save],
  );
  const savePendingRegisteredStatus = useCallback(
    (memberId: string): Promise<boolean | undefined> => {
      const pending = pendingRegisteredIntents.current.get(memberId);
      if (pending === undefined) return Promise.resolve(undefined);
      if (pending.inFlight !== undefined) return pending.inFlight;
      const inFlight = (async (): Promise<boolean | undefined> => {
        for (;;) {
          const current = pendingRegisteredIntents.current.get(memberId);
          if (current !== pending) return false;
          if (
            current.values.allergyStatus === "registered" &&
            current.registeredSaveEvidence !== "allergy-query" &&
            current.registeredSaveEvidence !== "allergy-insert"
          ) {
            delete current.inFlight;
            setMessage(registeredSaveBlockedMessage(current.registeredSaveEvidence) ?? "");
            return undefined;
          }
          const revision = current.revision;
          let skipReason: "intent" | "revision" | "blocked" | undefined;
          const saved = await queueSave(current.member, current.values, current.values, () => {
            const latest = pendingRegisteredIntents.current.get(memberId);
            if (latest !== pending) {
              skipReason = "intent";
              return false;
            }
            if (latest.revision !== revision) {
              skipReason = "revision";
              return false;
            }
            if (
              latest.values.allergyStatus === "registered" &&
              latest.registeredSaveEvidence !== "allergy-query" &&
              latest.registeredSaveEvidence !== "allergy-insert"
            ) {
              skipReason = "blocked";
              setMessage(registeredSaveBlockedMessage(latest.registeredSaveEvidence) ?? "");
              return false;
            }
            return true;
          });
          if (skipReason === "intent") return saved;
          if (skipReason === "revision") continue;
          if (skipReason === "blocked") {
            delete pending.inFlight;
            return undefined;
          }
          const latest = pendingRegisteredIntents.current.get(memberId);
          if (latest !== pending) return saved;
          if (!saved) {
            delete latest.inFlight;
            return false;
          }
          if (latest.revision === revision) {
            pendingRegisteredIntents.current.delete(memberId);
            return true;
          }
        }
      })();
      pending.inFlight = inFlight;
      return inFlight;
    },
    [queueSave],
  );
  const finalizeAllergyChange = useCallback(
    async (memberId: string): Promise<void> => {
      const pending = pendingRegisteredIntents.current.get(memberId);
      if (pending !== undefined) pending.registeredSaveEvidence = "allergy-insert";
      await queryClient.invalidateQueries({
        queryKey: householdKeys.allergies("settings", memberId),
      });
      const registeredStatusSaved = await savePendingRegisteredStatus(memberId);
      if (registeredStatusSaved === false) {
        try {
          await api.invalidateSafety();
        } catch {
          return;
        }
      } else if (registeredStatusSaved === undefined) {
        await api.invalidateSafety();
      }
    },
    [api, queryClient, savePendingRegisteredStatus],
  );
  const createDraft = useMutation({
    mutationFn: () => api.createDraft(members.length),
    onSuccess: (created) => {
      queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) => [
        ...current,
        created,
      ]);
      setSelectedId(created.id);
    },
  });
  const complete = async () => {
    if (selected === undefined || values === undefined) return;
    const parsed = householdSettingsSchema.safeParse(values);
    if (!parsed.success) {
      const nextErrors = toHouseholdFieldErrors(parsed.error);
      setErrors(nextErrors);
      setMessage("必須項目を確認してください");
      const fieldOrder = Object.keys(
        householdSettingsSchema.shape,
      ) as (keyof HouseholdSettingsValue)[];
      const fieldRefs: Partial<Record<keyof HouseholdSettingsValue, typeof ageBandRef>> = {
        ageBand: ageBandRef,
        allergyStatus: allergyStatusRef,
        unsupportedDietStatus: unsupportedDietStatusRef,
      };
      const firstInvalidField = fieldOrder.find((key) => key in nextErrors);
      fieldRefs[firstInvalidField as keyof typeof fieldRefs]?.current?.focus();
      return;
    }
    if (parsed.data.allergyStatus === "registered" && !allergiesQuery.isSuccess) {
      setMessage(
        allergiesQuery.isError
          ? "アレルギー情報を確認できませんでした。もう一度お試しください"
          : "アレルギー情報を確認しています",
      );
      if (allergiesQuery.isError) void allergiesQuery.refetch();
      return;
    }
    if (parsed.data.allergyStatus === "registered" && currentAllergies.length === 0) {
      setMessage("登録ありの場合は1つ以上選んでください");
      return;
    }
    setSaving(true);
    await saveQueue.current;
    const saved = await save(selected, parsed.data);
    if (!saved) {
      failedSaveMemberIdsRef.current.add(selected.id);
      setSaving(false);
      return;
    }
    failedSaveMemberIdsRef.current.delete(selected.id);
    pendingRegisteredIntents.current.delete(selected.id);
    if (selected.status === "draft") {
      try {
        const completed = await api.completeMember(selected.id);
        queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) =>
          current.map((member) => (member.id === completed.id ? completed : member)),
        );
        await api.invalidateSafety();
        setMessage("家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "家族設定を完了できませんでした");
      }
    }
    setSaving(false);
  };

  const updateAndSave = (patch: Partial<HouseholdSettingsValue>) => {
    const next = update(patch);
    if (selected === undefined || next === undefined) return;
    const persistedMember =
      queryClient
        .getQueryData<HouseholdMemberRow[]>(membersKey)
        ?.find((member) => member.id === selected.id) ?? selected;
    const persistedAllergyStatus = memberValue(persistedMember).allergyStatus;
    const existingIntent = pendingRegisteredIntents.current.get(selected.id);

    // 「なし」「未確認」への明示変更は、保留中の「登録あり」より常に優先する。
    if (next.allergyStatus !== "registered") {
      pendingRegisteredIntents.current.delete(selected.id);
      void queueSave(selected, next);
      return;
    }
    const requiresRegisteredIntent =
      selected.status === "complete" && persistedAllergyStatus !== "registered";
    if (!requiresRegisteredIntent && existingIntent === undefined) {
      void queueSave(selected, next);
      return;
    }
    if (existingIntent === undefined) {
      pendingRegisteredIntents.current.set(selected.id, {
        member: selected,
        values: next,
        revision: 0,
        allergyRefetchPending: false,
        allergyRefetchStarted: false,
        registeredSaveEvidence:
          allergiesQuery.isFetching || allergiesQuery.isRefetching
            ? "unknown"
            : allergiesQuery.isError
              ? "query-error"
              : !allergiesQuery.isSuccess
                ? "unknown"
                : currentAllergies.length > 0
                  ? "allergy-query"
                  : "known-empty",
      });
    } else {
      existingIntent.member = selected;
      existingIntent.values = next;
      existingIntent.revision += 1;
      if (
        !existingIntent.allergyRefetchPending &&
        existingIntent.registeredSaveEvidence !== "allergy-insert"
      ) {
        existingIntent.registeredSaveEvidence =
          allergiesQuery.isFetching || allergiesQuery.isRefetching
            ? "unknown"
            : allergiesQuery.isError
              ? "query-error"
              : !allergiesQuery.isSuccess
                ? "unknown"
                : currentAllergies.length > 0
                  ? "allergy-query"
                  : "known-empty";
      }
    }

    const pending = pendingRegisteredIntents.current.get(selected.id);
    if (pending === undefined) return;
    valuesByMemberRef.current.set(selected.id, pending.values);
    const canSaveRegistered =
      pending.registeredSaveEvidence === "allergy-query" ||
      pending.registeredSaveEvidence === "allergy-insert";
    if (canSaveRegistered) {
      void savePendingRegisteredStatus(selected.id);
      return;
    }

    // 登録可否の確認中でも、他項目はDB上の旧アレルギー状態を保ったまま保存する。
    const hasSafeFieldChange = Object.keys(patch).some((key) => key !== "allergyStatus");
    if (hasSafeFieldChange) {
      void queueSave(selected, next, { ...next, allergyStatus: persistedAllergyStatus });
    }
    if (allergiesQuery.isError) {
      setMessage("アレルギー情報を確認できませんでした。もう一度お試しください");
      void allergiesQuery.refetch();
      return;
    }
    if (!allergiesQuery.isSuccess) {
      setMessage("アレルギー情報を確認しています");
      return;
    }
    if (currentAllergies.length === 0) {
      setMessage("登録ありの場合は1つ以上選んでください");
      return;
    }
  };

  const selectedMemberId = selected?.id;
  useEffect(() => {
    if (selectedMemberId === undefined) return;
    const pending = pendingRegisteredIntents.current.get(selectedMemberId);
    if (pending === undefined || pending.values.allergyStatus !== "registered") return;
    if (pending.allergyRefetchToken !== undefined) {
      if (!pending.allergyRefetchToken.settled) return;
      delete pending.allergyRefetchToken;
      pending.allergyRefetchPending = false;
      pending.allergyRefetchStarted = false;
    }
    if (pending.allergyRefetchPending) {
      if (allergiesQuery.isFetching || allergiesQuery.isRefetching) {
        pending.allergyRefetchStarted = true;
        if (pending.registeredSaveEvidence !== "allergy-insert") {
          pending.registeredSaveEvidence = "unknown";
        }
        return;
      }
      if (!pending.allergyRefetchStarted) return;
      delete pending.allergyRefetchToken;
      pending.allergyRefetchPending = false;
      pending.allergyRefetchStarted = false;
    } else if (allergiesQuery.isFetching || allergiesQuery.isRefetching) {
      if (pending.registeredSaveEvidence !== "allergy-insert") {
        pending.registeredSaveEvidence = "unknown";
      }
      return;
    }
    if (!allergiesQuery.isSuccess) {
      if (pending.registeredSaveEvidence !== "allergy-insert") {
        pending.registeredSaveEvidence = allergiesQuery.isError ? "query-error" : "unknown";
      }
      return;
    }
    if (allergiesQuery.data.length === 0) {
      if (pending.registeredSaveEvidence === "allergy-insert") {
        void savePendingRegisteredStatus(selectedMemberId);
        return;
      }
      pending.registeredSaveEvidence = "known-empty";
      setMessage("登録ありの場合は1つ以上選んでください");
      return;
    }
    pending.registeredSaveEvidence = "allergy-query";
    void savePendingRegisteredStatus(selectedMemberId);
  }, [
    allergiesQuery.data,
    allergiesQuery.isError,
    allergiesQuery.isFetching,
    allergiesQuery.isRefetching,
    allergiesQuery.isSuccess,
    savePendingRegisteredStatus,
    selectedMemberId,
    allergyRefetchEpoch,
  ]);

  if (membersQuery.isPending || catalogQuery.isPending || aliasesQuery.isPending)
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  if (membersQuery.isError || catalogQuery.isError || aliasesQuery.isError)
    return (
      <main className="page-frame">
        <p role="alert">家族設定を読み込めませんでした。</p>
      </main>
    );
  if (values === undefined || selected === undefined) {
    return (
      <main className="page-frame stack">
        <h1>家族設定</h1>
        <p>家族を追加してください</p>
        <button
          className="primary-button"
          type="button"
          disabled={createDraft.isPending}
          onClick={() => {
            createDraft.mutate();
          }}
        >
          家族を追加
        </button>
      </main>
    );
  }
  const currentDislikes = dislikesQuery.data ?? [];
  const selectedAllergyMutationPending = allergyMutationPendingMemberIds.has(selected.id);
  const setArray = (
    key: "unsupportedDietKinds" | "requiredSafetyConstraints" | "easePreferences",
    item: string,
    checked: boolean,
  ) => {
    const current = values[key] as string[];
    updateAndSave({
      [key]: checked ? [...current, item] : current.filter((value) => value !== item),
    });
  };

  return (
    <main className="page-frame stack">
      <h1>家族設定</h1>
      {members.length > 1 && (
        <label className="field">
          <span>設定する家族</span>
          <select
            value={selected.id}
            onChange={(event) => {
              const nextSelectedId = event.target.value;
              selectedMemberIdRef.current = nextSelectedId;
              setDeleteTarget(undefined);
              setSelectedId(nextSelectedId);
            }}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name ?? "家族"}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        className="secondary-button"
        type="button"
        disabled={createDraft.isPending}
        onClick={() => {
          createDraft.mutate();
        }}
      >
        家族を追加
      </button>
      {message && (
        <p className="status-message" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {Object.keys(errors).length > 0 && (
        <p className="error-message" role="alert">
          {Object.values(errors).join(" ")}
        </p>
      )}
      <section className="card stack">
        <label className="field">
          <span>呼び名</span>
          <input
            value={values.displayName ?? ""}
            onChange={(event) => {
              updateAndSave({ displayName: event.target.value || null });
            }}
          />
        </label>
        <label className="field">
          <span>年齢のめやす</span>
          <select
            ref={ageBandRef}
            value={values.ageBand}
            onChange={(event) => {
              updateAndSave({
                ageBand: event.target.value as AgeBand,
                portionSize: defaultsForAgeBand(event.target.value as AgeBand).portion_size,
                spiceLevel: defaultsForAgeBand(event.target.value as AgeBand).spice_level,
                easePreferences: defaultsForAgeBand(event.target.value as AgeBand).ease_preferences,
                requiredSafetyConstraints: defaultsForAgeBand(event.target.value as AgeBand)
                  .required_safety_constraints,
              });
            }}
          >
            <option value="">選んでください</option>
            <option value="post_weaning_to_2">離乳食完了後〜2歳</option>
            <option value="age_3_5">3〜5歳</option>
            <option value="age_6_8">6〜8歳</option>
            <option value="age_9_12">9〜12歳</option>
            <option value="age_13_17">13〜17歳</option>
            <option value="adult">大人</option>
            <option value="senior">高齢者</option>
          </select>
        </label>
        <label className="field">
          <span>アレルギーの確認</span>
          <select
            ref={allergyStatusRef}
            value={values.allergyStatus}
            disabled={!allergiesQuery.isSuccess || selectedAllergyMutationPending}
            onChange={(event) => {
              if (allergyMutationPendingMemberIdsRef.current.has(selected.id)) return;
              const allergyStatus = event.target.value as AllergyStatus;
              updateAndSave({ allergyStatus });
            }}
          >
            <option value="">選んでください</option>
            <option value="none">なし</option>
            <option value="registered">登録あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>
        {allergiesQuery.isError && (
          <div className="stack">
            <p className="error-message" role="alert">
              アレルギー情報を読み込めませんでした
            </p>
            <button
              className="secondary-button"
              type="button"
              disabled={allergiesQuery.isFetching}
              onClick={() => {
                void allergiesQuery.refetch();
              }}
            >
              アレルギー情報を再読み込み
            </button>
          </div>
        )}
        {values.allergyStatus === "registered" && (
          <AllergyEditor
            memberId={selected.id}
            catalog={catalogQuery.data}
            aliases={aliasesQuery.data}
            allergies={currentAllergies}
            addStandard={(memberId, allergenId) =>
              runAllergyMutation(selected, async () => {
                await api.addStandardAllergy(memberId, allergenId);
                await finalizeAllergyChange(memberId);
              })
            }
            addCustom={(memberId, name, aliases) =>
              runAllergyMutation(selected, async () => {
                await api.addCustomAllergy(memberId, name, aliases);
                await finalizeAllergyChange(memberId);
              })
            }
            remove={(allergyId) =>
              runAllergyMutation(selected, async () => {
                if (
                  selected.status === "complete" &&
                  values.allergyStatus === "registered" &&
                  allergiesQuery.isSuccess &&
                  currentAllergies.length <= 1
                ) {
                  setMessage("登録ありの場合は1つ以上選んでください");
                  return;
                }
                await api.removeAllergy(allergyId);
                const pending = pendingRegisteredIntents.current.get(selected.id);
                const refetchToken = { settled: false };
                if (pending?.values.allergyStatus === "registered") {
                  pending.allergyRefetchPending = true;
                  pending.allergyRefetchStarted = false;
                  pending.registeredSaveEvidence = "unknown";
                  pending.revision += 1;
                  pending.allergyRefetchToken = refetchToken;
                }
                await queryClient.invalidateQueries({
                  queryKey: householdKeys.allergies("settings", selected.id),
                });
                if (
                  pendingRegisteredIntents.current.get(selected.id) === pending &&
                  pending?.allergyRefetchToken === refetchToken
                ) {
                  refetchToken.settled = true;
                  setAllergyRefetchEpoch((current) => current + 1);
                }
                await api.invalidateSafety();
              })
            }
            onError={(error) => {
              setMessage(
                error instanceof Error ? error.message : "アレルギー情報を更新できませんでした",
              );
            }}
            disabled={!allergiesQuery.isSuccess || selectedAllergyMutationPending}
          />
        )}
        <label className="field">
          <span>食べない食事はありますか</span>
          <select
            ref={unsupportedDietStatusRef}
            value={values.unsupportedDietStatus}
            onChange={(event) => {
              updateAndSave({
                unsupportedDietStatus: event.target.value as UnsupportedDietStatus,
                unsupportedDietKinds:
                  event.target.value === "present" ? values.unsupportedDietKinds : [],
              });
            }}
          >
            <option value="">選んでください</option>
            <option value="none">該当なし</option>
            <option value="present">該当あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>
        {values.unsupportedDietStatus === "present" && (
          <fieldset className="stack">
            <legend>食べない食事</legend>
            {unsupportedDietKinds.map((kind) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={values.unsupportedDietKinds.includes(kind)}
                  onChange={(event) => {
                    setArray("unsupportedDietKinds", kind, event.target.checked);
                  }}
                />
                {kind}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="stack">
          <legend>安全のための制約</legend>
          <label>
            <input
              type="checkbox"
              aria-label="骨を除く"
              checked={values.requiredSafetyConstraints.includes("remove_bones")}
              onChange={(event) => {
                setArray("requiredSafetyConstraints", "remove_bones", event.target.checked);
              }}
            />
            骨を除く
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="小さく切る"
              checked={values.requiredSafetyConstraints.includes("cut_small")}
              onChange={(event) => {
                setArray("requiredSafetyConstraints", "cut_small", event.target.checked);
              }}
            />
            小さく切る
          </label>
        </fieldset>
        <label className="field">
          <span>食べる量</span>
          <select
            value={values.portionSize}
            onChange={(event) => {
              updateAndSave({ portionSize: event.target.value as PortionSize });
            }}
          >
            <option value="small">小さめ</option>
            <option value="regular">ふつう</option>
            <option value="large">多め</option>
          </select>
        </label>
        <fieldset className="stack">
          <legend>苦手食材</legend>
          <label className="field">
            <span>苦手食材を追加</span>
            <input
              value={dislike}
              onChange={(event) => {
                setDislike(event.target.value);
              }}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              if (dislike.trim() === "") return;
              void api
                .addDislike(selected.id, dislike)
                .then(() =>
                  queryClient.invalidateQueries({
                    queryKey: householdKeys.dislikes("settings", selected.id),
                  }),
                )
                .then(() => {
                  setDislike("");
                  return api.invalidateSafety();
                });
            }}
          >
            苦手食材を追加
          </button>
          <ul>
            {currentDislikes.map((item) => (
              <li key={item.id}>
                {item.ingredient_name}
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    void api
                      .removeDislike(item.id)
                      .then(() =>
                        queryClient.invalidateQueries({
                          queryKey: householdKeys.dislikes("settings", selected.id),
                        }),
                      )
                      .then(() => api.invalidateSafety())
                  }
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        <label className="field">
          <span>辛さ</span>
          <select
            aria-label="辛さ"
            value={values.spiceLevel}
            onChange={(event) => {
              updateAndSave({ spiceLevel: event.target.value as SpiceLevel });
            }}
          >
            <option value="none">なし</option>
            <option value="mild">控えめ</option>
            <option value="regular">ふつう</option>
          </select>
        </label>
        <fieldset className="stack">
          <legend>食べやすさ</legend>
          {easePreferences.map((preference) => (
            <label key={preference}>
              <input
                type="checkbox"
                aria-label={preference === "small_pieces" ? "小さめ" : preference}
                checked={values.easePreferences.includes(preference)}
                onChange={(event) => {
                  setArray("easePreferences", preference, event.target.checked);
                }}
              />
              {preference === "small_pieces"
                ? "小さめ"
                : preference === "boneless"
                  ? "骨なし"
                  : "やわらかめ"}
            </label>
          ))}
        </fieldset>
      </section>
      <button
        className="primary-button"
        type="button"
        disabled={saving}
        onClick={() => void complete()}
      >
        この家族の設定を完了
      </button>
      <button
        ref={deleteTrigger}
        className="secondary-button"
        type="button"
        disabled={selectedAllergyMutationPending || deletingMemberIds.has(selected.id)}
        onClick={() => {
          if (
            allergyMutationPendingMemberIdsRef.current.has(selected.id) ||
            deletingMemberIdsRef.current.has(selected.id)
          ) {
            return;
          }
          setDeleteTarget(selected);
        }}
      >
        家族を削除
      </button>
      {deleteTarget !== undefined && (
        <div role="dialog" aria-modal="true" aria-label="家族の削除確認" className="card stack">
          <p>この家族の設定だけを削除します。</p>
          <button
            ref={deleteConfirm}
            className="primary-button"
            type="button"
            disabled={
              allergyMutationPendingMemberIdsRef.current.has(deleteTarget.id) ||
              deletingMemberIds.has(deleteTarget.id)
            }
            onClick={() => {
              const targetId = deleteTarget.id;
              if (
                allergyMutationPendingMemberIdsRef.current.has(targetId) ||
                deletingMemberIdsRef.current.has(targetId)
              ) {
                return;
              }
              const targetExists = queryClient
                .getQueryData<HouseholdMemberRow[]>(membersKey)
                ?.some((member) => member.id === targetId);
              if (targetExists !== true) {
                setDeleteTarget(undefined);
                return;
              }
              deletingMemberIdsRef.current.add(targetId);
              setDeletingMemberIds(new Set(deletingMemberIdsRef.current));
              void api
                .deleteMember(targetId)
                .then(async () => {
                  setDeleteTarget((current) => (current?.id === targetId ? undefined : current));
                  queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) =>
                    current.filter((member) => member.id !== targetId),
                  );
                  valuesByMemberRef.current.delete(targetId);
                  pendingOperationCountsRef.current.delete(targetId);
                  failedSaveMemberIdsRef.current.delete(targetId);
                  pendingRegisteredIntents.current.delete(targetId);
                  allergyMutationPendingMemberIdsRef.current.delete(targetId);
                  setAllergyMutationPendingMemberIds(
                    new Set(allergyMutationPendingMemberIdsRef.current),
                  );
                  if (selectedMemberIdRef.current === targetId) {
                    selectedMemberIdRef.current = undefined;
                    setSelectedId(undefined);
                    setValues(undefined);
                  }
                  await queryClient.invalidateQueries({ queryKey: membersKey });
                  await api.invalidateSafety();
                })
                .catch((error: unknown) => {
                  setMessage(
                    error instanceof Error ? error.message : "家族設定を削除できませんでした",
                  );
                })
                .finally(() => {
                  deletingMemberIdsRef.current.delete(targetId);
                  setDeletingMemberIds(new Set(deletingMemberIdsRef.current));
                });
            }}
          >
            家族だけを削除
          </button>
          <button
            className="text-button"
            type="button"
            disabled={deletingMemberIds.has(deleteTarget.id)}
            onClick={() => {
              if (deletingMemberIdsRef.current.has(deleteTarget.id)) return;
              setDeleteTarget(undefined);
            }}
          >
            キャンセル
          </button>
        </div>
      )}
      {/* Plan 6: アカウント操作は本ページ所有者の下に合成するだけ。家族 CRUD は置換しない。 */}
      <AccountSettingsSection />
    </main>
  );
}
