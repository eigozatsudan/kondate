export type ProgressIndicatorProps = {
  currentStep: number;
  totalSteps: number;
};

/**
 * 進捗バー。CSP の style-src 'self'（unsafe-inline なし）に合わせ、
 * 動的 width は SVG の width 属性で表現し style 属性は使わない。
 */
export function ProgressIndicator({ currentStep, totalSteps }: ProgressIndicatorProps) {
  const normalizedTotalSteps = Number.isFinite(totalSteps)
    ? Math.max(1, Math.trunc(totalSteps))
    : 1;
  const normalizedCurrentStep = Number.isFinite(currentStep)
    ? Math.min(normalizedTotalSteps, Math.max(1, Math.trunc(currentStep)))
    : 1;
  const currentStepText = String(normalizedCurrentStep);
  const totalStepsText = String(normalizedTotalSteps);
  const label = `質問 ${currentStepText} / ${totalStepsText}`;
  const fillRatio = normalizedCurrentStep / normalizedTotalSteps;
  // viewBox 幅 100 に対する塗り幅（百分率相当）。CSS ではなく SVG 属性で渡す。
  const fillWidth = String(fillRatio * 100);

  return (
    <div className="progress-indicator">
      <span>{label}</span>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={normalizedTotalSteps}
        aria-valuenow={normalizedCurrentStep}
      >
        <svg
          className="progress-value"
          viewBox="0 0 100 1"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect className="progress-value-rect" x="0" y="0" height="1" width={fillWidth} />
        </svg>
      </div>
    </div>
  );
}
