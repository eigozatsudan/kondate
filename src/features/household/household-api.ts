import type { OnboardingStatus } from "@shared/contracts/domain";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/types/database.generated";

export type ProfileRow = Tables<"profiles">;
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

export async function updateCompleteHouseholdMember(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  patch: HouseholdMemberPatch,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client
    .from("household_members")
    .update(patch)
    .eq("id", memberId)
    .eq("user_id", userId)
    .eq("status", "complete")
    .select("*")
    .single();
  if (error !== null) throw dataError("家族設定を保存できませんでした");
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
  void userId;
  const { data, error } = await client.rpc("set_onboarding_status", { p_status: status });
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
  const normalizedAliases = aliases
    .map((alias) => alias.normalize("NFKC").trim())
    .filter((alias) => alias.length > 0);
  if (normalizedName.length < 1 || normalizedName.length > 80) {
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
      throw dataError("標準候補に一致します。標準項目から選んでください");
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
