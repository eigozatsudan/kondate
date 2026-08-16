import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listenForAndroidInstallPrompt,
  peekAndroidInstallPrompt,
  resetAndroidInstallPromptForTests,
} from "./android-install-prompt";

afterEach(() => {
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
});
