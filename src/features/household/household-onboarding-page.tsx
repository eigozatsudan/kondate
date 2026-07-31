import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { AgeBand, UnsupportedDietKind, UnsupportedDietStatus } from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { useAppToast } from "@/shared/ui/app-toast";
import { InlineNotice } from "@/shared/ui/wizard/inline-notice";
import {
  addCustomMemberAllergy,
  addStandardMemberAllergy,
  completeHouseholdMember,
  deleteMemberAllergy,
  getProfile,
  listAllergenAliases,
  listAllergenCatalog,
  listHouseholdMembers,
  listMemberAllergies,
  setOnboardingStatus,
  startHouseholdOnboarding,
  updateHouseholdMemberDraft,
  type HouseholdDraftPatch,
  type HouseholdMemberRow,
  type ProfileRow,
} from "./household-api";
import { defaultsForAgeBand } from "./household-defaults";
import { householdKeys, invalidateHouseholdSafetyDependents } from "./household-queries";
import { AllergyEditor } from "./allergy-editor";

const unsupportedDietOptions: ReadonlyArray<readonly [UnsupportedDietKind, string]> = [
  ["weaning_food", "離乳食"],
  ["swallowing_concern", "飲み込み・むせの不安"],
  ["therapeutic_diet", "医師等から指示された治療食"],
];

/** オンボーディング必須フィールドの field error（settings schema と同文言系） */
type OnboardingFieldErrors = {
  ageBand?: string;
  allergyStatus?: string;
  unsupportedDietStatus?: string;
  unsupportedDietKinds?: string;
};

const ONBOARDING_FORM_ERROR_ID = "household-onboarding-form-error";
const FALLBACK_VALIDATION_TOAST = "入力内容を確認してください";

const ONBOARDING_FIELD_ORDER = [
  "ageBand",
  "allergyStatus",
  "unsupportedDietStatus",
  "unsupportedDietKinds",
] as const satisfies ReadonlyArray<keyof OnboardingFieldErrors>;

/**
 * 完了押下時の必須検証。settings の householdSettingsSchema と同系メッセージを返す。
 * アレルギー登録あり0件・食べない食事 present で kinds 空も含む。
 */
/** U3-I3: select の placeholder `""` は未選択。null と同様に未充足とみなす。 */
function isOnboardingEnumFilled(value: string | null): boolean {
  return value !== null && value !== "";
}

function validateOnboardingDraft(
  draft: HouseholdMemberRow,
  allergyCount: number,
): OnboardingFieldErrors {
  const errors: OnboardingFieldErrors = {};
  if (!isOnboardingEnumFilled(draft.age_band)) {
    errors.ageBand = "年齢のめやすを選んでください";
  }
  if (!isOnboardingEnumFilled(draft.allergy_status)) {
    errors.allergyStatus = "アレルギーの確認を選んでください";
  } else if (draft.allergy_status === "registered" && allergyCount === 0) {
    // 既存 completeBlockedReason と同じ意味（設計: 既存メッセージ + 同義 toast）
    errors.allergyStatus =
      "アレルギー「登録あり」のときは、1つ以上のアレルゲンを追加してください。";
  }
  if (!isOnboardingEnumFilled(draft.unsupported_diet_status)) {
    errors.unsupportedDietStatus = "食べない食事があるか選んでください";
  } else if (
    draft.unsupported_diet_status === "present" &&
    draft.unsupported_diet_kinds.length === 0
  ) {
    errors.unsupportedDietKinds = "該当する項目を選んでください";
  }
  return errors;
}

function firstOnboardingFieldError(
  errors: OnboardingFieldErrors,
): { key: keyof OnboardingFieldErrors; message: string } | undefined {
  for (const key of ONBOARDING_FIELD_ORDER) {
    const message = errors[key];
    if (message !== undefined) {
      return { key, message };
    }
  }
  return undefined;
}

