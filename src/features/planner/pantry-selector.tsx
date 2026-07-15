import { useEffect, useId, useRef, useState } from "react";
import type { PantryItem, PantrySelectionDraft } from "@shared/contracts/pantry";
import {
  confirmExpiredPantryItem,
  hasCurrentExpiredConfirmation,
  isPastEnteredExpiry,
  type PlannerAttempt,
} from "./expired-pantry-checks";

export type { PlannerAttempt } from "./expired-pantry-checks";

export type PantrySelectorProps = {
  items: readonly PantryItem[];
  selections: readonly PantrySelectionDraft[];
  attempt: PlannerAttempt;
  onAttemptChange: (next: PlannerAttempt) => void;
  onChange: (next: readonly PantrySelectionDraft[]) => void;
  now?: () => Date;
};

export function PantrySelector({
  items,
  selections,
  attempt,
  onAttemptChange,
  onChange,
  now = () => new Date(),
}: PantrySelectorProps) {
  const [pendingItem, setPendingItem] = useState<PantryItem | null>(null);
  const descriptionId = useId();
  const triggerRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const safeActionRef = useRef<HTMLButtonElement | null>(null);
  const attemptKeyRef = useRef(attempt.idempotencyKey);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (attemptKeyRef.current === attempt.idempotencyKey) return;
    attemptKeyRef.current = attempt.idempotencyKey;
    if (pendingItem !== null) {
      restoreFocusRef.current = true;
      setPendingItem(null);
    }
  }, [attempt.idempotencyKey, pendingItem]);

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
      {items.map((item) => {
        const selected = selections.find((entry) => entry.pantryItemId === item.id);
        return (
          <div key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={selected !== undefined}
                disabled={pendingItem !== null}
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
                disabled={pendingItem !== null}
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
      {pendingItem !== null && (
        <div
          style={{
            position: "fixed",
            zIndex: 20,
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: "16px",
            background: "rgb(51 44 39 / 55%)",
          }}
        >
          <div
            role="alertdialog"
            aria-label="期限を過ぎた食材の確認"
            aria-modal="true"
            aria-describedby={descriptionId}
            className="card stack"
            style={{ width: "min(100%, 520px)", maxHeight: "calc(100vh - 32px)", overflow: "auto" }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeDialog();
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
              onClick={() => {
                const checkedAt = now();
                onAttemptChange(confirmExpiredPantryItem(attempt, pendingItem.id, checkedAt));
                onChange([...selections, { pantryItemId: pendingItem.id, priority: "prefer_use" }]);
                closeDialog();
              }}
            >
              実物を確認して今回だけ選ぶ
            </button>
            <button
              ref={safeActionRef}
              className="secondary-button"
              type="button"
              onClick={() => {
                closeDialog();
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
