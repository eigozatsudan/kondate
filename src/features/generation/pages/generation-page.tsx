import { Navigate } from "react-router";
import { GenerationStatusPanel } from "../components/generation-status-panel";
import { useGenerationRecovery } from "../hooks/use-generation-recovery";

// 献立生成の作成状況を表示する画面。直接の入口ではなく、planner からの生成開始や
// 中断からの復旧（マウント時・オンライン復帰時・認証復帰時）で表示される。
export function GenerationPage() {
  const recovery = useGenerationRecovery();
  if (recovery.state.phase === "idle") {
    return <Navigate to="/planner" replace />;
  }
  return (
    <main className="page-frame stack">
      <GenerationStatusPanel state={recovery.state} />
    </main>
  );
}
