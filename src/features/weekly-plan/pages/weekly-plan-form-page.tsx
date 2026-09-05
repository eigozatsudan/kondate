import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { cuisineGenres } from "@shared/contracts/domain";
import { budgetPreferences, noveltyPreferences } from "@shared/contracts/planner";
import {
  WEEKLY_PLAN_QUOTA_COPY_LABEL,
  weeklyPlanRequestSchema,
  weeklyPlanIssueMessages,
  type WeeklyPlanRequest,
} from "@shared/contracts/weekly-plan";
import { GenerationProgressMeter } from "@/features/generation/components/generation-status-panel";
import { useGenerationProgressMessage } from "@/features/generation/hooks/use-generation-progress-message";
import { GENERATION_IN_PROGRESS_RETRY_MS } from "@/features/generation/hooks/use-generation-recovery";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import { AudienceStep, type AudienceValue } from "@/features/planner/components/audience-step";
import {
  cuisineGenreLabels,
  noveltyPreferenceLabels,
} from "@/features/planner/model/planner-labels";
import type { PlannerSafetyMember } from "@/features/planner/planner-safety-member";
import { Button } from "@/shared/ui/button";
import { useCreateWeeklyPlan } from "../hooks/use-weekly-plan";
import { WeeklyPlanApiError } from "../weekly-plan-api";
import { useLatestWeeklyPlan } from "../weekly-plan-latest";

const STICKY_KEY_STORAGE = "weekly-plan-idempotency-key";
const REQUEST_METADATA_STORAGE = "weekly-plan-request-metadata";
const discardStickyKeyCodes = new Set([
  "weekly_plan_invalid_ai_response",
  "generation_timeout",
  "model_unavailable",
]);

const requestMetadataSchema = z
  .object({
    version: z.literal(1),
    ownerId: z.string().min(1),
    status: z.enum(["pending", "succeeded"]),
    request: weeklyPlanRequestSchema,
    resultId: z.uuid().nullable(),
  })
  .strict();
type RequestMetadata = z.infer<typeof requestMetadataSchema>;

function readMetadata(ownerId: string): { metadata: RequestMetadata | null; failed: boolean } {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(REQUEST_METADATA_STORAGE);
  } catch {
    return { metadata: null, failed: true };
  }
  if (raw === null) return { metadata: null, failed: false };
  try {
    const parsed = requestMetadataSchema.safeParse(JSON.parse(raw) as unknown);
    if (parsed.success && parsed.data.ownerId === ownerId) {
      return { metadata: parsed.data, failed: false };
    }
    try {
      sessionStorage.removeItem(REQUEST_METADATA_STORAGE);
      sessionStorage.removeItem(STICKY_KEY_STORAGE);
    } catch {
      return { metadata: null, failed: true };
    }
    return { metadata: null, failed: false };
  } catch {
    try {
      clearMetadata();
      return { metadata: null, failed: false };
    } catch {
      return { metadata: null, failed: true };
    }
  }
}

function writeMetadata(metadata: RequestMetadata): void {
  sessionStorage.setItem(STICKY_KEY_STORAGE, metadata.request.idempotencyKey);
  sessionStorage.setItem(REQUEST_METADATA_STORAGE, JSON.stringify(metadata));
}

function clearMetadata(): void {
  sessionStorage.removeItem(STICKY_KEY_STORAGE);
  sessionStorage.removeItem(REQUEST_METADATA_STORAGE);
}

function nextJstMonday(weekStartJst: string): string | null {
  const parsed = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(weekStartJst);
  if (parsed === null) return null;
  const date = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]) + 7));
  return `${String(date.getUTCFullYear())}年${String(date.getUTCMonth() + 1)}月${String(date.getUTCDate())}日（月）`;
}

export type WeeklyPlanFormPageProps = {
  accessToken: string;
  userId: string;
  eligibleMembers: readonly PlannerSafetyMember[];
  /** Task 14 が現行の家族条件と規則から判定して渡す、週献立では満たせない対象。 */
  unsatisfiableMemberIds: readonly string[];
};

