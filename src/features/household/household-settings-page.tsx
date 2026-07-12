import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  ageBands,
  allergyStatuses,
  easePreferences,
  portionSizes,
  requiredSafetyConstraints,
  spiceLevels,
  unsupportedDietKinds,
  unsupportedDietStatuses,
  type AgeBand,
  type AllergyStatus,
  type EasePreference,
  type PortionSize,
  type RequiredSafetyConstraint,
  type SpiceLevel,
  type UnsupportedDietKind,
  type UnsupportedDietStatus,
} from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/auth-provider";
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
  listHouseholdMembers,
  listMemberAllergies,
  listMemberDislikes,
  updateCompleteHouseholdMember,
  updateHouseholdMemberDraft,
  type AllergenCatalogRow,
  type HouseholdMemberPatch,
  type HouseholdMemberRow,
  type MemberAllergyRow,
  type MemberDislikeRow,
} from "./household-api";
import { AllergyEditor } from "./allergy-editor";
import { defaultsForAgeBand } from "./household-defaults";
import { householdKeys, invalidateHouseholdSafetyDependents } from "./household-queries";

export const householdSettingsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(30).nullable(),
    ageBand: z.enum(ageBands),
    allergyStatus: z.enum(allergyStatuses),
    unsupportedDietStatus: z.enum(unsupportedDietStatuses),
    unsupportedDietKinds: z.array(z.enum(unsupportedDietKinds)).max(3),
    requiredSafetyConstraints: z.array(z.enum(requiredSafetyConstraints)).max(2),
    portionSize: z.enum(portionSizes),
    spiceLevel: z.enum(spiceLevels),
    easePreferences: z.array(z.enum(easePreferences)).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.unsupportedDietStatus === "present" && value.unsupportedDietKinds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["unsupportedDietKinds"],
        message: "該当する項目を選んでください",
      });
    }
    if (value.unsupportedDietStatus !== "present" && value.unsupportedDietKinds.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["unsupportedDietKinds"],
        message: "対象外状態と項目を確認してください",
      });
    }
  });

export type HouseholdSettingsValue = z.infer<typeof householdSettingsSchema>;
export type HouseholdFieldErrors = Partial<Record<keyof HouseholdSettingsValue, string>>;

export function toHouseholdFieldErrors(
  error: z.ZodError<HouseholdSettingsValue>,
): HouseholdFieldErrors {
  const result: HouseholdFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.at(0);
    if (typeof field !== "string" || !(field in householdSettingsSchema.shape)) continue;
    const key = field as keyof HouseholdSettingsValue;
    result[key] ??= issue.message;
  }
  return result;
}

