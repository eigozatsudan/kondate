/**
 * P2: シェル下ナビ等、route 外の遷移から planner の flush を await するための登録口。
 * planner-route が mount 中だけ handler を置き、AppShell は leave 時にこれを呼ぶ。
 * settings / privacy / emergency と同型で失敗を route 側 submissionError に載せる。
 * unmount best-effort enqueue の握りつぶしだけでは黙殺されるため、明示 leave はここを通す。
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
 */
export async function runPlannerLeaveFlush(): Promise<PlannerLeaveFlushResult> {
  const handler = leaveFlushHandler;
  if (handler === null) return "proceed";
  return handler();
}