/** spec §4.2 の週献立条件フォーム。安全性の最終判定はサーバ側で行う。 */
export function WeeklyPlanFormPage({
  accessToken,
  userId,
  eligibleMembers,
  unsatisfiableMemberIds,
}: WeeklyPlanFormPageProps): ReactElement {
  const navigate = useNavigate();
  const create = useCreateWeeklyPlan(accessToken);
  const usage = useUsageToday(userId);
  const weekStartJst = usage.data?.flyerWeekly.weekStartJst ?? "";
  const latest = useLatestWeeklyPlan(userId, weekStartJst);
  const [initialStored] = useState(() => readMetadata(userId));
  const selectableMemberIds = eligibleMembers
    .filter((member) => member.blockedReason === null)
    .map((member) => member.id);
  const [audience, setAudience] = useState<AudienceValue>({
    targetMode: "household",
    targetMemberIds: selectableMemberIds,
    servings: null,
  });
  const [cuisineGenre, setCuisineGenre] = useState<(typeof cuisineGenres)[number]>("any");
  const [budgetPreference, setBudgetPreference] = useState<
    (typeof budgetPreferences)[number] | null
  >(null);
  const [noveltyPreference, setNoveltyPreference] = useState<
    (typeof noveltyPreferences)[number] | null
  >(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [storedRequest, setStoredRequest] = useState<RequestMetadata | null>(
    initialStored.metadata,
  );
  const [storageFailed, setStorageFailed] = useState(initialStored.failed);
  const [requestActive, setRequestActive] = useState(false);
  const submittingRef = useRef(false);
  const lifecycleRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const { message: progressMessage, stageIndex: progressStageIndex } = useGenerationProgressMessage(
    { active: requestActive, anchorMs: null },
  );

  useEffect(() => {
    lifecycleRef.current += 1;
    const restored = readMetadata(userId);
    setStoredRequest(restored.metadata);
    setStorageFailed(restored.failed);
    setSubmitError(
      restored.failed
        ? "この端末で前回の依頼を確認できません。ブラウザの保存設定を確認してください。"
        : null,
    );
    setErrorCode(null);
    submittingRef.current = false;
    setRequestActive(false);
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
  }, [userId]);

  useEffect(
    () => () => {
      lifecycleRef.current += 1;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const currentSelectableIds = new Set(
      eligibleMembers.filter((member) => member.blockedReason === null).map((member) => member.id),
    );
    setAudience((current) => ({
      ...current,
      targetMemberIds: current.targetMemberIds.filter((id) => currentSelectableIds.has(id)),
    }));
  }, [eligibleMembers]);

  const selectedUnsatisfiable = audience.targetMemberIds.filter((id) =>
    unsatisfiableMemberIds.includes(id),
  );
  const quota = usage.data?.flyerWeekly;
  const quotaExhausted =
    quota !== undefined && (quota.successRemaining === 0 || quota.triesRemaining === 0);
  const cannotStartNew =
    storageFailed ||
    usage.data === undefined ||
    quotaExhausted ||
    audience.targetMemberIds.length === 0 ||
    selectedUnsatisfiable.length > 0 ||
    requestActive ||
    storedRequest !== null;

  const executeRequest = async (request: WeeklyPlanRequest): Promise<void> => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setRequestActive(true);
    setSubmitError(null);
    setErrorCode(null);
    const lifecycle = ++lifecycleRef.current;
    let automaticRetries = 0;
    try {
      while (lifecycleRef.current === lifecycle) {
        try {
          const result = await create.mutateAsync(request);
          if (lifecycleRef.current !== lifecycle) return;
          const succeeded: RequestMetadata = {
            version: 1,
            ownerId: userId,
            status: "succeeded",
            request,
            resultId: result.weeklyPlanId,
          };
          try {
            writeMetadata(succeeded);
            setStoredRequest(succeeded);
          } catch {
            // 成功結果への遷移を優先し、保存領域の障害で結果を見失わせない。
          }
          void navigate(`/weekly/${result.weeklyPlanId}`);
          return;
        } catch (error) {
          if (lifecycleRef.current !== lifecycle) return;
          if (
            error instanceof WeeklyPlanApiError &&
            error.status === 409 &&
            error.code === "generation_in_progress" &&
            automaticRetries < 3
          ) {
            automaticRetries += 1;
            await new Promise<void>((resolve) => {
              retryTimerRef.current = window.setTimeout(resolve, GENERATION_IN_PROGRESS_RETRY_MS);
            });
            continue;
          }
          if (error instanceof WeeklyPlanApiError) {
            if (discardStickyKeyCodes.has(error.code)) {
              try {
                clearMetadata();
              } catch {
                // 元のAPIエラーを表示する。保存領域の障害で原因を置き換えない。
              }
              setStoredRequest(null);
            }
            setErrorCode(error.code);
            setSubmitError(error.message);
          } else {
            setSubmitError("週献立を作成できませんでした。同じ条件でもう一度お試しください。");
          }
          return;
        }
      }
    } finally {
      if (lifecycleRef.current === lifecycle) {
        submittingRef.current = false;
        setRequestActive(false);
      }
    }
  };

  const onStartNew = (): void => {
    if (cannotStartNew) return;
    const request: WeeklyPlanRequest = {
      idempotencyKey: crypto.randomUUID(),
      targetMemberIds: [...audience.targetMemberIds],
      cuisineGenre,
      budgetPreference,
      noveltyPreference,
    };
    const pending: RequestMetadata = {
      version: 1,
      ownerId: userId,
      status: "pending",
      request,
      resultId: null,
    };
    try {
      writeMetadata(pending);
      setStoredRequest(pending);
    } catch {
      setStorageFailed(true);
      setSubmitError("この端末で作成を開始できません。ブラウザの保存設定を確認してください。");
      return;
    }
    void executeRequest(request);
  };

  const resetForNewRequest = (): void => {
    try {
      clearMetadata();
      setStoredRequest(null);
      setSubmitError(null);
      setErrorCode(null);
    } catch {
      setStorageFailed(true);
      setSubmitError(
        "この端末で新しい依頼を開始できません。ブラウザの保存設定を確認してください。",
      );
    }
  };

  return (
    <main className="page-frame stack guided-planner-theme">
      <h1>今週の献立</h1>
      {quota !== undefined ? (
        <p>
          {WEEKLY_PLAN_QUOTA_COPY_LABEL}: 成功 {quota.successRemaining} / {quota.successLimit}
          、試行 {quota.triesRemaining} / {quota.triesLimit}
        </p>
      ) : usage.isError ? (
        <div role="alert">
          <p>週献立の残数を読み込めませんでした。</p>
          <Button variant="secondary" onClick={() => void usage.refetch()}>
            残数を再読み込み
          </Button>
        </div>
      ) : (
        <p role="status">週献立の残数を読み込んでいます。</p>
      )}
      {latest.data !== null && latest.data !== undefined ? (
        <Link className="secondary-button min-h-11" to={`/weekly/${latest.data}`}>
          今週の献立はあります
        </Link>
      ) : null}
      {latest.isError ? (
        <div role="alert">
          <p>今週の献立を確認できませんでした。</p>
          <Button variant="secondary" onClick={() => void latest.refetch()}>
            今週の献立を再読み込み
          </Button>
        </div>
      ) : null}
      <AudienceStep
        value={audience}
        onChange={setAudience}
        onNext={() => undefined}
        eligibleMembers={eligibleMembers}
        disabled={requestActive}
        householdOnly
        hideActions
        heading="作る相手"
      />
      <p className="muted">献立には今回選んだ家族の条件だけが使われます。</p>
      {eligibleMembers.map((member) =>
        unsatisfiableMemberIds.includes(member.id) ? (
          <p key={member.id} role="note" className="error">
            {member.displayName}の条件では週献立を作れません。チェックを外すと作成できます。
          </p>
        ) : null,
      )}
      <fieldset className="stack">
        <legend>ジャンル</legend>
        {cuisineGenres.map((genre) => (
          <label key={genre} className="wizard-option min-h-11">
            <input
              type="radio"
              name="weekly-cuisine"
              checked={cuisineGenre === genre}
              disabled={requestActive}
              onChange={() => {
                setCuisineGenre(genre);
              }}
            />
            {cuisineGenreLabels[genre]}
          </label>
        ))}
      </fieldset>
      <fieldset className="stack">
        <legend>予算</legend>
        {([null, "economy"] as const).map((preference) => (
          <label key={preference ?? "default"} className="wizard-option min-h-11">
            <input
              type="radio"
              name="weekly-budget"
              checked={
                preference === null
                  ? budgetPreference !== "economy"
                  : budgetPreference === "economy"
              }
              disabled={requestActive}
              onChange={() => {
                setBudgetPreference(preference);
              }}
            />
            {preference === null ? "標準" : "節約優先"}
          </label>
        ))}
      </fieldset>
      <fieldset className="stack">
        <legend>目新しさ</legend>
        {([null, "twist"] as const).map((preference) => (
          <label key={preference ?? "default"} className="wizard-option min-h-11">
            <input
              type="radio"
              name="weekly-novelty"
              checked={
                preference === null ? noveltyPreference !== "twist" : noveltyPreference === "twist"
              }
              disabled={requestActive}
              onChange={() => {
                setNoveltyPreference(preference);
              }}
            />
            {preference === null ? "標準" : noveltyPreferenceLabels.twist}
          </label>
        ))}
      </fieldset>
      {quotaExhausted ? (
        <p role="note" className="error">
          {quota.successRemaining === 0
            ? weeklyPlanIssueMessages.weekly_plan_weekly_limit
            : weeklyPlanIssueMessages.weekly_plan_try_limit}
        </p>
      ) : null}
      {selectedUnsatisfiable.length > 0 ? (
        <p role="note">警告がある家族のチェックを外してから作成してください。</p>
      ) : null}
      {submitError !== null ? (
        <p role="alert" className="error">
          {submitError}
        </p>
      ) : null}
      {errorCode === "weekly_plan_weekly_limit" || errorCode === "weekly_plan_try_limit" ? (
        <p>次は{nextJstMonday(weekStartJst) ?? "次の月曜日"}から、新しい週の枠を利用できます。</p>
      ) : null}
      {errorCode === "weekly_plan_invalid_ai_response" ? (
        <p>前回の依頼は確認できなかったため、新しい依頼として作り直してください。</p>
      ) : null}
      {(storedRequest?.resultId ?? latest.data) !== null &&
      (storedRequest?.resultId ?? latest.data) !== undefined ? (
        <Link
          className="secondary-button min-h-11"
          to={`/weekly/${String(storedRequest?.resultId ?? latest.data)}`}
        >
          前回の献立を見る
        </Link>
      ) : null}
      {storedRequest?.status === "pending" ? (
        <>
          <Button
            variant="primary"
            disabled={requestActive}
            onClick={() => void executeRequest(storedRequest.request)}
          >
            {requestActive ? "今週の献立をつくっています" : "前回の依頼を再試行"}
          </Button>
          {!requestActive ? (
            <Button variant="secondary" onClick={resetForNewRequest}>
              新しい依頼を始める
            </Button>
          ) : null}
        </>
      ) : storedRequest?.status === "succeeded" ? (
        <Button variant="secondary" disabled={requestActive} onClick={resetForNewRequest}>
          新しい依頼を始める
        </Button>
      ) : (
        <Button variant="primary" disabled={cannotStartNew} onClick={onStartNew}>
          {requestActive
            ? "今週の献立をつくっています"
            : errorCode === "weekly_plan_invalid_ai_response"
              ? "新しい依頼として作り直す"
              : "今週の献立をつくる"}
        </Button>
      )}
      {requestActive ? (
        <div className="gen-status-panel" data-phase="submitting">
          <div className="gen-status-indicator" aria-hidden="true" />
          <p role="status" aria-live="polite" data-progress-stage={String(progressStageIndex)}>
            {progressMessage}
          </p>
          <GenerationProgressMeter stageIndex={progressStageIndex} />
        </div>
      ) : null}
    </main>
  );
}
