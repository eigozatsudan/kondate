import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { getProfile, type ProfileRow } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { useProfilePendingDeadline } from "@/features/household/use-profile-pending-deadline";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { useAuth } from "./use-auth";

function RetryableProfileAlert({ profileQuery }: { profileQuery: UseQueryResult<ProfileRow> }) {
  return (
    <main className="page-frame">
      <p className="error-message" role="alert">
        初回設定の状態を確認できませんでした。通信を確認して再読み込みしてください。
      </p>
      <button
        className="secondary-button min-h-11"
        type="button"
        onClick={() => {
          void profileQuery.refetch();
        }}
      >
        再読み込み
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
    // L10: 待ち UI は SR に busy/live を通知
    return (
      <main className="page-frame" aria-busy="true" aria-live="polite">
        状態を確認しています…
      </main>
    );
  }

  if (profileQuery.isError || pendingTimedOut) {
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
