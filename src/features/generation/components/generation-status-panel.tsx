import { getNextJstMidnight } from "@shared/time/jst";
import type { GenerationClientState } from "../model/generation-machine";
import { useUsageToday } from "../hooks/use-usage-today";
import { clearPendingGeneration } from "../model/pending-generation";

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

/**
 * 終端（failed / constraint_conflict）からの復帰導線。
 * 「条件を直してやり直す」は onClear（pending+machine）で idle→/planner。
 * 緊急献立・履歴は pending のみ消す（machine を idle にすると GenerationPage の
 * Navigate と <a href> が競合するため）。
 */
function RecoveryLinks({ onClear }: { onClear?: () => void }) {
  return (
    <div className="gen-status-actions">
      {onClear !== undefined ? (
        <button type="button" className="button-link" onClick={onClear}>
          条件を直してやり直す
        </button>
      ) : (
        <a
          className="button-link"
          href="/planner"
          onClick={() => {
            clearPendingGeneration();
          }}
        >
          条件を直してやり直す
        </a>
      )}
      <a
        className="button-link"
        href="/emergency-menus"
        onClick={() => {
          clearPendingGeneration();
        }}
      >
        15分緊急献立を見る
      </a>
      <a
        className="button-link"
        href="/history"
        onClick={() => {
          clearPendingGeneration();
        }}
      >
        作った献立を見る
      </a>
    </div>
  );
}

export function GenerationStatusPanel({
  state,
  userId,
  onClear,
}: {
  state: GenerationClientState;
  userId?: string;
  /** request_conflict から idle へ戻し、planner 再入力へ進ませる */
  onClear?: () => void;
}) {
  if (state.phase === "checking") {
    return (
      <div className="gen-status-panel" data-phase="checking">
        <div className="gen-status-indicator" aria-hidden="true" />
        <p role="status" aria-live="polite">
          保存した作成状況を確認しています
        </p>
      </div>
    );
  }
  if (state.phase === "submitting") {
    return (
      <div className="gen-status-panel" data-phase="submitting">
        <div className="gen-status-indicator" aria-hidden="true" />
        <p role="status" aria-live="polite">
          条件を確認しています
        </p>
      </div>
    );
  }
  if (state.phase === "processing") {
    return (
      <div className="gen-status-panel" data-phase="processing">
        <div className="gen-status-indicator" aria-hidden="true" />
        <h1>献立を作っています</h1>
        <p role="status" aria-live="polite">
          料理の組み合わせと全体の段取りを確認しています
        </p>
        <p>この画面を閉じても、同じ作成IDであとから確認できます。</p>
      </div>
    );
  }
  if (state.phase === "offline") {
    return (
      <div className="gen-status-panel" data-phase="offline">
        <div className="gen-status-indicator" aria-hidden="true" />
        <h1>通信を確認しています</h1>
        <p>接続が戻ると、保存した作成IDから自動で確認します。</p>
      </div>
    );
  }
  if (state.phase === "constraint_conflict") {
    return (
      <div className="gen-status-panel" data-phase="constraint_conflict">
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
        {/* exactOptionalPropertyTypes: undefined を明示渡ししない */}
        <RecoveryLinks {...(onClear === undefined ? {} : { onClear })} />
      </div>
    );
  }
  if (state.phase === "failed") {
    return (
      <div className="gen-status-panel" data-phase="failed">
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
        <RecoveryLinks {...(onClear === undefined ? {} : { onClear })} />
      </div>
    );
  }
  if (state.phase === "request_conflict") {
    return (
      <div className="gen-status-panel" data-phase="request_conflict">
        <h1>同じ操作を続けられませんでした</h1>
        <p>{state.message}</p>
        {userId !== undefined ? <TerminalGenerationUsage userId={userId} /> : null}
        <div className="gen-status-actions">
          {onClear !== undefined ? (
            <button type="button" className="button-link" onClick={onClear}>
              最初からやり直す
            </button>
          ) : (
            <a className="button-link" href="/planner">
              最初からやり直す
            </a>
          )}
          <a className="button-link" href="/emergency-menus">
            15分緊急献立を見る
          </a>
        </div>
      </div>
    );
  }
  return null;
}
