import type { JSX } from "react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { hasShoppingIntent } from "@/features/shopping/shopping-intent";
import { useAuth } from "@/features/auth/use-auth";
import { householdKeys } from "@/features/household/household-queries";
import { loadCurrentCompleteMemberIds } from "@/features/weekly-plan/weekly-plan-eligibility.js";
import { useWeeklyPlanHistory } from "@/features/weekly-plan/weekly-plan-history.js";
import { WeeklyPlanHistoryCard } from "@/features/weekly-plan/components/weekly-plan-history-card";
import type { WeeklyPlanHistoryRow } from "@/features/weekly-plan/components/weekly-plan-history-card";
import { WEEKLY_PLAN_UI_ENABLED } from "@shared/contracts/weekly-plan";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/feedback";
import { PageHeader } from "@/shared/ui/page-header";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import { SwitchStateText } from "@/shared/ui/switch-state-text";
import type { HistoryGroup } from "../model/group-history";
import { HistoryCard } from "../components/history-card";
import { useHistoryGroups } from "../hooks/use-history";

/** 週献立履歴クエリの表示状態。pending 中はセクション自体を出さず、error は一覧とは独立して通知する。 */
type WeeklyPlanHistorySlotStatus = "pending" | "error" | "ready";

function WeeklyPlanHistorySlot({
  weeklyPlans,
  currentCompleteMemberIds,
  status,
  retrying = false,
  onRetry,
}: {
  weeklyPlans: readonly WeeklyPlanHistoryRow[];
  currentCompleteMemberIds: readonly string[] | null;
  status: WeeklyPlanHistorySlotStatus;
  retrying?: boolean;
  // HistoryPage は再試行なし（undefined）でも描画できるため明示的な undefined を許容する
  onRetry?: (() => void) | undefined;
}): JSX.Element | null {
  if (!WEEKLY_PLAN_UI_ENABLED) return null;
  // 読込中は補助セクションを出さない（履歴本体の読込表示とは別系統で、確定後に現れる）。
  if (status === "pending") return null;
  // 週献立の取得失敗で履歴ページ全体を落とさない。セクション内に留めて再試行を提供する。
  if (status === "error") {
    return (
      <Surface as="section" tone="notice">
        <Inset pad={5}>
          <Stack gap={3}>
            <p role="alert">今週の献立を読み込めませんでした</p>
            <Button
              variant="secondary"
              disabled={retrying}
              onClick={() => {
                onRetry?.();
              }}
            >
              もう一度読み込む
            </Button>
          </Stack>
        </Inset>
      </Surface>
    );
  }
  return (
    <WeeklyPlanHistoryCard
      plans={weeklyPlans}
      currentCompleteMemberIds={currentCompleteMemberIds}
    />
  );
}

/** 履歴一覧ルート。取得状態に応じて loading / empty / list を切り替える。 */
export function HistoryPage() {
  const [params] = useSearchParams();
  const shoppingIntent = hasShoppingIntent(params);
  const { data = [], isPending, isError, refetch, isFetching } = useHistoryGroups();
  const { session } = useAuth();
  const userId = session?.user.id;
  const weeklyPlansQuery = useWeeklyPlanHistory(WEEKLY_PLAN_UI_ENABLED ? userId : undefined);
  const completeIdsQuery = useQuery({
    queryKey: [...householdKeys.members(userId ?? "missing"), "weekly-plan-history-complete-ids"],
    queryFn: () => loadCurrentCompleteMemberIds(userId ?? ""),
    enabled: userId !== undefined && WEEKLY_PLAN_UI_ENABLED,
  });
  const weeklyPlans = weeklyPlansQuery.data ?? [];
  // 未確定は null（≠ 0 人確定の []）。pending / error の [] フォールバックだと
  // WeeklyPlanHistoryCard の partial 判定が常に真になり誤警告が出る。
  const currentCompleteMemberIds = completeIdsQuery.data ?? null;

  if (isPending) {
    return (
      <main className="page-frame">
        <Skeleton label="履歴を読み込んでいます" lines={3} />
      </main>
    );
  }

  if (isError) {
    return (
      <main className="page-frame">
        <Stack gap={4}>
          <PageHeader title="作った献立" />
          <Surface as="section" tone="notice">
            <Inset pad={5}>
              <Stack gap={3}>
                <p role="alert">履歴を読み込めませんでした</p>
                <Button
                  variant="secondary"
                  disabled={isFetching}
                  onClick={() => {
                    void refetch();
                  }}
                >
                  もう一度読み込む
                </Button>
              </Stack>
            </Inset>
          </Surface>
        </Stack>
      </main>
    );
  }

  return (
    <HistoryPageContent
      groups={data}
      shoppingIntent={shoppingIntent}
      weeklyPlans={weeklyPlans}
      currentCompleteMemberIds={currentCompleteMemberIds}
      weeklyPlanStatus={
        weeklyPlansQuery.isPending ? "pending" : weeklyPlansQuery.isError ? "error" : "ready"
      }
      weeklyPlanRetrying={weeklyPlansQuery.isFetching}
      onWeeklyPlanRetry={() => {
        void weeklyPlansQuery.refetch();
      }}
    />
  );
}

