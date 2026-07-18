import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import { PantryPage, PantryPageContent } from "./pantry-page";
import { PantryVersionConflictError, pantryKeys } from "./pantry-api";
import { PantryForm } from "./pantry-form";

const userId = "61000000-0000-0000-0000-000000000001";
const expired: PantryItem = {
  id: "60000000-0000-0000-0000-000000000001",
  userId,
  name: "牛乳",
  quantity: 500,
  unit: "ml",
  expiresOn: "2026-07-10",
  expirationType: "use_by",
  openedState: "opened",
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: userId } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));
vi.mock("./pantry-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./pantry-api")>();
  return {
    ...original,
    listPantryItems: api.list,
    createPantryItem: api.create,
    updatePantryItem: api.update,
    deletePantryItem: api.delete,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("shows entered expiry/open state and confirms before deletion", async () => {
  const user = userEvent.setup();
  const onDelete = vi.fn();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <PantryPageContent
      items={[expired]}
      loading={false}
      saving={false}
      error={null}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={onDelete}
    />,
  );
  expect(screen.getByText("消費期限 2026-07-10")).toBeInTheDocument();
  expect(screen.getByText("開封済み")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "牛乳を削除" }));
  expect(onDelete).toHaveBeenCalledWith(expired.id, expired.updatedAt);
});

it("forces schema-maximum unbroken pantry text to wrap inside the card", () => {
  const maximumName = "W".repeat(80);
  const maximumUnit = "W".repeat(24);
  const maximumTextItem: PantryItem = {
    ...expired,
    name: maximumName,
    quantity: 999_999,
    unit: maximumUnit,
  };

  render(
    <PantryPageContent
      items={[maximumTextItem]}
      loading={false}
      saving={false}
      error={null}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: maximumName })).toHaveClass("pantry-card-text");
  expect(screen.getByText(`999999${maximumUnit}`)).toHaveClass("pantry-card-text");
});

it("forces a schema-maximum unbroken pantry name to wrap in the edit heading", async () => {
  const user = userEvent.setup();
  const maximumName = "W".repeat(80);
  render(
    <PantryPageContent
      items={[{ ...expired, name: maximumName }]}
      loading={false}
      saving={false}
      error={null}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: `${maximumName}を編集` }));

  expect(screen.getByRole("heading", { name: `${maximumName}を編集` })).toHaveClass(
    "pantry-form-title",
  );
});

it("passes the displayed version when saving an edit", async () => {
  const user = userEvent.setup();
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  render(
    <PantryPageContent
      items={[expired]}
      loading={false}
      saving={false}
      error={null}
      onCreate={vi.fn()}
      onUpdate={onUpdate}
      onDelete={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "牛乳を編集" }));
  const quantity = screen.getByRole("spinbutton", { name: "分量" });
  await user.clear(quantity);
  await user.type(quantity, "400");
  await user.click(screen.getByRole("button", { name: "変更を保存" }));

  expect(onUpdate).toHaveBeenCalledWith(
    expired.id,
    expired.updatedAt,
    expect.objectContaining({ quantity: 400 }),
  );
});

it("does not bypass concurrency when the list refreshes before a conflict", async () => {
  const user = userEvent.setup();
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const latest = {
    ...expired,
    updatedAt: "2026-07-09T01:00:00.000Z",
  };
  const { rerender } = render(
    <PantryPageContent
      items={[expired]}
      loading={false}
      saving={false}
      error={null}
      onCreate={vi.fn()}
      onUpdate={onUpdate}
      onDelete={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "牛乳を編集" }));
  rerender(
    <PantryPageContent
      items={[latest]}
      loading={false}
      saving={false}
      error={null}
      onCreate={vi.fn()}
      onUpdate={onUpdate}
      onDelete={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "変更を保存" }));

  expect(onUpdate).toHaveBeenCalledWith(expired.id, expired.updatedAt, expect.anything());
});

