import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { Stack } from "@/shared/ui/stack";
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
// U4 修正ラウンド1: GenerationStatusPanel は「条件を直してやり直す」と
// 「最初からやり直す」の両方を同じ onClear で呼ぶため、どちらが押されたかは
// onClear(options) の resumeReview で判別する。clearGeneration() は
// localStorage の pending を同期的に消してしまうので、消える前（クリック時点）
// に generationReturnPath を options 付きで再計算して returnPathRef へ確定させる。
// レンダー中の再計算（下の if ブロック）は pending が残っている間だけ走る
// 「素の戻り先」の追従用で、resumeReview の有無までは持ち越さない。
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
  // clearGeneration() は pending を同期的に消すため、消える前に options 込みで
  // 戻り先を確定させてから呼ぶ。「条件を直してやり直す」は resumeReview: true、
  // 「最初からやり直す」は options なし（=ホーム着地のまま）で渡ってくる。
  const handleClear = (options?: { resumeReview?: boolean }): void => {
    if (options?.resumeReview === true) {
      const pending = userId !== undefined ? readPendingGeneration(userId, new Date()) : null;
      returnPathRef.current = generationReturnPath(pending, { resumeReview: true });
    }
    recovery.clearGeneration();
  };
  return (
    <main className="page-frame">
      <Stack gap={5}>
        {showResumedNotice ? (
          <section className="generation-resume-notice" role="status" aria-live="polite">
            <strong className="generation-resume-notice-title">進行中の作成を再開しています</strong>
            <p className="generation-resume-notice-body">
              すでに作成中の献立があるため、いま選んだ条件では新しく作り直していません。途中の作成状況をそのまま続けます。
            </p>
          </section>
        ) : null}
        {userId === undefined ? (
          <GenerationStatusPanel state={recovery.state} onClear={handleClear} />
        ) : (
          <GenerationStatusPanel state={recovery.state} userId={userId} onClear={handleClear} />
        )}
      </Stack>
    </main>
  );
}
