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
  render(
    <PantrySelector
      items={[item]}
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
