import { describe, expect, it } from "vitest";
import {
  INSTALL_TIP_ANDROID_INSTALL_LABEL,
  INSTALL_TIP_ANDROID_STEPS,
  INSTALL_TIP_CARD_HEADING,
  INSTALL_TIP_DISMISS_LABEL,
  INSTALL_TIP_IOS_STEPS,
  INSTALL_TIP_LEAD,
  INSTALL_TIP_OTHER_BODY,
  INSTALL_TIP_SETTINGS_HEADING,
} from "./install-tip-copy";

describe("install tip copy", () => {
  it("uses the spec §8.4 card and settings headings", () => {
    expect(INSTALL_TIP_CARD_HEADING).toBe("ホーム画面に置く");
    expect(INSTALL_TIP_SETTINGS_HEADING).toBe("ホーム画面に追加");
    expect(INSTALL_TIP_LEAD).toBe("ホーム画面に置くと、次からすぐ開けます。");
  });

  it("uses the spec §8.4 dismiss and Android install labels", () => {
    expect(INSTALL_TIP_DISMISS_LABEL).toBe("わかりました");
    expect(INSTALL_TIP_ANDROID_INSTALL_LABEL).toBe("インストールする");
  });

  it("keeps the iOS three-step list exact", () => {
    expect(INSTALL_TIP_IOS_STEPS).toEqual([
      "画面の下（または上）の共有ボタンをタップします",
      "「ホーム画面に追加」を選びます",
      "「追加」をタップします",
    ]);
  });

  it("keeps the Android two-step list exact", () => {
    expect(INSTALL_TIP_ANDROID_STEPS).toEqual([
      "右上のメニューを開きます",
      "「アプリをインストール」または「ホーム画面に追加」を選びます",
    ]);
  });

  it("keeps the other-surface sentence exact", () => {
    expect(INSTALL_TIP_OTHER_BODY).toBe(
      "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。",
    );
  });

  it("does not include the letters PWA", () => {
    const allCopy = [
      INSTALL_TIP_CARD_HEADING,
      INSTALL_TIP_SETTINGS_HEADING,
      INSTALL_TIP_LEAD,
      INSTALL_TIP_DISMISS_LABEL,
      INSTALL_TIP_ANDROID_INSTALL_LABEL,
      ...INSTALL_TIP_IOS_STEPS,
      ...INSTALL_TIP_ANDROID_STEPS,
      INSTALL_TIP_OTHER_BODY,
    ].join("\n");
    expect(allCopy).not.toMatch(/PWA/u);
  });
});
