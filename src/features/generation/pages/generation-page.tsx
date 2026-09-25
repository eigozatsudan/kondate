import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { readHistoryIndex } from "@/shared/lib/history-index";
import { useAuth } from "@/features/auth/use-auth";
import { Stack } from "@/shared/ui/stack";
import { GenerationStatusPanel } from "../components/generation-status-panel";
import { useGenerationRecovery } from "../hooks/use-generation-recovery";
import { isGenerationOpenedFromPlanner } from "../model/generation-opened-from-planner";
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
// UX 残り R1 項目 1: 戻り先が素の /planner で、この /generation が planner から push された
// entry（location.state に印がある）なら、idle で `<Navigate replace>` せず 1 つ戻る。
// 置き換えると履歴が [外, /planner, /planner] になり、ホームで戻るが 1 回空振りするため。
// - 印は entry に付くので、sessionStorage の印のような古い印の取り違えが起きない。
// - タブの最初の entry（history.state.idx が 0）では戻る先がアプリの外なので、従来どおり置き換える。
// - 「条件を直してやり直す」（?resume=review）と regenerate_*（/menus/:id）は従来どおり置き換える。
//   前者は置き換えた ?resume=review をマウント時に消費してウィザードを開くので、戻る 1 回目で
//   直前の /planner（ホーム）へ移り、空振りしない。
// - 残る /generation の entry は「進む」の先に残る。進むで着いても idle なら同じくすぐ戻る。
const PLAIN_PLANNER_PATH = "/planner";

/** idle になった /generation から、直前の /planner の entry へ 1 回だけ戻る */
function BackToOpeningPlanner() {
  const navigate = useNavigate();
  // StrictMode の effect の二重実行や、戻りが反映されるまでの再描画で 2 回戻らないようにする
  const wentBackRef = useRef(false);
  useEffect(() => {
    if (wentBackRef.current) return;
    wentBackRef.current = true;
    void navigate(-1);
  }, [navigate]);
  return <p role="status">読み込んでいます</p>;
}

export function GenerationPage() {
  const recovery = useGenerationRecovery();
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const [searchParams] = useSearchParams();
  const location = useLocation();
  // マウント時の query だけを正とする（replace で消しても案内は残す）
  const [showResumedNotice] = useState(() => searchParams.get("resumed") === "1");
  const [checked, setChecked] = useState(false);
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
  if (!checked) {
    return <p role="status">読み込んでいます</p>;
  }
  if (recovery.state.phase === "idle") {
    const historyIndex = readHistoryIndex();
    if (
      returnPathRef.current === PLAIN_PLANNER_PATH &&
      isGenerationOpenedFromPlanner(location.state) &&
      historyIndex !== 0
    ) {
      return <BackToOpeningPlanner />;
    }
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
