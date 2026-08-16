import { useState } from "react";
import { useLocation } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { peekAndroidInstallPrompt } from "./android-install-prompt";
import {
  INSTALL_TIP_ANDROID_INSTALL_LABEL,
  INSTALL_TIP_ANDROID_STEPS,
  INSTALL_TIP_CARD_HEADING,
  INSTALL_TIP_DISMISS_LABEL,
  INSTALL_TIP_IOS_STEPS,
  INSTALL_TIP_LEAD,
} from "./install-tip-copy";
import { detectInstallSurface, isStandaloneDisplayMode } from "./install-surface";
import { shouldShowInstallTip } from "./install-tip-eligibility";
import { readInstallTipDismissed, writeInstallTipDismissed } from "./install-tip-storage";

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

function readNavigatorPlatform(): string {
  // Navigator.platform は deprecated だが iPadOS 判定（MacIntel + タッチ）に必要
  const value: unknown = Reflect.get(navigator, "platform");
  return typeof value === "string" ? value : "";
}

function readStandaloneDisplayMode(): boolean {
  const matchesStandalone =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)").matches
      : false;
  return isStandaloneDisplayMode(
    matchesStandalone,
    (navigator as NavigatorWithStandalone).standalone,
  );
}

export function HomeScreenInstallCard() {
  const auth = useAuth();
  const location = useLocation();
  // 書き込み失敗でも同一マウントでは再表示しない。リロード後はフラグ無しなら出してよい。
  const [memoryDismissed, setMemoryDismissed] = useState(false);

  const surface = detectInstallSurface(
    navigator.userAgent,
    readNavigatorPlatform(),
    navigator.maxTouchPoints,
  );
  const visible = shouldShowInstallTip({
    hasSession: auth.session !== null,
    pathname: location.pathname,
    surface,
    standalone: readStandaloneDisplayMode(),
    dismissed: memoryDismissed || readInstallTipDismissed(window.localStorage),
  });

  if (!visible) return null;

  // Android のボタン正本は peek。userChoice / appinstalled では自動 dismiss しない。
  const androidPrompt = surface === "android" ? peekAndroidInstallPrompt() : null;
  const showIosSteps = surface === "ios";
  const showAndroidSteps = surface === "android" && androidPrompt === null;

  function handleDismiss(): void {
    writeInstallTipDismissed(window.localStorage);
    setMemoryDismissed(true);
  }

  return (
    <section className="card stack" aria-labelledby="home-screen-install-card-title">
      <h2 id="home-screen-install-card-title">{INSTALL_TIP_CARD_HEADING}</h2>
      <p>{INSTALL_TIP_LEAD}</p>
      {showIosSteps ? (
        <ol>
          {INSTALL_TIP_IOS_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {showAndroidSteps ? (
        <ol>
          {INSTALL_TIP_ANDROID_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {androidPrompt !== null ? (
        <button
          type="button"
          className="primary-button min-h-11"
          onClick={() => {
            void androidPrompt.prompt();
          }}
        >
          {INSTALL_TIP_ANDROID_INSTALL_LABEL}
        </button>
      ) : null}
      <button type="button" className="secondary-button min-h-11" onClick={handleDismiss}>
        {INSTALL_TIP_DISMISS_LABEL}
      </button>
    </section>
  );
}
