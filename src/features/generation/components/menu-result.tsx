import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  pantryItemInputSchema,
  type PantryItem,
  type PantryItemInput,
} from "@shared/contracts/pantry";
import type { MenuResultViewModel, PantryPostCookTarget } from "../api/menu-result-api";
import { PantryVersionConflictError } from "@/features/pantry/pantry-api";
import { MenuDishes } from "@/features/menu-detail/menu-dishes";
import { MenuHero } from "@/features/menu-detail/menu-hero";
import { MenuSteps } from "@/features/menu-detail/menu-steps";
import { Button } from "@/shared/ui/button";
import { Stack } from "@/shared/ui/stack";

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
  onRegenerateSelectedDish,
  regenerateSelectedDishDisabled = false,
  postCookOpen = false,
  onPostCookClose,
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
  /**
   * 選択中の一品だけ再生成する操作。
   * 渡されたときだけ料理タブパネル内にボタンを出す
   * （操作バーでは対象料理が直感で分かりにくいため）。
   */
  onRegenerateSelectedDish?: () => void;
  /** 再検証中など、一品再生成を一時的に止めたいとき */
  regenerateSelectedDishDisabled?: boolean;
  /**
   * 使った食材の在庫更新ダイアログを開く。
   * ページ操作バーから制御する（インライン section にスクロールしない）。
   */
  postCookOpen?: boolean;
  onPostCookClose?: () => void;
}) {
  // 省略時は result.targetMode を正とする（既定 "household" による idea 誤表示を防ぐ）。
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
  const postCookDialogRef = useRef<HTMLDialogElement>(null);
  const postCookTitleId = useId();

  useEffect(() => {
    if (selected !== null) onSelectedDishChange?.(selected.id);
  }, [onSelectedDishChange, selected]);

  // 親が postCookOpen を true にしたら modal を開く。閉じる操作は親の onPostCookClose に委ねる。
  // dialog 本体に .stack（display:grid）を付けない（UA の display:none 上書き防止）。
  useEffect(() => {
    const dialog = postCookDialogRef.current;
    if (!postCookOpen || !dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [postCookOpen]);

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
    // G14: 確認 POST は再検証ゲートの現行 fingerprint のみ。保存行 requirement へフォールバック
    // すると live 欠落時に stale FP を送り、サーバ 404 と「条件変更」表示の区別が崩れる。
    const fingerprint = currentSafetyFingerprint;
    if (fingerprint === undefined || fingerprint.length === 0) {
      // G9: 専用 code は写像拡大しない。stale/条件変更の再確認導線だけ汎用文言へ補足する
      setLiveMessage("確認を保存できませんでした。条件が変わった場合は献立を開き直してください。");
      return;
    }
    setBusy(true);
    setConfirmingId(confirmationId);
    try {
      await actions.onConfirmLabel(confirmationId, fingerprint);
      // 「確認済み＝安全」と誤読させない。手続きの記録完了だけを伝える。
      setLiveMessage("原材料表示の確認を記録しました");
    } catch {
      // 古い警告・stale fingerprint はゲート再閉鎖を呼び出し側に委ねる。
      // G9: confirmation_not_found 畳み込みのまま、条件変更時の開き直しを促す
      setLiveMessage("確認を保存できませんでした。条件が変わった場合は献立を開き直してください。");
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
    // PANTRY-M1: フォームと同じ pantryItemInputSchema で scale/上限を先に弾く
    const inputParsed = pantryItemInputSchema.safeParse({
      name: row.name,
      quantity,
      unit,
      expiresOn: row.expiresOn,
      expirationType: row.expirationType,
      openedState: row.openedState,
    });
    if (!inputParsed.success) {
      const first = inputParsed.error.issues[0]?.message;
      setLiveMessage(
        first !== undefined && first.trim() !== "" ? first : "分量の入力内容を確認してください",
      );
      return;
    }
    setBusy(true);
    setConflictMessage(null);
    try {
      await actions.onUpdatePantry(row, inputParsed.data);
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

  // main はページ枠（MenuResultPage / HistoryDetailPage）が1つだけ持つ。
  // ここに main を置くと操作バー等を包めず、ネスト landmark 違反にもなる。
  // 横 padding はページ枠が持つ。本文で再付与すると狭い幅で二重余白になり、
  // 子の min-content がはみ出しやすくなるため付けない。
  // idea の AI/免責注意はページ枠の IdeaMenuSafetyNotice に集約するため、
  // 本文側では household だけ AI 作成バナーを出す（二重表示防止）。
  // 見出しを先に置き、注意枠が成功タイトルに密着しないよう縦リズムを分ける。
  // sticky タブ列と材料 grid は Surface では表現できないため .menu-result-* へ退避。
  return (
    <div className="menu-result">
      <MenuHero
        totalElapsedMinutes={menu.totalElapsedMinutes}
        servings={menu.servings}
        generationModelId={result.generationModelId}
      />
      {mode !== "idea" ? (
        <p className="menu-result-ai-notice">
          <strong>AIが作成した献立です。</strong>{" "}
          内容、加熱状態、家庭内での混入を調理前に確認してください。
        </p>
      ) : null}
      {/* A-I7: 苦手 soft gap — 生成結果画面のみ（view model が空なら履歴側） */}
      {result.preferenceGaps.length > 0 && (
        <section className="menu-result-soft-gap" role="status" aria-label="希望条件の注意">
          <strong className="menu-result-soft-gap-title">苦手の希望について</strong>
          <ul className="menu-result-soft-gap-list">
            {result.preferenceGaps.map((gap) => (
              <li key={`${gap.anonymousMemberRef}:${gap.dislikeToken}`}>{gap.message}</li>
            ))}
          </ul>
        </section>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
      {/* 在庫更新ダイアログを開いている間は dialog 内だけに出し、二重表示しない */}
      {conflictMessage !== null && !postCookOpen && (
        <p role="alert" className="menu-result-alert">
          {conflictMessage}
        </p>
      )}

      <MenuSteps timeline={menu.timeline} dishes={menu.dishes} />

      <MenuDishes
        dishes={menu.dishes}
        selected={selected}
        selectedId={selectedId}
        mode={mode}
        selectedAdaptations={selectedAdaptations}
        memberLabels={result.memberLabels}
        labels={labels}
        onSelectDish={setSelectedId}
        onTabKeyDown={handleTabKeyDown}
        {...(onRegenerateSelectedDish !== undefined
          ? { onRegenerateSelectedDish, regenerateSelectedDishDisabled }
          : {})}
        canConfirmLabel={actions !== undefined && actions.onConfirmLabel !== undefined}
        confirmingId={confirmingId}
        busy={busy}
        onConfirmLabel={(confirmationId) => {
          void handleConfirmLabel(confirmationId);
        }}
      />

      <section aria-labelledby="pantry-heading" className="menu-result-card">
        <h2 id="pantry-heading" className="menu-result-section-title">
          冷蔵庫食材の使い方
        </h2>
        {menu.pantryUsage.length === 0 ? (
          <p className="menu-result-section-lead">今回選んだ冷蔵庫食材はありません。</p>
        ) : (
          <ul className="menu-result-pantry-list">
            {menu.pantryUsage.map((item) => {
              // PANTRY-I1 / design §10.3: 使用料理（使用先）を dishIds から組み立てる
              const dishNames =
                item.usageStatus === "used"
                  ? item.dishIds
                      .map((dishId) => menu.dishes.find((dish) => dish.id === dishId)?.name)
                      .filter((name): name is string => name !== undefined && name.trim() !== "")
                  : [];
              return (
                <li key={item.selectionId} className="menu-result-pantry-item">
                  <strong>{item.pantryItemName}</strong>
                  {item.usageStatus === "used" ? (
                    <>
                      <p>
                        使用予定 {amount(item.plannedQuantity, item.unit, "分量を確認")}／在庫{" "}
                        {amount(item.inventoryQuantity, item.unit, "在庫量を確認")}
                        {item.shortageQuantity !== null &&
                          item.shortageQuantity > 0 &&
                          `／不足 ${amount(item.shortageQuantity, item.unit, "")}`}
                      </p>
                      {dishNames.length > 0 ? (
                        <p className="type-small">使用先: {dishNames.join("・")}</p>
                      ) : null}
                    </>
                  ) : (
                    <p>使わなかった理由: {item.unusedReason}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 使った食材の在庫更新は家族安全と分離し、所有者/version 検査だけで更新できる。
          idea でも actions 付きなら操作可。read-only idea（actions なし）では出さない。
          インライン section ではなく native dialog で、操作バーから開く。 */}
      {postCookOpen &&
        result.pantryPostCookTargets.length > 0 &&
        (mode === "household" || actions !== undefined) && (
          <dialog
            ref={postCookDialogRef}
            aria-labelledby={postCookTitleId}
            aria-modal="true"
            onCancel={(event) => {
              // Escape / 背面クリックの native close を止め、親の close に委ねる
              event.preventDefault();
              if (busy) return;
              setDeletePendingId(null);
              setRemainderTargetId(null);
              setRemainderQty("");
              setRemainderUnit("");
              onPostCookClose?.();
            }}
            className="menu-result-dialog"
          >
            <Stack gap={4}>
              <h2 id={postCookTitleId} className="menu-result-dialog-title">
                使った食材の在庫を更新
              </h2>
              <p className="menu-result-dialog-lead">
                作り終わったら、使った食材を「使い切った」か「まだある」で記録します。AIが自動では減らしません。
              </p>
              {conflictMessage !== null && (
                <p role="alert" className="menu-result-dialog-alert">
                  {conflictMessage}
                </p>
              )}
              <ul className="menu-result-post-cook-list">
                {result.pantryPostCookTargets.map((target) => {
                  const isDeleted = deletedSelectionIds.has(target.selectionId);
                  const live = target.currentPantryRow;
                  return (
                    <li key={target.selectionId} className="menu-result-post-cook-item">
                      <strong>{target.pantryItemName}</strong>
                      {target.liveUnavailable ? (
                        <p className="menu-result-post-cook-deleted">
                          冷蔵庫の最新状態を確認できません
                        </p>
                      ) : isDeleted || live === null || target.pantryItemId === null ? (
                        <p className="menu-result-post-cook-deleted">冷蔵庫から削除済み</p>
                      ) : (
                        <>
                          <div className="menu-result-post-cook-actions">
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                setDeletePendingId(target.selectionId);
                                setRemainderTargetId(null);
                              }}
                            >
                              使い切った
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                setRemainderTargetId(target.selectionId);
                                setDeletePendingId(null);
                              }}
                            >
                              まだある
                            </Button>
                          </div>
                          {deletePendingId === target.selectionId && (
                            <div className="menu-result-post-cook-confirm">
                              <p>この食材を冷蔵庫から削除しますか？</p>
                              <div className="menu-result-post-cook-confirm-actions">
                                <Button
                                  variant="primary"
                                  disabled={busy}
                                  onClick={() => {
                                    void handleDeleteConfirm(target);
                                  }}
                                >
                                  削除する
                                </Button>
                                <Button
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setDeletePendingId(null);
                                  }}
                                >
                                  やめる
                                </Button>
                              </div>
                            </div>
                          )}
                          {remainderTargetId === target.selectionId && (
                            <div className="menu-result-remainder-form">
                              <label className="menu-result-field">
                                残りの分量（任意）
                                <input
                                  className="menu-result-field-input"
                                  inputMode="decimal"
                                  value={remainderQty}
                                  onChange={(event) => {
                                    setRemainderQty(event.target.value);
                                  }}
                                />
                              </label>
                              <label className="menu-result-field">
                                単位
                                <input
                                  className="menu-result-field-input"
                                  value={remainderUnit}
                                  onChange={(event) => {
                                    setRemainderUnit(event.target.value);
                                  }}
                                />
                              </label>
                              <Button
                                variant="primary"
                                disabled={busy}
                                onClick={() => {
                                  void handleUpdateRemainder(target);
                                }}
                              >
                                分量を保存
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                      {undo?.selectionId === target.selectionId && (
                        <div className="menu-result-undo">
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              void handleUndo();
                            }}
                          >
                            元に戻す
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDeletePendingId(null);
                  setRemainderTargetId(null);
                  setRemainderQty("");
                  setRemainderUnit("");
                  onPostCookClose?.();
                }}
              >
                閉じる
              </Button>
            </Stack>
          </dialog>
        )}
    </div>
  );
}
