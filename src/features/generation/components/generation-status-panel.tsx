import { getNextJstMidnight } from "@shared/time/jst";
import type { GenerationClientState } from "../model/generation-machine";
import { useUsageToday } from "../hooks/use-usage-today";

// 本日分の成功回数上限に伴う retryAt は JST 日次リセット（翌0:00）に一致するため、
// 生の日時ではなく「明日H:MM」の相対表現で示す。
function formatJstRetryTime(retryAt: string, now: Date): string {
  const retryDate = new Date(retryAt);
  const hour = String((retryDate.getUTCHours() + 9) % 24);
  const minute = String(retryDate.getUTCMinutes()).padStart(2, "0");
  const isTomorrow = retryAt === getNextJstMidnight(now).toISOString();
  return isTomorrow ? `明日${hour}:${minute}` : `${hour}:${minute}`;
}

function formatRetryAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

/** 終端画面専用。request-local quota を attempt 真相として再解釈しない。 */
function TerminalGenerationUsage({ userId }: { userId: string }) {
  const usage = useUsageToday(userId);
  if (usage.isPending) return <p role="status">最新の利用状況を確認しています</p>;
  if (!usage.isSuccess) {
    return <p role="alert">最新のAI通信試行残数を確認できません。再読み込みしてください</p>;
  }
  const data = usage.data;
  return (
    <section aria-label="今日あと何回作れるか">
      <p>成功回数：本日あと{data.success.remaining}回</p>
      <p>AI通信試行：本日あと{data.attempts.remaining}回</p>
      <p>10分間の通信試行：あと{data.shortWindow.remaining}回</p>
      <p>アプリ全体：{data.globalAvailable ? "作成できます" : "今日はここまで"}</p>
      {data.shortWindow.retryAt === null ? null : (
        <p>10分枠の再開：{formatRetryAt(data.shortWindow.retryAt)}</p>
      )}
      {data.retryAt === null ? null : <p>現在の受付再開：{formatRetryAt(data.retryAt)}</p>}
    </section>
  );
}

export function GenerationStatusPanel({
  state,
  userId,
}: {
  state: GenerationClientState;
  userId?: string;
}) {
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
        {!state.data.quota.consumed && <p>成功回数には含まれません</p>}
        {userId !== undefined ? (
          <TerminalGenerationUsage userId={userId} />
        ) : (
          <p>成功回数：本日あと{state.data.quota.remaining}回</p>
        )}
      </>
    );
  }
  if (state.phase === "failed") {
    return (
      <>
        <h1>献立を作成できませんでした</h1>
        <p>{state.data.error.message}</p>
        {!state.data.quota.consumed && <p>成功回数には含まれません</p>}
        {userId !== undefined ? (
          <TerminalGenerationUsage userId={userId} />
        ) : (
          <>
            <p>成功回数：本日あと{state.data.quota.remaining}回</p>
            {state.data.quota.retryAt !== null && (
              <p>再開: {formatJstRetryTime(state.data.quota.retryAt, new Date())}</p>
            )}
          </>
        )}
        <a className="button-link" href="/emergency-menus">
          15分緊急献立を見る
        </a>
        <a className="button-link" href="/history">
          作った献立を見る
        </a>
      </>
    );
  }
  return null;
}
