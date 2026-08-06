import { Component, type ReactNode } from "react";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  hasError: boolean;
};

/**
 * L3: Router 外（AppProviders / AuthProvider / getPublicEnv）の render throw 用。
 * RouteErrorElement は router 配下のみ拾うため、createRoot 直下に置く最小 ErrorBoundary。
 * 詳細・内部メッセージは出さず、日本語の再読込導線だけを示す。
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  public constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(): void {
    // 秘密・スタックは出さない。監視連携は別経路（ここは利用者向けフォールバックのみ）。
    // 引数は意図的に受け取らない（未使用パラメータの lint を避けつつ、ログもしない）。
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="page-frame stack">
          <h1>画面を表示できませんでした</h1>
          <p>
            一時的な問題か、通信・設定の不具合の可能性があります。ページを再読み込みするか、最初の画面からやり直してください。
          </p>
          <div className="stack" style={{ gap: "0.75rem" }}>
            <button
              className="primary-button min-h-11"
              type="button"
              onClick={() => {
                // Router 外のため Link は使わず location でホームへ
                window.location.assign("/");
              }}
            >
              ホームへ戻る
            </button>
            <button
              className="secondary-button min-h-11"
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              再読み込み
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
