import { Link } from "react-router";
import type { HistoryGroup } from "../model/group-history";
import { HistoryCard } from "../components/history-card";
import { useHistoryGroups } from "../hooks/use-history";

/** 履歴一覧ルート。取得状態に応じて loading / empty / list を切り替える。 */
export function HistoryPage() {
  const { data = [], isPending, isError, refetch, isFetching } = useHistoryGroups();

  if (isPending) {
    return (
      <main className="page-frame">
        <p role="status">履歴を読み込んでいます</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="page-frame stack">
        <h1>履歴・お気に入り</h1>
        <p role="alert">履歴を読み込めませんでした</p>
        <button
          type="button"
          className="min-h-11 inline-flex items-center rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={isFetching}
          onClick={() => {
            void refetch();
          }}
        >
          もう一度読み込む
        </button>
      </main>
    );
  }

  return <HistoryPageContent groups={data} />;
}

/** テスト注入用の表示本体。hooks を持たない。 */
export function HistoryPageContent({ groups }: { groups: readonly HistoryGroup[] }) {
  if (groups.length === 0) {
    return (
      <main className="page-frame stack">
        <h1>履歴・お気に入り</h1>
        <p>まだ献立がありません</p>
        <Link className="min-h-11 inline-flex items-center font-semibold" to="/planner">
          献立を作る
        </Link>
      </main>
    );
  }

  return (
    <main className="page-frame stack">
      <h1>履歴・お気に入り</h1>
      <ul className="grid gap-4">
        {groups.map((group) => (
          <li key={group.derivationGroupId}>
            <HistoryCard group={group} />
          </li>
        ))}
      </ul>
    </main>
  );
}
