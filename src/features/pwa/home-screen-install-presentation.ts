import type { InstallSurface } from "./install-surface";

export type HomeScreenInstallPresentation =
  | { steps: "ios"; body: "none" }
  | { steps: "android"; body: "none" }
  | { steps: "none"; body: "prompt" }
  | { steps: "none"; body: "generic" };

// surface と手順可否・BIP 有無から、カードに出す手順／本文の組み合わせを決める。
// 副作用なし。card/section への配線は別 Task。
export function resolveHomeScreenInstallPresentation(input: {
  surface: InstallSurface;
  safariStepsOk: boolean;
  androidChromeStepsOk: boolean;
  hasAndroidPrompt: boolean;
}): HomeScreenInstallPresentation {
  if (input.surface === "ios") {
    return input.safariStepsOk
      ? { steps: "ios", body: "none" }
      : { steps: "none", body: "generic" };
  }
  if (input.surface === "android") {
    if (input.hasAndroidPrompt) {
      return { steps: "none", body: "prompt" };
    }
    return input.androidChromeStepsOk
      ? { steps: "android", body: "none" }
      : { steps: "none", body: "generic" };
  }
  return { steps: "none", body: "generic" };
}
