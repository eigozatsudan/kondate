import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  injectAndroidInstallPromptForTests,
  listenForAndroidInstallPrompt,
  resetAndroidInstallPromptForTests,
} from "./android-install-prompt";
import { HomeScreenInstallSection } from "./home-screen-install-section";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
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
  });
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
    expect(screen.getByRole("heading", { level: 2, name: "ホーム画面に追加" })).toBeVisible();
  });

  it("shows iOS steps on iOS", () => {
    stubSurface("ios");
    render(<HomeScreenInstallSection />);
    expect(screen.getByText("画面の下（または上）の共有ボタンをタップします")).toBeVisible();
    expect(screen.getByText("「ホーム画面に追加」を選びます")).toBeVisible();
    expect(screen.getByText("「追加」をタップします")).toBeVisible();
  });

  it("shows Android steps on Android when no install prompt is held", () => {
    stubSurface("android");
    render(<HomeScreenInstallSection />);
    expect(screen.getByText("右上のメニューを開きます")).toBeVisible();
    expect(
      screen.getByText("「アプリをインストール」または「ホーム画面に追加」を選びます"),
    ).toBeVisible();
  });

  it("replaces Android steps with the install button when BIP arrives after first paint", async () => {
    listenForAndroidInstallPrompt();
    stubSurface("android");
    render(<HomeScreenInstallSection />);
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
    expect(screen.getByRole("heading", { name: "ホーム画面に追加" })).toBeVisible();
    window.removeEventListener("unhandledrejection", unhandled);
  });

  it("falls back to the other-surface sentence on Android WebView and Firefox without a held prompt", () => {
    stubSurface("android", ANDROID_WEBVIEW_UA);
    render(<HomeScreenInstallSection />);
    expect(screen.queryByText("右上のメニューを開きます")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "インストールする" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。",
      ),
    ).toBeVisible();

    cleanup();
    stubSurface("android", FIREFOX_ANDROID_UA);
    render(<HomeScreenInstallSection />);
    expect(screen.queryByText("右上のメニューを開きます")).not.toBeInTheDocument();
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
