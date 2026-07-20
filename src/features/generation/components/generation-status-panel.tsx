import { getNextJstMidnight } from "@shared/time/jst";
import type { GenerationClientState } from "../model/generation-machine";

// 本日分の成功回数上限に伴う retryAt は JST 日次リセット（翌0:00）に一致するため、
// 生の日時ではなく「明日H:MM」の相対表現で示す。
function formatJstRetryTime(retryAt: string, now: Date): string {
  const retryDate = new Date(retryAt);
  const hour = String((retryDate.getUTCHours() + 9) % 24);
  const minute = String(retryDate.getUTCMinutes()).padStart(2, "0");
  const isTomorrow = retryAt === getNextJstMidnight(now).toISOString();
  return isTomorrow ? `明日${hour}:${minute}` : `${hour}:${minute}`;
}

export function GenerationStatusPanel({ state }: { state: GenerationClientState }) {
  if (state.phase === "checking") {
    return <p role="status">保存した作成状況を確認しています</p>;
  }
  if (state.phase === "submitting") {
    return <p role="status">条件を確認しています</p>;
  }
  if (state.phase === "processing") {
    return (
      <>
        <h1>献立を作っています</h1>
        <p role="status">料理の組み合わせと全体の段取りを確認しています</p>
        <p>この画面を閉じても、同じ作成IDであとから確認できます。</p>
      </>
    );
  }
  if (state.phase === "offline") {
    return (
      <>
        <h1>通信を確認しています</h1>
        <p>接続が戻ると、保存した作成IDから自動で確認します。</p>
      </>
    );
  }
  if (state.phase === "constraint_conflict") {
    return (
      <>
        <h1>条件を同時に満たせませんでした</h1>
        {state.data.conflicts.map((item) => (
          <p key={`${item.code}-${item.conditionRefs.join()}`}>{item.message}</p>
        ))}
        <p>成功回数には含まれません</p>
        <p>成功回数：本日あと{state.data.quota.remaining}回</p>
      </>
    );
  }
  if (state.phase === "failed") {
    return (
      <>
        <h1>献立を作成できませんでした</h1>
        <p>{state.data.error.message}</p>
        {!state.data.quota.consumed && <p>成功回数には含まれません</p>}
        <p>成功回数：本日あと{state.data.quota.remaining}回</p>
        {state.data.quota.retryAt !== null && (
          <p>再開: {formatJstRetryTime(state.data.quota.retryAt, new Date())}</p>
        )}
        <a className="button-link" href="/emergency-menus">
          15分緊急献立を見る
        </a>
        <a className="button-link" href="/history">
          履歴・お気に入りを見る
        </a>
      </>
    );
  }
  return null;
}
