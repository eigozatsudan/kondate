import type { JSX } from "react";
import { Link } from "react-router";
import { Button } from "@/shared/ui/button";
import { Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

/** ホームに並べる直近献立 1 件分（route が組み立てる表示用）。 */
export type HomeRecentMenuItem = {
  id: string;
  title: string;
};

export type HomeRecentMenusProps = {
  menus: readonly HomeRecentMenuItem[];
  /** 取得中。一覧の代わりに読み込み文を出す。 */
  loading?: boolean;
  /** 取得失敗。再試行 CTA を出す。 */
  error?: boolean;
  onRetry?: () => void;
};

/**
 * 直近の献立一覧。表示専用。
 * 1 タップで /menus/:id へ戻れる導線だけを持つ（削除・お気に入りは履歴タブ側）。
 */
export function HomeRecentMenus({
  menus,
  loading = false,
  error = false,
  onRetry,
}: HomeRecentMenusProps): JSX.Element {
  return (
    <Surface as="section" tone="sunken" aria-labelledby="home-recent-heading">
      <Stack gap={3}>
        <h2 id="home-recent-heading" className="home-section-title">
          直近の献立
        </h2>
        {loading ? (
          <p className="type-small" role="status">
            直近の献立を読み込んでいます…
          </p>
        ) : null}
        {error ? (
          <Stack gap={3}>
            <p role="alert" className="type-small">
              直近の献立を読み込めませんでした
            </p>
            {onRetry !== undefined ? (
              <Button variant="secondary" onClick={onRetry}>
                もう一度読み込む
              </Button>
            ) : null}
          </Stack>
        ) : null}
        {!loading && !error && menus.length === 0 ? (
          <p className="type-small">まだ献立がありません。上のボタンからつくれます。</p>
        ) : null}
        {!loading && !error && menus.length > 0 ? (
          <Stack as="ul" gap={2} aria-label="直近の献立一覧">
            {menus.map((menu) => (
              <li key={menu.id} className="home-recent-item">
                <Link className="home-recent-link min-h-11" to={`/menus/${menu.id}`}>
                  {menu.title.length > 0 ? menu.title : "献立"}
                </Link>
              </li>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Surface>
  );
}
