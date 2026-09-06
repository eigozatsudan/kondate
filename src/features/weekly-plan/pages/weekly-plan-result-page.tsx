import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useWeeklyPlan } from "../hooks/use-weekly-plan";
import {
  buildPlannerDraftInputFromWeeklyPlanDay,
  draftNeedsOverwriteConfirmation,
} from "../weekly-plan-draft-handoff";
import {
  DraftRevisionConflictError,
  getPlannerDraft,
  savePlannerDraft,
} from "../../planner/planner-api";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

export type WeeklyPlanResultPageProps = {
  accessToken: string;
  weeklyPlanId: string;
  userId: string;
  /**
   * 現行 complete メンバー id 集合。呼び出し側（Task 14 のルート）が実際の家族一覧クエリから渡す。
   * WP-P-5: デフォルト値は持たない。`[]`をデフォルトにすると、呼び出し側が配線を忘れた場合に
   * `buildPlannerDraftInputFromWeeklyPlanDay` が常に対象0人と判定し、
   * 全ての日タップが無条件に no_eligible_members になってしまう（配線漏れが静かに握りつぶされる）。
   */
  currentCompleteMemberIds: readonly string[];
};

/** spec §4.3「結果画面」。 */
export function WeeklyPlanResultPage({
  accessToken,
  weeklyPlanId,
  userId,
  currentCompleteMemberIds,
}: WeeklyPlanResultPageProps): ReactElement {
  const navigate = useNavigate();
  const query = useWeeklyPlan(accessToken, weeklyPlanId);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  // WP-P-5: 上書き確認は dayIndex だけを保持する（build 済みの outcome を保持すると
  // 「置き換える」クリック時に再ビルドせず古い outcome を使ってしまい、確認後の再送信が
  // 常に元の dayIndex=0 相当に固定される不具合を招く）。
  const [pendingConfirm, setPendingConfirm] = useState<{ dayIndex: number } | null>(null);

  if (query.isPending) return <p>読み込み中…</p>;
  if (query.isError) return <p role="alert">読み込めませんでした</p>;
  const plan = query.data;

  async function handoffDay(
    dayIndex: number,
    options?: { skipConfirm?: boolean | undefined; attempt?: number },
  ): Promise<void> {
    const attempt = options?.attempt ?? 0;
    setHandoffError(null);
    const day = plan.days.find((candidate) => candidate.dayIndex === dayIndex);
    if (day === undefined) return;
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(day, plan, currentCompleteMemberIds);
    if ("error" in outcome) {
      setHandoffError("引き継ぎできる家族がいません。作り直してください。");
      return;
    }
    const client = getBrowserSupabaseClient();
    const existing = await getPlannerDraft(client, userId);
    if (
      options?.skipConfirm !== true &&
      // WP-P-7: getPlannerDraft は PlannerDraft（フラットな形。input プロパティは存在しない）
      // を返す。draftNeedsOverwriteConfirmation の第一引数はそのまま existing を渡す。
      draftNeedsOverwriteConfirmation(existing, outcome.input)
    ) {
      setPendingConfirm({ dayIndex });
      return;
    }
    setPendingConfirm(null);
    try {
      await savePlannerDraft(client, userId, outcome.input, existing?.revision ?? 0);
      await navigate("/planner");
    } catch (error) {
      if (error instanceof DraftRevisionConflictError && attempt < 1) {
        await handoffDay(dayIndex, { skipConfirm: options?.skipConfirm, attempt: attempt + 1 });
        return;
      }
      setHandoffError("献立条件を保存できませんでした。");
    }
  }

  return (
    <main className="page-frame">
      <h1>
        {plan.partialHousehold
          ? `${String(plan.targetMemberIds.length)} 人分の今週の献立`
          : "今週の献立"}
      </h1>
      {plan.partialHousehold ? (
        <p role="note">外した家族の条件は見ていません。全員分を作るには作り直してください</p>
      ) : null}
      {plan.staleSafety ? <p role="note">家族の設定が変わっています。作り直してください</p> : null}
      <p className="muted">安全性を保証するものではありません。必ずご自身でご確認ください。</p>
      <ul className="stack">
        {plan.days.map((day) => (
          <li key={day.dayIndex} className="card stack">
            <h2>{day.label}</h2>
            <p>{day.mainName}</p>
            {day.sideName !== null && day.sideName !== undefined ? <p>{day.sideName}</p> : null}
            <ul>
              {day.ingredients.map((ingredient) => (
                <li key={ingredient}>{ingredient}</li>
              ))}
            </ul>
            {day.notes !== null && day.notes !== undefined ? <p>{day.notes}</p> : null}
            <button
              type="button"
              className="secondary-button min-h-11"
              onClick={() => void handoffDay(day.dayIndex)}
            >
              この日の献立を作る
            </button>
          </li>
        ))}
      </ul>
      {handoffError !== null ? (
        <p role="alert" className="error">
          {handoffError}
        </p>
      ) : null}
      {pendingConfirm !== null ? (
        <div role="dialog" aria-label="いまの献立条件を置き換えますか">
          <p>いまの献立条件を置き換えますか</p>
          <button
            type="button"
            onClick={() => void handoffDay(pendingConfirm.dayIndex, { skipConfirm: true })}
          >
            置き換える
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingConfirm(null);
            }}
          >
            やめる
          </button>
        </div>
      ) : null}
    </main>
  );
}
