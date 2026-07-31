/**
 * Plus アップグレード申込の一時クローズ。
 * true のあいだ LP と Settings の Checkout を閉じ、開発中バナーを出す（公開時に false に戻す）。
 * （boolean 注釈は true 切替時に lint の always-truthy/falsy を避けるため）
 */
export const PLUS_LP_UPGRADE_COMING_SOON: boolean = true;
export const PLUS_LP_COMING_SOON_BADGE = "ただいま開発中" as const;
export const PLUS_LP_COMING_SOON_BODY =
  "Plus へのアップグレードはもう少しで公開予定です。今はお申し込みいただけません。お楽しみに！" as const;
