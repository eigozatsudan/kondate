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

// iOS の「ホーム画面に追加」は Safari の共有シートだけ。三値は ios のまま。
// Version/ + Safari/ が無い面（in-app / iPad デスクトップ Chrome 等）には手順を出さない。
// 両方を名乗る派生（EdgiOS / OPiOS / DuckDuckGo）も共有シートが無い。
export function canUseIosSafariInstallSteps(userAgent: string): boolean {
  if (!/Version\//u.test(userAgent) || !/Safari\//u.test(userAgent)) return false;
  if (/FBAN|FBAV|FB_IAB/iu.test(userAgent)) return false;
  if (/Line\//iu.test(userAgent)) return false;
  if (/Instagram/iu.test(userAgent)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/u.test(userAgent)) return false;
  if (/Chrome\/|Firefox\/|Edg\//u.test(userAgent)) return false;
  if (/Twitter|musical_ly|BytedanceWebview|GSA\/|DuckDuckGo/iu.test(userAgent)) return false;
  if (/\sX\/\d/u.test(userAgent)) return false;
  return true;
}

// Android surface のまま Chrome 手順を出してよいか。三値契約は増やさない。
// WebView / 主要 in-app / Firefox / Samsung / Edge / Opera には
// Chrome の「メニュー→ホーム画面に追加」文言が無い。
export function canUseAndroidChromeInstallSteps(userAgent: string): boolean {
  if (/;\s*wv\)/iu.test(userAgent)) return false;
  if (/FBAN|FBAV|FB_IAB/iu.test(userAgent)) return false;
  if (/Line\//iu.test(userAgent)) return false;
  if (/Instagram/iu.test(userAgent)) return false;
  if (/Firefox\//iu.test(userAgent)) return false;
  if (/SamsungBrowser\//iu.test(userAgent)) return false;
  if (/EdgA\//u.test(userAgent)) return false;
  if (/OPR\//u.test(userAgent)) return false;
  return true;
}

// matchMedia standalone と iOS の navigator.standalone のどちらかが真ならホーム画面起動
export function isStandaloneDisplayMode(
  matchesStandalone: boolean,
  navigatorStandalone: boolean | undefined,
): boolean {
  return matchesStandalone || navigatorStandalone === true;
}
