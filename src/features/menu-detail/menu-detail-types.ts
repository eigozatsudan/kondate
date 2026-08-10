import { FLYER_WEEKLY_UI_ENABLED } from "@shared/contracts/flyer-weekly";
import type { RevalidationResult } from "@/features/history/api/revalidation-api";
import type { RevalidationPhaseName } from "@/features/history/hooks/use-menu-revalidation";

/**
 * 献立詳細（生成直後 / 履歴）で共有する再検証ビュー。
 * テスト注入と live hook の両方を同一 shape に揃える。
 */
export type MenuDetailRevalidationView = {
  phase: RevalidationPhaseName;
  result?: RevalidationResult;
  errorMessage?: string;
  /** soft 再検査飛行中。省略時は false（テスト注入互換） */
  isSoftRechecking?: boolean;
  /**
   * offline hold 中（再 POST せず checking を維持）。
   * 省略時は false。UI は shopping と同型の接続誘導 copy を出す（HR1）。
   */
  isOfflineHold?: boolean;
  refetch?: () => void;
  /** stale confirm 失敗時などに同期的にゲートを閉じる */
  beginRecheck?: () => void;
};

/**
 * エントリ点（/menus/:id vs /history/:id）ごとの表示差分。
 * オーケストレーション本体は Idea/Household body に一本化する。
 */
export type MenuDetailSurface = {
  /** 案切替リンク先（生成直後は /menus、履歴は /history） */
  pathForMenuId: (menuId: string) => string;
  /** Free 成功結果向け週間 flyer upsell（生成直後のみ true） */
  showFlyerUpsell: boolean;
  /** idea 採用後の主操作ラベル */
  ideaAcceptedPrimaryLabel: string;
};

/** 生成直後結果画面（/menus/:menuId） */
export const generationMenuDetailSurface: MenuDetailSurface = {
  pathForMenuId: (menuId) => `/menus/${menuId}`,
  // チラシ UI 全体オフに合わせて成功後 upsell も止める
  showFlyerUpsell: FLYER_WEEKLY_UI_ENABLED,
  ideaAcceptedPrimaryLabel: "作った献立を見る",
};

/** 履歴詳細画面（/history/:menuId） */
export const historyMenuDetailSurface: MenuDetailSurface = {
  pathForMenuId: (menuId) => `/history/${menuId}`,
  showFlyerUpsell: false,
  ideaAcceptedPrimaryLabel: "履歴一覧に戻る",
};

/** 後方互換エイリアス（既存テストの type import 用） */
export type MenuResultPageRevalidationView = MenuDetailRevalidationView;
export type HistoryDetailRevalidationView = MenuDetailRevalidationView;