export interface HouseholdOnboardingApi {
  listMembers: () => Promise<HouseholdMemberRow[]>;
  getProfile: () => Promise<ProfileRow>;
  createDraft: (sortOrder: number) => Promise<HouseholdMemberRow>;
  updateDraft: (memberId: string, patch: HouseholdDraftPatch) => Promise<HouseholdMemberRow>;
  completeMember: (memberId: string) => Promise<HouseholdMemberRow>;
  listAllergies: (memberId: string) => Promise<Awaited<ReturnType<typeof listMemberAllergies>>>;
  listCatalog?: () => Promise<Awaited<ReturnType<typeof listAllergenCatalog>>>;
  listAliases?: () => Promise<Awaited<ReturnType<typeof listAllergenAliases>>>;
  addStandardAllergy?: (memberId: string, allergenId: string) => Promise<unknown>;
  addCustomAllergy: (memberId: string, name: string, aliases: string[]) => Promise<unknown>;
  removeAllergy?: (allergyId: string) => Promise<unknown>;
  setProgress: (status: "in_progress" | "complete" | "skipped") => Promise<unknown>;
}

function createHouseholdApi(userId: string): HouseholdOnboardingApi {
  const client = getBrowserSupabaseClient();
  return {
    listMembers: () => listHouseholdMembers(client, userId),
    getProfile: () => getProfile(client, userId),
    createDraft: (sortOrder) => startHouseholdOnboarding(client, sortOrder),
    updateDraft: (memberId, patch) => updateHouseholdMemberDraft(client, userId, memberId, patch),
    completeMember: (memberId) => completeHouseholdMember(client, userId, memberId),
    listAllergies: (memberId) => listMemberAllergies(client, userId, memberId),
    listCatalog: () => listAllergenCatalog(client),
    listAliases: () => listAllergenAliases(client),
    addStandardAllergy: (memberId, allergenId) =>
      addStandardMemberAllergy(client, userId, memberId, allergenId),
    addCustomAllergy: (memberId, name, aliases) =>
      addCustomMemberAllergy(client, userId, memberId, name, aliases),
    removeAllergy: (allergyId) => deleteMemberAllergy(client, userId, allergyId),
    setProgress: (status) => setOnboardingStatus(client, userId, status),
  };
}

export function HouseholdOnboardingPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.session === null) return null;
  const api = createHouseholdApi(auth.session.user.id);
  return (
    <HouseholdOnboardingForm
      userId={auth.session.user.id}
      api={api}
      onDone={() => {
        void navigate("/planner");
      }}
    />
  );
}

