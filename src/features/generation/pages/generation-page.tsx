import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { GenerationStatusPanel } from "../components/generation-status-panel";
import { useGenerationRecovery } from "../hooks/use-generation-recovery";
import { generationReturnPath } from "../model/generation-return-path";
import { readPendingGeneration } from "../model/pending-generation";

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
// idle の戻り先は pending の kind で決める（new_menu→/planner、regenerate_*→
// /menus/:sourceMenuId）。clear で pending が消えたあとも直前の戻り先を
// 使うため ref に保持する。menus からの一品再生成失敗後に planner へ落ちると
// 下書き文脈がなく操作不能になる。
//
// 終端画面の AI 通信試行残数は request-local quota ではなく useUsageToday が正。
// session の userId をパネルへ渡さないと本番経路で残数領域が描画されない。
// 緊急献立 RecoveryLinks は idea/household とも常時表示のため targetMode を渡さない。
export function GenerationPage() {
  const recovery = useGenerationRecovery();
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const [searchParams] = useSearchParams();
  // マウント時の query だけを正とする（replace で消しても案内は残す）
  const [showResumedNotice] = useState(() => searchParams.get("resumed") === "1");
  const [checked, setChecked] = useState(false);
  // clear 後も idle 遷移先を保持する（pending は clear で先に消える）
  const returnPathRef = useRef("/planner");
  if (userId !== undefined) {
    const pending = readPendingGeneration(userId, new Date());
    if (pending !== null) {
      returnPathRef.current = generationReturnPath(pending);
    }
  }
  useEffect(() => {
    setChecked(true);
  }, []);
  if (!checked) {
    return <p role="status">読み込んでいます</p>;
  }
  if (recovery.state.phase === "idle") {
    return <Navigate to={returnPathRef.current} replace />;
  }
  return (
    <main className="page-frame stack">
      {showResumedNotice ? (
        <section className="generation-resume-notice" role="status" aria-live="polite">
          <strong className="generation-resume-notice-title">進行中の作成を再開しています</strong>
          <p className="generation-resume-notice-body">
            すでに作成中の献立があるため、いま入力した条件では新しく作り直していません。途中の作成状況をそのまま続けます。
          </p>
        </section>
      ) : null}
      {userId === undefined ? (
        <GenerationStatusPanel
          state={recovery.state}
          onClear={() => {
            recovery.clearGeneration();
          }}
        />
      ) : (
        <GenerationStatusPanel
          state={recovery.state}
          userId={userId}
          onClear={() => {
            recovery.clearGeneration();
          }}
        />
      )}
    </main>
  );
}
