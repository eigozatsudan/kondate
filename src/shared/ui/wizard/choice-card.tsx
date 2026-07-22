export type ChoiceCardProps = {
  title: string;
  description?: string;
  selected: boolean;
  selectionMode: "single" | "multiple";
  disabled?: boolean;
  onSelect: () => void;
};

export function ChoiceCard({
  title,
  description,
  selected,
  selectionMode,
  disabled = false,
  onSelect,
}: ChoiceCardProps) {
  return (
    <button
      className="choice-card"
      type="button"
      aria-pressed={selected}
      data-selection-mode={selectionMode}
      disabled={disabled}
      onClick={onSelect}
    >
      <strong>{title}</strong>
      {description !== undefined && <span className="choice-card-description">{description}</span>}
      {selected && (
        <span className="choice-card-selection">
          <span aria-hidden="true">✓ </span>
          選択中
        </span>
      )}
    </button>
  );
}
