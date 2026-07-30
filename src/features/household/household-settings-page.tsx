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
import { useSearchParams } from "react-router";
import { AccountSettingsSection } from "@/features/account/account-settings-section";
import { FeedbackSection } from "@/features/account/feedback-section";
import { useAuth } from "@/features/auth/use-auth";
import { PlanSettingsSection } from "@/features/billing/plan-settings-section";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { useAppToast } from "@/shared/ui/app-toast";
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

type SaveLineage = {
  memberId: string;
  revision: number;
  operationToken: number;
  feedbackRevision: number;
};

const householdAgeLabels: Readonly<Record<string, string>> = {
  post_weaning_to_2: "離乳食完了後〜2歳",
  age_3_5: "3〜5歳",
  age_6_8: "6〜8歳",
  age_9_12: "9〜12歳",
  age_13_17: "13〜17歳",
  adult: "大人",
  senior: "高齢者",
};

/** 食べない食事の表示ラベル。enum キー（英語）を画面に出さない（オンボーディングと同文言）。 */
const unsupportedDietKindLabels: Readonly<Record<UnsupportedDietKind, string>> = {
  weaning_food: "離乳食",
  swallowing_concern: "飲み込み・むせの不安",
  therapeutic_diet: "医師等から指示された治療食",
};

function householdMemberDisplayName(member: HouseholdMemberRow): string {
  // 未設定時に「呼び名」を含むと、編集ボタンの aria-label が
  // フォーム項目「呼び名」と部分一致し、スクリーンリーダーと Playwright の
  // getByLabel で同一コントロールと紛らわしくなる。ラベル語を避けた文言にする。
  return member.display_name?.trim() || "名前未設定";
}

function registeredSaveBlockedMessage(
  evidence: PendingRegisteredIntent["registeredSaveEvidence"],
): string | undefined {
  if (evidence === "known-empty") return "登録ありの場合は1つ以上選んでください";
  if (evidence === "unknown") return "アレルギー情報を確認しています";
  if (evidence === "query-error")
    return "アレルギー情報を確認できませんでした。もう一度お試しください";
  return undefined;
}

/** schema 定義順の先頭 field error（validation toast / form alert の正本） */
function firstHouseholdFieldError(
  errors: HouseholdFieldErrors,
): { key: keyof HouseholdSettingsValue; message: string } | undefined {
  const fieldOrder = Object.keys(householdSettingsSchema.shape) as (keyof HouseholdSettingsValue)[];
  for (const key of fieldOrder) {
    const message = errors[key];
    if (message !== undefined) {
      return { key, message };
    }
  }
  return undefined;
}

