import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router";
import { z } from "zod";
import { useAuth } from "@/features/auth/use-auth";
import { householdKeys } from "@/features/household/household-queries";
import { LivePendingMain } from "@/shared/ui/feedback";
import { loadCurrentCompleteMemberIds } from "../weekly-plan-eligibility.js";
import { WeeklyPlanResultPage } from "./weekly-plan-result-page.js";

/**
 * router が直接マウントするコネクタ。accessToken/userId/currentCompleteMemberIds を
 * 内部で取得する。weeklyPlanId は uuid 検証し、不正な id は /planner へ戻す
 * （検証しないまま WeeklyPlanResultPage へ渡すと空 id で永久に読み込み中表示になる — Task13 申し送り）。
 */
export function WeeklyPlanResultRoute() {
  const session = useAuth().session;
  const userId = session?.user.id;
  const accessToken = session?.access_token;
  const parsed = z.uuid().safeParse(useParams().weeklyPlanId);
  const weeklyPlanId = parsed.success ? parsed.data : null;
  const query = useQuery({
    queryKey: [...householdKeys.members(userId ?? "missing"), "weekly-plan-complete-ids"],
    queryFn: () => loadCurrentCompleteMemberIds(userId ?? ""),
    enabled: userId !== undefined,
  });
  if (weeklyPlanId === null) {
    return <Navigate to="/planner" replace />;
  }
  if (userId === undefined || accessToken === undefined || query.isPending) {
    return <LivePendingMain message="読み込んでいます…" />;
  }
  if (query.isError) {
    return (
      <main className="page-frame">
        <p role="alert">家族情報を読み込めませんでした。</p>
      </main>
    );
  }
  return (
    <WeeklyPlanResultPage
      accessToken={accessToken}
      weeklyPlanId={weeklyPlanId}
      userId={userId}
      currentCompleteMemberIds={query.data}
    />
  );
}
