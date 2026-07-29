import { useCallback, useMemo, useState } from "react";
import { FLYER_UPSELL_WEEK_KEY, jstIsoWeekKey } from "./jst-iso-week";

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
      className="card stack gap-2"
      role="region"
      aria-label="チラシから献立を作る案内"
      data-testid="flyer-upsell-banner"
    >
      <p>{FLYER_UPSELL_COPY}</p>
      <button type="button" className="secondary-button min-h-11" onClick={onDismiss}>
        閉じる
      </button>
    </aside>
  );
}
