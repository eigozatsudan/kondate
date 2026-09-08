import type { JSX } from "react";
import { Link } from "react-router";

export type WeeklyPlanHistoryRow = {
  id: string;
  week_start: string;
  created_at: string;
  preference_snapshot: { targetMemberIds: readonly string[] };
};

export type WeeklyPlanHistoryCardProps = {
  plans: readonly WeeklyPlanHistoryRow[];
  currentCompleteMemberIds: readonly string[];
};

/** spec §4.4「履歴タブ」。partialHousehold は ID 集合の完全一致で判定する（R-06、件数比較はしない）。 */
export function WeeklyPlanHistoryCard({
  plans,
  currentCompleteMemberIds,
}: WeeklyPlanHistoryCardProps): JSX.Element | null {
  if (plans.length === 0) return null;
  const [latest, ...rest] = plans;
  if (latest === undefined) return null; // plans.length > 0 で到達しないが noUncheckedIndexedAccess 対策
  const currentIds = new Set(currentCompleteMemberIds);
  const snapshotIds = new Set(latest.preference_snapshot.targetMemberIds);
  const partial =
    currentIds.size !== snapshotIds.size || [...snapshotIds].some((id) => !currentIds.has(id));

  return (
    <section className="stack card" aria-labelledby="weekly-plan-history-heading">
      <h2 id="weekly-plan-history-heading">今週の献立</h2>
      <Link to={`/weekly/${latest.id}`} className="card stack">
        <p>{latest.week_start}</p>
        {partial ? (
          <>
            <p>{snapshotIds.size} 人分</p>
            <p className="muted">外した家族の条件は見ていません</p>
          </>
        ) : null}
      </Link>
      {rest.length > 0 ? (
        <details>
          <summary className="min-h-11">これまでの週献立</summary>
          <ul>
            {rest.map((plan) => (
              <li key={plan.id}>
                <Link to={`/weekly/${plan.id}`}>{plan.week_start}</Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
