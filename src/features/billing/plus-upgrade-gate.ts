/**
 * Plus アップグレード申込の一時クローズ。
 * フラグ本体は shared 正本（API Checkout 拒否と揃える = B4）。
 * ここは UI 用コピーと re-export。
 */
export { PLUS_LP_UPGRADE_COMING_SOON } from "@shared/contracts/billing";

export const PLUS_LP_COMING_SOON_BADGE = "ただいま開発中" as const;
export const PLUS_LP_COMING_SOON_BODY =
  "Plus へのアップグレードはもう少しで公開予定です。今はお申し込みいただけません。お楽しみに！" as const;
