import { expect, expectTypeOf, it } from "vitest";
import type { OnboardingStatus } from "@shared/contracts/domain";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Database } from "./database";
import type { Database as GeneratedDatabase } from "./database.generated";

type SaveDraftArgs = Database["public"]["Functions"]["save_generation_draft"]["Args"];
type ReserveGeneration = Database["public"]["Functions"]["reserve_ai_generation"];
type ReserveGenerationArgs = ReserveGeneration["Args"];
type FinalizeGenerationFailure = Database["public"]["Functions"]["finalize_ai_generation_failure"];
type FinalizeGenerationFailureArgs = FinalizeGenerationFailure["Args"];
type FinalizeGenerationSuccess = Database["public"]["Functions"]["finalize_ai_generation_success"];
type FinalizeGenerationSuccessArgs = FinalizeGenerationSuccess["Args"];

it("accepts nullable draft references for regeneration reservations", () => {
  const args = {
    p_user_id: "10000000-0000-4000-8000-000000000001",
    p_idempotency_key: "20000000-0000-4000-8000-000000000001",
    p_request_kind: "regenerate_menu",
    p_draft_id: null,
    p_draft_revision: null,
    p_source_menu_id: "60000000-0000-4000-8000-000000000001",
    p_replace_dish_id: null,
    p_change_reason: "simpler",
    p_request_hmac_version: "generation-command.v2",
    p_request_hmac: "a".repeat(64),
    p_integrity_context: {
      kind: "regenerate_menu",
      target_mode: "household",
      servings: 2,
      target_member_ids: ["70000000-0000-4000-8000-000000000001"],
      source_menu_version: 1,
    },
    p_user_limit: 5,
    p_global_limit: 45,
  } satisfies ReserveGenerationArgs;

  expectTypeOf(args).toExtend<ReserveGenerationArgs>();
  expect(args.p_draft_id).toBeNull();
  expect(args.p_source_menu_id).not.toBeNull();
});

it("accepts a null retry time for terminal failures", () => {
  const args = {
    p_request_id: "40000000-0000-4000-8000-000000000001",
    p_failure_code: "model_unavailable",
    p_retry_at: null,
  } satisfies FinalizeGenerationFailureArgs;

  expectTypeOf(args).toExtend<FinalizeGenerationFailureArgs>();
  expect(args.p_retry_at).toBeNull();
});

it("accepts nullable lineage for new-menu finalization", () => {
  const args = {
    p_request_id: "40000000-0000-4000-8000-000000000003",
    p_menu: {},
    p_preference_snapshot: {},
    p_safety_snapshot: {},
    p_safety_fingerprint: "fingerprint",
    p_allergen_version: "allergen-v1",
    p_food_rule_version: "food-rule-v1",
    p_target_members: [],
    p_expired_checks: [],
    p_source_menu_id: null,
    p_change_reason: null,
    p_change_reason_custom: null,
  } satisfies FinalizeGenerationSuccessArgs;

  expectTypeOf(args).toExtend<FinalizeGenerationSuccessArgs>();
  expect(args.p_source_menu_id).toBeNull();
});

it("accepts household string versions and idea null versions for finalize success", () => {
  const household = {
    p_request_id: "40000000-0000-4000-8000-000000000010",
    p_menu: {},
    p_preference_snapshot: {},
    p_safety_snapshot: {},
    p_safety_fingerprint: "fp",
    p_allergen_version: "allergen-v1",
    p_food_rule_version: "food-rule-v1",
    p_target_members: [],
    p_expired_checks: [],
    p_source_menu_id: null,
    p_change_reason: null,
    p_change_reason_custom: null,
  } satisfies FinalizeGenerationSuccessArgs;
  const idea = {
    ...household,
    p_request_id: "40000000-0000-4000-8000-000000000011",
    p_allergen_version: null,
    p_food_rule_version: null,
  } satisfies FinalizeGenerationSuccessArgs;

  expectTypeOf(household.p_allergen_version).toExtend<string | null>();
  expectTypeOf(idea.p_allergen_version).toExtend<string | null>();
  expectTypeOf(household.p_food_rule_version).toExtend<string | null>();
  expectTypeOf(idea.p_food_rule_version).toExtend<string | null>();
  expect(household.p_allergen_version).toBe("allergen-v1");
  expect(idea.p_allergen_version).toBeNull();
  expect(idea.p_food_rule_version).toBeNull();
});