function ShoppingIntentBanner() {
  return (
    <Surface as="section" role="status" tone="notice">
      <Inset pad={5}>
        <Stack gap={3}>
          <p className="history-banner-title">買い物リスト用に献立を選んでください</p>
          <p className="type-small">
            「家族に合わせた献立」の「買い物リストを作る」を押します。アイデア献立は使えません。
          </p>
          <Link className="button-link" to="/shopping">
            買い物に戻る
          </Link>
        </Stack>
      </Inset>
    </Surface>
  );
}

/** テスト注入用の表示本体。hooks を持たない。 */
export function HistoryPageContent({
  groups,
  shoppingIntent = false,
  weeklyPlans = [],
  currentCompleteMemberIds = null,
  weeklyPlanStatus = "ready",
  weeklyPlanRetrying = false,
  onWeeklyPlanRetry,
}: {
  groups: readonly HistoryGroup[];
  shoppingIntent?: boolean;
  weeklyPlans?: readonly WeeklyPlanHistoryRow[];
  /** null = 現行メンバー集合が未確定（partial 警告を出さない） */
  currentCompleteMemberIds?: readonly string[] | null;
  weeklyPlanStatus?: WeeklyPlanHistorySlotStatus;
  weeklyPlanRetrying?: boolean;
  onWeeklyPlanRetry?: () => void;
}) {
  // セッション内のみ。URL / localStorage は使わない（お気に入りフィルタ。設計 L4）。
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  if (groups.length === 0) {
    return (
      <main className="page-frame">
        <Stack gap={4}>
          <PageHeader
            title="作った献立"
            lead="これまでに作った献立を見返す場所です。下のメニューでは「履歴」と表示されます。"
          />
          {shoppingIntent ? <ShoppingIntentBanner /> : null}
          <WeeklyPlanHistorySlot
            weeklyPlans={weeklyPlans}
            currentCompleteMemberIds={currentCompleteMemberIds}
            status={weeklyPlanStatus}
            retrying={weeklyPlanRetrying}
            onRetry={onWeeklyPlanRetry}
          />
          {/*
            EmptyState は h3 固定のため、PageHeader(h1) 直下だと heading-order 違反になる。
            空状態は h2 見出し + 本文 + CTA で組む（axe / accessibility 契約）。
          */}
          <Surface as="section" tone="sunken" aria-labelledby="history-empty-title">
            <Inset pad={5}>
              <Stack gap={3}>
                <h2 id="history-empty-title">まだ献立がありません</h2>
                <p className="type-small">
                  「献立」タブで質問に答えて献立をつくると、ここに並びます。あとから見返したり、買い物リストにしたりできます。
                </p>
                <Link className="button-link button-link--primary" to="/planner">
                  献立を作る
                </Link>
              </Stack>
            </Inset>
          </Surface>
        </Stack>
      </main>
    );
  }

  // 代表献立の isFavorite のみ（グループ内 OR はしない）。
  const visible = favoritesOnly
    ? groups.filter((group) => group.representative.isFavorite)
    : groups;
  const householdVisible = visible.filter(
    (group) => group.representative.targetMode === "household",
  );
  const showShoppingDeadEnd = shoppingIntent && householdVisible.length === 0;

  return (
    <main className="page-frame">
      <Stack gap={4}>
        <PageHeader
          title="作った献立"
          lead="過去に作った献立です。タップすると内容を見返せます。お気に入りだけに絞ることもできます。"
        />
        {shoppingIntent ? <ShoppingIntentBanner /> : null}
        <WeeklyPlanHistorySlot
          weeklyPlans={weeklyPlans}
          currentCompleteMemberIds={currentCompleteMemberIds}
          status={weeklyPlanStatus}
          retrying={weeklyPlanRetrying}
          onRetry={onWeeklyPlanRetry}
        />
        <label className="history-filter-label min-h-11">
          <input
            type="checkbox"
            role="switch"
            checked={favoritesOnly}
            aria-checked={favoritesOnly}
            onChange={(event) => {
              setFavoritesOnly(event.target.checked);
            }}
          />
          お気に入りだけを表示
          <SwitchStateText checked={favoritesOnly} />
        </label>
        {showShoppingDeadEnd ? (
          <Surface as="section" tone="notice">
            <Inset pad={5}>
              <Stack gap={3}>
                <p>
                  いま選べる家族向けの献立がありません。買い物リストに使えるのは家族に合わせた献立だけです
                </p>
                <Link className="button-link button-link--primary" to="/planner">
                  家族向けの献立を作る
                </Link>
                {favoritesOnly ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFavoritesOnly(false);
                    }}
                  >
                    すべての献立を表示
                  </Button>
                ) : null}
                <Link className="button-link" to="/shopping">
                  買い物に戻る
                </Link>
              </Stack>
            </Inset>
          </Surface>
        ) : null}
        {!showShoppingDeadEnd && favoritesOnly && visible.length === 0 ? (
          <Surface as="section" tone="sunken">
            <Inset pad={5}>
              <Stack gap={3}>
                <p>お気に入りがありません</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFavoritesOnly(false);
                  }}
                >
                  すべての献立を表示
                </Button>
              </Stack>
            </Inset>
          </Surface>
        ) : null}
        {!showShoppingDeadEnd && visible.length > 0 ? (
          <ul className="history-list">
            {visible.map((group) => (
              <li key={group.derivationGroupId}>
                <HistoryCard group={group} shoppingIntent={shoppingIntent} />
              </li>
            ))}
          </ul>
        ) : null}
      </Stack>
    </main>
  );
}
