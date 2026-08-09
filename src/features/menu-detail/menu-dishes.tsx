import type { KeyboardEvent } from "react";
import type { ValidatedMenu } from "@shared/contracts/generation";
import { MENU_LABEL_CONFIRMATION_RECORD_NOTICE } from "@/features/generation/components/idea-menu-safety-notice";
import type { MenuResultLabelWarning } from "@/features/generation/components/menu-result";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/feedback";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

const roleLabels = {
  main: "主菜",
  side: "副菜",
  soup: "汁物",
  staple: "主食",
  other: "料理",
} as const;

const amount = (value: number | null, unit: string | null, text: string) =>
  value === null ? text : `${String(value)}${unit ?? ""}`;

type MenuDish = ValidatedMenu["dishes"][number];
type MenuAdaptation = ValidatedMenu["adaptations"][number];

export type MenuDishesProps = {
  dishes: readonly MenuDish[];
  selected: MenuDish;
  selectedId: string;
  mode: "household" | "idea";
  selectedAdaptations: readonly MenuAdaptation[];
  memberLabels: Readonly<Record<string, string>>;
  labels: readonly MenuResultLabelWarning[];
  onSelectDish: (dishId: string) => void;
  onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, dishId: string) => void;
  onRegenerateSelectedDish?: () => void;
  regenerateSelectedDishDisabled?: boolean;
  /** ラベル確認ボタンを出すか（actions があるときだけ） */
  canConfirmLabel: boolean;
  confirmingId: string | null;
  busy: boolean;
  onConfirmLabel: (confirmationId: string) => void;
};

/**
 * 品目タブ列と選択中料理の詳細（材料・作り方・取り分け・ラベル確認）。
 * 表示専用。選択状態・確認 mutation は親に残す。
 * sticky タブ列・材料 grid は .menu-result-* 意味クラス（Surface では表現できない）。
 */
