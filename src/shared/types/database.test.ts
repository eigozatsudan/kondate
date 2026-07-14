import { expect, expectTypeOf, it } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Database } from "./database";
import type { Database as GeneratedDatabase } from "./database.generated";

type SaveDraftArgs = Database["public"]["Functions"]["save_generation_draft"]["Args"];

it("未完成下書きのnullable項目をRPC引数として表現できる", () => {
  const args = {
    p_expected_revision: 0,
    p_meal_type: null,
    p_main_ingredients: [],
    p_cuisine_genre: null,
    p_target_member_ids: [],
    p_time_limit_minutes: null,
    p_budget_preference: null,
    p_avoid_ingredients: [],
    p_memo: "",
    p_pantry_selections: [],
  } satisfies SaveDraftArgs;

  expectTypeOf(args).toExtend<SaveDraftArgs>();
  expect(args.p_meal_type).toBeNull();
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
  p_target_member_ids: [],
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
  "p_meal_type" | "p_cuisine_genre" | "p_time_limit_minutes" | "p_budget_preference";

it("nullable 4項目以外のRPC契約を変更しない", () => {
  expectTypeOf<Omit<AppSaveDraft["Args"], NullableDraftArg>>().toEqualTypeOf<
    Omit<GeneratedSaveDraft["Args"], NullableDraftArg>
  >();
  expectTypeOf<AppSaveDraft["Returns"]>().toEqualTypeOf<GeneratedSaveDraft["Returns"]>();
  expectTypeOf<AppSaveDraft["SetofOptions"]>().toEqualTypeOf<GeneratedSaveDraft["SetofOptions"]>();
  expectTypeOf<Database["public"]["Functions"]["set_onboarding_status"]>().toEqualTypeOf<
    GeneratedDatabase["public"]["Functions"]["set_onboarding_status"]
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
