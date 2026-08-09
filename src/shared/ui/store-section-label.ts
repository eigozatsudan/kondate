import type { StoreSection } from "@shared/contracts/shopping";

const sectionLabels: Record<StoreSection, string> = {
  produce: "野菜",
  meat_fish: "肉・魚",
  dairy_eggs: "乳製品・卵",
  dry_goods: "乾物",
  seasonings: "調味料",
  other: "その他",
};

/** 売場セクションの日本語ラベル（menu-detail / shopping 共用）。 */
export function categoryLabel(section: StoreSection): string {
  return sectionLabels[section];
}
