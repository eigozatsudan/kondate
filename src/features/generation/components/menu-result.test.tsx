import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { PantryVersionConflictError } from "@/features/pantry/pantry-api";
import { MenuResult, type MenuResultActions } from "./menu-result";

function makeActions(overrides: Partial<MenuResultActions> = {}): MenuResultActions {
  return {
    menuId: "20000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000001",
    onConfirmLabel: vi.fn(() => Promise.resolve()),
    onDeletePantry: vi.fn(() => Promise.resolve()),
    onUpdatePantry: vi.fn(() => Promise.resolve()),
    onCreatePantry: vi.fn(() => Promise.resolve()),
    onRefetchResult: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

it("shows the overall timeline before persistent dish tabs", () => {
  const { container } = render(<MenuResult result={makeMenuResultViewModel()} />);
  const timeline = screen.getByRole("heading", { name: "全体の段取り" });
  const tabs = screen.getByRole("tablist", { name: "料理" });
  expect(timeline.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container).toHaveTextContent("AIが作成した献立です");
});

it("switches dishes and exposes structured preparation and label checks", async () => {
  const result = makeMenuResultViewModel();
  const menu = result.menu;
  const secondDish = menu.dishes[1];
  if (secondDish === undefined) throw new Error("fixture must contain a second dish");
  render(<MenuResult result={result} />);
  // タブの実際のアクセシブルネームは「区分・料理名」（例: 副菜・温野菜）で、
  // getByRoleのname照合は常に完全一致のため、料理名だけの完全一致にはならない。
  // 正規表現で部分一致させて該当タブを選択する。
  await userEvent.click(screen.getByRole("tab", { name: new RegExp(secondDish.name, "u") }));
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByRole("heading", { name: "材料" })).toBeVisible();
  expect(within(panel).getByRole("heading", { name: "作り方" })).toBeVisible();
  expect(within(panel).getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
  expect(screen.getByText("加工品は原材料表示を確認してください")).toBeVisible();
});

it("moves focus and selection with roving tab keyboard controls", async () => {
  const result = makeMenuResultViewModel();
  render(<MenuResult result={result} />);
  const tabs = screen.getAllByRole("tab");
  const firstTab = tabs[0];
  const lastTab = tabs.at(-1);
  if (firstTab === undefined || lastTab === undefined) throw new Error("fixture must contain tabs");

  firstTab.focus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(lastTab).toHaveFocus();
  expect(lastTab).toHaveAttribute("aria-selected", "true");
  expect(firstTab).toHaveAttribute("tabindex", "-1");

  await userEvent.keyboard("{Home}");
  expect(firstTab).toHaveFocus();
  expect(firstTab).toHaveAttribute("aria-selected", "true");

  await userEvent.keyboard("{End}");
  expect(lastTab).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  expect(firstTab).toHaveFocus();
  expect(firstTab).toHaveAttribute("aria-selected", "true");
});

it("shows used amounts, shortages, and persisted unused reasons", () => {
  render(<MenuResult result={makeMenuResultViewModel()} />);
  expect(screen.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  expect(screen.getByText(/不足/)).toBeVisible();
  expect(screen.getByText(/使わなかった理由/)).toBeVisible();
});

it("renders normalized structured safety actions returned by the aggregate loader", () => {
  const result = makeMenuResultViewModel();
  const menu = result.menu;
  const action = menu.adaptations.flatMap((item) => item.safetyActions).at(0);
  expect(action).toBeDefined();
  if (action === undefined) throw new Error("fixture must contain a safety action");
  render(<MenuResult result={result} />);
  expect(screen.getByText("安全のための手順")).toBeVisible();
  expect(screen.getByText(action.instruction)).toBeVisible();
});

it("renders confirmation ids through human source, allergen, and member labels", () => {
  const result = makeMenuResultViewModel();
  const confirmation = result.labelConfirmations.at(0);
  if (confirmation === undefined) throw new Error("fixture must contain a label confirmation");
  render(<MenuResult result={result} />);
  const confirmationSection = screen.getByRole("region", { name: "原材料表示の確認" });
  expect(confirmation.confirmationId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(
    within(confirmationSection).getByText(new RegExp(confirmation.sourceText, "u")),
  ).toBeVisible();
  expect(
    within(confirmationSection).getByText(new RegExp(confirmation.allergenName, "u")),
  ).toBeVisible();
  expect(
    within(confirmationSection).getByText(new RegExp(confirmation.memberLabel, "u")),
  ).toBeVisible();
  expect(within(confirmationSection).getByText(/辞書版 jp-caa-2026-04\.v1/u)).toBeVisible();
});

it("renders numbered steps and every persisted adaptation field", () => {
  const result = makeMenuResultViewModel();
  render(<MenuResult result={result} />);
  const panel = screen.getByRole("tabpanel");
  const recipeHeading = within(panel).getByRole("heading", { name: "作り方" });
  const recipeList = recipeHeading.nextElementSibling;
  if (!(recipeList instanceof HTMLOListElement)) throw new Error("recipe steps must be an ol");
  expect(
    within(recipeList)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["1ごはんを握る", "2のりを巻く"]);
  expect(within(panel).getByText("分ける前: 手順1")).toBeVisible();
  expect(within(panel).getByText("切り方: 細かくほぐす")).toBeVisible();
  expect(within(panel).getByText("加熱: 中心まで温める")).toBeVisible();
  expect(within(panel).getByText("味付け: 薄味にする")).toBeVisible();
  expect(within(panel).getByText("配膳時: 小さくちぎって渡す")).toBeVisible();
});

it("shows a plain empty state when the selected dish has no adaptation", async () => {
  const result = makeMenuResultViewModel();
  const secondDish = result.menu.dishes[1];
  if (secondDish === undefined) throw new Error("fixture must contain a second dish");
  render(<MenuResult result={result} />);

  await userEvent.click(screen.getByRole("tab", { name: new RegExp(secondDish.name, "u") }));

  expect(screen.getByText("この料理の取り分け案はありません。")).toBeVisible();
});

it("leaves the label disclaimer to the page shell and keeps a 320px no-overflow class contract", () => {
  const { container } = render(<MenuResult result={makeMenuResultViewModel()} />);
  // ラベル確認の免責文はゲートで本文が閉じている間も出し続ける必要があるため、
  // 本文コンポーネントではなくページ枠（MenuResultPage/HistoryDetailPage）が持つ。
  expect(
    screen.queryByText(
      "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。",
    ),
  ).toBeNull();
  // jsdomは実レイアウトを計測しないため、320px幅で子要素を収める全体契約を
  // 横方向の最大幅・はみ出し抑止・長文折返しの具体的classで固定する。
  expect(container.querySelector("main")).toHaveClass(
    "w-full",
    "max-w-full",
    "overflow-x-hidden",
    "break-words",
  );
});

it("wraps unbroken ingredient names and amounts inside a 320px material row", () => {
  const result = makeMenuResultViewModel();
  const firstDish = result.menu.dishes[0];
  const firstIngredient = firstDish?.ingredients[0];
  if (firstDish === undefined || firstIngredient === undefined)
    throw new Error("fixture must contain an ingredient");
  const maximumName = "W".repeat(100);
  const maximumAmount = "9".repeat(60);
  firstDish.ingredients[0] = {
    ...firstIngredient,
    name: maximumName,
    quantityValue: null,
    quantityText: maximumAmount,
    unit: null,
  };

  render(<MenuResult result={result} />);

  const name = screen.getByText(maximumName);
  const amount = screen.getByText(maximumAmount);
  const row = name.closest("li");
  // jsdomはlayout geometryを返さないためscrollWidthを偽装せず、320pxでも
  // flexのauto-min-widthに遮られない子要素単位の折返し契約をclassで固定する。
  expect(row).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_minmax(0,45%)]");
  expect(name).toHaveClass("min-w-0", "break-words", "[overflow-wrap:anywhere]");
  expect(amount).toHaveClass(
    "min-w-0",
    "w-full",
    "break-words",
    "text-right",
    "[overflow-wrap:anywhere]",
  );
});

it("shows the label-confirm action and calls the confirm handler", async () => {
  const onConfirmLabel = vi.fn(() => Promise.resolve());
  const actions = makeActions({ onConfirmLabel });
  const result = makeMenuResultViewModel();
  const confirmation = result.labelConfirmations[0];
  if (confirmation === undefined) throw new Error("fixture must contain a confirmation");
  render(<MenuResult result={result} actions={actions} />);
  await userEvent.click(
    screen.getByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
  );
  expect(onConfirmLabel).toHaveBeenCalledWith(
    confirmation.confirmationId,
    confirmation.requirementSafetyFingerprint,
  );
});

it("renders 44px post-cook controls and deleted state without mutation buttons", () => {
  render(<MenuResult result={makeMenuResultViewModel()} actions={makeActions()} />);
  const usedUp = screen.getByRole("button", { name: "使い切った" });
  const stillHave = screen.getByRole("button", { name: "まだある" });
  expect(usedUp).toHaveClass("min-h-11", "min-w-11");
  expect(stillHave).toHaveClass("min-h-11", "min-w-11");
  expect(screen.getByText("冷蔵庫から削除済み")).toBeVisible();
});

it("cancels destructive pantry delete without writing", async () => {
  const onDeletePantry = vi.fn(() => Promise.resolve());
  const actions = makeActions({ onDeletePantry });
  render(<MenuResult result={makeMenuResultViewModel()} actions={actions} />);
  await userEvent.click(screen.getByRole("button", { name: "使い切った" }));
  expect(screen.getByText("この食材を冷蔵庫から削除しますか？")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "やめる" }));
  expect(onDeletePantry).not.toHaveBeenCalled();
  expect(screen.queryByText("この食材を冷蔵庫から削除しますか？")).toBeNull();
});

it("confirms pantry delete and supports undo recreation without aggregate reattach", async () => {
  const onDeletePantry = vi.fn(() => Promise.resolve());
  const onRefetchResult = vi.fn(() => Promise.resolve());
  const onCreatePantry = vi.fn(() => Promise.resolve());
  const actions = makeActions({ onDeletePantry, onRefetchResult, onCreatePantry });
  render(<MenuResult result={makeMenuResultViewModel()} actions={actions} />);
  await userEvent.click(screen.getByRole("button", { name: "使い切った" }));
  await userEvent.click(screen.getByRole("button", { name: "削除する" }));
  expect(onDeletePantry).toHaveBeenCalledTimes(1);
  expect(onRefetchResult).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "元に戻す" }));
  expect(onCreatePantry).toHaveBeenCalledWith(
    expect.objectContaining({ name: "しょうゆ", unit: "ml" }),
  );
  // 削除後は mutation 制御を再表示しない
  expect(screen.queryByRole("button", { name: "使い切った" })).toBeNull();
});

