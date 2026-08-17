import { useAndroidInstallAction, useAndroidInstallPrompt } from "./android-install-prompt";
import { resolveHomeScreenInstallPresentation } from "./home-screen-install-presentation";
import { HomeScreenInstallSteps } from "./home-screen-install-steps";
import {
  INSTALL_TIP_ANDROID_INSTALL_LABEL,
  INSTALL_TIP_OTHER_BODY,
  INSTALL_TIP_SETTINGS_HEADING,
} from "./install-tip-copy";
import {
  canUseAndroidChromeInstallSteps,
  canUseIosSafariInstallSteps,
  detectInstallSurface,
  isStandaloneDisplayMode,
} from "./install-surface";

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

export function HomeScreenInstallSection() {
  const surface = detectInstallSurface(
    navigator.userAgent,
    readNavigatorPlatform(),
    navigator.maxTouchPoints,
  );
  const safariStepsOk = canUseIosSafariInstallSteps(navigator.userAgent);
  // 設定は常設。描画後 BIP も購読してインストールボタンを出す。userChoice では閉じない。
  const heldAndroidPrompt = useAndroidInstallPrompt();
  const androidPrompt = surface === "android" ? heldAndroidPrompt : null;
  const { installInFlight, requestInstall } = useAndroidInstallAction(androidPrompt);
  // 手順可否と BIP 有無は helper に任せ、4 つの真偽値をここで持たない。
  const presentation = resolveHomeScreenInstallPresentation({
    surface,
    safariStepsOk,
    androidChromeStepsOk: canUseAndroidChromeInstallSteps(navigator.userAgent),
    hasAndroidPrompt: androidPrompt !== null,
  });
  // iOS は Safari の共有シートだけ。Chrome / in-app / ホーム画面起動では節ごと出さない。
  if (surface === "ios" && (!safariStepsOk || readStandaloneDisplayMode())) {
    return null;
  }

  return (
    <section
      className="card stack settings-section"
      aria-labelledby="home-screen-install-section-title"
    >
      <h2 id="home-screen-install-section-title" className="settings-section-title">
        {INSTALL_TIP_SETTINGS_HEADING}
      </h2>
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
    </section>
  );
}
