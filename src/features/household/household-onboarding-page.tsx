import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { AgeBand, UnsupportedDietKind, UnsupportedDietStatus } from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  addCustomMemberAllergy,
  addStandardMemberAllergy,
  completeHouseholdMember,
  listHouseholdMembers,
  listMemberAllergies,
  setOnboardingStatus,
  startHouseholdOnboarding,
  updateHouseholdMemberDraft,
  deleteMemberAllergy,
  listAllergenCatalog,
  listAllergenAliases,
  type HouseholdDraftPatch,
  type HouseholdMemberRow,
} from "./household-api";
import { defaultsForAgeBand } from "./household-defaults";
import { householdKeys } from "./household-queries";
import { AllergyEditor } from "./allergy-editor";

const unsupportedDietOptions: ReadonlyArray<readonly [UnsupportedDietKind, string]> = [
  ["weaning_food", "離乳食"],
  ["swallowing_concern", "飲み込み・むせの不安"],
  ["therapeutic_diet", "医師等から指示された治療食"],
];

export interface HouseholdOnboardingApi {
  listMembers: () => Promise<HouseholdMemberRow[]>;
  createDraft: (sortOrder: number) => Promise<HouseholdMemberRow>;
  updateDraft: (memberId: string, patch: HouseholdDraftPatch) => Promise<HouseholdMemberRow>;
  completeMember: (memberId: string) => Promise<HouseholdMemberRow>;
  listAllergies: (memberId: string) => Promise<Awaited<ReturnType<typeof listMemberAllergies>>>;
  listCatalog?: () => Promise<Awaited<ReturnType<typeof listAllergenCatalog>>>;
  listAliases?: () => Promise<Awaited<ReturnType<typeof listAllergenAliases>>>;
  addStandardAllergy?: (memberId: string, allergenId: string) => Promise<unknown>;
  addCustomAllergy: (memberId: string, name: string, aliases: string[]) => Promise<unknown>;
  removeAllergy?: (allergyId: string) => Promise<unknown>;
  setProgress: (status: "in_progress" | "complete") => Promise<unknown>;
}

function createHouseholdApi(userId: string): HouseholdOnboardingApi {
  const client = getBrowserSupabaseClient();
  return {
    listMembers: () => listHouseholdMembers(client, userId),
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
        void navigate("/privacy?returnTo=/planner");
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
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const pendingSavePatch = useRef<HouseholdDraftPatch>({});
  const latestSaveVersion = useRef(0);
  const [customAllergy, setCustomAllergy] = useState("");
  const [customConfirmed, setCustomConfirmed] = useState(false);
  const membersQuery = useQuery({
    queryKey: householdKeys.members(userId),
    queryFn: api.listMembers,
  });
  const members = membersQuery.data ?? [];
  const draft = members.find((member) => member.status === "draft") ?? null;
  const completeMembers = members.filter((member) => member.status === "complete");
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

  const completedRequired = useMemo(() => {
    if (draft === null) return 0;
    return [
      draft.age_band !== null,
      draft.allergy_status !== null,
      draft.unsupported_diet_status !== null,
    ].filter(Boolean).length;
  }, [draft]);

  const canComplete =
    draft !== null &&
    completedRequired === 3 &&
    (draft.allergy_status !== "registered" || allergies.length > 0) &&
    (draft.unsupported_diet_status !== "present" || draft.unsupported_diet_kinds.length > 0);

  if (membersQuery.isPending) {
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  }
  if (membersQuery.isError) {
    return (
      <main className="page-frame">
        <p className="error-message" role="alert">
          家族設定を読み込めませんでした。通信を確認して再読み込みしてください。
        </p>
      </main>
    );
  }

  if (draft === null) {
    return (
      <main className="page-frame stack">
        <h1>家族の初回設定</h1>
        <p>年齢のめやす、アレルギー、食べない食事の3項目から始めます。</p>
        {completeMembers.length > 0 && <p>{completeMembers.length}人の設定が完了しています。</p>}
        <button
          className="primary-button"
          type="button"
          disabled={startMutation.isPending}
          onClick={() => {
            startMutation.mutate();
          }}
        >
          {completeMembers.length === 0 ? "家族設定を始める" : "家族を追加"}
        </button>
        {completeMembers.length > 0 && (
          <button className="secondary-button" type="button" onClick={onDone}>
            AI情報の説明へ
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">約60秒の必須設定</p>
        <h1>家族の初回設定</h1>
        <p>必須項目 {completedRequired} / 3</p>
        <p
          className={saveState === "failed" ? "error-message" : "status-message"}
          aria-live="polite"
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
            aria-label="年齢のめやす"
            value={draft.age_band ?? ""}
            onChange={(event) => {
              const ageBand = event.target.value as AgeBand;
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
            aria-label="アレルギーの確認"
            value={draft.allergy_status ?? ""}
            onChange={(event) => void save({ allergy_status: event.target.value })}
          >
            <option value="">選んでください</option>
            <option value="none">なし</option>
            <option value="registered">登録あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>

        {draft.allergy_status === "registered" && api.listCatalog !== undefined && (
          <AllergyEditor
            memberId={draft.id}
            catalog={catalogQuery.data ?? []}
            aliases={aliasesQuery.data ?? []}
            allergies={allergies}
            addStandard={async (memberId, allergenId) => {
              await api.addStandardAllergy?.(memberId, allergenId);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies(userId, memberId),
              });
            }}
            addCustom={async (memberId, name, aliases) => {
              await api.addCustomAllergy(memberId, name, aliases);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies(userId, memberId),
              });
            }}
            remove={async (allergyId) => {
              await api.removeAllergy?.(allergyId);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies(userId, draft.id),
              });
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
            <label>
              <input
                type="checkbox"
                checked={customConfirmed}
                onChange={(event) => {
                  setCustomConfirmed(event.target.checked);
                }}
              />
              標準項目の候補を確認し、この表記で登録します
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
            aria-label="食べない食事はありますか"
            value={draft.unsupported_diet_status ?? ""}
            onChange={(event) => {
              const value = event.target.value as UnsupportedDietStatus;
              void save({
                unsupported_diet_status: value,
                unsupported_diet_kinds: value === "present" ? draft.unsupported_diet_kinds : [],
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
          <fieldset>
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

      <button
        className="primary-button"
        type="button"
        disabled={!canComplete}
        onClick={() => {
          void saveQueue.current.then(async (saved) => {
            if (!saved) return;
            try {
              replaceMember(await api.completeMember(draft.id));
            } catch {
              setSaveState("failed");
            }
          });
        }}
      >
        残りはあとで設定して完了
      </button>
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
    </main>
  );
}