export function HouseholdOnboardingForm({
  userId,
  api,
  onDone,
}: {
  userId: string;
  api: HouseholdOnboardingApi;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { show: showToast, dismiss: dismissToast } = useAppToast();
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const pendingSavePatch = useRef<HouseholdDraftPatch>({});
  const latestSaveVersion = useRef(0);
  const [customAllergy, setCustomAllergy] = useState("");
  const [customConfirmed, setCustomConfirmed] = useState(false);
  const [completeError, setCompleteError] = useState(false);
  const [skipError, setSkipError] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  // completeMember / finish / skip 中の連打防止
  const [actionPending, setActionPending] = useState(false);
  // HP-I1: AllergyEditor 失敗を利用者に見せる（設定画面と同型）
  const [allergyError, setAllergyError] = useState<string | null>(null);
  // 完了押下後の fieldErrors（valid になったら clear）
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldErrors>({});
  const ageBandRef = useRef<HTMLSelectElement>(null);
  const allergyStatusRef = useRef<HTMLSelectElement>(null);
  const unsupportedDietStatusRef = useRef<HTMLSelectElement>(null);
  const unsupportedDietKindsRef = useRef<HTMLFieldSetElement>(null);
  const nextActionHeadingRef = useRef<HTMLHeadingElement>(null);

  // ルート離脱で validation toast を残さない
  useEffect(() => {
    return () => {
      dismissToast();
    };
  }, [dismissToast]);

  const membersQuery = useQuery({
    queryKey: householdKeys.members(userId),
    queryFn: api.listMembers,
  });
  const profileQuery = useQuery({
    queryKey: householdKeys.profile(userId),
    queryFn: api.getProfile,
  });
  const members = membersQuery.data ?? [];
  const draft = members.find((member) => member.status === "draft") ?? null;
  const completeMembers = members.filter((member) => member.status === "complete");
  const onboardingStatus = profileQuery.data?.onboarding_status;
  // complete / skipped / 未取得では skip CTA を出さない（RPC 遷移表）
  const canShowSkip = onboardingStatus === "not_started" || onboardingStatus === "in_progress";
  const allergiesQuery = useQuery({
    queryKey: householdKeys.allergies(userId, draft?.id ?? "none"),
    queryFn: () => (draft === null ? Promise.resolve([]) : api.listAllergies(draft.id)),
    enabled: draft !== null,
  });
  const catalogQuery = useQuery({
    queryKey: ["household", "allergen-catalog"],
    queryFn: () => api.listCatalog?.() ?? Promise.resolve([]),
    enabled: draft !== null && api.listCatalog !== undefined,
  });
  const aliasesQuery = useQuery({
    queryKey: ["household", "allergen-aliases"],
    queryFn: () => api.listAliases?.() ?? Promise.resolve([]),
    enabled: draft !== null && api.listAliases !== undefined,
  });
  const allergies = allergiesQuery.data ?? [];

  const replaceMember = (member: HouseholdMemberRow) => {
    queryClient.setQueryData<HouseholdMemberRow[]>(householdKeys.members(userId), (current = []) =>
      current.map((item) => (item.id === member.id ? member : item)),
    );
  };

  const startMutation = useMutation({
    mutationFn: () => api.createDraft(members.length),
    onSuccess: (created) => {
      queryClient.setQueryData<HouseholdMemberRow[]>(
        householdKeys.members(userId),
        (current = []) =>
          current.some((member) => member.id === created.id) ? current : [...current, created],
      );
    },
  });
  // HO-I1: 開始失敗を無言にせず、skip/complete と同型の role=alert を出す

  const save = (patch: HouseholdDraftPatch) => {
    if (draft === null) return Promise.resolve();
    const memberId = draft.id;
    const saveVersion = latestSaveVersion.current + 1;
    latestSaveVersion.current = saveVersion;
    pendingSavePatch.current = { ...pendingSavePatch.current, ...patch };
    setSaveState("saving");
    // 応答待ちでも連続入力を保持し、後続の保存内容を古い応答で戻さない。
    queryClient.setQueryData<HouseholdMemberRow[]>(householdKeys.members(userId), (current = []) =>
      current.map((item) => (item.id === memberId ? { ...item, ...patch } : item)),
    );

    const queuedSave = saveQueue.current.then(async () => {
      setSaveState("saving");
      const patchToSave = { ...pendingSavePatch.current };
      try {
        const saved = await api.updateDraft(memberId, patchToSave);
        if (saveVersion === latestSaveVersion.current) {
          pendingSavePatch.current = {};
          replaceMember(saved);
          setSaveState("saved");
        }
        return true;
      } catch {
        if (saveVersion === latestSaveVersion.current) {
          setSaveState("failed");
        }
        return false;
      }
    });
    // 保存失敗はキュー内で処理し、後続操作を止めない。
    saveQueue.current = queuedSave;
    return queuedSave;
  };

  /** 献立へ進む。profile が既に complete なら setProgress を省略する。 */
  const finishOnboarding = async (): Promise<void> => {
    setActionPending(true);
    setCompleteError(false);
    try {
      if (onboardingStatus !== "complete") {
        await api.setProgress("complete");
        await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
      }
      dismissToast();
      onDone();
    } catch {
      setCompleteError(true);
    } finally {
      setActionPending(false);
    }
  };

  /** C-C1: 画面内から skipped へ抜け、アイデア導線へ進める */
  const skipOnboarding = async (): Promise<void> => {
    setSkipPending(true);
    setSkipError(false);
    setActionPending(true);
    try {
      await api.setProgress("skipped");
      await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
      onDone();
    } catch {
      setSkipError(true);
    } finally {
      setSkipPending(false);
      setActionPending(false);
    }
  };

  const completedRequired = useMemo(() => {
    if (draft === null) return 0;
    return [
      isOnboardingEnumFilled(draft.age_band),
      isOnboardingEnumFilled(draft.allergy_status),
      isOnboardingEnumFilled(draft.unsupported_diet_status),
    ].filter(Boolean).length;
  }, [draft]);

  // フィールドが valid になったら form alert / fieldErrors を必ず clear（設計 §6.3 lifecycle）
  // 既に error を出しているときだけ再評価し、直った項目は落として残件だけ残す。
  useEffect(() => {
    if (draft === null) return;
    setFieldErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = validateOnboardingDraft(draft, allergies.length);
      if (Object.keys(next).length === 0) return {};
      const same =
        ONBOARDING_FIELD_ORDER.every((key) => prev[key] === next[key]) &&
        Object.keys(prev).length === Object.keys(next).length;
      return same ? prev : next;
    });
  }, [draft, allergies.length]);

  const leadFieldError = firstOnboardingFieldError(fieldErrors);

  const focusFirstInvalid = (errors: OnboardingFieldErrors): void => {
    const lead = firstOnboardingFieldError(errors);
    if (lead === undefined) return;
    if (lead.key === "ageBand") {
      ageBandRef.current?.focus();
      return;
    }
    if (lead.key === "allergyStatus") {
      allergyStatusRef.current?.focus();
      return;
    }
    if (lead.key === "unsupportedDietStatus") {
      unsupportedDietStatusRef.current?.focus();
      return;
    }
    // kinds: fieldset 内の先頭 checkbox
    const firstCheckbox =
      unsupportedDietKindsRef.current?.querySelector<HTMLInputElement>("input:not([disabled])");
    firstCheckbox?.focus();
  };

  /** incomplete 完了押下: fieldErrors + toast + focus。成功時は次アクションへ（setProgress しない） */
  const handleCompleteClick = (): void => {
    if (draft === null) return;
    void saveQueue.current.then(async (saved) => {
      // 再試行時は前回 complete エラーを消す
      setCompleteError(false);
      // 下書き保存失敗時は無言 return せず、失敗表示を明示して再試行可能にする。
      // ネットワーク失敗は既存 status 行のみ（toast なし）
      if (!saved) {
        setSaveState("failed");
        return;
      }
      const nextErrors = validateOnboardingDraft(draft, allergies.length);
      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors);
        const lead = firstOnboardingFieldError(nextErrors);
        showToast({
          message: lead?.message ?? FALLBACK_VALIDATION_TOAST,
          tone: "error",
        });
        focusFirstInvalid(nextErrors);
        return;
      }
      setFieldErrors({});
      dismissToast();
      setActionPending(true);
      let completed: HouseholdMemberRow;
      try {
        completed = await api.completeMember(draft.id);
      } catch {
        // U3-I1: complete 失敗でも CTA を disabled にしない（再押下で再試行できる）。
        // autosave の failed 文言と混同しないよう completeError を立てる。
        setCompleteError(true);
        setActionPending(false);
        return;
      }
      replaceMember(completed);
      // complete 成功後は家族安全依存 query を必ず無効化し、
      // localStorage 失敗時でも revision/event 経由で緊急献立などを更新する。
      // ここでは setProgress / navigate しない（次アクション画面へ）。
      try {
        await invalidateHouseholdSafetyDependents(queryClient, userId);
      } finally {
        setActionPending(false);
      }
    });
  };

  // 次アクション表示時に見出しへフォーカスし、画面切替を伝える
  useEffect(() => {
    if (draft !== null || completeMembers.length === 0) return;
    nextActionHeadingRef.current?.focus();
  }, [draft, completeMembers.length]);

  if (membersQuery.isPending) {
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  }
  if (membersQuery.isError) {
    return (
      <main className="page-frame stack">
        <p className="error-message" role="alert">
          家族設定を読み込めませんでした。通信を確認して再試行してください。
        </p>
        {/* HO-M1: 全リロード以外の復旧導線 */}
        <button
          className="secondary-button min-h-11"
          type="button"
          onClick={() => {
            void membersQuery.refetch();
          }}
        >
          再試行
        </button>
      </main>
    );
  }

  if (draft === null && completeMembers.length === 0) {
    return (
      <main className="page-frame stack">
        <h1>家族の初回設定</h1>
        <p>年齢のめやす、アレルギー、食べない食事の3項目から始めます。</p>
        <p className="type-small">
          AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。
        </p>
        {startMutation.isError ? (
          <p className="error-message" role="alert">
            家族設定を開始できませんでした。通信を確認して再試行してください。
          </p>
        ) : null}
        <button
          className="primary-button min-h-11"
          type="button"
          disabled={startMutation.isPending || actionPending}
          onClick={() => {
            startMutation.mutate();
          }}
        >
          家族設定を始める
        </button>
        {canShowSkip ? (
          <button
            className="text-button min-h-11"
            type="button"
            disabled={skipPending || actionPending}
            onClick={() => {
              void skipOnboarding();
            }}
          >
            あとで設定する（アイデアから始める）
          </button>
        ) : null}
        {skipError && (
          <p className="error-message" role="alert">
            スキップできませんでした。通信を確認して再試行してください。
          </p>
        )}
      </main>
    );
  }

  if (draft === null && completeMembers.length > 0) {
    const n = completeMembers.length;
    return (
      <main className="page-frame stack">
        <h1 ref={nextActionHeadingRef} tabIndex={-1}>
          {n === 1 ? "1人目の登録が完了しました" : "登録が完了しました"}
        </h1>
        <p>{n}人の設定が完了しています。</p>
        <p>ほかの家族も続けて登録できます。あとから設定の「家族設定」でも追加できます。</p>
        {startMutation.isError ? (
          <p className="error-message" role="alert">
            家族設定を開始できませんでした。通信を確認して再試行してください。
          </p>
        ) : null}
        <button
          className="primary-button min-h-11"
          type="button"
          disabled={actionPending || profileQuery.isPending}
          onClick={() => {
            void finishOnboarding();
          }}
        >
          献立を始める
        </button>
        <button
          className="secondary-button min-h-11"
          type="button"
          disabled={actionPending || startMutation.isPending || profileQuery.isPending}
          onClick={() => {
            startMutation.mutate();
          }}
        >
          続けて家族を追加
        </button>
        {canShowSkip ? (
          <button
            className="text-button min-h-11"
            type="button"
            disabled={actionPending || skipPending}
            onClick={() => {
              void skipOnboarding();
            }}
          >
            あとで設定する（アイデアから始める）
          </button>
        ) : null}
        {completeError && (
          <p className="error-message" role="alert">
            設定を完了できませんでした。通信を確認して再試行してください。
          </p>
        )}
        {skipError && (
          <p className="error-message" role="alert">
            スキップできませんでした。通信を確認して再試行してください。
          </p>
        )}
      </main>
    );
  }

  // ここから draft 編集フォーム（draft は上の分岐で null でない）
  if (draft === null) {
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  }

  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">家族設定（任意）</p>
        <h1>家族の初回設定</h1>
        <InlineNotice
          tone="notice"
          title={
            completeMembers.length === 0
              ? "まずは1人分から登録しましょう"
              : "続けて家族を登録できます"
          }
        >
          {completeMembers.length === 0
            ? "家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。"
            : "何人でも登録できます。登録が終わったら「献立を始める」で先に進めます。あとから設定の「家族設定」でも追加・編集できます。"}
        </InlineNotice>
        <p>設定済み項目 {completedRequired} / 3</p>
        <p className="type-small">
          AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。
        </p>
        <p
          className={saveState === "failed" ? "error-message" : "status-message"}
          role={saveState === "failed" ? "alert" : "status"}
          aria-live={saveState === "failed" ? "assertive" : "polite"}
        >
          {saveState === "saving" && "保存中…"}
          {saveState === "saved" && "保存済み"}
          {saveState === "failed" && "保存できませんでした。選び直して再試行してください。"}
        </p>
      </div>

      <section className="card stack">
        <label className="field">
          <span>呼び名（任意・AIには送りません）</span>
          <input
            value={draft.display_name ?? ""}
            maxLength={30}
            onChange={(event) => void save({ display_name: event.target.value || null })}
          />
        </label>
        <label className="field">
          <span>年齢のめやす</span>
          <select
            ref={ageBandRef}
            aria-label="年齢のめやす"
            value={draft.age_band ?? ""}
            aria-invalid={fieldErrors.ageBand !== undefined ? true : undefined}
            aria-describedby={
              fieldErrors.ageBand !== undefined ? ONBOARDING_FORM_ERROR_ID : undefined
            }
            onChange={(event) => {
              // U3-I3: プレースホルダは null へ戻す（空文字を filled 扱いしない）
              const value = event.target.value;
              if (value === "") {
                void save({ age_band: null });
                return;
              }
              const ageBand = value as AgeBand;
              void save({ age_band: ageBand, ...defaultsForAgeBand(ageBand) });
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
            aria-label="アレルギーの確認"
            value={draft.allergy_status ?? ""}
            aria-invalid={fieldErrors.allergyStatus !== undefined ? true : undefined}
            aria-describedby={
              fieldErrors.allergyStatus !== undefined ? ONBOARDING_FORM_ERROR_ID : undefined
            }
            onChange={(event) => {
              const value = event.target.value;
              void save({ allergy_status: value === "" ? null : value });
            }}
          >
            <option value="">選んでください</option>
            <option value="none">なし</option>
            <option value="registered">登録あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>

        {draft.allergy_status === "registered" && allergiesQuery.isError && (
          <div className="stack" role="alert">
            <p className="error-message">アレルギー一覧を読み込めませんでした。</p>
            <button
              className="secondary-button min-h-11"
              type="button"
              onClick={() => {
                void allergiesQuery.refetch();
              }}
            >
              再試行
            </button>
          </div>
        )}
        {draft.allergy_status === "registered" && allergyError !== null && (
          <p className="error-message" role="alert">
            {allergyError}
          </p>
        )}
        {draft.allergy_status === "registered" && api.listCatalog !== undefined && (
          <AllergyEditor
            memberId={draft.id}
            catalog={catalogQuery.data ?? []}
            aliases={aliasesQuery.data ?? []}
            allergies={allergies}
            addStandard={async (memberId, allergenId) => {
              setAllergyError(null);
              await api.addStandardAllergy?.(memberId, allergenId);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies(userId, memberId),
              });
            }}
            addCustom={async (memberId, name, aliases) => {
              setAllergyError(null);
              await api.addCustomAllergy(memberId, name, aliases);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies(userId, memberId),
              });
            }}
            remove={async (allergyId) => {
              setAllergyError(null);
              await api.removeAllergy?.(allergyId);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies(userId, draft.id),
              });
            }}
            onError={(error) => {
              setAllergyError(
                error instanceof Error ? error.message : "アレルギー情報を更新できませんでした",
              );
            }}
          />
        )}
        {draft.allergy_status === "registered" && api.listCatalog === undefined && (
          <fieldset className="stack">
            <legend>登録するアレルギー</legend>
            <label className="field">
              <span>自由登録名</span>
              <input
                value={customAllergy}
                maxLength={80}
                onChange={(event) => {
                  setCustomAllergy(event.target.value);
                }}
              />
            </label>
            <label className="control-label">
              <input
                type="checkbox"
                checked={customConfirmed}
                onChange={(event) => {
                  setCustomConfirmed(event.target.checked);
                }}
              />
              一覧の候補を確認し、この表記で登録します
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={!customConfirmed || customAllergy.trim() === ""}
              onClick={() =>
                void api
                  .addCustomAllergy(draft.id, customAllergy, [])
                  .then(() =>
                    queryClient.invalidateQueries({
                      queryKey: householdKeys.allergies(userId, draft.id),
                    }),
                  )
                  .then(() => {
                    setCustomAllergy("");
                    setCustomConfirmed(false);
                  })
              }
            >
              アレルギーを追加
            </button>
            <p>{allergies.length}件登録済み</p>
          </fieldset>
        )}

        <label className="field">
          <span>食べない食事はありますか</span>
          <select
            ref={unsupportedDietStatusRef}
            aria-label="食べない食事はありますか"
            value={draft.unsupported_diet_status ?? ""}
            aria-invalid={
              fieldErrors.unsupportedDietStatus !== undefined ||
              fieldErrors.unsupportedDietKinds !== undefined
                ? true
                : undefined
            }
            aria-describedby={
              fieldErrors.unsupportedDietStatus !== undefined ||
              fieldErrors.unsupportedDietKinds !== undefined
                ? ONBOARDING_FORM_ERROR_ID
                : undefined
            }
            onChange={(event) => {
              const value = event.target.value;
              if (value === "") {
                void save({ unsupported_diet_status: null, unsupported_diet_kinds: [] });
                return;
              }
              const status = value as UnsupportedDietStatus;
              void save({
                unsupported_diet_status: status,
                unsupported_diet_kinds: status === "present" ? draft.unsupported_diet_kinds : [],
              });
            }}
          >
            <option value="">選んでください</option>
            <option value="none">該当なし</option>
            <option value="present">該当あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>

        {draft.unsupported_diet_status === "present" && (
          <fieldset ref={unsupportedDietKindsRef}>
            <legend>該当する項目</legend>
            {unsupportedDietOptions.map(([value, label]) => (
              <label key={value} className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={draft.unsupported_diet_kinds.includes(value)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...draft.unsupported_diet_kinds, value]
                        : draft.unsupported_diet_kinds.filter((item) => item !== value);
                      void save({ unsupported_diet_kinds: next });
                    }}
                  />
                  {label}
                </span>
              </label>
            ))}
            <p>
              通常の献立では対応できません。対象メンバーから外すか、専門職の指示に従ってください。
            </p>
          </fieldset>
        )}
      </section>

      {/* フォームレベル role=alert は先頭エラー1つ（設計 §6.3） */}
      {leadFieldError !== undefined && (
        <p id={ONBOARDING_FORM_ERROR_ID} className="error-message" role="alert">
          {leadFieldError.message}
        </p>
      )}
      <button
        className="primary-button min-h-11"
        type="button"
        // U3-I1: incomplete でも押下可。autosave failed でも complete は再試行可能にする
        disabled={actionPending}
        onClick={handleCompleteClick}
      >
        この家族の設定を完了する
      </button>
      {canShowSkip ? (
        <button
          className="text-button min-h-11"
          type="button"
          disabled={skipPending || actionPending}
          onClick={() => {
            void skipOnboarding();
          }}
        >
          あとで設定する（アイデアから始める）
        </button>
      ) : null}
      {draft.allergy_status === "unconfirmed" && (
        <p className="error-message">
          アレルギーを確認するまで、このメンバーは献立生成に使えません。
        </p>
      )}
      {draft.unsupported_diet_status === "unconfirmed" && (
        <p className="error-message">
          食べない食事を確認するまで、このメンバーは献立生成に使えません。
        </p>
      )}
      {completeError && (
        <p className="error-message" role="alert">
          設定を完了できませんでした。通信を確認して再試行してください。
        </p>
      )}
      {skipError && (
        <p className="error-message" role="alert">
          スキップできませんでした。通信を確認して再試行してください。
        </p>
      )}
    </main>
  );
}
