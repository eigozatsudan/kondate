import { describe, expect, it } from "vitest";
import { shoppingItemsMax } from "@shared/contracts/shopping";
import { shoppingCommandCodedFailureCopy, shoppingListAtItemCeilingCopy } from "./shopping-copy";

describe("shoppingCommandCodedFailureCopy", () => {
  it("SHOP-R1: maps shopping_items_limit_exceeded to list-page ceiling copy", () => {
    expect(shoppingCommandCodedFailureCopy("shopping_items_limit_exceeded")).toBe(
      shoppingListAtItemCeilingCopy,
    );
    expect(shoppingListAtItemCeilingCopy).toContain(String(shoppingItemsMax));
    expect(shoppingListAtItemCeilingCopy).toContain("リストから外した項目も件数に入る");
    expect(shoppingListAtItemCeilingCopy).toContain("新しいリスト");
  });

  it("keeps the generic coded-failure copy for other codes", () => {
    expect(shoppingCommandCodedFailureCopy("list_version_conflict")).toBe(
      "買い物リストの状態が変わりました。もう一度確認してください",
    );
    expect(shoppingCommandCodedFailureCopy("current_safety_revalidation_required")).toBe(
      "買い物リストの状態が変わりました。もう一度確認してください",
    );
  });
});
