import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { PantryItem, PantryItemInput } from "@shared/contracts/pantry";
import type { MenuResultViewModel, PantryPostCookTarget } from "../api/menu-result-api";
import { PantryVersionConflictError } from "@/features/pantry/pantry-api";

const roleLabels = {
  main: "主菜",
  side: "副菜",
  soup: "汁物",
  staple: "主食",
  other: "料理",
} as const;
const amount = (value: number | null, unit: string | null, text: string) =>
  value === null ? text : `${String(value)}${unit ?? ""}`;

export type MenuResultActions = {
  menuId: string;
  userId: string;
  /**
   * 原材料表示確認。household のみ渡す。
   * idea は label 領域自体を出さないため callback を作らない。
   */
  onConfirmLabel?(confirmationId: string, expectedSafetyFingerprint: string): Promise<void>;
  onDeletePantry(row: NonNullable<PantryPostCookTarget["currentPantryRow"]>): Promise<void>;
  onUpdatePantry(
    row: NonNullable<PantryPostCookTarget["currentPantryRow"]>,
    input: PantryItemInput,
  ): Promise<void>;
  onCreatePantry(input: PantryItemInput): Promise<void>;
  onRefetchResult(): Promise<void>;
};

/** 表示用の現行ラベル警告（再検証ゲートまたは単体テストの注入） */
export type MenuResultLabelWarning = {
  confirmationId: string;
  sourceId: string;
  sourceText: string;
  allergenName: string;
  memberLabel: string;
  dictionaryVersion: string;
  confirmationStatus: "pending" | "confirmed";
};

type UndoState = {
  selectionId: string;
  snapshot: Pick<
    PantryItem,
    "name" | "quantity" | "unit" | "expiresOn" | "expirationType" | "openedState"
  >;
};

