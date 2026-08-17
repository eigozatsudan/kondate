import { useState } from "react";
import { useLocation } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { useAndroidInstallAction, useAndroidInstallPrompt } from "./android-install-prompt";
import { resolveHomeScreenInstallPresentation } from "./home-screen-install-presentation";
import { HomeScreenInstallSteps } from "./home-screen-install-steps";
import {
  INSTALL_TIP_ANDROID_INSTALL_LABEL,
  INSTALL_TIP_CARD_HEADING,
  INSTALL_TIP_DISMISS_LABEL,
  INSTALL_TIP_LEAD,
  INSTALL_TIP_OTHER_BODY,
} from "./install-tip-copy";
import {
  canUseAndroidChromeInstallSteps,
  canUseIosSafariInstallSteps,
  detectInstallSurface,
  isStandaloneDisplayMode,
} from "./install-surface";
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
  const safariStepsOk = canUseIosSafariInstallSteps(navigator.userAgent);
  const visible = shouldShowInstallTip({
    hasSession: auth.session !== null,
    pathname: location.pathname,
    surface,
    standalone: readStandaloneDisplayMode(),
    dismissed: memoryDismissed || readInstallTipDismissed(window.localStorage),
    safariStepsOk,
  });

  // 描画後 BIP を拾うため peek ではなく購読する。userChoice / appinstalled では自動 dismiss しない。
  const heldAndroidPrompt = useAndroidInstallPrompt();
  const androidPrompt = surface === "android" ? heldAndroidPrompt : null;
  const { installInFlight, requestInstall } = useAndroidInstallAction(androidPrompt);

  // iOS 非 Safari は visible が false。Android WebView / Firefox の手順可否は helper へ渡す。
  // 4 つの真偽値をここで持たず、戻り（steps / body）だけを描く。
  const presentation = resolveHomeScreenInstallPresentation({
    surface,
    safariStepsOk,
    androidChromeStepsOk: canUseAndroidChromeInstallSteps(navigator.userAgent),
    hasAndroidPrompt: androidPrompt !== null,
  });

  if (!visible) return null;

  function handleDismiss(): void {
    writeInstallTipDismissed(window.localStorage);
    setMemoryDismissed(true);
  }

  return (
    <section
      className="card stack home-screen-install-card"
      aria-labelledby="home-screen-install-card-title"
    >
      <h2 id="home-screen-install-card-title">{INSTALL_TIP_CARD_HEADING}</h2>
      <p>{INSTALL_TIP_LEAD}</p>
      <HomeScreenInstallSteps kind={presentation.steps} />
      {presentation.body === "generic" ? <p>{INSTALL_TIP_OTHER_BODY}</p> : null}
      {presentation.body === "prompt" ? (
        <button
          type="button"
          className="primary-button min-h-11"
          disabled={installInFlight}
          onClick={requestInstall}
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
