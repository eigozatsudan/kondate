import { useState, type KeyboardEvent } from "react";
import type { ValidatedMenu } from "@shared/contracts/generation";
import { Inset } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import { MenuIngredientsSummary } from "./menu-ingredients-summary";

const roleLabels = {
  main: "主菜",
  side: "副菜",
  soup: "汁物",
  staple: "主食",
  other: "料理",
} as const;

/** 段取り / 材料まとめ。順序固定（Home=段取り, End=材料まとめ）。 */
const STEPS_TABS = ["timeline", "ingredients"] as const;
type StepsTab = (typeof STEPS_TABS)[number];

export type MenuStepsProps = {
  timeline: ValidatedMenu["timeline"];
  dishes: ValidatedMenu["dishes"];
};

/**
 * 全体の段取り（cook timeline）と材料まとめタブ。
 * 表示専用。時間比例の縦幅は使わず、tabular-nums と並行テキストのみ。
 * タブ選択はローカル state（MenuDishes の親リフトとは非対称でよい）。
 * tablist は .cook-timeline-tabs（sticky なし）— .menu-result-tabs と top:0 で重ならない。
 */
export function MenuSteps({ timeline, dishes }: MenuStepsProps) {
  const [activeTab, setActiveTab] = useState<StepsTab>("timeline");

  const selectByIndex = (index: number) => {
    const next = STEPS_TABS[(index + STEPS_TABS.length) % STEPS_TABS.length];
    if (next !== undefined) {
      setActiveTab(next);
      document.getElementById(`steps-tab-${next}`)?.focus();
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: StepsTab) => {
    const index = STEPS_TABS.indexOf(tab);
    if (event.key === "ArrowRight") selectByIndex(index + 1);
    else if (event.key === "ArrowLeft") selectByIndex(index - 1);
    else if (event.key === "Home") selectByIndex(0);
    else if (event.key === "End") selectByIndex(STEPS_TABS.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <Surface as="section" aria-labelledby="timeline-heading" tone="plain">
      <Inset pad={5}>
        <div className="cook-timeline-panel">
          <h2 id="timeline-heading" className="menu-result-section-title">
            全体の段取り
          </h2>
          {/*
            料理タブ (.menu-result-tabs) と sticky が重ならないよう cook-timeline-tabs のみ。
            roving tabindex: 選択中だけ tabIndex=0。
          */}
          <div role="tablist" aria-label="献立の段取りと材料" className="cook-timeline-tabs">
            <button
              id="steps-tab-timeline"
              type="button"
              role="tab"
              aria-selected={activeTab === "timeline"}
              aria-controls="steps-panel-timeline"
              tabIndex={activeTab === "timeline" ? 0 : -1}
              className="menu-result-tab"
              onClick={() => {
                setActiveTab("timeline");
              }}
              onKeyDown={(event) => {
                handleTabKeyDown(event, "timeline");
              }}
            >
              段取り
            </button>
            <button
              id="steps-tab-ingredients"
              type="button"
              role="tab"
              aria-selected={activeTab === "ingredients"}
              aria-controls="steps-panel-ingredients"
              tabIndex={activeTab === "ingredients" ? 0 : -1}
              className="menu-result-tab"
              onClick={() => {
                setActiveTab("ingredients");
              }}
              onKeyDown={(event) => {
                handleTabKeyDown(event, "ingredients");
              }}
            >
              材料まとめ
            </button>
          </div>
          {activeTab === "timeline" ? (
            <div id="steps-panel-timeline" role="tabpanel" aria-labelledby="steps-tab-timeline">
              {/*
                縮退版: duration 比例の縦幅は契約上 180 分まで伸びるため採用しない。
                時間の tabular-nums 強調・レール色・料理名テキスト・並行の文字明示に絞る。
              */}
              <ol className="cook-timeline">
                {timeline.map((step) => {
                  const dish =
                    step.dishId === null
                      ? null
                      : (dishes.find((item) => item.id === step.dishId) ?? null);
                  const dishIndex =
                    dish === null
                      ? 0
                      : Math.max(
                          0,
                          dishes.findIndex((item) => item.id === dish.id),
                        );
                  const stepEnd = step.startMinute + step.durationMinutes;
                  const parallel = timeline.filter((other) => {
                    if (other.id === step.id) return false;
                    const otherEnd = other.startMinute + other.durationMinutes;
                    return step.startMinute < otherEnd && other.startMinute < stepEnd;
                  });
                  return (
                    <li
                      key={step.id}
                      // レール色は .cook-timeline-step の border-left（CSS）。
                      // 色は補助で、料理名テキストを必ず併記する。
                      className={`cook-timeline-step cook-timeline-dish-${String(dishIndex % 5)}`}
                    >
                      <div className="cook-timeline-time tabular-nums">
                        <span className="cook-timeline-start">{step.startMinute}分〜</span>
                        <span className="cook-timeline-duration type-small">
                          目安 {step.durationMinutes}分
                        </span>
                      </div>
                      <div className="cook-timeline-body">
                        {dish !== null && (
                          <span className="cook-timeline-dish-label type-small">
                            {roleLabels[dish.role]}・{dish.name}
                          </span>
                        )}
                        <span className="cook-timeline-instruction">{step.instruction}</span>
                        {parallel.length > 0 && (
                          <span className="cook-timeline-parallel type-small">
                            並行：
                            {parallel
                              .map((other) => {
                                const otherDish =
                                  other.dishId === null
                                    ? null
                                    : dishes.find((item) => item.id === other.dishId);
                                return otherDish !== null && otherDish !== undefined
                                  ? `${roleLabels[otherDish.role]}・${otherDish.name}`
                                  : other.instruction;
                              })
                              .join("、")}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <div
              id="steps-panel-ingredients"
              role="tabpanel"
              aria-labelledby="steps-tab-ingredients"
            >
              <MenuIngredientsSummary dishes={dishes} />
            </div>
          )}
        </div>
      </Inset>
    </Surface>
  );
}
