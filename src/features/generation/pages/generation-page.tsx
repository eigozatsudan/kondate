import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { GenerationStatusPanel } from "../components/generation-status-panel";
import { useGenerationRecovery } from "../hooks/use-generation-recovery";

// 献立生成の作成状況を表示する画面。直接の入口ではなく、planner からの生成開始や
// 中断からの復旧（マウント時・オンライン復帰時・認証復帰時）で表示される。
//
// 初回レンダーでは useGenerationRecovery() の phase は常に "idle" から始まり、
// 復旧フック自身の mount effect（localStorage 確認・"recover" dispatch）が
// 走った後で初めて実際の状況を反映する。<Navigate> は自身の effect を子として
// 先に発火させるため、初回レンダーでいきなり idle 判定すると、復旧すべき状況が
// あっても mount effect が確定する前に /planner へ遷移してしまう。そのため
// 1 レンダー分だけ判定を遅らせ、復旧フックの mount effect と同じコミットの
// パッシブエフェクトで checked を true にしてから idle 判定を行う。
//
// 終端画面の AI 通信試行残数は request-local quota ではなく useUsageToday が正。
// session の userId をパネルへ渡さないと本番経路で残数領域が描画されない。
export function GenerationPage() {
  const recovery = useGenerationRecovery();
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setChecked(true);
  }, []);
  if (!checked) {
    return <p role="status">読み込んでいます</p>;
  }
  if (recovery.state.phase === "idle") {
    return <Navigate to="/planner" replace />;
  }
  return (
    <main className="page-frame stack">
      {userId === undefined ? (
        <GenerationStatusPanel state={recovery.state} />
      ) : (
        <GenerationStatusPanel state={recovery.state} userId={userId} />
      )}
    </main>
  );
}
