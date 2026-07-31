import { formatPlanQuotaCopy } from "@shared/copy/plan-tier";
import type { PlanCode } from "@shared/contracts/plan-quota";
import { getNextJstMidnight } from "@shared/time/jst";
import { PlusHardLimitCta } from "@/features/billing/plus-cta";
import { HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY } from "@/features/planner/household-safety-helper-copy";
import type { GenerationClientState } from "../model/generation-machine";
import { useUsageToday } from "../hooks/use-usage-today";
import { clearPendingGeneration, readPendingGeneration } from "../model/pending-generation";
import { readPendingGenerationMeta } from "../model/pending-generation-meta";

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
 * 個人枠は formatPlanQuotaCopy。Free 硬上限時は L10-1 Plus CTA。
 */
function TerminalGenerationUsage({ userId }: { userId: string }) {
  const usage = useUsageToday(userId);
  if (usage.isPending) return <p role="status">最新の利用状況を確認しています</p>;
  if (!usage.isSuccess) {
    return <p role="alert">本日の作成回数を確認できません。再読み込みしてください</p>;
  }
  const data = usage.data;
  const plan: PlanCode = data.plan;
  const hardLimited =
    plan === "free" && (data.success.remaining === 0 || data.attempts.remaining === 0);
  return (
    <section aria-label="今日あと何回作れるか">
      <p>
        {formatPlanQuotaCopy(
          `本日あと${String(data.success.remaining)}回まで献立の作成を受け付けます`,
          plan,
        )}
      </p>
      {plan === "free" && data.success.remaining === 1 ? (
        <p>本日の無料回数が残り 1 回です</p>
      ) : null}
      <p>アプリ全体：{data.globalAvailable ? "作成できます" : "今日はここまで"}</p>
      {data.shortWindow.retryAt === null ? null : (
        <p>
          {formatPlanQuotaCopy(
            `短い時間に何度も作成を試したため、${formatRetryAt(data.shortWindow.retryAt)}以降に再試行してください。`,
            plan,
          )}
        </p>
      )}
      {hardLimited ? <PlusHardLimitCta /> : null}
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

const QUOTA_FAILURE_CODES = new Set([
  "user_daily_limit",
  "user_attempt_limit",
  "user_short_window_limit",
]);

/**
 * 失敗本文の L16 接頭。userId ありは usage.plan を正（Plus に「無料版は」を付けない）。
 * usage 未取得・失敗時は接頭なしのサーバ文面のまま（誤った Free 接頭を避ける）。
 * userId 無し経路は QueryClient を要求しない（hooks 分割）。
 */
function FailedQuotaMessage({
  code,
  message,
  userId,
}: {
  code: string;
  message: string;
  userId?: string;
}) {
  if (!QUOTA_FAILURE_CODES.has(code)) {
    return <p>{message}</p>;
  }
  if (userId === undefined) {
    return <p>{formatPlanQuotaCopy(message, "free")}</p>;
  }
  return <FailedQuotaMessageWithUsage code={code} message={message} userId={userId} />;
}

function FailedQuotaMessageWithUsage({
  message,
  userId,
}: {
  code: string;
  message: string;
  userId: string;
}) {
  const usage = useUsageToday(userId);
  if (usage.isPending) {
    return <p role="status">{message}</p>;
  }
  if (!usage.isSuccess) {
    return <p>{message}</p>;
  }
  return <p>{formatPlanQuotaCopy(message, usage.data.plan)}</p>;
}

/** 終端の利用残数 + retryAt（request-local または usage）。retryAt はパネル直下に必ず1回。 */
function TerminalQuotaBlock({
  userId,
  remaining,
  retryAt,
  plan = "free",
  showHardLimitCta = false,
}: {
  userId?: string;
  remaining: number;
  retryAt: string | null;
  plan?: PlanCode;
  /** userId 無しフォールバック時の Free 硬上限 CTA（usage が無い経路）。 */
  showHardLimitCta?: boolean;
}) {
  return (
    <>
      {userId !== undefined ? (
        <TerminalGenerationUsage userId={userId} />
      ) : (
        <>
          <p>
            {formatPlanQuotaCopy(
              `本日あと${String(remaining)}回まで献立の作成を受け付けます`,
              plan,
            )}
          </p>
          {showHardLimitCta && plan === "free" && remaining === 0 ? <PlusHardLimitCta /> : null}
        </>
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
        {/* 長時間 processing / ハング時の脱出。pending を捨て条件入力へ戻せる */}
        <p>途中でやめる場合は、下の「条件を直してやり直す」で作成中のIDを破棄できます。</p>
        <RecoveryLinks {...(onClear === undefined ? {} : { onClear })} />
      </div>
    );
  }
  if (state.phase === "offline") {
    return (
      <div className="gen-status-panel" data-phase="offline">
        <div className="gen-status-indicator" aria-hidden="true" />
        <h1>通信を確認しています</h1>
        <p>接続が戻ると、保存した作成IDから自動で確認します。</p>
        {/* 実ネット断以外（API 失敗・長時間 POST）でも offline に落ちる。
            自動復帰だけに頼ると pending 保持で planner 再開がループするため、明示破棄を出す。 */}
        <RecoveryLinks {...(onClear === undefined ? {} : { onClear })} />
      </div>
    );
  }
  if (state.phase === "constraint_conflict") {
    // 設計 §6.2: new_menu × household のみ補助文を conflicts 一覧に対してちょうど1回。
    // idea / regenerate_* / pending・meta 欠落・key 不一致は出さない（reload 後も pending TTL 内なら可）。
    const now = new Date();
    const pending = userId === undefined ? null : readPendingGeneration(userId, now);
    const meta =
      userId === undefined || pending === null ? null : readPendingGenerationMeta(userId, now);
    const showHouseholdHelper =
      pending !== null &&
      meta !== null &&
      meta.idempotencyKey === pending.request.idempotencyKey &&
      pending.kind === "new_menu" &&
      meta.targetMode === "household";
    return (
      <div className="gen-status-panel" data-phase="constraint_conflict">
        <h1>条件を同時に満たせませんでした</h1>
        {state.data.conflicts.map((item) => (
          <p key={`${item.code}-${item.conditionRefs.join()}`}>{item.message}</p>
        ))}
        {showHouseholdHelper ? <p>{HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY}</p> : null}
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
    const hardLimitFailure =
      state.data.error.code === "user_daily_limit" ||
      state.data.error.code === "user_attempt_limit";
    return (
      <div className="gen-status-panel" data-phase="failed">
        <h1>献立を作成できませんでした</h1>
        <FailedQuotaMessage
          code={state.data.error.code}
          message={state.data.error.message}
          {...(userId === undefined ? {} : { userId })}
        />
        <NotConsumedNotice consumed={state.data.quota.consumed} />
        <TerminalQuotaBlock
          {...(userId === undefined ? {} : { userId })}
          remaining={state.data.quota.remaining}
          retryAt={state.data.quota.retryAt}
          showHardLimitCta={hardLimitFailure}
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
  // succeeded: navigate 完了〜結果取得までの空白を埋める。
  // return null だとスピナーが消え、/menus/:id の isPending まで画面が空になる。
  if (state.phase === "succeeded") {
    return (
      <div className="gen-status-panel" data-phase="succeeded">
        <div className="gen-status-indicator" aria-hidden="true" />
        <p role="status" aria-live="polite">
          献立を表示しています
        </p>
      </div>
    );
  }
  return null;
}