const invalidUndefinedRetry = {
  p_request_id: "40000000-0000-4000-8000-000000000002",
  p_failure_code: "model_unavailable",
  p_retry_at: undefined,
  // @ts-expect-error retry時刻は省略かstring/nullであり、明示undefinedは許可しない
} satisfies FinalizeGenerationFailureArgs;

void invalidUndefinedRetry;

it("未完成下書きのnullable項目をRPC引数として表現できる", () => {
  const args = {
    p_expected_revision: 0,
    p_meal_type: null,
    p_main_ingredients: [],
    p_cuisine_genre: null,
    p_target_mode: null,
    p_target_member_ids: [],
    p_servings: null,
    p_time_limit_minutes: null,
    p_budget_preference: null,
    p_avoid_ingredients: [],
    p_memo: "",
    p_pantry_selections: [],
  } satisfies SaveDraftArgs;

  expectTypeOf(args).toExtend<SaveDraftArgs>();
  expect(args.p_meal_type).toBeNull();
  expect(args.p_target_mode).toBeNull();
  expect(args.p_servings).toBeNull();
});

function acceptsIncompleteDraft(client: BrowserSupabaseClient, args: SaveDraftArgs) {
  return client.rpc("save_generation_draft", args);
}

it("browser clientのRPC境界も未完成下書きを受け入れる", () => {
  expectTypeOf(acceptsIncompleteDraft).toBeFunction();
});

const invalidMemo = {
  p_expected_revision: 0,
  p_meal_type: null,
  p_main_ingredients: [],
  p_cuisine_genre: null,
  p_target_mode: null,
  p_target_member_ids: [],
  p_servings: null,
  p_time_limit_minutes: null,
  p_budget_preference: null,
  p_avoid_ingredients: [],
  // @ts-expect-error memoはnullableへ拡張しない
  p_memo: null,
  p_pantry_selections: [],
} satisfies SaveDraftArgs;

void invalidMemo;

type GeneratedSaveDraft = GeneratedDatabase["public"]["Functions"]["save_generation_draft"];
type AppSaveDraft = Database["public"]["Functions"]["save_generation_draft"];
type NullableDraftArg =
  | "p_meal_type"
  | "p_cuisine_genre"
  | "p_target_mode"
  | "p_servings"
  | "p_time_limit_minutes"
  | "p_budget_preference";
type GeneratedReserveGeneration = GeneratedDatabase["public"]["Functions"]["reserve_ai_generation"];
type NullableReserveGenerationArg =
  "p_draft_id" | "p_draft_revision" | "p_source_menu_id" | "p_replace_dish_id" | "p_change_reason";
type GeneratedFinalizeGenerationFailure =
  GeneratedDatabase["public"]["Functions"]["finalize_ai_generation_failure"];
type GeneratedFinalizeGenerationSuccess =
  GeneratedDatabase["public"]["Functions"]["finalize_ai_generation_success"];
type NullableFinalizeGenerationSuccessArg =
  | "p_source_menu_id"
  | "p_change_reason"
  | "p_change_reason_custom"
  | "p_allergen_version"
  | "p_food_rule_version";

it("nullable 4項目以外のRPC契約を変更しない", () => {
  expectTypeOf<Omit<AppSaveDraft["Args"], NullableDraftArg>>().toEqualTypeOf<
    Omit<GeneratedSaveDraft["Args"], NullableDraftArg>
  >();
  expectTypeOf<AppSaveDraft["Returns"]>().toEqualTypeOf<GeneratedSaveDraft["Returns"]>();
  expectTypeOf<AppSaveDraft["SetofOptions"]>().toEqualTypeOf<GeneratedSaveDraft["SetofOptions"]>();
});

