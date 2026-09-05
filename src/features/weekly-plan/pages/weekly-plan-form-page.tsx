import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router";
import { cuisineGenres } from "@shared/contracts/domain";
import { budgetPreferences, noveltyPreferences } from "@shared/contracts/planner";
import {
  WEEKLY_PLAN_QUOTA_COPY_LABEL,
  weeklyPlanIssueMessages,
} from "@shared/contracts/weekly-plan";
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
const discardStickyKeyCodes = new Set([
  "weekly_plan_invalid_ai_response",
  "generation_timeout",
  "model_unavailable",
]);

function readOrCreateStickyKey(): string {
  const existing = sessionStorage.getItem(STICKY_KEY_STORAGE);
  if (existing !== null && existing !== "") return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(STICKY_KEY_STORAGE, created);
  return created;
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
  const submittingRef = useRef(false);

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
  const cannotSubmit =
    usage.data === undefined ||
    quotaExhausted ||
    audience.targetMemberIds.length === 0 ||
    selectedUnsatisfiable.length > 0 ||
    create.isPending;

  const onSubmit = async (): Promise<void> => {
    if (cannotSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError(null);
    let idempotencyKey: string;
    try {
      idempotencyKey = readOrCreateStickyKey();
    } catch {
      submittingRef.current = false;
      setSubmitError("この端末で作成を開始できません。ブラウザの保存設定を確認してください。");
      return;
    }
    try {
      const result = await create.mutateAsync({
        idempotencyKey,
        targetMemberIds: [...audience.targetMemberIds],
        cuisineGenre,
        budgetPreference,
        noveltyPreference,
      });
      void navigate(`/weekly/${result.weeklyPlanId}`);
    } catch (error) {
      if (error instanceof WeeklyPlanApiError) {
        if (discardStickyKeyCodes.has(error.code)) {
          try {
            sessionStorage.removeItem(STICKY_KEY_STORAGE);
          } catch {
            // エラー表示を優先し、保存領域の追加失敗で再送制御を不明瞭にしない。
          }
        }
        setSubmitError(error.message);
      } else {
        setSubmitError("週献立を作成できませんでした。同じ条件でもう一度お試しください。");
      }
    } finally {
      submittingRef.current = false;
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
        disabled={create.isPending}
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
              disabled={create.isPending}
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
        {([null, ...budgetPreferences] as const).map((preference) => (
          <label key={preference ?? "default"} className="wizard-option min-h-11">
            <input
              type="radio"
              name="weekly-budget"
              checked={budgetPreference === preference}
              disabled={create.isPending}
              onChange={() => {
                setBudgetPreference(preference);
              }}
            />
            {preference === null ? "標準" : preference === "economy" ? "節約優先" : "標準を指定"}
          </label>
        ))}
      </fieldset>
      <fieldset className="stack">
        <legend>目新しさ</legend>
        {([null, ...noveltyPreferences] as const).map((preference) => (
          <label key={preference ?? "default"} className="wizard-option min-h-11">
            <input
              type="radio"
              name="weekly-novelty"
              checked={noveltyPreference === preference}
              disabled={create.isPending}
              onChange={() => {
                setNoveltyPreference(preference);
              }}
            />
            {preference === null ? "標準" : noveltyPreferenceLabels[preference]}
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
      <Button variant="primary" disabled={cannotSubmit} onClick={() => void onSubmit()}>
        {create.isPending ? "今週の献立をつくっています" : "今週の献立をつくる"}
      </Button>
      {create.isPending ? (
        <p role="status">作成には少し時間がかかります。このままお待ちください。</p>
      ) : null}
    </main>
  );
}
