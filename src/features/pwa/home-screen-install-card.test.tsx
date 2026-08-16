import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  injectAndroidInstallPromptForTests,
  peekAndroidInstallPrompt,
  resetAndroidInstallPromptForTests,
} from "./android-install-prompt";
import { HomeScreenInstallCard } from "./home-screen-install-card";
import { PWA_INSTALL_TIP_DISMISSED_KEY } from "./install-tip-storage";

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: { user: { id: "user-1" } },
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  }),
}));

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel)";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function stubSurface(kind: "ios" | "android" | "other"): void {
  const userAgent = kind === "ios" ? IPHONE_UA : kind === "android" ? ANDROID_UA : WINDOWS_UA;
  const platform = kind === "ios" ? "iPhone" : kind === "android" ? "Linux armv8l" : "Win32";
  const maxTouchPoints = kind === "other" ? 0 : 5;
  vi.stubGlobal("navigator", {
    userAgent,
    platform,
    maxTouchPoints,
    standalone: undefined,
  });
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {
          return undefined;
        },
        removeListener() {
          return undefined;
        },
        addEventListener() {
          return undefined;
        },
        removeEventListener() {
          return undefined;
        },
        dispatchEvent() {
          return false;
        },
      }) satisfies MediaQueryList,
  );
}

function renderCard() {
  const router = createMemoryRouter([{ path: "/planner", element: <HomeScreenInstallCard /> }], {
    initialEntries: ["/planner"],
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  stubSurface("ios");
});

afterEach(() => {
  resetAndroidInstallPromptForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HomeScreenInstallCard", () => {
  it("shows the iOS heading and a 44px dismiss control when eligible", () => {
    renderCard();
    expect(screen.getByRole("heading", { level: 2, name: "ホーム画面に置く" })).toBeVisible();
    const dismiss = screen.getByRole("button", { name: "わかりました" });
    expect(dismiss).toBeVisible();
    expect(dismiss).toHaveAttribute("type", "button");
    expect(dismiss).toHaveClass("min-h-11");
  });

  it("writes the dismiss flag when the dismiss button is clicked", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "わかりました" }));
    expect(window.localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
    expect(screen.queryByRole("heading", { name: "ホーム画面に置く" })).not.toBeInTheDocument();
  });

  it("hides the heading on the same mount even when setItem throws", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    renderCard();
    await user.click(screen.getByRole("button", { name: "わかりました" }));
    expect(screen.queryByRole("heading", { name: "ホーム画面に置く" })).not.toBeInTheDocument();
  });

  it("shows the heading again after remount when storage is empty", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { unmount } = renderCard();
    await user.click(screen.getByRole("button", { name: "わかりました" }));
    expect(screen.queryByRole("heading", { name: "ホーム画面に置く" })).not.toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    window.localStorage.clear();
    renderCard();
    expect(screen.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
  });

  it("shows the Android install button via peek and omits the steps list", () => {
    stubSurface("android");
    const prompt = vi.fn(() => Promise.resolve());
    injectAndroidInstallPromptForTests({ prompt });
    renderCard();
    expect(peekAndroidInstallPrompt()?.prompt).toBe(prompt);
    expect(screen.getByRole("button", { name: "インストールする" })).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("右上のメニューを開きます")).not.toBeInTheDocument();
  });

  it("renders nothing on other surfaces", () => {
    stubSurface("other");
    renderCard();
    expect(screen.queryByRole("heading", { name: "ホーム画面に置く" })).not.toBeInTheDocument();
  });
});