it("saves blank remainder as null quantity/unit", async () => {
  const onUpdatePantry = vi.fn(() => Promise.resolve());
  const actions = makeActions({ onUpdatePantry });
  render(<MenuResult result={makeMenuResultViewModel()} actions={actions} />);
  await userEvent.click(screen.getByRole("button", { name: "まだある" }));
  await userEvent.click(screen.getByRole("button", { name: "分量を保存" }));
  expect(onUpdatePantry).toHaveBeenCalledWith(
    expect.objectContaining({ id: "66000000-0000-4000-8000-000000000001" }),
    expect.objectContaining({ quantity: null, unit: null, name: "しょうゆ" }),
  );
});

it("keeps remainder inputs on version conflict without silent retry", async () => {
  const onUpdatePantry = vi.fn(() => Promise.reject(new PantryVersionConflictError()));
  const onRefetchResult = vi.fn(() => Promise.resolve());
  const actions = makeActions({ onUpdatePantry, onRefetchResult });
  render(<MenuResult result={makeMenuResultViewModel()} actions={actions} />);
  await userEvent.click(screen.getByRole("button", { name: "まだある" }));
  await userEvent.type(screen.getByLabelText("残りの分量（任意）"), "50");
  await userEvent.type(screen.getByLabelText("単位"), "ml");
  await userEvent.click(screen.getByRole("button", { name: "分量を保存" }));
  expect(
    screen.getByText("冷蔵庫の内容が変わりました。最新の内容を確認してください"),
  ).toBeVisible();
  expect(screen.getByLabelText("残りの分量（任意）")).toHaveValue("50");
  expect(screen.getByLabelText("単位")).toHaveValue("ml");
  expect(onUpdatePantry).toHaveBeenCalledTimes(1);
  expect(onRefetchResult).toHaveBeenCalled();
});

