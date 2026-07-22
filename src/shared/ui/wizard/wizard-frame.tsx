import { useEffect, useRef, type ReactNode } from "react";
import { ProgressIndicator } from "./progress-indicator";

export type WizardPrimaryAction = {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

export type WizardFrameProps = {
  stepKey: string;
  currentStep: number;
  totalSteps: number;
  title: string;
  description?: string;
  children: ReactNode;
  onBack?: () => void;
  primaryAction: WizardPrimaryAction;
};

export function WizardFrame({
  stepKey,
  currentStep,
  totalSteps,
  title,
  description,
  children,
  onBack,
  primaryAction,
}: WizardFrameProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [stepKey]);

  return (
    <section className="wizard-frame wizard-transition">
      <header className="wizard-header stack">
        <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />
        <h1 className="wizard-title" ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {description !== undefined && <p className="wizard-description">{description}</p>}
      </header>
      <div className="wizard-content">{children}</div>
      <footer className="wizard-actions">
        {onBack !== undefined && (
          <button className="text-button wizard-action" type="button" onClick={onBack}>
            戻る
          </button>
        )}
        <button
          className="primary-button wizard-action"
          type="button"
          disabled={primaryAction.disabled === true || primaryAction.busy === true}
          aria-busy={primaryAction.busy === true}
          onClick={primaryAction.onClick}
        >
          {primaryAction.busy === true ? "処理中…" : primaryAction.label}
        </button>
      </footer>
    </section>
  );
}