export function MenuResult({
  result,
  actions,
  mode: modeProp,
  currentLabelWarnings,
  currentSafetyFingerprint,
  onSelectedDishChange,
}: {
  result: MenuResultViewModel;
  actions?: MenuResultActions;
  /**
   * idea では家族向け取り分け・原材料表示確認を表示しない。
   * 調理後の冷蔵庫反映は所有・version 競合検査だけで済むため idea でも許可する
   * （actions が渡されたときだけ操作 UI を出す）。
   * 省略時は result.targetMode を正とする（既定 household による誤表示を防ぐ）。
   */
  mode?: "household" | "idea";
  /**
   * 現行安全ゲートが返した警告だけを表示する。
   * 指定時は Plan 3 の保存リストを現行権限として使わない。
   * 未指定の単体テストでは保存リストへフォールバックする。
   */
  currentLabelWarnings?: readonly MenuResultLabelWarning[];
  /** 確認 POST に載せる現行 fingerprint。再検証結果を正とする。 */
  currentSafetyFingerprint?: string;
  onSelectedDishChange?: (dishId: string) => void;
}) {
  // prop 省略・不一致の footgun を閉じる。呼び出し側が明示しても result と食い違う場合は result を正とする。
  const mode = modeProp ?? result.targetMode;
  const { menu } = result;
  const firstDish = menu.dishes.at(0);
  // hooks は early return より前に置き、dish 不在はレンダー時に分岐する
  const [selectedId, setSelectedId] = useState(firstDish?.id ?? "");
  const selected = menu.dishes.find((dish) => dish.id === selectedId) ?? firstDish ?? null;
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [remainderTargetId, setRemainderTargetId] = useState<string | null>(null);
  const [remainderQty, setRemainderQty] = useState("");
  const [remainderUnit, setRemainderUnit] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  // 削除完了後は mutation 制御を出さない（aggregate 再接続しない）
  const [deletedSelectionIds, setDeletedSelectionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected !== null) onSelectedDishChange?.(selected.id);
  }, [onSelectedDishChange, selected]);

  const sourceIds = useMemo(() => {
    if (selected === null) return new Set<string>();
    return new Set([
      selected.id,
      ...selected.ingredients.map((item) => item.id),
      ...selected.steps.map((step) => step.id),
      ...menu.adaptations.filter((item) => item.dishId === selected.id).map((item) => item.id),
    ]);
  }, [menu.adaptations, selected]);

  // ゲート通過後は currentLabelWarnings のみ。未注入の単体表示だけ保存リストを使う。
  const labels: readonly MenuResultLabelWarning[] = useMemo(() => {
    if (currentLabelWarnings !== undefined) {
      return currentLabelWarnings.filter((item) => sourceIds.has(item.sourceId));
    }
    return result.labelConfirmations
      .filter((item) => sourceIds.has(item.sourceId))
      .map((item) => ({
        confirmationId: item.confirmationId,
        sourceId: item.sourceId,
        sourceText: item.sourceText,
        allergenName: item.allergenName,
        memberLabel: item.memberLabel,
        dictionaryVersion: item.dictionaryVersion,
        confirmationStatus: item.confirmationStatus,
      }));
  }, [currentLabelWarnings, result.labelConfirmations, sourceIds]);
  const selectedAdaptations =
    selected === null ? [] : menu.adaptations.filter((item) => item.dishId === selected.id);

  if (firstDish === undefined || selected === null) {
    return <p role="alert">献立の料理を表示できません</p>;
  }

  const selectByIndex = (index: number) => {
    const next = menu.dishes[(index + menu.dishes.length) % menu.dishes.length];
    if (next !== undefined) {
      setSelectedId(next.id);
      document.getElementById(`tab-${next.id}`)?.focus();
    }
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, dishId: string) => {
    const index = menu.dishes.findIndex((item) => item.id === dishId);
    if (event.key === "ArrowRight") selectByIndex(index + 1);
    else if (event.key === "ArrowLeft") selectByIndex(index - 1);
    else if (event.key === "Home") selectByIndex(0);
    else if (event.key === "End") selectByIndex(menu.dishes.length - 1);
    else return;
    event.preventDefault();
  };

  const handleConfirmLabel = async (confirmationId: string): Promise<void> => {
    if (actions === undefined || actions.onConfirmLabel === undefined || busy) return;
    // 現行ゲートの fingerprint を正とし、保存行の古い fingerprint は使わない
    const fingerprint =
      currentSafetyFingerprint ??
      result.labelConfirmations.find((item) => item.confirmationId === confirmationId)
        ?.requirementSafetyFingerprint;
    if (fingerprint === undefined) {
      setLiveMessage("確認を保存できませんでした");
      return;
    }
    setBusy(true);
    setConfirmingId(confirmationId);
    try {
      await actions.onConfirmLabel(confirmationId, fingerprint);
      setLiveMessage("原材料表示を確認済みにしました");
    } catch {
      // 古い警告・stale fingerprint はゲート再閉鎖を呼び出し側に委ねる
      setLiveMessage("確認を保存できませんでした");
    } finally {
      setConfirmingId(null);
      setBusy(false);
    }
  };

  const handleDeleteConfirm = async (target: PantryPostCookTarget): Promise<void> => {
    if (actions === undefined || target.currentPantryRow === null || busy) return;
    const row = target.currentPantryRow;
    setBusy(true);
    setConflictMessage(null);
    try {
      await actions.onDeletePantry(row);
      setDeletedSelectionIds((prev) => new Set([...prev, target.selectionId]));
      setUndo({
        selectionId: target.selectionId,
        snapshot: {
          name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          expiresOn: row.expiresOn,
          expirationType: row.expirationType,
          openedState: row.openedState,
        },
      });
      setDeletePendingId(null);
      setLiveMessage("冷蔵庫から削除しました");
      await actions.onRefetchResult();
    } catch (error) {
      if (error instanceof PantryVersionConflictError) {
        setConflictMessage(error.message);
        await actions.onRefetchResult();
      } else {
        setLiveMessage("食材を削除できませんでした");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async (): Promise<void> => {
    if (actions === undefined || undo === null || busy) return;
    setBusy(true);
    try {
      await actions.onCreatePantry({
        name: undo.snapshot.name,
        quantity: undo.snapshot.quantity,
        unit: undo.snapshot.unit,
        expiresOn: undo.snapshot.expiresOn,
        expirationType: undo.snapshot.expirationType,
        openedState: undo.snapshot.openedState,
      });
      setUndo(null);
      setLiveMessage("冷蔵庫に新しい食材として戻しました");
    } catch {
      setLiveMessage("元に戻せませんでした");
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateRemainder = async (target: PantryPostCookTarget): Promise<void> => {
    if (actions === undefined || target.currentPantryRow === null || busy) return;
    const row = target.currentPantryRow;
    const trimmedQty = remainderQty.trim();
    const trimmedUnit = remainderUnit.trim();
    // 空は意図的に null/null。数値は単位必須。
    let quantity: number | null = null;
    let unit: string | null = null;
    if (trimmedQty !== "") {
      const parsed = Number(trimmedQty);
      if (!Number.isFinite(parsed) || parsed <= 0 || trimmedUnit === "") {
        setLiveMessage("分量と単位は両方入力してください");
        return;
      }
      quantity = parsed;
      unit = trimmedUnit;
    }
    setBusy(true);
    setConflictMessage(null);
    try {
      await actions.onUpdatePantry(row, {
        name: row.name,
        quantity,
        unit,
        expiresOn: row.expiresOn,
        expirationType: row.expirationType,
        openedState: row.openedState,
      });
      setRemainderTargetId(null);
      setRemainderQty("");
      setRemainderUnit("");
      setLiveMessage("冷蔵庫の分量を更新しました");
      await actions.onRefetchResult();
    } catch (error) {
      if (error instanceof PantryVersionConflictError) {
        // 選択と入力は保持し、無条件リトライはしない
        setConflictMessage(error.message);
        await actions.onRefetchResult();
      } else {
        setLiveMessage("食材を更新できませんでした");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
      <p className="rounded-xl border border-amber-700 bg-amber-50 p-3 text-sm">
        <strong>AIが作成した献立です。</strong>{" "}
        内容、加熱状態、家庭内での混入を調理前に確認してください。
      </p>
      <h1 className="mt-5 text-2xl font-bold">献立ができました</h1>
      <p className="mt-2 text-lg font-semibold">
        食卓まで約{menu.totalElapsedMinutes}分・{menu.servings}人分
      </p>
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
      {conflictMessage !== null && (
        <p role="alert" className="mt-3 rounded-xl border border-amber-700 bg-amber-50 p-3">
          {conflictMessage}
        </p>
      )}

      <section
        aria-labelledby="timeline-heading"
        className="mt-6 rounded-2xl bg-white p-4 shadow-sm"
      >
        <h2 id="timeline-heading" className="text-xl font-bold">
          全体の段取り
        </h2>
        <ol className="mt-3 space-y-3">
          {menu.timeline.map((step) => (
            <li
              key={step.id}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-l-4 border-terracotta-500 pl-3"
            >
              <span className="font-semibold">{step.startMinute}分〜</span>
              <span>
                {step.instruction}
                <span className="block text-sm text-stone-600">目安 {step.durationMinutes}分</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div
        role="tablist"
        aria-label="料理"
        className="sticky top-0 z-10 mt-6 flex gap-2 overflow-x-auto bg-stone-50 py-2"
      >
        {menu.dishes.map((dish) => (
          <button
            key={dish.id}
            id={`tab-${dish.id}`}
            type="button"
            role="tab"
            aria-selected={dish.id === selectedId}
            aria-controls={`panel-${dish.id}`}
            tabIndex={dish.id === selectedId ? 0 : -1}
            onClick={() => {
              setSelectedId(dish.id);
            }}
            onKeyDown={(event) => {
              handleTabKeyDown(event, dish.id);
            }}
            className="min-h-11 shrink-0 rounded-full border-2 px-4 font-semibold aria-selected:border-terracotta-700 aria-selected:bg-terracotta-100"
          >
            {roleLabels[dish.role]}・{dish.name}
          </button>
        ))}
      </div>

      <article
        id={`panel-${selected.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${selected.id}`}
        className="rounded-2xl bg-white p-4 shadow-sm"
      >
        <h2 className="text-xl font-bold">{selected.name}</h2>
        <p>{selected.description}</p>
        <h3 className="mt-5 text-lg font-bold">材料</h3>
        <ul className="divide-y">
          {selected.ingredients.map((item) => (
            <li
              key={item.id}
              className="grid min-h-11 grid-cols-[minmax(0,1fr)_minmax(0,45%)] items-center gap-3 py-2"
            >
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {item.name}
                {item.labelConfirmationRequired && (
                  <span className="ml-2 rounded border border-amber-700 px-2 text-sm">
                    ラベル確認
                  </span>
                )}
              </span>
              <span className="min-w-0 w-full break-words text-right [overflow-wrap:anywhere]">
                {amount(item.quantityValue, item.unit, item.quantityText)}
              </span>
            </li>
          ))}
        </ul>
        <h3 className="mt-5 text-lg font-bold">作り方</h3>
        <ol className="mt-2 space-y-3">
          {selected.steps.map((step) => (
            <li key={step.id} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
              <span className="font-bold">{step.position}</span>
              <span>{step.instruction}</span>
            </li>
          ))}
        </ol>
        {mode === "household" && (
          <>
            <h3 className="mt-5 text-lg font-bold">家族向けの取り分け</h3>
            {selectedAdaptations.length === 0 ? (
              <p className="mt-2">この料理の取り分け案はありません。</p>
            ) : (
              selectedAdaptations.map((item) => (
                <dl key={item.id} className="mt-2 rounded-xl bg-stone-50 p-3">
                  <dt className="font-bold">
                    {result.memberLabels[item.anonymousMemberRef] ?? "家族"}・{item.portionText}
                  </dt>
                  <dd>
                    分ける前: 手順
                    {
                      selected.steps.find((step) => step.id === item.branchBeforeRecipeStepId)
                        ?.position
                    }
                  </dd>
                  {item.additionalCutting && <dd>切り方: {item.additionalCutting}</dd>}
                  {item.additionalHeating && <dd>加熱: {item.additionalHeating}</dd>}
                  {item.additionalSeasoning && <dd>味付け: {item.additionalSeasoning}</dd>}
                  <dd>配膳時: {item.servingCheck}</dd>
                  {item.safetyActions.length !== 0 && (
                    <dd>
                      <strong>安全のための手順</strong>
                      <ul>
                        {item.safetyActions.map((action, index) => (
                          <li key={`${action.beforeRecipeStepId}-${String(index)}`}>
                            {action.instruction}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  )}
                </dl>
              ))
            )}
          </>
        )}
        {mode === "household" && labels.length !== 0 && (
          <section
            aria-labelledby="label-confirmations-heading"
            className="mt-5 rounded-xl border border-amber-700 bg-amber-50 p-3"
          >
            <h3 id="label-confirmations-heading" className="font-bold">
              原材料表示の確認
            </h3>
            <p className="font-semibold">加工品は原材料表示を確認してください</p>
            <ul className="space-y-3">
              {labels.map((item) => (
                <li key={item.confirmationId} className="break-words">
                  {item.sourceText}：{item.allergenName}（{item.memberLabel}）
                  <span className="block text-sm text-stone-600">
                    辞書版 {item.dictionaryVersion}
                  </span>
                  {item.confirmationStatus === "confirmed" ? (
                    <span className="mt-1 inline-block rounded bg-stone-200 px-2 text-sm">
                      確認済み
                    </span>
                  ) : actions === undefined ? null : (
                    <button
                      type="button"
                      className="mt-2 min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-3 font-semibold"
                      disabled={busy || confirmingId === item.confirmationId}
                      onClick={() => {
                        void handleConfirmLabel(item.confirmationId);
                      }}
                    >
                      本人が商品の原材料表示を確認しました
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      <section aria-labelledby="pantry-heading" className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <h2 id="pantry-heading" className="text-xl font-bold">
          冷蔵庫食材の使い方
        </h2>
        {menu.pantryUsage.length === 0 ? (
          <p className="mt-2">今回選んだ冷蔵庫食材はありません。</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {menu.pantryUsage.map((item) => (
              <li key={item.selectionId} className="rounded-xl border p-3">
                <strong>{item.pantryItemName}</strong>
                {item.usageStatus === "used" ? (
                  <p>
                    使用予定 {amount(item.plannedQuantity, item.unit, "分量を確認")}／在庫{" "}
                    {amount(item.inventoryQuantity, item.unit, "在庫量を確認")}
                    {item.shortageQuantity !== null &&
                      item.shortageQuantity > 0 &&
                      `／不足 ${amount(item.shortageQuantity, item.unit, "")}`}
                  </p>
                ) : (
                  <p>使わなかった理由: {item.unusedReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 調理後の冷蔵庫は家族安全と分離し、所有者/version 検査だけで更新できる。
          idea でも actions 付きなら表示する。read-only idea（actions なし）では出さない。 */}
      {result.pantryPostCookTargets.length > 0 &&
        (mode === "household" || actions !== undefined) && (
          <section
            aria-labelledby="post-cook-heading"
            className="mt-6 rounded-2xl bg-white p-4 shadow-sm"
          >
            <h2 id="post-cook-heading" className="text-xl font-bold">
              調理後の冷蔵庫
            </h2>
            <ul className="mt-3 space-y-4">
              {result.pantryPostCookTargets.map((target) => {
                const isDeleted = deletedSelectionIds.has(target.selectionId);
                const live = target.currentPantryRow;
                return (
                  <li key={target.selectionId} className="rounded-xl border p-3">
                    <strong>{target.pantryItemName}</strong>
                    {isDeleted || live === null || target.pantryItemId === null ? (
                      <p className="mt-1">冷蔵庫から削除済み</p>
                    ) : (
                      <>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
                            disabled={busy}
                            onClick={() => {
                              setDeletePendingId(target.selectionId);
                              setRemainderTargetId(null);
                            }}
                          >
                            使い切った
                          </button>
                          <button
                            type="button"
                            className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
                            disabled={busy}
                            onClick={() => {
                              setRemainderTargetId(target.selectionId);
                              setDeletePendingId(null);
                            }}
                          >
                            まだある
                          </button>
                        </div>
                        {deletePendingId === target.selectionId && (
                          <div className="mt-3 rounded-lg bg-stone-50 p-3">
                            <p>この食材を冷蔵庫から削除しますか？</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="min-h-11 min-w-11 rounded-lg bg-terracotta-700 px-4 font-semibold text-white"
                                disabled={busy}
                                onClick={() => {
                                  void handleDeleteConfirm(target);
                                }}
                              >
                                削除する
                              </button>
                              <button
                                type="button"
                                className="min-h-11 min-w-11 rounded-lg border px-4 font-semibold"
                                disabled={busy}
                                onClick={() => {
                                  setDeletePendingId(null);
                                }}
                              >
                                やめる
                              </button>
                            </div>
                          </div>
                        )}
                        {remainderTargetId === target.selectionId && (
                          <div className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3">
                            <label className="block">
                              残りの分量（任意）
                              <input
                                className="mt-1 min-h-11 w-full rounded border px-2"
                                inputMode="decimal"
                                value={remainderQty}
                                onChange={(event) => {
                                  setRemainderQty(event.target.value);
                                }}
                              />
                            </label>
                            <label className="block">
                              単位
                              <input
                                className="mt-1 min-h-11 w-full rounded border px-2"
                                value={remainderUnit}
                                onChange={(event) => {
                                  setRemainderUnit(event.target.value);
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className="min-h-11 min-w-11 rounded-lg bg-terracotta-700 px-4 font-semibold text-white"
                              disabled={busy}
                              onClick={() => {
                                void handleUpdateRemainder(target);
                              }}
                            >
                              分量を保存
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {undo?.selectionId === target.selectionId && (
                      <button
                        type="button"
                        className="mt-2 min-h-11 min-w-11 rounded-lg border px-4 font-semibold"
                        disabled={busy}
                        onClick={() => {
                          void handleUndo();
                        }}
                      >
                        元に戻す
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
    </main>
  );
}
