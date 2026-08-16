// Spec §8.4 の固定文言。カード見出しと設定見出しは exact name で区別する。
// 「PWA」「Service Worker」「キャッシュ」はユーザー向けに書かない。

export const INSTALL_TIP_CARD_HEADING = "ホーム画面に置く";
export const INSTALL_TIP_SETTINGS_HEADING = "ホーム画面に追加";
export const INSTALL_TIP_LEAD = "ホーム画面に置くと、次からすぐ開けます。";
export const INSTALL_TIP_DISMISS_LABEL = "わかりました";
export const INSTALL_TIP_ANDROID_INSTALL_LABEL = "インストールする";

export const INSTALL_TIP_IOS_STEPS = [
  "画面の下（または上）の共有ボタンをタップします",
  "「ホーム画面に追加」を選びます",
  "「追加」をタップします",
] as const;

export const INSTALL_TIP_ANDROID_STEPS = [
  "右上のメニューを開きます",
  "「アプリをインストール」または「ホーム画面に追加」を選びます",
] as const;

export const INSTALL_TIP_OTHER_BODY =
  "お使いのブラウザのメニューから、「ホーム画面に追加」または「アプリをインストール」を選んでください。";
