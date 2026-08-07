import { Component, type ReactNode } from "react";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  hasError: boolean;
  /** public-env / 公開設定破損。ホーム・再読込は同一障害へ再突入するため専用 UI。 */
  isConfigError: boolean;
};

/** getPublicEnv / parsePublicEnv が投げる固定文言（値は echo しない）。 */
const PUBLIC_ENV_ERROR_MESSAGE = "公開設定を読み込めません";

function isPublicEnvError(error: unknown): boolean {
  return error instanceof Error && error.message === PUBLIC_ENV_ERROR_MESSAGE;
}

/**
 * L3/L6: Router 外（AppProviders / AuthProvider / getPublicEnv）の render throw 用。
 * RouteErrorElement は router 配下のみ拾うため、createRoot 直下に置く最小 ErrorBoundary。
 * 詳細・内部メッセージは出さず、日本語の再読込導線だけを示す。
 * L6: 公開設定破損時はホーム／再読込ループを避け、設定不備である旨だけを示す。
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  public constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, isConfigError: false };
  }

  public static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { hasError: true, isConfigError: isPublicEnvError(error) };
  }

  public componentDidCatch(): void {
    // 秘密・スタックは出さない。監視連携は別経路（ここは利用者向けフォールバックのみ）。
    // 引数は意図的に受け取らない（未使用パラメータの lint を避けつつ、ログもしない）。
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.state.isConfigError) {
        // L6: assign("/") / reload は同じ初期化で再 throw する死回路。
        // 利用者に「設定側の問題で再試行では直らない」と明示し、脱出不能ボタンを出さない。
        return (
          <main className="page-frame stack">
            <h1>アプリを起動できません</h1>
            <p role="alert">
              公開設定に問題があるため画面を表示できません。再読み込みやホームへの移動では解消しないことがあります。時間をおいて再度アクセスするか、サービス提供元へお問い合わせください。
            </p>
          </main>
        );
      }

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