export interface HouseholdSettingsApi {
  listMembers(): Promise<HouseholdMemberRow[]>;
  createDraft(sortOrder: number): Promise<HouseholdMemberRow>;
  updateDraft(memberId: string, patch: HouseholdMemberPatch): Promise<HouseholdMemberRow>;
  updateMember(memberId: string, patch: HouseholdMemberPatch): Promise<HouseholdMemberRow>;
  completeMember(memberId: string): Promise<HouseholdMemberRow>;
  deleteMember(memberId: string): Promise<void>;
  listCatalog(): Promise<AllergenCatalogRow[]>;
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
    requiredSafetyConstraints: member.required_safety_constraints.length
      ? (member.required_safety_constraints as RequiredSafetyConstraint[])
      : defaults.required_safety_constraints,
    portionSize: (member.portion_size ?? defaults.portion_size) as PortionSize,
    spiceLevel: (member.spice_level ?? defaults.spice_level) as SpiceLevel,
    easePreferences: member.ease_preferences.length
      ? (member.ease_preferences as EasePreference[])
      : defaults.ease_preferences,
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
  const membersKey = householdKeys.members(userId);
  const [selectedId, setSelectedId] = useState<string>();
  const [values, setValues] = useState<HouseholdSettingsValue>();
  const [errors, setErrors] = useState<HouseholdFieldErrors>({});
  const [message, setMessage] = useState("");
  const [dislike, setDislike] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveQueue = useRef(Promise.resolve(true));
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const deleteConfirm = useRef<HTMLButtonElement>(null);
  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => api.listMembers(),
  });
  const catalogQuery = useQuery({
    queryKey: ["settings-catalog"],
    queryFn: () => api.listCatalog(),
  });
  const members = membersQuery.data ?? [];
  const selected = members.find((member) => member.id === selectedId) ?? members[0];
  const allergiesQuery = useQuery({
    queryKey: selected
      ? householdKeys.allergies("settings", selected.id)
      : ["settings-allergies", "none"],
    queryFn: () => api.listAllergies(selected?.id ?? "none"),
    enabled: selected !== undefined,
  });
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
      setValues(memberValue(selected));
    }
  }, [selected]);

  useEffect(() => {
    if (!confirmDelete) return;
    const trigger = deleteTrigger.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmDelete(false);
    };
    deleteConfirm.current?.focus();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [confirmDelete]);

  const update = (patch: Partial<HouseholdSettingsValue>) => {
    setValues((current) => (current === undefined ? current : { ...current, ...patch }));
  };
  const save = async (next: HouseholdSettingsValue): Promise<boolean> => {
    if (selected === undefined) return false;
    const parsed = householdSettingsSchema.safeParse(next);
    if (!parsed.success) {
      setErrors(toHouseholdFieldErrors(parsed.error));
      return false;
    }
    setErrors({});
    try {
      const saved =
        selected.status === "draft"
          ? await api.updateDraft(selected.id, toMemberPatch(parsed.data))
          : await api.updateMember(selected.id, toMemberPatch(parsed.data));
      queryClient.setQueryData<HouseholdMemberRow[]>(membersKey, (current = []) =>
        current.map((member) => (member.id === saved.id ? saved : member)),
      );
      await api.invalidateSafety();
      setMessage("家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "家族設定を保存できませんでした");
      return false;
    }
  };
  const queueSave = (next: HouseholdSettingsValue) => {
    saveQueue.current = saveQueue.current.then(() => save(next)).catch(() => false);
    return saveQueue.current;
  };
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
      return;
    }
    if (parsed.data.allergyStatus === "registered" && (allergiesQuery.data?.length ?? 0) === 0) {
      setMessage("登録ありの場合は1つ以上選んでください");
      return;
    }
    setSaving(true);
    await saveQueue.current;
    const saved = await save(parsed.data);
    if (!saved) {
      setSaving(false);
      return;
    }
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
    const next = { ...(values as HouseholdSettingsValue), ...patch };
    update(patch);
    void queueSave(next);
  };

  if (membersQuery.isPending || catalogQuery.isPending)
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  if (membersQuery.isError || catalogQuery.isError)
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
          onClick={() => {
            createDraft.mutate();
          }}
        >
          家族を追加
        </button>
      </main>
    );
  }
  const currentAllergies = allergiesQuery.data ?? [];
  const currentDislikes = dislikesQuery.data ?? [];
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
              setSelectedId(event.target.value);
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
              update({ displayName: event.target.value || null });
            }}
          />
        </label>
        <label className="field">
          <span>年齢区分</span>
          <select
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
            value={values.allergyStatus}
            onChange={(event) => {
              updateAndSave({ allergyStatus: event.target.value as AllergyStatus });
            }}
          >
            <option value="">選んでください</option>
            <option value="none">なし</option>
            <option value="registered">登録あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>
        {values.allergyStatus === "registered" && (
          <AllergyEditor
            memberId={selected.id}
            catalog={catalogQuery.data}
            allergies={currentAllergies}
            addStandard={async (memberId, allergenId) => {
              await api.addStandardAllergy(memberId, allergenId);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies("settings", memberId),
              });
              await api.invalidateSafety();
            }}
            addCustom={async (memberId, name, aliases) => {
              await api.addCustomAllergy(memberId, name, aliases);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies("settings", memberId),
              });
              await api.invalidateSafety();
            }}
            remove={async (allergyId) => {
              await api.removeAllergy(allergyId);
              await queryClient.invalidateQueries({
                queryKey: householdKeys.allergies("settings", selected.id),
              });
              await api.invalidateSafety();
            }}
          />
        )}
        <label className="field">
          <span>対象外の食事の確認</span>
          <select
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
            <legend>対象外の食事</legend>
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
        onClick={() => {
          setConfirmDelete(true);
        }}
      >
        家族を削除
      </button>
      {confirmDelete && (
        <div role="dialog" aria-modal="true" aria-label="家族の削除確認" className="card stack">
          <p>この家族の設定だけを削除します。</p>
          <button
            ref={deleteConfirm}
            className="primary-button"
            type="button"
            onClick={() =>
              void api
                .deleteMember(selected.id)
                .then(() => {
                  setConfirmDelete(false);
                  return queryClient.invalidateQueries({ queryKey: membersKey });
                })
                .then(() => api.invalidateSafety())
            }
          >
            家族だけを削除
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setConfirmDelete(false);
            }}
          >
            キャンセル
          </button>
        </div>
      )}
    </main>
  );
}
