export type InstallSurface = "ios" | "android" | "other";

// window は読まない。UA / platform / タッチ点数を注入してテストできるようにする。
// iPhone / iPod を先に見るので CriOS / FxiOS も ios になる。
export function detectInstallSurface(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): InstallSurface {
  if (/iPhone|iPod/u.test(userAgent)) return "ios";
  if (/iPad/u.test(userAgent)) return "ios";
  // iPadOS はデスクトップ UA を名乗るため、MacIntel + マルチタッチで判定する
  if (platform === "MacIntel" && maxTouchPoints > 1) return "ios";
  if (/Android/iu.test(userAgent)) return "android";
  return "other";
}

// matchMedia standalone と iOS の navigator.standalone のどちらかが真ならホーム画面起動
export function isStandaloneDisplayMode(
  matchesStandalone: boolean,
  navigatorStandalone: boolean | undefined,
): boolean {
  return matchesStandalone || navigatorStandalone === true;
}
