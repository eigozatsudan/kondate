// Spec 簡易化 §4 の固定文言。カード見出しと設定見出しは exact name で区別する。
// 「PWA」「Service Worker」「キャッシュ」はユーザー向けに書かない。

export const INSTALL_TIP_CARD_HEADING = "ホーム画面に置く";
export const INSTALL_TIP_SETTINGS_HEADING = "ホーム画面に追加";
export const INSTALL_TIP_LEAD = "ホーム画面に置くと、次からすぐ開けます。";
export const INSTALL_TIP_DISMISS_LABEL = "わかりました";
export const INSTALL_TIP_ANDROID_INSTALL_LABEL = "インストールする";

export const INSTALL_TIP_IOS_STEPS = ["共有", "ホーム画面に追加", "追加"] as const;

export const INSTALL_TIP_ANDROID_STEPS = ["メニュー", "ホーム画面に追加"] as const;

export const INSTALL_TIP_OTHER_BODY =
  "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。";
