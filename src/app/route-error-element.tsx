import { Link, useRouteError } from "react-router";

/**
 * L2: ルート描画 throw / lazy chunk 失敗時の日本語リカバリ UI。
 * 詳細スタックや内部メッセージは出さず、フルリロードを本線、ホーム／ログインは補助とする。
 * 同一 specifier の失敗 Promise はモジュールマップで再利用されるため、
 * SPA 内 Link だけでは /welcome 等の死回路を抜けられない。
 */
export function RouteErrorElement() {
  // エラーを消費して React Router の default 白画面を抑止する（詳細は UI に出さない）
  useRouteError();

  return (
    <main className="page-frame stack">
      <h1>画面を表示できませんでした</h1>
      <p>
        一時的な問題か、通信の不具合の可能性があります。もう一度お試しいただくか、最初の画面からやり直してください。
      </p>
      <div className="stack" style={{ gap: "0.75rem" }}>
        <button
          className="primary-button min-h-11"
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          再読み込み
        </button>
        <Link className="secondary-button min-h-11" to="/">
          ホームへ戻る
        </Link>
        <Link className="secondary-button min-h-11" to="/login">
          ログイン画面へ
        </Link>
      </div>
    </main>
  );
}
