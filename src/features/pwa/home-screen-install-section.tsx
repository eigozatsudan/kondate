import { useAndroidInstallAction, useAndroidInstallPrompt } from "./android-install-prompt";
import {
  INSTALL_TIP_ANDROID_INSTALL_LABEL,
  INSTALL_TIP_ANDROID_STEPS,
  INSTALL_TIP_IOS_STEPS,
  INSTALL_TIP_OTHER_BODY,
  INSTALL_TIP_SETTINGS_HEADING,
} from "./install-tip-copy";
import {
  canUseAndroidChromeInstallSteps,
  canUseIosSafariInstallSteps,
  detectInstallSurface,
} from "./install-surface";

function readNavigatorPlatform(): string {
  // Navigator.platform は deprecated だが iPadOS 判定（MacIntel + タッチ）に必要
  const value: unknown = Reflect.get(navigator, "platform");
  return typeof value === "string" ? value : "";
}

export function HomeScreenInstallSection() {
  const surface = detectInstallSurface(
    navigator.userAgent,
    readNavigatorPlatform(),
    navigator.maxTouchPoints,
  );
  // 設定は常設。描画後 BIP も購読してインストールボタンを出す。userChoice では閉じない。
  const heldAndroidPrompt = useAndroidInstallPrompt();
  const androidPrompt = surface === "android" ? heldAndroidPrompt : null;
  const { installInFlight, requestInstall } = useAndroidInstallAction(androidPrompt);
  // WebView / Firefox は android でも Chrome 手順を出さず other 文へ落とす。
  // Instagram / LINE / Facebook in-app は ios のまま Safari 3 手順を出さない。
  const iosSafariStepsOk = canUseIosSafariInstallSteps(navigator.userAgent);
  const showIosSteps = surface === "ios" && iosSafariStepsOk;
  const androidChromeStepsOk = canUseAndroidChromeInstallSteps(navigator.userAgent);
  const showAndroidChromeSteps =
    surface === "android" && androidPrompt === null && androidChromeStepsOk;
  const showGenericInstallBody =
    surface === "other" ||
    (surface === "ios" && !iosSafariStepsOk) ||
    (surface === "android" && androidPrompt === null && !androidChromeStepsOk);

  return (
    <section
      className="card stack settings-section"
      aria-labelledby="home-screen-install-section-title"
    >
      <h2 id="home-screen-install-section-title" className="settings-section-title">
        {INSTALL_TIP_SETTINGS_HEADING}
      </h2>
      {showIosSteps ? (
        <ol>
          {INSTALL_TIP_IOS_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {androidPrompt !== null ? (
        <button
          type="button"
          className="primary-button min-h-11"
          disabled={installInFlight}
          onClick={requestInstall}
        >
          {INSTALL_TIP_ANDROID_INSTALL_LABEL}
        </button>
      ) : null}
      {showAndroidChromeSteps ? (
        <ol>
          {INSTALL_TIP_ANDROID_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {showGenericInstallBody ? <p>{INSTALL_TIP_OTHER_BODY}</p> : null}
    </section>
  );
}
