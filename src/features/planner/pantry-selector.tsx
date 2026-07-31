import { useEffect, useId, useRef, useState } from "react";
import type { PantryItem, PantrySelectionDraft } from "@shared/contracts/pantry";
import {
  confirmExpiredPantryItem,
  hasCurrentExpiredConfirmation,
  isPastEnteredExpiry,
  type PlannerAttempt,
} from "./expired-pantry-checks";

export type { PlannerAttempt } from "./expired-pantry-checks";

export type PantryItemsStatus = "loading" | "loaded";

export type PantrySelectorProps = {
  items: readonly PantryItem[];
  itemsStatus: PantryItemsStatus;
  selections: readonly PantrySelectionDraft[];
  attempt: PlannerAttempt;
  onAttemptChange: (next: PlannerAttempt) => void;
  onChange: (next: readonly PantrySelectionDraft[]) => void;
  disabled?: boolean;
  now?: () => Date;
};

export function PantrySelector({
  items,
  itemsStatus,
  selections,
  attempt,
  onAttemptChange,
  onChange,
  disabled = false,
  now = () => new Date(),
}: PantrySelectorProps) {
  const [pendingItem, setPendingItem] = useState<PantryItem | null>(null);
  const descriptionId = useId();
  const triggerRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const safeActionRef = useRef<HTMLButtonElement | null>(null);
  const attemptKeyRef = useRef(attempt.idempotencyKey);
  const restoreFocusRef = useRef(false);
  const itemIds = new Set(items.map((item) => item.id));
  const unavailableSelections =
    itemsStatus === "loaded"
      ? selections.filter((selection) => !itemIds.has(selection.pantryItemId))
      : [];
  const selectionLimitReached = selections.length >= 50;

  useEffect(() => {
    if (attemptKeyRef.current === attempt.idempotencyKey) return;
    attemptKeyRef.current = attempt.idempotencyKey;
    if (pendingItem !== null) {
      restoreFocusRef.current = true;
      setPendingItem(null);
    }
  }, [attempt.idempotencyKey, pendingItem]);

  // PLAN-1: 既選択の期限切れ（下書き hydrate）でも確認ダイアログを出す
  useEffect(() => {
    if (disabled || itemsStatus !== "loaded" || pendingItem !== null) return;
    const checkedAt = now();
    for (const selection of selections) {
      const item = items.find((entry) => entry.id === selection.pantryItemId);
      if (item === undefined) continue;
      if (
        isPastEnteredExpiry(item, checkedAt) &&
        !hasCurrentExpiredConfirmation(attempt, item.id, checkedAt)
      ) {
        setPendingItem(item);
        return;
      }
    }
  }, [attempt, disabled, items, itemsStatus, now, pendingItem, selections]);

  useEffect(() => {
    if (pendingItem !== null) {
      safeActionRef.current?.focus();
      return;
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [pendingItem]);

  const closeDialog = (): void => {
    restoreFocusRef.current = true;
    setPendingItem(null);
  };

  /** 既選択の期限切れ hydrate か、新規選択かで確認後の選択更新を分ける (PLAN-1 residual) */
  const isPendingAlreadySelected =
    pendingItem !== null && selections.some((entry) => entry.pantryItemId === pendingItem.id);

  const confirmPendingExpired = (): void => {
    if (pendingItem === null) return;
    const checkedAt = now();
    onAttemptChange(confirmExpiredPantryItem(attempt, pendingItem.id, checkedAt));
    // 既選択なら attempt だけ更新。重複 prefer_use 行を足さない
    if (!isPendingAlreadySelected) {
      onChange([...selections, { pantryItemId: pendingItem.id, priority: "prefer_use" }]);
    }
    closeDialog();
  };

  const declinePendingExpired = (): void => {
    if (pendingItem === null) return;
    // 既選択の辞退は選択解除。閉じるだけだと effect が即再オープンする
    if (isPendingAlreadySelected) {
      onChange(selections.filter((entry) => entry.pantryItemId !== pendingItem.id));
    }
    closeDialog();
  };

  const select = (item: PantryItem): void => {
    const checkedAt = now();
    if (
      isPastEnteredExpiry(item, checkedAt) &&
      !hasCurrentExpiredConfirmation(attempt, item.id, checkedAt)
    ) {
      setPendingItem(item);
      return;
    }
    onChange([...selections, { pantryItemId: item.id, priority: "prefer_use" }]);
  };

  return (
    <section className="card stack" aria-labelledby="pantry-selector-title">
      <h2 id="pantry-selector-title">冷蔵庫から使う食材</h2>
      {itemsStatus === "loading" && <p>冷蔵庫の食材を読み込んでいます…</p>}
      {items.map((item) => {
        const selected = selections.find((entry) => entry.pantryItemId === item.id);
        return (
          <div key={item.id}>
            <label className="control-label">
              <input
                type="checkbox"
                checked={selected !== undefined}
                disabled={
                  disabled ||
                  pendingItem !== null ||
                  (selected === undefined && selectionLimitReached)
                }
                onChange={(event) => {
                  if (selected === undefined) {
                    triggerRef.current = event.currentTarget;
                    select(item);
                  } else onChange(selections.filter((entry) => entry.pantryItemId !== item.id));
                }}
              />
              {item.name}
            </label>
            {selected !== undefined && (
              <select
                aria-label={`${item.name}の使い方`}
                value={selected.priority}
                disabled={disabled || pendingItem !== null}
                onChange={(event) => {
                  const priority = event.target.value === "must_use" ? "must_use" : "prefer_use";
                  onChange(
                    selections.map((entry) =>
                      entry.pantryItemId === item.id ? { ...entry, priority } : entry,
                    ),
                  );
                }}
              >
                <option value="must_use">必ず使う</option>
                <option value="prefer_use">使えれば使う</option>
              </select>
            )}
          </div>
        );
      })}
      {selectionLimitReached && (
        <p role="status">冷蔵庫の食材は50件まで選べます。選択中の食材は解除できます。</p>
      )}
      {unavailableSelections.map((selection) => (
        <div key={selection.pantryItemId}>
          <p>冷蔵庫から削除された食材</p>
          <button
            type="button"
            disabled={disabled || pendingItem !== null}
            onClick={() => {
              onChange(selections.filter((entry) => entry.pantryItemId !== selection.pantryItemId));
            }}
          >
            削除された食材の選択を解除
          </button>
        </div>
      ))}
      {pendingItem !== null && (
        <div className="pantry-expired-dialog-backdrop">
          <div
            role="alertdialog"
            aria-label="期限を過ぎた食材の確認"
            aria-modal="true"
            aria-describedby={descriptionId}
            className="card stack pantry-expired-dialog-panel"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                declinePendingExpired();
                return;
              }
              if (event.key !== "Tab") return;
              event.preventDefault();
              if (event.shiftKey) {
                if (document.activeElement === safeActionRef.current) confirmRef.current?.focus();
                else safeActionRef.current?.focus();
              } else if (document.activeElement === safeActionRef.current) {
                confirmRef.current?.focus();
              } else {
                safeActionRef.current?.focus();
              }
            }}
          >
            <p id={descriptionId}>
              入力した期限を過ぎています。アプリは食べられるか判断しません。今回、実物の状態を確認しましたか？
            </p>
            <button
              ref={confirmRef}
              className="primary-button"
              type="button"
              disabled={disabled}
              onClick={() => {
                confirmPendingExpired();
              }}
            >
              実物を確認して今回だけ選ぶ
            </button>
            <button
              ref={safeActionRef}
              className="secondary-button"
              type="button"
              disabled={disabled}
              onClick={() => {
                declinePendingExpired();
              }}
            >
              選ばない
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
