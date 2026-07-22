export type ProgressIndicatorProps = {
  currentStep: number;
  totalSteps: number;
};

export function ProgressIndicator({ currentStep, totalSteps }: ProgressIndicatorProps) {
  const currentStepText = String(currentStep);
  const totalStepsText = String(totalSteps);
  const label = `質問 ${currentStepText} / ${totalStepsText}`;
  const percentage = `${String((currentStep / totalSteps) * 100)}%`;

  const labelId = `wizard-progress-${currentStepText}-${totalStepsText}`;

  return (
    <div className="progress-indicator" aria-label={label}>
      <span id={labelId}>{label}</span>
      <div
        className="progress-track"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={currentStep}
      >
        <div className="progress-value" style={{ width: percentage }} />
      </div>
    </div>
  );
}
