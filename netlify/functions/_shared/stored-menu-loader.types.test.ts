import type { QueryData } from "@supabase/supabase-js";
import { describe, expectTypeOf, it } from "vitest";
import { buildStoredMenuQuery } from "./stored-menu-loader.js";

type StoredMenuSelectRow = NonNullable<QueryData<ReturnType<typeof buildStoredMenuQuery>>>;
type DishRow = StoredMenuSelectRow["dishes"][number];
type AdaptationRow = DishRow["menu_member_adaptations"][number];

// Plan の指定どおり expectTypeOf + toMatchTypeOf で埋め込み形状を固定する。
// expect-type の deprecation は API 置換で契約テストの意味が変わるため、このファイルに限って抑止する。
/* eslint-disable @typescript-eslint/no-deprecated */
describe("stored menu PostgREST query types", () => {
  it("resolves every named owner-composite embed with the required cardinality", () => {
    expectTypeOf<StoredMenuSelectRow>().not.toMatchTypeOf<{ error: true }>();
    expectTypeOf<StoredMenuSelectRow["menu_target_members"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<DishRow["dish_ingredients"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<DishRow["recipe_steps"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<DishRow["menu_member_adaptations"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<AdaptationRow["menu_safety_actions"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<StoredMenuSelectRow["menu_timeline_steps"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<StoredMenuSelectRow["generation_pantry_selections"]>().toMatchTypeOf<
      readonly unknown[]
    >();
    expectTypeOf<StoredMenuSelectRow["menu_label_confirmations"]>().toMatchTypeOf<
      readonly unknown[]
    >();
    expectTypeOf<
      StoredMenuSelectRow["menu_label_confirmations"][number]["source_text_snapshot"]
    >().toEqualTypeOf<string>();
  });
});
/* eslint-enable @typescript-eslint/no-deprecated */
