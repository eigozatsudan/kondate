import { describe, expect, it } from "vitest";
import {
  canUseAndroidChromeInstallSteps,
  canUseIosSafariInstallSteps,
  detectInstallSurface,
  isStandaloneDisplayMode,
} from "./install-surface";

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

  it("keeps iPhone Instagram / LINE / Facebook in-app as ios (surface 三値は増やさない)", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0",
        "iPhone",
        5,
      ),
    ).toBe("ios");
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0",
        "iPhone",
        5,
      ),
    ).toBe("ios");
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/10.0.0.1.0;]",
        "iPhone",
        5,
      ),
    ).toBe("ios");
  });

  it("keeps Android WebView and Firefox Android as android (surface 三値は増やさない)", () => {
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36",
        "Linux armv8l",
        5,
      ),
    ).toBe("android");
    expect(
      detectInstallSurface(
        "Mozilla/5.0 (Android 14; Mobile; rv:122.0) Gecko/122.0 Firefox/122.0",
        "Linux armv8l",
        5,
      ),
    ).toBe("android");
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

describe("canUseIosSafariInstallSteps", () => {
  it("allows Safari-style steps only when Version/ and Safari/ are present", () => {
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe(false);
  });

  it("L2: allows iPad desktop-mode Safari and rejects iPad desktop-mode Chrome", () => {
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe(true);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("L2: rejects Twitter, X, TikTok, GSA, DuckDuckGo, and OPiOS", () => {
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 X/10.0",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_32.5.0 BytedanceWebview/d8a21c6",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/282.0.564170234 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 DuckDuckGo/7 Safari/604.1",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 OPiOS/16.0.15.124414",
      ),
    ).toBe(false);
  });

  it("rejects iPhone Chrome, Firefox, and Edge because they have no Safari share sheet", () => {
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/122.0 Mobile/15E148 Safari/605.1.15",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.2210.86 Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });

  it("rejects iPhone Instagram, LINE, and Facebook in-app", () => {
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0",
      ),
    ).toBe(false);
    expect(
      canUseIosSafariInstallSteps(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/10.0.0.1.0;]",
      ),
    ).toBe(false);
  });
});

describe("canUseAndroidChromeInstallSteps", () => {
  it("allows Chrome-style steps on a Pixel Chrome UA", () => {
    expect(canUseAndroidChromeInstallSteps("Mozilla/5.0 (Linux; Android 14; Pixel)")).toBe(true);
  });

  it("rejects Android WebView and major in-app browsers", () => {
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36",
      ),
    ).toBe(false);
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 [FBAN/FB4A;FBAV/10.0.0.1.0;]",
      ),
    ).toBe(false);
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Line/14.0.0",
      ),
    ).toBe(false);
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Instagram 300.0.0.0.0",
      ),
    ).toBe(false);
  });

  it("rejects Firefox for Android so Chrome menu copy is not shown", () => {
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Android 14; Mobile; rv:122.0) Gecko/122.0 Firefox/122.0",
      ),
    ).toBe(false);
  });

  it("rejects Samsung Internet, Edge Android, and Opera Android so Chrome steps are not shown", () => {
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/110.0.5481.154 Mobile Safari/537.36",
      ),
    ).toBe(false);
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36 EdgA/120.0.2210.141",
      ),
    ).toBe(false);
    expect(
      canUseAndroidChromeInstallSteps(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36 OPR/80.0.4170.72",
      ),
    ).toBe(false);
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