it("keeps edited input and its stale version after a conflict", async () => {
  const latest = {
    ...expired,
    name: "低脂肪乳",
    quantity: 450,
    unit: "g",
    expiresOn: "2026-07-12",
    expirationType: "best_before" as const,
    openedState: "unopened" as const,
    updatedAt: "2026-07-09T01:00:00.000Z",
  };
  api.list.mockResolvedValueOnce([expired]).mockResolvedValue([latest]);
  api.update.mockRejectedValue(new PantryVersionConflictError());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const refetch = vi.spyOn(queryClient, "refetchQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const user = userEvent.setup();
  render(<PantryPage />, { wrapper });

  await screen.findByRole("heading", { name: "牛乳" });
  await user.click(screen.getByRole("button", { name: "牛乳を編集" }));
  const quantity = screen.getByRole("spinbutton", { name: "分量" });
  await user.clear(quantity);
  await user.type(quantity, "400");
  await user.click(screen.getByRole("button", { name: "変更を保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "冷蔵庫の内容が変わりました。最新の内容を確認してください",
  );
  expect(screen.getByRole("heading", { name: "牛乳を編集" })).toBeInTheDocument();
  expect(quantity).toHaveValue(400);
  expect(screen.getByText("最新の食材名: 低脂肪乳")).toHaveClass("pantry-card-text");
  expect(
    screen.getByRole("button", { name: "最新の内容を編集フォームに反映" }),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(refetch).toHaveBeenCalledWith({
      queryKey: pantryKeys.list(userId),
      exact: true,
    });
  });
  await waitFor(() => {
    expect(api.list).toHaveBeenCalledTimes(2);
  });
  expect(api.update).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "変更を保存" }));

  expect(api.update).toHaveBeenCalledTimes(2);
  expect(api.update).toHaveBeenLastCalledWith(
    expect.anything(),
    userId,
    expired.id,
    expired.updatedAt,
    expect.objectContaining({ name: expired.name, quantity: 400 }),
  );
});

it("replaces every edit field and version only when the user applies the latest row", async () => {
  const latest = {
    ...expired,
    name: "低脂肪乳",
    quantity: 450,
    unit: "g",
    expiresOn: "2026-07-12",
    expirationType: "best_before" as const,
    openedState: "unopened" as const,
    updatedAt: "2026-07-09T01:00:00.000Z",
  };
  api.list.mockResolvedValueOnce([expired]).mockResolvedValue([latest]);
  api.update.mockRejectedValueOnce(new PantryVersionConflictError()).mockResolvedValueOnce(latest);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const user = userEvent.setup();
  render(<PantryPage />, { wrapper });

  await screen.findByRole("heading", { name: "牛乳" });
  await user.click(screen.getByRole("button", { name: "牛乳を編集" }));
  const quantity = screen.getByRole("spinbutton", { name: "分量" });
  await user.clear(quantity);
  await user.type(quantity, "400");
  await user.click(screen.getByRole("button", { name: "変更を保存" }));
  await screen.findByText("最新の食材名: 低脂肪乳");

  await user.click(screen.getByRole("button", { name: "最新の内容を編集フォームに反映" }));

  expect(screen.getByRole("heading", { name: "低脂肪乳を編集" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "食材名" })).toHaveValue("低脂肪乳");
  expect(screen.getByRole("spinbutton", { name: "分量" })).toHaveValue(450);
  expect(screen.getByRole("textbox", { name: "単位" })).toHaveValue("g");
  expect(screen.getByLabelText("期限日")).toHaveValue("2026-07-12");
  expect(screen.getByRole("combobox", { name: "期限の種類" })).toHaveValue("best_before");
  expect(screen.getByRole("combobox", { name: "開封状態" })).toHaveValue("unopened");

  await user.click(screen.getByRole("button", { name: "変更を保存" }));
  expect(api.update).toHaveBeenLastCalledWith(
    expect.anything(),
    userId,
    expired.id,
    latest.updatedAt,
    expect.objectContaining({
      name: latest.name,
      quantity: latest.quantity,
      unit: latest.unit,
      expiresOn: latest.expiresOn,
      expirationType: latest.expirationType,
      openedState: latest.openedState,
    }),
  );
});

