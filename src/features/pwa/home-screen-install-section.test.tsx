import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listenForAndroidInstallPrompt,
  resetAndroidInstallPromptForTests,
} from "./android-install-prompt";
import { HomeScreenInstallSection } from "./home-screen-install-section";

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
