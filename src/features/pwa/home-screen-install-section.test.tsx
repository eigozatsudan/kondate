import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  injectAndroidInstallPromptForTests,
  listenForAndroidInstallPrompt,
  resetAndroidInstallPromptForTests,
} from "./android-install-prompt";
import { HomeScreenInstallCard } from "./home-screen-install-card";
import { HomeScreenInstallSection } from "./home-screen-install-section";

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: { user: { id: "user-1" } },
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  }),
}));

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const IPHONE_CRIOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
const IPHONE_FXIOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/122.0 Mobile/15E148 Safari/605.1.15";
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

afterEach(() => {
  cleanup();
  resetAndroidInstallPromptForTests();
  vi.unstubAllGlobals();
});

describe("HomeScreenInstallSection", () => {
  it("uses the settings heading", () => {
    stubSurface("ios");
    render(<HomeScreenInstallSection />);
    expect(screen.getByRole("heading", { level: 2, name: /^ホーム画面に追加$/u })).toBeVisible();
  });

  it("shows iOS steps on iOS", () => {
    stubSurface("ios");
    render(<HomeScreenInstallSection />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAccessibleName("共有");
    expect(items[1]).toHaveAccessibleName("ホーム画面に追加");
    expect(items[2]).toHaveAccessibleName("追加");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: /^ホーム画面に追加$/u })).toBeVisible();
  });

  it("shows Android steps on Android when no install prompt is held", () => {
    stubSurface("android");
    render(<HomeScreenInstallSection />);
    expect(screen.getByRole("listitem", { name: /^メニュー$/u })).toBeVisible();
    expect(screen.getByRole("listitem", { name: /^ホーム画面に追加$/u })).toBeVisible();
  });

  it("replaces Android steps with the install button when BIP arrives after first paint", async () => {
    listenForAndroidInstallPrompt();
    stubSurface("android");
    render(<HomeScreenInstallSection />);
    expect(screen.getByRole("listitem", { name: /^メニュー$/u })).toBeVisible();
    expect(screen.queryByRole("button", { name: "インストールする" })).not.toBeInTheDocument();

    const prompt = vi.fn(() => Promise.resolve());
    const event = new CustomEvent("beforeinstallprompt", { cancelable: true });
    Object.defineProperty(event, "prompt", { value: prompt });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(await screen.findByRole("button", { name: "インストールする" })).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("disables the install button after the first prompt and swallows a rejected prompt", async () => {
    stubSurface("android");
    const prompt = vi.fn(() => Promise.reject(new Error("already used")));
    injectAndroidInstallPromptForTests({ prompt });
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    const user = userEvent.setup();
    render(<HomeScreenInstallSection />);
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
    expect(screen.getByRole("heading", { name: /^ホーム画面に追加$/u })).toBeVisible();
    window.removeEventListener("unhandledrejection", unhandled);
  });

  it("disables the card install button after the settings section consumed the same BIP", async () => {
    stubSurface("android");
    const prompt = vi.fn(() => Promise.resolve());
    injectAndroidInstallPromptForTests({ prompt });
    const user = userEvent.setup();
    const { unmount } = render(<HomeScreenInstallSection />);
    await user.click(screen.getByRole("button", { name: "インストールする" }));
    expect(prompt).toHaveBeenCalledTimes(1);
    unmount();
    renderCard();
    const install = screen.getByRole("button", { name: "インストールする" });
    expect(install).toBeDisabled();
    expect(screen.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await user.click(install);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("hides the section on iPhone Chrome, Firefox, Instagram, LINE, and Facebook", () => {
    for (const userAgent of [
      IPHONE_CRIOS_UA,
      IPHONE_FXIOS_UA,
      IPHONE_INSTAGRAM_UA,
      IPHONE_LINE_UA,
      IPHONE_FBAN_UA,
    ]) {
      cleanup();
      stubSurface("ios", userAgent);
      render(<HomeScreenInstallSection />);
      expect(
        screen.queryByRole("heading", { name: /^ホーム画面に追加$/u }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("listitem", { name: /^共有$/u })).not.toBeInTheDocument();
    }
  });

  it("hides the section on iOS standalone because the icon is already on the home screen", () => {
    stubSurface("ios");
    vi.stubGlobal("navigator", {
      userAgent: IPHONE_UA,
      platform: "iPhone",
      maxTouchPoints: 5,
      standalone: true,
    });
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(display-mode: standalone)",
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
    render(<HomeScreenInstallSection />);
    expect(screen.queryByRole("heading", { name: /^ホーム画面に追加$/u })).not.toBeInTheDocument();
  });

  it("falls back to the other-surface sentence on Android WebView and Firefox without a held prompt", () => {
    stubSurface("android", ANDROID_WEBVIEW_UA);
    render(<HomeScreenInstallSection />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "インストールする" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。",
      ),
    ).toBeVisible();

    cleanup();
    stubSurface("android", FIREFOX_ANDROID_UA);
    render(<HomeScreenInstallSection />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。",
      ),
    ).toBeVisible();
  });

  it("shows the other-surface sentence on desktop", () => {
    stubSurface("other");
    render(<HomeScreenInstallSection />);
    expect(
      screen.getByText(
        "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。",
      ),
    ).toBeVisible();
  });
});
