import type { JSX, MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  navigateAfterPlannerLeaveFlush,
  shouldInterceptPlannerLeaveClick,
} from "../../planner/planner-leave-flush.js";

export type WeeklyPlanEntryCardProps = {
  plusEntitled: boolean;
};

/** L: 週献立の入口カード。ロック表示はチラシ flyer-weekly-locked と同型。 */
export function WeeklyPlanEntryCard({ plusEntitled }: WeeklyPlanEntryCardProps): JSX.Element {
  const navigate = useNavigate();

  if (!plusEntitled) {
    return (
      <section
        className="stack card"
        data-testid="weekly-plan-locked"
        aria-labelledby="weekly-plan-locked-heading"
      >
        <h2 id="weekly-plan-locked-heading">今週の献立</h2>
        <div className="flyer-locked-preview" aria-hidden="true">
          <p className="muted">サンプル: 月〜水の主菜プレビュー（ロック）</p>
          <ul className="muted flyer-locked-sample">
            <li>月曜 …</li>
            <li>火曜 …</li>
            <li>水曜 …</li>
          </ul>
        </div>
        <p>今週の献立づくりは Plus の機能です</p>
        <p className="muted" data-testid="weekly-plan-plus-server-note">
          作成できるかは Plus 契約をサーバーで確認します。
        </p>
        <Link className="primary-button min-h-11" to="/plus">
          Plus を見る
        </Link>
      </section>
    );
  }

  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!shouldInterceptPlannerLeaveClick(event)) return;
    event.preventDefault();
    void navigateAfterPlannerLeaveFlush(navigate, "/weekly");
  };

  return (
    <section className="stack card" aria-labelledby="weekly-plan-entry-heading">
      <h2 id="weekly-plan-entry-heading">今週の献立</h2>
      <p className="muted">家族の条件から1週間分の献立の骨組みをつくります。</p>
      <Link className="primary-button min-h-11" to="/weekly" onClick={onClick}>
        今週の献立をつくる
      </Link>
    </section>
  );
}
