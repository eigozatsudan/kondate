import type { RegenerationUsageView } from "@/features/history/components/regeneration-sheet";
import type { useUsageToday } from "@/features/generation/hooks/use-usage-today";

/** usage-today クエリを再生成シート向けの閉じた view に写す（生成直後・履歴で共有）。 */
export function usageViewFromQuery(
  usage: ReturnType<typeof useUsageToday>,
): RegenerationUsageView {
  return {
    successRemaining: usage.isSuccess ? usage.data.success.remaining : null,
    attemptsRemaining: usage.isSuccess ? usage.data.attempts.remaining : null,
    shortWindowRemaining: usage.isSuccess ? usage.data.shortWindow.remaining : null,
    plan: usage.isSuccess ? usage.data.plan : null,
    shortWindowRetryAt:
      usage.isSuccess && usage.data.shortWindow.remaining === 0
        ? usage.data.shortWindow.retryAt
        : null,
    loading: usage.isPending || usage.isFetching,
    error: usage.isError,
  };
}
