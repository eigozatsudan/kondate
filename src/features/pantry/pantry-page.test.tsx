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

vi.mock("@/features/auth/auth-provider", () => ({
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

it("keeps edited input and refetches only the owner list after a conflict", async () => {
  const latest = {
    ...expired,
    quantity: 450,
    updatedAt: "2026-07-09T01:00:00.000Z",
  };
  api.list.mockResolvedValueOnce([expired]).mockResolvedValue([latest]);
  api.update.mockRejectedValueOnce(new PantryVersionConflictError()).mockResolvedValueOnce(latest);
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
    latest.updatedAt,
    expect.objectContaining({ quantity: 400 }),
  );
});

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
