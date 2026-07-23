import type { PlannerDraftInput } from "@shared/contracts/planner";
import type { PlannerFieldName, PlannerStep } from "../model/planner-wizard";
import type { PlannerSafetyMember } from "../planner-safety-member";

/**
 * brief記載の PlannerStepProps<TValue> をそのまま実装する。
 * 各stepはvalue更新だけを親（PlannerWizard）へ通知し、DB/APIを直接呼ばない。
 */
export type PlannerStepProps<TValue> = {
  value: TValue;
  onChange: (value: TValue) => void;
  onBack?: () => void;
  onNext: () => void;
  disabled: boolean;
};

/**
 * brief記載の PlannerWizardProps。eligibleMembers は「作る相手」の候補一覧として、
 * このリポジトリの既存表現である PlannerSafetyMember をそのまま使う
 * （brief中の HouseholdMember は本リポジトリの家族API row型ではなく
 * このUI境界向けの安全確認済みメンバー表現を指すため、既存型を再定義しない）。
 */
export type PlannerWizardProps = {
  draft: PlannerDraftInput;
  step: PlannerStep;
  eligibleMembers: readonly PlannerSafetyMember[];
  isSaving: boolean;
  error: string | null;
  fieldErrors: Readonly<Partial<Record<PlannerFieldName, string>>>;
  onDraftChange: (next: PlannerDraftInput) => void;
  onStepChange: (next: PlannerStep) => void;
  onSubmit: () => Promise<void>;
};
