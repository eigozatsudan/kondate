import { useRef, useState, type SyntheticEvent } from "react";
import {
  shoppingItemMutationRequestSchema,
  type ShoppingItem,
  type ShoppingItemMutationRequest,
  type StoreSection,
} from "@shared/contracts/shopping";
import { normalizeIngredientName } from "@shared/shopping/normalize";
import { reviewedShoppingAliases } from "@shared/shopping/reviewed-aliases";
import {
  claimItemMutationSticky,
  clearItemMutationMismatchGuard,
  clearPendingItemMutation,
  markItemMutationMismatchGuard,
  mutateShoppingItem,
  readPendingItemMutation,
  revalidateActiveShoppingList,
  shouldBlockItemMutationAfterMismatch,
  writePendingItemMutation,
  type PendingItemMutationSticky,
} from "../api/shopping-api";
import { categoryLabel } from "../category-label";
import { ShoppingItemRow } from "../components/shopping-item-row";
import { useShoppingList, useShoppingSafetyGate } from "../hooks/use-shopping-list";
import { historyPathForShopping } from "../shopping-intent";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";

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
  // 削除済みは既定非表示。mutation 成功後だけ pendingUndoIds に入れ確認行を出す（設計 L5）。
  const [pendingUndoIds, setPendingUndoIds] = useState<ReadonlySet<string>>(() => new Set());
  // SP-I7: hooks は early return より前に置く
  const mutationInFlight = useRef(false);
  // SHOP13 + SHOP2 + SHOP4 + SHOP6: 失応答後の同一操作再試行で idempotencyKey を再利用する。
  // SQL の request_hash は list version / safety fingerprint を含むため、
  // 「直前に送った完全な request」をそのまま再送し early replay で dual-apply を防ぐ。
  // localStorage に永続化し reload / 他タブでも dual add_manual を防ぐ。
  // SHOP6: 初回 sticky 未書込の並行 mint は claimItemMutationSticky（Web Locks）で直列化。
  // list_version_conflict / mismatch は未適用確定なので sticky を捨てる。
  // SHOP3: shopping_safety_fingerprint_changed は適用済み+early FP fail もあり得るため
  // sticky を保持し、同一 intent の再送鍵を固定して dual-add に転化させない。
  // SHOP2 (adversarial): ref / Storage は intentKey 単位 multi-slot。異 intent を clobber しない。
  // SHOP3 (adversarial): preflight の live FP が sticky と違うときは **同一 key のまま FP だけ
  // 書き戻して**再送する。適用済みなら hash mismatch → form abandon で dual-add を避ける。
  // SHOP1 (adversarial): mismatch 後の手動再入力は mismatch guard で 1 回確認ブロック（RLS 非緩和）。
  const pendingItemMutationRef = useRef(new Map<string, PendingItemMutationSticky>());
  const [itemMutationPending, setItemMutationPending] = useState(false);

  const itemStickyMapKey = (listId: string, intentKey: string) => `${listId}\0${intentKey}`;

  /** ref が空なら local/sessionStorage から intent 単位で復元（SHOP2 multi-slot）。 */
  const loadItemMutationSticky = (
    listId: string,
    intentKey: string,
  ): PendingItemMutationSticky | null => {
    const mapKey = itemStickyMapKey(listId, intentKey);
    const fromRef = pendingItemMutationRef.current.get(mapKey);
    if (fromRef !== undefined && fromRef.request.listId === listId) return fromRef;
    const fromStorage = readPendingItemMutation(listId, intentKey);
    if (fromStorage !== null) pendingItemMutationRef.current.set(mapKey, fromStorage);
    return fromStorage;
  };
  const saveItemMutationSticky = (sticky: PendingItemMutationSticky): void => {
    const mapKey = itemStickyMapKey(sticky.request.listId, sticky.intentKey);
    pendingItemMutationRef.current.set(mapKey, sticky);
    writePendingItemMutation(sticky.request.listId, sticky);
  };
  const dropItemMutationSticky = (listId: string, intentKey: string): void => {
    pendingItemMutationRef.current.delete(itemStickyMapKey(listId, intentKey));
    clearPendingItemMutation(listId, intentKey);
  };
  if (query.isPending)
    return (
      <main className="page-frame">
        <p role="status">買い物リストを読み込んでいます…</p>
      </main>
    );
  if (query.isError)
    return (
      <main className="page-frame stack">
        <h1>買い物リスト</h1>
        <section className="card stack">
          <p role="alert">買い物リストを読み込めませんでした。通信を確認してください。</p>
          <button
            type="button"
            className="primary-button min-h-11"
            onClick={() => {
              void query.refetch();
            }}
          >
            もう一度読み込む
          </button>
        </section>
      </main>
    );
  if (query.data === null)
    return (
      <main className="page-frame stack">
        <h1>買い物リスト</h1>
        <section className="card stack">
          <p>買い物リストは空です</p>
          <p>
            献立を作ったあと、結果画面や履歴から「買い物リスト」へ送れます。まだ献立がないときは、先に献立をつくってください。
          </p>
          <p className="type-small">買い物リストは、お店で買うもののメモとして使います。</p>
          <a className="primary-button min-h-11" href="/planner">
            献立を作る
          </a>
          <a className="secondary-button min-h-11" href={historyPathForShopping()}>
            履歴から選ぶ
          </a>
        </section>
      </main>
    );
  const list = query.data;
  // SP-I7: 項目 mutation 中も操作を止める（isFetching だけでは連打を防げない）
  const safetyBlocked = safetyGate.blocked || query.isFetching || itemMutationPending;
  const currentListWarnings = safetyGate.currentLabelWarnings.filter(
    (warning) => warning.itemId === null,
  );
  // ゲートが閉じている間だけ、作成時に保存した不変スナップショットを別枠で読む。
  // これは現行の権威ではなく、過去の記録として提示する。
  // 同じ source_warning_key はリスト行と項目行の両方に存在し得る（DB の一意索引が
  // そう設計されている）ため、所有者を含む鍵で必ず一意にする。取りこぼすと
  // アレルゲン警告そのものが画面から消える。
  const storedProvenanceWarnings = safetyGate.error
    ? [
        ...list.listLabelWarnings.map((warning) => ({ owner: "list", warning })),
        ...list.items.flatMap((item) =>
          item.labelWarnings.map((warning) => ({ owner: item.id, warning })),
        ),
      ]
    : [];
  // SP-I7: 項目操作を直列化し、連打による version conflict / 見た目ロールバックを防ぐ
  // 操作直前に list 単位 revalidate し、Realtime 欠落窓でも write 前に fail-closed
  // 戻り値 true = フォーム clear 可（成功、または mismatch 後の abandon）。
  // false = 失敗/中断（SHOP4: フォーム保持して同一内容再送）。
  const mutate = async (value: LocalShoppingItemMutation): Promise<boolean> => {
    if (safetyBlocked || safetyGate.safetyFingerprint === null) return false;
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setItemMutationPending(true);
    // 操作意図（key 再利用の照合）。list version / FP は含めない（それらは request 本体側）。
    const intentKey = JSON.stringify({
      operation: value.operation,
      itemId: value.itemId,
      payload: value.payload,
    });
    // true = UI フォームを閉じてよい（成功 or 適用済み abandon）
    let shouldClearUi = false;
    try {
      setMutationError(null);
      // SHOP1: mismatch abandon 後の同内容手動再入力。1 回目は送信せず確認を求め dual-add を縮退。
      // 2 回目（armed 消費）で新 key 送信を許可。RLS / request_hash 冪等は非緩和。
      if (
        value.operation === "add_manual" &&
        shouldBlockItemMutationAfterMismatch(list.id, intentKey)
      ) {
        setMutationError(
          "同じ内容はすでにリストへ追加済みの可能性があります。リストを確認し、まだ無ければもう一度「追加する」を押してください",
        );
        return false;
      }
      const live = await revalidateActiveShoppingList(list.id);
      // discriminated union: status==="valid" なら safetyFingerprint は非 null
      // sticky は捨てない（SHOP3: 適用済みロスト後の preflight invalid でも鍵を固定）。
      if (live.status !== "valid") {
        setMutationError("家族設定が変わりました。もう一度確認します");
        await safetyGate.refresh();
        return false;
      }
      // SHOP13: 同一意図の失応答再試行は直前 request（同一 idempotencyKey）を再送する。
      // early replay は hash（version 込み）一致で 200 を返し add_manual の二重 INSERT を防ぐ。
      // SHOP6: claim は sticky 読取→mint→書込を Web Locks で直列化し、両タブ同時初回
      // add_manual が別 UUID を mint する pre-write TOCTOU を閉じる。
      // SHOP2: claim / load は intentKey 単位。異 intent の slot は上書きしない。
      const fromRef = loadItemMutationSticky(list.id, intentKey);
      let claimed =
        fromRef !== null && fromRef.request.listId === list.id
          ? fromRef
          : await claimItemMutationSticky(list.id, intentKey, () =>
              shoppingItemMutationRequestSchema.parse({
                ...value,
                listId: list.id,
                expectedListVersion: list.version,
                expectedSafetyFingerprint: live.safetyFingerprint,
                idempotencyKey: crypto.randomUUID(),
              }),
            );
      // SHOP3: sticky が旧 expectedSafetyFingerprint を固定したまま世帯が変わると
      // SHOP10 early replay が shopping_safety_fingerprint_changed で永遠に失敗する。
      // 同一 idempotencyKey のまま live FP だけ書き戻す（version/payload は維持）。
      // - 未適用: 新 FP で apply 成功
      // - 適用済み: request_hash が旧 FP 込みのため idempotency_payload_mismatch
      //   → sticky drop + form abandon で dual-add を避ける
      if (claimed.request.expectedSafetyFingerprint !== live.safetyFingerprint) {
        claimed = {
          intentKey,
          request: shoppingItemMutationRequestSchema.parse({
            ...claimed.request,
            expectedSafetyFingerprint: live.safetyFingerprint,
          }),
        };
      }
      saveItemMutationSticky(claimed);
      const request = claimed.request;
      await mutateShoppingItem(request);
      // 成功（replay 含む）したら sticky を捨て、次の意図的な同内容 add は新 key になる
      dropItemMutationSticky(list.id, intentKey);
      clearItemMutationMismatchGuard(list.id, intentKey);
      shouldClearUi = true;
      // 成功時のみ確認行用 id を更新（失敗後の refetch でも pending を汚さない）
      if (
        value.itemId !== null &&
        (value.operation === "remove" || value.operation === "mark_at_home")
      ) {
        const id = value.itemId;
        setPendingUndoIds((prev) => new Set(prev).add(id));
      }
      if (value.itemId !== null && value.operation === "undo") {
        const id = value.itemId;
        setPendingUndoIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "list_version_conflict") {
        // early replay は version を見ない。conflict は未適用確定 → sticky 破棄して次回は新 body
        dropItemMutationSticky(list.id, intentKey);
        setMutationError("別の画面で更新されました。最新の内容を読み込みました");
      } else if (
        error instanceof Error &&
        "code" in error &&
        error.code === "shopping_safety_fingerprint_changed"
      ) {
        // SHOP3: 適用済み + 応答ロスト後に FP が変わると early の list FP lock が
        // fail する。sticky を捨てると次操作が新 key になり dual-add するため保持する。
        // 次回 mutate の preflight で live FP へ rebuild して再送する（上記 rebuild 枝）。
        setMutationError(
          "家族設定が変わりました。すでにリストへ反映済みの可能性があります。リストを確認してから操作してください",
        );
        await safetyGate.refresh();
      } else if (
        error instanceof Error &&
        "code" in error &&
        error.code === "idempotency_payload_mismatch"
      ) {
        // SHOP3: FP rebuild 後の hash mismatch は「旧 body で適用済み」の強い信号。
        // sticky を捨てフォームも閉じ、同一内容の即時新 key dual-add を避ける。
        // SHOP1: 手動再入力 dual-add は mismatch guard（1 回確認ブロック）でさらに縮退。
        dropItemMutationSticky(list.id, intentKey);
        if (value.operation === "add_manual") {
          markItemMutationMismatchGuard(list.id, intentKey);
        }
        setMutationError(
          "すでにリストへ反映済みの可能性があります。リストを確認してから操作してください",
        );
        shouldClearUi = true;
      } else {
        // 通信ロスト等 code 無し: sticky を残し同一 key で再送可能にする（SHOP13）
        setMutationError("買い物項目を更新できませんでした");
      }
    } finally {
      mutationInFlight.current = false;
      setItemMutationPending(false);
    }
    await query.refetch();
    return shouldClearUi;
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
    // SHOP4: 失敗時はフォームを clear しない（再入力ゆれによる dual-add 誘発を防ぐ）。
    // 成功時のみ clear + 追加フォームを閉じる。sticky 再利用と揃える。
    const ok = await mutate({
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
    if (!ok) return;
    setManualName("");
    setManualQuantity("");
    setManualQuantityText("数量未入力");
    setManualUnit("");
    setFieldError(null);
    setAdding(false);
  };
  // SHOP5: manual 追加（SHOP4）と同型。mutate false ではエディタを閉じず値を保持する。
  const submitEdit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (editingItem === null) return;
    const quantity = editingQuantity.trim() === "" ? null : Number(editingQuantity);
    if (
      editingQuantityText.trim() === "" ||
      (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
    ) {
      setFieldError("分量を確認してください");
      requestAnimationFrame(() => editFirstField.current?.focus());
      return;
    }
    const ok = await mutate({
      operation: "edit",
      itemId: editingItem.id,
      payload: {
        displayName: editingItem.displayName,
        normalizedName: normalizeIngredientName(editingItem.displayName, reviewedShoppingAliases),
        storeSection: editingSection,
        quantityValue: quantity,
        quantityText: editingQuantityText.trim(),
        unit: editingUnit.trim() === "" ? null : editingUnit.trim(),
      },
    });
    if (!ok) return;
    setEditingItem(null);
    setFieldError(null);
  };
  // 削除済みは進捗から外す。店舗で「まだ買うもの」と「済んだもの」の比だけを見せる。
  const progressItems = list.items.filter((item) => !item.isRemovedByUser);
  const checkedCount = progressItems.filter((item) => item.isChecked).length;
  const totalCount = progressItems.length;
  // server-removed は pending に入っているときだけ確認行として出す
  const displayItems = list.items.filter(
    (item) => !item.isRemovedByUser || pendingUndoIds.has(item.id),
  );
  const showCleanupButton = list.items.some(
    (item) => item.isRemovedByUser && pendingUndoIds.has(item.id),
  );
  const allRemovedNoPending =
    list.items.length > 0 &&
    list.items.every((item) => item.isRemovedByUser) &&
    pendingUndoIds.size === 0;

  return (
    <main className="page-frame stack">
      <header className="shopping-page-header">
        <h1>買い物リスト</h1>
        {totalCount > 0 && (
          <p className="shopping-progress" aria-live="polite">
            {totalCount}件のうち{checkedCount}件
          </p>
        )}
      </header>
      {/* 設計 L221: 買い物リストにも AI アレルギー非保証を常時表示（警告 0 件でも） */}
      <p className="type-small" role="note">
        {MENU_LABEL_DISCLAIMER}
      </p>
      {showCleanupButton && (
        <section className="stack">
          <button
            type="button"
            className="secondary-button min-h-11"
            onClick={() => {
              setPendingUndoIds(new Set());
            }}
          >
            リストをきれいにする
          </button>
          <p className="type-small">
            外した項目の表示を消します。まちがえて消したときは、その場の「元に戻す」を先に押してください
          </p>
        </section>
      )}
      {safetyGate.error && (
        <section className="card stack" role="alert">
          <p>{safetyGate.message}</p>
          {/* D-C1: 献立削除などで確認不能になったリストの回復導線 */}
          <p>
            元の献立が削除されている場合、このリストは操作できません。履歴から別の献立で新しい買い物リストを作成してください。
          </p>
          <a className="secondary-button min-h-11" href={historyPathForShopping()}>
            履歴を開く
          </a>
        </section>
      )}
      {storedProvenanceWarnings.length > 0 && (
        <section className="card" aria-label="過去の原材料表示警告">
          <strong>現在の条件では確認できない過去の警告</strong>
          <p>家族設定の再確認が終わるまで、買い物の操作はできません。</p>
          {storedProvenanceWarnings.map(({ owner, warning }) => (
            <p key={`${owner}:${warning.warningKey}`}>
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
        const items = displayItems.filter((item) => item.storeSection === section);
        return items.length === 0 ? null : (
          <section
            key={section}
            className="shopping-section"
            aria-labelledby={`section-${section}`}
          >
            <h2 id={`section-${section}`} className="shopping-section-heading">
              {categoryLabel(section)}
            </h2>
            <ul className="shopping-item-list">
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
      {allRemovedNoPending && (
        <section className="card stack">
          <p>買うものは今ありません</p>
        </section>
      )}
      {editingItem !== null && (
        <form
          className="card stack"
          onSubmit={(event) => {
            void submitEdit(event);
          }}
        >
          <h2>{editingItem.displayName}を編集</h2>
          {fieldError !== null && <p role="alert">{fieldError}</p>}
          {/* 追加フォームと同じ .field を付け、入力欄の見た目を揃える。 */}
          <label className="field">
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
          <label className="field">
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
          <label className="field">
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
          <label className="field">
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
            // 編集フォームで出た入力エラーを追加フォームへ持ち越さない。
            setFieldError(null);
            setAdding(true);
          }}
        >
          ＋ 項目を追加
        </button>
      )}
      <a className="secondary-button min-h-11" href={historyPathForShopping()}>
        別の献立から作る
      </a>
    </main>
  );
}
