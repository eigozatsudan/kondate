import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import { PantrySelector, type PlannerAttempt } from "./pantry-selector";

const item: PantryItem = {
  id: "71000000-0000-0000-0000-000000000001",
  userId: "72000000-0000-0000-0000-000000000001",
  name: "豆腐",
  quantity: 1,
  unit: "丁",
  expiresOn: "2026-07-10",
  expirationType: "use_by",
  openedState: "unopened",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

it("期限確認を draft に混ぜず親 attempt へ exact check として返す", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const onAttemptChange = vi.fn();
  const attempt: PlannerAttempt = {
    idempotencyKey: "73000000-0000-0000-0000-000000000001",
    expiredPantryChecks: [],
  };
  const { container } = render(
    <PantrySelector
      items={[item]}
      itemsStatus="loaded"
      selections={[]}
      attempt={attempt}
      onAttemptChange={onAttemptChange}
      now={() => new Date("2026-07-11T03:00:00.000Z")}
      onChange={onChange}
    />,
  );

  await user.click(screen.getByRole("checkbox", { name: "豆腐" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText(/アプリは食べられるか判断しません/u)).toBeInTheDocument();
  // CSP: 期限確認ダイアログは named CSS class のみ（inline style なし）
  const dialog = screen.getByRole("alertdialog", { name: "期限を過ぎた食材の確認" });
  expect(dialog).toHaveClass("pantry-expired-dialog-panel");
  expect(dialog.closest(".pantry-expired-dialog-backdrop")).not.toBeNull();
  expect(container.querySelector("[style]")).toBeNull();
  await user.click(screen.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }));

  expect(onAttemptChange).toHaveBeenCalledWith({
    idempotencyKey: attempt.idempotencyKey,
    expiredPantryChecks: [{ pantryItemId: item.id, checkedAt: "2026-07-11T03:00:00.000Z" }],
  });
  expect(onChange).toHaveBeenCalledWith([{ pantryItemId: item.id, priority: "prefer_use" }]);
});

it("別 attempt の確認を再利用しない", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const attempt: PlannerAttempt = {
    idempotencyKey: "73000000-0000-0000-0000-000000000002",
    expiredPantryChecks: [{ pantryItemId: item.id, checkedAt: "2026-07-11T03:00:00.000Z" }],
  };
  const view = render(
    <PantrySelector
      items={[item]}
      itemsStatus="loaded"
      selections={[]}
      attempt={attempt}
      onAttemptChange={vi.fn()}
      now={() => new Date("2026-07-11T03:00:00.000Z")}
      onChange={onChange}
    />,
  );
  view.rerender(
    <PantrySelector
      items={[item]}
      itemsStatus="loaded"
      selections={[]}
      attempt={{
        idempotencyKey: "73000000-0000-0000-0000-000000000003",
        expiredPantryChecks: [],
      }}
      onAttemptChange={vi.fn()}
      now={() => new Date("2026-07-11T03:00:00.000Z")}
      onChange={onChange}
    />,
  );
  await user.click(screen.getByRole("checkbox", { name: "豆腐" }));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});

