import { useCallback, useMemo, useState } from "react";
import { FLYER_UPSELL_WEEK_KEY, jstIsoWeekKey } from "./jst-iso-week";
import { PLUS_HARD_LIMIT_BUTTON } from "./plus-cta";

/** L10-6 固定コピー。テスト exact 一致。 */
export const FLYER_UPSELL_COPY = "来週の献立をチラシからまとめて作ることもできます" as const;

export type FlyerUpsellBannerProps = {
  /** Plus 加入者には出さない（entitlement 投影）。 */
  plusEntitled: boolean;
  /** テスト注入用。省略時は new Date()。 */
  now?: Date;
  /** テスト注入用 storage。省略時は localStorage。 */
  storage?: Pick<Storage, "getItem" | "setItem">;
};

/**
 * 献立成功後の週間 upsell（L10-6）。
 * Free のみ・JST 週 1 回まで。閉じたら flyer_upsell_week に YYYY-Www を書く。
 * 成功本体より目立たせない注記トーン。Plus への導線は残し、閉じるは副操作。
 */
export function FlyerUpsellBanner({
  plusEntitled,
  now = new Date(),
  storage,
}: FlyerUpsellBannerProps) {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  const weekKey = useMemo(() => jstIsoWeekKey(now), [now]);
  const [dismissed, setDismissed] = useState(() => {
    if (plusEntitled) return true;
    if (store === undefined) return false;
    return store.getItem(FLYER_UPSELL_WEEK_KEY) === weekKey;
  });

  const onDismiss = useCallback(() => {
    store?.setItem(FLYER_UPSELL_WEEK_KEY, weekKey);
    setDismissed(true);
  }, [store, weekKey]);

  if (plusEntitled || dismissed) return null;

  return (
    <aside
      className="flyer-upsell-banner"
      role="region"
      aria-label="チラシから献立を作る案内"
      data-testid="flyer-upsell-banner"
    >
      <p className="flyer-upsell-banner-copy">{FLYER_UPSELL_COPY}</p>
      <div className="flyer-upsell-banner-actions">
        {/* Checkout は設定画面。Router 外 unit でも描画できるよう a を使う。 */}
        <a href="/settings" className="flyer-upsell-banner-cta min-h-11">
          {PLUS_HARD_LIMIT_BUTTON}
        </a>
        <button type="button" className="flyer-upsell-banner-dismiss min-h-11" onClick={onDismiss}>
          閉じる
        </button>
      </div>
    </aside>
  );
}
