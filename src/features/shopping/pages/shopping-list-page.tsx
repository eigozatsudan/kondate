import { useRef, useState, type SyntheticEvent } from "react";
import {
  shoppingItemMutationRequestSchema,
  type ShoppingItem,
  type ShoppingItemMutationRequest,
  type StoreSection,
} from "@shared/contracts/shopping";
import { normalizeIngredientName } from "@shared/shopping/normalize";
import { reviewedShoppingAliases } from "@shared/shopping/reviewed-aliases";
import { mutateShoppingItem } from "../api/shopping-api";
import { ShoppingItemRow } from "../components/shopping-item-row";
import { useShoppingList, useShoppingSafetyGate } from "../hooks/use-shopping-list";

const sectionLabels: Record<StoreSection, string> = {
  produce: "野菜",
  meat_fish: "肉・魚",
  dairy_eggs: "乳製品・卵",
  dry_goods: "乾物",
  seasonings: "調味料",
  other: "その他",
};
export function categoryLabel(section: StoreSection): string {
  return sectionLabels[section];
}
const sections: readonly StoreSection[] = [
  "produce",
  "meat_fish",
  "dairy_eggs",
  "dry_goods",
  "seasonings",
  "other",
];

/** 画面が持つのは操作の中身だけ。リスト版数・fingerprint・冪等キーは送信直前に付ける。 */
type LocalShoppingItemMutation<T = ShoppingItemMutationRequest> =
  T extends ShoppingItemMutationRequest
    ? Omit<T, "listId" | "expectedListVersion" | "expectedSafetyFingerprint" | "idempotencyKey">
    : never;

