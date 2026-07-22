import { useId } from "react";

export type ProgressIndicatorProps = {
  currentStep: number;
  totalSteps: number;
};

export function ProgressIndicator({ currentStep, totalSteps }: ProgressIndicatorProps) {
  const instanceId = useId();
  const normalizedTotalSteps = Number.isFinite(totalSteps)
    ? Math.max(1, Math.trunc(totalSteps))
    : 1;
  const normalizedCurrentStep = Number.isFinite(currentStep)
    ? Math.min(normalizedTotalSteps, Math.max(1, Math.trunc(currentStep)))
    : 1;
  const currentStepText = String(normalizedCurrentStep);
  const totalStepsText = String(normalizedTotalSteps);
  const label = `質問 ${currentStepText} / ${totalStepsText}`;
  const percentage = `${String((normalizedCurrentStep / normalizedTotalSteps) * 100)}%`;

  const labelId = `${instanceId}-wizard-progress-label`;

  return (
    <div className="progress-indicator">
      <span id={labelId}>{label}</span>
      <div
        className="progress-track"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={1}
        aria-valuemax={normalizedTotalSteps}
        aria-valuenow={normalizedCurrentStep}
      >
        <div className="progress-value" style={{ width: percentage }} />
      </div>
    </div>
  );
}
