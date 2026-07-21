import { useState } from "react";
import type { ShoppingDiff } from "@shared/contracts/shopping";

export type ReconcileListSheetProps = {
  diff: ShoppingDiff;
  pending: boolean;
  safetyBlocked: boolean;
  onApply: (approval: {
    addKeys: string[];
    replaceItemIds: string[];
    removeItemIds: string[];
  }) => void;
  onCancel: () => void;
};

export function ReconcileListSheet({
  diff,
  pending,
  safetyBlocked,
  onApply,
  onCancel,
}: ReconcileListSheetProps) {
  const [addKeys, setAddKeys] = useState(() => new Set(diff.add.map((item) => item.key)));
  const [replaceIds, setReplaceIds] = useState(
    () => new Set(diff.replace.map((item) => item.itemId)),
  );
  const [removeIds, setRemoveIds] = useState(() => new Set(diff.remove.map((item) => item.itemId)));
  // 2回目以降のプレビューでは差分そのものが差し替わる。初期化子は初回マウントでしか
  // 走らないため、新しい差分が来たら選択状態を必ず作り直す（前回の選択を承認しない）。
  const [seededDiff, setSeededDiff] = useState(diff);
  if (seededDiff !== diff) {
    setSeededDiff(diff);
    setAddKeys(new Set(diff.add.map((item) => item.key)));
    setReplaceIds(new Set(diff.replace.map((item) => item.itemId)));
    setRemoveIds(new Set(diff.remove.map((item) => item.itemId)));
  }
  const toggle = (
    current: Set<string>,
    value: string,
    checked: boolean,
    setter: (next: Set<string>) => void,
  ) => {
    const next = new Set(current);
    if (checked) next.add(value);
    else next.delete(value);
    setter(next);
  };
  const warnings = (
    items: readonly {
      sourceDisplayName: string;
      allergenDisplayName: string;
      memberDisplayName: string;
    }[],
  ) =>
    items
      .map(
        (warning) =>
          `${warning.sourceDisplayName}・${warning.allergenDisplayName}・${warning.memberDisplayName}`,
      )
      .join("、");
  return (
    <section className="card stack" aria-labelledby="diff-title">
      <h2 id="diff-title">献立変更の差分</h2>
      <p>内容を確認し、反映する項目だけ選んでください。</p>
      <fieldset>
        <legend>追加 {diff.add.length}件</legend>
        {diff.add.map((item) => (
          <label className="flex min-h-11 items-start gap-3" key={item.key}>
            <input
              type="checkbox"
              checked={addKeys.has(item.key)}
              onChange={(event) => {
                toggle(addKeys, item.key, event.target.checked, setAddKeys);
              }}
            />
            <span>
              <strong>
                {item.displayName} {item.quantityText}
              </strong>
              <span className="block">
                使用先：
                {[...new Set(item.sourceIngredients.map((source) => source.dishName))].join("・")}
              </span>
              {item.pantryCheckRequired && <span className="block">在庫量を確認</span>}
              {item.labelWarnings.length > 0 && (
                <span className="block">原材料表示：{warnings(item.labelWarnings)}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>数量・内容変更 {diff.replace.length}件</legend>
        {diff.replace.map((item) => (
          <label className="flex min-h-11 items-start gap-3" key={item.itemId}>
            <input
              type="checkbox"
              checked={replaceIds.has(item.itemId)}
              onChange={(event) => {
                toggle(replaceIds, item.itemId, event.target.checked, setReplaceIds);
              }}
            />
            <span>
              <strong>{item.current.displayName}</strong>：{item.current.quantityText} →{" "}
              {item.next.quantityText}
              <span className="block">
                使用先：
                {[...new Set(item.next.sourceIngredients.map((source) => source.dishName))].join(
                  "・",
                )}
              </span>
              {item.next.labelWarnings.length > 0 && (
                <span className="block">原材料表示：{warnings(item.next.labelWarnings)}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>不要になる候補 {diff.remove.length}件</legend>
        {diff.remove.map((item) => (
          <label className="flex min-h-11 items-start gap-3" key={item.itemId}>
            <input
              type="checkbox"
              checked={removeIds.has(item.itemId)}
              onChange={(event) => {
                toggle(removeIds, item.itemId, event.target.checked, setRemoveIds);
              }}
            />
            <span>
              {item.displayName} {item.quantityText}を外す
            </span>
          </label>
        ))}
      </fieldset>
      {diff.protectedItemIds.length > 0 && <p>購入済み・手動変更の項目はそのまま残します。</p>}
      {diff.listLabelWarnings.map((warning) => (
        <p
          key={`${warning.sourceType}:${warning.sourceId}:${warning.allergenId}:${warning.anonymousMemberRef}`}
        >
          原材料表示を確認：{warning.sourceDisplayName}・{warning.allergenDisplayName}・
          {warning.memberDisplayName}
        </p>
      ))}
      <button
        type="button"
        className="primary-button min-h-11"
        disabled={pending || safetyBlocked}
        onClick={() => {
          onApply({
            addKeys: [...addKeys],
            replaceItemIds: [...replaceIds],
            removeItemIds: [...removeIds],
          });
        }}
      >
        選んだ変更を反映
      </button>
      <button type="button" className="text-button min-h-11" onClick={onCancel}>
        変更しない
      </button>
    </section>
  );
}
