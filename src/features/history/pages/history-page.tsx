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
        <h1>作った献立</h1>
        <section className="card stack">
          <p role="alert">履歴を読み込めませんでした</p>
          <button
            type="button"
            className="secondary-button min-h-11"
            disabled={isFetching}
            onClick={() => {
              void refetch();
            }}
          >
            もう一度読み込む
          </button>
        </section>
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
        <h1>作った献立</h1>
        <section className="card stack">
          <p>まだ献立がありません</p>
          <p className="field-hint">条件を入れて献立をつくると、ここに並びます。</p>
          <Link className="primary-button min-h-11" to="/planner">
            献立を作る
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-frame stack">
      <h1>作った献立</h1>
      <ul className="history-list">
        {groups.map((group) => (
          <li key={group.derivationGroupId}>
            <HistoryCard group={group} />
          </li>
        ))}
      </ul>
    </main>
  );
}
