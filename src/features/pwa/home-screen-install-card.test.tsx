import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  injectAndroidInstallPromptForTests,
  listenForAndroidInstallPrompt,
  peekAndroidInstallPrompt,
  resetAndroidInstallPromptForTests,
} from "./android-install-prompt";
import { HomeScreenInstallCard } from "./home-screen-install-card";
import { HomeScreenInstallSection } from "./home-screen-install-section";
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
const IPHONE_INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0";
const IPHONE_LINE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0";
const IPHONE_FBAN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/10.0.0.1.0;]";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel)";
const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36";
const FIREFOX_ANDROID_UA = "Mozilla/5.0 (Android 14; Mobile; rv:122.0) Gecko/122.0 Firefox/122.0";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function stubSurface(kind: "ios" | "android" | "other", userAgentOverride?: string): void {
  const userAgent =
    userAgentOverride ??
    (kind === "ios" ? IPHONE_UA : kind === "android" ? ANDROID_UA : WINDOWS_UA);
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
  cleanup();
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

  it("sizes the card to the page-frame width class", () => {
    renderCard();
    expect(screen.getByRole("region", { name: "ホーム画面に置く" })).toHaveClass(
      "home-screen-install-card",
    );
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

  it("replaces Android steps with the install button when BIP arrives after first paint", async () => {
    // Chrome は SW addAll 後に BIP を飛ばす。描画後到着を購読しないと手順リストのまま固着する。
    listenForAndroidInstallPrompt();
    stubSurface("android");
    renderCard();
    expect(screen.getByText("右上のメニューを開きます")).toBeVisible();
    expect(screen.queryByRole("button", { name: "インストールする" })).not.toBeInTheDocument();

    const prompt = vi.fn(() => Promise.resolve());
    const event = new CustomEvent("beforeinstallprompt", { cancelable: true });
    Object.defineProperty(event, "prompt", { value: prompt });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(await screen.findByRole("button", { name: "インストールする" })).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("右上のメニューを開きます")).not.toBeInTheDocument();
  });

  it("disables the install button after the first prompt and swallows a rejected prompt", async () => {
    stubSurface("android");
    const prompt = vi.fn(() => Promise.reject(new Error("already used")));
    injectAndroidInstallPromptForTests({ prompt });
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    const user = userEvent.setup();
    renderCard();
    const install = screen.getByRole("button", { name: "インストールする" });
    await user.click(install);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(install).toBeDisabled();
    await user.click(install);
    expect(prompt).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    window.removeEventListener("unhandledrejection", unhandled);
  });

  it("disables the settings install button after the card consumed the same BIP", async () => {
    stubSurface("android");
    const prompt = vi.fn(() => Promise.resolve());
    injectAndroidInstallPromptForTests({ prompt });
    const user = userEvent.setup();
    const { unmount } = renderCard();
    await user.click(screen.getByRole("button", { name: "インストールする" }));
    expect(prompt).toHaveBeenCalledTimes(1);
    unmount();
    render(<HomeScreenInstallSection />);
    const install = screen.getByRole("button", { name: "インストールする" });
    expect(install).toBeDisabled();
    expect(screen.getByRole("heading", { name: "ホーム画面に追加" })).toBeVisible();
    expect(screen.queryByText("右上のメニューを開きます")).not.toBeInTheDocument();
    await user.click(install);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("does not show Safari install steps on iPhone Instagram, LINE, or Facebook in-app", () => {
    const otherBody =
      "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。";
    for (const userAgent of [IPHONE_INSTAGRAM_UA, IPHONE_LINE_UA, IPHONE_FBAN_UA]) {
      cleanup();
      stubSurface("ios", userAgent);
      renderCard();
      expect(screen.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
      expect(
        screen.queryByText("画面の下（または上）の共有ボタンをタップします"),
      ).not.toBeInTheDocument();
      expect(screen.getByText(otherBody)).toBeVisible();
    }
  });

  it("does not show Chrome install steps on Android WebView or Firefox when no prompt is held", () => {
    stubSurface("android", ANDROID_WEBVIEW_UA);
    renderCard();
    expect(screen.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    expect(screen.queryByText("右上のメニューを開きます")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "インストールする" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。",
      ),
    ).toBeVisible();

    cleanup();
    stubSurface("android", FIREFOX_ANDROID_UA);
    renderCard();
    expect(screen.queryByText("右上のメニューを開きます")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。",
      ),
    ).toBeVisible();
  });

  it("renders nothing on other surfaces", () => {
    stubSurface("other");
    renderCard();
    expect(screen.queryByRole("heading", { name: "ホーム画面に置く" })).not.toBeInTheDocument();
  });
});
