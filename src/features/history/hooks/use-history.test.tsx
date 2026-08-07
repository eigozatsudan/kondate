import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAcceptMenuVersion } from "./use-history";

const acceptMenuVersionMock = vi.hoisted(() => vi.fn());

vi.mock("../api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/history-api")>();
  return {
    ...original,
    acceptMenuVersion: acceptMenuVersionMock,
  };
});

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session: { user: { id: "40000000-0000-4000-8000-000000000001" } },
  }),
}));

const USER_ID = "40000000-0000-4000-8000-000000000001";
const MENU_A = "30000000-0000-4000-8000-000000000001";
const MENU_B = "30000000-0000-4000-8000-000000000002";

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useAcceptMenuVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acceptMenuVersionMock.mockResolvedValue(undefined);
  });

  it("HR1: clears sibling menu-result isSelected when accepting another version", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // 案A を過去に開いたキャッシュ（isSelected:true residual）
    client.setQueryData(["menu-result", USER_ID, MENU_A, "history"], {
      menuId: MENU_A,
      isSelected: true,
    });
    client.setQueryData(["menu-result", USER_ID, MENU_B, "history"], {
      menuId: MENU_B,
      isSelected: false,
    });

    const { result } = renderHook(() => useAcceptMenuVersion(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync(MENU_B);
    });

    await waitFor(() => {
      expect(acceptMenuVersionMock).toHaveBeenCalledWith(MENU_B);
    });

    const siblingA = client.getQueryData<{ isSelected?: boolean }>([
      "menu-result",
      USER_ID,
      MENU_A,
      "history",
    ]);
    const acceptedB = client.getQueryData<{ isSelected?: boolean }>([
      "menu-result",
      USER_ID,
      MENU_B,
      "history",
    ]);
    expect(siblingA?.isSelected).toBe(false);
    expect(acceptedB?.isSelected).toBe(true);
  });
});
