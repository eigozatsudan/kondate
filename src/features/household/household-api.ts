import type { OnboardingStatus } from "@shared/contracts/domain";
import { normalizeFoodText } from "@shared/safety-pure/normalize-food-text";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Database } from "@/shared/types/database";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/types/database.generated";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type HouseholdMemberRow = Tables<"household_members">;
export type MemberAllergyRow = Tables<"member_allergies">;
export type MemberDislikeRow = Tables<"member_dislikes">;
export type AllergenCatalogRow = Tables<"allergen_catalog">;
export type AllergenAliasRow = Tables<"allergen_aliases">;

export type HouseholdMemberPatch = Pick<
  TablesUpdate<"household_members">,
  | "display_name"
  | "age_band"
  | "portion_size"
  | "spice_level"
  | "ease_preferences"
  | "required_safety_constraints"
  | "allergy_status"
  | "unsupported_diet_status"
  | "unsupported_diet_kinds"
>;

export type HouseholdDraftPatch = HouseholdMemberPatch;

function dataError(message: string): Error {
  return new Error(message);
}

export async function getProfile(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<ProfileRow> {
  const { data, error } = await client.from("profiles").select("*").eq("user_id", userId).single();
  if (error !== null) throw dataError("初回設定の状態を読み込めませんでした");
  return data;
}

export async function listHouseholdMembers(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<HouseholdMemberRow[]> {
  const { data, error } = await client
    .from("household_members")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error !== null) throw dataError("家族情報を読み込めませんでした");
  return data;
}

/**
 * 家族 draft 作成。直 INSERT は複数 draft 並立を許すため、
 * 既存 draft 再利用の原子 RPC（start_household_onboarding）に寄せる（H11）。
 * UI 経路も同 RPC。authenticated の raw INSERT 権限自体は DB 側に残るが、
 * アプリクライアントは本関数経由で単一化する。
 */
export async function createHouseholdMemberDraft(
  client: BrowserSupabaseClient,
  userId: string,
  sortOrder: number,
): Promise<HouseholdMemberRow> {
  void userId;
  return startHouseholdOnboarding(client, sortOrder);
}

export async function startHouseholdOnboarding(
  client: BrowserSupabaseClient,
  sortOrder: number,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client.rpc("start_household_onboarding", {
    p_sort_order: sortOrder,
  });
  if (error !== null) throw dataError("家族の初回設定を開始できませんでした");
  return data;
}

/**
 * H2: draft 行も complete と同型の updated_at CAS。
 * dual-tab の古い form が allergy_status 等を LWW 上書きするのを防ぐ。
 * 0 行は競合（他タブ更新 or 非 draft）として ConflictError。
 */
export async function updateHouseholdMemberDraft(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  patch: HouseholdDraftPatch,
  expectedUpdatedAt: string,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client
    .from("household_members")
    .update(patch)
    .eq("id", memberId)
    .eq("user_id", userId)
    .eq("status", "draft")
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error !== null) throw dataError("家族情報を保存できませんでした");
  if (data === null) throw new HouseholdMemberVersionConflictError();
  return data;
}

/**
 * H5: complete 行の更新は updated_at 楽観ロック（pantry と同型 CAS）。
 * dual-tab の古い form が allergy_status 等を LWW 上書きするのを防ぐ。
 * 0 行は競合（他タブ更新 or 非 complete）として ConflictError。
 */
// draft / complete 双方の CAS miss で共有（H2 / H5）
export class HouseholdMemberVersionConflictError extends Error {
  readonly code = "household_member_version_conflict" as const;

  constructor() {
    super("家族設定が他の画面で更新されています。最新の内容を確認してください");
    this.name = "HouseholdMemberVersionConflictError";
  }
}

export async function updateCompleteHouseholdMember(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  patch: HouseholdMemberPatch,
  expectedUpdatedAt: string,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client
    .from("household_members")
    .update(patch)
    .eq("id", memberId)
    .eq("user_id", userId)
    .eq("status", "complete")
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error !== null) throw dataError("家族設定を保存できませんでした");
  if (data === null) throw new HouseholdMemberVersionConflictError();
  return data;
}

export async function completeHouseholdMember(
  client: BrowserSupabaseClient,
  _userId: string,
  memberId: string,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client.rpc("complete_household_member", {
    p_member_id: memberId,
  });
  if (error !== null) {
    if (error.message.includes("member_required_fields_incomplete")) {
      throw dataError("年齢、アレルギー、対象外の確認を完了してください");
    }
    throw dataError("家族設定を完了できませんでした");
  }
  return data;
}

export type SetOnboardingStatusOptions = {
  /**
   * CAS: 現在の onboarding_status がこの値のときだけ遷移する。
   * 不一致時は RPC が上書きせず現状を返す（welcome dual-tab first-writer-wins）。
   */
  expectedStatus?: OnboardingStatus;
};

export async function setOnboardingStatus(
  client: BrowserSupabaseClient,
  userId: string,
  status: OnboardingStatus,
  options?: SetOnboardingStatusOptions,
): Promise<ProfileRow> {
  void userId;
  const { data, error } = await client.rpc("set_onboarding_status", {
    p_status: status,
    // undefined は送らず省略互換。expected 指定時のみ CAS 条件を付ける
    ...(options?.expectedStatus !== undefined ? { p_expected_status: options.expectedStatus } : {}),
  });
  if (error !== null) throw dataError("初回設定の進捗を保存できませんでした");
  return data;
}

