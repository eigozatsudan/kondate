import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AllergyEditor } from "./allergy-editor";
import type { AllergenAliasRow, AllergenCatalogRow, MemberAllergyRow } from "./household-api";

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

const aliases: AllergenAliasRow[] = [
  {
    id: "alias-egg",
    allergen_id: "allergen-1",
    alias: "たまご",
    normalized_alias: "たまご",
    alias_kind: "direct",
    requires_label_confirmation: false,
    dictionary_version: "2026-07-11",
    created_at: "2026-07-11T00:00:00.000Z",
  },
];

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
  await userEvent.type(
    screen.getByRole("searchbox", { name: "よくあるアレルギーから探す" }),
    "くるみ",
  );
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

it("finds a standard item by a reviewed alias", async () => {
  render(
    <AllergyEditor
      memberId="member-1"
      catalog={catalog}
      aliases={aliases}
      allergies={[]}
      addStandard={vi.fn()}
      addCustom={vi.fn()}
      remove={vi.fn()}
    />,
  );

  await userEvent.type(
    screen.getByRole("searchbox", { name: "よくあるアレルギーから探す" }),
    "たまご",
  );

  expect(screen.getByRole("button", { name: "項目1を追加" })).toBeVisible();
});

it("shows a direct or derived alias match and prevents custom registration", async () => {
  const addCustom = vi.fn();
  render(
    <AllergyEditor
      memberId="member-1"
      catalog={catalog}
      aliases={aliases}
      allergies={[]}
      addStandard={vi.fn()}
      addCustom={addCustom}
      remove={vi.fn()}
    />,
  );

  await userEvent.type(screen.getByLabelText("自由登録名"), "  たまご  ");

  expect(screen.getByRole("alert")).toHaveTextContent("一覧に同じものがあります: 項目1（たまご）");
  await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));
  expect(screen.getByRole("button", { name: "自由登録を追加" })).toBeDisabled();
  expect(addCustom).not.toHaveBeenCalled();
});

it("does not treat a processed-food label term as the user's standard allergen", async () => {
  render(
    <AllergyEditor
      memberId="member-1"
      catalog={catalog}
      aliases={[
        {
          ...aliases[0]!,
          alias_kind: "processed",
          alias: "マヨネーズ",
          normalized_alias: "マヨネーズ",
        },
      ]}
      allergies={[]}
      addStandard={vi.fn()}
      addCustom={vi.fn()}
      remove={vi.fn()}
    />,
  );

  await userEvent.type(screen.getByLabelText("自由登録名"), "マヨネーズ");

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each(["success", "failure"] as const)(
  "serializes every allergy mutation and re-enables operations after %s",
  async (outcome) => {
    let resolveAdd: (() => void) | undefined;
    let rejectAdd: ((error: Error) => void) | undefined;
    const pendingAdd = new Promise<void>((resolve, reject) => {
      resolveAdd = resolve;
      rejectAdd = reject;
    });
    const addStandard = vi.fn().mockReturnValue(pendingAdd);
    const addCustom = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    render(
      <AllergyEditor
        memberId="member-1"
        catalog={catalog}
        allergies={[allergy({ id: "allergy-custom" })]}
        addStandard={addStandard}
        addCustom={addCustom}
        remove={remove}
        onError={onError}
      />,
    );
    await userEvent.type(screen.getByLabelText("自由登録名"), "ひよこ豆");
    await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));

    await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

    expect(screen.getByRole("searchbox", { name: "よくあるアレルギーから探す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "項目1を追加" })).toBeDisabled();
    expect(screen.getByLabelText("自由登録名")).toBeDisabled();
    expect(screen.getByLabelText("別名（カンマ区切り・任意）")).toBeDisabled();
    expect(screen.getByLabelText("一覧にないアレルギーとして登録")).toBeDisabled();
    expect(screen.getByRole("button", { name: "自由登録を追加" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "えんどう豆たんぱくを削除" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "項目1を追加" }));
    fireEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));
    fireEvent.click(screen.getByRole("button", { name: "えんどう豆たんぱくを削除" }));
    expect(addStandard).toHaveBeenCalledTimes(1);
    expect(addCustom).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    await act(async () => {
      if (outcome === "success") resolveAdd?.();
      else rejectAdd?.(new Error("追加に失敗しました"));
      await pendingAdd.catch(() => undefined);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "項目1を追加" })).toBeEnabled();
    });
    expect(screen.getByLabelText("自由登録名")).toBeEnabled();
    expect(screen.getByRole("button", { name: "えんどう豆たんぱくを削除" })).toBeEnabled();
    expect(onError).toHaveBeenCalledTimes(outcome === "failure" ? 1 : 0);
  },
);

it("ignores a rapid second allergy mutation click", () => {
  const addStandard = vi.fn(() => new Promise<void>(() => undefined));
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
  const add = screen.getByRole("button", { name: "くるみを追加" });

  fireEvent.click(add);
  fireEvent.click(add);

  expect(addStandard).toHaveBeenCalledTimes(1);
});

it("reports a remove rejection exactly once", async () => {
  const error = new Error("削除に失敗しました");
  const onError = vi.fn();
  render(
    <AllergyEditor
      memberId="member-1"
      catalog={catalog}
      allergies={[allergy({ allergen_id: "walnut", custom_name: null })]}
      addStandard={vi.fn()}
      addCustom={vi.fn()}
      remove={vi.fn().mockRejectedValue(error)}
      onError={onError}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "くるみを削除" }));

  await waitFor(() => {
    expect(onError).toHaveBeenCalledTimes(1);
  });
  expect(onError).toHaveBeenCalledWith(error);
});
