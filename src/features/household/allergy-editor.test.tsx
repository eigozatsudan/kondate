import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AllergyEditor } from "./allergy-editor";
import type { AllergenCatalogRow, MemberAllergyRow } from "./household-api";

const catalog: AllergenCatalogRow[] = Array.from({ length: 29 }, (_, index) => ({
  id: index === 0 ? "walnut" : `allergen-${String(index)}`,
  display_name: index === 0 ? "くるみ" : `項目${String(index)}`,
  regulatory_class: "standard",
  catalog_version: "2026-07-11",
  created_at: "2026-07-11T00:00:00.000Z",
}));

const allergy = (patch: Partial<MemberAllergyRow>): MemberAllergyRow => ({
  id: "allergy-1",
  user_id: "user-1",
  member_id: "member-1",
  allergen_id: null,
  custom_name: "えんどう豆たんぱく",
  custom_aliases: [],
  custom_confirmed: true,
  created_at: "2026-07-11T00:00:00.000Z",
  ...patch,
});

it("searches all 29 standard items and adds the selected catalog id", async () => {
  const addStandard = vi.fn().mockResolvedValue(undefined);
  render(
    <AllergyEditor
      memberId="member-1"
      catalog={catalog}
      allergies={[]}
      addStandard={addStandard}
      addCustom={vi.fn()}
      remove={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByRole("searchbox", { name: "標準29品目を検索" }), "くるみ");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  expect(addStandard).toHaveBeenCalledWith("member-1", "walnut");
});

it("lists standard and custom allergies by name and removes either", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  render(
    <AllergyEditor
      memberId="member-1"
      catalog={catalog}
      allergies={[
        allergy({ allergen_id: "walnut", custom_name: null }),
        allergy({ id: "allergy-2" }),
      ]}
      addStandard={vi.fn()}
      addCustom={vi.fn()}
      remove={remove}
    />,
  );
  expect(screen.getByRole("list", { name: "選択済みアレルギー" })).toHaveTextContent("くるみ");
  expect(screen.getByRole("list", { name: "選択済みアレルギー" })).toHaveTextContent(
    "えんどう豆たんぱく",
  );
  await userEvent.click(screen.getByRole("button", { name: "くるみを削除" }));
  expect(remove).toHaveBeenCalledWith("allergy-1");
});
