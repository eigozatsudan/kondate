import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { Stack } from "@/shared/ui/stack";
import { GenerationStatusPanel } from "../components/generation-status-panel";
import { useGenerationRecovery } from "../hooks/use-generation-recovery";
import {
  claimGenerationPlannerEntry,
  isGenerationPlannerEntry,
} from "../model/generation-planner-entry";
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
// idle の戻り先は pending の kind で決める（new_menu→/planner か
// /planner?resume=review、regenerate_*→/menus/:sourceMenuId）。clear で
// pending が消えたあとも直前の戻り先を使うため ref に保持する。menus からの
// 一品再生成失敗後に planner へ落ちると下書き文脈がなく操作不能になる。
//
// U4 修正ラウンド1/2: GenerationStatusPanel は「条件を直してやり直す」と
// 「最初からやり直す」の両方を同じ onClear で呼ぶため、どちらが押されたかは
// onClear(options) の resumeReview で判別する。
// ラウンド1では resumeReview 時に readPendingGeneration を呼び直して
// generationReturnPath を再計算していたが、業務エラーの合成 failed や
// 別タブ clear は失敗画面が出る前に pending をすでに消しており（
// use-generation-recovery.ts の clearPendingGeneration 呼び出し箇所）、
// この経路では regenerate_* の pending も null に見えてしまい、
// 「条件を直してやり直す」で /menus/:id ではなく /planner?resume=review に
// 誤って上書きされる回帰があった（regenerate_dish / regenerate_menu の
// 業務エラー失敗）。
// ラウンド2はこれを直し、pending を読み直さず「今の returnPathRef が
// 素の /planner（＝new_menu 系）かどうか」だけで判定する。regenerate_*
// （returnPathRef が /menus/:id）はそのボタンでは一切変えない。
//
// 終端画面の AI 通信試行残数は request-local quota ではなく useUsageToday が正。
// session の userId をパネルへ渡さないと本番経路で残数領域が描画されない。
// 緊急献立 RecoveryLinks は idea/household とも常時表示のため targetMode を渡さない。
//
// B-3 修正（C-1/I-1）: planner から push で開いた /generation（generation-planner-entry の印）
// が idle で素の /planner へ戻るときは、置き換えではなく 1 つ戻る。結果画面から端末の戻るで
// ここへ来たときに /planner を重複させず、次の戻るが空振りしないようにするため。
// review 付き（「条件を直してやり直す」）や /menus/:id への戻りは従来どおり置き換える。
const PLAIN_PLANNER_PATH = "/planner";

export function GenerationPage() {
  const recovery = useGenerationRecovery();
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const [searchParams] = useSearchParams();
  // マウント時の query だけを正とする（replace で消しても案内は残す）
  const [showResumedNotice] = useState(() => searchParams.get("resumed") === "1");
  const [checked, setChecked] = useState(false);
  const locationKey = useLocation().key;
  const navigate = useNavigate();
  const [openedFromPlanner] = useState(() => {
    claimGenerationPlannerEntry(locationKey);
    return isGenerationPlannerEntry(locationKey);
  });
  const leftToPlannerEntryRef = useRef(false);
  // clear 後も idle 遷移先を保持する（pending は clear で先に消える）
  const returnPathRef = useRef(PLAIN_PLANNER_PATH);
  if (userId !== undefined) {
    const pending = readPendingGeneration(userId, new Date());
    if (pending !== null) {
      returnPathRef.current = generationReturnPath(pending);
    }
  }
  useEffect(() => {
    setChecked(true);
  }, []);
  const backToPlannerEntry =
    checked &&
    recovery.state.phase === "idle" &&
    openedFromPlanner &&
    returnPathRef.current === PLAIN_PLANNER_PATH;
  useEffect(() => {
    if (!backToPlannerEntry || leftToPlannerEntryRef.current) return;
    // StrictMode の effect 二重実行でも 1 回だけ戻る
    leftToPlannerEntryRef.current = true;
    void navigate(-1);
  }, [backToPlannerEntry, navigate]);
  if (!checked) {
    return <p role="status">読み込んでいます</p>;
  }
  if (backToPlannerEntry) {
    return <p role="status">読み込んでいます</p>;
  }
  if (recovery.state.phase === "idle") {
    return <Navigate to={returnPathRef.current} replace />;
  }
  // clearGeneration() は pending を同期的に消すため、消える前に options を見て
  // 戻り先を決める。pending を読み直さず、今の returnPathRef が素の /planner
  // （＝ new_menu 系）のときだけ resume=review を足す。regenerate_*（
  // /menus/:id）は options に関わらずそのまま。「条件を直してやり直す」は
  // resumeReview: true、「最初からやり直す」は options なし（=ホーム着地の
  // まま）で渡ってくる。
  const handleClear = (options?: { resumeReview?: boolean }): void => {
    if (options?.resumeReview === true && returnPathRef.current === PLAIN_PLANNER_PATH) {
      returnPathRef.current = generationReturnPath(null, { resumeReview: true });
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