const HOUSEHOLD_FORM_ERROR_ID = "household-settings-form-error";
const FALLBACK_VALIDATION_TOAST = "入力内容を確認してください";

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
  const { show: showToast, dismiss: dismissToast } = useAppToast();
  // Checkout 成功戻り ?billing=success で entitlement を短周期 re-fetch（webhook 遅延 UX）
  const [searchParams, setSearchParams] = useSearchParams();
  const billingReturn = searchParams.get("billing");
  const pollAfterCheckoutSuccess = billingReturn === "success";
  // Plus 反映・5 分 deadline・連続失敗後は query を外し無期限 poll を止める
  const clearBillingReturnQuery = useCallback(() => {
    if (!searchParams.has("billing")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("billing");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const membersKey = useMemo(() => householdKeys.members(userId), [userId]);
  const [selectedId, setSelectedId] = useState<string>();
  // 登録済み家族がある状態でページを開き直したとき、編集フォームを自動展開しない。
  // 一覧だけ見せ、編集は「編集」／追加は「家族を追加」の明示操作でのみ開く。
  const [editorOpen, setEditorOpen] = useState(false);
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
  const [dislikeMutationPendingMemberIds, setDislikeMutationPendingMemberIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const savingRef = useRef(false);
  // ルート離脱で validation toast を残さない
  useEffect(() => {
    return () => {
      dismissToast();
    };
  }, [dismissToast]);
  const saveQueue = useRef(Promise.resolve(true));
  const valuesByMemberRef = useRef(new Map<string, HouseholdSettingsValue>());
  const editRevisionsByMemberRef = useRef(new Map<string, number>());
  const operationTokensByMemberRef = useRef(new Map<string, number>());
  const pendingOperationCountsRef = useRef(new Map<string, number>());
  const failedSaveMemberIdsRef = useRef(new Set<string>());
  const allergyMutationPendingMemberIdsRef = useRef(new Set<string>());
  const dislikeMutationPendingMemberIdsRef = useRef(new Set<string>());
  const deletingMemberIdsRef = useRef(new Set<string>());
  const creatingDraftRef = useRef(false);
  const cancellingDraftRef = useRef(false);
  const selectedMemberIdRef = useRef<string | undefined>(undefined);
  const feedbackRevisionRef = useRef(0);
  // 「家族を追加」直前の選択。下書き追加をやめるときに戻す先。
  const previousSelectedIdBeforeAddRef = useRef<string | undefined>(undefined);
  const pendingRegisteredIntents = useRef(new Map<string, PendingRegisteredIntent>());
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const deleteConfirm = useRef<HTMLButtonElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusEditorHeadingRef = useRef(false);
  // 「追加をやめる」成功後に一覧上部へ戻す（末尾の削除ボタン誤操作を防ぐ）
  const shouldScrollToPageTopRef = useRef(false);
  const ageBandRef = useRef<HTMLSelectElement>(null);
  const allergyStatusRef = useRef<HTMLSelectElement>(null);
  const unsupportedDietStatusRef = useRef<HTMLSelectElement>(null);
  // present かつ kinds 0 件のスキーマ失敗時に先頭 checkbox へ focus（オンボーディングと同方針）
  const unsupportedDietKindsRef = useRef<HTMLFieldSetElement>(null);
  const beginSaveLineage = useCallback((memberId: string): SaveLineage => {
    const operationToken = (operationTokensByMemberRef.current.get(memberId) ?? 0) + 1;
    operationTokensByMemberRef.current.set(memberId, operationToken);
    return {
      memberId,
      revision: editRevisionsByMemberRef.current.get(memberId) ?? 0,
      operationToken,
      feedbackRevision: feedbackRevisionRef.current,
    };
  }, []);
  const isLatestSaveRevision = useCallback(
    (lineage: SaveLineage) =>
      (editRevisionsByMemberRef.current.get(lineage.memberId) ?? 0) === lineage.revision,
    [],
  );
  const canPublishSaveMessage = useCallback(
    (lineage: SaveLineage) =>
      selectedMemberIdRef.current === lineage.memberId &&
      feedbackRevisionRef.current === lineage.feedbackRevision &&
      isLatestSaveRevision(lineage) &&
      operationTokensByMemberRef.current.get(lineage.memberId) === lineage.operationToken,
    [isLatestSaveRevision],
  );
  const beginEditorTransition = (memberId: string | undefined) => {
    feedbackRevisionRef.current += 1;
    selectedMemberIdRef.current = memberId;
    setMessage("");
    setErrors({});
    // 家族切替はフォーム離脱相当。validation toast を持ち越さない
    dismissToast();
  };
  useEffect(() => {
    if (!editorOpen || !shouldFocusEditorHeadingRef.current) {
      return;
    }
    shouldFocusEditorHeadingRef.current = false;
    editorHeadingRef.current?.focus();
  }, [editorOpen, selectedId]);
  useEffect(() => {
    if (!shouldScrollToPageTopRef.current) return;
    shouldScrollToPageTopRef.current = false;
    // 編集フォーム末尾にいた視線を一覧・見出しへ戻す。
    // focus 可能な見出しへ寄せ、画面スクロールも合わせて先頭へ。
    // jsdom には scrollIntoView が無い環境があるため存在確認する。
    const heading = pageHeadingRef.current;
    if (heading === null) return;
    try {
      if (typeof heading.scrollIntoView === "function") {
        heading.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
      }
    } catch {
      // jsdom など scroll API 未実装環境では無視する
    }
    heading.focus({ preventScroll: true });
  }, [editorOpen, message]);
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
  // 選択中IDが外部削除などで消えたら残存先頭へ同期し、空editorや誤保存対象を防ぐ。
  const selected =
    selectedId === undefined
      ? members[0]
      : (members.find((member) => member.id === selectedId) ?? members[0]);
  selectedMemberIdRef.current = selected?.id;
  const allergiesQuery = useQuery({
    queryKey: selected
      ? householdKeys.allergies(userId, selected.id)
      : ["settings-allergies", "none"],
    queryFn: () => api.listAllergies(selected?.id ?? "none"),
    enabled: selected !== undefined,
  });
  const currentAllergies = allergiesQuery.data ?? [];
  const dislikesQuery = useQuery({
    queryKey: selected
      ? householdKeys.dislikes(userId, selected.id)
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
    // 一覧の別行削除では selected と deleteTarget が食い違うのが正常。
    // 対象がメンバー一覧から消えたときだけダイアログを閉じる。
    // （別メンバーの「編集」は onClick 側で setDeleteTarget(undefined) する）
    if (!members.some((member) => member.id === deleteTarget.id)) {
      setDeleteTarget(undefined);
    }
  }, [deleteTarget, members]);

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
    if (savingRef.current || selected === undefined) return undefined;
    const current = valuesByMemberRef.current.get(selected.id);
    if (current === undefined) return undefined;
    const next = { ...current, ...patch };
    editRevisionsByMemberRef.current.set(
      selected.id,
      (editRevisionsByMemberRef.current.get(selected.id) ?? 0) + 1,
    );
    valuesByMemberRef.current.set(selected.id, next);
    setValues(next);
    return next;
  };
  const save = useCallback(
    async (
      member: HouseholdMemberRow,
      next: HouseholdSettingsValue,
      lineage: SaveLineage,
    ): Promise<boolean> => {
      const parsed = householdSettingsSchema.safeParse(next);
      if (!parsed.success) {
        if (canPublishSaveMessage(lineage)) {
          setErrors(toHouseholdFieldErrors(parsed.error));
        }
        return false;
      }
      if (canPublishSaveMessage(lineage)) {
        setErrors({});
      }
      try {
        const patch = toMemberPatch(parsed.data);
        const saved =
          member.status === "draft"
            ? await api.updateDraft(member.id, patch)
            : await api.updateMember(member.id, patch);
        if (isLatestSaveRevision(lineage)) {
          const cachedMember = { ...saved, ...patch };
          queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) =>
            current.map((currentMember) =>
              currentMember.id === saved.id ? cachedMember : currentMember,
            ),
          );
        }
        await api.invalidateSafety();
        if (canPublishSaveMessage(lineage)) {
          const pending = pendingRegisteredIntents.current.get(member.id);
          setMessage(
            pending?.values.allergyStatus === "registered"
              ? (registeredSaveBlockedMessage(pending.registeredSaveEvidence) ??
                  "家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します")
              : "家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します",
          );
        }
        return true;
      } catch (error) {
        if (canPublishSaveMessage(lineage)) {
          setMessage(error instanceof Error ? error.message : "家族設定を保存できませんでした");
        }
        return false;
      }
    },
    [api, canPublishSaveMessage, isLatestSaveRevision, membersKey, queryClient],
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
    if (savingRef.current || allergyMutationPendingMemberIdsRef.current.has(memberId)) return false;
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
  const beginDislikeMutation = (memberId: string) => {
    // 完了処理との競合を同期的に防ぐため、API開始前に家族単位の更新中状態を確定する。
    if (savingRef.current || dislikeMutationPendingMemberIdsRef.current.has(memberId)) return false;
    dislikeMutationPendingMemberIdsRef.current.add(memberId);
    setDislikeMutationPendingMemberIds(new Set(dislikeMutationPendingMemberIdsRef.current));
    return true;
  };
  const finishDislikeMutation = (memberId: string) => {
    dislikeMutationPendingMemberIdsRef.current.delete(memberId);
    setDislikeMutationPendingMemberIds(new Set(dislikeMutationPendingMemberIdsRef.current));
  };
  const runDislikeMutation = async (
    memberId: string,
    operation: () => Promise<void>,
    fallbackMessage: string,
    onCurrentSuccess?: () => void,
  ) => {
    if (!beginDislikeMutation(memberId)) return;
    const feedbackRevision = feedbackRevisionRef.current;
    const isCurrentFeedback = () =>
      selectedMemberIdRef.current === memberId && feedbackRevisionRef.current === feedbackRevision;
    try {
      await operation();
      if (isCurrentFeedback()) onCurrentSuccess?.();
    } catch (error) {
      if (isCurrentFeedback()) {
        setMessage(error instanceof Error ? error.message : fallbackMessage);
      }
    } finally {
      finishDislikeMutation(memberId);
    }
  };
  const queueSave = useCallback(
    (
      member: HouseholdMemberRow,
      localSnapshot: HouseholdSettingsValue,
      persistedValues: HouseholdSettingsValue = localSnapshot,
      shouldSave?: () => boolean,
    ) => {
      if (savingRef.current) return Promise.resolve(undefined);
      let skipped = false;
      const lineage = beginSaveLineage(member.id);
      beginPendingOperation(member, localSnapshot);
      saveQueue.current = saveQueue.current
        .then(() => {
          if (shouldSave !== undefined && !shouldSave()) {
            skipped = true;
            return true;
          }
          return save(member, persistedValues, lineage);
        })
        .catch(() => false)
        .then((saved) => {
          if (!skipped && isLatestSaveRevision(lineage)) {
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
    [beginPendingOperation, beginSaveLineage, finishPendingOperation, isLatestSaveRevision, save],
  );
  const savePendingRegisteredStatus = useCallback(
    (memberId: string): Promise<boolean | undefined> => {
      if (savingRef.current) return Promise.resolve(undefined);
      const pending = pendingRegisteredIntents.current.get(memberId);
      if (pending === undefined) return Promise.resolve(undefined);
      if (pending.inFlight !== undefined) return pending.inFlight;
      const inFlight = (async (): Promise<boolean | undefined> => {
        for (;;) {
          if (savingRef.current) {
            delete pending.inFlight;
            return undefined;
          }
          const current = pendingRegisteredIntents.current.get(memberId);
          if (current !== pending) return false;
          if (
            current.values.allergyStatus === "registered" &&
            current.registeredSaveEvidence !== "allergy-query" &&
            current.registeredSaveEvidence !== "allergy-insert"
          ) {
            delete current.inFlight;
            if (selectedMemberIdRef.current === memberId) {
              setMessage(registeredSaveBlockedMessage(current.registeredSaveEvidence) ?? "");
            }
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
              if (selectedMemberIdRef.current === memberId) {
                setMessage(registeredSaveBlockedMessage(latest.registeredSaveEvidence) ?? "");
              }
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
        queryKey: householdKeys.allergies(userId, memberId),
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
    [api, queryClient, savePendingRegisteredStatus, userId],
  );
  const createDraft = useMutation({
    mutationFn: () => api.createDraft(members.length),
    onMutate: () => {
      // 成功後に戻れるよう、追加操作を始めた時点の選択を記録する
      previousSelectedIdBeforeAddRef.current = selectedMemberIdRef.current;
      // 失敗時も元の家族フォームが残るため、選択は維持し feedback だけ更新する。
      // 作成成功時に onSuccess で created.id へ切り替える。
      beginEditorTransition(selectedMemberIdRef.current);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) => [
        ...current,
        created,
      ]);
      beginEditorTransition(created.id);
      setSelectedId(created.id);
      setEditorOpen(true);
    },
    onError: (error) => {
      // 下書き作成失敗は選択を変えず、平易なエラーだけを表示する
      setMessage(error instanceof Error ? error.message : "家族の追加に失敗しました");
    },
    onSettled: () => {
      creatingDraftRef.current = false;
    },
  });
  const requestCreateDraft = () => {
    if (savingRef.current || creatingDraftRef.current || cancellingDraftRef.current) return;
    creatingDraftRef.current = true;
    createDraft.mutate();
  };
  const [cancellingDraft, setCancellingDraft] = useState(false);

  /** 削除対象に紐づくローカル編集状態を掃除する。 */
  const clearMemberLocalState = useCallback((targetId: string) => {
    valuesByMemberRef.current.delete(targetId);
    editRevisionsByMemberRef.current.delete(targetId);
    operationTokensByMemberRef.current.delete(targetId);
    pendingOperationCountsRef.current.delete(targetId);
    failedSaveMemberIdsRef.current.delete(targetId);
    pendingRegisteredIntents.current.delete(targetId);
    allergyMutationPendingMemberIdsRef.current.delete(targetId);
    setAllergyMutationPendingMemberIds(new Set(allergyMutationPendingMemberIdsRef.current));
  }, []);

  /**
   * メンバー削除の共通処理。
   * - asCancelDraft: 入力途中の「追加をやめる」。前の選択へ戻し、削除成功メッセージを変える。
   * - それ以外: 確認ダイアログ経由の削除。対象が編集中なら編集を閉じる。
   */
  const performMemberDelete = useCallback(
    async (target: HouseholdMemberRow, options: { asCancelDraft: boolean }): Promise<void> => {
      const targetId = target.id;
      if (
        savingRef.current ||
        creatingDraftRef.current ||
        cancellingDraftRef.current ||
        deletingMemberIdsRef.current.has(targetId)
      ) {
        return;
      }
      if (options.asCancelDraft) {
        cancellingDraftRef.current = true;
        setCancellingDraft(true);
      } else {
        deletingMemberIdsRef.current.add(targetId);
        setDeletingMemberIds(new Set(deletingMemberIdsRef.current));
      }
      setMessage("");
      try {
        await api.deleteMember(targetId);
        queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) =>
          current.filter((member) => member.id !== targetId),
        );
        clearMemberLocalState(targetId);
        setDeleteTarget((current) => (current?.id === targetId ? undefined : current));
        const remaining =
          queryClient
            .getQueryData<HouseholdMemberRow[]>(membersKey)
            ?.filter((member) => member.id !== targetId) ?? [];
        const wasSelected = selectedMemberIdRef.current === targetId;

        if (options.asCancelDraft) {
          // 追加キャンセル: フォームは必ず閉じる。
          // 末尾の「追加をやめる」が「家族を削除」にすり替わり、連打で全員消えるのを防ぐ。
          // 視線は一覧・見出し（上部）へ戻す。
          const restoreId = previousSelectedIdBeforeAddRef.current;
          const restore =
            restoreId !== undefined && restoreId !== targetId
              ? remaining.find((member) => member.id === restoreId)
              : undefined;
          const nextSelected = restore ?? remaining[0];
          selectedMemberIdRef.current = nextSelected?.id;
          setSelectedId(nextSelected?.id);
          setValues(undefined);
          setEditorOpen(false);
          previousSelectedIdBeforeAddRef.current = undefined;
          shouldScrollToPageTopRef.current = true;
          setMessage("家族の追加をやめました");
        } else if (wasSelected) {
          // 編集中の家族を削除したらフォームを閉じ、一覧だけ残す。
          selectedMemberIdRef.current = undefined;
          setSelectedId(undefined);
          setValues(undefined);
          setEditorOpen(false);
          previousSelectedIdBeforeAddRef.current = undefined;
          setMessage(
            target.status === "draft"
              ? "入力途中の家族をリストから外しました"
              : "家族の設定を削除しました",
          );
        } else {
          // 一覧から別の家族を削除。編集中の選択はそのまま。
          setMessage(
            target.status === "draft"
              ? "入力途中の家族をリストから外しました"
              : "家族の設定を削除しました",
          );
        }
        await queryClient.invalidateQueries({ queryKey: membersKey });
        await api.invalidateSafety();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : options.asCancelDraft
              ? "追加のキャンセルに失敗しました"
              : "家族設定を削除できませんでした",
        );
      } finally {
        if (options.asCancelDraft) {
          cancellingDraftRef.current = false;
          setCancellingDraft(false);
        } else {
          deletingMemberIdsRef.current.delete(targetId);
          setDeletingMemberIds(new Set(deletingMemberIdsRef.current));
        }
      }
    },
    [api, clearMemberLocalState, membersKey, queryClient],
  );

  const cancelDraftAdd = useCallback(async (): Promise<void> => {
    if (selected === undefined || selected.status !== "draft" || cancellingDraft) return;
    await performMemberDelete(selected, { asCancelDraft: true });
  }, [cancellingDraft, performMemberDelete, selected]);

  const confirmDeleteTarget = useCallback(async (): Promise<void> => {
    if (deleteTarget === undefined) return;
    // 確認ダイアログ経由は常に「削除」経路（draft も complete も同じ）
    await performMemberDelete(deleteTarget, { asCancelDraft: false });
  }, [deleteTarget, performMemberDelete]);
  const complete = async () => {
    if (
      savingRef.current ||
      creatingDraftRef.current ||
      cancellingDraftRef.current ||
      selected === undefined ||
      values === undefined ||
      allergyMutationPendingMemberIdsRef.current.has(selected.id) ||
      dislikeMutationPendingMemberIdsRef.current.has(selected.id) ||
      deletingMemberIdsRef.current.has(selected.id)
    )
      return;
    const completingMemberId = selected.id;
    const parsed = householdSettingsSchema.safeParse(values);
    if (!parsed.success) {
      const nextErrors = toHouseholdFieldErrors(parsed.error);
      setErrors(nextErrors);
      // 必須漏れ: field error + toast（先頭 message）+ focus。
      // toast が role=status のため、autosave 成功の status 行を消して二重を避ける
      setMessage("");
      const lead = firstHouseholdFieldError(nextErrors);
      showToast({
        message: lead?.message ?? FALLBACK_VALIDATION_TOAST,
        tone: "error",
      });
      if (lead === undefined) {
        return;
      }
      // kinds は select ではなく fieldset 内の先頭 checkbox へ（オンボーディングと同じ）
      if (lead.key === "unsupportedDietKinds") {
        const firstCheckbox =
          unsupportedDietKindsRef.current?.querySelector<HTMLInputElement>("input:not([disabled])");
        firstCheckbox?.focus();
        return;
      }
      const fieldRefs: Partial<Record<keyof HouseholdSettingsValue, typeof ageBandRef>> = {
        ageBand: ageBandRef,
        allergyStatus: allergyStatusRef,
        unsupportedDietStatus: unsupportedDietStatusRef,
      };
      fieldRefs[lead.key]?.current?.focus();
      return;
    }
    if (parsed.data.allergyStatus === "registered" && !allergiesQuery.isSuccess) {
      // 確認中・取得失敗は既存 status 行のみ（toast なし。retry 導線を隠さない）
      setMessage(
        allergiesQuery.isError
          ? "アレルギー情報を確認できませんでした。もう一度お試しください"
          : "アレルギー情報を確認しています",
      );
      if (allergiesQuery.isError) void allergiesQuery.refetch();
      return;
    }
    if (parsed.data.allergyStatus === "registered" && currentAllergies.length === 0) {
      // 既存メッセージを field/inline に出し、同じ意味の toast（設計 §6.3 家族）
      // toast が role=status のため、autosave 側の status 行（setMessage）は消して二重を避ける
      const registeredEmptyMessage = "登録ありの場合は1つ以上選んでください";
      setMessage("");
      setErrors({ allergyStatus: registeredEmptyMessage });
      showToast({ message: registeredEmptyMessage, tone: "error" });
      allergyStatusRef.current?.focus();
      return;
    }
    // バリデーション通過後は validation toast を即 dismiss（duration 待ちしない）
    dismissToast();
    setErrors({});
    // 完了snapshotの保存中は同じフォームから新しい書込みを開始させず、DBの後勝ち競合を防ぐ。
    savingRef.current = true;
    setSaving(true);
    const lineage = beginSaveLineage(completingMemberId);
    const completionHasNoLaterEdits = () => isLatestSaveRevision(lineage);
    const canCloseCompletedEditor = () =>
      canPublishSaveMessage(lineage) &&
      (pendingOperationCountsRef.current.get(completingMemberId) ?? 0) === 0 &&
      !dislikeMutationPendingMemberIdsRef.current.has(completingMemberId) &&
      !failedSaveMemberIdsRef.current.has(completingMemberId);
    try {
      await saveQueue.current;
      const saved = await save(selected, parsed.data, lineage);
      if (!saved) {
        if (completionHasNoLaterEdits()) {
          failedSaveMemberIdsRef.current.add(selected.id);
        }
        return;
      }
      if (completionHasNoLaterEdits()) {
        failedSaveMemberIdsRef.current.delete(selected.id);
        pendingRegisteredIntents.current.delete(selected.id);
      }
      if (selected.status === "draft") {
        try {
          const completed = await api.completeMember(selected.id);
          if (completionHasNoLaterEdits()) {
            queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) =>
              current.map((member) => (member.id === completed.id ? completed : member)),
            );
          }
          await api.invalidateSafety();
          if (canPublishSaveMessage(lineage)) {
            setMessage("家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します");
          }
          if (canCloseCompletedEditor()) {
            setEditorOpen(false);
          }
        } catch (error) {
          if (canPublishSaveMessage(lineage)) {
            setMessage(error instanceof Error ? error.message : "家族設定を完了できませんでした");
          }
        }
      } else if (canCloseCompletedEditor()) {
        setEditorOpen(false);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const updateAndSave = (patch: Partial<HouseholdSettingsValue>) => {
    if (savingRef.current) return;
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
  // 編集を開いているときだけ values を要求する。一覧表示中に values 未初期化で
  // 画面全体をローディングへ落とさない（削除後の不整合を防ぐ）。
  if (editorOpen && values === undefined && selected !== undefined) {
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  }
  if (members.length === 0) {
    return (
      <main className="page-frame stack">
        <h1>家族設定</h1>
        <section className="card stack" aria-labelledby="registered-household-empty-title">
          <h2 id="registered-household-empty-title">登録済みの家族</h2>
          <p>登録済みの家族はいません。</p>
        </section>
        <section className="card stack" aria-labelledby="household-editor-empty-title">
          <h2 id="household-editor-empty-title">家族情報を追加・編集</h2>
          <p>家族を追加してください</p>
          <button
            className="primary-button"
            type="button"
            disabled={createDraft.isPending || saving}
            onClick={() => {
              requestCreateDraft();
            }}
          >
            家族を追加
          </button>
        </section>
        {/* L10-5: プラン管理はアカウント操作の直前。Checkout 成功時は短周期 re-fetch。 */}
        <PlanSettingsSection
          userId={userId}
          pollAfterCheckoutSuccess={pollAfterCheckoutSuccess}
          onCheckoutPollSettled={clearBillingReturnQuery}
        />
        {/* アカウント操作（ログアウト等）の下にフィードバックを置く */}
        <AccountSettingsSection />
        <FeedbackSection />
      </main>
    );
  }
  // 一覧表示のみ（編集クローズ）で selected/values が揃う前でも一覧を出す
  if (editorOpen && (values === undefined || selected === undefined)) {
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  }
  const currentDislikes = dislikesQuery.data ?? [];
  const selectedAllergyMutationPending =
    selected !== undefined && allergyMutationPendingMemberIds.has(selected.id);
  const selectedDislikeMutationPending =
    selected !== undefined && dislikeMutationPendingMemberIds.has(selected.id);
  const completionBlockedByMutation =
    selectedAllergyMutationPending ||
    selectedDislikeMutationPending ||
    (selected !== undefined && deletingMemberIds.has(selected.id)) ||
    createDraft.isPending ||
    cancellingDraft;
  const setArray = (
    key: "unsupportedDietKinds" | "requiredSafetyConstraints" | "easePreferences",
    item: string,
    checked: boolean,
  ) => {
    if (values === undefined) return;
    const current = values[key] as string[];
    updateAndSave({
      [key]: checked ? [...current, item] : current.filter((value) => value !== item),
    });
  };

  return (
    <main className="page-frame stack">
      <h1 ref={pageHeadingRef} tabIndex={-1}>
        家族設定
      </h1>
      <section className="card stack settings-section" aria-labelledby="registered-household-title">
        <h2 id="registered-household-title" className="settings-section-title">
          登録済みの家族
        </h2>
        <ul className="household-member-list">
          {members.map((member, index) => {
            const displayName = householdMemberDisplayName(member);
            return (
              <li className="household-member-summary" key={member.id}>
                <div>
                  <strong className="household-member-name">{displayName}</strong>
                  <p>
                    {member.age_band === null
                      ? "年齢未設定"
                      : (householdAgeLabels[member.age_band] ?? "年齢未設定")}
                    ・{member.status === "complete" ? "登録完了" : "入力途中"}
                  </p>
                </div>
                <div className="household-member-actions">
                  <button
                    className="secondary-button min-h-11"
                    type="button"
                    disabled={saving}
                    aria-label={`${String(index + 1)}人目の${displayName}を編集`}
                    aria-pressed={editorOpen && selected?.id === member.id}
                    onClick={() => {
                      if (savingRef.current) return;
                      shouldFocusEditorHeadingRef.current = true;
                      beginEditorTransition(member.id);
                      setDeleteTarget(undefined);
                      setSelectedId(member.id);
                      setEditorOpen(true);
                    }}
                  >
                    編集
                  </button>
                  <button
                    className="secondary-button min-h-11"
                    type="button"
                    disabled={
                      saving ||
                      deletingMemberIds.has(member.id) ||
                      cancellingDraft ||
                      createDraft.isPending
                    }
                    aria-label={`${String(index + 1)}人目の${displayName}を削除`}
                    onClick={() => {
                      if (
                        savingRef.current ||
                        deletingMemberIdsRef.current.has(member.id) ||
                        cancellingDraftRef.current
                      ) {
                        return;
                      }
                      // 一覧からも同じ確認ダイアログへ。編集を開かずに削除できる。
                      setDeleteTarget(member);
                    }}
                  >
                    削除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {!editorOpen && (
        <button
          className="secondary-button"
          type="button"
          disabled={createDraft.isPending || saving}
          onClick={() => {
            requestCreateDraft();
          }}
        >
          家族を追加
        </button>
      )}
      {!editorOpen && message && (
        <p className="status-message" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {!editorOpen && firstHouseholdFieldError(errors) !== undefined && (
        <p id={HOUSEHOLD_FORM_ERROR_ID} className="error-message" role="alert">
          {firstHouseholdFieldError(errors)?.message}
        </p>
      )}
      {editorOpen && selected !== undefined && values !== undefined && (
        <section
          className="household-editor stack settings-section"
          aria-labelledby="household-editor-title"
        >
          <h2 id="household-editor-title" className="settings-section-title">
            家族情報を追加・編集
          </h2>
          <h3 ref={editorHeadingRef} tabIndex={-1}>
            「{householdMemberDisplayName(selected)}」を編集中
          </h3>
          {message && (
            <p className="status-message" role="status" aria-live="polite">
              {message}
            </p>
          )}
          {/* フォームレベル role=alert は先頭エラー1つ（設計 §6.3） */}
          {firstHouseholdFieldError(errors) !== undefined && (
            <p id={HOUSEHOLD_FORM_ERROR_ID} className="error-message" role="alert">
              {firstHouseholdFieldError(errors)?.message}
            </p>
          )}
          <fieldset className="card stack" disabled={saving} aria-label="基本情報">
            <legend className="settings-section-title">基本情報</legend>
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
                aria-invalid={errors.ageBand !== undefined ? true : undefined}
                aria-describedby={
                  errors.ageBand !== undefined ? HOUSEHOLD_FORM_ERROR_ID : undefined
                }
                onChange={(event) => {
                  const nextAge = event.target.value as AgeBand;
                  const nextDefaults = defaultsForAgeBand(nextAge);
                  // 直前の年齢デフォルトと一致する項目だけ上書きし、ユーザー編集を黙って潰さない。
                  const previousAge = values.ageBand;
                  const previousDefaults =
                    previousAge in householdAgeLabels ? defaultsForAgeBand(previousAge) : null;
                  const stillAtPreviousDefault = <T,>(
                    current: T,
                    previousDefault: T | undefined,
                  ): boolean =>
                    previousDefaults === null ||
                    previousDefault === undefined ||
                    JSON.stringify(current) === JSON.stringify(previousDefault);
                  updateAndSave({
                    ageBand: nextAge,
                    portionSize: stillAtPreviousDefault(
                      values.portionSize,
                      previousDefaults?.portion_size,
                    )
                      ? nextDefaults.portion_size
                      : values.portionSize,
                    spiceLevel: stillAtPreviousDefault(
                      values.spiceLevel,
                      previousDefaults?.spice_level,
                    )
                      ? nextDefaults.spice_level
                      : values.spiceLevel,
                    easePreferences: stillAtPreviousDefault(
                      values.easePreferences,
                      previousDefaults?.ease_preferences,
                    )
                      ? nextDefaults.ease_preferences
                      : values.easePreferences,
                    requiredSafetyConstraints: stillAtPreviousDefault(
                      values.requiredSafetyConstraints,
                      previousDefaults?.required_safety_constraints,
                    )
                      ? nextDefaults.required_safety_constraints
                      : values.requiredSafetyConstraints,
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
                aria-invalid={errors.allergyStatus !== undefined ? true : undefined}
                aria-describedby={
                  errors.allergyStatus !== undefined ? HOUSEHOLD_FORM_ERROR_ID : undefined
                }
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
            {(values.allergyStatus === "none" || values.allergyStatus === "unconfirmed") &&
              currentAllergies.length > 0 && (
                <p className="type-small" role="status">
                  以前登録したアレルギーが残っています。献立生成の安全判定では引き続き使われます。「登録あり」に戻して編集するか、不要なら登録ありから削除してください。
                </p>
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
                      queryKey: householdKeys.allergies(userId, selected.id),
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
                  if (selectedMemberIdRef.current !== selected.id) return;
                  setMessage(
                    error instanceof Error ? error.message : "アレルギー情報を更新できませんでした",
                  );
                }}
                disabled={!allergiesQuery.isSuccess || selectedAllergyMutationPending || saving}
              />
            )}
            <label className="field">
              <span>食べない食事はありますか</span>
              <select
                ref={unsupportedDietStatusRef}
                value={values.unsupportedDietStatus}
                aria-invalid={
                  errors.unsupportedDietStatus !== undefined ||
                  errors.unsupportedDietKinds !== undefined
                    ? true
                    : undefined
                }
                aria-describedby={
                  errors.unsupportedDietStatus !== undefined ||
                  errors.unsupportedDietKinds !== undefined
                    ? HOUSEHOLD_FORM_ERROR_ID
                    : undefined
                }
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
              <fieldset ref={unsupportedDietKindsRef} className="control-group">
                <legend>食べない食事</legend>
                {unsupportedDietKinds.map((kind) => (
                  <label key={kind} className="control-label">
                    <input
                      type="checkbox"
                      checked={values.unsupportedDietKinds.includes(kind)}
                      onChange={(event) => {
                        setArray("unsupportedDietKinds", kind, event.target.checked);
                      }}
                    />
                    {unsupportedDietKindLabels[kind]}
                  </label>
                ))}
              </fieldset>
            )}
            <fieldset className="control-group">
              <legend>安全のための制約</legend>
              <label className="control-label">
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
              <label className="control-label">
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
                disabled={saving || selectedDislikeMutationPending}
                onClick={() => {
                  if (savingRef.current) return;
                  if (dislike.trim() === "") return;
                  const memberId = selected.id;
                  const name = dislike;
                  void runDislikeMutation(
                    memberId,
                    async () => {
                      await api.addDislike(memberId, name);
                      await queryClient.invalidateQueries({
                        queryKey: householdKeys.dislikes(userId, memberId),
                      });
                      await api.invalidateSafety();
                    },
                    "苦手食材を追加できませんでした",
                    () => {
                      setDislike("");
                    },
                  );
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
                      disabled={saving || selectedDislikeMutationPending}
                      onClick={() => {
                        if (savingRef.current) return;
                        const memberId = selected.id;
                        void runDislikeMutation(
                          memberId,
                          async () => {
                            await api.removeDislike(item.id);
                            await queryClient.invalidateQueries({
                              queryKey: householdKeys.dislikes(userId, memberId),
                            });
                            await api.invalidateSafety();
                          },
                          "苦手食材を削除できませんでした",
                        );
                      }}
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
            <fieldset className="control-group">
              <legend>食べやすさ</legend>
              {easePreferences.map((preference) => (
                <label key={preference} className="control-label">
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
          </fieldset>
          {/*
            フォーム末尾に操作を横並び: 設定を完了 / 追加をやめる or 家族を削除。
            「家族を追加」は編集領域が開いているあいだは出さない（一覧側だけ）。
          */}
          <div className="household-editor-actions">
            <button
              className="primary-button min-h-11"
              type="button"
              disabled={saving || completionBlockedByMutation}
              onClick={() => void complete()}
            >
              この家族の設定を完了
            </button>
            {selected.status === "draft" ? (
              <button
                className="secondary-button min-h-11"
                type="button"
                disabled={saving || cancellingDraft || deletingMemberIds.has(selected.id)}
                onClick={() => {
                  void cancelDraftAdd();
                }}
              >
                追加をやめる
              </button>
            ) : (
              <button
                ref={deleteTrigger}
                className="secondary-button min-h-11"
                type="button"
                disabled={
                  saving ||
                  selectedAllergyMutationPending ||
                  deletingMemberIds.has(selected.id) ||
                  cancellingDraft
                }
                onClick={() => {
                  if (
                    savingRef.current ||
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
            )}
          </div>
        </section>
      )}
      {/* 削除確認は編集の開閉に依存させない（一覧からいつでも出せる） */}
      {deleteTarget !== undefined && (
        <div className="pantry-expired-dialog-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="家族の削除確認"
            className="card stack pantry-expired-dialog-panel"
          >
            <p>
              {deleteTarget.status === "draft"
                ? "入力途中の家族をリストから外します。よろしいですか？"
                : "この家族の設定だけを削除します。"}
            </p>
            <button
              ref={deleteConfirm}
              className="primary-button min-h-11"
              type="button"
              disabled={
                saving ||
                allergyMutationPendingMemberIds.has(deleteTarget.id) ||
                deletingMemberIds.has(deleteTarget.id) ||
                cancellingDraft
              }
              onClick={() => {
                void confirmDeleteTarget();
              }}
            >
              {deleteTarget.status === "draft" ? "リストから外す" : "家族だけを削除"}
            </button>
            <button
              className="text-button min-h-11"
              type="button"
              disabled={saving || deletingMemberIds.has(deleteTarget.id)}
              onClick={() => {
                if (savingRef.current || deletingMemberIdsRef.current.has(deleteTarget.id)) return;
                setDeleteTarget(undefined);
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
      {/* L10-5: プラン管理はアカウント操作の直前。Checkout 成功時は短周期 re-fetch。 */}
      <PlanSettingsSection
        userId={userId}
        pollAfterCheckoutSuccess={pollAfterCheckoutSuccess}
        onCheckoutPollSettled={clearBillingReturnQuery}
      />
      {/* Plan 6: アカウント操作は本ページ所有者の下に合成するだけ。家族 CRUD は置換しない。 */}
      <AccountSettingsSection />
      {/* フィードバックはログアウト等のアカウント操作の下へ。日常操作の邪魔にしない。 */}
      <FeedbackSection />
    </main>
  );
}
