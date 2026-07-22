import type { ReactNode } from "react";

export type ReviewRowProps = {
  label: string;
  value: ReactNode;
  onEdit: () => void;
};

export function ReviewRow({ label, value, onEdit }: ReviewRowProps) {
  return (
    <div className="review-row">
      <div>
        <p className="review-row-label">{label}</p>
        <div className="review-row-value">{value}</div>
      </div>
      <button
        className="text-button wizard-action"
        type="button"
        aria-label={`${label}を変更`}
        onClick={onEdit}
      >
        変更
      </button>
    </div>
  );
}