it("returns an alert when the menu has no dishes", () => {
  const result = makeMenuResultViewModel();
  // 空配列は validated では本来到達しないが、表示境界の防御を固定する
  (result.menu as { dishes: unknown }).dishes = [];
  render(<MenuResult result={result} />);
  expect(screen.getByRole("alert")).toHaveTextContent("献立の料理を表示できません");
});

it("hides adaptation and label confirmation for idea mode without actions", () => {
  const result = makeMenuResultViewModel({ targetMode: "idea" });
  render(<MenuResult result={result} mode="idea" />);
  // idea は家族向け取り分け・原材料表示確認を表示しない
  expect(screen.queryByRole("heading", { name: "家族向けの取り分け" })).toBeNull();
  expect(screen.queryByText("加工品は原材料表示を確認してください")).toBeNull();
  expect(screen.queryByRole("region", { name: "原材料表示の確認" })).toBeNull();
  // actions なしの idea は調理後冷蔵庫操作も出さない（read-only 境界）
  expect(screen.queryByRole("heading", { name: "調理後の冷蔵庫" })).toBeNull();
  expect(screen.queryByRole("button", { name: "使い切った" })).toBeNull();
  // 献立本文（料理・材料・作り方）は idea でも表示する
  expect(screen.getByRole("heading", { name: "献立ができました" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "材料" })).toBeVisible();
});