export function ShoppingListPage() {
  const query = useShoppingList();
  const safetyGate = useShoppingSafetyGate();
  const [adding, setAdding] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualQuantity, setManualQuantity] = useState("");
  const [manualQuantityText, setManualQuantityText] = useState("数量未入力");
  const [manualUnit, setManualUnit] = useState("");
  const [manualSection, setManualSection] = useState<StoreSection>("other");
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [editingQuantity, setEditingQuantity] = useState("");
  const [editingQuantityText, setEditingQuantityText] = useState("");
  const [editingUnit, setEditingUnit] = useState("");
  const [editingSection, setEditingSection] = useState<StoreSection>("other");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const manualFirstField = useRef<HTMLInputElement>(null);
  const editFirstField = useRef<HTMLInputElement>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  if (query.isPending)
    return (
      <main className="page-frame">
        <p>買い物リストを読み込んでいます</p>
      </main>
    );
  if (query.isError)
    return (
      <main className="page-frame">
        <p role="alert">読み込めませんでした</p>
      </main>
    );
  if (query.data === null)
    return (
      <main className="page-frame stack">
        <h1>買い物リスト</h1>
        <p>買い物リストは空です</p>
        <a className="primary-button min-h-11" href="/history">
          献立から作る
        </a>
      </main>
    );
  const list = query.data;
  const safetyBlocked = safetyGate.blocked || query.isFetching;
  const currentListWarnings = safetyGate.currentLabelWarnings.filter(
    (warning) => warning.itemId === null,
  );
  // ゲートが閉じている間だけ、作成時に保存した不変スナップショットを別枠で読む。
  // これは現行の権威ではなく、過去の記録として提示する。
  const storedProvenanceWarnings = safetyGate.error
    ? [...list.listLabelWarnings, ...list.items.flatMap((item) => item.labelWarnings)]
    : [];
  const mutate = async (value: LocalShoppingItemMutation) => {
    if (safetyBlocked || safetyGate.safetyFingerprint === null) return;
    try {
      setMutationError(null);
      await mutateShoppingItem(
        shoppingItemMutationRequestSchema.parse({
          ...value,
          listId: list.id,
          expectedListVersion: list.version,
          expectedSafetyFingerprint: safetyGate.safetyFingerprint,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "list_version_conflict") {
        setMutationError("別の画面で更新されました。最新の内容を読み込みました");
      } else if (
        error instanceof Error &&
        "code" in error &&
        error.code === "shopping_safety_fingerprint_changed"
      ) {
        setMutationError("家族設定が変わりました。もう一度確認します");
        await safetyGate.refresh();
      } else {
        setMutationError("買い物項目を更新できませんでした");
      }
    }
    await query.refetch();
  };
  const submitManual = async (event: SyntheticEvent) => {
    event.preventDefault();
    const quantity = manualQuantity.trim() === "" ? null : Number(manualQuantity);
    if (
      manualName.trim() === "" ||
      manualQuantityText.trim() === "" ||
      (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
    ) {
      setFieldError("項目名と分量を確認してください");
      requestAnimationFrame(() => manualFirstField.current?.focus());
      return;
    }
    await mutate({
      operation: "add_manual",
      itemId: null,
      payload: {
        displayName: manualName.trim(),
        normalizedName: normalizeIngredientName(manualName, reviewedShoppingAliases),
        storeSection: manualSection,
        quantityValue: quantity,
        quantityText: manualQuantityText.trim(),
        unit: manualUnit.trim() === "" ? null : manualUnit.trim(),
        pantryCheckRequired: false,
      },
    });
    setManualName("");
    setManualQuantity("");
    setManualQuantityText("数量未入力");
    setManualUnit("");
    setFieldError(null);
    setAdding(false);
    await query.refetch();
  };
  return (
    <main className="page-frame stack">
      <h1>買い物リスト</h1>
      {safetyGate.error && <p role="alert">{safetyGate.message}</p>}
      {storedProvenanceWarnings.length > 0 && (
        <section className="card" aria-label="過去の原材料表示警告">
          <strong>現在の条件では確認できない過去の警告</strong>
          <p>安全確認が完了するまで買い物操作はできません。</p>
          {storedProvenanceWarnings.map((warning) => (
            <p key={warning.warningKey}>
              {warning.sourceDisplayName}・{warning.allergenDisplayName}・
              {warning.memberDisplayName}
            </p>
          ))}
        </section>
      )}
      {safetyGate.checking && <p role="status">現在の家族設定で再確認しています</p>}
      {mutationError !== null && <p role="alert">{mutationError}</p>}
      {currentListWarnings.length > 0 && (
        <section className="card">
          <strong>加工品は原材料表示を確認</strong>
          {currentListWarnings.map((warning) => (
            <p key={warning.warningKey}>
              {warning.sourceDisplayName}・{warning.allergenDisplayName}・
              {warning.memberDisplayName}
            </p>
          ))}
        </section>
      )}
      {sections.map((section) => {
        const items = list.items.filter((item) => item.storeSection === section);
        return items.length === 0 ? null : (
          <section key={section} aria-labelledby={`section-${section}`}>
            <h2 id={`section-${section}`}>{categoryLabel(section)}</h2>
            <ul className="stack">
              {items.map((item) => (
                <ShoppingItemRow
                  key={item.id}
                  item={item}
                  disabled={safetyBlocked}
                  currentLabelWarnings={safetyGate.currentLabelWarnings.filter(
                    (warning) => warning.itemId === item.id,
                  )}
                  onChecked={(id, value) => {
                    void mutate({
                      operation: "set_checked",
                      itemId: id,
                      payload: { isChecked: value },
                    });
                  }}
                  onEdit={(target) => {
                    setEditingItem(target);
                    setEditingQuantity(String(target.quantityValue ?? ""));
                    setEditingQuantityText(target.quantityText);
                    setEditingUnit(target.unit ?? "");
                    setEditingSection(target.storeSection);
                    setFieldError(null);
                  }}
                  onAtHome={(id) => {
                    void mutate({ operation: "mark_at_home", itemId: id, payload: {} });
                  }}
                  onRemove={(target) => {
                    void mutate({ operation: "remove", itemId: target.id, payload: {} });
                  }}
                  onUndo={(id) => {
                    void mutate({ operation: "undo", itemId: id, payload: {} });
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {editingItem !== null && (
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault();
            const quantity = editingQuantity.trim() === "" ? null : Number(editingQuantity);
            if (
              editingQuantityText.trim() === "" ||
              (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
            ) {
              setFieldError("分量を確認してください");
              requestAnimationFrame(() => editFirstField.current?.focus());
              return;
            }
            void mutate({
              operation: "edit",
              itemId: editingItem.id,
              payload: {
                displayName: editingItem.displayName,
                normalizedName: normalizeIngredientName(
                  editingItem.displayName,
                  reviewedShoppingAliases,
                ),
                storeSection: editingSection,
                quantityValue: quantity,
                quantityText: editingQuantityText.trim(),
                unit: editingUnit.trim() === "" ? null : editingUnit.trim(),
              },
            }).then(() => {
              setEditingItem(null);
            });
          }}
        >
          <h2>{editingItem.displayName}を編集</h2>
          {fieldError !== null && <p role="alert">{fieldError}</p>}
          <label>
            数値（任意）
            <input
              ref={editFirstField}
              aria-label={`${editingItem.displayName}の数量`}
              type="number"
              min="0.001"
              step="0.001"
              value={editingQuantity}
              onChange={(event) => {
                setEditingQuantity(event.target.value);
              }}
            />
          </label>
          <label>
            表示する分量
            <input
              aria-label={`${editingItem.displayName}の分量表記`}
              aria-required="true"
              value={editingQuantityText}
              onChange={(event) => {
                setEditingQuantityText(event.target.value);
              }}
            />
          </label>
          <label>
            単位（任意）
            <input
              aria-label={`${editingItem.displayName}の単位`}
              maxLength={24}
              value={editingUnit}
              onChange={(event) => {
                setEditingUnit(event.target.value);
              }}
            />
          </label>
          <label>
            売り場
            <select
              aria-label={`${editingItem.displayName}の売り場`}
              value={editingSection}
              onChange={(event) => {
                const selected = sections.find((item) => item === event.target.value);
                if (selected !== undefined) setEditingSection(selected);
              }}
            >
              {sections.map((section) => (
                <option key={section} value={section}>
                  {categoryLabel(section)}
                </option>
              ))}
            </select>
          </label>
          <button disabled={safetyBlocked} className="primary-button min-h-11" type="submit">
            変更を保存
          </button>
          <button
            className="text-button min-h-11"
            type="button"
            onClick={() => {
              setEditingItem(null);
            }}
          >
            キャンセル
          </button>
        </form>
      )}
      {adding ? (
        <form
          className="card stack"
          onSubmit={(event) => {
            void submitManual(event);
          }}
        >
          {fieldError !== null && <p role="alert">{fieldError}</p>}
          <label className="field">
            項目名
            <input
              ref={manualFirstField}
              aria-label="項目名"
              aria-required="true"
              maxLength={100}
              value={manualName}
              onChange={(event) => {
                setManualName(event.target.value);
              }}
            />
          </label>
          <label className="field">
            数値（任意）
            <input
              aria-label="数量"
              type="number"
              min="0.001"
              step="0.001"
              value={manualQuantity}
              onChange={(event) => {
                setManualQuantity(event.target.value);
              }}
            />
          </label>
          <label className="field">
            表示する分量
            <input
              aria-label="分量表記"
              aria-required="true"
              maxLength={60}
              value={manualQuantityText}
              onChange={(event) => {
                setManualQuantityText(event.target.value);
              }}
            />
          </label>
          <label className="field">
            単位（任意）
            <input
              aria-label="単位"
              maxLength={24}
              value={manualUnit}
              onChange={(event) => {
                setManualUnit(event.target.value);
              }}
            />
          </label>
          <label className="field">
            売り場
            <select
              aria-label="売り場"
              value={manualSection}
              onChange={(event) => {
                const selected = sections.find((item) => item === event.target.value);
                if (selected !== undefined) setManualSection(selected);
              }}
            >
              {sections.map((section) => (
                <option key={section} value={section}>
                  {categoryLabel(section)}
                </option>
              ))}
            </select>
          </label>
          <button disabled={safetyBlocked} className="primary-button min-h-11" type="submit">
            追加する
          </button>
          <button
            className="text-button min-h-11"
            type="button"
            onClick={() => {
              setAdding(false);
            }}
          >
            キャンセル
          </button>
        </form>
      ) : (
        <button
          disabled={safetyBlocked}
          className="primary-button min-h-11"
          type="button"
          onClick={() => {
            setAdding(true);
          }}
        >
          ＋ 項目を追加
        </button>
      )}
    </main>
  );
}