export function MenuDishes({
  dishes,
  selected,
  selectedId,
  mode,
  selectedAdaptations,
  memberLabels,
  labels,
  onSelectDish,
  onTabKeyDown,
  onRegenerateSelectedDish,
  regenerateSelectedDishDisabled = false,
  canConfirmLabel,
  confirmingId,
  busy,
  onConfirmLabel,
}: MenuDishesProps) {
  return (
    <>
      <div role="tablist" aria-label="料理" className="menu-result-tabs">
        {dishes.map((dish) => (
          <button
            key={dish.id}
            id={`tab-${dish.id}`}
            type="button"
            role="tab"
            aria-selected={dish.id === selectedId}
            aria-controls={`panel-${dish.id}`}
            tabIndex={dish.id === selectedId ? 0 : -1}
            onClick={() => {
              onSelectDish(dish.id);
            }}
            onKeyDown={(event) => {
              onTabKeyDown(event, dish.id);
            }}
            className="menu-result-tab"
          >
            {roleLabels[dish.role]}・{dish.name}
          </button>
        ))}
      </div>

      {/* article に role=tabpanel は aria-allowed-role 違反になるため div を使う */}
      <div
        id={`panel-${selected.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${selected.id}`}
        className="menu-result-card"
      >
        <Stack gap={4}>
          <div>
            <h2 className="menu-result-section-title">{selected.name}</h2>
            <p className="menu-result-dish-description">{selected.description}</p>
          </div>
          {onRegenerateSelectedDish !== undefined && (
            <div className="menu-result-regenerate-wrap">
              {/*
                料理パネル内に置くことで「この一品」の指示対象が文脈で伝わる。
                ラベル文言は e2e / 既存 getByRole 契約のため変更しない。
              */}
              <Button
                variant="secondary"
                disabled={regenerateSelectedDishDisabled}
                onClick={onRegenerateSelectedDish}
              >
                この一品だけ別案にする
              </Button>
            </div>
          )}
          <div>
            <h3 className="menu-result-section-heading">材料</h3>
            <ul className="menu-result-ingredient-list">
              {selected.ingredients.map((item) => (
                <li key={item.id} className="menu-result-ingredient-row">
                  <span className="menu-result-ingredient-name">
                    {item.name}
                    {item.labelConfirmationRequired && <Badge tone="warning">ラベル確認</Badge>}
                  </span>
                  <span className="menu-result-ingredient-amount">
                    {amount(item.quantityValue, item.unit, item.quantityText)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="menu-result-section-heading">作り方</h3>
            <ol className="menu-result-step-list">
              {selected.steps.map((step) => (
                <li key={step.id} className="menu-result-step-row">
                  <span className="menu-result-step-position">{step.position}</span>
                  <span className="menu-result-step-text">{step.instruction}</span>
                </li>
              ))}
            </ol>
          </div>
          {mode === "household" && (
            <div>
              <h3 className="menu-result-section-heading">家族向けの取り分け</h3>
              {selectedAdaptations.length === 0 ? (
                <p className="menu-result-section-lead">この料理の取り分け案はありません。</p>
              ) : (
                <Stack gap={3}>
                  {selectedAdaptations.map((item) => (
                    <dl key={item.id} className="menu-result-adaptation">
                      <dt className="menu-result-adaptation-title">
                        {memberLabels[item.anonymousMemberRef] ?? "家族"}・{item.portionText}
                      </dt>
                      <dd>
                        分ける前: 手順
                        {
                          selected.steps.find((step) => step.id === item.branchBeforeRecipeStepId)
                            ?.position
                        }
                      </dd>
                      {item.additionalCutting && <dd>切り方: {item.additionalCutting}</dd>}
                      {item.additionalHeating && <dd>加熱: {item.additionalHeating}</dd>}
                      {item.additionalSeasoning && <dd>味付け: {item.additionalSeasoning}</dd>}
                      <dd>配膳時: {item.servingCheck}</dd>
                      {item.safetyActions.length !== 0 && (
                        <dd>
                          {/* 「安全のための手順」は保証語に寄るため、取り分け時の注意として示す（H10） */}
                          <strong>取り分け時の注意</strong>
                          <ul>
                            {item.safetyActions.map((action, index) => (
                              <li key={`${action.beforeRecipeStepId}-${String(index)}`}>
                                {action.instruction}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      )}
                    </dl>
                  ))}
                </Stack>
              )}
            </div>
          )}
          {mode === "household" && labels.length !== 0 && (
            <Surface as="section" tone="notice" aria-labelledby="label-confirmations-heading">
              <Inset pad={5}>
                <Stack gap={3}>
                  <h3 id="label-confirmations-heading" className="menu-result-label-section-title">
                    原材料表示の確認
                  </h3>
                  <p className="menu-detail-disclaimer-strong">
                    加工品は原材料表示を確認してください
                  </p>
                  {/* soft processed は確認手続きのみ。バッジ直近で確認＝安全の誤認を抑える（H1） */}
                  <p className="type-small">{MENU_LABEL_CONFIRMATION_RECORD_NOTICE}</p>
                  <ul className="menu-result-label-list">
                    {labels.map((item) => (
                      <li key={item.confirmationId} className="menu-result-label-item">
                        {item.sourceText}：{item.allergenName}（{item.memberLabel}）
                        <span className="menu-result-label-meta">
                          辞書版 {item.dictionaryVersion}
                        </span>
                        {item.confirmationStatus === "confirmed" ? (
                          <span className="menu-result-label-confirmed">表示確認を記録済み</span>
                        ) : !canConfirmLabel ? null : (
                          <div className="menu-result-label-action">
                            <Button
                              variant="secondary"
                              disabled={busy || confirmingId === item.confirmationId}
                              onClick={() => {
                                onConfirmLabel(item.confirmationId);
                              }}
                            >
                              本人が商品の原材料表示を確認しました
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </Stack>
              </Inset>
            </Surface>
          )}
        </Stack>
      </div>
    </>
  );
}
