import { peekAndroidInstallPrompt } from "./android-install-prompt";
import {
  INSTALL_TIP_ANDROID_INSTALL_LABEL,
  INSTALL_TIP_ANDROID_STEPS,
  INSTALL_TIP_IOS_STEPS,
  INSTALL_TIP_OTHER_BODY,
  INSTALL_TIP_SETTINGS_HEADING,
} from "./install-tip-copy";
import { detectInstallSurface } from "./install-surface";

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
  // 設定は常設。Android で BIP を保持しているときだけインストールボタンを出してよい。
  const androidPrompt = surface === "android" ? peekAndroidInstallPrompt() : null;

  return (
    <section
      className="card stack settings-section"
      aria-labelledby="home-screen-install-section-title"
    >
      <h2 id="home-screen-install-section-title" className="settings-section-title">
        {INSTALL_TIP_SETTINGS_HEADING}
      </h2>
      {surface === "ios" ? (
        <ol>
          {INSTALL_TIP_IOS_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {surface === "android" && androidPrompt !== null ? (
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
      {surface === "android" && androidPrompt === null ? (
        <ol>
          {INSTALL_TIP_ANDROID_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {surface === "other" ? <p>{INSTALL_TIP_OTHER_BODY}</p> : null}
    </section>
  );
}
