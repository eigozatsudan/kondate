import { formatFreeTierQuotaCopy } from "@shared/copy/free-tier";
import { getNextJstMidnight } from "@shared/time/jst";
import type { GenerationClientState } from "../model/generation-machine";
import { useUsageToday } from "../hooks/use-usage-today";
import { clearPendingGeneration } from "../model/pending-generation";

// 本日分の作成上限に伴う retryAt は JST 日次リセット（翌0:00）に一致するため、
// 生の日時ではなく「明日H:MM」の相対表現で示す。
// サーバは timestamptz→jsonb で "+00:00" を出し、クライアント toISOString は ".000Z"。
// 文字列一致ではなく epoch ms で比較する（E-I1）。
function formatJstRetryTime(retryAt: string, now: Date): string {
  const retryDate = new Date(retryAt);
  const hour = String((retryDate.getUTCHours() + 9) % 24);
  const minute = String(retryDate.getUTCMinutes()).padStart(2, "0");
  const isTomorrow = retryDate.getTime() === getNextJstMidnight(now).getTime();
  return isTomorrow ? `明日${hour}:${minute}` : `${hour}:${minute}`;
}

function formatRetryAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * 終端画面専用。request-local quota を attempt 真相として再解釈しない。
 * 設計 2026-07-29: success 残1行のみ。AI通信試行・10分残数行は出さない。
 * data.retryAt はパネル直下の quota.retryAt に一本化するためここでは出さない。
 */
function TerminalGenerationUsage({ userId }: { userId: string }) {
  const usage = useUsageToday(userId);
  if (usage.isPending) return <p role="status">最新の利用状況を確認しています</p>;
  if (!usage.isSuccess) {
    return <p role="alert">本日の作成回数を確認できません。再読み込みしてください</p>;
  }
  const data = usage.data;
  return (
    <section aria-label="今日あと何回作れるか">
      <p>
        {formatFreeTierQuotaCopy(
          `本日あと${String(data.success.remaining)}回まで献立の作成を受け付けます`,
        )}
      </p>
      <p>アプリ全体：{data.globalAvailable ? "作成できます" : "今日はここまで"}</p>
      {data.shortWindow.retryAt === null ? null : (
        <p>
          {formatFreeTierQuotaCopy(
            `短い時間に何度も作成を試したため、${formatRetryAt(data.shortWindow.retryAt)}以降に再試行してください。`,
          )}
        </p>
      )}
    </section>
  );
}

/**
 * 終端（failed / constraint_conflict）からの復帰導線。
 * 「条件を直してやり直す」は onClear（pending+machine）で idle へ。
 * idle の遷移先は GenerationPage が pending.kind から決める
 * （new_menu→/planner、regenerate_*→/menus/:sourceMenuId）。
 * 緊急献立・履歴は pending のみ消す（machine を idle にすると GenerationPage の
 * Navigate と <a href> が競合するため）。
 * 緊急献立 CTA は household / idea とも常時表示（2026-07-28 設計: idea 個人固定候補パス）。
 */
function RecoveryLinks({ onClear }: { onClear?: () => void }) {
  // idea / household とも個人向け緊急献立へ誘導する（targetMode で gate しない）。
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

/** 未消費時の共通1行（message 本文に埋め込まない。設計 L 未減 UI）。 */
function NotConsumedNotice({ consumed }: { consumed: boolean }) {
  if (consumed) return null;
  return <p>献立は完成していないので、作成回数は減っていません</p>;
}

/** 終端の利用残数 + retryAt（request-local または usage）。retryAt はパネル直下に必ず1回。 */
function TerminalQuotaBlock({
  userId,
  remaining,
  retryAt,
}: {
  userId?: string;
  remaining: number;
  retryAt: string | null;
}) {
  return (
    <>
      {userId !== undefined ? (
        <TerminalGenerationUsage userId={userId} />
      ) : (
        <p>
          {formatFreeTierQuotaCopy(`本日あと${String(remaining)}回まで献立の作成を受け付けます`)}
        </p>
      )}
      {retryAt !== null ? <p>再開: {formatJstRetryTime(retryAt, new Date())}</p> : null}
    </>
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
        <NotConsumedNotice consumed={state.data.quota.consumed} />
        <TerminalQuotaBlock
          {...(userId === undefined ? {} : { userId })}
          remaining={state.data.quota.remaining}
          retryAt={state.data.quota.retryAt}
        />
        <RecoveryLinks {...(onClear === undefined ? {} : { onClear })} />
      </div>
    );
  }
  if (state.phase === "failed") {
    const quotaFailureCodes = new Set([
      "user_daily_limit",
      "user_attempt_limit",
      "user_short_window_limit",
    ]);
    const failureMessage = quotaFailureCodes.has(state.data.error.code)
      ? formatFreeTierQuotaCopy(state.data.error.message)
      : state.data.error.message;
    return (
      <div className="gen-status-panel" data-phase="failed">
        <h1>献立を作成できませんでした</h1>
        <p>{failureMessage}</p>
        <NotConsumedNotice consumed={state.data.quota.consumed} />
        <TerminalQuotaBlock
          {...(userId === undefined ? {} : { userId })}
          remaining={state.data.quota.remaining}
          retryAt={state.data.quota.retryAt}
        />
        <RecoveryLinks {...(onClear === undefined ? {} : { onClear })} />
      </div>
    );
  }
  if (state.phase === "request_conflict") {
    // RecoveryLinks と同様、idea でも個人向け緊急献立リンクを出す（2 箇所目）。
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
