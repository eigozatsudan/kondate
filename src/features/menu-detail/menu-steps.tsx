import type { ValidatedMenu } from "@shared/contracts/generation";
import { Surface } from "@/shared/ui/surface";

const roleLabels = {
  main: "主菜",
  side: "副菜",
  soup: "汁物",
  staple: "主食",
  other: "料理",
} as const;

export type MenuStepsProps = {
  timeline: ValidatedMenu["timeline"];
  dishes: ValidatedMenu["dishes"];
};

/**
 * 全体の段取り（cook timeline）。
 * 表示専用。時間比例の縦幅は使わず、tabular-nums と並行テキストのみ。
 * 読み物として行間を広く取り、番号は .cook-timeline-* で控えめに。
 */
export function MenuSteps({ timeline, dishes }: MenuStepsProps) {
  return (
    <Surface as="section" aria-labelledby="timeline-heading" tone="plain">
      <div className="cook-timeline-panel">
        <h2 id="timeline-heading" className="menu-result-section-title">
          全体の段取り
        </h2>
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
    </Surface>
  );
}
