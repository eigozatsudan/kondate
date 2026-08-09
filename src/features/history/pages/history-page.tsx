import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { hasShoppingIntent } from "@/features/shopping/shopping-intent";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/feedback";
import { PageHeader } from "@/shared/ui/page-header";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import type { HistoryGroup } from "../model/group-history";
import { HistoryCard } from "../components/history-card";
import { useHistoryGroups } from "../hooks/use-history";

/** 履歴一覧ルート。取得状態に応じて loading / empty / list を切り替える。 */
export function HistoryPage() {
  const [params] = useSearchParams();
  const shoppingIntent = hasShoppingIntent(params);
  const { data = [], isPending, isError, refetch, isFetching } = useHistoryGroups();

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

  return <HistoryPageContent groups={data} shoppingIntent={shoppingIntent} />;
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
}: {
  groups: readonly HistoryGroup[];
  shoppingIntent?: boolean;
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
        <label className="history-filter-label">
          <input
            type="checkbox"
            role="switch"
            className="min-h-11 min-w-11"
            checked={favoritesOnly}
            aria-checked={favoritesOnly}
            onChange={(event) => {
              setFavoritesOnly(event.target.checked);
            }}
          />
          お気に入りだけを表示
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
