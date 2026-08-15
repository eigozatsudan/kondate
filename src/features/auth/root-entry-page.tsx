import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { getProfile, type ProfileRow } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { useProfilePendingDeadline } from "@/features/household/use-profile-pending-deadline";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { LivePendingMain } from "@/shared/ui/feedback";
import { useAuth } from "./use-auth";

function RetryableProfileAlert({ profileQuery }: { profileQuery: UseQueryResult<ProfileRow> }) {
  return (
    <main className="page-frame">
      {/* L8: AppShell 外の失敗面。見出しランドマークを欠かさない。 */}
      <h1>初回設定を確認できませんでした</h1>
      <p className="error-message" role="alert">
        初回設定の状態を確認できませんでした。通信を確認して再試行してください。
      </p>
      {/* L7: refetch なので LP timeout の「再読み込み」(location.reload) とラベルを揃えない。 */}
      <button
        className="secondary-button min-h-11"
        type="button"
        onClick={() => {
          void profileQuery.refetch();
        }}
      >
        再試行
      </button>
    </main>
  );
}

// "/" は常に RootEntryPage を経由し、profile の onboarding_status だけを
// 唯一の判定材料として /welcome または /planner へ振り分ける。
// query error や profile row 欠損を not_started へ推測変換すると、通信不安定な利用者を
// 誤って初期状態へ押し戻してしまうため、成功した row を得たときだけ redirect する。
export function RootEntryPage() {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const profileQuery = useQuery({
    queryKey: householdKeys.profile(userId ?? "none"),
    queryFn: () => {
      if (userId === undefined) throw new Error("ログインが必要です");
      return getProfile(getBrowserSupabaseClient(), userId);
    },
    enabled: userId !== undefined,
  });
  // L2: profile hang は isError にならない。auth C5 と同尺で pending を打ち切り再試行 UI へ。
  const { showPending, pendingTimedOut } = useProfilePendingDeadline(profileQuery.isPending);

  if (showPending) {
    // L10: 待ち UI は SR に busy/status を通知（初期 live は mount 後に埋める）
    // L8: AppShell 外のためシェルの遷移後 h1 フォーカスが無い。待ち面にも見出しを置く。
    return <LivePendingMain heading="初回設定を読み込んでいます" message="状態を確認しています…" />;
  }

  // L3: refetch error で成功 data が残るときは cached status で振り分ける。
  // 初回失敗（data なし）と pending timeout だけ alert。planner の fatal と同型。
  if ((profileQuery.isError && profileQuery.data === undefined) || pendingTimedOut) {
    return <RetryableProfileAlert profileQuery={profileQuery} />;
  }

  // getProfile は行欠損時に例外を投げ isError へ現れる契約であり、型上は
  // ここで data は必ず定義済みになるが、モック環境や将来のクエリ実装差異で
  // status が想定外に振れた場合でも not_started へ推測変換しないよう防御する。
  if (profileQuery.data == null) {
    return <RetryableProfileAlert profileQuery={profileQuery} />;
  }

  const { onboarding_status } = profileQuery.data;
  // L7: 既知 terminal のみ planner。未知値は planner へ fail-open せず welcome へ
  // （Welcome は complete/skipped 以外を操作 UI として扱う契約と対称）。
  if (onboarding_status === "complete" || onboarding_status === "skipped") {
    return <Navigate to="/planner" replace />;
  }
  // not_started / in_progress / 未知値 → welcome（本編を開かない fail-closed）
  return <Navigate to="/welcome" replace />;
}
