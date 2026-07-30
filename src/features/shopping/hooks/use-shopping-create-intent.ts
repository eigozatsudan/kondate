import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  beginShoppingIntentCycle,
  cancelPendingIntentClear,
  clearShoppingIntentCycle,
  clearShoppingSheetExpected,
  hasShoppingIntent,
  isShoppingIntentActive,
  markShoppingSheetAutoOpened,
  scheduleIntentClear,
  SHOPPING_INTENT_PARAM,
} from "../shopping-intent";

/**
 * 買い物作成 intent（for=shopping）の URL 取り込みと L15 unmount 遅延 clear。
 * effect は分割必須: URL 取り込み cleanup では schedule しない。
 */
export function useShoppingCreateIntent(menuId: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  // A: URL 取り込みのみ — cleanup で schedule しない（計画 C1）
  useEffect(() => {
    if (menuId.length === 0) return;
    if (!hasShoppingIntent(searchParams)) return;
    beginShoppingIntentCycle(menuId);
    const next = new URLSearchParams(searchParams);
    next.delete(SHOPPING_INTENT_PARAM);
    setSearchParams(next, { replace: true });
    bump();
  }, [menuId, searchParams, setSearchParams, bump]);

  // B: 真の mount/unmount のみ
  useEffect(() => {
    if (menuId.length === 0) return;
    cancelPendingIntentClear(menuId);
    return () => {
      scheduleIntentClear(menuId);
    };
  }, [menuId]);

  void tick;
  const shoppingIntentActive = menuId.length > 0 && isShoppingIntentActive(menuId);

  return {
    shoppingIntentActive,
    markAutoOpened: () => {
      if (menuId.length === 0) return;
      markShoppingSheetAutoOpened(menuId);
      bump();
    },
    clearSheetExpected: () => {
      if (menuId.length === 0) return;
      clearShoppingSheetExpected(menuId);
      bump();
    },
    clearCycle: () => {
      if (menuId.length === 0) return;
      clearShoppingIntentCycle(menuId);
      bump();
    },
  };
}
