import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";

export function AuthCallbackPage({ gateway }: { gateway?: AuthGateway }) {
  const navigate = useNavigate();
  const [result, setResult] = useState<AuthCallbackResult | null>(null);
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const callbackPromise = useRef<Promise<AuthCallbackResult> | null>(null);

  useEffect(() => {
    if (callbackPromise.current === null) {
      const callbackUrl = new URL(window.location.href);
      const visibleUrl = new URL(callbackUrl);
      visibleUrl.searchParams.delete("code");
      visibleUrl.searchParams.delete("state");
      visibleUrl.searchParams.delete("error");
      visibleUrl.searchParams.delete("error_code");
      visibleUrl.searchParams.delete("error_description");
      visibleUrl.hash = "";
      window.history.replaceState(window.history.state, "", visibleUrl);
      callbackPromise.current = activeGateway.completeCallback(callbackUrl);
    }
    let active = true;
    void callbackPromise.current.then((next) => {
      if (!active) return;
      setResult(next);
      if (next.kind === "complete") {
        void navigate(next.returnTo, { replace: true });
      } else if (next.kind === "expired") {
        void navigate("/login", {
          replace: true,
          state: { authError: "magic_link_expired" },
        });
      } else if (next.kind === "error") {
        void navigate("/login", {
          replace: true,
          state: { authError: next.code },
        });
      }
    });
    return () => {
      active = false;
    };
  }, [activeGateway, navigate]);

  if (result?.kind === "deposited") {
    return (
      <main className="page-frame stack">
        <h1>ログイン情報を元のブラウザへ渡しました</h1>
        <section className="card stack">
          <p>元のブラウザでログインを続けてください。この画面に認証情報は保存されません</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-frame" aria-live="polite">
      <h1>ログインを確認中</h1>
      <p>この画面を閉じずにお待ちください。</p>
    </main>
  );
}
