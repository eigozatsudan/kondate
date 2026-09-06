import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/use-auth";
import { householdKeys } from "@/features/household/household-queries";
import { LivePendingMain } from "@/shared/ui/feedback";
import { loadWeeklyPlanFormEligibility } from "../weekly-plan-eligibility.js";
import { WeeklyPlanFormPage } from "./weekly-plan-form-page.js";

/** router が直接マウントするコネクタ。accessToken/userId/家族データを内部で取得する。 */
export function WeeklyPlanFormRoute() {
  const session = useAuth().session;
  const userId = session?.user.id;
  const accessToken = session?.access_token;
  const query = useQuery({
    queryKey: [...householdKeys.members(userId ?? "missing"), "weekly-plan-eligibility"],
    queryFn: () => loadWeeklyPlanFormEligibility(userId ?? ""),
    enabled: userId !== undefined,
  });
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
    <WeeklyPlanFormPage
      accessToken={accessToken}
      userId={userId}
      eligibleMembers={query.data.members}
      unsatisfiableMemberIds={query.data.unsatisfiableMemberIds}
    />
  );
}
