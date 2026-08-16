import { describe, expect, it } from "vitest";
import { detectInstallSurface, isStandaloneDisplayMode } from "./install-surface";

describe("detectInstallSurface", () => {
  it("classifies iPhone as ios", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "iPhone",
        5,
      ),
    ).toBe("ios");
  });

  it("classifies iPod as ios", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        "iPod",
        5,
      ),
    ).toBe("ios");
  });

  it("classifies CriOS on iPhone as ios", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
        "iPhone",
        5,
      ),
    ).toBe("ios");
  });

  it("classifies iPad as ios", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "iPad",
        5,
      ),
    ).toBe("ios");
  });

  it("classifies MacIntel with more than one touch point as ios", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "MacIntel",
        5,
      ),
    ).toBe("ios");
  });

  it("classifies an Android Pixel UA as android", () => {
    expect(detectInstallSurface("Mozilla/5.0 (Linux; Android 14; Pixel)", "Linux armv8l", 5)).toBe(
      "android",
    );
  });

  it("classifies Windows NT as other", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Win32",
        0,
      ),
    ).toBe("other");
  });

  it("classifies Macintosh with no touch as other", () => {
    expect(
      detectInstallSurface("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0),
    ).toBe("other");
  });

  it("classifies Linux x86_64 without Android as other", () => {
    expect(detectInstallSurface("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64", 0)).toBe(
      "other",
    );
  });
});

describe("isStandaloneDisplayMode", () => {
  it("is true when the standalone media query matches", () => {
    expect(isStandaloneDisplayMode(true, undefined)).toBe(true);
    expect(isStandaloneDisplayMode(true, false)).toBe(true);
  });

  it("is true when navigator.standalone is true", () => {
    expect(isStandaloneDisplayMode(false, true)).toBe(true);
  });

  it("is false when neither signal is standalone", () => {
    expect(isStandaloneDisplayMode(false, undefined)).toBe(false);
    expect(isStandaloneDisplayMode(false, false)).toBe(false);
  });
});
