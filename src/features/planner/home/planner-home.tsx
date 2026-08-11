import type { JSX, ReactNode } from "react";
import { PageHeader } from "@/shared/ui/page-header";
import { Stack } from "@/shared/ui/stack";
import { HomeExpiringPantry, type HomeExpiringPantryItem } from "./home-expiring-pantry";
import { HomeGenerateCard } from "./home-generate-card";
import { HomeRecentMenus, type HomeRecentMenuItem } from "./home-recent-menus";

export type PlannerHomeProps = {
  remainingToday: number | null;
  onStartWizard: () => void;
  hasResumablePending?: boolean;
  onResumePending?: () => void;
  recentMenus: readonly HomeRecentMenuItem[];
  recentMenusLoading?: boolean;
  recentMenusError?: boolean;
  onRetryRecentMenus?: () => void;
  expiringItems: readonly HomeExpiringPantryItem[];
  /** チラシ枠など、route が所有する付帯 UI。 */
  footer?: ReactNode;
  /** 背景 refetch 失敗など、route 側の soft バナー。 */
  banner?: ReactNode;
  /**
   * leave-flush / eligibility strip / 明示保存失敗など route 側の hard エラー。
   * wizard の error と同型で role=alert。soft banner とは分離する。
   */
  error?: string | null;
  /** 主 CTA を止める（遷移中など）。 */
  disabled?: boolean;
};

/**
 * 献立タブのホーム組み立て。表示専用。
 * データ取得・下書き・pending 判定は planner-route に残す。
 */
export function PlannerHome({
  remainingToday,
  onStartWizard,
  hasResumablePending = false,
  onResumePending,
  recentMenus,
  recentMenusLoading = false,
  recentMenusError = false,
  onRetryRecentMenus,
  expiringItems,
  footer = null,
  banner = null,
  error = null,
  disabled = false,
}: PlannerHomeProps): JSX.Element {
  return (
    <main className="page-frame home-page">
      <Stack gap={5}>
        <PageHeader
          title="今日の献立"
          lead="いま作りたい献立の入口です。質問に答えて新しい案をつくるか、直近の献立を見返せます。"
        />
        {banner}
        {error !== null && error !== "" ? <p role="alert">{error}</p> : null}
        <HomeGenerateCard
          remainingToday={remainingToday}
          onStart={onStartWizard}
          hasResumablePending={hasResumablePending}
          {...(onResumePending !== undefined ? { onResumePending } : {})}
          disabled={disabled}
        />
        <HomeExpiringPantry items={expiringItems} />
        <HomeRecentMenus
          menus={recentMenus}
          loading={recentMenusLoading}
          error={recentMenusError}
          {...(onRetryRecentMenus !== undefined ? { onRetry: onRetryRecentMenus } : {})}
        />
        {footer}
      </Stack>
    </main>
  );
}
