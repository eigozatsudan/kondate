import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingIntentCycle,
  isShoppingIntentActive,
  isShoppingSheetExpected,
  markShoppingSheetAutoOpened,
} from "../shopping-intent";
import { useShoppingCreateIntent } from "./use-shopping-create-intent";

const MENU = "40000000-0000-4000-8000-000000000001";

function Probe({ menuId }: { menuId: string }) {
  const intent = useShoppingCreateIntent(menuId);
  return (
    <div
      data-testid="probe"
      data-active={intent.shoppingIntentActive ? "1" : "0"}
    />
  );
}

function mountAt(path: string, menuId: string = MENU) {
  const router = createMemoryRouter(
    [{ path: "/menus/:menuId", element: <Probe menuId={menuId} /> }],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("useShoppingCreateIntent", () => {
  it("begins cycle from for=shopping and strips query without clearing intent", async () => {
    const router = mountAt(`/menus/${MENU}?for=shopping`);
    await waitFor(() => {
      expect(isShoppingIntentActive(MENU)).toBe(true);
    });
    await waitFor(() => {
      expect(router.state.location.search).not.toContain("for=shopping");
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-active", "1");
  });

  it("schedules clear only on true unmount", async () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    mountAt(`/menus/${MENU}`);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    cleanup();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(isShoppingIntentActive(MENU)).toBe(false);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });

  it("cancel on remount keeps cycle (StrictMode pair)", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    mountAt(`/menus/${MENU}`);
    cleanup();
    // remount before timeout fires
    mountAt(`/menus/${MENU}`);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(true);
  });
});
