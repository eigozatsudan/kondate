import { describe, expect, it } from "vitest";
import { resolveHomeScreenInstallPresentation } from "./home-screen-install-presentation";

describe("resolveHomeScreenInstallPresentation", () => {
  it("returns ios steps for Safari-capable iOS", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "ios",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "ios", body: "none" });
  });

  it("returns generic for iOS in-app", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "ios",
        safariStepsOk: false,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "none", body: "generic" });
  });

  it("returns prompt for Android when BIP is held", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "android",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: true,
      }),
    ).toEqual({ steps: "none", body: "prompt" });
  });

  it("returns android steps when Chrome steps are allowed and no BIP", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "android",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "android", body: "none" });
  });

  it("returns generic for Android WebView or Firefox without BIP", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "android",
        safariStepsOk: true,
        androidChromeStepsOk: false,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "none", body: "generic" });
  });

  it("returns generic for other surfaces", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "other",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "none", body: "generic" });
  });
});