it("set_onboarding_statusのonboarding_statusをOnboardingStatusのリテラルユニオンへ絞り込む", () => {
  type AppSetOnboardingStatus = Database["public"]["Functions"]["set_onboarding_status"];
  type GeneratedSetOnboardingStatus =
    GeneratedDatabase["public"]["Functions"]["set_onboarding_status"];

  expectTypeOf<AppSetOnboardingStatus["Args"]>().toEqualTypeOf<{ p_status: OnboardingStatus }>();
  expectTypeOf<AppSetOnboardingStatus["Returns"]>().toEqualTypeOf<ProfileRow>();
  expectTypeOf<Omit<AppSetOnboardingStatus, "Args" | "Returns">>().toEqualTypeOf<
    Omit<GeneratedSetOnboardingStatus, "Args" | "Returns">
  >();
});

it("preserves every other reservation argument and return contract", () => {
  expectTypeOf<Omit<ReserveGeneration["Args"], NullableReserveGenerationArg>>().toEqualTypeOf<
    Omit<GeneratedReserveGeneration["Args"], NullableReserveGenerationArg>
  >();
  expectTypeOf<ReserveGeneration["Returns"]>().toEqualTypeOf<
    GeneratedReserveGeneration["Returns"]
  >();
});

it("preserves every other failure argument and return contract", () => {
  expectTypeOf<Omit<FinalizeGenerationFailure["Args"], "p_retry_at">>().toEqualTypeOf<
    Omit<GeneratedFinalizeGenerationFailure["Args"], "p_retry_at">
  >();
  expectTypeOf<FinalizeGenerationFailure["Returns"]>().toEqualTypeOf<
    GeneratedFinalizeGenerationFailure["Returns"]
  >();
});

it("preserves every other success argument and return contract", () => {
  expectTypeOf<
    Omit<FinalizeGenerationSuccess["Args"], NullableFinalizeGenerationSuccessArg>
  >().toEqualTypeOf<
    Omit<GeneratedFinalizeGenerationSuccess["Args"], NullableFinalizeGenerationSuccessArg>
  >();
  expectTypeOf<FinalizeGenerationSuccess["Returns"]>().toEqualTypeOf<
    GeneratedFinalizeGenerationSuccess["Returns"]
  >();
});

const invalidRevision = {
  ...invalidMemo,
  p_memo: "",
  // @ts-expect-error expected revisionはnullableへ拡張しない
  p_expected_revision: null,
} satisfies SaveDraftArgs;

const invalidMainIngredients = {
  ...invalidMemo,
  p_memo: "",
  // @ts-expect-error 配列はnullableへ拡張しない
  p_main_ingredients: null,
} satisfies SaveDraftArgs;

void invalidRevision;
void invalidMainIngredients;

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

it("profiles.onboarding_status はskippedへ代入できる", () => {
  const skippedProfile = {
    user_id: "10000000-0000-4000-8000-000000000099",
    onboarding_status: "skipped",
    onboarding_completed_at: "2026-07-22T00:00:00.000Z",
    created_at: "2026-07-22T00:00:00.000Z",
    updated_at: "2026-07-22T00:00:00.000Z",
  } satisfies ProfileRow;

  expectTypeOf(skippedProfile).toExtend<ProfileRow>();
  expect(skippedProfile.onboarding_status).toBe("skipped");
});

const invalidOnboardingStatus = {
  user_id: "10000000-0000-4000-8000-000000000098",
  // @ts-expect-error onboarding_statusは既知の状態集合へのみ代入できる
  onboarding_status: "unknown_status",
  onboarding_completed_at: null,
  created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T00:00:00.000Z",
} satisfies ProfileRow;

void invalidOnboardingStatus;
