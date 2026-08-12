/**
 * シェル下ナビ等、route 外の遷移から planner の flush を await するための登録口。
 * planner-route が mount 中だけ handler を置き、AppShell / ホーム Link 等は leave 時にこれを呼ぶ。
 * settings / privacy / emergency と同型で失敗を route 側 submissionError に載せる。
 * unmount best-effort enqueue の握りつぶしだけでは黙殺されるため、明示 leave はここを通す。
 *
 * P1: 下ナビ以外の SPA 離脱（ホームの冷蔵庫/直近献立、Plus リンク等）も同一口を使う。
 * P2: route は mount 時にだけ register し、handler 本体は ref 経由で最新状態を読む
 * （effect deps 更新のたび null 再登録する窓を作らない）。
 */

export type PlannerLeaveFlushResult = "proceed" | "blocked";

export type PlannerLeaveFlushHandler = () => Promise<PlannerLeaveFlushResult>;

let leaveFlushHandler: PlannerLeaveFlushHandler | null = null;

/** planner-route が mount/unmount で登録・解除する。同時 mount は想定しない（単一 /planner）。 */
export function registerPlannerLeaveFlush(handler: PlannerLeaveFlushHandler | null): void {
  leaveFlushHandler = handler;
}

/**
 * シェル NavLink 等から呼ぶ。handler 未登録（/planner 外）は proceed。
 * blocked 時は呼び出し側が navigate せず、route がエラーを可視化する。
 *
 * P2: module 単位の single-flight。shell `navLeavingRef` と
 * `navigateAfterLeaveInFlight` は入口ごとに分かれていたため、下ナビ×ホーム直近献立の
 * 同時 click で handler が二重起動し、別 to へ last-writer navigate し得た。
 * 先行 flight 中の後続は handler を呼ばず "blocked"（先行 to のみ proceed 可能）。
 */
let leaveFlushInFlight: Promise<PlannerLeaveFlushResult> | null = null;

export async function runPlannerLeaveFlush(): Promise<PlannerLeaveFlushResult> {
  if (leaveFlushInFlight !== null) {
    return "blocked";
  }
  const handler = leaveFlushHandler;
  if (handler === null) return "proceed";
  const flight = handler().finally(() => {
    if (leaveFlushInFlight === flight) {
      leaveFlushInFlight = null;
    }
  });
  leaveFlushInFlight = flight;
  return flight;
}

/**
 * SPA Link の left-click を leave-flush 付き遷移に差し替えるか。
 * 修飾キー・中クリック・既に preventDefault 済みは既定の新規タブ等を妨げない。
 */
export function shouldInterceptPlannerLeaveClick(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
  return true;
}

/**
 * leave-flush 成功後だけ navigate する。blocked 時は stay（route が submissionError）。
 * 呼び出し側は onClick で preventDefault 済みであること。
 *
 * P6: シェル下ナビの navLeavingRef と同型の single-flight。
 * ホーム直近献立・冷蔵庫・再開 CTA・review Plus の連打で flush 並列・先 proceed の to 上書きを防ぐ。
 * 連打の 2 回目以降は先行 flight 完了まで無視（先行 to を優先）。
 */
let navigateAfterLeaveInFlight = false;

export async function navigateAfterPlannerLeaveFlush(
  // React Router の NavigateFunction は void | Promise<void> を返すため、
  // void 固定にすると no-misused-promises が呼び出し側で発火する。
  navigate: (to: string) => void | Promise<void>,
  to: string,
): Promise<void> {
  if (navigateAfterLeaveInFlight) return;
  navigateAfterLeaveInFlight = true;
  try {
    const result = await runPlannerLeaveFlush();
    if (result === "proceed") {
      await navigate(to);
    }
  } finally {
    navigateAfterLeaveInFlight = false;
  }
}

/** テスト用: single-flight フラグを解除する（register null と併用）。 */
export function resetPlannerLeaveNavigateFlightForTests(): void {
  navigateAfterLeaveInFlight = false;
  leaveFlushInFlight = null;
}