export async function listAllergenCatalog(
  client: BrowserSupabaseClient,
): Promise<AllergenCatalogRow[]> {
  const { data, error } = await client.from("allergen_catalog").select("*").order("display_name");
  if (error !== null) throw dataError("アレルゲン一覧を読み込めませんでした");
  return data;
}

export async function listAllergenAliases(
  client: BrowserSupabaseClient,
): Promise<AllergenAliasRow[]> {
  const { data, error } = await client
    .from("allergen_aliases")
    .select("*")
    .in("alias_kind", ["direct", "derived"])
    .order("alias");
  if (error !== null) throw dataError("アレルゲン候補を読み込めませんでした");
  return data;
}

export async function listMemberAllergies(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
): Promise<MemberAllergyRow[]> {
  const { data, error } = await client
    .from("member_allergies")
    .select("*")
    .eq("user_id", userId)
    .eq("member_id", memberId)
    .order("created_at");
  if (error !== null) throw dataError("アレルギー情報を読み込めませんでした");
  return data;
}

export async function addStandardMemberAllergy(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  allergenId: string,
): Promise<MemberAllergyRow> {
  const input: TablesInsert<"member_allergies"> = {
    user_id: userId,
    member_id: memberId,
    allergen_id: allergenId,
    custom_confirmed: false,
    custom_aliases: [],
  };
  const { data, error } = await client.from("member_allergies").insert(input).select("*").single();
  if (error !== null) throw dataError("アレルギーを登録できませんでした");
  return data;
}

export async function addCustomMemberAllergy(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  customName: string,
  aliases: string[],
): Promise<MemberAllergyRow> {
  const normalizedName = customName.normalize("NFKC").trim();
  // H12: 純句読点・Cf は collision normalize 後 empty。RPC の invalid と揃えクライアントでも拒否。
  const collisionNormalizedName = normalizeFoodText(customName);
  const normalizedAliases = aliases
    .map((alias) => alias.normalize("NFKC").trim())
    .filter((alias) => alias.length > 0 && normalizeFoodText(alias).length > 0);
  if (
    normalizedName.length < 1 ||
    normalizedName.length > 80 ||
    collisionNormalizedName.length < 1
  ) {
    throw dataError("自由登録アレルギーは1〜80文字で入力してください");
  }
  if (
    normalizedAliases.length > 10 ||
    new Set(normalizedAliases).size !== normalizedAliases.length
  ) {
    throw dataError("別名は重複なく10件以内で登録してください");
  }
  void userId;
  const { data, error } = await client.rpc("add_custom_member_allergy", {
    p_member_id: memberId,
    p_custom_name: normalizedName,
    p_custom_aliases: normalizedAliases,
  });
  if (error !== null) {
    if (error.message.includes("custom_allergy_matches_standard")) {
      throw dataError("一覧にある項目と同じです。一覧から選んでください");
    }
    throw dataError("自由登録アレルギーを保存できませんでした");
  }
  return data;
}

export async function deleteHouseholdMember(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
): Promise<void> {
  const { error } = await client
    .from("household_members")
    .delete()
    .eq("id", memberId)
    .eq("user_id", userId);
  if (error !== null) throw dataError("家族を削除できませんでした");
}

export async function listMemberDislikes(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
): Promise<MemberDislikeRow[]> {
  const { data, error } = await client
    .from("member_dislikes")
    .select("*")
    .eq("user_id", userId)
    .eq("member_id", memberId)
    .order("created_at");
  if (error !== null) throw dataError("苦手食材を読み込めませんでした");
  return data;
}

export async function addMemberDislike(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  ingredientName: string,
): Promise<MemberDislikeRow> {
  const normalized = ingredientName.normalize("NFKC").trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw dataError("苦手食材は1〜80文字で入力してください");
  }
  const input: TablesInsert<"member_dislikes"> = {
    user_id: userId,
    member_id: memberId,
    ingredient_name: normalized,
  };
  const { data, error } = await client.from("member_dislikes").insert(input).select("*").single();
  if (error !== null) throw dataError("苦手食材は1〜80文字で重複なく登録してください");
  return data;
}

export async function deleteMemberDislike(
  client: BrowserSupabaseClient,
  userId: string,
  dislikeId: string,
): Promise<void> {
  const { error } = await client
    .from("member_dislikes")
    .delete()
    .eq("id", dislikeId)
    .eq("user_id", userId);
  if (error !== null) throw dataError("苦手食材を削除できませんでした");
}

/**
 * アレルギー削除。RPC は所有行が無い／他人 ID でも例外を返さず void 成功する
 * （他人の存在を応答から漏らさない・意図的 silent success。H8 / migration コメントと同契約）。
 * 行が残るケースは fail-closed 寄り（針が残る）。呼び出し側は refetch で行残存を検知し
 * 利用者へ説明する（H5）。契約変更（boolean 戻り等）は行わない。
 */
export async function deleteMemberAllergy(
  client: BrowserSupabaseClient,
  _userId: string,
  allergyId: string,
): Promise<void> {
  const { error } = await client.rpc("delete_member_allergy", {
    p_allergy_id: allergyId,
  });
  if (error !== null) throw dataError("アレルギーを削除できませんでした");
}
