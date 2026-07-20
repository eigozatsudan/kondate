import { useMemo, useState, type KeyboardEvent } from "react";
import type { MenuResultViewModel } from "../api/menu-result-api";

const roleLabels = {
  main: "主菜",
  side: "副菜",
  soup: "汁物",
  staple: "主食",
  other: "料理",
} as const;
const amount = (value: number | null, unit: string | null, text: string) =>
  value === null ? text : `${String(value)}${unit ?? ""}`;

export function MenuResult({ result }: { result: MenuResultViewModel }) {
  const { menu } = result;
  const firstDish = menu.dishes[0];
  if (firstDish === undefined) throw new Error("menu result requires at least one dish");
  const [selectedId, setSelectedId] = useState(firstDish.id);
  const selected = menu.dishes.find((dish) => dish.id === selectedId) ?? firstDish;
  const sourceIds = useMemo(
    () =>
      new Set([
        selected.id,
        ...selected.ingredients.map((item) => item.id),
        ...selected.steps.map((step) => step.id),
        ...menu.adaptations.filter((item) => item.dishId === selected.id).map((item) => item.id),
      ]),
    [menu.adaptations, selected],
  );
  const labels = result.labelConfirmations.filter((item) => sourceIds.has(item.sourceId));
  const selectedAdaptations = menu.adaptations.filter((item) => item.dishId === selected.id);
  const moveToDish = (index: number) => {
    const dish = menu.dishes[index];
    if (dish === undefined) return;
    setSelectedId(dish.id);
    document.getElementById(`tab-${dish.id}`)?.focus();
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + menu.dishes.length) % menu.dishes.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % menu.dishes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = menu.dishes.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    moveToDish(nextIndex);
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
        {menu.dishes.map((dish, index) => (
          <button
            key={dish.id}
            id={`tab-${dish.id}`}
            role="tab"
            aria-selected={dish.id === selected.id}
            aria-controls={`panel-${dish.id}`}
            tabIndex={dish.id === selected.id ? 0 : -1}
            onClick={() => {
              setSelectedId(dish.id);
            }}
            onKeyDown={(event) => {
              handleTabKeyDown(event, index);
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
                {selected.steps.find((step) => step.id === item.branchBeforeRecipeStepId)?.position}
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
        {labels.length !== 0 && (
          <section
            aria-labelledby="label-confirmations-heading"
            className="mt-5 rounded-xl border border-amber-700 bg-amber-50 p-3"
          >
            <h3 id="label-confirmations-heading" className="font-bold">
              原材料表示の確認
            </h3>
            <p className="font-semibold">加工品は原材料表示を確認してください</p>
            <ul>
              {labels.map((item) => (
                <li key={item.confirmationId} className="break-words">
                  {item.sourceText}：{item.allergenName}（{item.memberLabel}）
                  <span className="block text-sm text-stone-600">
                    辞書版 {item.dictionaryVersion}
                  </span>
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
      <p className="mt-6 rounded-xl border border-amber-700 p-3 font-semibold">
        加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。
      </p>
    </main>
  );
}
