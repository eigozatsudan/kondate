import { Link } from "react-router";

/**
 * L5: 未知 path 用の日本語 404。outlet 空のままにせず、ホーム導線を示す。
 * 認証要否の説明は出さず、保護 bypass にならないよう機能は開かない。
 */
export function NotFoundPage() {
  return (
    <main className="page-frame stack">
      <h1>ページが見つかりません</h1>
      <p>
        お探しの画面はないか、アドレスが間違っている可能性があります。最初の画面からお進みください。
      </p>
      <Link className="primary-button min-h-11" to="/">
        ホームへ戻る
      </Link>
    </main>
  );
}
