import { useState } from "react";
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
  // セッション内のみ。URL / localStorage は使わない（設計 L4）。
  const [favoritesOnly, setFavoritesOnly] = useState(false);

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

  // 代表献立の isFavorite のみ（グループ内 OR はしない）。
  const visible = favoritesOnly
    ? groups.filter((group) => group.representative.isFavorite)
    : groups;

  return (
    <main className="page-frame stack">
      <h1>作った献立</h1>
      <label className="inline-flex min-h-11 items-center gap-2">
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
      {favoritesOnly && visible.length === 0 ? (
        <section className="card stack">
          <p>お気に入りがありません</p>
          <button
            type="button"
            className="secondary-button min-h-11"
            onClick={() => {
              setFavoritesOnly(false);
            }}
          >
            すべての献立を表示
          </button>
        </section>
      ) : (
        <ul className="history-list">
          {visible.map((group) => (
            <li key={group.derivationGroupId}>
              <HistoryCard group={group} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