it("期限確認をモーダルとして説明し安全な操作へフォーカスを閉じ込めて戻す", async () => {
  const user = userEvent.setup();
  const attempt: PlannerAttempt = {
    idempotencyKey: "73000000-0000-0000-0000-000000000004",
    expiredPantryChecks: [],
  };
  render(
    <PantrySelector
      items={[item]}
      itemsStatus="loaded"
      selections={[]}
      attempt={attempt}
      onAttemptChange={vi.fn()}
      now={() => new Date("2026-07-11T03:00:00.000Z")}
      onChange={vi.fn()}
    />,
  );
  const trigger = screen.getByRole("checkbox", { name: "豆腐" });
  await user.click(trigger);

  const dialog = screen.getByRole("alertdialog");
  const safeAction = screen.getByRole("button", { name: "選ばない" });
  const confirmAction = screen.getByRole("button", { name: "実物を確認して今回だけ選ぶ" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAttribute("aria-describedby");
  expect(safeAction).toHaveFocus();

  await user.tab();
  expect(confirmAction).toHaveFocus();
  await user.tab();
  expect(safeAction).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("期限確認中は背景の pointer 操作で選択を変更できない", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const freshItem: PantryItem = {
    ...item,
    id: "71000000-0000-0000-0000-000000000002",
    name: "にんじん",
    expiresOn: "2026-07-12",
  };
  render(
    <PantrySelector
      items={[item, freshItem]}
      itemsStatus="loaded"
      selections={[]}
      attempt={{
        idempotencyKey: "73000000-0000-0000-0000-000000000005",
        expiredPantryChecks: [],
      }}
      onAttemptChange={vi.fn()}
      now={() => new Date("2026-07-11T03:00:00.000Z")}
      onChange={onChange}
    />,
  );

  await user.click(screen.getByRole("checkbox", { name: "豆腐" }));
  await user.click(screen.getByRole("checkbox", { name: "にんじん" }));

  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("確認中の同じ attempt 再描画は dialog focus を保ち、別 attempt は trigger へ戻す", async () => {
  const user = userEvent.setup();
  const commonProps = {
    items: [item],
    itemsStatus: "loaded",
    selections: [],
    onAttemptChange: vi.fn(),
    now: () => new Date("2026-07-11T03:00:00.000Z"),
    onChange: vi.fn(),
  } as const;
  const attempt: PlannerAttempt = {
    idempotencyKey: "73000000-0000-0000-0000-000000000006",
    expiredPantryChecks: [],
  };
  const view = render(<PantrySelector {...commonProps} attempt={attempt} />);
  const trigger = screen.getByRole("checkbox", { name: "豆腐" });
  await user.click(trigger);
  const safeAction = screen.getByRole("button", { name: "選ばない" });
  expect(safeAction).toHaveFocus();

  view.rerender(
    <PantrySelector {...commonProps} attempt={{ ...attempt, expiredPantryChecks: [] }} />,
  );
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(safeAction).toHaveFocus();

  view.rerender(
    <PantrySelector
      {...commonProps}
      attempt={{
        idempotencyKey: "73000000-0000-0000-0000-000000000007",
        expiredPantryChecks: [],
      }}
    />,
  );
  await vi.waitFor(() => {
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

it("読込完了後に消えた選択を UUID を見せず解除できる", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <PantrySelector
      items={[]}
      itemsStatus="loaded"
      selections={[{ pantryItemId: item.id, priority: "must_use" }]}
      attempt={{
        idempotencyKey: "73000000-0000-0000-0000-000000000008",
        expiredPantryChecks: [],
      }}
      onAttemptChange={vi.fn()}
      onChange={onChange}
    />,
  );

  expect(screen.getByText("冷蔵庫から削除された食材")).toBeInTheDocument();
  expect(screen.queryByText(item.id)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "削除された食材の選択を解除" }));
  expect(onChange).toHaveBeenCalledWith([]);
});

it("読込中は復元済み選択を削除扱いしない", () => {
  render(
    <PantrySelector
      items={[]}
      itemsStatus="loading"
      selections={[{ pantryItemId: item.id, priority: "must_use" }]}
      attempt={{
        idempotencyKey: "73000000-0000-0000-0000-000000000009",
        expiredPantryChecks: [],
      }}
      onAttemptChange={vi.fn()}
      onChange={vi.fn()}
    />,
  );

  expect(screen.getByText("冷蔵庫の食材を読み込んでいます…")).toBeInTheDocument();
  expect(screen.queryByText("冷蔵庫から削除された食材")).not.toBeInTheDocument();
});

it("50件選択後は未選択だけを無効化し選択済みは解除できる", () => {
  const items = Array.from({ length: 51 }, (_, index): PantryItem => ({
    ...item,
    id: `71000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    name: `食材${String(index + 1)}`,
    expiresOn: null,
  }));
  const selections = items.slice(0, 50).map((entry) => ({
    pantryItemId: entry.id,
    priority: "prefer_use" as const,
  }));
  render(
    <PantrySelector
      items={items}
      itemsStatus="loaded"
      selections={selections}
      attempt={{
        idempotencyKey: "73000000-0000-0000-0000-000000000010",
        expiredPantryChecks: [],
      }}
      onAttemptChange={vi.fn()}
      onChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("checkbox", { name: "食材50" })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "食材51" })).toBeDisabled();
  expect(
    screen.getByText("冷蔵庫の食材は50件まで選べます。選択中の食材は解除できます。"),
  ).toBeInTheDocument();
});
