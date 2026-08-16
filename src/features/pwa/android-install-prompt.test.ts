import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listenForAndroidInstallPrompt,
  peekAndroidInstallPrompt,
  resetAndroidInstallPromptForTests,
  useAndroidInstallAction,
} from "./android-install-prompt";

afterEach(() => {
  cleanup();
  resetAndroidInstallPromptForTests();
});

describe("android install prompt", () => {
  it("holds a dispatched beforeinstallprompt after listen and clears on reset", () => {
    listenForAndroidInstallPrompt();
    const prompt = vi.fn(() => Promise.resolve());
    const event = new Event("beforeinstallprompt");
    Object.defineProperty(event, "prompt", { value: prompt });
    const preventDefault = vi.spyOn(event, "preventDefault");

    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(peekAndroidInstallPrompt()?.prompt).toBe(prompt);

    resetAndroidInstallPromptForTests();
    expect(peekAndroidInstallPrompt()).toBeNull();
  });

  it("shares install-started across hook instances so the other surface is disabled", () => {
    const prompt = vi.fn(() => Promise.resolve());
    const { result: first } = renderHook(() => useAndroidInstallAction({ prompt }));
    expect(first.current.installInFlight).toBe(false);
    act(() => {
      first.current.requestInstall();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(first.current.installInFlight).toBe(true);

    const { result: second } = renderHook(() => useAndroidInstallAction({ prompt }));
    expect(second.current.installInFlight).toBe(true);
    act(() => {
      second.current.requestInstall();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
