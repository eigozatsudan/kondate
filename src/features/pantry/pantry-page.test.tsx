import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import { PantryPage, PantryPageContent } from "./pantry-page";
import { PantryVersionConflictError, pantryKeys } from "./pantry-api";

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

it("keeps edited input and refetches only the owner list after a conflict", async () => {
  api.list.mockResolvedValue([expired]);
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
  await waitFor(() => {
    expect(refetch).toHaveBeenCalledWith({
      queryKey: pantryKeys.list(userId),
      exact: true,
    });
  });
  expect(api.update).toHaveBeenCalledTimes(1);
});