it.each([
  {
    failedOperation: "追加",
    successfulOperation: "更新",
    arrangeFailure: () => {
      api.create.mockRejectedValueOnce(new Error("create failed"));
      api.update.mockResolvedValueOnce(expired);
    },
    fail: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByRole("textbox", { name: "食材名" }), "豆腐");
      await user.type(screen.getByRole("spinbutton", { name: "分量" }), "1");
      await user.type(screen.getByRole("textbox", { name: "単位" }), "丁");
      await user.click(screen.getByRole("button", { name: "追加する" }));
    },
    succeed: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "牛乳を編集" }));
      await user.click(screen.getByRole("button", { name: "変更を保存" }));
    },
  },
  {
    failedOperation: "更新",
    successfulOperation: "削除",
    arrangeFailure: () => {
      api.update.mockRejectedValueOnce(new Error("update failed"));
      api.delete.mockResolvedValueOnce(undefined);
      vi.spyOn(window, "confirm").mockReturnValue(true);
    },
    fail: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "牛乳を編集" }));
      await user.click(screen.getByRole("button", { name: "変更を保存" }));
      await user.click(screen.getByRole("button", { name: "キャンセル" }));
    },
    succeed: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "牛乳を削除" }));
    },
  },
  {
    failedOperation: "削除",
    successfulOperation: "追加",
    arrangeFailure: () => {
      api.delete.mockRejectedValueOnce(new Error("delete failed"));
      api.create.mockResolvedValueOnce(expired);
      vi.spyOn(window, "confirm").mockReturnValue(true);
    },
    fail: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "牛乳を削除" }));
    },
    succeed: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByRole("textbox", { name: "食材名" }), "豆腐");
      await user.type(screen.getByRole("spinbutton", { name: "分量" }), "1");
      await user.type(screen.getByRole("textbox", { name: "単位" }), "丁");
      await user.click(screen.getByRole("button", { name: "追加する" }));
    },
  },
])(
  "$failedOperation失敗後に$successfulOperationが成功すると古いエラーを消す",
  async ({ arrangeFailure, fail, succeed }) => {
    api.list.mockReset().mockResolvedValue([expired]);
    api.create.mockReset();
    api.update.mockReset();
    api.delete.mockReset();
    arrangeFailure();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const user = userEvent.setup();
    render(<PantryPage />, { wrapper });

    await screen.findByRole("heading", { name: "牛乳" });
    await fail(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存に失敗しました。通信を確認してください。",
    );

    await succeed(user);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  },
);

it.each([
  {
    nextAction: "キャンセル",
    leaveConflict: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "キャンセル" }));
    },
    expectedHeading: "食材を追加",
  },
  {
    nextAction: "別の食材へ切替",
    leaveConflict: async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "卵を編集" }));
    },
    expectedHeading: "卵を編集",
  },
])(
  "競合後に$nextActionすると競合表示を持ち越さない",
  async ({ leaveConflict, expectedHeading }) => {
    const egg = {
      ...expired,
      id: "60000000-0000-0000-0000-000000000002",
      name: "卵",
    };
    const latestMilk = {
      ...expired,
      name: "低脂肪乳",
      updatedAt: "2026-07-09T01:00:00.000Z",
    };
    api.list.mockReset().mockResolvedValueOnce([expired, egg]).mockResolvedValue([latestMilk, egg]);
    api.create.mockReset();
    api.update.mockReset().mockRejectedValueOnce(new PantryVersionConflictError());
    api.delete.mockReset();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const user = userEvent.setup();
    render(<PantryPage />, { wrapper });

    await screen.findByRole("heading", { name: "牛乳" });
    await user.click(screen.getByRole("button", { name: "牛乳を編集" }));
    const quantity = screen.getByRole("spinbutton", { name: "分量" });
    await user.clear(quantity);
    await user.type(quantity, "400");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "冷蔵庫の内容が変わりました。最新の内容を確認してください",
    );
    expect(screen.getByRole("heading", { name: "牛乳を編集" })).toBeInTheDocument();
    expect(quantity).toHaveValue(400);
    expect(await screen.findByText("最新の食材名: 低脂肪乳")).toBeInTheDocument();

    await leaveConflict(user);

    expect(screen.getByRole("heading", { name: expectedHeading })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "最新の内容" })).not.toBeInTheDocument();
  },
);

it("shows and associates a Japanese schema error, then focuses the invalid field", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<PantryForm saving={false} onSubmit={onSubmit} />);

  await user.type(screen.getByRole("textbox", { name: "食材名" }), "牛乳");
  await user.type(screen.getByRole("spinbutton", { name: "分量" }), "1");
  const unit = screen.getByRole("textbox", { name: "単位" });
  await user.type(unit, "あ".repeat(25));
  await user.click(screen.getByRole("button", { name: "追加する" }));

  const error = await screen.findByText("1〜24文字で入力してください");
  expect(onSubmit).not.toHaveBeenCalled();
  expect(unit).toHaveFocus();
  expect(unit).toHaveAttribute("aria-invalid", "true");
  expect(unit).toHaveAttribute("aria-describedby", error.id);
  expect(error).toHaveAttribute("role", "alert");
  expect(error).toHaveAttribute("lang", "ja");
});
