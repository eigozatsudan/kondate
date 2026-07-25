import type { CurrentShoppingLabelWarning, ShoppingItem } from "@shared/contracts/shopping";

export type ShoppingItemRowProps = {
  item: ShoppingItem;
  onChecked: (id: string, value: boolean) => void;
  onEdit: (item: ShoppingItem) => void;
  onAtHome: (id: string) => void;
  onRemove: (item: ShoppingItem) => void;
  onUndo: (id: string) => void;
  disabled: boolean;
  currentLabelWarnings: readonly CurrentShoppingLabelWarning[];
};

export function ShoppingItemRow({
  item,
  onChecked,
  onEdit,
  onAtHome,
  onRemove,
  onUndo,
  disabled,
  currentLabelWarnings,
}: ShoppingItemRowProps) {
  if (item.isRemovedByUser)
    return (
      <li className="shopping-item-row shopping-item-row--removed">
        <span className="shopping-item-name">{item.displayName}をリストから外しました</span>
        <button
          type="button"
          disabled={disabled}
          className="text-button min-h-11"
          onClick={() => {
            onUndo(item.id);
          }}
        >
          元に戻す
        </button>
      </li>
    );
  return (
    <li className="shopping-item-row" data-checked={item.isChecked ? "true" : "false"}>
      <label className="shopping-item-main min-h-11">
        <input
          type="checkbox"
          checked={item.isChecked}
          disabled={disabled}
          aria-label={`${item.displayName}を購入済みにする`}
          onChange={(event) => {
            onChecked(item.id, event.target.checked);
          }}
        />
        <span className="shopping-item-copy">
          <span className="shopping-item-name">{item.displayName}</span>
          <span className="shopping-item-quantity">{item.quantityText}</span>
        </span>
      </label>
      {item.pantryCheckRequired && <span className="shopping-item-note">在庫量を確認</span>}
      {currentLabelWarnings.length > 0 && (
        <div className="shopping-item-warning">
          <strong>加工品は原材料表示を確認</strong>
          {currentLabelWarnings.map((warning) => (
            <p key={warning.warningKey}>
              {warning.sourceDisplayName}・{warning.allergenDisplayName}・
              {warning.memberDisplayName}
            </p>
          ))}
        </div>
      )}
      <div className="shopping-item-actions">
        <button
          type="button"
          disabled={disabled}
          className="text-button min-h-11"
          onClick={() => {
            onEdit(item);
          }}
        >
          数量・単位・売り場を編集
        </button>
        <button
          type="button"
          disabled={disabled}
          className="text-button min-h-11"
          onClick={() => {
            onAtHome(item.id);
          }}
        >
          家にある
        </button>
        <button
          type="button"
          disabled={disabled}
          className="text-button min-h-11"
          onClick={() => {
            onRemove(item);
          }}
        >
          削除
        </button>
      </div>
    </li>
  );
}
