import type { ValidatedMenu } from "@shared/contracts/generation";
import { buildMenuIngredientsSummary } from "./build-menu-ingredients-summary";
import { categoryLabel } from "@/shared/ui/store-section-label";
import { Badge } from "@/shared/ui/feedback";
import { Stack } from "@/shared/ui/stack";

export type MenuIngredientsSummaryProps = {
  dishes: ValidatedMenu["dishes"];
};

/**
 * 献立全体の材料まとめ（表示専用）。
 * 合算は buildMenuIngredientsSummary。区分は div+h3（region を増やさない）。
 * 生 Tailwind 禁止 → 意味クラスのみ。
 */
export function MenuIngredientsSummary({ dishes }: MenuIngredientsSummaryProps) {
  const sections = buildMenuIngredientsSummary(dishes);
  return (
    <Stack gap={4}>
      {sections.map((section) => (
        <div key={section.storeSection}>
          <h3
            id={`ingredient-section-${section.storeSection}`}
            className="menu-result-section-heading"
          >
            {categoryLabel(section.storeSection)}
          </h3>
          <ul className="menu-result-ingredient-list">
            {section.lines.map((line) => (
              <li key={line.key} className="menu-result-ingredient-row">
                <span className="menu-result-ingredient-name">
                  {line.displayName}
                  {line.labelConfirmationRequired ? <Badge tone="warning">ラベル確認</Badge> : null}
                </span>
                <span className="menu-result-ingredient-amount">{line.quantityText}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Stack>
  );
}
