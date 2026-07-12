import type { OnboardingStatus } from "@shared/contracts/domain";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/types/database.generated";

export type ProfileRow = Tables<"profiles">;
export type HouseholdMemberRow = Tables<"household_members">;
export type MemberAllergyRow = Tables<"member_allergies">;
export type AllergenCatalogRow = Tables<"allergen_catalog">;

export type HouseholdDraftPatch = Pick<
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

export async function createHouseholdMemberDraft(
  client: BrowserSupabaseClient,
  userId: string,
  sortOrder: number,
): Promise<HouseholdMemberRow> {
  const input: TablesInsert<"household_members"> = {
    user_id: userId,
    status: "draft",
    sort_order: sortOrder,
  };
  const { data, error } = await client.from("household_members").insert(input).select("*").single();
  if (error !== null) throw dataError("家族の下書きを作成できませんでした");
  return data;
}

export async function updateHouseholdMemberDraft(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  patch: HouseholdDraftPatch,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client
    .from("household_members")
    .update(patch)
    .eq("id", memberId)
    .eq("user_id", userId)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error !== null) throw dataError("家族情報を保存できませんでした");
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

export async function setOnboardingStatus(
  client: BrowserSupabaseClient,
  userId: string,
  status: OnboardingStatus,
): Promise<ProfileRow> {
  const patch: TablesUpdate<"profiles"> = {
    onboarding_status: status,
    onboarding_completed_at: status === "complete" ? new Date().toISOString() : null,
  };
  const { data, error } = await client
    .from("profiles")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();
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
  const input: TablesInsert<"member_allergies"> = {
    user_id: userId,
    member_id: memberId,
    allergen_id: null,
    custom_name: customName.trim(),
    custom_aliases: aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    custom_confirmed: true,
  };
  const { data, error } = await client.from("member_allergies").insert(input).select("*").single();
  if (error !== null) throw dataError("自由登録アレルギーを保存できませんでした");
  return data;
}

export async function deleteMemberAllergy(
  client: BrowserSupabaseClient,
  userId: string,
  allergyId: string,
): Promise<void> {
  const { error } = await client
    .from("member_allergies")
    .delete()
    .eq("id", allergyId)
    .eq("user_id", userId);
  if (error !== null) throw dataError("アレルギーを削除できませんでした");
}