it("shows post-cook pantry controls for idea mode when pantry actions are provided", () => {
  const result = makeMenuResultViewModel({ targetMode: "idea" });
  render(<MenuResult result={result} mode="idea" actions={makeActions()} />);
  expect(screen.queryByRole("heading", { name: "家族向けの取り分け" })).toBeNull();
  expect(screen.queryByRole("region", { name: "原材料表示の確認" })).toBeNull();
  // 調理後の冷蔵庫は家族 fingerprint を要求しないため idea でも操作できる
  expect(screen.getByRole("heading", { name: "調理後の冷蔵庫" })).toBeVisible();
  expect(screen.getByRole("button", { name: "使い切った" })).toBeVisible();
});

it("keeps household mode sections visible when mode is household", () => {
  const result = makeMenuResultViewModel({ targetMode: "household" });
  render(<MenuResult result={result} mode="household" actions={makeActions()} />);
  expect(screen.getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
  expect(screen.getByRole("region", { name: "原材料表示の確認" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "調理後の冷蔵庫" })).toBeVisible();
});

it("defaults mode from result.targetMode when the prop is omitted", () => {
  const household = makeMenuResultViewModel({ targetMode: "household" });
  const { unmount } = render(<MenuResult result={household} />);
  expect(screen.getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
  unmount();

  // idea で prop 省略しても household chrome を出さない（既定 household の footgun を閉じる）
  const idea = makeMenuResultViewModel({ targetMode: "idea" });
  render(<MenuResult result={idea} />);
  expect(screen.queryByRole("heading", { name: "家族向けの取り分け" })).toBeNull();
  expect(screen.queryByRole("region", { name: "原材料表示の確認" })).toBeNull();
});
